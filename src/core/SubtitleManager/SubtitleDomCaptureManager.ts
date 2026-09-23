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
export default abstract class SubtitleDomCaptureManager extends SubtitleManager {
  abstract getConfig(): OrPromise<DataNode[]>

  private _subtitleDomConfig!: SubtitleDomConfig
  get subtitleDomConfig() {
    return this._subtitleDomConfig
  }

  #labelToClickChildElMap = new Map<string, HTMLElement>()
  override async onInit() {
    this.on('reset', () => {
      this.#hasObserveSubtitleDom = false
      this.#observeSubtitleDomUnlisten()
      // 跨 init 复用的旧节点必须清掉，否则 YouTube 重排 DOM 后 click 会落到画质等其它选项上
      this.#labelToClickChildElMap.clear()
    })

    const config = await this.getConfig()

    const console = logBox('SubtitleDomCaptureManager')

    let notHasSubtitleDomConfig = true
    // required 事件找不到目标 → 链条中断：跳过后续事件与字幕列表读取，
    // 绝不去读主菜单/画质面板（读错 = 把错误选项存成字幕）
    let chainBroken = false
    for (const node of config) {
      switch (node.type) {
        case 'event': {
          if (chainBroken && !node.alwaysRun) break
          const tar = await this.resolveEventTarget(node)
          if (!tar) {
            console.log(
              `targetEl not found: ${
                typeof node.targetEl === 'function'
                  ? '<resolver>'
                  : node.targetEl
              }`,
            )
            if (node.required) chainBroken = true
            break
          }
          console.log('tar', tar)
          // 必须带真实坐标重建事件：config 里的模板事件坐标全是 (0,0)，
          // 派出去会被坐标型处理器误命中左上角 logo
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
    // 节点可能已被 YouTube 回收/复用成其它选项（画质等）：脱离面板或文本对不上就绝不点
    if (
      el?.isConnected &&
      el.closest('.ytp-panel-menu') &&
      el.textContent === subtitleItemsLabel
    ) {
      el.click()
    }

    this.listenVideoEvents()
    this.showSubtitle = true
  }

  override unload(): void {
    super.unload()
    this.#observeSubtitleDomUnlisten()
  }
}
