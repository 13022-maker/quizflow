# 適性學習「AI 生成學科」YouTube 匯入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 老師在「AI 生成學科」表單新增「從 YouTube 匯入」模式，貼 1~5 支單支影片網址，AI
自動生成含知識圖譜（每點可綁定來源影片關鍵片段）＋依 Bloom 認知層次分類的題庫的草稿學科，
審核發佈後學生才能作答；學生卡關補強時可點「重看關鍵片段」跳回影片對應時間點。

**Architecture:** 沿用既有「AI 生成學科」pipeline 架構（server action → `generateSubject` 家族
→ `generateAIText` 統一 AI 入口 → 存入 `adaptive_subject` JSONB 欄位），但 YouTube 模式的
prompt／schema／存檔邏輯全部**獨立成新檔案**，不修改既有文字／檔案模式的程式碼路徑。新增
`status`（draft/published）欄位把關「發佈前不可建立可分享的適性練習」。

**Tech Stack:** Next.js 14 App Router Server Actions、Drizzle ORM（PostgreSQL / PGlite）、
Zod、`youtube-transcript` npm 套件、Vitest + Testing Library、既有 `src/lib/ai/textModel.ts`
Claude/Gemini 分流入口。

**Spec:** `docs/superpowers/specs/2026-09-19-adaptive-subject-youtube-import-design.md`

## Global Constraints

- 不修改既有「貼文字」「上傳檔案」兩種學科生成模式的程式碼與行為（`generate-subject.ts` 的
  `generatedSubjectSchema`／`SYSTEM_PROMPT`／`generateSubject()`／`toSubject()`／
  `saveGeneratedSubject()` 全部維持原樣）。
- 不修改 `src/app/api/ai/generate-from-url/route.ts`（既有一般測驗出題的 YouTube 匯入功能）。
- Playlist 網址不支援；老師手動貼多支單支影片 URL，**最多 5 支**。
- 整個匯入**同步執行完，不做 queue／背景任務／進度輪詢**。
- 逐字稿抽取沿用免費的 `youtube-transcript` 套件（已是專案既有相依套件），不接第三方付費
  transcript API。
- 教材文字總長度上限沿用既有 **20000 字元**（比照文字模式 `<教材>` 截斷邏輯）。
- 每次匯入（不論幾支影片）只算**一次** `checkAndIncrementAiUsage` quota 扣點。
- 任一支影片抽字幕失敗就**整批中止**，不做部分略過。
- 新學科一律 `status: 'draft'`，`assertSubjectUsable` 與 `listAvailableSubjects` 都要擋草稿。
- 「重看關鍵片段」入口**只**出現在卡關補強課文畫面，不出現在一般答題畫面。
- 全部新增程式碼註解與 UI 文字一律繁體中文；變數/函式/檔名英文（camelCase/kebab-case）。
- Timeout：**不需要**額外設定 `maxDuration`。Vercel Functions 目前平台預設執行時間已是
  300 秒（非舊版的 60~90 秒），跟既有文字模式的 `generateAdaptiveSubject`（同樣是「約需
  1~3 分鐘」、同樣完全沒宣告 `maxDuration`）處境相同，不用特別覆寫。（`generate-subject-from-file`
  route 那個顯式設成 `60` 反而把預設值往下蓋的既有落差，維持 spec 已記錄的「範圍外，不修」。）

---

## 檔案總覽

**新增：**
- `src/libs/youtube.ts` — 保留 timestamp 的抽字幕、清洗、URL 驗證（YouTube 匯入模式專用）
- `src/libs/youtube.test.ts`
- `src/libs/adaptive/generate-subject-from-youtube.ts` — YouTube 模式的 prompt／schema／生成函式
- `src/libs/adaptive/generate-subject-from-youtube.test.ts`
- `migrations/xxxx_xxx.sql`（`npm run db:generate` 自動產生，檔名由 drizzle-kit 決定）

**修改：**
- `src/models/Schema.ts` — `adaptiveSubjectSchema` 加 `status`／`sourceUrls`，`graph`／`itemBank`
  的 `$type<>` 加 `videoRef`／`bloomLevel`
- `src/libs/adaptive/engine.ts` — `KnowledgeNode`／`Item` 型別加 `videoRef`／`bloomLevel`
- `src/libs/adaptive/generate-subject.ts` — `extractJson` 改成 export（供新檔重用）
- `src/libs/adaptive/tutor.ts` — `RemedialLesson` 加 `videoRef`，`getNextStep()` 把 KC 的
  `videoRef` 貼到課文物件上
- `src/actions/adaptiveActions.ts` — 新增 `saveGeneratedYoutubeSubject`／
  `generateAdaptiveSubjectFromYoutube`／`publishAdaptiveSubject`；擴充
  `assertSubjectUsable`／`listAvailableSubjects`／`listMySubjectsForManagement`
- `src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx` — 第三個 tab
- `src/app/[locale]/(auth)/dashboard/adaptive/subjects/page.tsx` — 草稿 badge
- `src/components/adaptive/SubjectActionsMenu.tsx` — 「審核並發佈」選項
- `src/app/[locale]/(unauth)/adaptive/[code]/AdaptiveLearnClient.tsx` — 補強課文卡片加
  「重看關鍵片段」按鈕 + YouTube IFrame Player

---

### Task 1: Schema migration — `adaptive_subject` 加欄位＋型別擴充

**Files:**
- Modify: `src/models/Schema.ts:1-17`（imports，確認 `check`／`sql` 已匯入——已有，不用改動）
- Modify: `src/models/Schema.ts:584-614`（`adaptiveSubjectSchema` 定義）
- Modify: `src/libs/adaptive/engine.ts:25-45`（`KnowledgeNode`／`Item` 型別）
- Create: `migrations/xxxx_xxx.sql`（`npm run db:generate` 產生）

**Interfaces:**
- Produces：`adaptiveSubjectSchema.status: 'draft' | 'published'`（預設 `'published'`）、
  `adaptiveSubjectSchema.sourceUrls: string[] | null`；
  `KnowledgeNode.videoRef?: { videoId: string; startSec: number; endSec: number }`；
  `Item.bloomLevel?: '記憶' | '理解' | '應用' | '分析' | '評鑑' | '創造'`。
  後續所有 Task 都靠這幾個型別名稱與欄位名稱對接，不可改名。

- [ ] **Step 1: 修改 `src/models/Schema.ts` 的 `adaptiveSubjectSchema`**

把（`src/models/Schema.ts:584-614`）整段：

```ts
export const adaptiveSubjectSchema = pgTable('adaptive_subject', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull(), // Clerk user ID（建立學科的老師）
  name: text('name').notNull(), // 學科顯示名稱（AI 取名，例如「二次函數」）
  sourceTopic: text('source_topic').notNull(), // 老師輸入的主題（重生成／追溯用）
  graph: jsonb('graph').notNull().$type<{
    nodes: { id: string; name: string; prerequisites: string[] }[];
  }>(),
  itemBank: jsonb('item_bank').notNull().$type<{
    items: {
      id: string;
      knowledgeId: string;
      difficulty: number;
      prompt: string;
      options: string[];
      answerIndex: number;
      explanation?: string;
    }[];
  }>(),
  tutor: jsonb('tutor').notNull().$type<{
    lessonExampleRule: string;
    formatRule: string;
  }>(),
  archivedAt: timestamp('archived_at', { mode: 'date' }), // null = 未封存；封存後從「建立新練習」下拉選單消失，但既有練習不受影響
  pinned: boolean('pinned').default(false).notNull(), // 釘選：下拉選單與管理頁排最前面
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});
```

改成：

```ts
export const adaptiveSubjectSchema = pgTable(
  'adaptive_subject',
  {
    id: serial('id').primaryKey(),
    ownerId: text('owner_id').notNull(), // Clerk user ID（建立學科的老師）
    name: text('name').notNull(), // 學科顯示名稱（AI 取名，例如「二次函數」）
    sourceTopic: text('source_topic').notNull(), // 老師輸入的主題（重生成／追溯用）
    graph: jsonb('graph').notNull().$type<{
      nodes: {
        id: string;
        name: string;
        prerequisites: string[];
        videoRef?: { videoId: string; startSec: number; endSec: number }; // YouTube 匯入才有值：該知識點對應的來源影片關鍵片段
      }[];
    }>(),
    itemBank: jsonb('item_bank').notNull().$type<{
      items: {
        id: string;
        knowledgeId: string;
        difficulty: number;
        prompt: string;
        options: string[];
        answerIndex: number;
        explanation?: string;
        bloomLevel?: '記憶' | '理解' | '應用' | '分析' | '評鑑' | '創造'; // YouTube 匯入才有值：Bloom's Taxonomy 認知層次
      }[];
    }>(),
    tutor: jsonb('tutor').notNull().$type<{
      lessonExampleRule: string;
      formatRule: string;
    }>(),
    archivedAt: timestamp('archived_at', { mode: 'date' }), // null = 未封存；封存後從「建立新練習」下拉選單消失，但既有練習不受影響
    pinned: boolean('pinned').default(false).notNull(), // 釘選：下拉選單與管理頁排最前面
    // 草稿/發佈狀態：預設 published 讓既有文字/檔案模式行為不變；只有 YouTube 匯入會明確寫入 draft
    status: text('status').$type<'draft' | 'published'>().default('published').notNull(),
    sourceUrls: jsonb('source_urls').$type<string[]>(), // YouTube 匯入的來源影片網址；其餘模式維持 null
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    // status 限定兩態（用 text + CHECK，避免 PG enum 加新值要 ALTER TYPE 的痛，比照 quizSchema.visibility 既有寫法）
    statusCheck: check(
      'adaptive_subject_status_check',
      sql`${table.status} IN ('draft', 'published')`,
    ),
  }),
);
```

- [ ] **Step 2: 修改 `src/libs/adaptive/engine.ts` 的 `KnowledgeNode`／`Item` 型別**

`src/libs/adaptive/engine.ts:25-29` 從：

```ts
export type KnowledgeNode = {
  id: string;
  name: string;
  prerequisites: string[]; // 前置知識點 id 清單（空陣列 = 起點知識點）
};
```

改成：

```ts
export type KnowledgeNode = {
  id: string;
  name: string;
  prerequisites: string[]; // 前置知識點 id 清單（空陣列 = 起點知識點）
  videoRef?: { videoId: string; startSec: number; endSec: number }; // YouTube 匯入才有值：該知識點對應的來源影片關鍵片段
};
```

`src/libs/adaptive/engine.ts:37-45` 從：

```ts
export type Item = {
  id: string;
  knowledgeId: string; // 綁定的唯一知識點
  difficulty: number; // 難易度權重 (Difficulty Index)：0.1（最易）~ 1.0（最難）
  prompt: string; // 題幹
  options: string[]; // 選項（單選）
  answerIndex: number; // 正確選項索引——只存在伺服器端，派題 API 會剝除後才回傳前端
  explanation?: string; // 作答後顯示的一句話解析（也隨派題剝除，判題後才回傳）
};
```

改成：

```ts
export type Item = {
  id: string;
  knowledgeId: string; // 綁定的唯一知識點
  difficulty: number; // 難易度權重 (Difficulty Index)：0.1（最易）~ 1.0（最難）
  prompt: string; // 題幹
  options: string[]; // 選項（單選）
  answerIndex: number; // 正確選項索引——只存在伺服器端，派題 API 會剝除後才回傳前端
  explanation?: string; // 作答後顯示的一句話解析（也隨派題剝除，判題後才回傳）
  bloomLevel?: '記憶' | '理解' | '應用' | '分析' | '評鑑' | '創造'; // YouTube 匯入才有值：Bloom's Taxonomy 認知層次
};
```

- [ ] **Step 3: 產生並檢查 migration**

Run: `npm run db:generate`

打開產生的新檔（`migrations/` 底下最新那個），確認內容**只有**：
1. `ALTER TABLE "adaptive_subject" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;`
2. `ALTER TABLE "adaptive_subject" ADD COLUMN "source_urls" jsonb;`
3. `ALTER TABLE "adaptive_subject" ADD CONSTRAINT "adaptive_subject_status_check" CHECK ("status" IN ('draft', 'published'));`

如果 diff 裡出現任何其他表的 CREATE/ALTER（CLAUDE.md 記錄的已知 migration snapshot 脫鉤問題），
手動刪除那些不屬於本次改動的敘述，只留上面三條，每條後面要有 `--> statement-breakpoint`。

- [ ] **Step 4: 本機套用 migration**

Run: `npm run db:migrate`
Expected: 成功套用，無錯誤（本機用 PGlite in-memory，安全）

- [ ] **Step 5: 型別檢查**

Run: `npm run check-types`
Expected: 0 errors（`engine.test.ts` 等既有測試因為新欄位是可選欄位，不需要任何修改）

- [ ] **Step 6: 執行既有測試確認沒有回歸**

Run: `npx vitest run src/libs/adaptive/engine.test.ts`
Expected: PASS（全部既有案例不變）

- [ ] **Step 7: Commit**

```bash
git add src/models/Schema.ts src/libs/adaptive/engine.ts migrations/
git commit -m "feat(adaptive): adaptive_subject 加 status/sourceUrls 欄位，KC/題目型別加 videoRef/bloomLevel"
```

---

### Task 2: `src/libs/youtube.ts` — 保留 timestamp 的抽字幕、清洗、URL 驗證

**Files:**
- Create: `src/libs/youtube.ts`
- Create: `src/libs/youtube.test.ts`

**Interfaces:**
- Consumes: `youtube-transcript` 套件的 `YoutubeTranscript.fetchTranscript(videoId, {lang?})`
  （回傳 `{ text: string; duration: number; offset: number; lang?: string }[]`，套件既有型別）
- Produces（後續 Task 3、Task 6 依賴這些確切名稱）：
  - `extractYouTubeId(url: string): string | null`
  - `classifyYouTubeError(err: unknown): string`
  - `validateYoutubeImportUrls(urls: string[]): { ok: true } | { ok: false; error: string }`
  - `fetchYouTubeTranscriptSegments(videoId: string): Promise<{ text: string; offset: number }[]>`
  - `buildTimestampedTranscript(videos: { videoId: string; segments: { text: string; offset: number }[] }[]): string`

- [ ] **Step 1: 寫失敗的測試（純函式部分）**

Create `src/libs/youtube.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { buildTimestampedTranscript, extractYouTubeId, validateYoutubeImportUrls } from './youtube';

describe('extractYouTubeId', () => {
  it('watch?v= 格式：取出 11 碼 video id', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('youtu.be 短網址：取出 video id', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('embed 格式：取出 video id', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('shorts 格式：取出 video id', () => {
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('純 playlist 網址（無 v=）：回傳 null', () => {
    expect(extractYouTubeId('https://www.youtube.com/playlist?list=PLxxxxx')).toBeNull();
  });

  it('非 YouTube 網址：回傳 null', () => {
    expect(extractYouTubeId('https://example.com/video')).toBeNull();
  });
});

describe('validateYoutubeImportUrls', () => {
  it('空陣列：拒絕', () => {
    expect(validateYoutubeImportUrls([])).toEqual({ ok: false, error: '請至少貼一支影片網址' });
  });

  it('1~5 支合法網址：放行', () => {
    // video id 必須是 extractYouTubeId 認得的 11 碼（[\w-]{11}），"vid" + 1 碼數字 + 7 個 "a" = 11 碼
    const urls = Array.from({ length: 5 }, (_, i) => `https://youtu.be/vid${i}aaaaaaa`);
    expect(validateYoutubeImportUrls(urls)).toEqual({ ok: true });
  });

  it('超過 5 支：拒絕', () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://youtu.be/vid${i}aaaaaaa`);
    const result = validateYoutubeImportUrls(urls);
    expect(result.ok).toBe(false);
  });

  it('含 playlist 網址：拒絕，訊息說明不支援 playlist', () => {
    const result = validateYoutubeImportUrls(['https://www.youtube.com/playlist?list=PLxxxxx']);
    expect(result).toEqual({ ok: false, error: '不支援播放清單網址，請貼單支影片網址' });
  });

  it('格式錯誤的網址：拒絕', () => {
    const result = validateYoutubeImportUrls(['https://example.com/not-youtube']);
    expect(result.ok).toBe(false);
  });
});

describe('buildTimestampedTranscript', () => {
  it('單支影片：依 20 秒分桶並標記 videoId／時間戳', () => {
    const result = buildTimestampedTranscript([
      {
        videoId: 'abc123',
        segments: [
          { text: '第一句', offset: 0 },
          { text: '第二句', offset: 5 },
          { text: '第三句', offset: 25 },
        ],
      },
    ]);

    expect(result).toContain('abc123');
    expect(result).toContain('[t=0s]');
    expect(result).toContain('第一句');
    expect(result).toContain('第二句');
    expect(result).toContain('[t=20s]');
    expect(result).toContain('第三句');
  });

  it('多支影片：依序串接、各自標出 videoId', () => {
    const result = buildTimestampedTranscript([
      { videoId: 'vid1', segments: [{ text: '影片一內容', offset: 0 }] },
      { videoId: 'vid2', segments: [{ text: '影片二內容', offset: 0 }] },
    ]);

    const idxVid1 = result.indexOf('vid1');
    const idxVid2 = result.indexOf('vid2');
    expect(idxVid1).toBeGreaterThanOrEqual(0);
    expect(idxVid2).toBeGreaterThan(idxVid1);
  });

  it('超過 20000 字元：截斷', () => {
    const longText = 'x'.repeat(30000);
    const result = buildTimestampedTranscript([
      { videoId: 'abc', segments: [{ text: longText, offset: 0 }] },
    ]);

    expect(result.length).toBeLessThanOrEqual(20000);
  });
});
```

- [ ] **Step 2: 執行測試確認全部失敗**

Run: `npx vitest run src/libs/youtube.test.ts`
Expected: FAIL（`Cannot find module './youtube'`，因為 `youtube.ts` 還不存在）

- [ ] **Step 3: 實作 `src/libs/youtube.ts`**

```ts
/**
 * YouTube 匯入生成學科（適性學習）專用：保留 timestamp 的抽字幕與清洗。
 * extractYouTubeId／classifyYouTubeError 跟 src/app/api/ai/generate-from-url/route.ts
 * 裡的版本邏輯相同、刻意重複實作，換取不去碰既有已經在跑的一般出題 YouTube 匯入功能。
 */
import { YoutubeTranscript } from 'youtube-transcript';

const MAX_VIDEOS = 5;
const MAX_TRANSCRIPT_CHARS = 20000;
const BUCKET_SECONDS = 20;

export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function classifyYouTubeError(err: unknown): string {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (msg.includes('disabled')) {
    return '此影片的字幕已被上傳者關閉，無法擷取內容。請換一支影片。';
  }
  if (msg.includes('unavailable') || msg.includes('not found') || msg.includes('404')) {
    return '此影片不存在或為私人影片，無法讀取。請確認連結正確且影片為公開。';
  }
  if (msg.includes('no transcript') || msg.includes('could not') || msg.includes('transcript')) {
    return '此影片沒有可用的字幕（可能尚未自動產生）。請換一支影片。';
  }
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('fetch') || msg.includes('network')) {
    return '系統暫時無法讀取 YouTube，請稍後再試。';
  }
  return 'YouTube 字幕擷取失敗，請確認連結正確後重試。';
}

/** 前端與 server action 共用的送出前驗證：格式、支數上限、擋 playlist 網址 */
export function validateYoutubeImportUrls(urls: string[]): { ok: true } | { ok: false; error: string } {
  if (urls.length === 0) {
    return { ok: false, error: '請至少貼一支影片網址' };
  }
  if (urls.length > MAX_VIDEOS) {
    return { ok: false, error: `最多支援 ${MAX_VIDEOS} 支影片，請刪減後再試` };
  }
  for (const url of urls) {
    if (url.includes('list=') && !extractYouTubeId(url)) {
      return { ok: false, error: '不支援播放清單網址，請貼單支影片網址' };
    }
    if (!extractYouTubeId(url)) {
      return { ok: false, error: `無法辨識的 YouTube 網址：${url}` };
    }
  }
  return { ok: true };
}

/** 抓字幕並保留 timestamp（zh-TW → zh → 自動偵測 fallback，同既有 generate-from-url 邏輯） */
export async function fetchYouTubeTranscriptSegments(
  videoId: string,
): Promise<{ text: string; offset: number }[]> {
  let items;
  try {
    items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'zh-TW' })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId, { lang: 'zh' }))
      .catch(() => YoutubeTranscript.fetchTranscript(videoId));
  } catch (err) {
    throw new Error(classifyYouTubeError(err));
  }
  if (!items || items.length === 0) {
    throw new Error('此影片沒有可用的字幕（可能尚未自動產生）。請換一支影片。');
  }
  return items.map(i => ({ text: i.text, offset: i.offset }));
}

/**
 * 把多支影片的逐字稿合併成一份帶時間戳的教材文字，餵給 LLM。
 * 每支影片依時間分桶（約 20 秒一桶，減少 token 量又保留可定位精度）。
 * 總長度沿用既有文字模式 <教材> 的 20000 字元截斷邏輯。
 */
export function buildTimestampedTranscript(
  videos: { videoId: string; segments: { text: string; offset: number }[] }[],
): string {
  const parts: string[] = [];
  videos.forEach((video, index) => {
    parts.push(`\n=== 影片 ${index + 1}：${video.videoId} ===`);
    let bucketStart = -1;
    let bucketText: string[] = [];
    const flush = () => {
      if (bucketText.length > 0) {
        parts.push(`[t=${bucketStart}s] ${bucketText.join(' ')}`);
      }
    };
    for (const seg of video.segments) {
      const bucket = Math.floor(seg.offset / BUCKET_SECONDS) * BUCKET_SECONDS;
      if (bucket !== bucketStart) {
        flush();
        bucketStart = bucket;
        bucketText = [];
      }
      bucketText.push(seg.text);
    }
    flush();
  });
  return parts.join('\n').trim().slice(0, MAX_TRANSCRIPT_CHARS);
}
```

- [ ] **Step 4: 執行測試確認全部通過**

Run: `npx vitest run src/libs/youtube.test.ts`
Expected: PASS

- [ ] **Step 5: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/libs/youtube.ts src/libs/youtube.test.ts
git commit -m "feat(adaptive): 新增 YouTube 匯入專用的保留 timestamp 抽字幕與清洗邏輯"
```

---

### Task 3: `src/libs/adaptive/generate-subject-from-youtube.ts` — 獨立的 prompt／schema／生成函式

**Files:**
- Modify: `src/libs/adaptive/generate-subject.ts`（`extractJson` 改 export）
- Create: `src/libs/adaptive/generate-subject-from-youtube.ts`
- Create: `src/libs/adaptive/generate-subject-from-youtube.test.ts`

**Interfaces:**
- Consumes: `generateAIText`／`isPaidSubscriberSafe`（`@/lib/ai/textModel`）、
  `friendlyAIGenerationError`／`extractJson`（`./generate-subject`）、`AdaptiveEngine`
  （`./engine`）
- Produces（Task 4 依賴這些確切名稱）：
  - `export type YoutubeGeneratedSubject`
  - `export async function generateSubjectFromYoutube(topic: string, transcript: string, videoIds: string[]): Promise<YoutubeGeneratedSubject>`
  - `export function buildYoutubeUserPrompt(topic: string, transcript: string): string`
  - `export function validateYoutubeSemantics(generated: YoutubeGeneratedSubject, videoIds: string[]): void`（不合法就 throw）

- [ ] **Step 1: `generate-subject.ts` 把 `extractJson` 改成 export**

`src/libs/adaptive/generate-subject.ts` 裡的：

```ts
/** 從模型輸出取出 JSON（容錯：剝掉可能的 Markdown 圍欄） */
function extractJson(text: string): unknown {
```

改成：

```ts
/** 從模型輸出取出 JSON（容錯：剝掉可能的 Markdown 圍欄）。export 給 generate-subject-from-youtube.ts 共用 */
export function extractJson(text: string): unknown {
```

- [ ] **Step 2: 執行既有測試確認這個小改動沒有破壞任何東西**

Run: `npx vitest run src/libs/adaptive/generate-subject.test.ts`
Expected: PASS（純粹加 export 關鍵字，行為不變）

- [ ] **Step 3: 寫失敗的測試**

Create `src/libs/adaptive/generate-subject-from-youtube.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { buildYoutubeUserPrompt, validateYoutubeSemantics } from './generate-subject-from-youtube';

describe('buildYoutubeUserPrompt', () => {
  it('帶入主題與逐字稿內容', () => {
    const prompt = buildYoutubeUserPrompt('光合作用', '=== 影片 1：abc123 ===\n[t=0s] 今天講光合作用');

    expect(prompt).toContain('光合作用');
    expect(prompt).toContain('abc123');
    expect(prompt).toContain('影片逐字稿');
  });
});

describe('validateYoutubeSemantics', () => {
  const baseGenerated = {
    name: '光合作用',
    knowledgePoints: [
      { id: 'kc1', name: '葉綠體', prerequisites: [] },
      { id: 'kc2', name: '光反應', prerequisites: ['kc1'] },
      { id: 'kc3', name: '暗反應', prerequisites: ['kc2'] },
    ],
    items: Array.from({ length: 9 }, (_, i) => ({
      id: `item${i}`,
      knowledgeId: i < 3 ? 'kc1' : i < 6 ? 'kc2' : 'kc3',
      difficulty: 0.5,
      prompt: `題目 ${i}`,
      options: ['A', 'B', 'C', 'D'],
      answerIndex: 0,
      explanation: '解析',
      bloomLevel: '理解' as const,
    })),
    tutor: { lessonExampleRule: '規則', formatRule: '格式' },
  };

  it('videoRef 指向送進去的 videoId：通過', () => {
    const generated = {
      ...baseGenerated,
      knowledgePoints: [
        { ...baseGenerated.knowledgePoints[0]!, videoRef: { videoId: 'abc123', startSec: 10, endSec: 60 } },
        baseGenerated.knowledgePoints[1]!,
        baseGenerated.knowledgePoints[2]!,
      ],
    };

    expect(() => validateYoutubeSemantics(generated, ['abc123'])).not.toThrow();
  });

  it('videoRef 指向沒送進去的 videoId：丟錯', () => {
    const generated = {
      ...baseGenerated,
      knowledgePoints: [
        { ...baseGenerated.knowledgePoints[0]!, videoRef: { videoId: 'not-submitted', startSec: 10, endSec: 60 } },
        baseGenerated.knowledgePoints[1]!,
        baseGenerated.knowledgePoints[2]!,
      ],
    };

    expect(() => validateYoutubeSemantics(generated, ['abc123'])).toThrow(/videoId/);
  });

  it('startSec >= endSec：丟錯', () => {
    const generated = {
      ...baseGenerated,
      knowledgePoints: [
        { ...baseGenerated.knowledgePoints[0]!, videoRef: { videoId: 'abc123', startSec: 60, endSec: 60 } },
        baseGenerated.knowledgePoints[1]!,
        baseGenerated.knowledgePoints[2]!,
      ],
    };

    expect(() => validateYoutubeSemantics(generated, ['abc123'])).toThrow();
  });

  it('沒有 videoRef 的知識點：允許（不強求每個 KC 都要有片段）', () => {
    expect(() => validateYoutubeSemantics(baseGenerated, ['abc123'])).not.toThrow();
  });

  it('題目引用不存在的知識點：丟錯（沿用既有語意驗證規則）', () => {
    const generated = {
      ...baseGenerated,
      items: [{ ...baseGenerated.items[0]!, knowledgeId: 'not-exist' }, ...baseGenerated.items.slice(1)],
    };

    expect(() => validateYoutubeSemantics(generated, ['abc123'])).toThrow();
  });
});
```

- [ ] **Step 4: 執行測試確認全部失敗**

Run: `npx vitest run src/libs/adaptive/generate-subject-from-youtube.test.ts`
Expected: FAIL（模組不存在）

- [ ] **Step 5: 實作 `src/libs/adaptive/generate-subject-from-youtube.ts`**

```ts
/**
 * AI 生成學科 — YouTube 匯入模式。跟 generate-subject.ts（貼文字／上傳檔案）是完全獨立的一份
 * prompt／schema／驗證，刻意不共用 generatedSubjectSchema／SYSTEM_PROMPT／toSubject，
 * 避免任何改動波及既有已經在跑的兩種模式。
 */
import { z } from 'zod';

import { generateAIText, isPaidSubscriberSafe } from '@/lib/ai/textModel';

import { AdaptiveEngine } from './engine';
import { extractJson } from './generate-subject';

const BLOOM_LEVELS = ['記憶', '理解', '應用', '分析', '評鑑', '創造'] as const;

const youtubeGeneratedSubjectSchema = z.object({
  name: z.string().min(1).max(40),
  knowledgePoints: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/, 'id 需為小寫英數與連字號'),
        name: z.string().min(1).max(30),
        prerequisites: z.array(z.string()),
        videoRef: z
          .object({
            videoId: z.string(),
            startSec: z.number().min(0),
            endSec: z.number().min(0),
          })
          .optional(),
      }),
    )
    .min(3)
    .max(5),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        knowledgeId: z.string(),
        difficulty: z.number().min(0.1).max(1),
        prompt: z.string().min(1),
        options: z.array(z.string().min(1)).length(4),
        answerIndex: z.number().int().min(0).max(3),
        explanation: z.string().min(1),
        bloomLevel: z.enum(BLOOM_LEVELS),
      }),
    )
    .min(9),
  tutor: z.object({
    lessonExampleRule: z.string().min(1),
    formatRule: z.string().min(1),
  }),
});

export type YoutubeGeneratedSubject = z.infer<typeof youtubeGeneratedSubjectSchema>;

const YOUTUBE_SYSTEM_PROMPT = `你是台灣中學／大學教材設計專家，為「適性學習系統」設計學科內容。
教材來源是一份或多份 YouTube 教學影片的逐字稿，每段都標有 [t=秒數s] 時間戳與所屬影片 videoId
（格式：=== 影片 N：{videoId} === 開頭，後面接該影片的分段逐字稿）。
系統原理：BKT 精熟度模型沿知識圖譜的前置依賴逐點教學，依學生表現動態調整題目難度；
學生連錯兩題會觸發 AI 補強課文。你設計的內容品質直接決定診斷準確度。

輸出要求：只輸出一個 JSON 物件（不要 Markdown 圍欄、不要任何說明文字），結構如下：
{
  "name": "學科顯示名稱（簡潔，例如：光合作用）",
  "knowledgePoints": [
    {
      "id": "小寫英數與連字號",
      "name": "知識點名稱",
      "prerequisites": ["前置知識點id"],
      "videoRef": { "videoId": "逐字稿裡出現過的 videoId", "startSec": 93, "endSec": 180 }
    }
  ],
  "items": [
    {
      "id": "題目唯一id",
      "knowledgeId": "所屬知識點id",
      "difficulty": 0.2,
      "prompt": "題幹",
      "options": ["選項A", "選項B", "選項C", "選項D"],
      "answerIndex": 0,
      "explanation": "一句話解析（為什麼是這個答案、常見錯誤在哪）",
      "bloomLevel": "理解"
    }
  ],
  "tutor": {
    "lessonExampleRule": "補強課文『重點講解』段落的範例形式要求",
    "formatRule": "表達格式規則（見下方格式鐵則）"
  }
}

設計鐵則：
1. 知識點 3~5 個，依賴關係構成由淺入深的有向無環圖（至少是一條線性鏈）；第一個知識點 prerequisites 必須是空陣列
2. 每個知識點 5~8 題，難度覆蓋 0.2 到 0.9 的光譜（至少含一題 ≤0.3 與一題 ≥0.7）
3. 全部單選題、恰好 4 個選項；錯誤選項必須是「學生真的會犯的典型錯誤」，不要湊數
4. answerIndex 必須平均分散在 0、1、2、3 之間，生成完後自我檢查一次分布，發現集中就手動調整
5. 每題標一個 bloomLevel（記憶/理解/應用/分析/評鑑/創造），同一知識點內盡量覆蓋多種層次，不要全部都是「記憶」層級
6. videoRef 必須引用逐字稿裡實際出現過的 videoId，startSec/endSec 落在該知識點內容講解的範圍（抓一段約 30~90 秒、足以完整講解該知識點），沒有明確對應片段就不要硬湊，留空即可（videoRef 為選填）
7. 所有內容使用繁體中文（台灣用語）
8. 格式鐵則（一律寫進 tutor.formatRule）：數學內容一律用純文字與 Unicode 符號，絕對禁止 LaTeX`;

export function buildYoutubeUserPrompt(topic: string, transcript: string): string {
  return `請為以下單元主題設計學科：「${topic.trim()}」\n\n以下是老師提供的 YouTube 影片逐字稿，知識點劃分與題目範圍以此為準（不要超出逐字稿範圍出題）：\n<影片逐字稿>\n${transcript}\n</影片逐字稿>`;
}

/** 結構之外的語意驗證：知識點引用、題目數量、videoRef 合法性；最後用引擎建構驗 DAG */
export function validateYoutubeSemantics(
  generated: YoutubeGeneratedSubject,
  videoIds: string[],
): void {
  const knowledgeIds = new Set(generated.knowledgePoints.map(k => k.id));
  const videoIdSet = new Set(videoIds);

  for (const k of generated.knowledgePoints) {
    for (const p of k.prerequisites) {
      if (!knowledgeIds.has(p)) {
        throw new Error(`知識點 ${k.id} 的前置 ${p} 不存在`);
      }
    }
    if (k.videoRef) {
      if (!videoIdSet.has(k.videoRef.videoId)) {
        throw new Error(`知識點 ${k.id} 的 videoRef.videoId「${k.videoRef.videoId}」不在送入的影片清單裡`);
      }
      if (k.videoRef.startSec >= k.videoRef.endSec) {
        throw new Error(`知識點 ${k.id} 的 videoRef 時間範圍不合法（startSec 需小於 endSec）`);
      }
    }
  }

  const itemIds = new Set<string>();
  for (const item of generated.items) {
    if (!knowledgeIds.has(item.knowledgeId)) {
      throw new Error(`題目 ${item.id} 綁定的知識點 ${item.knowledgeId} 不存在`);
    }
    if (itemIds.has(item.id)) {
      throw new Error(`題目 id 重複：${item.id}`);
    }
    itemIds.add(item.id);
  }

  for (const kId of knowledgeIds) {
    const count = generated.items.filter(i => i.knowledgeId === kId).length;
    if (count < 3) {
      throw new Error(`知識點 ${kId} 只有 ${count} 題（至少 3 題才能適性派題）`);
    }
  }

  // 引擎建構時做拓撲排序，循環依賴會在這裡丟錯
  const graph = {
    nodes: generated.knowledgePoints.map(k => ({
      id: k.id,
      name: k.name,
      prerequisites: k.prerequisites,
      videoRef: k.videoRef,
    })),
  };
  const itemBank = { items: generated.items };
  void new AdaptiveEngine(graph, itemBank);
}

/**
 * 呼叫 AI 生成學科（YouTube 模式）。走 generateAIText 分流備援，付費判定沿用文字/檔案模式同一套規則。
 * 驗證失敗會帶著錯誤訊息重試一次；兩次都失敗才丟錯給呼叫端。
 */
export async function generateSubjectFromYoutube(
  topic: string,
  transcript: string,
  videoIds: string[],
): Promise<YoutubeGeneratedSubject> {
  const forceGemini = !(await isPaidSubscriberSafe());
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote = lastError
      ? `\n\n【上次生成有以下問題，請修正後重新生成】\n${lastError}`
      : '';
    const { text, usedModel } = await generateAIText({
      prompt: buildYoutubeUserPrompt(topic, transcript) + retryNote,
      system: YOUTUBE_SYSTEM_PROMPT,
      claudeModel: 'claude-opus-4-8',
      claudeThinking: true,
      maxTokens: 32000,
      json: true,
      forceGemini,
    });
    console.warn(`[generate-subject-from-youtube] attempt=${attempt} usedModel=${usedModel}`);

    try {
      const generated = youtubeGeneratedSubjectSchema.parse(extractJson(text));
      validateYoutubeSemantics(generated, videoIds);
      return generated;
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  throw new Error(`AI 生成的學科結構驗證失敗：${lastError}`);
}
```

- [ ] **Step 6: 執行測試確認全部通過**

Run: `npx vitest run src/libs/adaptive/generate-subject-from-youtube.test.ts`
Expected: PASS

- [ ] **Step 7: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add src/libs/adaptive/generate-subject.ts src/libs/adaptive/generate-subject-from-youtube.ts src/libs/adaptive/generate-subject-from-youtube.test.ts
git commit -m "feat(adaptive): 新增 YouTube 匯入模式獨立的生成 prompt/schema/驗證邏輯"
```

---

### Task 4: `adaptiveActions.ts` — 存檔與生成 server action

**Files:**
- Modify: `src/actions/adaptiveActions.ts`

**Interfaces:**
- Consumes: `checkAndIncrementAiUsage`（`@/actions/aiUsageActions`）、
  `extractYouTubeId`／`validateYoutubeImportUrls`／`fetchYouTubeTranscriptSegments`／
  `buildTimestampedTranscript`（`@/libs/youtube`）、
  `generateSubjectFromYoutube`／`YoutubeGeneratedSubject`（`@/libs/adaptive/generate-subject-from-youtube`）
- Produces（Task 6 依賴這個名稱與回傳型別）：
  `export async function generateAdaptiveSubjectFromYoutube(input: { topic: string; videoUrls: string[] }): Promise<SavedSubjectResult | { error: string }>`

- [ ] **Step 1: 加 import**

`src/actions/adaptiveActions.ts` 頂部 import 區塊（`src/actions/adaptiveActions.ts:16-20`）加：

```ts
import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { generateSubjectFromYoutube } from '@/libs/adaptive/generate-subject-from-youtube';
import {
  buildTimestampedTranscript,
  extractYouTubeId,
  fetchYouTubeTranscriptSegments,
  validateYoutubeImportUrls,
} from '@/libs/youtube';
```

- [ ] **Step 2: 加 `saveGeneratedYoutubeSubject` 與 `generateAdaptiveSubjectFromYoutube`**

在 `saveGeneratedSubject`（`src/actions/adaptiveActions.ts:151-184`）函式後面加：

```ts
/**
 * YouTube 匯入模式的存檔邏輯，跟 saveGeneratedSubject 平行、刻意不共用：
 * saveGeneratedSubject 內部呼叫的 toSubject() 組 graph.nodes 時只挑
 * {id, name, prerequisites} 三個欄位，會把 videoRef 悄悄丟掉，因此這裡手動組裝
 * 保留 videoRef／bloomLevel，並多寫入 sourceUrls／status='draft'。
 */
async function saveGeneratedYoutubeSubject(
  userId: string,
  topic: string,
  generated: Awaited<ReturnType<typeof generateSubjectFromYoutube>>,
  videoUrls: string[],
): Promise<SavedSubjectResult> {
  const { userId: authedUserId } = await auth();
  if (!authedUserId || authedUserId !== userId) {
    throw new Error('未授權：userId 與登入身份不符');
  }

  const graph = {
    nodes: generated.knowledgePoints.map(k => ({
      id: k.id,
      name: k.name,
      prerequisites: k.prerequisites,
      videoRef: k.videoRef,
    })),
  };
  const itemBank = { items: generated.items };

  const [row] = await db
    .insert(adaptiveSubjectSchema)
    .values({
      ownerId: userId,
      name: generated.name,
      sourceTopic: topic,
      graph,
      itemBank,
      tutor: generated.tutor,
      sourceUrls: videoUrls,
      status: 'draft',
    })
    .returning();

  revalidatePath('/dashboard/adaptive');
  revalidatePath('/dashboard/adaptive/subjects');
  return {
    id: row!.id,
    name: row!.name,
    knowledgeCount: graph.nodes.length,
    itemCount: itemBank.items.length,
  };
}

const generateFromYoutubeSchema = z.object({
  topic: z.string().trim().min(2, '請輸入單元主題').max(100),
  videoUrls: z.array(z.string()).min(1).max(5),
});

/**
 * AI 生成一個新學科（YouTube 匯入模式）：抽字幕（保留 timestamp）→ 清洗合併 → AI 生成 → 存成草稿。
 * 整個匯入只算一次 AI quota；任一支影片抽字幕失敗就整批中止。
 */
export async function generateAdaptiveSubjectFromYoutube(
  input: { topic: string; videoUrls: string[] },
): Promise<SavedSubjectResult | { error: string }> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  const parsed = generateFromYoutubeSchema.parse(input);
  const urlCheck = validateYoutubeImportUrls(parsed.videoUrls);
  if (!urlCheck.ok) {
    return { error: urlCheck.error };
  }

  const usage = await checkAndIncrementAiUsage(userId);
  if (!usage.allowed) {
    return { error: usage.reason };
  }

  const videoIds = parsed.videoUrls.map(url => extractYouTubeId(url)!);

  const videos: { videoId: string; segments: { text: string; offset: number }[] }[] = [];
  for (const videoId of videoIds) {
    try {
      const segments = await fetchYouTubeTranscriptSegments(videoId);
      videos.push({ videoId, segments });
    } catch (err) {
      return { error: `影片 ${videoId} 抽字幕失敗：${(err as Error).message}` };
    }
  }

  const transcript = buildTimestampedTranscript(videos);

  let generated: Awaited<ReturnType<typeof generateSubjectFromYoutube>>;
  try {
    generated = await generateSubjectFromYoutube(parsed.topic, transcript, videoIds);
  } catch (err) {
    console.error('[generateAdaptiveSubjectFromYoutube] AI 生成失敗：', err);
    return { error: friendlyAIGenerationError(err) };
  }

  return saveGeneratedYoutubeSubject(userId, parsed.topic, generated, parsed.videoUrls);
}
```

- [ ] **Step 3: 型別檢查**

Run: `npm run check-types`
Expected: 0 errors（`saveGeneratedYoutubeSubject`／`generateAdaptiveSubjectFromYoutube` 型別需與
Task 1～3 定義的欄位／函式簽名完全對上）

- [ ] **Step 4: lint**

Run: `npm run lint`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/actions/adaptiveActions.ts
git commit -m "feat(adaptive): 新增 YouTube 匯入的生成與存檔 server action，整合 AI quota 檢查"
```

---

### Task 5: `adaptiveActions.ts` — 草稿把關與發佈

**Files:**
- Modify: `src/actions/adaptiveActions.ts`

**Interfaces:**
- Produces: `export async function publishAdaptiveSubject(subjectId: number): Promise<{ error?: string }>`
- Modifies existing behavior: `assertSubjectUsable`（新增 status 檢查）、
  `listAvailableSubjects`（草稿學科不再出現在下拉選單）、
  `listMySubjectsForManagement`（回傳值加 `status: 'draft' | 'published'`）

- [ ] **Step 1: `assertSubjectUsable` 加狀態檢查**

`src/actions/adaptiveActions.ts:75-91` 從：

```ts
/** 驗證 subjectId 是老師可用的學科（內建，或自己擁有的自建學科） */
async function assertSubjectUsable(subjectId: string, userId: string): Promise<void> {
  if (!subjectId.startsWith(DB_SUBJECT_PREFIX)) {
    if (!listSubjects().some(s => s.id === subjectId)) {
      throw new Error(`學科不存在：${subjectId}`);
    }
    return;
  }
  const id = Number(subjectId.slice(DB_SUBJECT_PREFIX.length));
  const [row] = await db
    .select({ ownerId: adaptiveSubjectSchema.ownerId })
    .from(adaptiveSubjectSchema)
    .where(eq(adaptiveSubjectSchema.id, id));
  if (!row || row.ownerId !== userId) {
    throw new Error('學科不存在或非本人建立');
  }
}
```

改成：

```ts
/** 驗證 subjectId 是老師可用的學科（內建，或自己擁有、已發佈的自建學科） */
async function assertSubjectUsable(subjectId: string, userId: string): Promise<void> {
  if (!subjectId.startsWith(DB_SUBJECT_PREFIX)) {
    if (!listSubjects().some(s => s.id === subjectId)) {
      throw new Error(`學科不存在：${subjectId}`);
    }
    return;
  }
  const id = Number(subjectId.slice(DB_SUBJECT_PREFIX.length));
  const [row] = await db
    .select({ ownerId: adaptiveSubjectSchema.ownerId, status: adaptiveSubjectSchema.status })
    .from(adaptiveSubjectSchema)
    .where(eq(adaptiveSubjectSchema.id, id));
  if (!row || row.ownerId !== userId) {
    throw new Error('學科不存在或非本人建立');
  }
  if (row.status !== 'published') {
    throw new Error('這個學科尚未發佈，請先到「學科管理」頁審核發佈');
  }
}
```

- [ ] **Step 2: `listAvailableSubjects` 只列已發佈的自建學科**

`src/actions/adaptiveActions.ts:49-62` 從：

```ts
  const custom = await db
    .select({
      id: adaptiveSubjectSchema.id,
      name: adaptiveSubjectSchema.name,
      pinned: adaptiveSubjectSchema.pinned,
    })
    .from(adaptiveSubjectSchema)
    .where(
      and(
        eq(adaptiveSubjectSchema.ownerId, userId),
        isNull(adaptiveSubjectSchema.archivedAt), // 已封存的不進下拉選單
      ),
    )
    .orderBy(desc(adaptiveSubjectSchema.pinned), desc(adaptiveSubjectSchema.createdAt)); // 釘選優先，其餘新到舊
```

改成：

```ts
  const custom = await db
    .select({
      id: adaptiveSubjectSchema.id,
      name: adaptiveSubjectSchema.name,
      pinned: adaptiveSubjectSchema.pinned,
    })
    .from(adaptiveSubjectSchema)
    .where(
      and(
        eq(adaptiveSubjectSchema.ownerId, userId),
        isNull(adaptiveSubjectSchema.archivedAt), // 已封存的不進下拉選單
        eq(adaptiveSubjectSchema.status, 'published'), // 草稿學科（例如還沒審核的 YouTube 匯入）不進下拉選單
      ),
    )
    .orderBy(desc(adaptiveSubjectSchema.pinned), desc(adaptiveSubjectSchema.createdAt)); // 釘選優先，其餘新到舊
```

- [ ] **Step 3: `listMySubjectsForManagement` 回傳值加 `status`**

`src/actions/adaptiveActions.ts:217-246` 從：

```ts
export async function listMySubjectsForManagement(): Promise<{
  id: number;
  name: string;
  sourceTopic: string;
  pinned: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  knowledgeCount: number;
  itemCount: number;
}[]> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  const rows = await db
    .select()
    .from(adaptiveSubjectSchema)
    .where(eq(adaptiveSubjectSchema.ownerId, userId))
    .orderBy(desc(adaptiveSubjectSchema.pinned), desc(adaptiveSubjectSchema.createdAt));

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    sourceTopic: r.sourceTopic,
    pinned: r.pinned,
    archivedAt: r.archivedAt,
    createdAt: r.createdAt,
    knowledgeCount: r.graph.nodes.length,
    itemCount: r.itemBank.items.length,
  }));
}
```

改成：

```ts
export async function listMySubjectsForManagement(): Promise<{
  id: number;
  name: string;
  sourceTopic: string;
  pinned: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  knowledgeCount: number;
  itemCount: number;
  status: 'draft' | 'published';
}[]> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  const rows = await db
    .select()
    .from(adaptiveSubjectSchema)
    .where(eq(adaptiveSubjectSchema.ownerId, userId))
    .orderBy(desc(adaptiveSubjectSchema.pinned), desc(adaptiveSubjectSchema.createdAt));

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    sourceTopic: r.sourceTopic,
    pinned: r.pinned,
    archivedAt: r.archivedAt,
    createdAt: r.createdAt,
    knowledgeCount: r.graph.nodes.length,
    itemCount: r.itemBank.items.length,
    status: r.status,
  }));
}
```

- [ ] **Step 4: 加 `publishAdaptiveSubject`**

在 `assertOwnSubject`（`src/actions/adaptiveActions.ts:249-256` 附近，`renameAdaptiveSubject` 之前
或之後皆可，放在 `assertOwnSubject` 後面）加：

```ts
/** 審核發佈：草稿學科改成已發佈，之後才能出現在「建立適性練習」下拉選單。重複呼叫視同 no-op，不拋錯 */
export async function publishAdaptiveSubject(subjectId: number): Promise<{ error?: string }> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }
  await assertOwnSubject(subjectId, userId);

  await db
    .update(adaptiveSubjectSchema)
    .set({ status: 'published' })
    .where(and(eq(adaptiveSubjectSchema.id, subjectId), eq(adaptiveSubjectSchema.ownerId, userId)));

  revalidatePath('/dashboard/adaptive');
  revalidatePath('/dashboard/adaptive/subjects');
  return {};
}
```

- [ ] **Step 5: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/actions/adaptiveActions.ts
git commit -m "feat(adaptive): 草稿學科擋建立練習與下拉選單，新增審核發佈 server action"
```

---

### Task 6: `NewSubjectForm.tsx` — 加「從 YouTube 匯入」UI

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx`

**Interfaces:**
- Consumes: `generateAdaptiveSubjectFromYoutube`（`@/actions/adaptiveActions`）、
  `validateYoutubeImportUrls`（`@/libs/youtube`）

- [ ] **Step 1: 擴充 `Mode` 型別與 import**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:13-23` 從：

```ts
import { generateAdaptiveSubject } from '@/actions/adaptiveActions';
import { validateSubjectUploadFiles } from '@/libs/adaptive/subjectFileValidation';

type Result = {
  id: number;
  name: string;
  knowledgeCount: number;
  itemCount: number;
};

type Mode = 'text' | 'file';
```

改成：

```ts
import { generateAdaptiveSubject, generateAdaptiveSubjectFromYoutube } from '@/actions/adaptiveActions';
import { validateSubjectUploadFiles } from '@/libs/adaptive/subjectFileValidation';
import { validateYoutubeImportUrls } from '@/libs/youtube';

type Result = {
  id: number;
  name: string;
  knowledgeCount: number;
  itemCount: number;
};

type Mode = 'text' | 'file' | 'youtube';
```

- [ ] **Step 2: 加 state**

在 `const [pageLoading, setPageLoading] = useState(false);`
（`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:58`）後面加：

```ts
  // YouTube 匯入模式：一行一支影片網址
  const [youtubeUrlsText, setYoutubeUrlsText] = useState('');
```

- [ ] **Step 3: `submit()` 加 youtube 分支**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:112-118` 的開頭檢查從：

```ts
  async function submit() {
    if (!topic.trim() || generating) {
      return;
    }
    if (mode === 'file' && files.length === 0) {
      return;
    }
```

改成：

```ts
  async function submit() {
    if (!topic.trim() || generating) {
      return;
    }
    if (mode === 'file' && files.length === 0) {
      return;
    }
    if (mode === 'youtube') {
      const urls = youtubeUrlsText.split('\n').map(u => u.trim()).filter(Boolean);
      const check = validateYoutubeImportUrls(urls);
      if (!check.ok) {
        setError(check.error);
        return;
      }
    }
```

在同一個函式裡，`if (mode === 'text') { ... }` 區塊（`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:125-137`）之後、
`const fd = new FormData();`（第 139 行）之前加一個 `else if`：

現有結構是：

```ts
    try {
      if (mode === 'text') {
        const res = await generateAdaptiveSubject({ ... });
        if ('error' in res) { setError(res.error); return; }
        setResult(res);
        router.refresh();
        return;
      }

      const fd = new FormData();
      // ...檔案模式...
```

改成：

```ts
    try {
      if (mode === 'text') {
        const res = await generateAdaptiveSubject({
          topic: topic.trim(),
          material: material.trim() || undefined,
        });
        if ('error' in res) {
          setError(res.error);
          return;
        }
        setResult(res);
        router.refresh();
        return;
      }

      if (mode === 'youtube') {
        const urls = youtubeUrlsText.split('\n').map(u => u.trim()).filter(Boolean);
        const res = await generateAdaptiveSubjectFromYoutube({ topic: topic.trim(), videoUrls: urls });
        if ('error' in res) {
          setError(res.error);
          return;
        }
        setResult(res);
        router.refresh();
        return;
      }

      const fd = new FormData();
      // ...檔案模式維持原樣...
```

- [ ] **Step 4: 加「從 YouTube 匯入」tab 按鈕**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:243-260` 的 tab 按鈕區塊從：

```tsx
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => switchMode('text')}
          disabled={generating}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'text' ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-500'}`}
        >
          貼文字
        </button>
        <button
          type="button"
          onClick={() => switchMode('file')}
          disabled={generating}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'file' ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-500'}`}
        >
          上傳檔案
        </button>
      </div>
```

改成：

```tsx
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => switchMode('text')}
          disabled={generating}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'text' ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-500'}`}
        >
          貼文字
        </button>
        <button
          type="button"
          onClick={() => switchMode('file')}
          disabled={generating}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'file' ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-500'}`}
        >
          上傳檔案
        </button>
        <button
          type="button"
          onClick={() => switchMode('youtube')}
          disabled={generating}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'youtube' ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-500'}`}
        >
          從 YouTube 匯入
        </button>
      </div>
```

- [ ] **Step 5: 加 YouTube 模式的輸入區塊**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:262-388` 的
`{mode === 'text' ? (...) : (...)}` 三元運算子，改成先判斷 `mode === 'text'`，再判斷
`mode === 'youtube'`，其餘（檔案模式）原樣：

```tsx
      {mode === 'text' && (
        <div className="flex flex-col gap-1">
          <label htmlFor="subject-material" className="text-sm font-medium">
            教材內容（選填）
          </label>
          <textarea
            id="subject-material"
            value={material}
            onChange={e => setMaterial(e.target.value)}
            maxLength={20000}
            disabled={generating}
            rows={6}
            placeholder="貼上課本段落或講義文字，AI 會依此劃分知識點與出題範圍（不填則依主題自由發揮）。"
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
      )}

      {mode === 'youtube' && (
        <div className="flex flex-col gap-1">
          <label htmlFor="subject-youtube-urls" className="text-sm font-medium">
            YouTube 影片網址（一行一支，最多 5 支）
          </label>
          <textarea
            id="subject-youtube-urls"
            value={youtubeUrlsText}
            onChange={e => setYoutubeUrlsText(e.target.value)}
            disabled={generating}
            rows={5}
            placeholder={'https://www.youtube.com/watch?v=xxxxxxxxxxx\nhttps://youtu.be/yyyyyyyyyyy'}
            className="rounded-md border px-3 py-2 font-mono text-sm"
          />
          <p className="text-xs text-gray-400">
            不支援播放清單網址，請貼單支影片的網址。AI 會用影片字幕內容設計知識點與題目，
            並可讓學生卡關時「重看關鍵片段」。
          </p>
        </div>
      )}

      {mode === 'file' && (
        /* ...原本的檔案上傳區塊內容原樣搬過來，只是外層條件從三元運算子改成 && ... */
      )}
```

（實作時把原本第三元運算子 `:` 後面那整段檔案上傳 JSX，原封不動搬進
`{mode === 'file' && (...)}`，不更動內容。）

- [ ] **Step 6: 送出按鈕 disabled 條件加 youtube 分支**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:404-411` 從：

```tsx
      <button
        type="button"
        onClick={() => void submit()}
        disabled={generating || !topic.trim() || (mode === 'file' && files.length === 0)}
        className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {generating ? '生成中…' : '✨ 開始生成'}
      </button>
```

改成：

```tsx
      <button
        type="button"
        onClick={() => void submit()}
        disabled={
          generating
          || !topic.trim()
          || (mode === 'file' && files.length === 0)
          || (mode === 'youtube' && youtubeUrlsText.trim().length === 0)
        }
        className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {generating ? '生成中…' : '✨ 開始生成'}
      </button>
```

- [ ] **Step 7: 生成成功摘要畫面加草稿提示**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:187-202` 的成功摘要
區塊（`if (result) { ... }`）裡，在 `<p className="mt-2 text-sm">...</p>` 後面加一段條件文字：

```tsx
        {mode === 'youtube' && (
          <p className="mt-2 text-sm text-amber-600">
            ⚠️ 這是草稿，請到「學科管理」頁審核發佈後才能建立適性練習。
          </p>
        )}
```

- [ ] **Step 8: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 0 errors

- [ ] **Step 9: 手動瀏覽器驗證**

啟動 `npm run dev`，開 `/dashboard/adaptive/new-subject`：
1. 切到「從 YouTube 匯入」tab，貼一支有繁中字幕的教學影片網址 + 輸入單元主題，按「開始生成」。
2. 確認生成中提示出現，約 1~3 分鐘後看到「✅ 學科已生成」摘要＋草稿提示文字。
3. 貼 6 支網址（超過上限）確認前端擋下並顯示錯誤。
4. 貼一個 playlist 網址（`youtube.com/playlist?list=...`）確認前端擋下。
5. 切回「貼文字」「上傳檔案」，確認兩種既有模式操作起來跟改動前完全一樣。

- [ ] **Step 10: Commit**

```bash
git add src/app/\[locale\]/\(auth\)/dashboard/adaptive/new-subject/NewSubjectForm.tsx
git commit -m "feat(adaptive): 學科生成表單加「從 YouTube 匯入」模式"
```

---

### Task 7: 學科管理頁 — 草稿 badge 與「審核並發佈」

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/adaptive/subjects/page.tsx`
- Modify: `src/components/adaptive/SubjectActionsMenu.tsx`

**Interfaces:**
- Consumes: `publishAdaptiveSubject`（`@/actions/adaptiveActions`，Task 5 產出）、
  `listMySubjectsForManagement` 回傳值新增的 `status` 欄位（Task 5 產出）

- [ ] **Step 1: `SubjectActionsMenu` 加「審核並發佈」選項**

`src/components/adaptive/SubjectActionsMenu.tsx` 的 import 區塊從：

```tsx
import {
  archiveAdaptiveSubject,
  deleteAdaptiveSubject,
  setAdaptiveSubjectPinned,
  unarchiveAdaptiveSubject,
} from '@/actions/adaptiveActions';
```

改成：

```tsx
import {
  archiveAdaptiveSubject,
  deleteAdaptiveSubject,
  publishAdaptiveSubject,
  setAdaptiveSubjectPinned,
  unarchiveAdaptiveSubject,
} from '@/actions/adaptiveActions';
```

`Props` 型別從：

```tsx
type Props = {
  subject: {
    id: number;
    name: string;
    pinned: boolean;
    archivedAt: Date | null;
  };
};
```

改成：

```tsx
type Props = {
  subject: {
    id: number;
    name: string;
    pinned: boolean;
    archivedAt: Date | null;
    status: 'draft' | 'published';
  };
};
```

在 `handleToggleArchive` 後面加：

```tsx
  const handlePublish = () => {
    startTransition(async () => {
      await publishAdaptiveSubject(subject.id);
    });
  };
```

在 `<DropdownMenuItem onClick={() => setShowRenameDialog(true)}>重新命名</DropdownMenuItem>` 前面
（menu 最上方）加一個只有草稿才顯示的項目：

```tsx
          {subject.status === 'draft' && (
            <DropdownMenuItem onClick={handlePublish}>
              ✅ 審核並發佈
            </DropdownMenuItem>
          )}
```

- [ ] **Step 2: `page.tsx` 傳入 `status` 並顯示草稿 badge**

`src/app/[locale]/(auth)/dashboard/adaptive/subjects/page.tsx` 「使用中」表格那一列
（第 66-92 行）的名稱欄位從：

```tsx
                              <td className="max-w-xs px-4 py-3">
                                <div className="flex items-center">
                                  <span className="font-medium">{s.name}</span>
                                  {s.pinned && (
                                    <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                      📌 已釘選
                                    </span>
                                  )}
                                </div>
```

改成：

```tsx
                              <td className="max-w-xs px-4 py-3">
                                <div className="flex items-center">
                                  <span className="font-medium">{s.name}</span>
                                  {s.pinned && (
                                    <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                      📌 已釘選
                                    </span>
                                  )}
                                  {s.status === 'draft' && (
                                    <span className="ml-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                                      📝 草稿
                                    </span>
                                  )}
                                </div>
```

`SubjectActionsMenu` 呼叫處（該表格與封存表格內都有，`<SubjectActionsMenu subject={s} />`）
不用改——`s` 本來就是 `listMySubjectsForManagement()` 回傳的整列物件，Task 5 已經讓它多帶
`status` 欄位，型別會自動對上。

- [ ] **Step 3: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 0 errors

- [ ] **Step 4: 手動瀏覽器驗證**

1. Task 6 生成的 YouTube 草稿學科，到 `/dashboard/adaptive/subjects` 確認顯示「📝 草稿」badge。
2. 點「⋯」選單確認看到「✅ 審核並發佈」選項，點擊後 badge 消失。
3. 回 `/dashboard/adaptive` 建立新練習，確認發佈後的學科出現在下拉選單、發佈前看不到。

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/\(auth\)/dashboard/adaptive/subjects/page.tsx src/components/adaptive/SubjectActionsMenu.tsx
git commit -m "feat(adaptive): 學科管理頁加草稿 badge 與審核並發佈操作"
```

---

### Task 8: 補強課文帶出 `videoRef`（`tutor.ts`）

**Files:**
- Modify: `src/libs/adaptive/tutor.ts`

**Interfaces:**
- Consumes: `KnowledgeNode.videoRef`（Task 1 產出）
- Produces（Task 9 依賴）: `RemedialLesson.videoRef?: { videoId: string; startSec: number; endSec: number }`

- [ ] **Step 1: `RemedialLesson` 型別加 `videoRef`**

`src/libs/adaptive/tutor.ts:58-63` 從：

```ts
/** 補強課文：對應 Bloom 的 Lesson（number/content/思考題） */
export type RemedialLesson = {
  knowledgeId: string;
  title: string;
  content: string; // Markdown 課文內容
  thoughtQuestions: string[]; // 思考題（Bloom 的間隔檢索：下次作答前先複盤）
};
```

改成：

```ts
/** 補強課文：對應 Bloom 的 Lesson（number/content/思考題） */
export type RemedialLesson = {
  knowledgeId: string;
  title: string;
  content: string; // Markdown 課文內容
  thoughtQuestions: string[]; // 思考題（Bloom 的間隔檢索：下次作答前先複盤）
  videoRef?: { videoId: string; startSec: number; endSec: number }; // YouTube 匯入學科才有值：對應的來源影片關鍵片段，前端顯示「重看關鍵片段」用
};
```

- [ ] **Step 2: `getNextStep()` 把 KC 的 `videoRef` 貼到課文物件上**

`src/libs/adaptive/tutor.ts` 的 `getNextStep()` 內（約第 288-302 行）從：

```ts
      const node = this.graph.nodes.find(n => n.id === dispatch.targetKnowledgeId)!;
      const snapshot = await this.engine.getKnowledgeSnapshot(studentId, node.id);
      const lesson = await this.tutor.generateLesson(
        {
          node,
          mastery: snapshot.mastery,
          wrongItems: [...ep.wrongItems],
          totalHintsUsed: ep.hintsUsed,
          previousAnnotations: [...ep.lastAnnotations],
        },
        onLessonDelta,
      );
      this.pendingLessons.set(studentId, { lesson, dialog: [] });
```

改成：

```ts
      const node = this.graph.nodes.find(n => n.id === dispatch.targetKnowledgeId)!;
      const snapshot = await this.engine.getKnowledgeSnapshot(studentId, node.id);
      const lesson = await this.tutor.generateLesson(
        {
          node,
          mastery: snapshot.mastery,
          wrongItems: [...ep.wrongItems],
          totalHintsUsed: ep.hintsUsed,
          previousAnnotations: [...ep.lastAnnotations],
        },
        onLessonDelta,
      );
      // 課文生成本身不知道影片來源，這裡事後把知識點的 videoRef 貼上去
      // （TutorProvider 實作完全不用改，見設計文件「答題端」一節）
      lesson.videoRef = node.videoRef;
      this.pendingLessons.set(studentId, { lesson, dialog: [] });
```

- [ ] **Step 3: 型別檢查**

Run: `npm run check-types`
Expected: 0 errors

- [ ] **Step 4: 執行既有測試確認沒有回歸**

Run: `npx vitest run src/libs/adaptive/engine.test.ts`
Expected: PASS（`tutor.ts` 本身目前沒有既有單元測試檔案，這個改動只能靠型別檢查與下一個
Task 的瀏覽器手動驗證把關，跟這個檔案既有的測試覆蓋率一致，不新增測試模式）

- [ ] **Step 5: Commit**

```bash
git add src/libs/adaptive/tutor.ts
git commit -m "feat(adaptive): 補強課文物件帶出知識點的 videoRef，供前端重看關鍵片段"
```

---

### Task 9: `AdaptiveLearnClient.tsx` — 「重看關鍵片段」按鈕 + YouTube Player

**Files:**
- Modify: `src/app/[locale]/(unauth)/adaptive/[code]/AdaptiveLearnClient.tsx`

**Interfaces:**
- Consumes: `step.lesson.videoRef`（`NextStep` 型別，Task 8 已擴充 `RemedialLesson`，
  `NextStep` 本身透過 `import type { NextStep } from '@/libs/adaptive/tutor'` 自動帶到新欄位，
  不用另外改 import）

- [ ] **Step 1: 加播放狀態，並在每次拿到新 step 時重置**

`src/app/[locale]/(unauth)/adaptive/[code]/AdaptiveLearnClient.tsx:72` 的
`const [step, setStep] = useState<NextStep | null>(null);` 附近加：

```ts
  const [showVideo, setShowVideo] = useState(false);
  const videoContainerRef = useRef<HTMLDivElement>(null);
```

`src/app/[locale]/(unauth)/adaptive/[code]/AdaptiveLearnClient.tsx:157-167` 從：

```ts
        } else if (msg.type === 'step') {
          setStep(msg.step);
          // 重置每題／每篇課文的狀態
          setHintsUsed(0);
          setFeedback(null);
          itemShownAt.current = Date.now();
          if (msg.step.type === 'lesson') {
            setExchanges([]);
            setSelectedText(null);
            setQuestion('');
          }
        } else {
```

改成：

```ts
        } else if (msg.type === 'step') {
          setStep(msg.step);
          // 重置每題／每篇課文的狀態
          setHintsUsed(0);
          setFeedback(null);
          itemShownAt.current = Date.now();
          if (msg.step.type === 'lesson') {
            setExchanges([]);
            setSelectedText(null);
            setQuestion('');
            setShowVideo(false); // 新的一篇課文，收合上一篇可能展開的播放器
          }
        } else {
```

- [ ] **Step 2: 動態載入 YouTube IFrame Player API（只載入一次）**

在檔案裡其他 helper function 附近（例如 `formatSize` 這類非元件內的函式，如果沒有就直接放在
`AdaptiveLearnClient` 函式外面）加：

```ts
declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId: string;
          playerVars?: { start?: number; end?: number; autoplay?: number };
        }
      ) => unknown;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;

/** 動態載入 YouTube IFrame Player API，全站只載一次（多個補強課文畫面共用同一個 promise） */
function loadYoutubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  if (window.YT?.Player) {
    return Promise.resolve();
  }
  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }
  youtubeApiPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}
```

- [ ] **Step 3: 補強課文卡片加按鈕**

`src/app/[locale]/(unauth)/adaptive/[code]/AdaptiveLearnClient.tsx:575-582` 從：

```tsx
          {/* 課文閱讀畫面 */}
          {!loading && !streamingText && step?.type === 'lesson' && (
            <div className="rounded-lg border p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-2 py-0.5 text-xs">📖 補強課文</span>
                <span className="text-xs text-muted-foreground">
                  看不懂的地方，用滑鼠選取文字即可劃線提問
                </span>
              </div>
```

改成：

```tsx
          {/* 課文閱讀畫面 */}
          {!loading && !streamingText && step?.type === 'lesson' && (
            <div className="rounded-lg border p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-2 py-0.5 text-xs">📖 補強課文</span>
                <span className="text-xs text-muted-foreground">
                  看不懂的地方，用滑鼠選取文字即可劃線提問
                </span>
                {step.lesson.videoRef && (
                  <button
                    type="button"
                    onClick={() => setShowVideo(v => !v)}
                    className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-100"
                  >
                    {showVideo ? '收合影片' : '▶️ 重看關鍵片段'}
                  </button>
                )}
              </div>

              {showVideo && step.lesson.videoRef && (
                <div className="mb-3 aspect-video w-full max-w-lg">
                  <div ref={videoContainerRef} className="h-full w-full" />
                </div>
              )}
```

（播放器容器放在 badge 列之後、課文 Markdown 內容之前，跟下面「劃線提問輸入框」
`{selectedText && (...)}` 用同一種「條件式直接寫在卡片 JSX 裡」風格，不拆成獨立子元件。）

- [ ] **Step 4: 展開播放器時初始化 YouTube Player 並 seek**

在元件內（`showVideo`／`videoContainerRef` 宣告附近，Step 1 加的那兩行後面）加：

```ts
  useEffect(() => {
    if (!showVideo || step?.type !== 'lesson' || !step.lesson.videoRef || !videoContainerRef.current) {
      return;
    }
    const { videoId, startSec, endSec } = step.lesson.videoRef;
    let cancelled = false;
    void loadYoutubeIframeApi().then(() => {
      if (cancelled || !videoContainerRef.current || !window.YT) {
        return;
      }
      // eslint-disable-next-line no-new -- YT.Player 建構後透過內部事件自行掛載播放器，不需要保留參照
      new window.YT.Player(videoContainerRef.current, {
        videoId,
        playerVars: { start: Math.floor(startSec), end: Math.ceil(endSec), autoplay: 1 },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [showVideo, step]);
```

- [ ] **Step 5: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 0 errors

- [ ] **Step 6: 手動瀏覽器驗證**

1. 用 Task 6 產生並發佈的 YouTube 學科建立一個適性練習，用學生視角連續答錯同一知識點 2 題
   觸發補強課文。
2. 確認「▶️ 重看關鍵片段」按鈕出現（若該 KC 沒有 `videoRef` 則不出現，屬正常情況，換一個
   有標到片段的知識點測試）。
3. 點擊按鈕，確認內嵌播放器出現並從對應時間點開始播放。
4. 用 Chrome DevTools 手機模擬（或實機）確認同樣可以點擊播放。
5. 用既有內建學科（cpp/python/calculus，沒有 `videoRef`）走一次卡關流程，確認補強課文畫面
   完全沒有「重看關鍵片段」按鈕、其餘行為不變。

- [ ] **Step 7: Commit**

```bash
git add src/app/\[locale\]/\(unauth\)/adaptive/\[code\]/AdaptiveLearnClient.tsx
git commit -m "feat(adaptive): 補強課文加重看關鍵片段按鈕，內嵌 YouTube Player seek 到對應時間"
```

---

## 全部完成後

- [ ] Run: `npm run build`
  Expected: 建置成功（`Vercel` 部署前的最後把關；不需要額外的 `maxDuration` 設定，見
  Global Constraints 的 Timeout 說明）
- [ ] Run: `npm run lint && npm run check-types && npm run test`
  Expected: 全部 0 error / 0 fail
- [ ] 對照 spec 的「測試」section 手動驗證清單，逐項跑過一次
