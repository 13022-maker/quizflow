# Trial 21 天 + Pill UX 擴展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Pro 試用期從 30 天改 21 天；新增 TrialPill 元件並整合到 quiz 列表 / editor，讓老師在工作頁面持續看到試用倒數。

**Architecture:** 改 1 個常數 + 2 處註解；新增 1 個 server component（`TrialPill`，沿用 `TrialBanner` 同樣的資料抓取模式）；在兩個 server page 內 mount。Dashboard 大 banner 與既有 trial 邏輯（schema、`isProOrAbove`、`ensureTrialRecord`）完全不動。

**Tech Stack:** Next.js 14 App Router、React Server Components、TypeScript、Tailwind CSS、Drizzle ORM、Clerk。

**Spec:** `docs/superpowers/specs/2026-04-25-trial-21-days-and-pills-design.md`

---

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `src/libs/trial.ts` | 修改 | 把 `TRIAL_DAYS` 從 30 改 21，註解同步 |
| `src/libs/Plan.ts` | 修改 | `isProOrAbove` 註解的 30 天字樣改 21 天 |
| `src/models/Schema.ts` | 修改 | `userTrialSchema` 上方註解改 21 天 |
| `src/features/dashboard/TrialPill.tsx` | 新增 | 輕量試用提示，三狀態 pill（試用中/緊急/到期） |
| `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx` | 修改 | 在標題列附近 mount `<TrialPill />` |
| `src/app/[locale]/(auth)/dashboard/quizzes/[id]/edit/page.tsx` | 修改 | 在 `<QuizEditor />` 上方 mount `<TrialPill />` |

無新檔需要新測試（既有專案無 vitest 覆蓋這些 server component；驗證走 lint + check-types + 本機視覺）。

---

### Task 1: 改試用天數 30 → 21（含註解）

**Files:**
- Modify: `src/libs/trial.ts:14`
- Modify: `src/libs/trial.ts:3-5` (檔頂註解 30 天)
- Modify: `src/libs/Plan.ts:78`
- Modify: `src/models/Schema.ts:248`

- [ ] **Step 1: 改 `src/libs/trial.ts` 常數與檔頂註解**

把第 3-5 行檔頂註解：

```ts
/**
 * 30 天 Pro 試用機制
 *
 * 策略：lazy init — 新用戶首次需要 Pro 資格時才建立試用紀錄，避免額外 Clerk webhook
```

改成：

```ts
/**
 * 21 天 Pro 試用機制
 *
 * 策略：lazy init — 新用戶首次需要 Pro 資格時才建立試用紀錄，避免額外 Clerk webhook
```

把第 14 行：

```ts
const TRIAL_DAYS = 30;
```

改成：

```ts
const TRIAL_DAYS = 21;
```

第 39 行的 `// 建立新試用紀錄：30 天後到期` 註解改成 `// 建立新試用紀錄：21 天後到期`。

- [ ] **Step 2: 改 `src/libs/Plan.ts` 註解**

第 78 行的 `*   2. user_trial 表在試用期內（30 天） → Pro` 改成：

```ts
 *   2. user_trial 表在試用期內（21 天） → Pro
```

- [ ] **Step 3: 改 `src/models/Schema.ts` 註解**

第 248 行的 `// 新註冊老師自動獲得 30 天 Pro 試用（首次查詢 lazy init 建立此紀錄）` 改成：

```ts
// 新註冊老師自動獲得 21 天 Pro 試用（首次查詢 lazy init 建立此紀錄）
```

- [ ] **Step 4: 確認沒有遺漏的 30 天字樣**

Run: `grep -rn "30 天\|30天\|30 days\|TRIAL_DAYS" src/libs/ src/features/dashboard/TrialBanner.tsx src/models/Schema.ts`

Expected：除了已修改的位置外，不應有「30 天」字樣指 trial（若有非 trial 的 30 天字樣可忽略）。

- [ ] **Step 5: 跑 type check 與 lint**

Run: `npm run check-types 2>&1 | grep -E "(trial|Trial|Plan\.ts|Schema\.ts)" | head -10`
Expected: 0 行（與這些檔案有關的錯誤）— pre-existing 的 schema mismatch 錯誤不計

Run: `npm run lint 2>&1 | grep -E "(trial|Trial|Plan\.ts|Schema\.ts)"`
Expected: 0 行

- [ ] **Step 6: Commit**

```bash
git add src/libs/trial.ts src/libs/Plan.ts src/models/Schema.ts
git commit -m "$(cat <<'EOF'
feat(trial): 試用期從 30 天縮短為 21 天

只改常數與註解；不寫 migration、不 backfill 既有紀錄（production 未上線）。
新邏輯只影響未來新建 user_trial 紀錄的 endsAt 計算。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 新增 `TrialPill` 元件

**Files:**
- Create: `src/features/dashboard/TrialPill.tsx`

- [ ] **Step 1: 建立 TrialPill server component**

寫入 `src/features/dashboard/TrialPill.tsx`：

```tsx
/**
 * TrialPill — 工作頁面（測驗列表 / quiz editor）顯示輕量試用倒數
 *
 * 與 TrialBanner 差異：
 *   - 試用「全期」都顯示（TrialBanner 只在 ≤7 天才顯示）
 *   - 樣式為 inline-flex pill，不占整列
 *   - 同樣支援 ≤3 天紅色警示與到期灰色
 */

import Link from 'next/link';

import { getOrgPlanId } from '@/libs/Plan';
import { getTrialStatus } from '@/libs/trial';
import { PLAN_ID } from '@/utils/AppConfig';

type Props = {
  clerkUserId: string;
  orgId: string | null | undefined;
};

export async function TrialPill({ clerkUserId, orgId }: Props) {
  // 已付費用戶：完全不顯示 pill
  const planId = await getOrgPlanId(orgId ?? '');
  if (planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE || planId === PLAN_ID.PUBLISHER) {
    return null;
  }

  // 沒試用紀錄（未走過 isProOrAbove）：不顯示
  const trial = await getTrialStatus(clerkUserId);
  if (!trial) {
    return null;
  }

  const baseClass
    = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors';

  // 試用中
  if (trial.inTrial) {
    const urgent = trial.daysLeft <= 3;
    const stateClass = urgent
      ? 'bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200'
      : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15';
    const icon = urgent ? '⏰' : '🎁';
    return (
      <Link href="/dashboard/billing" className={`${baseClass} ${stateClass}`}>
        <span aria-hidden="true">{icon}</span>
        <span>
          Pro 試用
          {urgent ? '剩' : ' '}
          {trial.daysLeft}
          {' '}
          天
        </span>
      </Link>
    );
  }

  // 試用已到期
  return (
    <Link
      href="/dashboard/billing"
      className={`${baseClass} bg-muted text-muted-foreground border border-border hover:bg-muted/80`}
    >
      <span aria-hidden="true">🔒</span>
      <span>試用已結束</span>
    </Link>
  );
}
```

- [ ] **Step 2: 跑 type check 與 lint，確認新檔乾淨**

Run: `npm run check-types 2>&1 | grep "TrialPill"`
Expected: 0 行

Run: `npm run lint 2>&1 | grep "TrialPill"`
Expected: 0 行

- [ ] **Step 3: Commit**

```bash
git add src/features/dashboard/TrialPill.tsx
git commit -m "$(cat <<'EOF'
feat(trial): 新增 TrialPill 輕量元件

server component，三狀態：
- 試用中（綠色 pill）
- ≤3 天緊急（橙色 pill）
- 已到期（灰色 pill）

整顆 pill 為 Link 指向 /dashboard/billing。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 整合到測驗列表頁

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx`

- [ ] **Step 1: 確認 page 是否已抓 userId**

Run: `grep -n "auth()\|userId\|orgId" src/app/\[locale\]/\(auth\)/dashboard/quizzes/page.tsx | head -10`

Expected: 看到 `const { orgId } = await auth()`，但**沒有** `userId`。需在下一步補抓 userId。

- [ ] **Step 2: 加 import 與 userId 抓取，mount TrialPill**

修改 `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx`：

(a) 在現有 imports 區塊加：

```ts
import { TrialPill } from '@/features/dashboard/TrialPill';
```

(b) 把：

```ts
const { orgId } = await auth();
```

改成：

```ts
const { orgId, userId } = await auth();
```

(c) 在 JSX return 內、第一個 `<TitleBar ... />` 上方或同一列旁邊（看 layout 對齊），插入 pill。具體位置：找到 return JSX 中現有的標題區塊（`<TitleBar title={t('title_bar')} ...>` 或類似），在標題塊之內，於 actions 區域加上：

```tsx
{userId && <TrialPill clerkUserId={userId} orgId={orgId} />}
```

實際插入位置依該檔 JSX 結構而定 — 找到 page 第一塊 header / TitleBar 區，把 `<TrialPill />` 加到該 header 的右側 actions（與「建立測驗」按鈕同一群）。

- [ ] **Step 3: 本機開 dev 確認渲染位置與樣式**

Run: `npm run dev` (background)，瀏覽器開 `http://localhost:3000/zh/dashboard/quizzes`，確認 pill 出現在標題列、與「建立測驗」按鈕同一橫排、不擠不換行。

- [ ] **Step 4: 跑 type check 與 lint**

Run: `npm run check-types 2>&1 | grep "quizzes/page.tsx"`
Expected: 0 行

Run: `npm run lint 2>&1 | grep "quizzes/page.tsx"`
Expected: 0 行

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/\(auth\)/dashboard/quizzes/page.tsx
git commit -m "$(cat <<'EOF'
feat(trial): 測驗列表頁顯示 TrialPill

在標題列 actions 區加 TrialPill；
非試用 / 已付費用戶不會看到。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 整合到 Quiz Editor 編輯頁

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/quizzes/[id]/edit/page.tsx`

QuizEditor 是 client component，server-component 形式的 `TrialPill` 不能放進去。處理方式：在 server page（即此檔）裡渲染 pill 為 `<QuizEditor />` 的兄弟節點。

- [ ] **Step 1: 加 import 與 userId 抓取**

修改 `src/app/[locale]/(auth)/dashboard/quizzes/[id]/edit/page.tsx`：

(a) 在現有 imports 區塊加：

```ts
import { TrialPill } from '@/features/dashboard/TrialPill';
```

(b) 把：

```ts
const { orgId } = await auth();
```

改成：

```ts
const { orgId, userId } = await auth();
```

- [ ] **Step 2: 用 wrapper 把 TrialPill 放在 QuizEditor 上方**

把第 95 行的：

```tsx
return <QuizEditor quiz={quiz as any} questions={questions} isPro={isPro} autoOpenAI={autoOpenAI} />;
```

改成：

```tsx
return (
  <>
    {userId && (
      <div className="mb-4 flex justify-end">
        <TrialPill clerkUserId={userId} orgId={orgId} />
      </div>
    )}
    <QuizEditor quiz={quiz as any} questions={questions} isPro={isPro} autoOpenAI={autoOpenAI} />
  </>
);
```

> 註：右對齊放在 QuizEditor 上方一個獨立列，避免與 QuizEditor 內部按鈕擠在一起。實作後若視覺不佳可再調 layout（margin / 對齊方式）。

- [ ] **Step 3: 本機開 dev 確認渲染位置**

接續上 Task 的 `npm run dev`，瀏覽器打開 `/zh/dashboard/quizzes/{anyId}/edit`，確認 pill 出現在 QuizEditor 上方右側、不擠到既有按鈕。

- [ ] **Step 4: 跑 type check 與 lint**

Run: `npm run check-types 2>&1 | grep "edit/page.tsx"`
Expected: 0 行

Run: `npm run lint 2>&1 | grep "edit/page.tsx"`
Expected: 0 行

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/\(auth\)/dashboard/quizzes/\[id\]/edit/page.tsx
git commit -m "$(cat <<'EOF'
feat(trial): Quiz Editor 編輯頁顯示 TrialPill

在 QuizEditor 上方一列渲染 TrialPill；
QuizEditor 是 client component 無法直接吃 server component pill，
故在 server page 容器層放兄弟節點。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 三狀態 + 21 天新邏輯本機完整驗證

**Files:** 不改任何檔；走資料庫操作 + 視覺驗證。

- [ ] **Step 1: 確認本機 dev 已啟動**

如果還沒啟動：`npm run dev` (background)。
驗證：`curl -s -o /dev/null -w "%{http_code}\n" -L http://localhost:3000/zh/dashboard` — 期待 200 或 redirect 到 sign-in，總之非 500。

- [ ] **Step 2: 取得測試帳號的 trial 紀錄 id**

開另一個 terminal：`npm run db:studio`，瀏覽器開 Drizzle Studio，找到 `user_trial` 表。記下測試帳號的列。

如果該帳號還沒走過 `isProOrAbove`、沒有 user_trial 紀錄：登入後到 dashboard 點任何 AI 出題入口（會自動 lazy init）。

- [ ] **Step 3: 跑場景 A — 試用中（剩 5 天）**

在 Drizzle Studio 把 `endsAt` 改成 `now() + 5 days`（例：今天是 2026-04-25，改成 `2026-04-30 12:00:00`）。

瀏覽器重新整理三個頁面：
- `/zh/dashboard` — 預期看到大 banner 綠色「Pro 試用剩 5 天」+「升級 Pro」按鈕（≤7 天才出現）
- `/zh/dashboard/quizzes` — 預期看到綠色 pill「🎁 Pro 試用 5 天」
- `/zh/dashboard/quizzes/{anyId}/edit` — 預期看到綠色 pill「🎁 Pro 試用 5 天」

- [ ] **Step 4: 跑場景 B — 緊急（剩 2 天）**

把 `endsAt` 改成 `now() + 2 days`。

重新整理：
- dashboard 大 banner 變橙色 + ⏰
- 兩個 pill 變橙色 + ⏰，文字「⏰ Pro 試用剩 2 天」

- [ ] **Step 5: 跑場景 C — 已到期（昨天結束）**

把 `endsAt` 改成 `now() - 1 day`。

重新整理：
- dashboard 灰色 banner「Pro 試用已結束」+「升級 Pro」
- 兩個 pill 變灰色「🔒 試用已結束」

- [ ] **Step 6: 驗證 21 天新邏輯**

刪除測試帳號的 `user_trial` 列（在 Drizzle Studio）。
重新整理 dashboard 或觸發任何走 `isProOrAbove` 的 server action（最簡單：到 dashboard 即可，Plan.ts 會 lazy init）。
回 Drizzle Studio 看新建的 `user_trial` 列：`endsAt - startedAt` 應為 21 天而非 30 天。

具體 SQL 驗證（可選）：在 Drizzle Studio SQL 介面跑 `SELECT clerk_user_id, ends_at::date - started_at::date AS days FROM user_trial WHERE clerk_user_id = '...';` 應為 `21`。

- [ ] **Step 7: 場景 D — 已付費用戶不顯示**

在 Drizzle Studio `subscription` 表為測試帳號插入 `status='active'`、`plan='pro'` 的列（或拿 sandbox 訂閱觸發）。
重新整理三個頁面：dashboard banner、兩個 pill 全部不顯示。

驗證完把該 row 刪除回原狀。

- [ ] **Step 8: 跑全專案 lint + check-types 終檢**

Run: `npm run lint 2>&1 | tail -3`
Expected: `0 errors`（warnings 可接受，皆為既有）

Run: `npm run check-types 2>&1 | tail -5`
Expected: 只有與本刀無關的 pre-existing 錯誤（`publisherId/isbn/chapter/bookTitle`）

- [ ] **Step 9: 關閉 dev server**

```bash
pkill -f "next dev"; pkill -f "spotlight-sidecar"
```

---

### Task 6: Push + 開 PR

- [ ] **Step 1: 確認所有變更已 commit**

Run: `git status`
Expected: `nothing to commit, working tree clean`（除了 `.claude/commands/` 既有 untracked，可忽略）

Run: `git log main..HEAD --oneline`
Expected: 看到 5 個 commit（spec doc + 4 個 feat）

- [ ] **Step 2: Push 分支**

```bash
git push -u origin feat/trial-21-days
```

- [ ] **Step 3: 建 PR**

```bash
gh pr create --base main --head feat/trial-21-days --title "feat(trial): 試用期改 21 天 + TrialPill UX 擴展" --body "$(cat <<'EOF'
## Summary
- 試用期從 30 天縮短為 21 天（不 backfill 既有紀錄）
- 新增 \`TrialPill\` 輕量元件（server component），三狀態：試用中（綠）/ ≤3 天緊急（橙）/ 已到期（灰）
- 整合到測驗列表頁與 Quiz Editor 編輯頁；Dashboard 大 banner 維持不動

## Why
試用期縮短可加速付費漏斗轉換；補強 UX 讓老師在工作頁也持續看到試用狀態，提早觸發升級決策。Spec: \`docs/superpowers/specs/2026-04-25-trial-21-days-and-pills-design.md\`

## Test plan
- [x] 本機 dev：3 個天數場景（5d / 2d / -1d）+ 已付費 + 21 天新建邏輯，全 6 場景視覺驗證
- [x] \`npm run lint\`：本刀 0 錯
- [x] \`npm run check-types\`：本刀 0 錯（pre-existing schema 錯誤與本刀無關）
- [ ] **Vercel preview**：PR 部署後再跑一輪 5d / 2d / -1d 視覺驗證

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: 印出 PR URL。

---

## Self-Review Checklist

- [x] **Spec coverage** — 所有 spec 章節都有對應 task：
  - 改 21 天 → Task 1
  - TrialPill 元件 → Task 2
  - quizzes 列表整合 → Task 3
  - quiz editor 整合 → Task 4
  - 4 個驗證場景 → Task 5
  - 不動的東西（schema / Banner / isProOrAbove）→ 沒有 task = 確實不動 ✅

- [x] **Placeholder scan** — 沒有 TBD / TODO / 「實作後再說」/ 不完整 code block。

- [x] **Type consistency** — `TrialPill` 在 Task 2 定義 `clerkUserId: string; orgId: string | null | undefined`；Task 3 / 4 呼叫一致。

- [x] **Granularity** — 每步 2-5 分鐘可完成；commit 頻率足夠細（每個 task 一個 commit + spec 已單獨 commit）。
