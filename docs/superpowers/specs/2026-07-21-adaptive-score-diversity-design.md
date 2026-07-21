# 適性練習「學習後分數」個別差異修正 設計文件

- 日期：2026-07-21
- 起因：老師發現班級儀表板（`/dashboard/adaptive/[practiceId]`）做到後面，多位學生的知識點精熟度百分比與「學習後分數」完全相同（見 [2026-07-16-adaptive-score-column-design.md](2026-07-16-adaptive-score-column-design.md) 新增的欄位）
- 範圍：`src/libs/adaptive/engine.ts`（派題邏輯）＋ `src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/page.tsx`（顯示層）

## 根因（已用 Explore 調查確認）

1. BKT 精熟度更新是**確定性公式**（`bktUpdate`，engine.ts 第 164–175 行），參數固定（`ENGINE_CONFIG`）。
2. 派題（`getNextItem` → `pickNearest`，engine.ts 第 333–338 行）永遠選「距離目標難度最近」的題目，多題距離相同時固定選陣列第一個 → **同樣作答路徑的學生走出逐位元相同的精熟度**。
3. 鎖定中的知識點從未派過題，`mastery` 永遠停在初始值 `BKT_P_L0 = 0.25`（engine.ts 第 242 行），多位學生因此在同一欄都顯示「鎖定中 25%」。
4. 「學習後分數」= 全部知識點 mastery 平均 ×100（page.tsx 第 94–101 行），鎖定中的 25% 也算進平均 → 收斂效果被放大到總分。

## 決策（三項修正，皆已與使用者確認）

### 1. 派題並列隨機化 — `engine.ts`
`pickNearest()` 改為：先算出候選題與目標難度的最小距離，篩出「距離等於最小距離（容忍 `Number.EPSILON` 等級浮點誤差）」的所有候選題，若有多題則用 `Math.random()` 隨機挑一題；若只有一題最近則行為不變。
- **只在真正並列時才隨機**，不影響「挑最接近難度」的核心邏輯與既有測試/行為假設。
- 影響範圍：`getNextItem()` 內的 `pickNearest` 呼叫處（含 `fresh` 題池與 `overall` 題池兩處呼叫），共用同一個新的 tie-aware 版本。

### 2. 學習後分數排除鎖定中知識點 — `page.tsx`
`scoredStudents` 的 `score` 計算：
```ts
const unlocked = s.diagnosis.filter(d => d.status !== 'locked');
score: unlocked.length > 0
  ? Math.round((unlocked.reduce((sum, d) => sum + d.mastery, 0) / unlocked.length) * 100)
  : null,
```
- 邊界：全部知識點都鎖定中（剛加入、第一關都還沒解鎖）→ `unlocked.length === 0` → `score = null` → 沿用現有「—」顯示，行為與空 `diagnosis` 一致。
- 排序（`?sort=score_desc/asc`）邏輯不變，仍以 `score`（含 `null` 排最後）排序。

### 3. 新增「總作答次數」欄位 — `page.tsx`
`scoredStudents` 多算：
```ts
totalAttempts: s.diagnosis.reduce((sum, d) => sum + d.attempts, 0),
```
- 表格新增一欄，放在「學習後分數」右邊，欄名「總作答次數」。
- **純顯示，不參與排序**（維持現有排序只對「學習後分數」欄生效，避免一次改動過多互動邏輯）。
- 不需要新查詢：`d.attempts` 已存在於既有 `diagnosis` 資料裡（engine.ts `KnowledgeDiagnosis.attempts`）。

## 測試
專案慣例：原始檔旁邊放 `*.test.ts`（Vitest，例如 `src/libs/scoring.test.ts`）。`engine.ts` 目前沒有測試檔，新增 `src/libs/adaptive/engine.test.ts`：
- 驗證 `pickNearest`（或其重構後的內部函式，視實作是否需要 export）在多題距離相同時，多次呼叫會產生不同結果分佈（例如跑 50 次，確認不是每次都選同一題）。
- 驗證距離不同時，仍必挑距離最小的那一題（隨機化不影響核心邏輯）。
- 若需要 export 一個原本是 private 邏輯的函式才能測試，直接 export，不做額外抽象包裝。

`page.tsx` 屬顯示層，不寫單元測試；用 `npm run lint`、`npm run check-types` 驗證型別與風格，並在瀏覽器手動核對：
- 同分班多位學生的知識點百分比不再逐位元相同（多刷新幾次 / 多送幾筆作答觀察）。
- 有學生知識點全鎖定時「學習後分數」顯示「—」而非 25 分起跳。
- 新欄「總作答次數」數字與各知識點小字「作答 N 次」加總一致。

## 不做（YAGNI）
- 不改 BKT 參數（`BKT_P_L0`／`P_T`／`P_GUESS`／`P_SLIP` 等）。
- 不改精熟／鎖定門檻（`MASTERY_THRESHOLD`）。
- 不動資料庫 schema、不加新的 API 欄位。
- 「總作答次數」欄不加排序（沿用現有只對分數排序的互動範圍）。
