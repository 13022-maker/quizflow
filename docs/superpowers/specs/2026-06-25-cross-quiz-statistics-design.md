# 跨試卷成績統計（Cross-Quiz Statistics）

> 設計文件 — 2026-06-25

## 目的

老師需要「跨試卷」的學生成績總覽：依日期篩選多張試卷，以交叉表（學生 × 試卷）呈現各次得分並加總，支援姓名搜尋與 CSV 匯出。

## 核心需求

1. **日期區間篩選**：選擇起迄日，篩出該期間老師名下的所有試卷
2. **成績交叉表**：橫軸 = 各張試卷（依日期排列），縱軸 = 學生姓名
3. **加總欄**：最右欄顯示該學生在所有選定試卷的原始分加總
4. **姓名搜尋**：輸入框即時過濾學生列
5. **分數格式**：儲存格顯示 `85/100`，hover tooltip 顯示百分比（85%）
6. **CSV 匯出**：匯出與畫面相同的交叉表格式
7. **未作答**：該學生在某試卷沒有 response 時顯示 `—`，不計入加總

## 路由與入口

- **路由**：`/dashboard/quizzes/statistics`
- **入口**：`/dashboard/quizzes` 頁面頂部，在「新增測驗」按鈕旁加「📊 成績統計」按鈕

## 資料來源

```
response（studentName, score, totalPoints, submittedAt）
  JOIN quiz（id, title, ownerId, createdAt）
  WHERE quiz.ownerId = 當前老師
    AND quiz.createdAt BETWEEN startDate AND endDate
```

- 同一學生在同一試卷有多次作答：取**最高分**的那筆（與現有 `scoringMode: 'highest'` 預設一致）
- `studentName` 為 null 的作答歸類為「匿名」

## 架構

### Server Component：`page.tsx`

- auth 驗證（取 userId）
- 查詢該老師名下所有已發佈的 quiz（id, title, createdAt），傳給 client component 作篩選用
- 不在 server 端做 response 查詢（避免初始載入太慢）

### Client Component：`StatisticsCrossTable.tsx`

- 日期區間選擇器（兩個 `<input type="date">`）
- 「查詢」按鈕 → 呼叫 server action 拉資料
- 姓名搜尋框（即時篩選，不再觸發 server action）
- 交叉表渲染（HTML `<table>`，橫向可捲動）
- 加總欄（client 端計算）
- CSV 匯出按鈕（client 端 `Blob` + `URL.createObjectURL`）
- 空狀態提示（無資料時顯示友善文字）

### Server Action：`getStatisticsData`

位置：`src/actions/statisticsActions.ts`

```ts
// 輸入
{ startDate: string; endDate: string }

// 輸出
{
  quizzes: Array<{ id: number; title: string; createdAt: string }>;
  responses: Array<{
    quizId: number;
    studentName: string;
    score: number | null;
    totalPoints: number | null;
  }>;
}
```

- 驗證 userId（auth）
- Zod 驗證 startDate / endDate 格式
- 查詢 quiz WHERE ownerId = userId AND createdAt BETWEEN
- 查詢 response WHERE quizId IN (上述 quiz ids)
- 同一 studentName + quizId 有多筆時，SQL 取 MAX(score)
- 回傳原始資料，pivot 邏輯留給 client

### Client 端 Pivot 邏輯

```
輸入：quizzes[], responses[]
1. 收集所有不重複的 studentName → 排序
2. 對每個 student × quiz：找到對應 response → { score, totalPoints }
3. 加總 = Σ score（跳過 null）
4. 加總滿分 = Σ totalPoints（跳過 null）
```

## UI 版面

```
┌─────────────────────────────────────────────────────┐
│  ← 返回測驗列表          📊 成績統計               │
├─────────────────────────────────────────────────────┤
│  起始日 [____]  結束日 [____]  [查詢]               │
│  🔍 搜尋學生 [____________]         [匯出 CSV]      │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│ 學生姓名  │ 段考一    │ 段考二    │ 小考     │ 加總    │
│          │ 6/5      │ 6/12     │ 6/20    │         │
├──────────┼──────────┼──────────┼──────────┼─────────┤
│ 王小明    │ 85/100   │ 72/100   │ 90/100  │ 247/300 │
├──────────┼──────────┼──────────┼──────────┼─────────┤
│ 李小華    │ 92/100   │ 88/100   │ —       │ 180/200 │
├──────────┼──────────┼──────────┼──────────┼─────────┤
│ 匿名      │ 60/100   │ —        │ —       │ 60/100  │
└──────────┴──────────┴──────────┴──────────┴─────────┘
```

- 百分比以 tooltip（hover）顯示，不佔儲存格空間
- 加總欄同時顯示加總分 / 加總滿分
- 表格橫向超出時可水平捲動
- 排序：學生姓名按字母排，試卷按 createdAt 升序

## i18n

新增翻譯 key 到 `zh.json` 和 `en.json`：

| key | zh | en |
|-----|----|----|
| `Statistics.title` | 成績統計 | Score Statistics |
| `Statistics.start_date` | 起始日 | Start Date |
| `Statistics.end_date` | 結束日 | End Date |
| `Statistics.search` | 查詢 | Search |
| `Statistics.search_student` | 搜尋學生姓名 | Search student name |
| `Statistics.export_csv` | 匯出 CSV | Export CSV |
| `Statistics.total` | 加總 | Total |
| `Statistics.student_name` | 學生姓名 | Student Name |
| `Statistics.anonymous` | 匿名 | Anonymous |
| `Statistics.no_data` | 請選擇日期區間並點擊查詢 | Select a date range and click Search |
| `Statistics.no_results` | 該期間沒有成績資料 | No results for this period |
| `Statistics.back` | 返回測驗列表 | Back to quizzes |

## CSV 匯出格式

```csv
學生姓名,段考一 (6/5),段考二 (6/12),小考 (6/20),加總,加總滿分,加總百分比
王小明,85,72,90,247,300,82.3%
李小華,92,88,,180,200,90.0%
匿名,60,,,60,100,60.0%
```

- 未作答欄位為空（CSV 空值）
- 最後三欄：加總原始分、加總滿分、加總百分比

## 不做的事（YAGNI）

- 不做圖表（長條圖、折線圖）— 交叉表已能滿足需求，圖表之後再說
- 不做學生帳號關聯 — 目前靠 studentName 文字匹配
- 不做自動合併相似姓名 — 太容易誤判
- 不做即時更新 — 手動點「查詢」觸發
- 不改 DB schema — 純查詢現有資料，不需新表

## 檔案清單

| 檔案 | 用途 |
|------|------|
| `src/app/[locale]/(auth)/dashboard/quizzes/statistics/page.tsx` | Server Component 頁面 |
| `src/features/quiz/StatisticsCrossTable.tsx` | Client Component 交叉表 |
| `src/actions/statisticsActions.ts` | Server Action 查詢資料 |
| `src/locales/zh.json` | 新增 Statistics.* keys |
| `src/locales/en.json` | 新增 Statistics.* keys |
| `src/locales/ja.json` | 新增 Statistics.* keys |
| quizzes `page.tsx` | 加入「成績統計」按鈕連結 |
