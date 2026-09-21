'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { importLessonPackage } from '@/actions/lessonPackageActions';
import { Button } from '@/components/ui/button';

// 跟 docs/prompts/lesson-prep-assistant.md 的「Prompt 內容」區塊保持一致——
// 那份文件是給看得到 repo 的人參考用，這裡是給老師在網頁上直接複製用，
// 改一邊時記得同步改另一邊。
const LESSON_PREP_PROMPT = `# 角色
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
    { "stage": "pretest",            "title": "診斷測驗 - <單元>", "questions": [ <question> x5 ] },
    { "stage": "practice_basic",     "title": "基礎練習 - <單元>", "questions": [ <question> x3 ] },
    { "stage": "practice_advanced",  "title": "進階練習 - <單元>", "questions": [ <question> x3 ] },
    { "stage": "practice_challenge", "title": "挑戰練習 - <單元>", "questions": [ <question> x3 ] },
    { "stage": "deepen",             "title": "深化排序 - <單元>", "questions": [ <question> x2 ] },
    { "stage": "posttest",           "title": "驗收測驗 - <單元>", "questions": [ <question> x3 ] }
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
- pretest：type=mc，中偏易，診斷上節；posttest 概念一一對應 pretest（也 type=mc）
- practice_basic：僑生友善，句子精簡去長難句，可用 cloze 降負荷
- advanced→challenge：理解→應用→分析遞增；challenge 可用 short（需要文字表達的難題）或 cloze（精準用詞）
- deepen：全 rank，針對步驟/流程/程式執行順序/分層架構
- 每題必附 explanation；教材不足以支撐某難度或排序題時，於 teacherNotes 說明缺口，不得虛構
- 不要輸出 imageUrl / diagramSvg / audioUrl / position 等欄位，交由 QuizFlow pipeline 或匯入時自動處理`;

export default function ImportLessonPackagePage() {
  const router = useRouter();
  const [rawJson, setRawJson] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<{ path: string; message: string }[]>([]);
  const [result, setResult] = useState<Extract<Awaited<ReturnType<typeof importLessonPackage>>, { quizzes: unknown }> | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(LESSON_PREP_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 瀏覽器拒絕剪貼簿權限時靜默失敗，老師仍可從下方文字區塊手動選取複製
    }
  };

  const handleSubmit = async () => {
    if (!rawJson.trim()) {
      return;
    }
    setSubmitting(true);
    setError('');
    setDetail([]);
    setResult(null);

    try {
      const res = await importLessonPackage(rawJson);

      if ('error' in res) {
        if (res.error === 'PRO_REQUIRED' || res.error === 'QUOTA_EXCEEDED') {
          router.push('/dashboard/billing');
          return;
        }
        setError(res.error);
        setDetail(res.detail ?? []);
        return;
      }

      setResult(res);
    } catch {
      setError('匯入失敗，請重試');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/dashboard/quizzes" className="text-sm text-muted-foreground hover:text-foreground">
          ← 返回測驗列表
        </Link>
        <h1 className="mt-2 text-xl font-bold">批次匯入備課包</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          複製下方 prompt，貼到外部 AI 聊天工具（例如 Claude.ai 網頁版），把產出的 JSON 貼在下面的欄位，一次建立 6 份測驗 + 1 個單字卡集。
        </p>
      </div>

      {!result && (
        <>
          <div className="mb-4 rounded-xl border bg-gray-50">
            <button
              type="button"
              onClick={() => setShowPrompt(prev => !prev)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
            >
              <span>
                {showPrompt ? '▾' : '▸'}
                {' '}
                查看 / 複製 Prompt
              </span>
            </button>
            {showPrompt && (
              <div className="border-t px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopyPrompt}
                  className="mb-3"
                >
                  {copied ? '已複製 ✓' : '複製 Prompt'}
                </Button>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-xs">{LESSON_PREP_PROMPT}</pre>
              </div>
            )}
          </div>

          <textarea
            value={rawJson}
            onChange={e => setRawJson(e.target.value)}
            placeholder="貼上 AI 產生的完整 JSON"
            rows={14}
            className="w-full resize-none rounded-xl border px-4 py-3 font-mono text-xs placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              <p className="font-medium">{error}</p>
              {detail.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {detail.map(d => (
                    <li key={d.path}>
                      {d.path}
                      ：
                      {d.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={submitting || !rawJson.trim()}
            className="mt-4 w-full"
          >
            {submitting ? '匯入中…' : '批次匯入'}
          </Button>
        </>
      )}

      {result && (
        <div className="space-y-6">
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
            匯入完成，共建立
            {' '}
            {result.quizzes.length}
            {' '}
            份測驗 + 1 個單字卡集。
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">測驗</h2>
            <ul className="space-y-1">
              {result.quizzes.map(q => (
                <li key={q.id}>
                  <Link href={`/dashboard/quizzes/${q.id}/edit`} className="text-sm text-blue-600 hover:underline">
                    {q.title}
                    {' '}
                    ↗
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">單字卡集</h2>
            <Link href="/dashboard/vocab" className="text-sm text-blue-600 hover:underline">
              {result.vocabTitle}
              {' '}
              ↗
            </Link>
          </div>

          {(result.teacherNotes.flow || result.teacherNotes.misconceptions?.length || result.teacherNotes.afterClass) && (
            <div className="rounded-lg border bg-gray-50 p-4 text-sm">
              <p className="mb-2 font-semibold text-amber-600">⚠️ 教學筆記只顯示這一次，請自行複製保存</p>
              {result.teacherNotes.flow && (
                <pre className="mb-3 whitespace-pre-wrap font-sans">{result.teacherNotes.flow}</pre>
              )}
              {result.teacherNotes.misconceptions && result.teacherNotes.misconceptions.length > 0 && (
                <ul className="mb-3 list-disc space-y-1 pl-5">
                  {result.teacherNotes.misconceptions.map(m => <li key={m}>{m}</li>)}
                </ul>
              )}
              {result.teacherNotes.afterClass && <p>{result.teacherNotes.afterClass}</p>}
            </div>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setResult(null);
              setRawJson('');
            }}
          >
            再匯入一份
          </Button>
        </div>
      )}
    </div>
  );
}
