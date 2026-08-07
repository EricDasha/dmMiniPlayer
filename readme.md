# 弹幕画中画播放器
<div align="center">

[<img src="https://img.shields.io/chrome-web-store/v/nahbabjlllhocabmecfjmcblchhpoclj?label=chrome" />](https://chrome.google.com/webstore/detail/nahbabjlllhocabmecfjmcblchhpoclj)
[<img src="https://img.shields.io/badge/dynamic/json?label=edge&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fhohfhljppjpiemblilibldgppjpclfbl" />](https://microsoftedge.microsoft.com/addons/detail/hohfhljppjpiemblilibldgppjpclfbl)
[<img src="https://img.shields.io/github/v/release/EricDasha/dmMiniPlayer?color=green&label=fork%20release" />](https://github.com/EricDasha/dmMiniPlayer/releases/latest)

</div>

<p align="center" style="margin-bottom: 0px !important;">
<img width="800" src="./docs/assets/view.png"><br/>
</p>

支持最新的画中画API功能，可以播放、发送弹幕，支持字幕，键盘控制进度，更好的画中画播放体验的浏览器插件

> [!IMPORTANT]
> 这是 [`apades/dmMiniPlayer`](https://github.com/apades/dmMiniPlayer) 的功能增强 fork。当前分支增加了 Windows PiP 原生透明度、鼠标穿透、悬停自动吸附，以及可管理多个扩展 ID 的 Native Host 安装器。Fork 构建产物请从本仓库 [Releases](https://github.com/EricDasha/dmMiniPlayer/releases/latest) 下载；上游商店版本不一定包含这些功能。

- [chrome商店<img src="https://img.shields.io/chrome-web-store/v/nahbabjlllhocabmecfjmcblchhpoclj?label=chrome" />](https://chrome.google.com/webstore/detail/nahbabjlllhocabmecfjmcblchhpoclj)
- [edge商店<img src="https://img.shields.io/badge/dynamic/json?label=edge&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fhohfhljppjpiemblilibldgppjpclfbl" /> 更新比较慢，如果有什么紧急bug修复一般都要一周后才能上架](https://microsoftedge.microsoft.com/addons/detail/hohfhljppjpiemblilibldgppjpclfbl)
- [Fork 最新发布<img src="https://img.shields.io/github/v/release/EricDasha/dmMiniPlayer?color=green" />](https://github.com/EricDasha/dmMiniPlayer/releases/latest)

在提问前可以先搜索 issue 是否有类似的问题，或查看[上游 FAQ](https://github.com/apades/dmMiniPlayer/wiki/FAQ%E2%80%90zh)。

Fork 新功能的问题与建议请提交到 [EricDasha/dmMiniPlayer issues](https://github.com/EricDasha/dmMiniPlayer/issues)；上游通用问题可前往 [apades/dmMiniPlayer issues](https://github.com/apades/dmMiniPlayer/issues)。

## Fork Release 自动构建

推送以 `package.json` 版本开头的 SemVer tag 后，GitHub Actions 会自动构建并发布 Release。Fork 增量版可使用 `-native.YYYYMMDD.N` 后缀：

```bash
git tag v0.6.61-native.20260807.1
git push fork v0.6.61-native.20260807.1
```

每个 Release 包含：

- `chrome-mv3-prod-<version>.zip`：Chrome/Edge MV3 扩展包。
- `dmMiniPlayer-native-windows-v<version>.zip`：Windows Native Host、GUI 安装器及说明文档。
- `SHA256SUMS.txt`：Release 产物的 SHA-256 校验值。

也可在 GitHub Actions 的 `Build and release` workflow 中手动输入一个已存在的 tag 重新构建。为避免源码与版本错配，workflow 会拒绝发布不以 `package.json` 版本开头的 tag。

## 🚀 功能
- 拖拽或者键盘控制画中画窗口的进度条、音量、播放速率等
- 弹幕播放和发送
  - bilibili视频 + 直播
  - 斗鱼直播
  - 动画疯
  - 虎牙直播 *
  - youtube直播 *
  - twitch直播 *
  - 抖音直播 *
- 针对 bilibili、Youtube、Netflix 的特殊功能支持
  - 视频播放侧边栏，可直接在画中画里切换播放列表、推荐视频
  - 网站的字幕列表
  - 进度条的预览功能(Netflix暂不支持)
- 支持外挂.xml .ass弹幕文件，下载可以使用[Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved)或[ACG助手](https://chromewebstore.google.com/detail/kpbnombpnpcffllnianjibmpadjolanh)，也可以通过输入bilibili url的下载弹幕并播放
- 字幕功能
  - 支持.srt .ass外挂功能
  - 字幕翻译 + 双语功能
- 长按右键倍速，逐帧快进快退，截屏等功能 + 可自定快捷键
- 将网页视频播放器替换为扩展程序的视频播放器
- 支持绝大多数 https 网站，甚至支持类似Crunchyroll的[EME](https://web.dev/articles/media-eme)版权保护视频、Youtube 嵌入视频。

> [!NOTE]
> *标记为目前只有监听网页弹幕DOM模式，可能会有意料之外的问题

## How to Dev
### env
- pnpm >=10.0.0
- node >=24.11.0

> [!WARNING]
> If you are using Windows, please make sure you have Unix utils in your env (rm sh etc.)
> 
> Or use WSL, or download [cmder](https://cmder.app/)

### dev
```bash
pnpm i
pnpm run dev
```
Drag `dist` folder and drop to `chrome://extensions/` page in Chrome (Open development mode before)

## 📚 主要实现方法
### 旧版本PIP
用一个单独canvas画video + 弹幕，再把canvas的stream附加到一个单独的video上，最后开启画中画功能

### 新版本docPIP
使用了[documentPictureInPicture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture/)该API，关于[技术细节在这](https://github.com/apades/dmMiniPlayer/wiki/tech%E2%80%90zh)

> [!NOTE]
> 该API是[非w3c草案功能](https://wicg.github.io/document-picture-in-picture/)，从chrome 116开始已经强推到stable上了，[非chromium](https://caniuse.com/?search=document-picture-in-picture)目前还没看到能用的，所以其他内核浏览器不打算支持
> 
> 如果你是360 qq浏览器这种套壳Chromium的且没有该API，地址栏到`chrome://flags/#document-picture-in-picture-api`查看是否支持开启

> [!WARNING]
> 如果你使用edge打开有红色tab栏，建议升级到`126.0.2592.102`版本以上

## Windows Native Host（窗口透明 / 鼠标穿透 / 自动吸附）

Windows 原生窗口功能由 `dmmp-window-opacity-host.exe` 提供。它不是普通工具，而是由 Chrome/Edge 通过 Native Messaging 按需启动的后台 Host，用于调用 Windows API 控制 PiP 顶层窗口的位置、透明度和鼠标穿透。

安装器与 Host 必须放在同一个 `native` 目录中，不能只保留其中一个：

```text
native/
├─ dmmp-window-opacity-installer.exe  # 管理扩展 ID、注册表和 manifest
├─ dmmp-window-opacity-host.exe       # 浏览器按需启动的窗口控制引擎
└─ com.dmminiplayer.window_opacity.json
```

安装完成后不要删除 `dmmp-window-opacity-host.exe` 或同目录的 manifest；扩展启用原生窗口透明、鼠标穿透或自动吸附时仍需它们。若要删除，应先在安装器中点击“卸载全部注册”，重启浏览器后再删除整个 `native` 目录。

安装器维护的是“允许连接的扩展 ID 列表”，不区分 Chrome 或 Edge。扩展 ID 可在 `chrome://extensions` 或 `edge://extensions` 的开发者模式中复制，然后逐个添加并点击“应用 ID 列表”。

## Windows Native Host（窗口透明 / 鼠标穿透 / 自动吸附）

Windows 的 PiP 顶层窗口控制需要 Native Host。请使用构建产物中的安装器完成配置：

```text
dmMiniPlayer-local-build\native\dmmp-window-opacity-installer.exe
```

在安装器中逐个添加浏览器扩展 ID，点击“应用 ID 列表”。安装器会把 ID 写入 Native Messaging manifest，并同时注册 Chrome 与 Edge。不同浏览器、不同 Profile 或不同 unpacked 加载实例的 ID 都可以加入同一列表。

安装完成后的文件保留规则：

```text
dmmp-window-opacity-installer.exe    # 可删除；保留它便于以后添加/删除 ID、卸载和查看状态
dmmp-window-opacity-host.exe         # 必须保留，浏览器运行扩展功能时会自动启动
com.dmminiplayer.window_opacity.json # 必须保留，浏览器用它查找 Host 并校验允许的 ID
```

其中 `installer.exe` 配置完成后可以关闭甚至删除；只有需要修改 ID 或卸载时才需要再次使用。`host.exe` 与 `.json` 不能删除或移动，删除或移动会导致扩展无法连接 Native Host，窗口透明、鼠标穿透和自动吸附失效。若安装器窗口显示“未响应”，请确认不是从压缩包内直接运行，并将整个 `native` 文件夹解压到可写目录后再启动；安装器启动时会异步读取状态，浏览器注册表查询超过 1.5 秒也会自动超时，不再阻塞界面。

详细原理与命令行安装方式见 [`docs/native-window-opacity.md`](./docs/native-window-opacity.md)。


## 💖 引用代码
非常感谢这些项目的开源，让我抄了不少代码节省了很多时间

- [bilibili-evaolved](https://github.com/the1812/Bilibili-Evolved)
- [douyu-monitor](https://github.com/qianjiachun/douyu-monitor)
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)
- [rc-slider](http://github.com/react-component/slider)
- [js-cookie](https://github.com/js-cookie/js-cookie)
- [esbuild-plugin-inline-import](https://github.com/claviska/esbuild-plugin-inline-import)
- [tsup](https://github.com/egoist/tsup/blob/796fc5030f68f929fecde7c94732e9a586ba7508/src/esbuild/postcss.ts)
- [tailwindcss-container-queries](https://github.com/tailwindlabs/tailwindcss-container-queries)
- [ts-key-enum](https://www.npmjs.com/package/ts-key-enum)
- [@ironkinoko/danmaku](https://github.com/IronKinoko/danmaku)
- [netflix-subtitle-downloader](https://greasyfork.org/en/scripts/26654-netflix-subtitle-downloader)

## 🍔 投喂
如果您很喜欢这个项目, 欢迎打赏, 金额随意. 您的支持是我的动力(=・ω・=)

<img src="./docs/assets/donate.png" width="300">

> 🙏 thanks list
> 
> - 2025/3/4 我爱吃肉
> - 2025/6/9 zzzzz
> - 2025/7/2 真空
> - 2025/9/18 匿名用户

## 📜 License
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)
