import { ProtocolWithReturn } from 'webext-bridge'
import { Props as DanmakuGetterProps } from '@pkgs/danmakuGetter/DanmakuGetter'
import WebextEvent from './shared/webextEvent'
import { DanmakuInitData } from './core/danmaku/DanmakuEngine'
import type {
  NativeWindowMousePassthroughPayload,
  NativeWindowOpacityPayload,
  NativeWindowOpacityTarget,
  NativeWindowPositionPayload,
} from './shared/nativeWindowOpacity'

declare module 'webext-bridge' {
  export interface ProtocolMap {
    [WebextEvent.hello]: ProtocolWithReturn<null, string>
    [WebextEvent.bgFetch]: ProtocolWithReturn<
      {
        url: string
        options?: RequestInit & {
          /**默认json */
          type?: 'json' | 'text' | 'blob'
        }
      },
      any
    >
    [WebextEvent.setGetDanmaku]: ProtocolWithReturn<
      DanmakuGetterProps,
      { id: string }
    >
    [WebextEvent.getDanmaku]: {
      data?: DanmakuInitData[]
      err?: string
      config?: { duration?: number }
    }
    [WebextEvent.stopGetDanmaku]: { id: string }
    [WebextEvent.needClickWebToOpenPIP]: void
    [WebextEvent.startTabCapture]: ProtocolWithReturn<
      null,
      { streamId?: string; error?: string }
    >
    [WebextEvent.getup]: ProtocolWithReturn<null, string>
    [WebextEvent.getTabCapturePermission]: ProtocolWithReturn<null, boolean>
    [WebextEvent.requestVideoPIP]: ProtocolWithReturn<
      null,
      | { state: 'ok' }
      | { state: 'error'; errType: 'no-video' | 'user-activation' }
      | { state: string; errType?: string }
    >
    [WebextEvent.openSetting]: void
    [WebextEvent.moveDocPIPPos]: { x: number; y: number; docPIPWidth: number }
    [WebextEvent.resizeDocPIP]: {
      width: number
      height: number
      docPIPWidth: number
    }
    [WebextEvent.updateDocPIPRect]: {
      docPIPWidth: number
    } & Partial<{ left: number; top: number; width: number; height: number }>
    [WebextEvent.probeNativeWindowOpacity]: ProtocolWithReturn<
      { force?: boolean } | null,
      boolean
    >
    [WebextEvent.setNativeWindowOpacity]: ProtocolWithReturn<
      NativeWindowOpacityPayload,
      boolean
    >
    [WebextEvent.resetNativeWindowOpacity]: ProtocolWithReturn<
      NativeWindowOpacityTarget,
      boolean
    >
    [WebextEvent.setNativeMousePassthrough]: ProtocolWithReturn<
      NativeWindowMousePassthroughPayload,
      boolean
    >
    [WebextEvent.getNativeCursorPosition]: ProtocolWithReturn<
      null,
      { x: number; y: number } | null
    >
    [WebextEvent.setNativeWindowPosition]: ProtocolWithReturn<
      NativeWindowPositionPayload,
      boolean
    >
    [WebextEvent.uninstallNativeWindowHost]: ProtocolWithReturn<null, boolean>

    [WebextEvent.afterStartPIP]: { width: number }

    [WebextEvent.reloadPage]: null
  }
}
