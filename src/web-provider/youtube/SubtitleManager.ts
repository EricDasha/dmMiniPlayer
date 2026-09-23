import SubtitleDomCaptureManager from '@root/core/SubtitleManager/SubtitleDomCaptureManager'
import { dq1, tryCatch } from '@root/utils'
import { ExtractPromise } from '@root/utils/typeUtils'
import { getVideoInfo } from './utils'

const SETTINGS_BUTTON = '[data-tooltip-target-id="ytp-settings-button"]'
const SETTINGS_MENU = '.ytp-popup.ytp-settings-menu'

// 字幕菜单项多语言匹配：英文/简繁中文/日韩/欧洲主要语言。
// 按位置 nth-last-child 选菜单项太脆：菜单项数量随 HD 徽章、环境模式、
// 实验开关变化，切到画质子菜单再读回来的「字幕」就是画质选项——后续
// el.click() 会真改画质（ytp-hd-quality-badge 里的选项被破坏）
const SUBTITLE_MENU_RE =
  /subtitle|subtitl|subtitul|subtitr|subtitel|untertitel|sous[-\s]?titr|legend|字幕|字幕|자막|\bcc\b/i

function findSubtitleMenuItem(): Element | null | undefined {
  const menu = dq1(SETTINGS_MENU)
  if (!menu || menu.getClientRects().length === 0) return null
  const items = [...menu.querySelectorAll('.ytp-menuitem')]
  return (
    items.find((item) => {
      const label =
        item.querySelector('.ytp-menuitem-label')?.textContent ??
        item.getAttribute('aria-label') ??
        ''
      return SUBTITLE_MENU_RE.test(label)
    }) ?? null
  )
}

/**菜单还开着才返回设置按钮去点掉它；已关闭就返回 null 直接跳过 */
function findSettingsButtonToClose(): Element | null | undefined {
  const menu = dq1(SETTINGS_MENU)
  if (!menu || menu.getClientRects().length === 0) return null
  return dq1(SETTINGS_BUTTON)
}

export default class YoutubeSubtitleManager extends SubtitleDomCaptureManager {
  override async getConfig(): ExtractPromise<
    ReturnType<SubtitleDomCaptureManager['getConfig']>
  > {
    const [error, hasSubtitle] = await tryCatch(
      async () =>
        !!(await getVideoInfo()).captions.playerCaptionsTracklistRenderer
          .captionTracks,
    )

    if (!hasSubtitle || error) return []

    return [
      {
        type: 'event',
        event: new MouseEvent('mousemove', { bubbles: true }),
        targetEl: '.html5-video-player',
      },
      {
        type: 'event',
        event: new MouseEvent('click', { bubbles: true }),
        targetEl: SETTINGS_BUTTON,
        wait: 300,
        required: true,
      },
      {
        type: 'event',
        event: new MouseEvent('click', { bubbles: true }),
        targetEl: findSubtitleMenuItem,
        wait: 400,
        required: true,
      },
      {
        type: 'subtitleElList',
        container: '.ytp-panel-menu',
        isActive: '[aria-checked="false"]',
        filter(list) {
          const [l1, ...rlist] = list
          return rlist
        },
      },
      {
        type: 'subtitleDom',
        targetEls: [
          {
            container: '.ytp-caption-window-container',
            el: '.caption-window.ytp-caption-window-bottom',
          },
        ],
      },
      // 收尾：只关还开着的菜单。不再对 document.body 派发 (0,0) 点击——
      // 旧写法坐标固定 (0,0)，正好是 masthead/logo 区，误触 ytd-logo 回主页
      {
        type: 'event',
        event: new MouseEvent('click', { bubbles: true }),
        targetEl: findSettingsButtonToClose,
        timeout: 0,
        alwaysRun: true,
      },
    ]
  }
}
