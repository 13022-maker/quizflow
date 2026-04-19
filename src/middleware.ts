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
]);

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/:locale/dashboard(.*)',
  '/onboarding(.*)',
  '/:locale/onboarding(.*)',
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
      if (isProtectedRoute(req)) {
        const locale
          = req.nextUrl.pathname.match(/(\/.*)\/dashboard/)?.at(1) ?? '';

        const signInUrl = new URL(`${locale}/sign-in`, req.url);

        await auth.protect({
          // `unauthenticatedUrl` is needed to avoid error: "Unable to find `next-intl` locale because the middleware didn't run on this request"
          unauthenticatedUrl: signInUrl.toString(),
        });
      }

      const authObj = await auth();

      if (
        authObj.userId
        && !authObj.orgId
        && req.nextUrl.pathname.includes('/dashboard')
        && !req.nextUrl.pathname.endsWith('/organization-selection')
      ) {
        const orgSelection = new URL(
          '/onboarding/organization-selection',
          req.url,
        );

        return NextResponse.redirect(orgSelection);
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
