import { dq, dq1, formatTime, throttle } from '@root/utils'
import { HtmlDanmakuProvider, WebProvider } from '@root/core/WebProvider'
import onRouteChange from '@root/inject/csUtils/onRouteChange'
import { SideSwitcher } from '@root/core/SideSwitcher'
import { t } from '@root/utils/i18n'
import { VideoItem } from '@root/components/VideoPlayer/Side'
import configStore from '@root/store/config'
import YoutubePreviewManager from './PreviewManager'
import YoutubeSubtitleManager from './SubtitleManager'

const getIframe = () => dq1<HTMLIFrameElement>('.ytd-live-chat-frame')
const getLiveClass = () => dq1<HTMLDivElement>('.ytp-live')
const isLive = () =>
  configStore.useIframeToDetectIsLiveOnYoutube
    ? !!getIframe()
    : !!getLiveClass()
export default class YoutubeProvider extends HtmlDanmakuProvider {
  /** 上次抓过字幕的 watchId（?v=）：SPA 切视频常复用同一个 <video> 元素 */
  private lastSubtitleVideoId: string | null | undefined
  override onInit() {
    super.onInit()
    this.isLive = isLive()

    this.subtitleManager = new YoutubeSubtitleManager()
    this.sideSwitcher = new SideSwitcher()
    if (!this.isLive) {
      this.videoPreviewManager = new YoutubePreviewManager()
    }
  }

  override async onPlayerInitd() {
    this.initSideSwitcherData()
    let lastHref = location.href
    const routeUnlisten = onRouteChange(() => {
      // 路由变化不一定换视频：pathname 和 ?v= 都没变（如 &t= 时间戳参数）
      // 就不重跑字幕抓取，否则设置菜单会被反复开合打断用户操作。
      // 注意：SPA 切视频常复用同一个 <video> 元素，update() 里用 watchId 区分。
      if (location.href === lastHref) return
      lastHref = location.href
      setTimeout(() => {
        this.update()
        this.initSideSwitcherData()
      }, 0)
    })
    this.addOnUnloadFn(routeUnlisten)

    const listDom = dq1('ytd-watch-next-secondary-results-renderer')
    if (listDom) {
      const initSideSwitcherData = throttle(() => {
        this.initSideSwitcherData()
      }, 500)
      const ob = new MutationObserver((e) => {
        initSideSwitcherData()
        // 侧栏属性变化和当前视频的字幕/预览无关：禁止在这里重跑 update()
        //（否则字幕抓取的合成点击会被高频重复触发，冲掉用户正开着的设置菜单）
      })
      ob.observe(listDom, { attributes: true })

      this.addOnUnloadFn(() => {
        ob.disconnect()
      })
    }
  }

  update() {
    // 同一 <video> 元素在切视频时会被复用：不能只看 initd，必须区分视频。
    // watchId 变了（?v= 参数）或 video 元素换了 → 重抓；否则 sidebar 之类
    // 的抖动进来也是 no-op。
    const id = new URLSearchParams(location.search).get('v')
    const sameVideo =
      this.subtitleManager.initd &&
      this.subtitleManager.video === this.webVideo &&
      this.lastSubtitleVideoId !== undefined &&
      this.lastSubtitleVideoId === id
    if (sameVideo) return
    this.lastSubtitleVideoId = id
    this.subtitleManager.init(this.webVideo)
    if (this.videoPreviewManager) {
      this.videoPreviewManager.init(this.webVideo)
    }
  }

  getObserveHtmlDanmakuConfig() {
    return {
      container: dq1<HTMLElement>(
        '#items.yt-live-chat-item-list-renderer',
        getIframe()?.contentDocument,
      )!,
      child: 'yt-live-chat-text-message-renderer',
      text: '#message',
    }
  }
  getDanmakuSenderConfig() {
    const dqTar = getIframe()?.contentDocument
    return {
      webTextInput: dq1<HTMLInputElement>(
        '#input.yt-live-chat-text-input-field-renderer',
        dqTar,
      ),
      webSendButton: dq1(
        '.yt-live-chat-message-input-renderer .yt-spec-button-shape-next',
        dqTar,
      ),
    }
  }

  async initSideSwitcherData() {
    if (!this.sideSwitcher) {
      console.error('已经被unload了', this)
      throw Error('已经被unload了')
    }

    const playListItems: VideoItem[] = dq(
      'ytd-playlist-panel-video-renderer',
    ).map((el) => {
      const title = (dq1('#video-title', el)?.textContent ?? '').trim()
      return {
        el,
        link: '',
        linkEl: dq1('a', el)!,
        title,
        isActive: el.hasAttribute('selected'),
        cover: dq1<HTMLImageElement>('.ytd-thumbnail img', el)?.src,
        duration:
          dq1('.ytd-thumbnail-overlay-time-status-renderer', el)?.textContent ??
          '',
      }
    })

    const recommendedListItems: VideoItem[] = dq(
      'ytd-compact-video-renderer',
    ).map((el) => {
      const title = (dq1('#video-title', el)?.textContent ?? '').trim()
      return {
        el,
        link: '',
        linkEl: dq1('a', el)!,
        title,
        cover: dq1<HTMLImageElement>('.ytd-thumbnail img', el)?.src,
        user: dq1('.ytd-channel-name', el)?.textContent?.trim() ?? '',
        duration:
          dq1('.ytd-thumbnail-overlay-time-status-renderer', el)?.textContent ??
          '',
      }
    })

    // console.log('data', playListItems, recommendedListItems)
    this.sideSwitcher.init([
      {
        category: t('vp.playList'),
        items: playListItems,
        mainList: true,
      },
      {
        category: t('vp.recommendedList'),
        items: recommendedListItems,
      },
    ])
  }
}
