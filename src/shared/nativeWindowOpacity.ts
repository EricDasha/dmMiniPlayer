export const NATIVE_WINDOW_OPACITY_HOST = 'com.dmminiplayer.window_opacity'

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
}
