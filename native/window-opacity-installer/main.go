//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"unsafe"
)

const (
	hostName = "com.dmminiplayer.window_opacity"

	extIDEditID       = 1001
	addIDButtonID     = 1002
	idListID          = 1003
	removeIDButtonID  = 1004
	installButtonID   = 1005
	statusStaticID    = 1006
	openFolderButton  = 1007
	openSelectedDirID = 1008
	uninstallButtonID = 1009

	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	wsChild            = 0x40000000
	wsTabStop          = 0x00010000
	esAutoHScroll      = 0x0080
	bsAutoCheckbox     = 0x0003
	bsDefPushButton    = 0x0001
	ssLeft             = 0x0000

	cwUseDefault = 0x80000000

	wmCreate  = 0x0001
	wmDestroy = 0x0002
	wmCommand = 0x0111

	bmGetCheck     = 0x00F0
	bmSetCheck     = 0x00F1
	bstChecked     = 1
	lbAddString    = 0x0180
	lbDeleteString = 0x0182
	lbGetCount     = 0x018B
	lbGetCurSel    = 0x0188
	lbGetText      = 0x0189
	lbSetCurSel    = 0x0186

	swShow = 5

	hkeyCurrentUser   = 0x80000001
	keySetValue       = 0x0002
	keyRead           = 0x20019
	regSZ             = 1
	errorFileNotFound = 2
)

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	advapi32             = syscall.NewLazyDLL("advapi32.dll")
	shell32              = syscall.NewLazyDLL("shell32.dll")
	procRegisterClassExW = user32.NewProc("RegisterClassExW")
	procCreateWindowExW  = user32.NewProc("CreateWindowExW")
	procDefWindowProcW   = user32.NewProc("DefWindowProcW")
	procDestroyWindow    = user32.NewProc("DestroyWindow")
	procPostQuitMessage  = user32.NewProc("PostQuitMessage")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessageW = user32.NewProc("DispatchMessageW")
	procSendMessageW     = user32.NewProc("SendMessageW")
	procSetWindowTextW   = user32.NewProc("SetWindowTextW")
	procGetWindowTextW   = user32.NewProc("GetWindowTextW")
	procLoadCursorW      = user32.NewProc("LoadCursorW")
	procGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")
	procRegCreateKeyExW  = advapi32.NewProc("RegCreateKeyExW")
	procRegOpenKeyExW    = advapi32.NewProc("RegOpenKeyExW")
	procRegSetValueExW   = advapi32.NewProc("RegSetValueExW")
	procRegDeleteTreeW   = advapi32.NewProc("RegDeleteTreeW")
	procRegCloseKey      = advapi32.NewProc("RegCloseKey")
	procShellExecuteW    = shell32.NewProc("ShellExecuteW")

	extensionIDPattern = regexp.MustCompile(`^[a-p]{32}$`)

	wndProcCallback uintptr
	mainWindow      uintptr
	extensionEdit   uintptr
	idList          uintptr
	statusStatic    uintptr
)

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

type point struct {
	X int32
	Y int32
}

type msg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
}

type nativeManifest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Path           string   `json:"path"`
	Type           string   `json:"type"`
	AllowedOrigins []string `json:"allowed_origins"`
}

type installerState struct {
	IDs      []string `json:"extension_ids,omitempty"`
	ChromeID string   `json:"chrome_id,omitempty"`
	EdgeID   string   `json:"edge_id,omitempty"`
}

func main() {
	if err := runGUI(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
	}
}

func runGUI() error {
	hInstance, _, _ := procGetModuleHandleW.Call(0)
	className := utf16Ptr("DMMPWindowOpacityInstaller")
	cursor, _, _ := procLoadCursorW.Call(0, uintptr(32512))
	wndProcCallback = syscall.NewCallback(wndProc)
	wndClass := wndClassEx{
		Size:      uint32(unsafe.Sizeof(wndClassEx{})),
		WndProc:   wndProcCallback,
		Instance:  hInstance,
		Cursor:    cursor,
		ClassName: className,
	}
	if ret, _, err := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wndClass))); ret == 0 {
		return err
	}

	mainWindow, _, _ = procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16Ptr("dmMiniPlayer 原生透明安装器"))),
		wsOverlappedWindow|wsVisible,
		cwUseDefault,
		cwUseDefault,
		720,
		470,
		0,
		0,
		hInstance,
		0,
	)
	if mainWindow == 0 {
		return fmt.Errorf("create window failed")
	}

	var m msg
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(ret) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
	return nil
}

func wndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case wmCreate:
		createControls(hwnd)
		return 0
	case wmCommand:
		switch loword(wParam) {
		case addIDButtonID:
			addIDFromGUI()
		case removeIDButtonID:
			removeIDFromGUI()
		case installButtonID:
			installFromGUI()
		case openFolderButton:
			openBuildFolder()
		case openSelectedDirID:
			openSelectedExtensionDir()
		case uninstallButtonID:
			uninstallFromGUI()
		}
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	ret, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return ret
}

func createControls(hwnd uintptr) {
	createControl("STATIC", "扩展 ID（每次添加一个，来自 chrome://extensions 或 edge://extensions）：", wsChild|wsVisible|ssLeft, 18, 18, 620, 24, hwnd, 0)
	extensionEdit = createControl("EDIT", "", wsChild|wsVisible|wsTabStop|esAutoHScroll, 18, 46, 500, 26, hwnd, extIDEditID)
	createControl("BUTTON", "添加 ID", wsChild|wsVisible|wsTabStop|bsDefPushButton, 530, 44, 110, 30, hwnd, addIDButtonID)
	idList = createControl("LISTBOX", "", wsChild|wsVisible|wsTabStop, 18, 82, 500, 130, hwnd, idListID)
	createControl("BUTTON", "删除选中 ID", wsChild|wsVisible|wsTabStop, 530, 82, 110, 30, hwnd, removeIDButtonID)
	createControl("BUTTON", "应用 ID 列表", wsChild|wsVisible|wsTabStop|bsDefPushButton, 18, 228, 140, 32, hwnd, installButtonID)
	createControl("BUTTON", "卸载全部注册", wsChild|wsVisible|wsTabStop, 168, 228, 140, 32, hwnd, uninstallButtonID)
	createControl("BUTTON", "打开工具目录", wsChild|wsVisible|wsTabStop, 318, 228, 150, 32, hwnd, openFolderButton)
	createControl("BUTTON", "打开所选 ID 目录", wsChild|wsVisible|wsTabStop, 478, 228, 162, 32, hwnd, openSelectedDirID)
	statusStatic = createControl("STATIC", "正在读取安装状态……", wsChild|wsVisible|ssLeft, 18, 278, 620, 150, hwnd, statusStaticID)
	refreshStatus()
}

func createControl(className, text string, style uintptr, x, y, w, h int, parent uintptr, id uintptr) uintptr {
	handle, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(utf16Ptr(className))),
		uintptr(unsafe.Pointer(utf16Ptr(text))),
		style,
		uintptr(x),
		uintptr(y),
		uintptr(w),
		uintptr(h),
		parent,
		id,
		0,
		0,
	)
	return handle
}

func installFromGUI() {
	ids := getIDsFromList()
	if len(ids) == 0 {
		setStatus("列表为空，正在移除全部 Native Host 注册……")
		go func() {
			if err := uninstallNativeHost([]string{"Chrome", "Edge"}); err != nil {
				setStatus("移除失败：" + err.Error())
				return
			}
			setStatus("ID 列表已清空，Chrome/Edge Native Host 注册已移除。")
		}()
		return
	}

	setStatus("安装中，请稍等……")
	go func() {
		if err := installNativeHost(ids); err != nil {
			setStatus("安装失败：" + err.Error())
			return
		}
		setStatus("ID 列表已应用；同一 Host 已注册给 Chrome 与 Edge。请重启浏览器后启用原生窗口透明。\n\n" + installedStatus())
	}()
}

func installNativeHost(ids []string) error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	baseDir := filepath.Dir(exePath)
	hostExe := filepath.Join(baseDir, "dmmp-window-opacity-host.exe")
	if _, err := os.Stat(hostExe); err != nil {
		return fmt.Errorf("找不到 %s，请先运行 build-native-opacity-tools.ps1", hostExe)
	}

	manifestPath := filepath.Join(baseDir, hostName+".json")
	state := loadInstallerState(baseDir)
	state.IDs = ids
	state.ChromeID, state.EdgeID = "", ""
	allowed := []string{}
	for _, id := range ids {
		allowed = append(allowed, "chrome-extension://"+id+"/")
	}
	manifest := nativeManifest{
		Name:           hostName,
		Description:    "dmMiniPlayer Windows PiP native opacity host",
		Path:           hostExe,
		Type:           "stdio",
		AllowedOrigins: allowed,
	}
	body, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(manifestPath, body, 0644); err != nil {
		return err
	}

	for _, target := range []string{"Chrome", "Edge"} {
		var key string
		switch target {
		case "Chrome":
			key = `Software\Google\Chrome\NativeMessagingHosts\` + hostName
		case "Edge":
			key = `Software\Microsoft\Edge\NativeMessagingHosts\` + hostName
		}
		if err := setRegistryDefaultValue(key, manifestPath); err != nil {
			return fmt.Errorf("%s registry: %w", target, err)
		}
	}
	if err := saveInstallerState(baseDir, state); err != nil {
		return err
	}
	return nil
}

func uninstallFromGUI() {
	setStatus("卸载中，请稍等……")
	go func() {
		if err := uninstallNativeHost([]string{"Chrome", "Edge"}); err != nil {
			setStatus("卸载失败：" + err.Error())
			return
		}
		setStatus("卸载完成。已移除 Chrome/Edge 注册与 ID 列表；请重启浏览器。")
	}()
}

func uninstallNativeHost(targets []string) error {
	exePath, _ := os.Executable()
	baseDir := filepath.Dir(exePath)
	state := loadInstallerState(baseDir)
	state.IDs = nil
	for _, target := range targets {
		var key string
		switch target {
		case "Chrome":
			key = `Software\Google\Chrome\NativeMessagingHosts\` + hostName
		case "Edge":
			key = `Software\Microsoft\Edge\NativeMessagingHosts\` + hostName
		}
		ret, _, err := procRegDeleteTreeW.Call(
			hkeyCurrentUser,
			uintptr(unsafe.Pointer(utf16Ptr(key))),
		)
		if ret != 0 && ret != errorFileNotFound {
			return fmt.Errorf("%s registry: %w", target, err)
		}
		if target == "Chrome" {
			state.ChromeID = ""
		} else if target == "Edge" {
			state.EdgeID = ""
		}
	}

	if len(targets) == 2 {
		manifestPath := filepath.Join(baseDir, hostName+".json")
		if removeErr := os.Remove(manifestPath); removeErr != nil && !os.IsNotExist(removeErr) {
			return removeErr
		}
	}
	if err := saveInstallerState(baseDir, state); err != nil {
		return err
	}
	return nil
}

func setRegistryDefaultValue(subkey, value string) error {
	var key uintptr
	ret, _, err := procRegCreateKeyExW.Call(
		hkeyCurrentUser,
		uintptr(unsafe.Pointer(utf16Ptr(subkey))),
		0,
		0,
		0,
		keySetValue,
		0,
		uintptr(unsafe.Pointer(&key)),
		0,
	)
	if ret != 0 {
		return err
	}
	defer procRegCloseKey.Call(key)

	data := syscall.StringToUTF16(value)
	ret, _, err = procRegSetValueExW.Call(
		key,
		0,
		0,
		regSZ,
		uintptr(unsafe.Pointer(&data[0])),
		uintptr(len(data)*2),
	)
	if ret != 0 {
		return err
	}
	return nil
}

func openBuildFolder() {
	exePath, err := os.Executable()
	if err != nil {
		setStatus(err.Error())
		return
	}
	dir := filepath.Dir(exePath)
	procShellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(utf16Ptr("open"))),
		uintptr(unsafe.Pointer(utf16Ptr(dir))),
		0,
		0,
		swShow,
	)
}

func statePath(baseDir string) string {
	return filepath.Join(baseDir, "dmmp-window-opacity-install-state.json")
}

func loadInstallerState(baseDir string) installerState {
	var state installerState
	body, err := os.ReadFile(statePath(baseDir))
	if err == nil {
		_ = json.Unmarshal(body, &state)
	}
	if len(state.IDs) == 0 {
		for _, id := range []string{state.ChromeID, state.EdgeID} {
			if extensionIDPattern.MatchString(id) {
				state.IDs = append(state.IDs, id)
			}
		}
	}
	seen := map[string]bool{}
	unique := []string{}
	for _, id := range state.IDs {
		if extensionIDPattern.MatchString(id) && !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	state.IDs = unique
	return state
}

func saveInstallerState(baseDir string, state installerState) error {
	body, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(statePath(baseDir), body, 0644)
}

func registryKey(browser string) string {
	if browser == "Chrome" {
		return `HKCU\Software\Google\Chrome\NativeMessagingHosts\` + hostName
	}
	return `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\` + hostName
}

func isBrowserRegistered(browser string) bool {
	var key uintptr
	ret, _, _ := procRegOpenKeyExW.Call(
		hkeyCurrentUser,
		uintptr(unsafe.Pointer(utf16Ptr(strings.TrimPrefix(registryKey(browser), `HKCU\`)))),
		0,
		keyRead,
		uintptr(unsafe.Pointer(&key)),
	)
	if ret != 0 {
		return false
	}
	procRegCloseKey.Call(key)
	return true
}

func refreshStatus() {
	exePath, err := os.Executable()
	if err != nil {
		setStatus("读取安装状态失败：" + err.Error())
		return
	}
	state := loadInstallerState(filepath.Dir(exePath))
	for _, id := range state.IDs {
		addIDToList(id)
	}
	setStatus(installedStatus())
}

func installedStatus() string {
	exePath, err := os.Executable()
	if err != nil {
		return "无法读取安装器位置：" + err.Error()
	}
	baseDir := filepath.Dir(exePath)
	state := loadInstallerState(baseDir)
	return "当前安装状态：\nChrome：" + registrationLabel("Chrome") + "\nEdge：" + registrationLabel("Edge") + "\n已允许的扩展 ID：" + strings.Join(state.IDs, ", ") + "\n\nHost 用途：接收扩展的 Native Messaging 指令，通过 Windows API 控制 PiP 顶层窗口的位置、透明度和鼠标穿透。\n浏览器只允许 manifest 的 allowed_origins 中列出的扩展 ID 连接。"
}

func registrationLabel(browser string) string {
	if isBrowserRegistered(browser) {
		return "已注册"
	}
	return "未注册"
}

func openSelectedExtensionDir() {
	id := getSelectedID()
	if !extensionIDPattern.MatchString(id) {
		setStatus("请先在列表中选择合法扩展 ID。")
		return
	}
	localAppData := os.Getenv("LOCALAPPDATA")
	for _, rel := range []string{filepath.Join("Google", "Chrome", "User Data"), filepath.Join("Microsoft", "Edge", "User Data")} {
		userDataDir := filepath.Join(localAppData, rel)
		profiles, _ := os.ReadDir(userDataDir)
		for _, profile := range profiles {
			if !profile.IsDir() {
				continue
			}
			candidate := filepath.Join(userDataDir, profile.Name(), "Extensions", id)
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				shellOpen(candidate)
				setStatus("已打开扩展目录：\n" + candidate)
				return
			}
		}
	}
	setStatus("未找到该 ID 的已安装目录。unpacked 扩展不会被浏览器复制到 Extensions；请使用「打开工具目录」。")
}

func shellOpen(path string) {
	procShellExecuteW.Call(0, uintptr(unsafe.Pointer(utf16Ptr("open"))), uintptr(unsafe.Pointer(utf16Ptr(path))), 0, 0, swShow)
}

func addIDFromGUI() {
	id := strings.ToLower(strings.TrimSpace(getWindowText(extensionEdit)))
	if !extensionIDPattern.MatchString(id) {
		setStatus("扩展 ID 不合法：必须是 32 位 a-p 字母。")
		return
	}
	for _, existing := range getIDsFromList() {
		if existing == id {
			setStatus("该扩展 ID 已在列表中。")
			return
		}
	}
	addIDToList(id)
	procSetWindowTextW.Call(extensionEdit, uintptr(unsafe.Pointer(utf16Ptr(""))))
	setStatus("已添加 ID。点击「应用 ID 列表」写入 manifest 并注册 Chrome/Edge。")
}

func addIDToList(id string) {
	procSendMessageW.Call(idList, lbAddString, 0, uintptr(unsafe.Pointer(utf16Ptr(id))))
}

func removeIDFromGUI() {
	ret, _, _ := procSendMessageW.Call(idList, lbGetCurSel, 0, 0)
	if ret == ^uintptr(0) {
		setStatus("请先选择要删除的扩展 ID。")
		return
	}
	procSendMessageW.Call(idList, lbDeleteString, ret, 0)
	setStatus("已从待应用列表删除。点击「应用 ID 列表」更新 manifest。")
}

func getIDsFromList() []string {
	count, _, _ := procSendMessageW.Call(idList, lbGetCount, 0, 0)
	ids := []string{}
	for i := uintptr(0); i < count; i++ {
		var buf [64]uint16
		procSendMessageW.Call(idList, lbGetText, i, uintptr(unsafe.Pointer(&buf[0])))
		id := strings.TrimSpace(syscall.UTF16ToString(buf[:]))
		if extensionIDPattern.MatchString(id) {
			ids = append(ids, id)
		}
	}
	return ids
}

func getSelectedID() string {
	ret, _, _ := procSendMessageW.Call(idList, lbGetCurSel, 0, 0)
	if ret == ^uintptr(0) {
		return ""
	}
	var buf [64]uint16
	procSendMessageW.Call(idList, lbGetText, ret, uintptr(unsafe.Pointer(&buf[0])))
	return strings.TrimSpace(syscall.UTF16ToString(buf[:]))
}

func getWindowText(hwnd uintptr) string {
	var buf [512]uint16
	procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return syscall.UTF16ToString(buf[:])
}

func setStatus(text string) {
	procSetWindowTextW.Call(statusStatic, uintptr(unsafe.Pointer(utf16Ptr(text))))
}

func isChecked(hwnd uintptr) bool {
	ret, _, _ := procSendMessageW.Call(hwnd, bmGetCheck, 0, 0)
	return ret == bstChecked
}

func loword(value uintptr) uintptr {
	return value & 0xffff
}

func utf16Ptr(value string) *uint16 {
	ptr, _ := syscall.UTF16PtrFromString(value)
	return ptr
}
