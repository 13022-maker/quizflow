import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export function generateMetadata() {
  return {
    title: 'QuizFlow 退款政策',
    description: 'QuizFlow 退款政策，說明訂閱取消方式與退款條件。',
  };
}

const RefundPage = (props: { params: { locale: string } }) => {
  unstable_setRequestLocale(props.params.locale);

  return (
    <>
      <Navbar />

      <main className="mx-auto max-w-3xl px-6 py-16">
        {/* 返回首頁 */}
        <Link href="/" className="mb-8 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← 返回首頁
        </Link>

        <h1 className="mb-2 text-3xl font-bold">退款政策</h1>
        <p className="mb-10 text-sm text-muted-foreground">最後更新：2026 年 4 月</p>

        <div className="space-y-10 text-sm leading-relaxed text-foreground">

          {/* 一 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">一、訂閱計費方式</h2>
            <p>
              QuizFlow Pro 方案採訂閱制，按月計費（每月 $9 美元）。
              訂閱開始後，費用會透過 Stripe 於每個計費週期自動扣款。
              帳單明細可在個人帳號的「帳單管理」頁面查看。
            </p>
          </section>

          {/* 二 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">二、取消訂閱</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>您可隨時在帳號設定中取消訂閱，取消後不會再自動續費。</li>
              <li>
                取消後，Pro 方案的使用權限將維持至目前計費週期結束，
                <strong>期末後自動降回免費方案</strong>
                ，不會立即失效。
              </li>
              <li>取消訂閱不會刪除您的帳號或測驗資料，免費方案限額內的資料將繼續保留。</li>
            </ul>
          </section>

          {/* 三 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">三、退款條件</h2>
            <p className="mb-3">
              由於本服務為數位訂閱服務，一般情況下
              <strong>不提供已使用計費週期的退款</strong>
              。
            </p>
            <p>以下情況可申請退款：</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>訂閱後 7 天內，若從未使用 Pro 功能（AI 出題等），可申請全額退款。</li>
              <li>因本平台技術問題導致 Pro 功能完全無法使用，且問題持續超過 72 小時。</li>
              <li>重複扣款或帳單錯誤。</li>
            </ul>
          </section>

          {/* 四 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">四、特殊情況處理</h2>
            <p>
              若您遇到以下特殊情況，歡迎聯繫客服，我們將個案評估是否提供退款或服務補償：
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>因重大疾病或突發緊急事件無法使用服務。</li>
              <li>誤操作升級方案（需於 24 小時內提出）。</li>
              <li>其他您認為合理的特殊情況。</li>
            </ul>
          </section>

          {/* 五 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">五、退款流程</h2>
            <ol className="list-decimal space-y-2 pl-5">
              <li>來信客服並說明退款原因及訂單資訊。</li>
              <li>我們將於 3 個工作天內回覆審核結果。</li>
              <li>退款核准後，金額將退回至原付款方式，約需 5–10 個工作天到帳。</li>
            </ol>
          </section>

          {/* 聯絡 */}
          <section className="rounded-lg bg-muted px-5 py-4">
            <h2 className="mb-2 text-base font-semibold">聯絡客服</h2>
            <p>
              退款申請或任何帳單問題，請來信：
              {' '}
              <a href="mailto:support@quizflow.app" className="text-primary hover:underline">
                support@quizflow.app
              </a>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              來信請附上帳號 Email 及訂單日期，以便快速處理。
            </p>
          </section>

        </div>
      </main>

      <Footer />
    </>
  );
};

export default RefundPage;
