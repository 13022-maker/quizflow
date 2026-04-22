'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

const DISMISS_KEY = 'quizflow-inapp-dismissed';

function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';
  return /Line\//i.test(ua)
    || /FBAN|FBAV/i.test(ua)
    || /Instagram/i.test(ua)
    || /MicroMessenger/i.test(ua);
}

export function InAppBrowserBanner() {
  const t = useTranslations('InAppBrowser');
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isInAppBrowser() && !localStorage.getItem(DISMISS_KEY)) {
      setShow(true);
    }
  }, []);

  if (!show) {
    return null;
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/dashboard`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  };

  return (
    <div className="mx-3 mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-lg">⚠️</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">{t('title')}</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            {t('description')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
            >
              {copied
                ? (
                    <>
                      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {t('copied')}
                    </>
                  )
                : (
                    <>
                      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H6M15.75 18.75h-9A2.25 2.25 0 014.5 16.5V6.108c0-1.135.845-2.098 1.976-2.192a48.507 48.507 0 011.123-.08" />
                      </svg>
                      {t('copy_button')}
                    </>
                  )}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-lg px-3 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
            >
              {t('dismiss')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
