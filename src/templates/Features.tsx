import { useTranslations } from 'next-intl';

import { Background } from '@/components/Background';
import { FeatureCard } from '@/features/landing/FeatureCard';
import { Section } from '@/features/landing/Section';

// 每個 feature 的 icon 用簡潔線性圖示，避免所有卡片看起來一樣
// viewBox 統一 24x24，stroke currentColor、strokeWidth 2
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="stroke-primary-foreground stroke-2"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Features = () => {
  const t = useTranslations('Features');

  const features = [
    {
      title: t('feature1_title'),
      description: t('feature1_description'),
      // 鉛筆（快速出題）
      icon: (
        <Icon>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </Icon>
      ),
    },
    {
      title: t('feature2_title'),
      description: t('feature2_description'),
      // 分享連結
      icon: (
        <Icon>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </Icon>
      ),
    },
    {
      title: t('feature3_title'),
      description: t('feature3_description'),
      // 閃電（即時結果）
      icon: (
        <Icon>
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </Icon>
      ),
    },
    {
      title: t('feature4_title'),
      description: t('feature4_description'),
      // 魔法星（AI）
      icon: (
        <Icon>
          <path d="M9 2v6M6 5h6" />
          <path d="M18 2v3M17 3.5h3" />
          <path d="M7 14l3 3-7 7-3-3z" />
          <path d="M14 6l2 2M22 14l-3-3" />
        </Icon>
      ),
    },
    {
      title: t('feature5_title'),
      description: t('feature5_description'),
      // 折線圖（分析）
      icon: (
        <Icon>
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 4 4 5-5" />
        </Icon>
      ),
    },
    {
      title: t('feature6_title'),
      description: t('feature6_description'),
      // 下載文件（匯出）
      icon: (
        <Icon>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M12 11v6M9 14l3 3 3-3" />
        </Icon>
      ),
    },
  ];

  return (
    <Background>
      <Section
        subtitle={t('section_subtitle')}
        title={t('section_title')}
        description={t('section_description')}
      >
        <div className="grid grid-cols-1 gap-x-3 gap-y-8 md:grid-cols-3">
          {features.map(f => (
            <FeatureCard key={f.title} icon={f.icon} title={f.title}>
              {f.description}
            </FeatureCard>
          ))}
        </div>
      </Section>
    </Background>
  );
};
