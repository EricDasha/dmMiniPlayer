import WebextEvent from '@root/shared/webextEvent'
import {
  NATIVE_WINDOW_OPACITY_HOST,
  type NativeWindowOpacityHostMessage,
  type NativeWindowOpacityHostResponse,
} from '@root/shared/nativeWindowOpacity'
import {
  mv3GetDocPIPTab,
  mv3MoveTabsToPosition,
  mv3ResizeTabs,
  mv3UpdateTab,
  setDocPIPTabId,
} from '@root/utils/mv3'
import { onMessage } from 'webext-bridge/background'

let nativeWindowOpacityAvailable: boolean | undefined
let persistentNativePort: chrome.runtime.Port | undefined
type PersistentNativeRequest = {
  message: NativeWindowOpacityHostMessage
  resolve: (value: NativeWindowOpacityHostResponse | null) => void
  timeout?: ReturnType<typeof setTimeout>
}
let activePersistentNativeRequest: PersistentNativeRequest | undefined
const persistentNativeQueue: PersistentNativeRequest[] = []

const failPersistentNativeRequests = () => {
  if (activePersistentNativeRequest?.timeout) {
    clearTimeout(activePersistentNativeRequest.timeout)
  }
  activePersistentNativeRequest?.resolve(null)
  activePersistentNativeRequest = undefined
  persistentNativeQueue.splice(0).forEach(({ resolve }) => resolve(null))
}

const disconnectPersistentNativePort = () => {
  failPersistentNativeRequests()
  const port = persistentNativePort
  persistentNativePort = undefined
  try {
    port?.disconnect()
  } catch (error) {}
}

const pumpPersistentNativeQueue = () => {
  if (activePersistentNativeRequest || !persistentNativeQueue.length) return
  const port = persistentNativePort
  if (!port) {
    failPersistentNativeRequests()
    return
  }

  const request = persistentNativeQueue.shift()!
  activePersistentNativeRequest = request
  request.timeout = setTimeout(() => {
    if (activePersistentNativeRequest !== request) return
    disconnectPersistentNativePort()
  }, 1500)
  port.postMessage(request.message)
}

const ensurePersistentNativePort = () => {
  if (persistentNativePort) return persistentNativePort
  const port = chrome.runtime.connectNative(NATIVE_WINDOW_OPACITY_HOST)
  persistentNativePort = port
  port.onMessage.addListener((response: NativeWindowOpacityHostResponse) => {
    const request = activePersistentNativeRequest
    if (!request) return
    if (request.timeout) clearTimeout(request.timeout)
    activePersistentNativeRequest = undefined
    request.resolve(response)
    pumpPersistentNativeQueue()
  })
  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError?.message) {
      nativeWindowOpacityAvailable = false
    }
    if (persistentNativePort === port) persistentNativePort = undefined
    failPersistentNativeRequests()
  })
  return port
}

const sendPersistentNativeMessage = async (
  message: NativeWindowOpacityHostMessage,
) => {
  if (!(await probeNativeWindowOpacity())) return null
  return new Promise<NativeWindowOpacityHostResponse | null>((resolve) => {
    try {
      ensurePersistentNativePort()
      persistentNativeQueue.push({ message, resolve })
      pumpPersistentNativeQueue()
    } catch (error) {
      disconnectPersistentNativePort()
      resolve(null)
    }
  })
}

const getNativeCursorPosition = async () => {
  const response = await sendPersistentNativeMessage({
    command: 'getCursorPosition',
  })
  if (
    !response?.ok ||
    response.cursorX === undefined ||
    response.cursorY === undefined
  ) {
    return null
  }
  return { x: response.cursorX, y: response.cursorY }
}

const sendNativeWindowOpacityMessage = (
  message: NativeWindowOpacityHostMessage,
) => {
  return new Promise<NativeWindowOpacityHostResponse>((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(
        NATIVE_WINDOW_OPACITY_HOST,
        message,
        (response?: NativeWindowOpacityHostResponse) => {
          const error = chrome.runtime.lastError?.message
          if (error) {
            nativeWindowOpacityAvailable = false
            resolve({ ok: false, error })
            return
          }

          resolve(response ?? { ok: false, error: 'empty native response' })
        },
      )
    } catch (error) {
      nativeWindowOpacityAvailable = false
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

const probeNativeWindowOpacity = async (force = false) => {
  if (force) nativeWindowOpacityAvailable = undefined
  if (nativeWindowOpacityAvailable !== undefined) {
    return nativeWindowOpacityAvailable
  }

  const response = await sendNativeWindowOpacityMessage({ command: 'ping' })
  nativeWindowOpacityAvailable = !!response.ok
  return nativeWindowOpacityAvailable
}

onMessage(WebextEvent.beforeStartPIP, async () => {
  // 通过将比较新旧的tab，找到docPIPTabId
  const tabs = (await chrome.tabs.query({ active: true })).filter(
    (v) => !v.favIconUrl,
  )
  let unListen = onMessage(WebextEvent.afterStartPIP, async ({ data }) => {
    const width = data.width
    const newTabs = (await chrome.tabs.query({ active: true })).filter(
      (v) => !v.favIconUrl,
    )

    const maybeDocPIPTabs = newTabs.filter((newTab) => {
      return tabs.every((tab) => newTab.id !== tab.id)
    })

    unListen()

    // width是保底出现2个及以上的tab的情况
    if (maybeDocPIPTabs.length > 1) {
      const sensitive = 3
      const tarTab = maybeDocPIPTabs.find(
        (tab) =>
          (tab.width ?? 0) + sensitive >= width &&
          (tab.width ?? 0) <= width + sensitive,
      )
      if (tarTab) {
        return setDocPIPTabId(tarTab.id)
      }
      // 还是找不到的情况？
      console.log('tabs', tabs, 'newTabs', newTabs)
      throw Error('有多个tab，但找不到docTab')
    }
    if (maybeDocPIPTabs[0]) {
      return setDocPIPTabId(maybeDocPIPTabs[0].id)
    }

    console.log('tabs', tabs, 'newTabs', newTabs)
    throw Error('找不到docTab')
  })
})

onMessage(WebextEvent.moveDocPIPPos, async ({ data }) => {
  const docPIPTab = await mv3GetDocPIPTab(data.docPIPWidth)
  console.log('docPIPTab', docPIPTab)
  if (!docPIPTab) throw Error('Not find docPIP tab')
  await mv3MoveTabsToPosition(docPIPTab, [data.x, data.y])
})

onMessage(WebextEvent.resizeDocPIP, async ({ data }) => {
  const docPIPTab = await mv3GetDocPIPTab(data.docPIPWidth)
  if (!docPIPTab) throw Error('Not find docPIP tab')
  await mv3ResizeTabs(docPIPTab, { height: data.height, width: data.width })
})

onMessage(
  WebextEvent.updateDocPIPRect,
  async ({ data: { docPIPWidth, ...data } }) => {
    const docPIPTab = await mv3GetDocPIPTab(docPIPWidth)
    if (!docPIPTab) throw Error('Not find docPIP tab')
    await mv3UpdateTab(docPIPTab, data)
  },
)

onMessage(WebextEvent.probeNativeWindowOpacity, async ({ data }) => {
  return probeNativeWindowOpacity(data?.force)
})

onMessage(WebextEvent.setNativeWindowOpacity, async ({ data }) => {
  if (!(await probeNativeWindowOpacity())) return false

  const response = await sendNativeWindowOpacityMessage({
    command: 'setOpacity',
    ...data,
  })
  if (response.ok) nativeWindowOpacityAvailable = true
  return !!response.ok
})

onMessage(WebextEvent.resetNativeWindowOpacity, async ({ data }) => {
  if (!(await probeNativeWindowOpacity())) return false

  const response = await sendNativeWindowOpacityMessage({
    command: 'reset',
    ...data,
  })
  if (response.ok) nativeWindowOpacityAvailable = true
  return !!response.ok
})

onMessage(WebextEvent.setNativeMousePassthrough, async ({ data }) => {
  if (!(await probeNativeWindowOpacity())) return false

  const response = await sendNativeWindowOpacityMessage({
    command: 'setMousePassthrough',
    ...data,
  })
  if (response.ok) nativeWindowOpacityAvailable = true
  return !!response.ok
})

onMessage(WebextEvent.getNativeCursorPosition, getNativeCursorPosition)

onMessage(WebextEvent.setNativeWindowPosition, async ({ data }) => {
  const response = await sendPersistentNativeMessage({
    command: 'setPosition',
    ...data,
  })
  return !!response?.ok
})

onMessage(WebextEvent.uninstallNativeWindowHost, async () => {
  if (!(await probeNativeWindowOpacity(true))) return false

  const response = await sendNativeWindowOpacityMessage({
    command: 'uninstall',
  })
  if (response.ok) nativeWindowOpacityAvailable = false
  return !!response.ok
})

onMessage(WebextEvent.closePIP, () => {
  disconnectPersistentNativePort()
  setDocPIPTabId(null)
})

onMessage(WebextEvent.keepAlive, () => {
  console.log('keepAlive')
})
