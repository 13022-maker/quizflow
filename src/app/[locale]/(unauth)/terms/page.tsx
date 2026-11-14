import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

// 草稿：【】內為待經營者填寫的資料，上線前必須全部替換
const OPERATOR = '【法定名稱】（以 QuizFlow 名義經營）';
const CONTACT_EMAIL = '【聯絡信箱】';
const PADDLE_BUYER_TERMS_URL = 'https://www.paddle.com/legal/checkout-buyer-terms';

export function generateMetadata() {
  return {
    title: 'QuizFlow 服務條款',
    description: 'QuizFlow 服務條款：服務內容、方案與付款、使用者責任、智慧財產權與免責說明。',
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

        <h1 className="mb-10 text-3xl font-bold">服務條款</h1>

        <div className="space-y-10 text-sm leading-relaxed text-foreground">

          {/* 一 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">一、服務提供者與服務內容</h2>
            <p className="mb-2">
              QuizFlow（以下簡稱「本服務」）由
              {OPERATOR}
              （以下簡稱「我們」）提供，是專為台灣老師設計的線上測驗工具，
              包含測驗建立與分享、學生免登入作答、自動批改、成績報表，以及 AI 輔助出題與批改等功能。
            </p>
            <p>
              建立老師帳號的使用者須年滿 13 歲。使用本服務即表示您同意本條款、
              《
              <Link href="/privacy" className="text-primary hover:underline">隱私權政策</Link>
              》與《
              <Link href="/refund" className="text-primary hover:underline">退款政策</Link>
              》。
            </p>
          </section>

          {/* 二 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">二、方案內容</h2>
            <p className="mb-2">各方案目前內容如下，實際功能與價格以定價頁面當下顯示為準：</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>免費方案：</strong>
                每月 30 次 AI 出題，最多建立 10 份測驗。
              </li>
              <li>
                <strong>Pro 試用：</strong>
                新帳號可免費體驗 Pro 方案 30 天，不需綁定付款方式；試用期滿未訂閱者自動回到免費方案，不會自動扣款。
              </li>
              <li>
                <strong>Pro 方案：</strong>
                NT$299／月，或 NT$2,490／年，期滿自動續訂，可隨時取消。
              </li>
              <li>
                <strong>學校方案：</strong>
                即將開放。
              </li>
            </ul>
            <p className="mt-2">
              我們可能調整方案內容或價格。價格調整不影響您已付款的當期費用；
              對已訂閱的用戶，會在下一次續訂前以電子郵件或站內公告通知。
            </p>
          </section>

          {/* 三 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">三、付款與訂閱（由 Paddle 處理）</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                本服務的線上訂單由 Paddle.com 擔任經銷商（Merchant of Record）。
                您購買時的交易對象為 Paddle，訂閱、扣款、稅金、發票／收據與退款皆由 Paddle 處理。
              </li>
              <li>
                付款時，您同時適用 Paddle 的
                {' '}
                <a href={PADDLE_BUYER_TERMS_URL} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  Buyer Terms（買方條款）
                </a>
                。
              </li>
              <li>QuizFlow 不會接觸或儲存您的完整信用卡號等付款資訊。</li>
              <li>
                您可隨時取消訂閱，取消後不再續扣，已付款的期間結束前仍可繼續使用 Pro 功能。
                退款方式請見《
                <Link href="/refund" className="text-primary hover:underline">退款政策</Link>
                》。
              </li>
            </ul>
          </section>

          {/* 四 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">四、使用者責任</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>請妥善保管帳號，不要轉讓或與他人共用。</li>
              <li>您對上傳的講義、建立的測驗內容負責，請勿上傳違法、侵害他人權利或不當的內容。</li>
              <li>
                老師透過本服務向學生收集作答資料時，請依所屬學校規定與相關法令進行，
                僅收集教學所需的資料（詳見《
                <Link href="/privacy" className="text-primary hover:underline">隱私權政策</Link>
                》）。
              </li>
              <li>請勿以自動化工具大量存取本服務，或進行任何影響服務穩定的行為。</li>
              <li>請勿反向工程、破解或試圖取得本服務原始碼。</li>
            </ul>
          </section>

          {/* 五 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">五、AI 產生內容</h2>
            <p>
              AI 出題、AI 批改與 AI 分析的結果可能有錯誤或不完整之處。
              請老師在發佈給學生或採計成績前自行檢查；AI 批改的分數可由老師覆核修改。
            </p>
          </section>

          {/* 六 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">六、智慧財產權</h2>
            <p className="mb-2">
              您在本服務建立或上傳的測驗、題目、解析與講義，權利仍歸您（或原權利人）所有，
              我們不主張所有權，只在提供本服務所需的範圍內使用。
              您將內容上架到題庫市集時，即同意其他老師可瀏覽並複製該內容供教學使用。
            </p>
            <p>
              本服務的軟體、介面設計與 QuizFlow 名稱等，權利歸
              {OPERATOR}
              所有，未經同意請勿複製、散布或作商業使用。
            </p>
          </section>

          {/* 七 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">七、服務中斷與責任限制</h2>
            <p className="mb-2">
              我們會盡力維持服務穩定，但無法保證服務永不中斷或完全沒有錯誤。以下情況造成的損失，我們不負賠償責任：
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>系統維護、網路故障或不可抗力事件（天災、停電、駭客攻擊等）造成的中斷。</li>
              <li>因使用者操作不當或帳號遭他人未經授權使用所造成的資料遺失。</li>
              <li>第三方服務（如登入、付款、主機、資料庫、AI 服務）異常造成的功能失效。</li>
            </ul>
          </section>

          {/* 八 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">八、停止使用與帳號終止</h2>
            <p>
              您可隨時停止使用並要求刪除帳號。若使用者嚴重違反本條款，我們得在通知後暫停或終止其帳號。
            </p>
          </section>

          {/* 九 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">九、準據法與管轄</h2>
            <p>
              本條款以中華民國法律為準據法。因本條款或使用本服務所生爭議，雙方同意以
              【管轄法院】
              為第一審管轄法院；但法律另有強制規定者（例如消費者保護法）從其規定。
            </p>
          </section>

          {/* 十 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">十、條款修改</h2>
            <p>
              我們可能更新本條款，更新後會修改本頁「最後更新日期」；重大變更會以站內公告或電子郵件通知。
              更新後您繼續使用本服務，即視為同意新版條款。
            </p>
          </section>

          {/* 聯絡 */}
          <section className="rounded-lg bg-muted px-5 py-4">
            <h2 className="mb-2 text-base font-semibold">聯絡我們</h2>
            <p>
              對本條款有任何疑問，請來信：
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

export default TermsPage;
