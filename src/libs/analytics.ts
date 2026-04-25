// 統一管理 Vercel Analytics 事件名稱與 server 端追蹤包裝。
// 為什麼需要這層：集中事件常數避免 typo、之後換工具（PostHog/Mixpanel）不用全專案改。
// client 端因為只有一處呼叫（useCheckout），直接 import '@vercel/analytics' 即可。

export const AnalyticsEvents = {
  AI_GENERATE_SUCCEEDED: 'ai_generate_succeeded',
  QUIZ_PUBLISHED: 'quiz_published',
  CHECKOUT_OPENED: 'checkout_opened',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];
export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

// server 端（API Route / Server Action）使用。失敗不拋錯，避免干擾主流程。
// 動態 import 讓此模組同時可被 client 側 import（僅用常數與型別時不會拉進 server SDK）。
export async function trackServerEvent(
  name: AnalyticsEventName,
  props?: AnalyticsProps,
) {
  try {
    const { track } = await import('@vercel/analytics/server');
    await track(name, props);
  } catch (err) {
    console.error('[analytics] server track failed', name, err);
  }
}
