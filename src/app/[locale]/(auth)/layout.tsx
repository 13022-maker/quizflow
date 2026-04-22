'use client';

import { enUS, jaJP, koKR, zhTW } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/nextjs';

import { AppConfig } from '@/utils/AppConfig';

const CLERK_LOCALE_MAP = {
  en: enUS,
  zh: zhTW,
  ja: jaJP,
  ko: koKR,
} as const;

export default function AuthLayout(props: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const clerkLocale
    = CLERK_LOCALE_MAP[props.params.locale as keyof typeof CLERK_LOCALE_MAP] ?? enUS;
  let signInUrl = '/sign-in';
  let signUpUrl = '/sign-up';
  let dashboardUrl = '/dashboard';
  let afterSignOutUrl = '/';

  if (props.params.locale !== AppConfig.defaultLocale) {
    signInUrl = `/${props.params.locale}${signInUrl}`;
    signUpUrl = `/${props.params.locale}${signUpUrl}`;
    dashboardUrl = `/${props.params.locale}${dashboardUrl}`;
    afterSignOutUrl = `/${props.params.locale}${afterSignOutUrl}`;
  }

  return (
    <ClerkProvider
      // PRO: Dark mode support for Clerk
      localization={clerkLocale}
      signInUrl={signInUrl}
      signUpUrl={signUpUrl}
      signInFallbackRedirectUrl={dashboardUrl}
      signUpFallbackRedirectUrl={dashboardUrl}
      afterSignOutUrl={afterSignOutUrl}
    >
      {props.children}
    </ClerkProvider>
  );
}
