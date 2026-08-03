export const NATIVE_WINDOW_OPACITY_HOST = 'com.dmminiplayer.window_opacity'
export const NATIVE_WINDOW_HOST_INSTALL_GUIDE =
  'https://github.com/EricDasha/dmMiniPlayer/blob/happy/aggressive-window-transparency/docs/native-window-opacity.md'

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

export type NativeWindowOpacityHostMessage =
  | { command: 'ping' }
  | { command: 'uninstall' }
  | ({ command: 'setOpacity' } & NativeWindowOpacityPayload)
  | ({ command: 'setMousePassthrough' } & NativeWindowMousePassthroughPayload)
  | ({ command: 'reset' } & NativeWindowOpacityTarget)

export type NativeWindowOpacityHostResponse = {
  ok: boolean
  error?: string
  hwnd?: string
  title?: string
  alpha?: number
  passthrough?: boolean
  uninstalled?: boolean
}
