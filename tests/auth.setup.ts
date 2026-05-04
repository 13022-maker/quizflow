// Playwright setup project 占位檔
// playwright.config.ts 的 chromium project 寫死 dependencies: ['setup']，但 setup project
// 的 testMatch 是 *.setup.ts。原本 boilerplate 預期之後會接 Clerk Test Mode，現在還沒接，
// 所以放一個 no-op 讓 setup project 至少有檔案 match，不會讓整個 test run 因為「找不到 setup」而 fail。
// 之後要做老師端 E2E 接 Clerk 時，再把實際 sign-in 邏輯寫進這裡。

import { test as setup } from '@playwright/test';

setup('e2e placeholder setup', async () => {
  // 目前學生公開作答測試不需要登入，不做任何事
});
