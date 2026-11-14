// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

// 2026-11 bundle 瘦身：
// - 沒設 DSN（目前 production 就沒設）時完全不初始化，build 時 NEXT_PUBLIC_ 變數被內聯成 undefined，整段被 tree-shake
// - Session Replay（~36 kB gzip）改成 lazy load，不再塞進每一頁的共用 bundle
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    // Sentry DSN
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: 1,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false,

    replaysOnErrorSampleRate: 1.0,

    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: 0.1,
  });

  Sentry.lazyLoadIntegration('replayIntegration')
    .then(replayIntegration => Sentry.addIntegration(replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    })))
    .catch(() => { /* CDN 載不到就不錄 replay，不影響錯誤回報 */ });
}

// Spotlight 只在開發環境用：改成 dynamic import，production build 不再打包（原本 ~158 kB gzip 進到每一頁）
if (process.env.NODE_ENV === 'development') {
  import('@spotlightjs/spotlight').then(Spotlight => Spotlight.init());
}
