import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// 載入 .env.local 讓 test process 能拿到 E2E_CLERK_USER_EMAIL/PASSWORD 等變數
// (Playwright 預設不讀 .env*,需顯式載入)
dotenv.config({ path: '.env.local' });

// Use process.env.PORT by default and fallback to port 3000
const PORT = process.env.PORT || 3000;

// Set webServer.url and use.baseURL with the location of the WebServer respecting the correct set port
const baseURL = `http://localhost:${PORT}`;

// 老師端 Clerk session 持久化檔案 (auth.setup.ts 寫,chromium-teacher project 讀)
const teacherStorageState = path.join('playwright', '.clerk', 'teacher.json');

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  // Look for files with the .spec.js or .e2e.js extension
  testMatch: '*.@(spec|e2e).?(c|m)[jt]s?(x)',
  // Timeout per test
  timeout: 30 * 1000,
  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,
  // Reporter to use. See https://playwright.dev/docs/test-reporters
  reporter: process.env.CI ? 'github' : 'list',

  expect: {
    // Set timeout for async expect matchers
    timeout: 10 * 1000,
  },

  // Run your local dev server before starting the tests:
  // https://playwright.dev/docs/test-advanced#launching-a-development-web-server-during-the-tests
  webServer: {
    command: process.env.CI ? 'npm run start' : 'npm run dev:next',
    // 不用 baseURL（首頁 Pricing 元件在 dev mode 會撞 Clerk auth() 錯誤回 500，Playwright 會 timeout）
    // 改等 sign-in 頁面（Clerk 自己的頁，不依賴 PricingVisibility，穩定 200）
    url: `${baseURL}/zh/sign-in`,
    timeout: 2 * 60 * 1000,
    reuseExistingServer: !process.env.CI,
    // ENABLE_TEST_ENDPOINTS：開啟 /api/test/seed-quiz（三重 env 閘 production 永遠 404）
    // DATABASE_URL：強制清空，覆蓋 .env.local 指向 Neon production，讓 dev server 走 PGlite in-memory
    // CLERK_*: 顯式 forward 給 dev server,避免 webServer.env 漏帶導致 Clerk SDK 沒 key 起不來
    env: {
      ENABLE_TEST_ENDPOINTS: 'true',
      DATABASE_URL: '',
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? '/sign-in',
    },
  },

  // Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions.
  use: {
    // Use baseURL so to make navigations relative.
    // More information: https://playwright.dev/docs/api/class-testoptions#test-options-base-url
    baseURL,

    // Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer
    trace: process.env.CI ? 'retain-on-failure' : undefined,

    // Record videos when retrying the failed test.
    video: process.env.CI ? 'retain-on-failure' : undefined,
  },

  projects: [
    // setup project:跑 auth.setup.ts 做 Clerk 登入並把 session 寫進 storageState 檔案
    // 只有 chromium-teacher 依賴它,所以單跑學生 E2E 時不會被 setup 失敗連帶卡死
    { name: 'setup', testMatch: /.*\.setup\.ts/ },

    // 學生公開作答測試:不需登入,不掛 storageState
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // 排除老師端測試 (走 chromium-teacher project)
      testIgnore: /Teacher.*\.e2e\.ts/,
    },

    // 老師端測試:用 setup 寫好的 Clerk session
    {
      name: 'chromium-teacher',
      use: {
        ...devices['Desktop Chrome'],
        storageState: teacherStorageState,
      },
      testMatch: /Teacher.*\.e2e\.ts/,
      dependencies: ['setup'],
    },

    ...(process.env.CI
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
            testIgnore: /Teacher.*\.e2e\.ts/,
          },
        ]
      : []),
  ],
});
