// Playwright setup project 的 placeholder
//
// 目前還沒接老師端 E2E。playwright.config.ts 留著 `setup` / `chromium-teacher` project 當基礎建設,
// 等之後接 Clerk 登入時直接在這裡寫;不刪 project 可避免下次又要重 review config。
//
// 原本嘗試用 @clerk/testing 的 clerkSetup + setupClerkTestingToken / clerk.signIn() 走標準流程,
// 但 Clerk dev instance 在 Playwright Chromium 強制觸發 dev-browser handshake (見
// node_modules/@clerk/backend/dist/internal.js:3114-3115 的 DevBrowserMissing 邏輯),
// 而 __clerk_testing_token 只繞 FAPI bot 偵測,不繞 handshake -> 跨域回 localhost 時 cookie 沒落地,
// 瀏覽器陷入 ERR_TOO_MANY_REDIRECTS。
//
// 之後接老師 E2E 較有勝算的做法:用 @clerk/backend createClerkClient().sessions.createSession()
// 直接造 session token 後 page.context().addCookies() 塞進去,跳過 handshake 整段。

import { test as setup } from '@playwright/test';

setup('placeholder (尚未接老師端 E2E)', async () => {
  // no-op
});
