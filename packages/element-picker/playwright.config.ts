import { defineConfig, devices } from '@playwright/test'

// 本地浏览器通过环境变量 PLAYWRIGHT_CHROME_EXE 覆盖 executablePath。
// 例：$env:PLAYWRIGHT_CHROME_EXE='E:\Chrome++_v0.1.0_x64_2024-05-8\App\chrome.exe'
// 注意：该 Chrome++ 构建的 version.dll 会吃掉无头/调试类参数导致 CDP 连不上，
// 只能默认 GUI 模式跑（会弹前台窗口）。CI/无头环境请换官方 Chromium。
export default defineConfig({
  testDir: './e2e',
  retries: process.env.CI ? 2 : 0,
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PLAYWRIGHT_CHROME_EXE
          ? {
              launchOptions: {
                executablePath: process.env.PLAYWRIGHT_CHROME_EXE,
                args: [
                  '--no-sandbox',
                  '--disable-dev-shm-usage',
                  '--disable-extensions',
                  '--no-first-run',
                  '--password-store=basic',
                  '--use-mock-keychain',
                ],
              },
            }
          : {}),
      },
    },
  ],
  use: {
    baseURL: 'http://localhost:5174',
  },
  webServer: {
    command: 'pnpm playground',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
  },
})
