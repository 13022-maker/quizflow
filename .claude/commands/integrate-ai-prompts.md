# Claude Code 指令：整合 QuizFlow AI Prompt 系統

> 可直接貼進 Claude Code，或存成 `.claude/commands/integrate-ai-prompts.md`
> 用 slash command `/integrate-ai-prompts` 執行。

---

## 任務

將 `docs/prompts/` 下的兩份 system prompt 模板，整合進 QuizFlow 的 AI 子系統，建立可維護、型別安全、有 schema 驗證的 prompt 基礎設施。

## 輸入檔案

請先確認以下兩個檔案存在，若不存在請停止並告知：

- `docs/prompts/quiz-generation-system-prompt.md`
- `docs/prompts/quiz-diagnosis-system-prompt.md`

---

## 執行模式：策略優先（遵守 CLAUDE.md）

**Phase 1：調研與提案（不要寫任何 source code）**

完成以下調研，並產出一份「整合規劃書」等我確認後才進 Phase 2：

1. 檢視現有 `lib/` 結構，確認是否已有 `ai/`、`prompts/` 或類似模組
2. 檢視現有 Anthropic SDK 用法（grep `@anthropic-ai/sdk`），若已有呼叫模式需沿用
3. 確認以下依賴狀態（讀 `package.json`）：
   - `@anthropic-ai/sdk`（若無需安裝）
   - `zod`（若無需安裝）
4. 檢視環境變數設定，確認 `ANTHROPIC_API_KEY` 是否已有約定位置
5. 讀完兩份 markdown prompt，識別出所有需要 Zod 化的 JSON 結構
6. 產出規劃書，包含：
   - 確認要建立 / 修改的檔案清單
   - 是否需要新增依賴
   - 與現有程式碼的互動點
   - 預估產出程式碼行數
   - 風險與未決事項

**不要跳過 Phase 1 直接實作。**

---

## Phase 2：實作（Phase 1 確認後執行）

預期檔案結構（可依 Phase 1 調研結果微調）：

```
lib/ai/
├── prompts/
│   ├── quiz-generation.ts       // export QUIZ_GENERATION_SYSTEM_PROMPT
│   ├── quiz-diagnosis.ts         // export QUIZ_DIAGNOSIS_SYSTEM_PROMPT
│   └── index.ts                  // barrel export
├── schemas/
│   ├── quiz.ts                   // Zod schema 對應出題 JSON output
│   ├── diagnosis.ts              // Zod schema 對應診斷 JSON output
│   └── index.ts
├── services/
│   ├── generate-quiz.ts          // 呼叫 Anthropic API 出題，含驗證與重試
│   ├── diagnose-answers.ts       // 呼叫 Anthropic API 診斷
│   └── index.ts
├── types/
│   └── index.ts                  // 由 Zod schema 推導的 TypeScript 型別
├── README.md                     // 用法文件
└── index.ts                      // 最外層 barrel export
```

### 實作細節要求

**prompts/*.ts**

- System prompt 常數必須**完整**從 markdown 檔內容轉成 string，不可省略、摘要、或重寫
- 使用 template literal（反引號）保留 markdown 格式
- 檔頭加上 JSDoc：
  ```ts
  /**
   * Source: docs/prompts/quiz-generation-system-prompt.md
   * Keep this file in sync with the markdown source when updating.
   * Last synced: [當前日期]
   */
  ```

**schemas/*.ts**

- 對每份 prompt 的 JSON output 結構，建立對應 Zod schema
- 使用 `z.infer<typeof schema>` 推導 TypeScript 型別
- 所有欄位都要嚴格定義，不可用 `z.any()`
- Enum 型欄位（如 `severity`, `cognitive_level`）用 `z.enum([...])`
- Nested object 結構要拆成獨立 schema 以便重用

**services/*.ts**

Service function 實作規範：

- Non-streaming（不處理 stream）
- 使用 `@anthropic-ai/sdk`
- Model 預設 `claude-sonnet-4-5`（若不確定最新可用 model，先在 Phase 1 詢問）
- 溫度建議：出題 0.7，診斷 0.3
- `max_tokens`：出題 4096，診斷 2048
- 錯誤處理流程：
  1. 呼叫 API → 若失敗（non-schema error）拋出附 context 的 Error
  2. 嘗試 JSON.parse response → 失敗則重試 1 次（重送同樣 request）
  3. Zod schema 驗證 → 失敗則重試 1 次，並在第二次 user message 附上「前次錯誤訊息」要求修正
  4. 兩次皆失敗 → throw `QuizGenerationError` / `QuizDiagnosisError`，含原始 response 與 validation error
- 所有錯誤 path 皆需 `console.error` 含足夠 context（不要吞錯誤）
- Function signature：

```ts
// services/generate-quiz.ts
export async function generateQuiz(input: {
  videoTitle: string;
  videoTranscript: string;
  keyConcepts?: string[];
  targetAudience?: string;
  language?: string;
  numQuestions: number;
}): Promise<QuizOutput>;

// services/diagnose-answers.ts
export async function diagnoseAnswers(input: {
  quizData: QuizOutput;
  userAnswers: UserAnswer[];
  userHistory?: unknown;
  userLocale?: string;
}): Promise<DiagnosisOutput>;
```

**README.md**

需包含：

- 模組用途（一段話）
- 與 `docs/prompts/*.md` 的同步規則
- 兩個 service function 的基本用法範例
- 錯誤類型說明
- 如何修改 prompt（務必從 markdown 改，再同步到 .ts）

---

## Phase 3：驗證（Phase 2 完成後）

1. 建立 `lib/ai/__tests__/schemas.test.ts`（如 repo 已有測試框架）
   - 以一段合法 JSON 範例驗證 quiz schema 通過
   - 以一段合法 JSON 範例驗證 diagnosis schema 通過
   - 以一段缺欄位的 JSON 驗證 schema 會 reject
2. 若 repo 尚未配置測試框架，**不要自行安裝**，改為提供範例 JSON 與驗證腳本放在 `lib/ai/examples/`
3. 執行 `pnpm tsc --noEmit`（或 repo 慣用的 type check 指令）確保 0 錯誤
4. 執行 lint（若有 lint 設定）

---

## 全域規範

- TypeScript strict 模式相容
- 不可使用 `any` 型別；必要時使用 `unknown` 搭配 type guard
- Zod schema 作為**唯一真實來源**，TypeScript 型別一律 `z.infer` 推導
- 不額外修改 prompt 內容（若 prompt 本身有不合理之處，在 Phase 1 提出，不擅自改寫）
- 所有新檔案開頭需有 JSDoc 區塊註明用途
- 檔名一律 kebab-case
- 遵守專案既有 import 慣例（`@/lib/...` 或相對路徑，以現存 code 為準）

## 禁止事項

- ❌ 跳過 Phase 1 直接寫程式碼
- ❌ 使用 `any` 型別
- ❌ 自行擴充或摘要 prompt 內容
- ❌ 吞掉任何 error 或用 `try { ... } catch { }` 空白處理
- ❌ 自行安裝未列出的新依賴（若需要，在 Phase 1 詢問）
- ❌ 為了跑通而把 prompt 字串寫短或省略

---

## 完成條件（Definition of Done）

- [ ] `lib/ai/` 結構建立完成
- [ ] 兩份 system prompt 作為 TypeScript 常數完整匯出
- [ ] Zod schema 覆蓋兩份 prompt 的 output 結構
- [ ] 兩個 service function 具備重試與錯誤處理
- [ ] `tsc --noEmit` 通過
- [ ] `README.md` 撰寫完成
- [ ] 最終回報：新增 / 修改的檔案清單、總行數、任何未決事項
