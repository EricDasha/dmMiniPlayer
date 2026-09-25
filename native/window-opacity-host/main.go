//go:build windows

package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	gwlExStyle      = ^uintptr(19) // -20
	gwlStyle       = ^uintptr(15) // -16
	wsExLayered     = 0x00080000
	wsExTransparent = 0x00000020
	wsPopup         = 0x80000000
	smCxScreen      = 0
	smCyScreen      = 1
	lwaAlpha          = 0x00000002
	swpNoSize         = 0x0001
	swpNoMove         = 0x0002
	swpNoZOrder       = 0x0004
	swpNoActivate     = 0x0010
	swpFrameChanged   = 0x0020
	minOpacity        = 5
	maxOpacity        = 100
	defaultSmoothMs   = 120
	boundsTolerance   = 48
	hostName          = "com.dmminiplayer.window_opacity"
	hkeyCurrentUser   = 0x80000001
	errorFileNotFound = 2
	// 物理像素/CSS像素 的比例最大为 DPR²（最高≈4），再加上标题与边界偏移的裕量。
	// 超过该倍数即视为误选了浏览器主窗口等大窗，直接拒绝匹配，防止把整个浏览器变透明。
	maxAreaRatio = 6
	// 必须精确匹配 docPIP 独占标题标记才允许命中：包含/子串匹配会误伤
	// 浏览器主窗口与最大化游戏/浏览器等大窗口，一律拒绝。
	// 实测发现（Edge/Chrome 146+）：pipWindow.document.title 不会传播到
	// OS 原生 HWND；Chrome 快照的是「开窗时刻源页 document.title」——
	// 扩展在源页标题尾部追加了 ' - PIP'，所以 docPIP 的 HWND 标题
	// 一定以 ' - pip' 结尾。用「后缀 + 窗口类 + 非最大化 + 面积护栏」
	// 多重约束替代纯 marker 精确匹配。
	markerTitle     = "dmminiplayer-pip"
	docPIPtitleTail = " - pip"
	// host 版本：ping 时回传，用于确认扩展连接的是新二进制（旧二进制无此字段）。
	hostVersion = "1.1.0"
	// 打开 PiP 时 document.title 传播到 OS 原生 HWND 标题是异步的，
	// 首次枚举常落在标题生效之前。失败后短重试，命中即停，杜绝“概率失效”。
	findRetryAttempts = 3
	findRetryDelayMs  = 40
)

var (
	user32                         = syscall.NewLazyDLL("user32.dll")
	advapi32                       = syscall.NewLazyDLL("advapi32.dll")
	procEnumWindows                = user32.NewProc("EnumWindows")
	procGetWindowTextW             = user32.NewProc("GetWindowTextW")
	procGetWindowTextLengthW       = user32.NewProc("GetWindowTextLengthW")
	procGetWindowRect              = user32.NewProc("GetWindowRect")
	procGetCursorPos               = user32.NewProc("GetCursorPos")
	procIsWindowVisible            = user32.NewProc("IsWindowVisible")
	procGetWindowLongPtrW          = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW          = user32.NewProc("SetWindowLongPtrW")
	procSetWindowPos               = user32.NewProc("SetWindowPos")
	procGetLayeredWindowAttributes = user32.NewProc("GetLayeredWindowAttributes")
	procSetLayeredWindowAttributes = user32.NewProc("SetLayeredWindowAttributes")
	procIsZoomed                   = user32.NewProc("IsZoomed")
	procGetSystemMetrics           = user32.NewProc("GetSystemMetrics")
	procGetClassNameW              = user32.NewProc("GetClassNameW")
	procRegDeleteTreeW             = advapi32.NewProc("RegDeleteTreeW")
)

type bounds struct {
	Left   int `json:"left"`
	Top    int `json:"top"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type request struct {
	Command  string   `json:"command"`
	Title    string   `json:"title"`
	Titles   []string `json:"titles"`
	Bounds   bounds   `json:"bounds"`
	Opacity  int      `json:"opacity"`
	SmoothMs int      `json:"smoothMs"`
	Enabled  bool     `json:"enabled"`
	Left     int      `json:"left"`
	Top      int      `json:"top"`
}

type response struct {
	OK          bool   `json:"ok"`
	Error       string `json:"error,omitempty"`
	HWND        string `json:"hwnd,omitempty"`
	Title       string `json:"title,omitempty"`
	Alpha       int    `json:"alpha,omitempty"`
	Passthrough bool   `json:"passthrough,omitempty"`
	Uninstalled bool   `json:"uninstalled,omitempty"`
	CursorX     *int32 `json:"cursorX,omitempty"`
	CursorY     *int32 `json:"cursorY,omitempty"`
	Version     string `json:"version,omitempty"`
	// not-found 时的诊断信息：枚举到的可见窗口数、其中标题精确命中 marker 的个数。
	// 若 titleMatches 恒为 0，说明 marker 尚未/未传播到原生标题，需要核对标题链路。
	Enumerated   int `json:"enumerated,omitempty"`
	TitleMatches int `json:"titleMatches,omitempty"`
}

type point struct {
	X int32
	Y int32
}

type rect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type windowInfo struct {
	hwnd   uintptr
	title  string
	bounds bounds
	// 窗口类名与标题后缀/精确匹配标记，用于 docPIP 判定
	className string
}

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()

	for {
		var lengthBytes [4]byte
		if _, err := io.ReadFull(in, lengthBytes[:]); err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
				fmt.Fprintln(os.Stderr, err)
			}
			return
		}

		length := binary.LittleEndian.Uint32(lengthBytes[:])
		if length == 0 || length > 1<<20 {
			writeResponse(out, response{OK: false, Error: "invalid message length"})
			continue
		}

		body := make([]byte, length)
		if _, err := io.ReadFull(in, body); err != nil {
			writeResponse(out, response{OK: false, Error: err.Error()})
			continue
		}

		var req request
		if err := json.Unmarshal(body, &req); err != nil {
			writeResponse(out, response{OK: false, Error: err.Error()})
			continue
		}

		writeResponse(out, handle(req))
	}
}

func handle(req request) response {
	switch req.Command {
	case "ping":
		return response{OK: true, Version: hostVersion}
	case "setOpacity":
		return setOpacity(req, clamp(req.Opacity, minOpacity, maxOpacity))
	case "setMousePassthrough":
		return setMousePassthrough(req, req.Enabled)
	case "getCursorPosition":
		return getCursorPosition()
	case "setPosition":
		return setPosition(req)
	case "uninstall":
		return uninstallNativeHost()
	case "reset":
		return resetWindow(req)
	default:
		return response{OK: false, Error: "unknown command"}
	}
}

func getCursorPosition() response {
	var cursor point
	ret, _, err := procGetCursorPos.Call(uintptr(unsafe.Pointer(&cursor)))
	if ret == 0 {
		return response{OK: false, Error: err.Error()}
	}
	return response{OK: true, CursorX: &cursor.X, CursorY: &cursor.Y}
}

func setPosition(req request) response {
	win, ok, diag, err := findBestWindowAll(req, true)
	if err != nil {
		return response{OK: false, Error: err.Error()}
	}
	if !ok {
		return response{OK: false, Error: "target window not found by bounds",
			Enumerated: diag.enumerated, TitleMatches: diag.titleMatches}
	}
	if err := animateWindowPosition(win.hwnd, win.bounds, req.Left, req.Top, req.SmoothMs); err != nil {
		return response{OK: false, Error: err.Error()}
	}
	return response{OK: true, HWND: fmt.Sprintf("0x%x", win.hwnd), Title: win.title}
}

func uninstallNativeHost() response {
	registryKeys := []string{
		`Software\Google\Chrome\NativeMessagingHosts\` + hostName,
		`Software\Microsoft\Edge\NativeMessagingHosts\` + hostName,
	}
	for _, key := range registryKeys {
		ret, _, err := procRegDeleteTreeW.Call(
			hkeyCurrentUser,
			uintptr(unsafe.Pointer(utf16Ptr(key))),
		)
		if ret != 0 && ret != errorFileNotFound {
			return response{OK: false, Error: err.Error()}
		}
	}

	exePath, err := os.Executable()
	if err == nil {
		manifestPath := filepath.Join(filepath.Dir(exePath), hostName+".json")
		if removeErr := os.Remove(manifestPath); removeErr != nil && !os.IsNotExist(removeErr) {
			return response{OK: false, Error: removeErr.Error()}
		}
	}

	return response{OK: true, Uninstalled: true}
}

func utf16Ptr(value string) *uint16 {
	ptr, _ := syscall.UTF16PtrFromString(value)
	return ptr
}

func resetWindow(req request) response {
	win, ok, diag, err := findBestWindowAll(req, false)
	if err != nil {
		return response{OK: false, Error: err.Error()}
	}
	if !ok {
		return response{OK: false, Error: "target window not found",
			Enumerated: diag.enumerated, TitleMatches: diag.titleMatches}
	}
	if err := setWindowMousePassthrough(win.hwnd, false); err != nil {
		return response{OK: false, Error: err.Error()}
	}
	return setWindowOpacity(win, maxOpacity, req.SmoothMs)
}

func setOpacity(req request, opacity int) response {
	win, ok, diag, err := findBestWindowAll(req, false)
	if err != nil {
		return response{OK: false, Error: err.Error()}
	}
	if !ok {
		return response{OK: false, Error: "target window not found",
			Enumerated: diag.enumerated, TitleMatches: diag.titleMatches}
	}
	return setWindowOpacity(win, opacity, req.SmoothMs)
}

func setWindowOpacity(win windowInfo, opacity int, smoothMs int) response {
	alpha := int(math.Round(float64(opacity) * 255 / 100))
	alpha = clamp(alpha, 1, 255)

	style, _, _ := procGetWindowLongPtrW.Call(win.hwnd, gwlExStyle)
	procSetWindowLongPtrW.Call(win.hwnd, gwlExStyle, style|wsExLayered)
	if err := animateWindowAlpha(win.hwnd, alpha, smoothMs); err != nil {
		return response{OK: false, Error: err.Error()}
	}

	return response{
		OK:    true,
		HWND:  fmt.Sprintf("0x%x", win.hwnd),
		Title: win.title,
		Alpha: alpha,
	}
}

func setMousePassthrough(req request, enabled bool) response {
	win, ok, diag, err := findBestWindowAll(req, true)
	if err != nil {
		return response{OK: false, Error: err.Error()}
	}
	if !ok {
		return response{OK: false, Error: "target window not found by bounds",
			Enumerated: diag.enumerated, TitleMatches: diag.titleMatches}
	}

	if err := setWindowMousePassthrough(win.hwnd, enabled); err != nil {
		return response{OK: false, Error: err.Error()}
	}

	return response{
		OK:          true,
		HWND:        fmt.Sprintf("0x%x", win.hwnd),
		Title:       win.title,
		Passthrough: enabled,
	}
}

func titleMatchScore(win windowInfo, titles []string) int {
	// 只有精确匹配独占标记、或「以 ' - pip' 结尾的标题快照 + 类名护栏」才算命中，
	// 防止大窗口靠标题相近偷分。
	title := normalizeTitle(win.title)
	for _, candidate := range titles {
		if candidate == "" {
			continue
		}
		// 精确匹配才给分：包含/子串一律 0，避免大窗口靠标题相近偷分。
		if title == candidate {
			return 300
		}
	}
	return 0
}

// 枚举到的窗口是否是 docPIP：
// 1. 标题精确等于 marker（老路径，marker 能传播时）；
// 2. 或「标题以 ' - pip' 结尾 + Chromium 窗口类 + 非子窗口样式」
//    ——Chrome 快照源页标题给 HWND，扩展在源页标题尾部追加 ' - PIP'，
//    所以真 docPIP 的 HWND 标题必带该后缀；浏览器主窗口/游戏/其它应用不带。
func isMarkerWindow(winTitle string) bool {
	return normalizeTitle(winTitle) == markerTitle
}

func looksLikeDocPIP(win windowInfo) bool {
	if isMarkerWindow(win.title) {
		return true
	}
	if !strings.HasSuffix(normalizeTitle(win.title), docPIPtitleTail) {
		return false
	}
	// Chromium 顶层窗口类。Chrome/Edge 的 docPIP 与主窗口同类名，
	// 必须叠加「非最大化 + 面积护栏」排除主窗口（主窗口标题无 ' - PIP' 后缀，
	// 但双保险：类名过滤掉 GLFW/Qt/Cabinet 等游戏与资源管理器误配）。
	if win.className != "Chrome_WidgetWin_1" {
		return false
	}
	if isMaximizedOrFullscreen(win.hwnd, win.bounds) {
		return false
	}
	return true
}

func selectBestWindowByBounds(windows []windowInfo, req request) (windowInfo, bool) {
	if !hasBounds(req.Bounds) {
		return windowInfo{}, false
	}
	titles := normalizeTitles(req)
	if len(titles) == 0 {
		return windowInfo{}, false
	}
	bestDistance := math.MaxInt
	var best windowInfo
	for _, win := range windows {
		// 只考虑 docPIP 形态的窗口：游戏/浏览器主窗口/聊天窗口即使
		// bounds 重合也直接跳过，从根上杜绝误伤大窗口。
		if titleMatchScore(win, titles) == 0 && !looksLikeDocPIP(win) {
			continue
		}
		// 最大化/全屏窗口永远不是 docPIP：即使标题伪装也拒绝。
		if isMaximizedOrFullscreen(win.hwnd, win.bounds) {
			continue
		}
		distance := windowBoundsDistance(win.bounds, req.Bounds)
		if distance < bestDistance {
			bestDistance = distance
			best = win
		}
	}

	if bestDistance > boundsTolerance*4 {
		return windowInfo{}, false
	}
	if !isReasonableAreaMatch(best, req.Bounds) {
		return windowInfo{}, false
	}
	return best, true
}

func setWindowMousePassthrough(hwnd uintptr, enabled bool) error {
	style, _, _ := procGetWindowLongPtrW.Call(hwnd, gwlExStyle)
	nextStyle := style | wsExLayered
	if enabled {
		nextStyle |= wsExTransparent
	} else {
		nextStyle &^= wsExTransparent
	}

	procSetWindowLongPtrW.Call(hwnd, gwlExStyle, nextStyle)
	ret, _, err := procSetWindowPos.Call(
		hwnd,
		0,
		0,
		0,
		0,
		0,
		swpNoMove|swpNoSize|swpNoZOrder|swpNoActivate|swpFrameChanged,
	)
	if ret == 0 {
		return err
	}
	return nil
}

func animateWindowPosition(hwnd uintptr, start bounds, left int, top int, smoothMs int) error {
	if smoothMs <= 16 {
		return setWindowPosition(hwnd, left, top)
	}

	startedAt := time.Now()
	for {
		progress := math.Min(1, float64(time.Since(startedAt).Milliseconds())/float64(smoothMs))
		eased := 1 - math.Pow(1-progress, 3)
		x := int(math.Round(float64(start.Left) + float64(left-start.Left)*eased))
		y := int(math.Round(float64(start.Top) + float64(top-start.Top)*eased))
		if err := setWindowPosition(hwnd, x, y); err != nil {
			return err
		}
		if progress >= 1 {
			return nil
		}
		time.Sleep(16 * time.Millisecond)
	}
}

func setWindowPosition(hwnd uintptr, left int, top int) error {
	ret, _, err := procSetWindowPos.Call(
		hwnd,
		0,
		uintptr(left),
		uintptr(top),
		0,
		0,
		swpNoSize|swpNoZOrder|swpNoActivate,
	)
	if ret == 0 {
		return err
	}
	return nil
}

func animateWindowAlpha(hwnd uintptr, targetAlpha int, smoothMs int) error {
	startAlpha := getWindowAlpha(hwnd)
	targetAlpha = clamp(targetAlpha, 1, 255)

	if smoothMs < 0 {
		smoothMs = 0
	}
	if smoothMs == 0 {
		smoothMs = defaultSmoothMs
	}
	if smoothMs <= 16 || abs(targetAlpha-startAlpha) <= 2 {
		return setWindowAlpha(hwnd, targetAlpha)
	}

	steps := clamp(smoothMs/16, 4, 12)
	for step := 1; step <= steps; step++ {
		progress := float64(step) / float64(steps)
		alpha := int(math.Round(float64(startAlpha) + float64(targetAlpha-startAlpha)*progress))
		if err := setWindowAlpha(hwnd, alpha); err != nil {
			return err
		}
		if step < steps {
			time.Sleep(time.Duration(smoothMs/steps) * time.Millisecond)
		}
	}
	return nil
}

func getWindowAlpha(hwnd uintptr) int {
	var colorKey uint32
	var alpha byte = 255
	var flags uint32
	ret, _, _ := procGetLayeredWindowAttributes.Call(
		hwnd,
		uintptr(unsafe.Pointer(&colorKey)),
		uintptr(unsafe.Pointer(&alpha)),
		uintptr(unsafe.Pointer(&flags)),
	)
	if ret == 0 || flags&lwaAlpha == 0 {
		return 255
	}
	return int(alpha)
}

func setWindowAlpha(hwnd uintptr, alpha int) error {
	ret, _, err := procSetLayeredWindowAttributes.Call(
		hwnd,
		0,
		uintptr(clamp(alpha, 1, 255)),
		lwaAlpha,
	)
	if ret == 0 {
		return err
	}
	return nil
}

type findDiagnostics struct {
	enumerated   int
	titleMatches int
}

// findBestWindowAll 按 `useBounds` 选择匹配策略，并在标题异步传播期间短重试。
// 每次失败都会带着最新诊断信息，命中即停；确保打开 PiP 的“概率失效/误伤窗口”
// 被换成确定性的「找到 pip 或明确报 not found」。
func findBestWindowAll(req request, useBounds bool) (windowInfo, bool, findDiagnostics, error) {
	titles := normalizeTitles(req)
	// 无标题可匹配时立刻拒绝，杜绝无谓枚举和“矮子里拔将军”。
	if len(titles) == 0 {
		return windowInfo{}, false, findDiagnostics{}, nil
	}

	var diag findDiagnostics
	for attempt := 0; attempt < findRetryAttempts; attempt++ {
		windows, err := enumWindows()
		if err != nil {
			return windowInfo{}, false, diag, err
		}
		diag.enumerated = len(windows)
		diag.titleMatches = 0
		for _, win := range windows {
			if looksLikeDocPIP(win) {
				diag.titleMatches++
			}
		}

		var best windowInfo
		var ok bool
		if useBounds {
			best, ok = selectBestWindowByBounds(windows, req)
		} else {
			best, ok = selectBestWindow(windows, titles, req.Bounds)
		}
		if ok {
			return best, true, diag, nil
		}
		if attempt < findRetryAttempts-1 {
			time.Sleep(findRetryDelayMs * time.Millisecond)
		}
	}
	return windowInfo{}, false, diag, nil
}

func selectBestWindow(windows []windowInfo, titles []string, target bounds) (windowInfo, bool) {
	if len(titles) == 0 {
		return windowInfo{}, false
	}
	bestDistance := math.MaxInt
	var best windowInfo
	found := false
	for _, win := range windows {
		if titleMatchScore(win, titles) == 0 && !looksLikeDocPIP(win) {
			continue
		}
		if isMaximizedOrFullscreen(win.hwnd, win.bounds) {
			continue
		}
		if hasBounds(target) {
			distance := windowBoundsDistance(win.bounds, target)
			if distance > boundsTolerance*4 {
				continue
			}
			if distance < bestDistance {
				bestDistance = distance
				best = win
				found = true
			}
			continue
		}
		// 无 bounds：只接受唯一的 marker 窗口，多个则拒绝避免误伤。
		if found {
			return windowInfo{}, false
		}
		best = win
		found = true
	}

	if !found {
		return windowInfo{}, false
	}
	if !isReasonableAreaMatch(best, target) {
		return windowInfo{}, false
	}
	return best, true
}

func enumWindows() ([]windowInfo, error) {
	var windows []windowInfo
	callback := syscall.NewCallback(func(hwnd uintptr, lparam uintptr) uintptr {
		visible, _, _ := procIsWindowVisible.Call(hwnd)
		if visible == 0 {
			return 1
		}

		title := getWindowTitle(hwnd)
		if title == "" {
			return 1
		}

		r, ok := getWindowBounds(hwnd)
		if !ok {
			return 1
		}

		windows = append(windows, windowInfo{
			hwnd:      hwnd,
			title:     title,
			bounds:    r,
			className: getClassName(hwnd),
		})
		return 1
	})

	ret, _, err := procEnumWindows.Call(callback, 0)
	if ret == 0 {
		return nil, err
	}
	return windows, nil
}

func getClassName(hwnd uintptr) string {
	buf := make([]uint16, 128)
	ret, _, _ := procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if ret == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

func getWindowTitle(hwnd uintptr) string {
	length, _, _ := procGetWindowTextLengthW.Call(hwnd)
	if length == 0 {
		return ""
	}

	buf := make([]uint16, length+1)
	procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return strings.TrimSpace(syscall.UTF16ToString(buf))
}

func getWindowBounds(hwnd uintptr) (bounds, bool) {
	var r rect
	ret, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	if ret == 0 {
		return bounds{}, false
	}
	return bounds{
		Left:   int(r.Left),
		Top:    int(r.Top),
		Width:  int(r.Right - r.Left),
		Height: int(r.Bottom - r.Top),
	}, true
}

func scoreWindow(win windowInfo, titles []string, target bounds) int {
	score := 0
	title := normalizeTitle(win.title)
	for _, candidate := range titles {
		if candidate == "" {
			continue
		}
		// 精确匹配才给分：包含/子串一律 0，避免大窗口靠标题相近偷分。
		if title == candidate {
			score = max(score, 300)
		}
	}

	if hasBounds(target) {
		distance := windowBoundsDistance(win.bounds, target)
		if distance <= boundsTolerance*4 {
			score += 500 - distance
		} else {
			score -= min(distance, 500)
		}
	}

	return score
}

func windowBoundsDistance(a bounds, b bounds) int {
	return abs(a.Left-b.Left) +
		abs(a.Top-b.Top) +
		abs(a.Width-b.Width) +
		abs(a.Height-b.Height)
}

func normalizeTitles(req request) []string {
	// 老版本扩展曾把页面标题（如 "YouTube"）发过来，而浏览器主窗口标题
	// 恰好是 "YouTube - Google Chrome"（归一化后完全相等），不过滤就会
	// 精确命中浏览器大窗口。只保留 marker 与标题后缀两种可匹配形态。
	seen := map[string]bool{}
	var titles []string
	for _, title := range append([]string{req.Title}, req.Titles...) {
		title = normalizeTitle(title)
		if title == "" || seen[title] {
			continue
		}
		// 精确 marker 或以 ' - pip' 结尾的源页标题快照
		if title != markerTitle && !strings.HasSuffix(title, docPIPtitleTail) {
			continue
		}
		seen[title] = true
		titles = append(titles, title)
	}
	return titles
}

func normalizeTitle(title string) string {
	title = strings.TrimSpace(title)
	title = strings.TrimSuffix(title, " - Google Chrome")
	title = strings.TrimSuffix(title, " - Microsoft Edge")
	return strings.ToLower(strings.TrimSpace(title))
}

func hasBounds(b bounds) bool {
	return b.Width > 0 && b.Height > 0
}

// 防止把浏览器主窗口/最大化游戏误判成 docPIP：
// JS 上报的 bounds 是 CSS 像素，GetWindowRect 返回物理像素，二者面积最多差 DPR²（≈4）。
// 若候选窗口面积远超目标窗口，则它更可能是带标题栏/侧栏的浏览器主窗口，而不是小画中画。
// 额外护栏：候选窗口绝不能是最大化/全屏（覆盖整个屏幕），docPIP 永远是小浮窗。
func isMaximizedOrFullscreen(hwnd uintptr, b bounds) bool {
	if hwnd != 0 {
		if zoomed, _, _ := procIsZoomed.Call(hwnd); zoomed != 0 {
			return true
		}
	}
	cx, _, _ := procGetSystemMetrics.Call(smCxScreen)
	cy, _, _ := procGetSystemMetrics.Call(smCyScreen)
	if cx > 0 && cy > 0 && b.Width >= int(cx) && b.Height >= int(cy) {
		return true
	}
	return false
}

func isReasonableAreaMatch(win windowInfo, target bounds) bool {
	// 面积护栏只放行 docPIP 形态的窗口：浏览器主窗口/游戏即使面积巧合也拒绝
	if !looksLikeDocPIP(win) {
		return false
	}
	if isMaximizedOrFullscreen(win.hwnd, win.bounds) {
		return false
	}
	if !hasBounds(target) {
		return true
	}
	targetArea := max(1, target.Width*target.Height)
	winArea := max(1, win.bounds.Width*win.bounds.Height)
	ratio := float64(winArea) / float64(targetArea)
	return ratio <= maxAreaRatio && ratio >= 1/maxAreaRatio
}

func writeResponse(out *bufio.Writer, resp response) {
	body, err := json.Marshal(resp)
	if err != nil {
		body = []byte(`{"ok":false,"error":"marshal response failed"}`)
	}

	var length [4]byte
	binary.LittleEndian.PutUint32(length[:], uint32(len(body)))
	_, _ = out.Write(length[:])
	_, _ = out.Write(body)
	_ = out.Flush()
}

func clamp(value, minValue, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
