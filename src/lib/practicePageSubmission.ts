/* eslint-disable no-irregular-whitespace -- 結果頁「班級　姓名」中間的全形空格是刻意的中文排版間距 */

/**
 * 靜態練習頁（/api/p/[id] 線上分享版）「確認送出」成績回傳的純函式：
 * 答案表產生、送出內容驗證、server 端重算分數、結果頁 HTML、老師端 CSV。
 *
 * 純函式（除了 generateResultToken 用 crypto 亂數）：不碰 DB、不碰 Request，方便測試；
 * 由 api/p/[id]/submit、api/p/[id]/r/[token]、practice-stats 相關 route 呼叫。
 *
 * 信任邊界：練習頁是公開免登入頁面，送出內容全部當不可信輸入。
 *   - 分數一律由 server 依 practice_page_share.answer_key 重算，不收 client 算好的分數。
 *   - 唯一無法驗證的是填空題「看答案次數」(hintUses)：這是學生瀏覽器內的行為，server 看不到，
 *     只能記錄 client 回報值（學生若竄改只會讓自己少扣分）。題目答案本來就內嵌在練習頁 HTML 裡，
 *     這是練習用途、不是防弊考試，這個取捨可接受。
 */
import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import type { FillBlankPracticeQuestion } from './exportFillBlankPracticePage';
import type { PracticePageQuestion } from './exportPracticePage';

export const MAX_SUBMISSION_BODY_BYTES = 64 * 1024;
export const MAX_SUBMISSION_ANSWERS = 500;
export const MAX_STUDENT_FIELD_LENGTH = 40;
export const MAX_TYPED_LENGTH = 100;
const MAX_HINT_USES = 999;
// 選項 index 上限：比照 practicePageEvents.ts 的 chosenOption（0–19），-1 = 未作答
const MAX_OPTION_INDEX = 19;

/* ---------- 答案表（存在 practice_page_share.answer_key） ---------- */

const choiceAnswerKeySchema = z.object({
  kind: z.literal('choice'),
  items: z.array(z.object({
    correctIndex: z.number().int().min(0),
    optionCount: z.number().int().min(1),
    questionId: z.number().int().nullable(),
  })),
});

const fillBlankAnswerKeySchema = z.object({
  kind: z.literal('fillblank'),
  hintPenaltyPercent: z.number().min(0).max(100),
  items: z.array(z.object({ answer: z.string() })),
});

const answerKeySchema = z.discriminatedUnion('kind', [choiceAnswerKeySchema, fillBlankAnswerKeySchema]);

export type ChoiceAnswerKey = z.infer<typeof choiceAnswerKeySchema>;
export type FillBlankAnswerKey = z.infer<typeof fillBlankAnswerKeySchema>;
export type PracticePageAnswerKey = z.infer<typeof answerKeySchema>;

export function buildChoiceAnswerKey(questions: PracticePageQuestion[]): ChoiceAnswerKey {
  return {
    kind: 'choice',
    items: questions.map(q => ({
      correctIndex: q.correctIndex,
      optionCount: q.options.length,
      questionId: q.id ?? null,
    })),
  };
}

export function buildFillBlankAnswerKey(questions: FillBlankPracticeQuestion[], hintPenaltyPercent: number): FillBlankAnswerKey {
  return {
    kind: 'fillblank',
    hintPenaltyPercent,
    items: questions.map(q => ({ answer: q.answer })),
  };
}

// DB jsonb 讀回來的值不保證格式（舊資料 / 手動改過），驗證失敗回 null
export function parsePracticePageAnswerKey(value: unknown): PracticePageAnswerKey | null {
  const parsed = answerKeySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/* ---------- 送出內容驗證 ---------- */

// 必填字串：trim 後不可空白，過長截斷（不整筆拒絕，避免學生因為名字太長送不出去）
const requiredText = (max: number) =>
  z.string().transform(s => s.trim().slice(0, max)).pipe(z.string().min(1));

const choiceAnswer = z.number().int().min(-1).max(MAX_OPTION_INDEX);
const fillBlankAnswer = z.object({
  typed: z.string().transform(s => s.slice(0, MAX_TYPED_LENGTH)),
  hintUses: z.number().int().min(0).max(MAX_HINT_USES),
});

const submissionSchema = z.object({
  sessionId: z.string().uuid(),
  className: requiredText(MAX_STUDENT_FIELD_LENGTH),
  studentName: requiredText(MAX_STUDENT_FIELD_LENGTH),
  answers: z.array(z.union([choiceAnswer, fillBlankAnswer])).min(1).max(MAX_SUBMISSION_ANSWERS),
});

export type SubmissionAnswer = z.infer<typeof choiceAnswer> | z.infer<typeof fillBlankAnswer>;
export type PracticePageSubmission = z.infer<typeof submissionSchema>;

export type ParseSubmissionResult =
  | { ok: true; submission: PracticePageSubmission }
  | { ok: false; error: string };

// body 用 text 收（練習頁以 text/plain 送出，不觸發 CORS preflight），這裡自己 JSON.parse
export function parsePracticePageSubmission(body: string): ParseSubmissionResult {
  if (body.length > MAX_SUBMISSION_BODY_BYTES) {
    return { ok: false, error: '送出內容過大' };
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, error: '不是合法的 JSON' };
  }
  const parsed = submissionSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: '送出內容格式不正確，請確認班級、姓名都有填寫' };
  }
  return { ok: true, submission: parsed.data };
}

/* ---------- 計分 ---------- */

export type SubmissionDetailItem = {
  index: number;
  correct: boolean;
  points: number;
  maxPoints: number;
  chosen?: number; // 選擇題：選的選項 index，-1 = 未作答
  typed?: string; // 填空題：學生最後一次核對的內容
  hintUses?: number; // 填空題：看答案次數（client 回報）
};

export type SubmissionDetail = {
  kind: 'choice' | 'fillblank';
  total: number;
  correctCount: number;
  items: SubmissionDetailItem[];
};

export type ScoreResult =
  | { ok: true; score: number; maxScore: number; detail: SubmissionDetail }
  | { ok: false; error: string };

// 每題基礎配分：Math.floor(100/N)，最後一題補足餘數到 100（跟練習頁內嵌 JS、distributePoints 慣例一致）
function questionPoints(index: number, total: number): number {
  const base = Math.floor(100 / total);
  return index === total - 1 ? 100 - base * (total - 1) : base;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scorePracticePageSubmission(key: PracticePageAnswerKey, answers: SubmissionAnswer[]): ScoreResult {
  const total = key.items.length;
  if (total === 0 || answers.length !== total) {
    return { ok: false, error: '題數不符，練習頁可能已被老師更新，請重新整理頁面後再作答' };
  }

  const items: SubmissionDetailItem[] = [];
  let sum = 0;

  if (key.kind === 'choice') {
    for (let i = 0; i < total; i++) {
      const a = answers[i];
      if (typeof a !== 'number') {
        return { ok: false, error: '答案格式與練習頁題型不符' };
      }
      const item = key.items[i]!;
      // 超出該題選項範圍的 index 視為未作答
      const chosen = a >= 0 && a < item.optionCount ? a : -1;
      const maxPoints = questionPoints(i, total);
      const correct = chosen === item.correctIndex;
      const points = correct ? maxPoints : 0;
      sum += points;
      items.push({ index: i, correct, points, maxPoints, chosen });
    }
  } else {
    for (let i = 0; i < total; i++) {
      const a = answers[i];
      if (typeof a !== 'object' || a === null) {
        return { ok: false, error: '答案格式與練習頁題型不符' };
      }
      const typed = a.typed.trim();
      const maxPoints = questionPoints(i, total);
      // 比對規則跟練習頁內嵌 JS 的 doCheck 一致：trim + 不分大小寫
      const correct = typed !== '' && typed.toLowerCase() === key.items[i]!.answer.trim().toLowerCase();
      const penalty = Math.min(1, (key.hintPenaltyPercent / 100) * a.hintUses);
      const raw = correct ? maxPoints * (1 - penalty) : 0;
      sum += raw;
      items.push({ index: i, correct, points: round1(raw), maxPoints, typed, hintUses: a.hintUses });
    }
  }

  return {
    ok: true,
    score: Math.round(sum),
    maxScore: 100,
    detail: { kind: key.kind, total, correctCount: items.filter(it => it.correct).length, items },
  };
}

/* ---------- 結果頁 token ---------- */

// 24 bytes 亂數 → 32 字元 base64url，不可猜（結果頁網址等同存取憑證）
export function generateResultToken(): string {
  return randomBytes(24).toString('base64url');
}

export function isValidResultToken(token: string): boolean {
  return /^[\w-]{32}$/.test(token);
}

/* ---------- Google Classroom 分享按鈕 ---------- */

// Classroom 分享 URL：不走 Classroom API、不需 OAuth；學生在 Classroom 選作業把連結附加後自己按「繳交」
export function buildClassroomShareUrl({ url, title }: { url: string; title: string }): string {
  return `https://classroom.google.com/share?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
}

/* ---------- 共用格式化 ---------- */

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 台灣老師/學生看的時間一律用台北時區，格式 2026/11/09 14:03
export function formatTaipeiTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}/${get('month')}/${get('day')} ${hour}:${get('minute')}`;
}

/* ---------- 結果頁 HTML（唯讀、無 script） ---------- */

export type SubmissionResultPageParams = {
  quizTitle: string;
  className: string;
  studentName: string;
  score: number;
  maxScore: number;
  createdAt: Date;
  detail: SubmissionDetail;
};

function itemDescription(item: SubmissionDetailItem): string {
  if (item.typed !== undefined) {
    const hint = item.hintUses ? `（看答案 ${item.hintUses} 次）` : '';
    return `作答：${item.typed ? escHtml(item.typed) : '（空白）'}${hint}`;
  }
  if (item.chosen !== undefined) {
    return item.chosen >= 0 ? `選第 ${item.chosen + 1} 個選項` : '未作答';
  }
  return '';
}

export function buildSubmissionResultHtml(params: SubmissionResultPageParams): string {
  const { quizTitle, className, studentName, score, maxScore, createdAt, detail } = params;
  const rows = detail.items.map(item => `
      <tr class="${item.correct ? 'ok' : 'err'}">
        <td>${item.correct ? '✅' : '❌'} 第 ${item.index + 1} 題</td>
        <td>${itemDescription(item)}</td>
        <td class="pts">${item.points} / ${item.maxPoints}</td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${escHtml(quizTitle)} 作答結果 | QuizFlow</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Microsoft JhengHei","Noto Sans TC","Segoe UI",Roboto,sans-serif;color:#0f2540;background:#f4f7fb;line-height:1.5}
  .wrap{max-width:760px;margin:0 auto;padding:24px 18px 60px}
  .head{background:linear-gradient(180deg,#1e5a8a,#17466b);color:#fff;border-radius:14px;padding:18px 22px}
  .head .kick{font-size:12px;letter-spacing:.14em;opacity:.85;font-weight:700}
  .head h1{margin:6px 0 0;font-size:21px}
  .card{margin-top:16px;background:#fff;border:1px solid #b9d3e8;border-radius:14px;padding:18px 22px}
  .who{font-weight:800;font-size:16px;text-align:center}
  .score{font-size:40px;font-weight:900;color:#17466b;text-align:center;margin:6px 0 0}
  .meta{text-align:center;color:#5a6b7d;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  td{padding:8px 6px;border-bottom:1px solid #eef2f6;vertical-align:top}
  td.pts{text-align:right;white-space:nowrap;font-weight:700}
  tr.ok td:first-child{color:#15803d;font-weight:700}
  tr.err td:first-child{color:#c62828;font-weight:700}
  .foot{margin-top:18px;text-align:center;font-size:12px;color:#8091a1}
</style>
</head>
<body>
<div class="wrap">
  <header class="head">
    <div class="kick">QuizFlow 練習頁．作答結果</div>
    <h1>${escHtml(quizTitle)}</h1>
  </header>
  <section class="card">
    <div class="who">${escHtml(className)}　${escHtml(studentName)}</div>
    <div class="score">${score} <span style="font-size:18px;font-weight:700">/ ${maxScore} 分</span></div>
    <div class="meta">答對 ${detail.correctCount} / ${detail.total} 題．送出時間 ${formatTaipeiTime(createdAt)}（台北時間）</div>
  </section>
  <section class="card">
    <table>${rows}
    </table>
  </section>
  <div class="foot">此頁為唯讀成績紀錄，由 QuizFlow 練習頁送出時產生。</div>
</div>
</body>
</html>
`;
}

/* ---------- 老師端 CSV ---------- */

export type SubmissionCsvRow = {
  className: string;
  studentName: string;
  score: number;
  maxScore: number;
  createdAt: Date;
  detail: SubmissionDetail;
};

function csvCell(value: string): string {
  // 開頭是 = + - @ 的儲存格在 Excel/Sheets 會被當公式執行，前面補 ' 擋公式注入（學生姓名是不可信輸入）
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function itemCsv(item: SubmissionDetailItem | undefined): string {
  if (!item) {
    return '';
  }
  const mark = item.correct ? 'O' : 'X';
  return item.hintUses ? `${mark}(看答案${item.hintUses}次)` : mark;
}

export function submissionsToCsv(rows: SubmissionCsvRow[]): string {
  const maxQuestions = rows.reduce((m, r) => Math.max(m, r.detail.items.length), 0);
  const header = ['班級', '姓名', '分數', '滿分', '答對題數', '題數', '送出時間'];
  for (let i = 1; i <= maxQuestions; i++) {
    header.push(`第${i}題`);
  }
  const lines = [header.join(',')];
  for (const r of rows) {
    const cells = [
      r.className,
      r.studentName,
      String(r.score),
      String(r.maxScore),
      String(r.detail.correctCount),
      String(r.detail.total),
      formatTaipeiTime(r.createdAt),
    ];
    for (let i = 0; i < maxQuestions; i++) {
      cells.push(itemCsv(r.detail.items[i]));
    }
    lines.push(cells.map(csvCell).join(','));
  }
  // 加 BOM 讓 Excel 正確辨識 UTF-8
  return `﻿${lines.join('\r\n')}\r\n`;
}
