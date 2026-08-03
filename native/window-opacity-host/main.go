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
	gwlExStyle        = ^uintptr(19) // -20
	wsExLayered       = 0x00080000
	wsExTransparent   = 0x00000020
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
		return response{OK: true}
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
	win, ok, err := findBestWindowByBounds(req)
	if err != nil {
		return response{OK: false, Error: err.Error()}
	}
	if !ok {
		return response{OK: false, Error: "target window not found by bounds"}
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
	win, ok, err := findBestWindow(req)
	if err != nil {
		return response{OK: false, Error: err.Error()}
	}
	if !ok {
		return response{OK: false, Error: "target window not found"}
	}
	if err := setWindowMousePassthrough(win.hwnd, false); err != nil {
		return response{OK: false, Error: err.Error()}
	}
	return setWindowOpacity(win, maxOpacity, req.SmoothMs)
}

func setOpacity(req request, opacity int) response {
	win, ok, err := findBestWindow(req)
	if err != nil {
		return response{OK: false, Error: err.Error()}
	}
	if !ok {
		return response{OK: false, Error: "target window not found"}
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
	win, ok, err := findBestWindowByBounds(req)
	if err != nil {
		return response{OK: false, Error: err.Error()}
	}
	if !ok {
		return response{OK: false, Error: "target window not found by bounds"}
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

func findBestWindowByBounds(req request) (windowInfo, bool, error) {
	if !hasBounds(req.Bounds) {
		return windowInfo{}, false, nil
	}

	windows, err := enumWindows()
	if err != nil {
		return windowInfo{}, false, err
	}

	bestDistance := math.MaxInt
	var best windowInfo
	for _, win := range windows {
		distance := windowBoundsDistance(win.bounds, req.Bounds)
		if distance < bestDistance {
			bestDistance = distance
			best = win
		}
	}

	if bestDistance > boundsTolerance*4 {
		return windowInfo{}, false, nil
	}
	return best, true, nil
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

func findBestWindow(req request) (windowInfo, bool, error) {
	windows, err := enumWindows()
	if err != nil {
		return windowInfo{}, false, err
	}

	titles := normalizeTitles(req)
	bestScore := math.MinInt
	var best windowInfo
	for _, win := range windows {
		score := scoreWindow(win, titles, req.Bounds)
		if score > bestScore {
			bestScore = score
			best = win
		}
	}

	if bestScore < 180 {
		return windowInfo{}, false, nil
	}
	return best, true, nil
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
			hwnd:   hwnd,
			title:  title,
			bounds: r,
		})
		return 1
	})

	ret, _, err := procEnumWindows.Call(callback, 0)
	if ret == 0 {
		return nil, err
	}
	return windows, nil
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
		switch {
		case title == candidate:
			score = max(score, 300)
		case strings.Contains(title, candidate), strings.Contains(candidate, title):
			score = max(score, 210)
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
	seen := map[string]bool{}
	var titles []string
	for _, title := range append([]string{req.Title}, req.Titles...) {
		title = normalizeTitle(title)
		if title == "" || seen[title] {
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
