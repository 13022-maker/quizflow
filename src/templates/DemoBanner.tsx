import Link from 'next/link';

import { StickyBanner } from '@/features/landing/StickyBanner';

export const DemoBanner = () => (
  <StickyBanner>
    QuizFlow 試用版 -
    {' '}
    <Link href="/sign-up">Explore the User Dashboard</Link>
  </StickyBanner>
);
