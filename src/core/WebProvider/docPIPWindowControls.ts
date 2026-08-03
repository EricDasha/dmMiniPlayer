import WebextEvent from '@root/shared/webextEvent'
import configStore, { updateConfig } from '@root/store/config'
import { getDocPIPBorderSize } from '@root/utils/docPIP'
import { autorun, reaction } from 'mobx'
import { sendMessage } from 'webext-bridge/content-script'

const AUTO_DOCK_DELAY = 350
const AUTO_DOCK_VISIBLE_WIDTH = 40
const AUTO_DOCK_ANIMATION_MS = 190
const AUTO_DOCK_FRAME_MS = 16
const ASPECT_RESIZE_DELAY = 80

type ScreenWithOffset = Screen & { availLeft?: number }

type AutoDockState = {
  phase: 'visible' | 'hiding' | 'hidden' | 'showing'
  left: number
  top: number
}

const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3)

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
  let aspectResizeTimer: ReturnType<typeof setTimeout> | undefined
  let aspectResizeInFlight = false
  let lockedAspectRatio = pipWindow.innerWidth / pipWindow.innerHeight
  let previousInnerWidth = pipWindow.innerWidth
  let previousInnerHeight = pipWindow.innerHeight

  const movePIPWindow = (left: number, top?: number) =>
    sendMessage(WebextEvent.updateDocPIPRect, {
      docPIPWidth: pipWindow.innerWidth,
      left,
      ...(top === undefined ? {} : { top }),
    }).catch(() => undefined)

  const animateAutoDock = async (targetLeft: number, targetTop?: number) => {
    const generation = ++autoDockAnimationGeneration
    const startLeft = pipWindow.screenLeft
    const startTop = pipWindow.screenTop
    const startedAt = performance.now()

    while (!pipWindow.closed && generation === autoDockAnimationGeneration) {
      const progress = Math.min(
        1,
        (performance.now() - startedAt) / AUTO_DOCK_ANIMATION_MS,
      )
      const easedProgress = easeOutCubic(progress)
      const left = Math.round(
        startLeft + (targetLeft - startLeft) * easedProgress,
      )
      const top =
        targetTop === undefined
          ? undefined
          : Math.round(startTop + (targetTop - startTop) * easedProgress)

      await movePIPWindow(left, top)
      if (progress >= 1) return generation
      await wait(AUTO_DOCK_FRAME_MS)
    }

    return generation
  }

  const restoreAutoDock = async () => {
    clearTimeout(autoDockTimer)
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

    autoDockState.left = pipWindow.screenLeft
    autoDockState.top = pipWindow.screenTop
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
    }
  }

  const handlePointerEnter = () => {
    clearTimeout(autoDockTimer)
    restoreAutoDock()
  }
  const handlePointerLeave = () => {
    clearTimeout(autoDockTimer)
    autoDockTimer = setTimeout(dockToNearestVerticalEdge, AUTO_DOCK_DELAY)
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
    if (!configStore.autoDockPIP) restoreAutoDock()
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
    },
  }
}
