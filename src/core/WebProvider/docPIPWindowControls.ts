import WebextEvent from '@root/shared/webextEvent'
import configStore, { updateConfig } from '@root/store/config'
import { getDocPIPBorderSize } from '@root/utils/docPIP'
import { autorun, reaction } from 'mobx'
import { sendMessage } from 'webext-bridge/content-script'

const AUTO_DOCK_DELAY = 180
const AUTO_DOCK_VISIBLE_WIDTH = 40
const AUTO_DOCK_ANIMATION_MS = 190
const AUTO_DOCK_CURSOR_POLL_MS = 60
const ASPECT_RESIZE_DELAY = 80

type ScreenWithOffset = Screen & { availLeft?: number }

type AutoDockState = {
  phase: 'visible' | 'hiding' | 'hidden' | 'showing'
  left: number
  top: number
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

export const getNearestVerticalDockLeft = (
  screen: ScreenWithOffset,
  windowLeft: number,
  windowWidth: number,
) => {
  const screenLeft = screen.availLeft ?? 0
  const screenRight = screenLeft + screen.availWidth
  const windowCenter = windowLeft + windowWidth / 2
  const screenCenter = screenLeft + screen.availWidth / 2
  return windowCenter <= screenCenter
    ? screenLeft - windowWidth + AUTO_DOCK_VISIBLE_WIDTH
    : screenRight - AUTO_DOCK_VISIBLE_WIDTH
}

export const attachPIPWindowControls = (
  pipWindow: Window,
  onPositionSettled?: () => void,
) => {
  const autoDockState: AutoDockState = {
    phase: 'visible',
    left: pipWindow.screenLeft,
    top: pipWindow.screenTop,
  }
  let autoDockTimer: ReturnType<typeof setTimeout> | undefined
  let autoDockAnimationGeneration = 0
  let autoDockCursorTrackingGeneration = 0
  let pointerInsidePIP = false
  let aspectResizeTimer: ReturnType<typeof setTimeout> | undefined
  let aspectResizeInFlight = false
  let lockedAspectRatio = pipWindow.innerWidth / pipWindow.innerHeight
  let previousInnerWidth = pipWindow.innerWidth
  let previousInnerHeight = pipWindow.innerHeight

  const animateAutoDock = async (targetLeft: number, targetTop?: number) => {
    const generation = ++autoDockAnimationGeneration
    const title = pipWindow.document.title || document.title
    const moved = await sendMessage(WebextEvent.setNativeWindowPosition, {
      title,
      titles: [title, document.title].filter(
        (value, index, list) => value && list.indexOf(value) === index,
      ),
      bounds: {
        left: pipWindow.screenLeft,
        top: pipWindow.screenTop,
        width: pipWindow.outerWidth,
        height: pipWindow.outerHeight,
      },
      left: targetLeft,
      top: targetTop ?? pipWindow.screenTop,
      smoothMs: AUTO_DOCK_ANIMATION_MS,
    }).catch(() => false)
    if (!moved) {
      updateConfig({ autoDockPIP: false })
    }
    return generation
  }

  const restoreAutoDock = async () => {
    clearTimeout(autoDockTimer)
    autoDockCursorTrackingGeneration++
    if (autoDockState.phase === 'visible' || pipWindow.closed) return

    autoDockState.phase = 'showing'
    const generation = await animateAutoDock(
      autoDockState.left,
      autoDockState.top,
    )
    if (generation === autoDockAnimationGeneration) {
      autoDockState.phase = 'visible'
      onPositionSettled?.()
    }
  }

  const dockToNearestVerticalEdge = async () => {
    if (
      !configStore.autoDockPIP ||
      autoDockState.phase !== 'visible' ||
      pipWindow.closed
    ) {
      return
    }

    const initialCursor = await sendMessage(
      WebextEvent.getNativeCursorPosition,
      null,
    ).catch(() => null)
    if (
      !initialCursor ||
      !configStore.autoDockPIP ||
      autoDockState.phase !== 'visible'
    ) {
      if (!initialCursor) updateConfig({ autoDockPIP: false })
      return
    }

    autoDockState.left = pipWindow.screenLeft
    autoDockState.top = pipWindow.screenTop
    const originalBounds = {
      left: pipWindow.screenLeft,
      top: pipWindow.screenTop,
      right: pipWindow.screenLeft + pipWindow.outerWidth,
      bottom: pipWindow.screenTop + pipWindow.outerHeight,
    }
    const cursorStillInsidePIP =
      initialCursor.x >= originalBounds.left &&
      initialCursor.x < originalBounds.right &&
      initialCursor.y >= originalBounds.top &&
      initialCursor.y < originalBounds.bottom
    if (!cursorStillInsidePIP) return

    const left = getNearestVerticalDockLeft(
      pipWindow.screen as ScreenWithOffset,
      pipWindow.screenLeft,
      pipWindow.outerWidth,
    )

    autoDockState.phase = 'hiding'
    const generation = await animateAutoDock(left)
    if (generation === autoDockAnimationGeneration) {
      autoDockState.phase = 'hidden'
      onPositionSettled?.()

      const trackingGeneration = ++autoDockCursorTrackingGeneration
      while (
        !pipWindow.closed &&
        configStore.autoDockPIP &&
        autoDockState.phase === 'hidden' &&
        trackingGeneration === autoDockCursorTrackingGeneration
      ) {
        const cursor = await sendMessage(
          WebextEvent.getNativeCursorPosition,
          null,
        ).catch(() => null)
        if (!cursor) {
          updateConfig({ autoDockPIP: false })
          return
        }

        const cursorStillOverOriginalPIP =
          cursor.x >= originalBounds.left &&
          cursor.x < originalBounds.right &&
          cursor.y >= originalBounds.top &&
          cursor.y < originalBounds.bottom
        if (!cursorStillOverOriginalPIP) {
          restoreAutoDock()
          return
        }
        await wait(AUTO_DOCK_CURSOR_POLL_MS)
      }
    }
  }

  const handlePointerEnter = () => {
    pointerInsidePIP = true
    clearTimeout(autoDockTimer)
    if (autoDockState.phase === 'visible') {
      autoDockTimer = setTimeout(dockToNearestVerticalEdge, AUTO_DOCK_DELAY)
    }
  }
  const handlePointerLeave = () => {
    pointerInsidePIP = false
    if (autoDockState.phase === 'visible') clearTimeout(autoDockTimer)
  }

  const handleAspectRatioResize = () => {
    if (!configStore.lockPIPAspectRatio || aspectResizeInFlight) {
      previousInnerWidth = pipWindow.innerWidth
      previousInnerHeight = pipWindow.innerHeight
      return
    }

    clearTimeout(aspectResizeTimer)
    aspectResizeTimer = setTimeout(async () => {
      const widthDelta = Math.abs(pipWindow.innerWidth - previousInnerWidth)
      const heightDelta = Math.abs(pipWindow.innerHeight - previousInnerHeight)
      let nextWidth = pipWindow.innerWidth
      let nextHeight = pipWindow.innerHeight
      if (widthDelta >= heightDelta) {
        nextHeight = Math.round(nextWidth / lockedAspectRatio)
      } else {
        nextWidth = Math.round(nextHeight * lockedAspectRatio)
      }

      if (
        Math.abs(nextWidth - pipWindow.innerWidth) <= 1 &&
        Math.abs(nextHeight - pipWindow.innerHeight) <= 1
      ) {
        previousInnerWidth = pipWindow.innerWidth
        previousInnerHeight = pipWindow.innerHeight
        return
      }

      aspectResizeInFlight = true
      const [borderX, borderY] = getDocPIPBorderSize(pipWindow)
      await sendMessage(WebextEvent.resizeDocPIP, {
        docPIPWidth: pipWindow.innerWidth,
        width: nextWidth + borderX,
        height: nextHeight + borderY,
      }).catch(() => undefined)
      previousInnerWidth = nextWidth
      previousInnerHeight = nextHeight
      setTimeout(() => {
        aspectResizeInFlight = false
      }, 120)
    }, ASPECT_RESIZE_DELAY)
  }

  pipWindow.document.addEventListener('pointerenter', handlePointerEnter)
  pipWindow.document.addEventListener('pointerleave', handlePointerLeave)
  pipWindow.addEventListener('resize', handleAspectRatioResize)

  const disposeLockAspectRatio = autorun(() => {
    if (configStore.lockPIPAspectRatio) {
      lockedAspectRatio = pipWindow.innerWidth / pipWindow.innerHeight
      previousInnerWidth = pipWindow.innerWidth
      previousInnerHeight = pipWindow.innerHeight
    } else {
      clearTimeout(aspectResizeTimer)
    }
  })
  const disposeAutoDock = autorun(() => {
    if (!configStore.autoDockPIP) {
      restoreAutoDock()
    } else if (pointerInsidePIP && autoDockState.phase === 'visible') {
      clearTimeout(autoDockTimer)
      autoDockTimer = setTimeout(dockToNearestVerticalEdge, AUTO_DOCK_DELAY)
    }
  })
  const disposeExclusiveModes = reaction(
    () => [configStore.autoDockPIP, configStore.mousePassthrough] as const,
    (
      [autoDockPIP, mousePassthrough],
      [previousAutoDock, previousPassthrough],
    ) => {
      if (!autoDockPIP || !mousePassthrough) return
      if (mousePassthrough !== previousPassthrough) {
        updateConfig({ autoDockPIP: false })
      } else if (autoDockPIP !== previousAutoDock) {
        updateConfig({ mousePassthrough: false })
      }
    },
  )

  return {
    getSavedPosition: () => ({
      left:
        autoDockState.phase === 'visible'
          ? pipWindow.screenLeft
          : autoDockState.left,
      top:
        autoDockState.phase === 'visible'
          ? pipWindow.screenTop
          : autoDockState.top,
    }),
    isPointerInside: () => pointerInsidePIP,
    dispose: () => {
      disposeLockAspectRatio()
      disposeAutoDock()
      disposeExclusiveModes()
      pipWindow.document.removeEventListener('pointerenter', handlePointerEnter)
      pipWindow.document.removeEventListener('pointerleave', handlePointerLeave)
      pipWindow.removeEventListener('resize', handleAspectRatioResize)
      clearTimeout(autoDockTimer)
      clearTimeout(aspectResizeTimer)
      autoDockAnimationGeneration++
      autoDockCursorTrackingGeneration++
    },
  }
}
