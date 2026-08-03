# Windows 原生窗口透明 / 鼠标穿透

`窗口不透明度` 和真鼠标穿透依赖 Windows native host。若要让桌面/其他应用真实透过 Document Picture-in-Picture 窗口，或让鼠标点击直接落到后方窗口，需要先安装 Windows native host。

## 安装

1. 在 `chrome://extensions/` 或 `edge://extensions/` 打开开发者模式，加载 `dist` 后复制扩展 ID。
2. 二选一安装。

GUI：

```powershell
.\scripts\build-native-opacity-tools.ps1
.\build\native\dmmp-window-opacity-installer.exe
```

在窗口里粘贴扩展 ID，勾选 Chrome/Edge，点「安装 / 更新」。

命令行：

```powershell
.\scripts\install-native-opacity-host.ps1 -ExtensionId <扩展ID> -Browser Both
```

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

## 卸载

二选一：

1. 在扩展设置的 `Windows native host` 中点击 `卸载 native host`。这会移除 Chrome/Edge 注册项和 manifest；重启浏览器后生效，工具目录可手动删除。
2. 重新运行 `dmmp-window-opacity-installer.exe`，选择 Chrome/Edge 后点击 `卸载`。

## 行为

- 仅 Windows 生效。
- native host 不可用时不会改变整个 Windows 窗口透明度；鼠标穿透会退回扩展内 CSS 行为，无法点击到下方应用。
- 关闭 PiP 时会把目标窗口透明度恢复为 100%，并解除 native 鼠标穿透。
- 真鼠标穿透只修改顶层 PiP 窗口，不修改 Chromium 子窗口，避免白屏/渲染丢失。
