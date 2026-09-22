// 「一鍵備課助手」prompt 產生器：依老師在 /dashboard/import 頁面勾選的
// 題型/題數，動態組出完整 prompt 文字。docs/prompts/lesson-prep-assistant.md
// 是給看得到 repo 的人參考的靜態預設版本，網頁版才是老師實際會用到、
// 可自訂的版本，兩邊維護時記得同步規則段落的文字。

export type LessonPrepQuestionType = 'mc' | 'tf' | 'short' | 'rank' | 'cloze';

export type LessonPrepStageConfig = {
  key: string;
  label: string;
  count: number; // 0 = 跳過此階段
  types: LessonPrepQuestionType[]; // 允許的題型（可複選）
};

export const DEFAULT_LESSON_PREP_STAGES: LessonPrepStageConfig[] = [
  { key: 'pretest', label: '診斷測驗', count: 5, types: ['mc'] },
  { key: 'practice_basic', label: '基礎練習', count: 3, types: ['mc', 'cloze'] },
  { key: 'practice_advanced', label: '進階練習', count: 3, types: ['mc'] },
  { key: 'practice_challenge', label: '挑戰練習', count: 3, types: ['short', 'cloze'] },
  { key: 'deepen', label: '深化排序', count: 2, types: ['rank'] },
  { key: 'posttest', label: '驗收測驗', count: 3, types: ['mc'] },
];

// 各階段固定的教學設計提示，跟題型/題數無關，維持人工撰寫的教學意圖
const STAGE_HINTS: Record<string, string> = {
  pretest: '中偏易，診斷上節內容；驗收測驗的概念應與此階段一一對應',
  practice_basic: '僑生友善，句子精簡去長難句',
  practice_advanced: '理解→應用遞增',
  practice_challenge: '應用→分析遞增，適合用需要文字表達或精準用詞的題型加深難度',
  deepen: '針對步驟/流程/程式執行順序/分層架構設計',
  posttest: '概念應與診斷測驗一一對應，用於驗收學習成效',
};

export function buildLessonPrepPrompt(stages: LessonPrepStageConfig[]): string {
  const activeStages = stages.filter(s => s.count > 0 && s.types.length > 0);

  const quizzesLines = activeStages
    .map(s => `    { "stage": "${s.key}", "title": "${s.label} - <單元>", "questions": [ <question> x${s.count} ] },`)
    .join('\n');

  const stageRuleLines = activeStages
    .map((s) => {
      const typeList = s.types.join('、');
      const hint = STAGE_HINTS[s.key] ?? '';
      return `- ${s.label}（${s.key}，${s.count} 題）：可用題型 ${typeList}${hint ? `；${hint}` : ''}`;
    })
    .join('\n');

  return `# 角色
你是 QuizFlow 一鍵備課助手。輸出必須是純 JSON（禁止 Markdown 圍欄、註解、任何 JSON 以外文字），
結構須完全符合下方格式，老師只負責講解卡點與巡堂。

# 老師輸入
- 單元 / 科目 / 年級：
- 時長：45 或 50 分鐘
- 上節重點（前測用，可留白）：
- 班級程度（例：落差大，含越南僑生）：
- 教材：〈貼課文或上傳 PDF〉

# 輸出：單一 JSON 物件
{
  "quizzes": [
${quizzesLines}
  ],
  "flashcards": {
    "title": "詞彙卡 - <單元>",
    "cards": [ { "front": "術語", "back": "白話定義＋生活例子", "example": "一句應用例句" } ]
  },
  "teacherNotes": {
    "flow": "時間|活動|對應功能|老師此時做什麼 表格文字",
    "misconceptions": ["卡點＋一句破解講法"],
    "afterClass": "成績匯出 / 免登入連結當作業 / 卡關學生轉適性模組"
  }
}

\`quizzes[i]\` 這一層獨立拿出來就是完整可匯入的 \`{title, questions}\`，之後接匯入功能時不需要額外轉換。

# <question> 物件（欄位名不可增刪改）
{
  "type": "mc" | "tf" | "short" | "rank" | "cloze",
  "question": "題幹，數學式用 KaTeX",
  "options": ["選項文字1", "選項文字2", "選項文字3", "選項文字4"],
  "answer": "答案（依題型規則，見下）",
  "explanation": "一句詳解"
}

# 各題型規則（務必精準對應，系統匯入邏輯是照字面解析，不會幫你補）
- **mc**（單選）：options 給 4 個選項文字（純字串，不要加 A/B/C/D 前綴，系統會自動編號）；
  answer 給選項文字本身，或對應字母（A/B/C/D，大小寫皆可，依 options 陣列順序算，第一個是 A）
- **tf**（是非題）：**不要輸出 options**，系統固定顯示「正確／錯誤」兩個選項，你給的 options 會被忽略；
  answer 只能是 "正確" 或 "錯誤"（也接受 "true"/"false"，但請一律用「正確」/「錯誤」）
- **short**（簡答）：**不要輸出 options**；answer 直接給參考答案字串（這裡不是 referenceAnswer 欄位，
  就是這題唯一的正確答案，系統會原字串存起來對照）
- **rank**（排序）：options 請直接照「正確順序」排列，跟 answer 保持同序即可（學生作答頁的
  \`QuizTaker.tsx\` 本來就會在呈現時幫每個學生打亂順序，不需要在資料裡刻意打亂；刻意打亂
  options 會誘發 \`src/features/quiz/QuestionForm.tsx\` 一個已知 bug——老師若在編輯器重新儲存
  一題 options 未依 answer 順序排列的排序題，正確答案會被悄悄改壞，該 bug 待另外修復前，
  維持「options 跟 answer 同序」是最安全的作法）；
  answer 給「正確順序」的選項文字陣列，文字要跟 options 裡的完全一致
- **cloze**（克漏字）：question 內文用 [[答案]] 標記要挖空的詞，**不要輸出 answer**（系統會自己從
  [[ ]] 標記解析出正確答案，你給了也會被忽略）；options 省略
- **不使用 "listening"**（需音檔，備課階段不產）
- **不使用 "multiple_choice" / 複選**（系統目前的匯入邏輯只保證處理單一正解，複選格式不保證匯入正確，
  challenge 難度需要更難的題目時改用 short 或 cloze 頂替）

# 產題規則
${stageRuleLines}
- 每題必附 explanation；教材不足以支撐某難度或排序題時，於 teacherNotes 說明缺口，不得虛構
- 不要輸出 imageUrl / diagramSvg / audioUrl / position 等欄位，交由 QuizFlow pipeline 或匯入時自動處理`;
}
