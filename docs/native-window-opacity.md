# Windows 原生窗口透明 / 鼠标穿透

`窗口不透明度` 和真鼠标穿透依赖 Windows native host。若要让桌面/其他应用真实透过 Document Picture-in-Picture 窗口，或让鼠标点击直接落到后方窗口，需要先安装 Windows native host。

## 安装

1. 在 `chrome://extensions/` 或 `edge://extensions/` 打开开发者模式，加载 `dist` 后复制扩展 ID。
2. 安装 Native Host。安装器不再把 ID 绑定到某个浏览器，而是维护一份“允许连接的扩展 ID 列表”。Chrome、Edge 或不同 Profile 产生的 ID 都可以添加到同一列表；两个浏览器共用一份 host。

GUI：

```powershell
.\scripts\build-native-opacity-tools.ps1
.\build\native\dmmp-window-opacity-installer.exe
```

在窗口里逐个粘贴扩展 ID并点击「添加 ID」，按需用「删除选中 ID」移除，再点击「应用 ID 列表」。安装器会把完整列表写入 `allowed_origins`，自动注册到 Chrome 和 Edge，并显示当前允许的全部 ID。选择列表项后可点击「打开所选 ID 目录」，安装器会在 Chrome 与 Edge 的各 Profile 中查找。

命令行：

```powershell
.\scripts\install-native-opacity-host.ps1 -ChromeExtensionId <扩展ID1> -EdgeExtensionId <扩展ID2> -Browser Both
```

命令行脚本保留旧参数兼容；GUI 安装器则统一按 ID 列表管理，不区分 ID 来源浏览器。

3. 重启浏览器。
4. 在扩展设置里开启 `启用原生窗口透明`。
5. 打开画中画，用侧栏现有 `窗口不透明度` 滑杆调整。
6. `鼠标穿透` 是一次性真穿透：开启后整个 PiP 窗口会被鼠标命中测试跳过；从任务栏重新激活 PiP 会自动解除穿透。

扩展设置中的 `Windows native host` 会显示当前连接状态。安装后可点击 `重新检测`，无需依赖缓存状态。

## 不安装的影响

- 视频播放和普通 PiP 仍可使用。
- 悬停收起依赖 native host 获取全局鼠标位置；缺失时该模式会自动关闭，避免窗口闪回。
- `窗口不透明度` 无法改变整个 Windows PiP 顶层窗口，只能保留扩展内容层的视觉效果。
- `鼠标穿透` 只能跳过扩展内部元素，点击无法真正落到 PiP 下方的桌面或其他应用。

首次打开 PiP 时会检测 native host；未安装会显示说明，可选择稍后提醒或不再提醒。

## Host 是做什么的，原理是什么

浏览器扩展运行在沙箱内，不能直接调用 Windows `SetWindowPos`、`SetLayeredWindowAttributes` 或修改顶层窗口扩展样式。Native Host 是一个 Windows `.exe`，浏览器通过 Native Messaging 以 `stdio` 启动它：每条消息先发送 4 字节 little-endian 长度，再发送 JSON 请求；Host 执行 Windows API 后用相同帧格式返回 JSON。

安装器完成两件事：

1. 将 `com.dmminiplayer.window_opacity.json` 写入工具目录，声明 host 可执行文件路径和 `allowed_origins`（任意数量的有效扩展 ID 都可列在这里）。
2. 在当前用户注册表写入 Chrome 与 Edge 各自的 `NativeMessagingHosts\com.dmminiplayer.window_opacity` 默认值，指向同一个 manifest。

扩展发出 `setOpacity`、`setMousePassthrough`、`setPosition` 等请求后，Host 枚举可见窗口并按标题/边界匹配 PiP 顶层窗口，再调用 Win32 API 修改透明度、位置或 `WS_EX_TRANSPARENT`。关闭 PiP 或执行 reset 时恢复透明度和鼠标命中行为。

## 卸载

二选一：

1. 在扩展设置的 `Windows native host` 中点击 `卸载 native host`。这会移除 Chrome/Edge 注册项和 manifest；重启浏览器后生效，工具目录可手动删除。
2. 重新运行 `dmmp-window-opacity-installer.exe`，点击“卸载全部注册”。

> 安装完成后不能直接删除 `dmmp-window-opacity-host.exe` 或 manifest。浏览器每次使用原生窗口功能时仍会从 manifest 指定的路径启动 Host。若要清理文件，请先在新版安装器中点击“卸载全部注册”，重启浏览器，再删除整个 `native` 目录。

## 行为

- 仅 Windows 生效。
- native host 不可用时不会改变整个 Windows 窗口透明度；鼠标穿透会退回扩展内 CSS 行为，无法点击到下方应用。
- 关闭 PiP 时会把目标窗口透明度恢复为 100%，并解除 native 鼠标穿透。
- 真鼠标穿透只修改顶层 PiP 窗口，不修改 Chromium 子窗口，避免白屏/渲染丢失。
