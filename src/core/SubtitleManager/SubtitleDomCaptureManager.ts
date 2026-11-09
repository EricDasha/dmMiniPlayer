import { OrPromise } from '@root/utils/typeUtils'
import { dispatchMouse, dq, dq1, wait } from '@root/utils'
import { logBox } from '@root/utils/logbox'
import { ERROR_MSG } from '@root/shared/errorMsg'
import { SubtitleItem, SubtitleRow } from './types'
import SubtitleManager from '.'

type SubtitleDomConfig = {
  type: 'subtitleDom'
  targetEls: {
    // type: 'sp' | 'top' | 'bottom'
    el?: string
    container: string
  }[]
}
type DataNode =
  | {
      type: 'event'
      event: Event
      /**选择器，或按文本找菜单项的 resolver（CSS 表达不了文本匹配） */
      targetEl: string | (() => Element | null | undefined)
      /**派发前等待目标出现的超时（ms），超时视为找不到 */
      timeout?: number
      /**派发后的等待 */
      wait?: number
      /**找不到时中断后续字幕列表读取——防止读错面板污染选项 */
      required?: boolean
      /**链条中断后仍要执行（如收尾关闭菜单） */
      alwaysRun?: boolean
    }
  | {
      type: 'subtitleElList'
      container: string
      child?: string
      text?: string
      isActive: string
      filter?: (list: SubtitleItem[]) => SubtitleItem[]
    }
  | SubtitleDomConfig

type EventNode = Extract<DataNode, { type: 'event' }>

export default abstract class SubtitleDomCaptureManager extends SubtitleManager {
  abstract getConfig(): OrPromise<DataNode[]>

  private _subtitleDomConfig!: SubtitleDomConfig
  get subtitleDomConfig() {
    return this._subtitleDomConfig
  }

  #labelToClickChildElMap = new Map<string, HTMLElement>()
  /**最近一次生效的抓取链配置：缓存节点失效时据此重开菜单再点 */
  #config: DataNode[] = []
  override async onInit() {
    this.on('reset', () => {
      this.#hasObserveSubtitleDom = false
      this.#observeSubtitleDomUnlisten()
      // 跨 init 复用的旧节点必须清掉，否则 YouTube 重排 DOM 后 click 会落到画质等其它选项上
      this.#labelToClickChildElMap.clear()
    })

    const config = await this.getConfig()
    this.#config = config

    const console = logBox('SubtitleDomCaptureManager')

    let notHasSubtitleDomConfig = true
    // required 事件找不到目标 → 链条中断：跳过后续事件与字幕列表读取，
    // 绝不去读主菜单/画质面板（读错 = 把错误选项存成字幕）
    let chainBroken = false
    for (const node of config) {
      switch (node.type) {
        case 'event': {
          if (chainBroken && !node.alwaysRun) break
          const ok = await this.performEvent(node)
          if (!ok && node.required) chainBroken = true
          break
        }
        case 'subtitleElList':
          if (chainBroken) {
            console.log('skip subtitleElList: menu open chain broken')
            break
          }
          await wait(500)
          const container = dq(node.container).pop()
          if (!container) {
            console.log(`container: ${node.container} not found`)
            continue
          }
          const childs = node.child
            ? dq(node.child, container)
            : Array.from(container.children)

          const filter = node.filter ?? ((list) => list)
          let unknownIndex = 0
          this.subtitleItems = filter(
            childs.map((el) => {
              const textEl = node.text ? (dq1(node.text, el) ?? el) : el
              const text = textEl.textContent ?? `unknown-${unknownIndex++}`
              this.#labelToClickChildElMap.set(text, el as HTMLElement)
              return {
                label: text,
                value: text,
              }
            }),
          )
          break
        case 'subtitleDom':
          this._subtitleDomConfig = node
          notHasSubtitleDomConfig = false
          break
      }
    }
    if (notHasSubtitleDomConfig && config.length) {
      throw Error(ERROR_MSG.subtitleDomConfigNotFound)
    }
    if (config.length) {
      await wait(500)
      this.startObserveSubtitleDom()
    }
  }

  protected override listenVideoEvents(): void {}

  /**
   * 派发单个事件节点。绝不允许合成点击落到页头/logo/根链接上：
   * 一旦误命中，页面会直接导航回首页，播放中的视频还会被站点收进自家小窗。
   */
  private async performEvent(node: EventNode): Promise<boolean> {
    const console = logBox('SubtitleDomCaptureManager')
    const tar = await this.resolveEventTarget(node)
    if (!tar) {
      console.log(
        `targetEl not found: ${
          typeof node.targetEl === 'function' ? '<resolver>' : node.targetEl
        }`,
      )
      return false
    }
    if (this.isUnsafeNavTarget(tar)) {
      console.log('refuse unsafe target (masthead/logo/root link)', tar)
      return false
    }
    console.log('tar', tar)
    // 必须带真实坐标重建事件：裸 click 的坐标恒为 (0,0)，会被坐标型处理器
    // 误判成“点在页头左上角”，进而导航回首页
    const template = node.event
    if (template instanceof MouseEvent) {
      dispatchMouse(tar, template.type, {
        bubbles: template.bubbles,
        cancelable: template.cancelable,
        composed: template.composed,
        detail: template.detail,
      })
    } else {
      tar.dispatchEvent(template)
    }
    await wait(node.wait ?? 50)
    return true
  }

  /**页头 / logo / 指向站点根路径的链接：任何合成点击都不该碰 */
  private isUnsafeNavTarget(el: Element): boolean {
    if (el.closest('ytd-masthead, #masthead-container, ytd-topbar-logo-renderer'))
      return true
    const anchor = el.closest('a[href]')
    if (!anchor) return false
    const href = (anchor.getAttribute('href') ?? '').trim()
    return href === '' || href === '/' || href.startsWith('/?')
  }

  /**抓取链跑完时缓存的菜单项是否还能直接点（菜单常被站点重建，旧节点会失效） */
  private isClickableSubtitleItem(
    el: HTMLElement | undefined,
    label: string,
  ): el is HTMLElement {
    return !!(
      el?.isConnected &&
      el.closest('.ytp-panel-menu') &&
      el.textContent === label &&
      !this.isUnsafeNavTarget(el)
    )
  }

  /**
   * 缓存节点失效时自愈：重跑开菜单的事件链，按文本重取字幕项再点。
   * 否则用户关窗/重开影片后第一次点 CC 只会空转，必须“重进影片”才恢复。
   */
  private async openAndClickSubtitleItem(label: string) {
    const console = logBox('SubtitleDomCaptureManager')
    const eventNodes = this.#config.filter(
      (n): n is EventNode => n.type === 'event',
    )
    const openNodes = eventNodes.filter((n) => !n.alwaysRun)
    const closeNodes = eventNodes.filter((n) => n.alwaysRun)
    try {
      for (const node of openNodes) {
        const ok = await this.performEvent(node)
        if (!ok && node.required) return
      }
      await wait(300)
      const listNode = this.#config.find((n) => n.type === 'subtitleElList')
      if (!listNode || listNode.type !== 'subtitleElList') return
      const container = dq(listNode.container).pop()
      if (!container) return
      const childs = listNode.child
        ? dq(listNode.child, container)
        : Array.from(container.children)
      const target = childs.find((el) => (el.textContent ?? '') === label)
      if (!target || this.isUnsafeNavTarget(target)) {
        console.log(`subtitle item not found on retry: ${label}`)
        return
      }
      dispatchMouse(target, 'click')
      this.#labelToClickChildElMap.set(label, target as HTMLElement)
    } finally {
      for (const node of closeNodes) await this.performEvent(node)
    }
  }

  /**轮询解析事件目标（菜单有开启动画，一次 dq 经常找不到） */
  private async resolveEventTarget(
    node: Extract<DataNode, { type: 'event' }>,
  ): Promise<Element | undefined> {
    const timeout = node.timeout ?? 1000
    const deadline = Date.now() + timeout
    for (;;) {
      const el =
        typeof node.targetEl === 'function'
          ? node.targetEl()
          : dq1(node.targetEl)
      if (el) return el
      if (Date.now() >= deadline || timeout <= 0) return undefined
      await wait(50)
    }
  }

  #hasObserveSubtitleDom = false
  #observeSubtitleDomUnlisten = () => {}
  private startObserveSubtitleDom() {
    if (this.#hasObserveSubtitleDom) return
    this.#hasObserveSubtitleDom = true
    const config = this.subtitleDomConfig
    for (const node of config.targetEls) {
      const container = dq1(node.container)
      // const container = node.container ? dq1(node.container) : el?.parentElement
      console.log('container', container)
      if (!container) throw Error('subtitle dom container not found')
      let preRow: SubtitleRow | undefined
      const observer = new MutationObserver((list) => {
        const tar = list[0].target as HTMLElement
        const el = node.el ? (dq1(node.el, container) ?? container) : container
        // console.log('update', el, el.textContent)
        preRow && this.emit('row-leave', preRow)

        const text = (el.textContent ?? '').trim()
        if (!text) return

        const nowRow: SubtitleRow = {
          startTime: this.video?.currentTime ?? 0,
          endTime: 999999,
          id: new Date().getTime() + '',
          text,
          htmlText: text,
        }
        preRow = nowRow
        this.emit('row-enter', nowRow)
      })
      observer.observe(container, { childList: true, subtree: true })

      // 旧代码的 addOnUnloadFn 被注释掉了：此处是真正的 observer 清理入口。
      // 注意 reset 事件也会走这里断开（见 onInit 的 reset 监听），否则重 init
      // 后旧 observer 继续报 row-enter/row-leave，字幕闪烁
      const prevUnlisten = this.#observeSubtitleDomUnlisten
      this.#observeSubtitleDomUnlisten = () => {
        prevUnlisten()
        observer.disconnect()
        this.#observeSubtitleDomUnlisten = () => {}
      }
    }
  }

  override async autoloadSubtitle() {
    const subtitleItemsLabel = this.nowSubtitleItemsLabel
    if (!subtitleItemsLabel) return
    this.resetSubtitleState()
    this.activeSubtitleLabel = subtitleItemsLabel

    const el = this.#labelToClickChildElMap.get(subtitleItemsLabel)
    if (this.isClickableSubtitleItem(el, subtitleItemsLabel)) {
      // 绝不用 el.click()：它派发的事件坐标恒为 (0,0)，会被站点的坐标型
      // 处理器当成“点在页头左上角”——表现为点 CC 却跳回首页 + 起自带小窗
      dispatchMouse(el, 'click')
    } else {
      // 站点关菜单时会重建面板，旧节点失效。重开菜单按文本再点，
      // 否则第一次点 CC 空转，只能靠“重进影片”才恢复
      await this.openAndClickSubtitleItem(subtitleItemsLabel)
    }

    this.listenVideoEvents()
    this.showSubtitle = true
  }

  override unload(): void {
    super.unload()
    this.#observeSubtitleDomUnlisten()
  }
}
