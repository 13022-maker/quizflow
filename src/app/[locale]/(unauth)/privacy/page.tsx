import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export function generateMetadata() {
  return {
    title: 'QuizFlow 隱私權政策',
    description: 'QuizFlow 隱私權政策，說明我們收集哪些資料、如何使用，以及如何保護您的隱私。',
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

        <h1 className="mb-2 text-3xl font-bold">隱私權政策</h1>
        <p className="mb-10 text-sm text-muted-foreground">最後更新：2026 年 4 月</p>

        <div className="space-y-10 text-sm leading-relaxed text-foreground">

          {/* 一 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">一、資料收集範圍</h2>
            <p className="mb-3">使用 QuizFlow 時，我們可能收集以下資料：</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>帳號資料：</strong>
                姓名、電子郵件地址（透過 Clerk 身份驗證服務收集）。
              </li>
              <li>
                <strong>測驗內容：</strong>
                老師建立的測驗題目、選項、解析及相關設定。
              </li>
              <li>
                <strong>作答記錄：</strong>
                學生填寫的姓名（選填）、電子郵件（選填）及作答內容與分數。
              </li>
              <li>
                <strong>使用記錄：</strong>
                頁面瀏覽、功能使用情況等匿名化統計資料。
              </li>
            </ul>
          </section>

          {/* 二 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">二、資料用途</h2>
            <p className="mb-3">我們收集的資料僅用於以下目的：</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>提供、維護及改善 QuizFlow 平台服務。</li>
              <li>讓老師查看學生作答記錄與班級成績分析。</li>
              <li>處理付款及管理訂閱方案（透過 Stripe）。</li>
              <li>發送服務通知（如訂閱到期提醒、重大更新公告）。</li>
              <li>分析整體使用趨勢以改善產品體驗（匿名化處理）。</li>
            </ul>
          </section>

          {/* 三 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">三、資料不會出售給第三方</h2>
            <p>
              我們不會販售、出租或以任何商業目的將您的個人資料提供給第三方。
              僅在以下必要情況下，資料會與合作服務共享：
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>依法律要求或政府機關命令。</li>
              <li>為保護本平台或使用者安全而必要時。</li>
            </ul>
          </section>

          {/* 四 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">四、第三方服務提供商</h2>
            <p className="mb-3">本平台使用以下第三方服務，各自依其隱私政策處理相關資料：</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Clerk：</strong>
                負責使用者身份驗證、登入與帳號管理。
                （
                <a href="https://clerk.com/privacy" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  Clerk 隱私政策
                </a>
                ）
              </li>
              <li>
                <strong>Neon PostgreSQL：</strong>
                儲存測驗內容、題目及學生作答記錄。資料存放於加密的雲端資料庫。
              </li>
              <li>
                <strong>Stripe：</strong>
                處理信用卡付款，QuizFlow 不儲存您的完整卡號資訊。
              </li>
            </ul>
          </section>

          {/* 五 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">五、資料保留與刪除</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>帳號資料在您主動刪除帳號後，將於 30 天內從系統中移除。</li>
              <li>測驗資料與作答記錄隨帳號一併刪除。</li>
              <li>如需提前刪除特定資料，請聯繫客服處理。</li>
            </ul>
          </section>

          {/* 六 */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">六、Cookie 使用</h2>
            <p>
              本平台使用功能性 Cookie 維持登入狀態，不使用廣告追蹤 Cookie。
              您可在瀏覽器設定中管理 Cookie，但停用後可能影響部分功能正常運作。
            </p>
          </section>

          {/* 聯絡 */}
          <section className="rounded-lg bg-muted px-5 py-4">
            <h2 className="mb-2 text-base font-semibold">聯絡我們</h2>
            <p>
              如對本隱私權政策有任何疑問或需要行使資料主體權利，請來信：
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

export default PrivacyPage;
