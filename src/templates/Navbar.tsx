import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { CenteredMenu } from '@/features/landing/CenteredMenu';
import { Section } from '@/features/landing/Section';
import { isPricingEnabled } from '@/libs/paddleConfig';

import { Logo } from './Logo';

export const Navbar = () => {
  const t = useTranslations('Navbar');

  return (
    <Section className="px-3 py-6">
      <CenteredMenu
        logo={<Logo />}
        rightMenu={(
          <>
            {/* PRO: Dark mode toggle button */}
            <li data-fade>
              <LocaleSwitcher />
            </li>
            <li className="ml-1 mr-2.5" data-fade>
              <Link href="/sign-in">{t('sign_in')}</Link>
            </li>
            <li>
              <Link className={buttonVariants()} href="/sign-up">
                {t('sign_up')}
              </Link>
            </li>
          </>
        )}
      >
        {/* 2026-11 正式收費：定價入口常態顯示；NEXT_PUBLIC_PRICING_ENABLED=false 可緊急隱藏 */}
        {isPricingEnabled(process.env.NEXT_PUBLIC_PRICING_ENABLED) && (
          <li>
            <Link href="/pricing">{t('pricing')}</Link>
          </li>
        )}
        <li>
          <Link href="/blog">{t('blog')}</Link>
        </li>
        <li>
          <Link href="/templates">範本</Link>
        </li>
      </CenteredMenu>
    </Section>
  );
};
