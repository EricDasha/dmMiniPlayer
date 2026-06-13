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

	extIDEditID      = 1001
	chromeCheckID    = 1002
	edgeCheckID      = 1003
	installButtonID  = 1004
	statusStaticID   = 1005
	openFolderButton = 1006

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

	bmGetCheck = 0x00F0
	bmSetCheck = 0x00F1
	bstChecked = 1

	swShow = 5

	hkeyCurrentUser = 0x80000001
	keySetValue     = 0x0002
	regSZ           = 1
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
	procRegSetValueExW   = advapi32.NewProc("RegSetValueExW")
	procRegCloseKey      = advapi32.NewProc("RegCloseKey")
	procShellExecuteW    = shell32.NewProc("ShellExecuteW")

	extensionIDPattern = regexp.MustCompile(`^[a-p]{32}$`)

	wndProcCallback uintptr
	mainWindow      uintptr
	extensionEdit   uintptr
	chromeCheck     uintptr
	edgeCheck       uintptr
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
		560,
		260,
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
		case installButtonID:
			installFromGUI()
		case openFolderButton:
			openBuildFolder()
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
	createControl("STATIC", "扩展 ID：", wsChild|wsVisible|ssLeft, 18, 22, 80, 24, hwnd, 0)
	extensionEdit = createControl("EDIT", "", wsChild|wsVisible|wsTabStop|esAutoHScroll, 98, 18, 420, 26, hwnd, extIDEditID)
	chromeCheck = createControl("BUTTON", "Chrome", wsChild|wsVisible|wsTabStop|bsAutoCheckbox, 98, 58, 120, 24, hwnd, chromeCheckID)
	edgeCheck = createControl("BUTTON", "Edge", wsChild|wsVisible|wsTabStop|bsAutoCheckbox, 230, 58, 120, 24, hwnd, edgeCheckID)
	procSendMessageW.Call(chromeCheck, bmSetCheck, bstChecked, 0)
	procSendMessageW.Call(edgeCheck, bmSetCheck, bstChecked, 0)
	createControl("BUTTON", "安装 / 更新", wsChild|wsVisible|wsTabStop|bsDefPushButton, 98, 96, 140, 32, hwnd, installButtonID)
	createControl("BUTTON", "打开工具目录", wsChild|wsVisible|wsTabStop, 250, 96, 140, 32, hwnd, openFolderButton)
	statusStatic = createControl("STATIC", "先在 chrome://extensions/ 复制 unpacked 扩展 ID。", wsChild|wsVisible|ssLeft, 18, 148, 500, 64, hwnd, statusStaticID)
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
	extensionID := strings.TrimSpace(getWindowText(extensionEdit))
	if !extensionIDPattern.MatchString(extensionID) {
		setStatus("扩展 ID 不合法。它应是 32 位 a-p 字母串。")
		return
	}

	targets := []string{}
	if isChecked(chromeCheck) {
		targets = append(targets, "Chrome")
	}
	if isChecked(edgeCheck) {
		targets = append(targets, "Edge")
	}
	if len(targets) == 0 {
		setStatus("至少选择 Chrome 或 Edge。")
		return
	}

	setStatus("安装中，请稍等……")
	go func() {
		if err := installNativeHost(extensionID, targets); err != nil {
			setStatus("安装失败：" + err.Error())
			return
		}
		setStatus("安装完成。重启浏览器，然后开启「启用原生窗口透明」。")
	}()
}

func installNativeHost(extensionID string, targets []string) error {
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
	manifest := nativeManifest{
		Name:           hostName,
		Description:    "dmMiniPlayer Windows PiP native opacity host",
		Path:           hostExe,
		Type:           "stdio",
		AllowedOrigins: []string{"chrome-extension://" + extensionID + "/"},
	}
	body, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(manifestPath, body, 0644); err != nil {
		return err
	}

	for _, target := range targets {
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
