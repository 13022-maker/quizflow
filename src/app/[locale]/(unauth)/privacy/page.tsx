import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

// 草稿：【】內為待經營者填寫或確認的資料，上線前必須全部替換
const OPERATOR = '【法定名稱】（以 QuizFlow 名義經營）';
const CONTACT_EMAIL = '【聯絡信箱】';

// 資料處理者（依程式實際使用的服務列出）
const PROCESSORS: { name: string; purpose: string; url: string }[] = [
  {
    name: 'Paddle',
    purpose: '付款與訂閱（擔任經銷商 Merchant of Record），處理付款資訊、發票／收據與退款。',
    url: 'https://www.paddle.com/legal/privacy',
  },
  {
    name: 'Clerk',
    purpose: '老師帳號的註冊、登入與帳號管理（含使用 Google 帳號登入）。',
    url: 'https://clerk.com/legal/privacy',
  },
  {
    name: 'Neon',
    purpose: '資料庫，儲存帳號設定、測驗題目與學生作答紀錄。',
    url: 'https://neon.com/privacy-policy',
  },
  {
    name: 'Vercel',
    purpose: '網站主機與檔案儲存（例如練習頁、語音檔）。',
    url: 'https://vercel.com/legal/privacy-policy',
  },
  {
    name: 'Google（Gemini）',
    purpose: 'AI 出題、AI 批改與分析的主要 AI 服務；另用於客語語音合成、教學影片搜尋，以及老師主動選擇的 Google 試算表成績匯出。',
    url: 'https://policies.google.com/privacy',
  },
  {
    name: 'Anthropic（Claude）',
    purpose: '付費方案的 AI 出題、AI 批改與分析。',
    url: 'https://www.anthropic.com/legal/privacy',
  },
  {
    name: 'xAI（Grok）',
    purpose: 'AI 服務暫時無法使用時的備援。',
    url: 'https://x.ai/legal/privacy-policy',
  },
  {
    name: 'OpenAI',
    purpose: 'AI 服務暫時無法使用時的備援，以及聽力題、單字卡的語音合成。',
    url: 'https://openai.com/policies/privacy-policy',
  },
  {
    name: 'Ably',
    purpose: '即時競賽（Live Mode）的即時通知；只傳送「狀態已更新」訊號，不傳送作答內容或分數。',
    url: 'https://ably.com/privacy',
  },
  {
    name: 'Sentry、Better Stack',
    purpose: '錯誤監控與系統紀錄，用於找出並修正程式問題（畫面重播預設遮蔽所有文字與圖片）。【待確認：production 是否已設定 NEXT_PUBLIC_SENTRY_DSN／LOGTAIL_SOURCE_TOKEN，未啟用則刪除此項】',
    url: 'https://sentry.io/privacy/',
  },
];

export function generateMetadata() {
  return {
    title: 'QuizFlow 隱私權政策',
    description: 'QuizFlow 隱私權政策：收集哪些資料、交給哪些服務處理、學生資料如何保護，以及如何刪除。',
  };
}

const PrivacyPage = (props: { params: { locale: string } }) => {
  unstable_setRequestLocale(props.params.locale);

  return (
    <>
      <Navbar />

      <main className="mx-auto max-w-3xl px-6 py-16">
        {/* 返回首頁 */}
        <Link href="/" className="mb-8 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← 返回首頁
        </Link>

        <h1 className="mb-10 text-3xl font-bold">隱私權政策</h1>

        <div className="space-y-10 text-sm leading-relaxed text-foreground">

          <p>
            QuizFlow 由
            {OPERATOR}
            經營。這份政策用白話說明我們收集哪些資料、為什麼收集、交給哪些服務處理，以及您可以怎麼要求刪除。
          </p>

          {/* 一 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">一、我們收集的資料</h2>
            <h3 className="mb-2 font-semibold">老師（帳號使用者）</h3>
            <ul className="mb-4 list-disc space-y-2 pl-5">
              <li>
                <strong>帳號資料：</strong>
                姓名、電子郵件（透過 Clerk 登入服務取得）。
              </li>
              <li>
                <strong>教學內容：</strong>
                您建立的測驗、題目、解析、單字卡，以及上傳給 AI 出題的講義、PDF、圖片或網址內容。
              </li>
              <li>
                <strong>使用與訂閱紀錄：</strong>
                AI 使用次數、方案與訂閱狀態（付款資訊由 Paddle 處理，我們不儲存完整卡號）。
              </li>
            </ul>

            <h3 className="mb-2 font-semibold">學生（免登入作答）</h3>
            <p className="mb-2">學生不需註冊帳號。依老師使用的功能，可能收集：</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>身分欄位：</strong>
                測驗作答時的姓名與 email（選填；老師開啟「限制作答次數」時以 email 辨識）；
                練習頁的班級與姓名；適性學習的學號／座號與姓名；即時競賽與分組活動的暱稱。
                這些都是學生自行輸入，系統不驗證真實身分。
              </li>
              <li>
                <strong>作答紀錄：</strong>
                作答內容、分數、作答時間；考試模式下會記錄離開作答頁面的次數。
              </li>
              <li>
                <strong>匿名練習統計：</strong>
                靜態練習頁會記錄匿名的作答事件（以每次開啟頁面隨機產生的代碼區分），
                不儲存 IP、瀏覽器資訊或 cookie。
              </li>
              <li>
                <strong>自願留下的 email：</strong>
                練習頁結束畫面可自願留下 email，且必須勾選同意，才會用於寄送練習題與考試提醒，可隨時取消。
              </li>
            </ul>
          </section>

          {/* 二 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">二、資料用途</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>提供本服務：建立測驗、讓學生作答、自動批改、產生成績報表。</li>
              <li>AI 功能：依老師的要求出題、批改簡答題、分析學生弱點與班級表現。</li>
              <li>帳號與訂閱管理、寄送服務通知（例如試用到期、重大變更）。</li>
              <li>找出並修正錯誤、維持服務安全與穩定。</li>
            </ul>
            <p className="mt-2">我們不販售、出租您的個人資料，也不使用廣告追蹤 Cookie。</p>
          </section>

          {/* 三 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">三、資料處理者</h2>
            <p className="mb-3">
              為了提供服務，我們會把必要的資料交給以下服務商處理，他們依各自的隱私政策與資料處理條款處理資料：
            </p>
            <ul className="list-disc space-y-2 pl-5">
              {PROCESSORS.map(p => (
                <li key={p.name}>
                  <strong>
                    {p.name}
                    ：
                  </strong>
                  {p.purpose}
                  （
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    隱私政策
                  </a>
                  ）
                </li>
              ))}
            </ul>
            <p className="mt-3">
              <strong>關於 AI 服務：</strong>
              老師上傳的講義與輸入的出題指示、學生的作答內容（例如需要 AI 批改的簡答題、弱點分析所需的作答紀錄），
              可能會傳送到上述 AI 服務處理。我們只傳送完成該功能所需的內容，不會附上學生的姓名、學號或 email。
              【待確認：Gemini API 是否為付費層級——Google 對免費層級 API 的資料可能用於改善其產品，若仍使用免費層級，請改寫本段或改用付費層級】
            </p>
            <p className="mt-2">上述部分服務商位於台灣以外（例如美國），資料可能因此在境外處理與儲存。</p>
          </section>

          {/* 四 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">四、學生資料的特別說明</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>使用 QuizFlow 作答的學生多為未成年人，我們特別重視這部分的資料保護。</li>
              <li>
                要向學生收集哪些資料（例如是否填寫姓名、座號、email）由老師（或學校）決定。
                建議老師只收集教學需要的欄位，並依學校規定告知學生與家長。
              </li>
              <li>學生作答資料只提供給建立該測驗或活動的老師查看。</li>
              <li>
                QuizFlow 不會將學生資料用於訓練 AI 模型，也不會用於廣告。
                唯一例外是學生在練習頁自願留下 email 並勾選同意時，該 email 才會用於寄送練習題與考試提醒。
              </li>
            </ul>
          </section>

          {/* 五 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">五、保存與刪除</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>資料儲存在加密連線的雲端資料庫（Neon），保存到老師刪除或帳號刪除為止。</li>
              <li>老師刪除測驗、練習或活動時，相關的學生作答紀錄會一併刪除。</li>
              <li>需要刪除個別學生的資料，或學生、家長想查詢或刪除自己的資料，可直接聯絡該老師，或來信與我們聯絡。</li>
              <li>您可來信要求刪除帳號，我們會在 30 天內刪除帳號及其建立的測驗與作答資料（法律要求保存的交易紀錄除外，由 Paddle 依法保存）。</li>
            </ul>
          </section>

          {/* 六 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">六、Cookie 與本機儲存</h2>
            <p>
              我們只使用維持登入與功能運作所需的 Cookie 與瀏覽器本機儲存（例如登入狀態、即時競賽的作答身分），
              不使用廣告追蹤 Cookie。停用 Cookie 可能使部分功能無法運作。
            </p>
          </section>

          {/* 七 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">七、您的權利</h2>
            <p>
              依個人資料保護法，您可以要求查詢、閱覽、補充更正、停止處理或刪除您的個人資料。
              請來信與我們聯絡，我們會盡快回覆。
            </p>
          </section>

          {/* 八 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">八、政策修改</h2>
            <p>
              本政策更新時，我們會修改本頁「最後更新日期」；重大變更會以站內公告或電子郵件通知。
              另請參考《
              <Link href="/terms" className="text-primary hover:underline">服務條款</Link>
              》與《
              <Link href="/refund" className="text-primary hover:underline">退款政策</Link>
              》。
            </p>
          </section>

          {/* 聯絡 */}
          <section className="rounded-lg bg-muted px-5 py-4">
            <h2 className="mb-2 text-base font-semibold">聯絡我們</h2>
            <p>
              對本政策有任何疑問，或要行使上述權利，請來信：
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

export default PrivacyPage;
