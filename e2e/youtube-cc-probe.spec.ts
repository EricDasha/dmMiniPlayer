import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { wait } from './utils'

const VIDEO_A = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

test.setTimeout(180_000)

async function onExtLoaded(page: Page) {
  await page.waitForLoadState('load')
  await page.waitForFunction(
    () => document.documentElement.getAttribute('dm-loaded') === 'true',
    null,
    { timeout: 30000 },
  )
}

async function setupPage(page: Page) {
  const sdLogs: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('SubtitleDomCaptureManager')) sdLogs.push(text.slice(0, 300))
  })
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) sdLogs.push(`[nav] ${f.url()}`)
  })
  const sw =
    page.context().serviceWorkers()[0] ??
    (await page.context().waitForEvent('serviceworker', { timeout: 30000 }))
  await sw.evaluate(`chrome.storage.local.set({ showLog: true })`)
  await page.goto(VIDEO_A, { waitUntil: 'domcontentloaded' })
  await onExtLoaded(page)
  await page.waitForSelector('video')
  return sdLogs
}

async function openDocPIP(page: Page, settleMs = 6000) {
  const timer = setInterval(async () => {
    try {
      if (page.isClosed()) return clearInterval(timer)
      const video = await page.$('video')
      await video?.dispatchEvent('mousemove', { bubbles: true })
    } catch {
      clearInterval(timer)
    }
  }, 500)
  await page.locator('.start-pip-btn').click({ timeout: 15000 })
  await wait(settleMs)
  clearInterval(timer)
  expect(
    await page.evaluate('!!window.documentPictureInPicture?.window'),
  ).toBe(true)
}

/** 记录源页收到的所有 click（含合成），并记录 PiP 窗内的 click */
async function installClickProbes(page: Page) {
  await page.evaluate(() => {
    const w = window as any
    w.__clicks = []
    const describe = (n: any) => {
      if (!n) return String(n)
      if (n.nodeType !== 1) return n.nodeName
      const cls = (n.className || '').toString().split(/\s+/).slice(0, 2).join('.')
      return `${n.tagName}${n.id ? '#' + n.id : ''}${cls && cls !== '.' ? '.' + cls : ''}`
    }
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target as any
        w.__clicks.push({
          trusted: e.isTrusted,
          x: e.clientX,
          y: e.clientY,
          path: e.composedPath().slice(0, 5).map(describe),
          href: t?.closest?.('a')?.getAttribute?.('href') ?? null,
        })
      },
      true,
    )
    const pip = w.documentPictureInPicture?.window
    if (pip) {
      pip.__clicks = []
      pip.document.addEventListener(
        'click',
        (e: any) => {
          pip.__clicks.push({ trusted: e.isTrusted, path: e.composedPath().slice(0, 4).map(describe) })
        },
        true,
      )
    }
  })
}

async function dump(page: Page, label: string) {
  const data = await page.evaluate(() => {
    const w = window as any
    const pip = w.documentPictureInPicture?.window
    const player = document.querySelector('.html5-video-player') as any
    return {
      href: location.href,
      clicks: w.__clicks ?? [],
      pipClicks: pip?.__clicks ?? [],
      pipOpen: !!pip,
      videoInPip: pip ? !!pip.document.querySelector('video') : null,
      videoInPlayer: !!document.querySelector('.html5-video-player video'),
      playerClass: player?.className ?? null,
      playerState: (() => {
        try {
          return (document.querySelector('#movie_player') as any)?.getPlayerState?.()
        } catch {
          return 'err'
        }
      })(),
      captionWindow: document.querySelectorAll('.ytp-caption-window-container')
        .length,
      settingsOpen:
        (document.querySelector('.ytp-popup.ytp-settings-menu') as HTMLElement | null)
          ?.getClientRects().length ?? -1,
      nativePip: !!document.pictureInPictureElement,
    }
  })
  console.log(`[probe:${label}] ` + JSON.stringify(data, null, 1))
  return data
}

test('probe: 点 docPIP 内 CC 按钮对源页的影响', async ({ page }) => {
  const logs = await setupPage(page)
  await openDocPIP(page)

  const before = await dump(page, 'after-open')
  console.log('[probe] sdLogs after open:\n' + logs.join('\n'))

  await installClickProbes(page)

  // 点 PiP 窗内的字幕按钮（此时抓取链可能还没跑完：subtitleItems 为空）
  const clicked1 = await page.evaluate(() => {
    const pip = (window as any).documentPictureInPicture?.window
    if (!pip) return 'no-pip'
    const svg = pip.document.querySelector('svg#subtitle')
    if (!svg) return 'no-subtitle-btn'
    const btn = svg.closest('.dmmp-keep-pointer') as HTMLElement | null
    if (!btn) return 'no-btn-wrapper'
    btn.click()
    return 'clicked'
  })
  console.log('[probe] click#1 =', clicked1, '| subtitleItems 可能为空')

  // 等抓取链跑完（fetch + 4 次合成点击 + 列表读取）
  await wait(12000)
  const mid = await dump(page, 'after-first-click-and-chain')
  console.log('[probe] subtitle dom text =', await page.evaluate(() => {
    const w = (window as any).documentPictureInPicture?.window
    const panel = document.querySelector('.ytp-popup.ytp-settings-menu')
    return {
      menuItems: [...(panel?.querySelectorAll('.ytp-menuitem') ?? [])]
        .map((e) => (e.textContent ?? '').trim())
        .slice(0, 8),
      captionVisible: !!document.querySelector(
        '.caption-window.ytp-caption-window-bottom',
      ),
      pipOpen: !!w,
    }
  }))

  // 关键：链条跑完后再点一次 CC —— 这次走 useSubtitle → autoloadSubtitle
  await page.evaluate(() => {
    ;(window as any).__clicks = []
    const pip = (window as any).documentPictureInPicture?.window
    if (pip) pip.__clicks = []
  })
  const clicked2 = await page.evaluate(() => {
    const pip = (window as any).documentPictureInPicture?.window
    if (!pip) return 'no-pip'
    const svg = pip.document.querySelector('svg#subtitle')
    const btn = svg?.closest('.dmmp-keep-pointer') as HTMLElement | null
    if (!btn) return 'no-btn-wrapper'
    btn.click()
    return 'clicked'
  })
  console.log('[probe] click#2 =', clicked2)
  await wait(6000)

  const after = await dump(page, 'after-second-cc-click')
  const caption = await page.evaluate(() =>
    !!document.querySelector('.caption-window.ytp-caption-window-bottom'),
  )
  console.log('[probe] caption window visible after click#2 =', caption)
  console.log(
    '[probe] sdLogs delta:\n' + logs.slice(-20).join('\n'),
  )

  expect(before.href).toContain('watch')
  console.log(
    '[probe] href changed =',
    before.href !== after.href,
    '| url after =',
    after.href,
  )
})
