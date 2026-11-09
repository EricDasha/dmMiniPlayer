import { dq1 } from '@root/utils'

/**
 * YouTube 自家 miniplayer（很多人直接叫它 YouTube 的 PiP）的压制工具。
 *
 * docPIP 的 replaceVideoEl 模式会把真实 <video> 搬出 YouTube 播放器，YouTube 会
 * 因此进入 minimized 状态并加载 miniplayer 模块。现有压制只在开窗/路由变化时
 * 执行一次，抓字幕这类后续播放器交互会让它重新挂回来。这里把压制/恢复/被动守卫
 * 抽成独立模块，供 DocPIPWebProvider 和字幕抓取链共用。
 */

export type YoutubePlayerEl = HTMLElement & {
  setMinimized?: (minimized: boolean) => void
  unloadModule?: (moduleName: string) => void
  loadModule?: (moduleName: string) => void
}

export const YOUTUBE_PLAYER_SELECTOR = '.html5-video-player'
export const YOUTUBE_MINIPLAYER_SELECTOR =
  '.ytp-miniplayer-scrim, .ytp-miniplayer'

export function getYoutubePlayer(): YoutubePlayerEl | undefined {
  return dq1<YoutubePlayerEl>(YOUTUBE_PLAYER_SELECTOR)
}

/**
 * 卸载 YouTube miniplayer 模块并把最小化状态复位。
 * 返回是否命中了播放器 API（页面不是 YouTube 或播放器未就绪时为 false）。
 */
export function suppressYoutubeMiniplayer(): boolean {
  const player = getYoutubePlayer()
  if (!player) return false

  let touched = false
  try {
    if (typeof player.unloadModule === 'function') {
      player.unloadModule('miniplayer')
      touched = true
    }
  } catch {
    // 私有 API 不可用时静默跳过
  }
  try {
    player.setMinimized?.(false)
    touched = true
  } catch {
    // 同上
  }
  return touched
}

/** 关闭 docPIP 时恢复 miniplayer 模块，与 suppressYoutubeMiniplayer 成对使用 */
export function restoreYoutubeMiniplayer(): void {
  const player = getYoutubePlayer()
  if (!player) return
  try {
    player.setMinimized?.(false)
  } catch {
    // 静默
  }
  try {
    player.loadModule?.('miniplayer')
  } catch {
    // 静默
  }
}

const GUARD_INTERVAL = 250

/**
 * docPIP 存续期间被动压制：监听 miniplayer 节点的重新挂载 / class 变化，
 * 一旦出现就再压制一次。返回清理函数，必须在 docPIP 关闭时调用。
 */
export function startYoutubeMiniplayerGuard(): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastRun = 0

  const hasVisibleMiniplayer = () => {
    const el = dq1<HTMLElement>(YOUTUBE_MINIPLAYER_SELECTOR)
    return !!el && el.getClientRects().length > 0
  }

  const run = () => {
    timer = undefined
    if (stopped) return
    lastRun = Date.now()
    suppressYoutubeMiniplayer()
    // unloadModule 后 YouTube 可能异步把模块挂回来：短周期内再确认一次
    if (!stopped && hasVisibleMiniplayer()) {
      timer = setTimeout(run, GUARD_INTERVAL)
    }
  }

  const schedule = () => {
    if (stopped || timer) return
    const delay = Math.max(0, GUARD_INTERVAL - (Date.now() - lastRun))
    timer = setTimeout(run, delay)
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        if (
          (mutation.target as Element).matches?.(YOUTUBE_MINIPLAYER_SELECTOR)
        ) {
          schedule()
          return
        }
        continue
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        const el = node as Element
        if (
          el.matches(YOUTUBE_MINIPLAYER_SELECTOR) ||
          el.querySelector(YOUTUBE_MINIPLAYER_SELECTOR)
        ) {
          schedule()
          return
        }
      }
    }
  })

  // 只观察播放器子树：整页 subtree + attributes 噪音过大。
  // 非 YouTube 页面没有播放器，直接不挂 observer（否则会给任意站点加全页监听）
  const root = getYoutubePlayer()
  if (!root) {
    observer.disconnect()
    return () => {}
  }
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  })
  schedule()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = undefined
    observer.disconnect()
  }
}
