# 市集空狀態 AI 命題 CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 市集兩個 tab（測驗 / 單字卡）篩選後沒有結果時，把空狀態文案換成「直接 AI 生成」CTA，並把目前篩選條件當主題 prefill 帶到 AI 命題畫面。

**Architecture:** Marketplace `<MarketplaceEmptyCTA>` 元件 → `<Link>` 帶 `?ai=1&prefill=<encoded>`（Quiz）或 `?title=<encoded>`（Vocab）→ Quiz 流程經 server action `createQuiz({ prefill })` redirect 到 edit 頁，prefill 透過 QuizEditor 注入 AIQuizModal `defaultTopic` → AIQuizModal 自動開啟並預填主題；Vocab 流程僅將 title 注入 `/dashboard/vocab/new` 的 title state。

**Tech Stack:** Next.js 14 App Router、Clerk auth、Drizzle ORM（無 schema 改動）、Tailwind、現有 `AIQuizModal` / `VocabAIModal`、`QuickCreateAIButton` pattern。

**Spec:** `docs/superpowers/specs/2026-05-05-marketplace-empty-ai-cta-design.md`

---

### Task 1: createQuiz server action 加 `prefill` 參數

**Files:**
- Modify: `src/actions/quizActions.ts:44-48` (Zod schema), `src/actions/quizActions.ts:111-112` (redirect)

- [ ] **Step 1：在 `CreateQuizSchema` 加可選 `prefill` 欄位**

修改 `src/actions/quizActions.ts:44-48`：

```ts
const CreateQuizSchema = z.object({
  title: z.string().min(1, '請輸入測驗標題').max(200),
  description: z.string().max(500).optional(),
  quizMode: z.enum(['standard', 'vocab']).optional(),
  // 從市集 CTA 帶過來的 AI 命題主題；createQuiz 不存進 DB,只在 redirect 時夾帶
  prefill: z.string().max(300).optional(),
});
```

- [ ] **Step 2：redirect 條件附加 `&prefill=`**

修改 `src/actions/quizActions.ts:111-112`：

```ts
// 建完直接進編輯頁；ai=1 觸發 AI 出題對話框、just_created=1 顯示審題引導 banner
// prefill 來自市集 CTA(可選),用 encodeURIComponent 處理特殊字元;edit 頁傳給 AIQuizModal defaultTopic
const prefillParam = parsed.data.prefill
  ? `&prefill=${encodeURIComponent(parsed.data.prefill)}`
  : '';
redirect(`/dashboard/quizzes/${inserted.id}/edit?ai=1&just_created=1${prefillParam}`);
```

- [ ] **Step 3：型別檢查 + 確認既有 caller 不破**

Run: `npm run check-types`
Expected: pass。`QuickCreateAIButton`、`QuizForm` 等既有 caller 不傳 prefill,Zod optional 自動容許。

- [ ] **Step 4：Commit**

```bash
git add src/actions/quizActions.ts
git commit -m "feat(quiz): createQuiz 接受 prefill 參數,redirect 帶到 edit 頁"
```

---

### Task 2: 新建 `AiPrefillTrigger` client 元件

**Files:**
- Create: `src/features/quiz/AiPrefillTrigger.tsx`

- [ ] **Step 1：寫元件**

新建 `src/features/quiz/AiPrefillTrigger.tsx`：

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { createQuiz } from '@/actions/quizActions';

// 由市集空狀態 CTA 進入 /dashboard/quizzes/new?ai=1&prefill=...
// mount 後立刻呼叫 createQuiz(server action),成功時 server-side redirect 到 edit?ai=1&prefill=...
// 失敗時(quota 超額 / 其他)在畫面顯示錯誤 + 返回連結
function getDefaultTitle(): string {
  const d = new Date();
  return `AI 出題 ${d.getMonth() + 1}/${d.getDate()}`;
}

export function AiPrefillTrigger({ prefill }: { prefill: string }) {
  const router = useRouter();
  const firedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Strict Mode dev double-mount guard
    if (firedRef.current) {
      return;
    }
    firedRef.current = true;

    (async () => {
      const result = await createQuiz({
        title: getDefaultTitle(),
        prefill: prefill || undefined,
      });
      // 成功時 server action 會 redirect(throw NEXT_REDIRECT),不會 return
      // 走到這裡代表失敗
      if (result?.error === 'QUOTA_EXCEEDED') {
        router.push('/dashboard/billing');
        return;
      }
      if (result?.error) {
        setError(result.error);
      }
    })();
  }, [prefill, router]);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-red-600">建立失敗：{error}</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          返回儀表板
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      {/* 紫色 spinner 呼應 QuickCreateAIButton 視覺 */}
      <div className="mx-auto mb-4 size-12 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
      <h1 className="text-lg font-bold text-foreground">準備 AI 命題中⋯</h1>
      {prefill && (
        <p className="mt-2 text-sm text-muted-foreground">
          主題：
          <span className="font-medium text-foreground">{prefill}</span>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2：型別檢查**

Run: `npm run check-types`
Expected: pass

- [ ] **Step 3：Commit**

```bash
git add src/features/quiz/AiPrefillTrigger.tsx
git commit -m "feat(quiz): 新增 AiPrefillTrigger 元件,從市集 CTA auto-create AI quiz"
```

---

### Task 3: `/dashboard/quizzes/new` 條件分支渲染

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/quizzes/new/page.tsx`

- [ ] **Step 1：讀 query 並條件分支**

修改 `src/app/[locale]/(auth)/dashboard/quizzes/new/page.tsx`，在既有 import 區加：

```tsx
import { AiPrefillTrigger } from '@/features/quiz/AiPrefillTrigger';
```

把函式 signature 從 `export default async function NewQuizPage()` 改為接 searchParams：

```tsx
export default async function NewQuizPage({
  searchParams,
}: {
  searchParams: { ai?: string; prefill?: string };
}) {
  const t = await getTranslations('AddQuiz');
  const { userId } = await auth();

  // 伺服器端先查方案與測驗數量,超過上限就顯示升級牆
  // 試用中老師走 isProOrAbove 短路,與 quizActions / dashboard quizzes 待遇一致
  if (userId && !(await isProOrAbove(userId))) {
    const planId = await getUserPlanId(userId);
    const quizLimit = PricingPlanList[planId]?.features.website ?? 10;

    if (quizLimit < 999) {
      const [row] = await db
        .select({ total: count() })
        .from(quizSchema)
        .where(eq(quizSchema.ownerId, userId));
      const current = row?.total ?? 0;

      if (current >= quizLimit) {
        return <QuizLimitWall current={current} limit={quizLimit} />;
      }
    }
  }

  // 從市集 CTA 過來的 AI 命題請求:渲染 trigger 元件 auto-create + redirect
  if (searchParams.ai === '1') {
    return <AiPrefillTrigger prefill={searchParams.prefill ?? ''} />;
  }

  return (
    <>
      <TitleBar title={t('title_bar')} />

      <DashboardSection
        title={t('section_title')}
        description={t('section_description')}
      >
        <QuizForm />
      </DashboardSection>
    </>
  );
}
```

- [ ] **Step 2：本機跑 dev,手動測試**

Run: `npm run dev`，瀏覽器開：
- `/dashboard/quizzes/new` → 應顯示既有 QuizForm（向後相容）
- `/dashboard/quizzes/new?ai=1` → 應顯示「準備 AI 命題中⋯」spinner，幾秒內 redirect 到 `/dashboard/quizzes/<id>/edit?ai=1&just_created=1`
- `/dashboard/quizzes/new?ai=1&prefill=測試主題` → 同上 + spinner 下方顯示「主題：測試主題」

- [ ] **Step 3：Commit**

```bash
git add src/app/[locale]/(auth)/dashboard/quizzes/new/page.tsx
git commit -m "feat(quiz): /dashboard/quizzes/new 接受 ?ai=1 進入 AI 自動觸發模式"
```

---

### Task 4: Edit 頁與 QuizEditor 串 prefill

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/quizzes/[id]/edit/page.tsx:31-94`
- Modify: `src/features/quiz/QuizEditor.tsx:148-158`, `:808-822`

- [ ] **Step 1：擴充 edit page searchParams 並下傳**

修改 `src/app/[locale]/(auth)/dashboard/quizzes/[id]/edit/page.tsx`，把 searchParams 型別與最後一行 return 改為：

```tsx
export default async function EditQuizPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { ai?: string; prefill?: string };
}) {
  // ...（中間既有邏輯不動）

  const autoOpenAI = searchParams.ai === '1';
  // 來自市集 CTA → createQuiz redirect 帶過來的主題,優先於 description 推導
  const aiPrefill = searchParams.prefill;

  return (
    <QuizEditor
      quiz={quiz as any}
      questions={questions}
      isPro={isPro}
      autoOpenAI={autoOpenAI}
      aiPrefill={aiPrefill}
    />
  );
}
```

- [ ] **Step 2：QuizEditor 加 `aiPrefill` prop 並用於 modal `defaultTopic`**

修改 `src/features/quiz/QuizEditor.tsx:148-158`：

```tsx
export function QuizEditor({
  quiz: initialQuiz,
  questions: initialQuestions,
  isPro,
  autoOpenAI = false,
  aiPrefill,
}: {
  quiz: Quiz;
  questions: Question[];
  isPro: boolean;
  autoOpenAI?: boolean;
  aiPrefill?: string;
}) {
```

修改 `src/features/quiz/QuizEditor.tsx:808-822`，把兩個 modal 的 `defaultTopic` 改成優先用 `aiPrefill`：

```tsx
{/* AI 出題 Modal(vocab 模式用專屬單字生成器) */}
{showAIModal && initialQuiz.quizMode === 'vocab' && (
  <VocabAIModal
    defaultTopic={aiPrefill || buildDefaultTopic(initialQuiz.description)}
    onImport={handleAIImport}
    onClose={() => setShowAIModal(false)}
  />
)}
{showAIModal && initialQuiz.quizMode !== 'vocab' && (
  <AIQuizModal
    defaultTopic={aiPrefill || buildDefaultTopic(initialQuiz.description)}
    onImport={handleAIImport}
    onClose={() => setShowAIModal(false)}
  />
)}
```

- [ ] **Step 3：型別檢查 + 手動驗證**

Run: `npm run check-types`
Expected: pass

`npm run dev`，瀏覽器開 `/dashboard/quizzes/<existing-id>/edit?ai=1&prefill=高中%20高中數學%20—%20三角函數`，AIQuizModal 自動開啟，主題框已預填「高中 高中數學 — 三角函數」。

- [ ] **Step 4：Commit**

```bash
git add src/app/[locale]/(auth)/dashboard/quizzes/[id]/edit/page.tsx src/features/quiz/QuizEditor.tsx
git commit -m "feat(quiz): edit 頁讀 ?prefill 透傳到 AIQuizModal defaultTopic"
```

---

### Task 5: Marketplace `buildPrefill` helper + 新建 `MarketplaceEmptyCTA` 元件

**Files:**
- Create: `src/features/marketplace/MarketplaceEmptyCTA.tsx`
- Modify: `src/app/[locale]/(unauth)/marketplace/page.tsx`（加 helper + import）

- [ ] **Step 1：寫 `MarketplaceEmptyCTA` 元件**

新建 `src/features/marketplace/MarketplaceEmptyCTA.tsx`：

```tsx
import Link from 'next/link';

// 市集空狀態 CTA:把「找不到」轉成「自己生」,導使用者到對應 AI 入口
// type='quiz' → /dashboard/quizzes/new?ai=1[&prefill=...]
// type='vocab' → /dashboard/vocab/new[?title=...] (僅 prefill 卡集名稱,單字仍由使用者輸入)
type Props = {
  type: 'quiz' | 'vocab';
  prefill: string; // 來自 buildPrefill,可能為空字串
};

export function MarketplaceEmptyCTA({ type, prefill }: Props) {
  const isQuiz = type === 'quiz';
  const heading = isQuiz ? '目前還沒有符合條件的測驗' : '目前還沒有符合條件的單字卡集';

  // 副標依 type + prefill 有無分四種文案
  const subtitle = (() => {
    if (isQuiz) {
      return prefill
        ? `要不要讓 AI 幫你生一份「${prefill}」？`
        : '換個篩選條件,或讓 AI 幫你生一份新的測驗';
    }
    return prefill
      ? `要不要建一份「${prefill}」的單字卡？輸入單字後 AI 幫你補釋義`
      : '換個篩選條件,或自己建一組新的單字卡';
  })();

  // CTA 連結:Quiz 永遠帶 ?ai=1 進 trigger 模式;Vocab 只帶 ?title 預填卡集名稱
  const href = (() => {
    if (isQuiz) {
      const params = new URLSearchParams({ ai: '1' });
      if (prefill) {
        params.set('prefill', prefill);
      }
      return `/dashboard/quizzes/new?${params.toString()}`;
    }
    return prefill
      ? `/dashboard/vocab/new?title=${encodeURIComponent(prefill)}`
      : '/dashboard/vocab/new';
  })();

  const buttonLabel = isQuiz ? '✨ 用 AI 立即生成' : '✨ 開始建立單字卡';

  return (
    <div className="rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/40 px-6 py-12 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
        <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
      </div>
      <p className="text-lg font-medium text-foreground">{heading}</p>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      <Link
        href={href}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700"
      >
        {buttonLabel}
      </Link>
    </div>
  );
}
```

- [ ] **Step 2：在 marketplace page 加 `buildPrefill` helper**

在 `src/app/[locale]/(unauth)/marketplace/page.tsx` 既有 import 區下方、`MarketplacePage` 函式上方加：

```ts
import { MarketplaceEmptyCTA } from '@/features/marketplace/MarketplaceEmptyCTA';

// ...其他既有 import 不動

// 把目前篩選條件組成 AI 命題主題前置詞:「[grade] [category] — [q]」
// 缺項自動跳過、三項都缺回空字串
function buildPrefill(category?: string, grade?: string, q?: string): string {
  const left = [grade, category].filter(Boolean).join(' ');
  const right = q?.trim();
  if (left && right) {
    return `${left} — ${right}`;
  }
  return left || right || '';
}
```

- [ ] **Step 3：型別檢查**

Run: `npm run check-types`
Expected: pass

- [ ] **Step 4：Commit**

```bash
git add src/features/marketplace/MarketplaceEmptyCTA.tsx src/app/[locale]/\(unauth\)/marketplace/page.tsx
git commit -m "feat(marketplace): 新增 MarketplaceEmptyCTA 元件 + buildPrefill helper"
```

---

### Task 6: 替換 `QuizList` 空狀態為 CTA

**Files:**
- Modify: `src/app/[locale]/(unauth)/marketplace/page.tsx:189-196`

- [ ] **Step 1：替換 `QuizList` 空狀態 JSX**

修改 `src/app/[locale]/(unauth)/marketplace/page.tsx`，把 `QuizList` 內 `if (quizzes.length === 0)` 區塊（line 189-196）改為：

```tsx
if (quizzes.length === 0) {
  return <MarketplaceEmptyCTA type="quiz" prefill={buildPrefill(category, grade, q)} />;
}
```

- [ ] **Step 2：手動驗證**

Run: `npm run dev`
- 瀏覽器開 `/marketplace?category=高中數學&grade=高中&q=三角函數` → 應顯示紫色 CTA 卡，副標含「要不要讓 AI 幫你生一份『高中 高中數學 — 三角函數』？」
- 點按鈕（未登入）→ Clerk 攔截到 sign-in，登入後落 `/dashboard/quizzes/new?ai=1&prefill=...`，spinner → redirect 到 edit，AIQuizModal 主題框已預填
- 開 `/marketplace?q=不存在的關鍵字` → CTA 主題顯示「不存在的關鍵字」
- 開 `/marketplace`（不篩選）若 DB 有資料 → 不會看到 CTA（正常列表）

- [ ] **Step 3：Commit**

```bash
git add src/app/[locale]/\(unauth\)/marketplace/page.tsx
git commit -m "feat(marketplace): Quiz tab 空狀態換成 AI 命題 CTA"
```

---

### Task 7: 替換 `VocabList` 空狀態為 CTA

**Files:**
- Modify: `src/app/[locale]/(unauth)/marketplace/page.tsx:252-259`

- [ ] **Step 1：替換 `VocabList` 空狀態 JSX**

修改 `src/app/[locale]/(unauth)/marketplace/page.tsx`，把 `VocabList` 內 `if (sets.length === 0)` 區塊（line 252-259）改為：

```tsx
if (sets.length === 0) {
  return <MarketplaceEmptyCTA type="vocab" prefill={buildPrefill(category, grade, q)} />;
}
```

- [ ] **Step 2：手動驗證**

`npm run dev`
- 瀏覽器開 `/marketplace?type=vocab&category=英文&grade=高中&q=日常會話` → 紫色 CTA 卡，副標含「要不要建一份『高中 英文 — 日常會話』的單字卡？」
- 點按鈕 → 落 `/dashboard/vocab/new?title=高中%20英文%20—%20日常會話`（Task 8 完成後該頁卡集名稱會 prefill）

- [ ] **Step 3：Commit**

```bash
git add src/app/[locale]/\(unauth\)/marketplace/page.tsx
git commit -m "feat(marketplace): Vocab tab 空狀態換成 AI 命題 CTA"
```

---

### Task 8: `/dashboard/vocab/new` 讀 `?title` prefill

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/vocab/new/page.tsx:1-4` (import), `:73` (state init)

- [ ] **Step 1：加 useSearchParams import**

修改 `src/app/[locale]/(auth)/dashboard/vocab/new/page.tsx:1-4`：

```tsx
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
```

- [ ] **Step 2：用 query 初始化 title state**

修改 `src/app/[locale]/(auth)/dashboard/vocab/new/page.tsx`，在 `NewVocabPage` 函式內把 `const [title, setTitle] = useState('');`（line 73）替換為：

```tsx
// 來自市集 CTA → ?title=... 預填卡集名稱;否則空白
const searchParams = useSearchParams();
const initialTitle = searchParams.get('title') ?? '';
const [title, setTitle] = useState(initialTitle);
```

- [ ] **Step 3：型別檢查 + 手動驗證**

Run: `npm run check-types`
Expected: pass

`npm run dev`，瀏覽器開 `/dashboard/vocab/new?title=高中%20英文%20—%20日常會話`，「卡集名稱」欄位應已預填字串。

- [ ] **Step 4：Commit**

```bash
git add src/app/[locale]/\(auth\)/dashboard/vocab/new/page.tsx
git commit -m "feat(vocab): /dashboard/vocab/new 讀 ?title 預填卡集名稱"
```

---

### Task 9: 端到端 smoke test 清單（手動）

**Files:**（無檔案改動，純驗證）

執行下列七個情境，逐一勾選通過：

- [ ] **Step 1：Quiz CTA 完整 happy path（已登入）**

啟動 `npm run dev`，登入老師帳號，瀏覽器：
1. 開 `/marketplace?category=高中數學&grade=高中&q=三角函數`
2. 看到紫色 CTA 卡，副標寫「⋯『高中 高中數學 — 三角函數』⋯」
3. 點按鈕 → URL 跳到 `/dashboard/quizzes/new?ai=1&prefill=...`，看到「準備 AI 命題中⋯」spinner
4. 數秒內 URL 跳到 `/dashboard/quizzes/<id>/edit?ai=1&just_created=1&prefill=...`
5. AIQuizModal 自動開啟,主題框已預填「高中 高中數學 — 三角函數」

Expected: 五步驟全通過

- [ ] **Step 2：Quiz CTA 未登入流程**

登出，重複 Step 1：點按鈕 → Clerk 把人擋去 sign-in → 登入後應自動回到 `/dashboard/quizzes/new?ai=1&prefill=...`，後續同 Step 1 第 3-5 步。

Expected: redirect_url 保留完整 query

- [ ] **Step 3：Vocab CTA**

`/marketplace?type=vocab&category=英文&grade=高中&q=日常會話`
1. 看到紫色 CTA 卡（vocab 文案）
2. 點按鈕 → 落 `/dashboard/vocab/new?title=高中%20英文%20—%20日常會話`
3. 「卡集名稱」欄位已預填

Expected: 三步驟全通過

- [ ] **Step 4：Empty prefill 情境**

`/marketplace?q=絕對不存在的怪詞xyz123`
1. CTA 副標：「⋯『絕對不存在的怪詞xyz123』⋯」（仍有 prefill）

`/marketplace`（無篩選）若 DB 有資料 → 不出 CTA。若 DB 完全空 → CTA 副標走「換個篩選條件,或讓 AI 幫你生」分支，按鈕 href 是 `/dashboard/quizzes/new?ai=1`（無 prefill）。點按鈕 → spinner 不顯示主題、createQuiz 走 default flow。

Expected: 兩種情境文案正確

- [ ] **Step 5：QUOTA_EXCEEDED**

切到沒有 Pro 的 free 帳號（已用滿 10 次 AI 配額），重複 Step 1：
1. 點 CTA → spinner 顯示
2. 1-2 秒內 router.push 到 `/dashboard/billing`

Expected: 不卡 spinner、不出錯，順暢轉到升級頁

- [ ] **Step 6：特殊字元 encode**

`/marketplace?q=A%26B%3FC`（搜尋字含 `&` 與 `?`）
1. CTA 副標顯示原字串「A&B?C」
2. 點按鈕 → URL 正確 encode、AIQuizModal 主題框收到原字串「A&B?C」

Expected: 整鏈無 URL 截斷或字元錯亂

- [ ] **Step 7：向後相容**

直接打 `/dashboard/quizzes/new`（沒帶任何 query）→ 應顯示既有 QuizForm（手動建立）,不會被 AI trigger 影響。

Expected: 既有手動建測驗流程不破

- [ ] **Step 8：Commit smoke test 通過記錄(可省略)**

如果想記錄,加一個空 commit 或在 PR 描述貼勾選結果。否則直接進下一階段。

---

## 完成標準

- 所有 task 1-8 commit 落盤
- 所有 task 9 smoke 清單八步皆通過
- `npm run check-types` 通過
- `npm run lint` 通過（如果觸發 import sort 問題,跑 `npx eslint --fix`）
- Git status 乾淨（除了 plan 一開始就有的 untracked scripts）
