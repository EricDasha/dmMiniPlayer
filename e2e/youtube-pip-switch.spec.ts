import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { wait } from './utils'

const VIDEO_A = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

test.setTimeout(180_000)

/** onPageAndExtensionLoaded 的可见性无关版：headed 窗口被遮挡时
 *  Playwright 会把 <html> 判 hidden（youtube/douyin 必现），只等属性本身 */
async function onExtLoaded(page: Page) {
  await page.waitForLoadState('load')
  await page.waitForFunction(
    () => document.documentElement.getAttribute('dm-loaded') === 'true',
    null,
    { timeout: 30000 },
  )
}

type ScrimProbe = {
  url: string
  videoCount: number
  playerClass: string | null
  miniplayerActiveClass: boolean
  scrimFound: boolean
  scrimRects: number
  scrimDisplay: string | null
  scrimOpacity: string | null
  scrimText: string | null
  playerState: unknown
}

async function probeScrim(page: Page) {
  return page.evaluate((): ScrimProbe => {
    const player = document.querySelector('.html5-video-player')
    const scrim = document.querySelector('.ytp-miniplayer-scrim')
    const cs = scrim ? getComputedStyle(scrim as Element) : null
    let playerState: unknown = 'n/a'
    try {
      playerState = (
        document.querySelector('#movie_player') as any
      )?.getPlayerState?.()
    } catch {
      playerState = 'err'
    }
    return {
      url: location.href,
      videoCount: document.querySelectorAll('video').length,
      playerClass: (player as HTMLElement | null)?.className ?? null,
      miniplayerActiveClass:
        !!player &&
        Array.from((player as HTMLElement).classList).some((c) =>
          c.includes('miniplayer'),
        ),
      scrimFound: !!scrim,
      scrimRects: scrim ? scrim.getClientRects().length : 0,
      scrimDisplay: cs?.display ?? null,
      scrimOpacity: cs?.opacity ?? null,
      scrimText: (scrim?.textContent ?? '').trim().slice(0, 120) || null,
      playerState,
    }
  })
}

/** 在推荐列表里找带字幕轨道的视频（SPA 跳转目标确定化）。
 *  此环境 YouTube 走 SSR 纯 HTML（无 polymer shadow），直接收 light-DOM 链接 */
async function pickCaptionedRecommendation(
  page: Page,
  limit = 8,
): Promise<string> {
  const links: string[] = await page.evaluate(() => {
    const ids: string[] = []
    for (const a of document.querySelectorAll('a')) {
      try {
        const href = a.getAttribute('href') || ''
        if (!href.includes('watch?v=')) continue
        const v = new URL(href, location.origin).searchParams.get('v')
        const cur = new URL(location.href).searchParams.get('v')
        if (v && v !== cur && !ids.includes(v)) ids.push(v)
      } catch {
        // 忽略非法 href
      }
    }
    return ids
  })
  for (const v of links.slice(0, limit)) {
    try {
      const html: string = await page.evaluate(
        (id: string) => fetch(`/watch?v=${id}`).then((r) => r.text()),
        v,
      )
      // 轻量判定：captionTracks 非空数组（避免整页 JSON 解析的贪婪回溯坑）
      if (/"captionTracks":\s*\[[^\]]/.test(html)) return v
    } catch {
      // 换下一个候选
    }
  }
  throw new Error(`推荐列表前 ${limit} 个均无字幕轨道`)
}

async function clickRecommendation(page: Page, v: string) {
  await page.evaluate((id: string) => {
    const a = [...document.querySelectorAll('a')].find((el) => {
      try {
        const href = el.getAttribute('href') || ''
        return (
          href.includes('watch?v=') &&
          new URL(href, location.origin).searchParams.get('v') === id
        )
      } catch {
        return false
      }
    }) as HTMLAnchorElement | undefined
    if (!a) throw new Error('推荐链接消失')
    a.click()
  }, v)
  await page.waitForFunction(
    (id: string) => new URL(location.href).searchParams.get('v') === id,
    v,
    { timeout: 20000 },
  )
}

async function keepFloatBtnAlive(page: Page) {
  const timer = setInterval(async () => {
    try {
      if (page.isClosed()) return clearInterval(timer)
      const video = await page.$('video')
      await video?.dispatchEvent('mousemove', { bubbles: true })
    } catch {
      clearInterval(timer)
    }
  }, 500)
  return () => clearInterval(timer)
}

type LogCollector = { sdLogs: string[]; badResponses: string[] }

async function setupPage(page: Page): Promise<LogCollector> {
  const sdLogs: string[] = []
  const badResponses: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (
      text.includes('SubtitleDomCaptureManager') ||
      text.includes('docPIP_WH') ||
      text.includes('切换了路由')
    )
      sdLogs.push(`[${msg.type()}] ${text.slice(0, 300)}`)
  })
  page.on('response', (res) => {
    if (res.status() === 404) badResponses.push(res.url())
  })

  // clogInject 把 content 世界的 console.log 全吞了（prod showLog=false）：
  // 经 SW 把 showLog 打开再进页面，还原观测
  const sw =
    page.context().serviceWorkers()[0] ??
    (await page.context().waitForEvent('serviceworker', { timeout: 30000 }))
  await sw.evaluate(`chrome.storage.local.set({ showLog: true })`)

  await page.goto(VIDEO_A, { waitUntil: 'domcontentloaded' })
  await onExtLoaded(page)
  await page.waitForSelector('video')
  return { sdLogs, badResponses }
}

/** 开 docPIP，返回停 ping 函数 */
async function openDocPIP(page: Page, settleMs = 3000) {
  const stopPing = await keepFloatBtnAlive(page)
  await page.locator('.start-pip-btn').click({ timeout: 15000 })
  await wait(settleMs)
  const pipOpened = await page.evaluate(
    '!!window.documentPictureInPicture?.window',
  )
  expect(pipOpened).toBe(true)
  return stopPing
}

test('youtube docPIP 下切视频：scrim 不触发、字幕重抓、关窗还原', async ({
  page,
}) => {
  const { sdLogs, badResponses } = await setupPage(page)
  const stopPing = await openDocPIP(page)

  const before = await probeScrim(page)
  console.log('[repro] scrim before nav =', JSON.stringify(before, null, 1))

  const targetId = await pickCaptionedRecommendation(page)
  console.log('[repro] nav target =', targetId)
  const navMark = sdLogs.length
  await clickRecommendation(page, targetId)
  // 给字幕抓取链（fetch + 合成点击 + 等待）留足时间
  await wait(10000)

  const after = await probeScrim(page)
  console.log('[repro] scrim after nav =', JSON.stringify(after, null, 1))

  const postNavLogs = sdLogs.slice(navMark)
  console.log('[repro] post-nav sdLogs:\n' + postNavLogs.join('\n'))

  stopPing()

  // 断言1：scrim 不应可见
  expect(after.scrimRects).toBe(0)
  // 断言2：路由钩子必须触发
  expect(postNavLogs.some((l) => l.includes('切换了路由'))).toBe(true)
  // 断言3：字幕抓取链必须跑完（链条未中断）
  expect(postNavLogs.some((l) => l.includes('SubtitleDomCaptureManager'))).toBe(
    true,
  )
  expect(postNavLogs.some((l) => l.includes('skip subtitleElList'))).toBe(false)

  // 关窗：标题还原 + YouTube 自家 miniplayer 可用性
  await page.evaluate('window.documentPictureInPicture.window.close()')
  await wait(2000)
  expect(await page.evaluate('!window.documentPictureInPicture?.window')).toBe(
    true,
  )
  expect((await page.evaluate('document.title')).endsWith(' - PIP')).toBe(false)

  const mpBtnCount = await page.evaluate(
    `document.querySelectorAll('.ytp-miniplayer-button').length`,
  )
  console.log('[repro] miniplayer button count =', mpBtnCount)
  if (mpBtnCount > 0) {
    await page.evaluate(() => {
      document
        .querySelector('.html5-video-player')
        ?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    })
    await page.locator('.ytp-miniplayer-button').click({ timeout: 10000 })
    await wait(2000)
    const mpState = await probeScrim(page)
    console.log(
      '[repro] after miniplayer-btn click =',
      JSON.stringify({
        miniplayerActiveClass: mpState.miniplayerActiveClass,
        scrimRects: mpState.scrimRects,
      }),
    )
  }
  const mp404 = badResponses.filter((u) => u.includes('miniplayer'))
  console.log('[repro] miniplayer 404s =', JSON.stringify(mp404))
  expect(mp404.length).toBe(0)
})

test('youtube docPIP 开窗瞬间切视频（抓取链重叠）：最终仍有字幕', async ({
  page,
}) => {
  const { sdLogs } = await setupPage(page)
  // 几乎不等首轮抓取链跑完就切走：update() 大概率撞上 initing
  const stopPing = await openDocPIP(page, 500)

  const targetId = await pickCaptionedRecommendation(page, 3)
  console.log('[repro-race] nav target =', targetId)
  const navMark = sdLogs.length
  await clickRecommendation(page, targetId)
  // 重试间隔 1.2s + 整链 ~5s：留足余量
  await wait(14000)

  const after = await probeScrim(page)
  console.log('[repro-race] scrim after nav =', JSON.stringify(after, null, 1))
  const postNavLogs = sdLogs.slice(navMark)
  console.log('[repro-race] post-nav sdLogs:\n' + postNavLogs.join('\n'))

  stopPing()

  // 核心回归：新视频的 update 必须跑起来（没被静默丢弃），scrim 不现身
  expect(postNavLogs.some((l) => l.includes('切换了路由'))).toBe(true)
  expect(postNavLogs.some((l) => l.includes('SubtitleDomCaptureManager'))).toBe(
    true,
  )
  expect(after.scrimRects).toBe(0)

  await page.evaluate('window.documentPictureInPicture?.window?.close?.()')
})
