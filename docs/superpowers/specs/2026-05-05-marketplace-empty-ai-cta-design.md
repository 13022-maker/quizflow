# 題庫市集空狀態 AI 命題 CTA — 設計文件

- 日期：2026-05-05
- 範圍：`/marketplace`（unauth）兩個 tab 的空狀態加上「直接 AI 生成自己的學習材料」CTA，並把目前篩選條件當主題 prefill 帶到 AI 命題畫面
- 對應 issue：暫無，由對話內提出

## 動機

目前 `/marketplace` 兩種 tab（測驗 / 單字卡）在篩選後沒有結果時，顯示乾癟的「目前還沒有符合條件的測驗 / 快來分享你的第一份吧」文案。這對找不到題庫的使用者沒幫助 — 他們的需求很明確（看篩選條件就知道想要什麼），既然市集沒貨，就應該主動把他們導向 AI 命題流程，把「找不到」轉成「自己生」。

## 設計

### 整體流程

```
/marketplace?category=高中數學&grade=高中&q=三角函數
  ↓ (篩選後 quizzes/sets 為空)
[CTA 卡片：找不到？AI 即時幫你生一份「高中 高中數學 — 三角函數」]
  ↓ (Quiz tab 點擊)                       ↓ (Vocab tab 點擊)
/dashboard/quizzes/new?prefill=...       /dashboard/vocab/new?title=...
  ↓ (Clerk 攔未登入 → 登入後 redirect_url 還原 query)
[Quiz: 既有 server page，prefill 分支]    [Vocab: 既有 client page]
  - 有 prefill → 渲染 AiPrefillTrigger     - useState 初始值讀 ?title
    無 prefill → 保留現有 QuizForm
  - AiPrefillTrigger useEffect 呼叫
    createQuiz({ prefill })
  ↓
createQuiz server action
  - 加可選參數 prefill
  - redirect: /edit?ai=1&just_created=1&prefill=<encoded>
  ↓
/dashboard/quizzes/[id]/edit
  - 讀 searchParams.prefill
  - <AIQuizModal defaultTopic={prefill} />
  ↓
AIQuizModal 自動開啟、主題框已預填，使用者按「生成」即可
```

### Prefill 字串格式

組裝規則（在 marketplace `buildPrefill(category, grade, q)` helper）：

```
[grade] [category] — [q]
```

- 三項都有：`高中 高中數學 — 三角函數`
- 缺 q：`高中 高中數學`
- 缺 grade：`高中數學 — 三角函數`
- 只有 q：`三角函數`
- 三項都缺：不出 CTA 主題，只顯示通用 CTA 文字（這個情境不會出現，因為三項都空時 query 就沒任何 filter，市集會回所有資料、不會空）

格式選擇 `[grade] [category] — [q]` 是為了跟既有 `AIQuizModal` 的 `QUICK_TEMPLATES.topic` 樣式一致（例：`國中數學 — 一元一次方程式的解法與應用`），讓 AI prompt 收到的格式穩定，出題品質不受影響。

### 改動點清單

#### 1. `src/app/[locale]/(unauth)/marketplace/page.tsx`

- 新增 module-level helper `buildPrefill(category?: string, grade?: string, q?: string): string`
- `QuizList` 空狀態（line 189–196）改成 CTA 卡：
  - 圖示（紫色 sparkle，呼應 `QuickCreateAIButton`）
  - 主標：「目前還沒有符合條件的測驗」
  - 副標：依篩選條件動態變化
    - 有 prefill：「要不要讓 AI 幫你生一份『{prefill}』？」
    - 無 prefill：「換個篩選條件，或讓 AI 幫你生一份新的測驗」
  - 按鈕：「✨ 用 AI 立即生成」 → `<Link>`，永遠帶 `?ai=1` 旗標：prefill 非空時 `href = /dashboard/quizzes/new?ai=1&prefill=<encoded>`，prefill 為空時 `href = /dashboard/quizzes/new?ai=1`（仍進 AI trigger 模式，主題框留空讓使用者輸入）
- `VocabList` 空狀態（line 252–259）同上模式：
  - 主標：「目前還沒有符合條件的單字卡集」
  - 副標：「要不要建一份『{prefill}』的單字卡？AI 幫你補釋義」（誠實提示要自己輸入單字）
  - 按鈕：「✨ 開始建立單字卡」 → `<Link>`，prefill 非空時 `href = /dashboard/vocab/new?title=<encoded>`，prefill 為空時 `href = /dashboard/vocab/new`

#### 2. `src/app/[locale]/(auth)/dashboard/quizzes/new/page.tsx`（修改：既有檔，含手動 QuizForm 入口）

該 page 是 **server component**，現況渲染 `<QuizForm />`（手動建立測驗表單）+ quota 牆檢查。本次改動：

- 讀 `searchParams?.ai === '1'` 與 `searchParams?.prefill`
- 若 `ai === '1'`：渲染新的 client 元件 `<AiPrefillTrigger prefill={prefill ?? ''} />`（替代 `QuizForm`），quota 牆檢查仍保留在 server 端、超額時直接 return `<QuizLimitWall>`，不進入 trigger
- 若 `ai !== '1'`：保留現有行為（渲染 `QuizForm`），完全向後相容

新增的 client 元件 `src/features/quiz/AiPrefillTrigger.tsx`：

- `'use client'`
- props：`{ prefill: string }`
- `useEffect`（mount 一次，guard 用 `useRef` 避免 Strict Mode dev 雙觸發）：呼叫 `createQuiz({ title: getDefaultTitle(), prefill })`，server action 成功自行 redirect，client 不會跑到後續
- 顯示 loading 畫面：紫色 spinner + 「準備 AI 命題中⋯」+ 在下方淡化顯示主題字串供使用者確認
- 失敗處理對齊 `QuickCreateAIButton`：quota → `router.push('/dashboard/billing')`，其他 → `alert(result.error)` + 提供「返回儀表板」連結

#### 3. `src/actions/quizActions.ts`

- `createQuiz` 函式 signature：加可選參數
  ```ts
  type CreateQuizInput = {
    title: string;
    prefill?: string;   // 新增
  };
  ```
- redirect 字串（line 112）改為條件性附加：
  ```ts
  const prefillParam = prefill ? `&prefill=${encodeURIComponent(prefill)}` : '';
  redirect(`/dashboard/quizzes/${inserted.id}/edit?ai=1&just_created=1${prefillParam}`);
  ```
- 不影響現有 caller（`QuickCreateAIButton` 不傳 prefill，行為不變）

#### 4. Edit 頁 prefill 串接（兩檔）

`src/app/[locale]/(auth)/dashboard/quizzes/[id]/edit/page.tsx`

- 擴充 `searchParams` 型別：加 `prefill?: string`
- 把 `searchParams.prefill`（Next.js 已自動 decode）傳給 `<QuizEditor aiPrefill={...} />`

`src/features/quiz/QuizEditor.tsx`

- props 加可選 `aiPrefill?: string`
- `AIQuizModal` / `VocabAIModal` 的 `defaultTopic` 改成：`aiPrefill ?? buildDefaultTopic(initialQuiz.description)`（prefill 優先，fallback 現有行為）
- `AIQuizModal` 既有 `defaultTopic` prop 直接相容（`AIQuizModal.tsx:143, 157`）

#### 5. `src/app/[locale]/(auth)/dashboard/vocab/new/page.tsx`

- 加 `import { useSearchParams } from 'next/navigation';`
- 加初始值：
  ```ts
  const searchParams = useSearchParams();
  const initialTitle = searchParams.get('title') ?? '';
  const [title, setTitle] = useState(initialTitle);
  ```
- `words` state 不動（使用者自己輸入單字）

### Vocab tab 的已知不對稱（接受不修）

Quiz tab 體驗完整：prefill 主題 → AI 直接出題。

Vocab tab 只 prefill 卡集名稱，使用者落地 `/dashboard/vocab/new` 後仍要自己輸入單字清單，`/api/ai/generate-flashcards` 才會幫忙補釋義 + 例句。

不對稱的原因：vocab AI 生成有兩條 pipeline，`/api/ai/generate-vocab`（topic → 詞彙清單）只綁在 `VocabAIModal` 裡（QuizEditor 匯入題目流程），沒有獨立入口。要讓 Vocab CTA 達到 Quiz tab 同等體驗（topic → cards 直通），需要新增 standalone topic-mode 入口或新 pipeline，scope 與本次 CTA 工作不同（規模約 0.5–1 天），列為未來迭代。

副標文案誠實說明使用者要自己輸入單字（「AI 幫你補釋義」），預期不會被錯誤拉高。

### 邊界條件

| 情境 | 行為 |
|---|---|
| 三個篩選條件全空時的空狀態 | 不會發生（三項全空 query 沒 filter，市集 server-side 用 `eq(visibility, 'public')` 仍會回全部 public 資料；除非 DB 完全沒貨） |
| DB 完全沒 public 資料（產品初期） | CTA 副標走「無 prefill」分支：「換個篩選條件，或讓 AI 幫你生一份新的測驗」 |
| 使用者點 CTA 但未登入 | Clerk middleware 攔截 → `redirect_url` 帶完整 query → 登入後返回 `/dashboard/quizzes/new?prefill=...` 或 `/dashboard/vocab/new?title=...`，prefill 不掉 |
| 使用者已登入但 AI 配額用完 | `createQuiz` 偵測到 `QUOTA_EXCEEDED` → 新 page 接到 result.error → `router.push('/dashboard/billing')`（沿用 `QuickCreateAIButton` 既有處理） |
| prefill 字串長度 | 預期 ≤30 中文字（grade + category + q），encode 後 ~120 chars，遠低於常見 URL 長度限制 |
| prefill 含特殊字元（`&`、`?`、`#`） | 全鏈路用 `encodeURIComponent` / Next.js searchParams 自動 decode，無需特殊處理 |
| 使用者直接打 `/dashboard/quizzes/new` 沒帶 prefill | 一樣建立空白 quiz、redirect 到 edit、AIQuizModal 開啟（無 prefill），等同 `QuickCreateAIButton` 行為 |

### 不做什麼（YAGNI）

- 不做 Vocab tab 的 topic → cards 直通 pipeline（見上節）
- 不把 prefill 條件做語意分析或翻譯（直接拼字串，靠 AI 自己 parse）
- 不在 marketplace 加「我猜你想找的」AI 推薦清單（這是另一個 feature，列在 memory 裡的 pending features）
- 不改 `AIQuizModal` 或 `VocabAIModal` 既有 props（兩個都已有 `defaultTopic`，直接 reuse）

## 測試計畫

實作完成後手動驗證：

1. 未登入打 `/marketplace?category=高中數學&grade=高中&q=三角函數` → 看到空狀態 CTA，主題顯示「高中 高中數學 — 三角函數」
2. 點 Quiz CTA → Clerk 把人擋去 sign-in → 登入後落 `/dashboard/quizzes/new?prefill=...` → loading 畫面 → redirect 到 edit → AIQuizModal 主題框已預填
3. 點 Vocab CTA（vocab tab）→ 落 `/dashboard/vocab/new?title=...` → 卡集名稱欄已預填
4. 已登入直接點 Quiz CTA → 同上但跳過 sign-in
5. 三個篩選都不選、搜尋空字串、結果為空 → CTA 副標走「無 prefill」分支，按鈕仍可點
6. AI 配額用完的免費使用者點 Quiz CTA → 落 `/dashboard/billing`
7. prefill 含 `&`、`?` → URL 正確 encode、AIQuizModal 收到原字串

不寫自動測試 — 改動以 UI / route 為主，core logic 改動小，sync 跑 e2e ROI 低。

## 風險與緩解

| 風險 | 緩解 |
|---|---|
| 使用者不知道 CTA 會動到 AI 配額 | CTA 副標明寫「AI 幫你生」，按鈕帶 ✨ icon；落地 `/dashboard/quizzes/new` 後 loading 畫面顯示「準備 AI 命題中⋯」；超額時跳 billing |
| `/dashboard/quizzes/new` 被使用者書籤亂打導致建一堆空 quiz | createQuiz 既有 quota 限制（Free 10 次/月）天然擋；`QuickCreateAIButton` 也是同樣 pattern 在用，沒看到濫用回報 |
| Vocab tab CTA 體驗弱（只 prefill title） | 副標誠實寫「輸入單字 AI 幫你補釋義」，預期管理使用者預期；後續真有強需求再做 topic→cards 直通 |
| Clerk redirect_url 對 query 處理 | Clerk 會把整個 path + query 當 string 存進 `redirect_url`，登入後完整還原，已知行為 |

## 不解問題（無）

設計過程中發現的所有 decision 都已在文件裡明確記錄，無待議事項。
