# Windows 原生窗口透明

`窗口不透明度` 只走 Windows native host，不再使用 CSS 伪透明/虚化。若要让桌面/其他应用真实透过 Document Picture-in-Picture 窗口，需要先安装 Windows native host。

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

## 行为

- 仅 Windows 生效。
- native host 不可用时不会虚化，只是不改变窗口透明度。
- 关闭 PiP 时会把目标窗口透明度恢复为 100%。
