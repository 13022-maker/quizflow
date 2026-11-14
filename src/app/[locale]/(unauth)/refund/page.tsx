import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

// 草稿：【】內為待經營者填寫的資料，上線前必須全部替換
const CONTACT_EMAIL = '【聯絡信箱】';
const PADDLE_BUYER_TERMS_URL = 'https://www.paddle.com/legal/checkout-buyer-terms';

export function generateMetadata() {
  return {
    title: 'QuizFlow 退款政策',
    description: 'QuizFlow 退款政策：首次購買或續訂後 14 天內全額退款，說明取消訂閱與申請退款方式。',
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

        <h1 className="mb-10 text-3xl font-bold">退款政策</h1>

        <div className="space-y-10 text-sm leading-relaxed text-foreground">

          {/* 一 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">一、14 天內全額退款</h2>
            <p className="mb-2">
              首次購買 Pro 方案，或每次自動續訂扣款後
              <strong>14 天內</strong>
              ，都可以申請
              <strong>全額退款</strong>
              ，不需說明理由，也不看您是否已經使用過 Pro 功能。
            </p>
            <p>超過 14 天的款項原則上不予退款，但如遇重複扣款、帳單錯誤等情形，請隨時與我們聯絡。</p>
          </section>

          {/* 二 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">二、付款與退款由 Paddle 處理</h2>
            <p>
              QuizFlow 的線上訂單由 Paddle.com 擔任經銷商（Merchant of Record），
              訂閱、扣款、發票／收據與退款都由 Paddle 處理，退款會退回您原本的付款方式，
              實際入帳時間依發卡銀行或付款服務而定。購買時您同時適用 Paddle 的
              {' '}
              <a href={PADDLE_BUYER_TERMS_URL} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Buyer Terms（買方條款）
              </a>
              。
            </p>
          </section>

          {/* 三 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">三、如何申請退款</h2>
            <p className="mb-2">以下兩種方式擇一即可：</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>開啟 Paddle 寄給您的付款收據 email，點選其中的連結管理訂單並申請退款。</li>
              <li>
                來信
                {' '}
                {CONTACT_EMAIL}
                ，附上您的帳號 email 與付款日期（或 Paddle 收據上的訂單編號），我們會協助處理。
              </li>
            </ol>
          </section>

          {/* 四 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">四、取消訂閱</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>您可隨時取消訂閱，取消後不會再自動續扣。</li>
              <li>
                取消後，Pro 功能可繼續使用到
                <strong>本期結束</strong>
                ，之後自動回到免費方案。
              </li>
              <li>取消訂閱不會刪除您的帳號、測驗或學生作答資料。</li>
              <li>若您申請了退款，該筆款項對應期間的 Pro 權限會隨退款一併結束。</li>
            </ul>
          </section>

          {/* 五 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">五、免費試用</h2>
            <p>
              新帳號的 30 天 Pro 試用不需綁定付款方式，試用期滿會自動回到免費方案，不會產生任何費用。
            </p>
          </section>

          {/* 聯絡 */}
          <section className="rounded-lg bg-muted px-5 py-4">
            <h2 className="mb-2 text-base font-semibold">聯絡我們</h2>
            <p>
              退款申請或任何帳單問題，請來信：
              {CONTACT_EMAIL}
            </p>
          </section>

          <p className="text-xs text-muted-foreground">
            最後更新日期：2026-11-14
          </p>

        </div>
      </main>

      <Footer />
    </>
  );
};

export default RefundPage;
