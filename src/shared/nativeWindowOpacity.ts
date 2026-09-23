export const NATIVE_WINDOW_OPACITY_HOST = 'com.dmminiplayer.window_opacity'
export const NATIVE_WINDOW_HOST_INSTALL_GUIDE =
  'https://github.com/EricDasha/dmMiniPlayer/blob/happy/aggressive-window-transparency/docs/native-window-opacity.md'

// docPIP 窗口独占标题标记：native host 靠它精确识别画中画窗口，
// 浏览器主窗口/标签页不会带这个标记，从根上杜绝透明度误伤浏览器
export const NATIVE_WINDOW_TITLE_MARKER = 'dmMiniPlayer-PIP'

export type NativeWindowBounds = {
  left: number
  top: number
  width: number
  height: number
}

export type NativeWindowOpacityTarget = {
  title: string
  titles?: string[]
  bounds: NativeWindowBounds
}

export type NativeWindowOpacityPayload = NativeWindowOpacityTarget & {
  opacity: number
  smoothMs?: number
}

export type NativeWindowMousePassthroughPayload = NativeWindowOpacityTarget & {
  enabled: boolean
}

export type NativeWindowPositionPayload = NativeWindowOpacityTarget & {
  left: number
  top: number
  smoothMs?: number
}

export type NativeWindowOpacityHostMessage =
  | { command: 'ping' }
  | { command: 'getCursorPosition' }
  | { command: 'uninstall' }
  | ({ command: 'setOpacity' } & NativeWindowOpacityPayload)
  | ({ command: 'setMousePassthrough' } & NativeWindowMousePassthroughPayload)
  | ({ command: 'setPosition' } & NativeWindowPositionPayload)
  | ({ command: 'reset' } & NativeWindowOpacityTarget)

export type NativeWindowOpacityHostResponse = {
  ok: boolean
  error?: string
  hwnd?: string
  title?: string
  alpha?: number
  passthrough?: boolean
  uninstalled?: boolean
  cursorX?: number
  cursorY?: number
  version?: string
  /** host 枚举到的可见窗口数 / 其中标题精确命中 marker 的个数（not found 时回传） */
  enumerated?: number
  titleMatches?: number
}
