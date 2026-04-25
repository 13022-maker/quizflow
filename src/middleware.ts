import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { AllLocales, AppConfig } from './utils/AppConfig';

const intlMiddleware = createMiddleware({
  locales: AllLocales,
  localePrefix: AppConfig.localePrefix,
  defaultLocale: AppConfig.defaultLocale,
});

// 公開可存取、不需登入的 API 路徑（Paddle webhook、學生作答相關）
const isPublicApiRoute = createRouteMatcher([
  '/api/webhook(.*)',
  '/:locale/api/webhook(.*)',
  // AI 助教：學生作答前查看 AI 提示，匿名作答所以不需登入
  '/api/ai/generate-hints/(.*)',
  '/:locale/api/ai/generate-hints/(.*)',
  // TTS 發音：學生單字卡練習需要
  '/api/ai/tts',
  '/:locale/api/ai/tts',
  // 錯題單字卡：學生作答後建立
  '/api/ai/generate-flashcards',
  '/:locale/api/ai/generate-flashcards',
  // 儲存單字卡集：學生作答後儲存
  '/api/vocab/save',
  '/:locale/api/vocab/save',
  // Live Mode：學生加入、輪詢狀態、提交答案（皆以 playerToken 驗證）
  '/api/live/join',
  '/:locale/api/live/join',
  '/api/live/(.*)/player-state',
  '/:locale/api/live/(.*)/player-state',
  '/api/live/(.*)/answer',
  '/:locale/api/live/(.*)/answer',
]);

// 需要 Clerk context（route 內會呼叫 auth()）但不強制登入的 API，
// 例：Ably token 端點 — host 角色讀 orgId，player 角色用 playerToken 驗，兩種都不該被 auth.protect 擋
const isOptionalAuthRoute = createRouteMatcher([
  '/api/live/ably-auth',
  '/:locale/api/live/ably-auth',
]);

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/:locale/dashboard(.*)',
  '/api(.*)',
  '/:locale/api(.*)',
]);

export default function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  // 外部 webhook 不經過 Clerk 驗證，直接放行
  if (isPublicApiRoute(request)) {
    return NextResponse.next();
  }

  if (
    request.nextUrl.pathname.includes('/sign-in')
    || request.nextUrl.pathname.includes('/sign-up')
    || isProtectedRoute(request)
  ) {
    return clerkMiddleware(async (auth, req) => {
      // optional-auth route：要 Clerk context 讓 route 內的 auth() 能讀 session，但不強制登入
      if (isProtectedRoute(req) && !isOptionalAuthRoute(req)) {
        const locale
          = req.nextUrl.pathname.match(/(\/.*)\/dashboard/)?.at(1) ?? '';

        const signInUrl = new URL(`${locale}/sign-in`, req.url);

        await auth.protect({
          // `unauthenticatedUrl` is needed to avoid error: "Unable to find `next-intl` locale because the middleware didn't run on this request"
          unauthenticatedUrl: signInUrl.toString(),
        });
      }

      // API routes 不經過 intlMiddleware，避免被 i18n 重導向到 /zh/api/...
      if (req.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.next();
      }

      return intlMiddleware(req);
    })(request, event);
  }

  // API routes 不需要 intlMiddleware
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next|monitoring).*)', '/', '/(api|trpc)(.*)'], // Also exclude tunnelRoute used in Sentry from the matcher
};
