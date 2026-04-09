import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export function generateMetadata() {
  return {
    title: 'QuizFlow 服務條款',
    description: 'QuizFlow 服務條款，說明使用者責任、智慧財產權與免責條款。',
  };
}

const TermsPage = (props: { params: { locale: string } }) => {
  unstable_setRequestLocale(props.params.locale);

  return (
    <>
      <Navbar />

      <main className="mx-auto max-w-3xl px-6 py-16">
        {/* 返回首頁 */}
        <Link href="/" className="mb-8 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← 返回首頁
        </Link>

        <h1 className="mb-2 text-3xl font-bold">服務條款</h1>
        <p className="mb-10 text-sm text-muted-foreground">最後更新：2026 年 4 月</p>

        <div className="space-y-10 text-sm leading-relaxed text-foreground">

          {/* 第一條 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">第一條　服務說明</h2>
            <p>
              QuizFlow（以下簡稱「本平台」）是由 prpispace 所提供的線上測驗工具，專為台灣教師設計，
              提供測驗建立、分享、自動批改及 AI 輔助出題等功能。使用者須年滿 13 歲，
              且使用時遵守本條款及中華民國相關法律。
            </p>
          </section>

          {/* 第二條 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">第二條　使用者責任</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>使用者應確保帳號安全，不得將帳號轉讓或共用。</li>
              <li>使用者須對其上傳或建立的測驗內容負完全責任，不得包含違法、侵權或不當內容。</li>
              <li>禁止以自動化工具大量存取本平台 API，或進行任何可能影響服務穩定的行為。</li>
              <li>禁止反向工程、破解或試圖取得本平台原始碼。</li>
            </ul>
          </section>

          {/* 第三條 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">第三條　免費與付費方案</h2>
            <p className="mb-2">
              本平台提供免費方案與 Pro 付費方案，各方案功能及限制如定價頁面所示。
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>免費方案：</strong>
                可建立最多 10 份測驗，不含 AI 自動生題功能。
              </li>
              <li>
                <strong>Pro 方案：</strong>
                每月 $9 美元，無限測驗 + AI 出題功能，按月自動續費。
              </li>
              <li>本平台保留隨時調整方案內容與定價的權利，將提前 30 天通知現有付費用戶。</li>
            </ul>
          </section>

          {/* 第四條 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">第四條　智慧財產權</h2>
            <p className="mb-2">
              使用者在本平台建立的所有測驗題目、解析及相關內容，其著作權歸使用者本人所有。
              本平台不主張對使用者內容的所有權。
            </p>
            <p>
              本平台的軟體、介面設計、商標及相關技術，著作權歸 prpispace 所有，
              未經授權不得複製、散布或商業使用。
            </p>
          </section>

          {/* 第五條 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">第五條　服務中斷免責條款</h2>
            <p className="mb-2">
              本平台以「現狀」提供服務，不保證服務永久不中斷或無錯誤。以下情況本平台不承擔賠償責任：
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>因伺服器維護、網路故障或不可抗力事件（天災、停電、駭客攻擊等）導致的服務中斷。</li>
              <li>因使用者操作不當或帳號遭未授權存取所造成的資料遺失。</li>
              <li>第三方服務（Clerk、Stripe、Neon 等）異常所導致的功能失效。</li>
            </ul>
          </section>

          {/* 第六條 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">第六條　準據法與管轄</h2>
            <p>
              本服務條款之解釋與適用，以中華民國法律為準據法。
              因本條款或使用本平台所生之爭議，雙方同意以台灣台北地方法院為第一審管轄法院。
            </p>
          </section>

          {/* 第七條 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">第七條　條款修改</h2>
            <p>
              本平台保留修改本條款的權利。重大變更將透過平台公告或電子郵件通知使用者。
              繼續使用本服務即視為同意更新後的條款。
            </p>
          </section>

          {/* 聯絡 */}
          <section className="rounded-lg bg-muted px-5 py-4">
            <h2 className="mb-2 text-base font-semibold">聯絡我們</h2>
            <p>
              如對本服務條款有任何疑問，請來信：
              {' '}
              <a href="mailto:support@quizflow.app" className="text-primary hover:underline">
                support@quizflow.app
              </a>
            </p>
          </section>

        </div>
      </main>

      <Footer />
    </>
  );
};

export default TermsPage;
