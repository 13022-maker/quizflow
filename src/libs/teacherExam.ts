// src/libs/teacherExam.ts
// QuizFlow — 教師 Word 試卷匯出（啟英高中標準格式）
// 將測驗資料輸出成 .docx Buffer，符合學校試卷模板（B4 紙、頁首勾選、答案欄、頁尾頁碼）
//
// 支援：
// - N 選項選擇題（單選 / 多選 / 是非）
// - 配分依實際題目分數動態計算
// - 答案欄依選擇題題數動態產生（每列 10 格）
// - 簡答題另闢「二、簡答題」區
// - teacher / student 兩種變體（老師卷預填答案 + 參考答案；學生卷留白）
//
// 注意：本檔輸出 CJK 試卷內容，刻意使用全形空白（U+3000）作排版，故停用 lint 規則。
/* eslint-disable no-irregular-whitespace */

import type { Buffer } from 'node:buffer';

import type { IParagraphOptions, IRunOptions } from 'docx';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeightRule,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExamPeriod = '期初' | '期中' | '期末';
export type ClassType = '正規班' | '菁英班' | '實用技能班' | '僑生班';
export type ExamVariant = 'teacher' | 'student';

// 選擇題（含單選 / 多選 / 是非；是非由 mapper 轉成「正確 / 錯誤」兩選項）
export type TeacherExamChoiceQuestion = {
  stem: string;
  options: string[]; // N 個選項文字（不含 (A) 前綴，由本檔自動編號）
  points: number;
  answerIndices: number[]; // 正解選項的索引（多選可多個），老師卷用
};

// 簡答題
export type TeacherExamShortQuestion = {
  stem: string;
  points: number;
  refAnswer?: string; // 參考答案（老師卷顯示）
};

export type TeacherExamInput = {
  school: string;
  academicYear: string;
  semester: string;
  examPeriod: ExamPeriod;
  subject: string;
  classType: ClassType;
  applicableClass: string;
  teacherName: string;
  scope: string;
  variant?: ExamVariant; // 預設 student
  questions: TeacherExamChoiceQuestion[];
  shortAnswers?: TeacherExamShortQuestion[];
};

// ─── Constants ───────────────────────────────────────────────────────────────

const FONT = '新細明體';
const SZ_BODY = 24; // 12pt
const SZ_TITLE = 28; // 14pt — 頁首大標
const SZ_NOTE = 20; // 10pt — 誠實提醒
const FILLED_BOX = '■';
const EMPTY_BOX = '□';
const COLS_PER_ROW = 10; // 答案欄每列格數

// 必填欄位（除 questions / shortAnswers / variant 之外都是 string）
const REQUIRED_STRING_FIELDS: ReadonlyArray<keyof TeacherExamInput> = [
  'school',
  'academicYear',
  'semester',
  'examPeriod',
  'subject',
  'classType',
  'applicableClass',
  'teacherName',
  'scope',
];

type TextOpts = Pick<IRunOptions, 'size' | 'bold'>;
type ParagraphOpts = Pick<IParagraphOptions, 'alignment' | 'spacing'>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// 統一字型的 TextRun
function T(text: string, opts: TextOpts = {}): TextRun {
  return new TextRun({
    text,
    font: { ascii: FONT, eastAsia: FONT, hAnsi: FONT, cs: 'Arial' },
    size: opts.size ?? SZ_BODY,
    bold: opts.bold ?? false,
  });
}

// 緊排版段落（中文無多餘行距）
function P(children: TextRun[], opts: ParagraphOpts = {}): Paragraph {
  return new Paragraph({
    children,
    alignment: opts.alignment,
    spacing: opts.spacing ?? { before: 0, after: 0, line: 280 },
  });
}

// 索引 → 選項字母（0→A、1→B …）
function letterFor(index: number): string {
  return String.fromCharCode(65 + index);
}

// 配分文字：每題同分顯示「每{unit} X 分共 Y 分」，否則只顯示「共 Y 分」
function pointsLabel(items: { points: number }[], unit: '格' | '題'): string {
  if (items.length === 0) {
    return '';
  }
  const total = items.reduce((sum, q) => sum + q.points, 0);
  const first = items[0]!.points;
  const allEqual = items.every(q => q.points === first);
  return allEqual ? `(每${unit}${first}分共${total}分)` : `(共${total}分)`;
}

function validateInput(data: TeacherExamInput): void {
  for (const key of REQUIRED_STRING_FIELDS) {
    const v = data[key];
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`teacherExam: 缺少必填欄位 ${key}`);
    }
  }
  if (!Array.isArray(data.questions)) {
    throw new TypeError('teacherExam: questions 必須為陣列');
  }
}

// ─── Sections ────────────────────────────────────────────────────────────────

// 頁首：學校 + 學年期別 + 期初／期中／期末勾選 + 科目
function buildTopHeader(data: TeacherExamInput): Paragraph {
  const periods: ExamPeriod[] = ['期初', '期中', '期末'];
  return P(
    [
      T(`${data.school}${data.academicYear}學年度第${data.semester}學期`, { size: SZ_TITLE, bold: true }),
      ...periods.flatMap(p => [
        T(p === data.examPeriod ? FILLED_BOX : EMPTY_BOX, { size: SZ_TITLE, bold: true }),
        T(p, { size: SZ_TITLE, bold: true }),
      ]),
      T(`　科目：${data.subject}　試卷`, { size: SZ_TITLE, bold: true }),
    ],
    { alignment: AlignmentType.CENTER },
  );
}

// 班級類別勾選列
function buildClassTypeLine(data: TeacherExamInput): Paragraph {
  const types: ClassType[] = ['正規班', '菁英班', '實用技能班', '僑生班'];
  return P(
    types.flatMap((t, i) => [
      T(t === data.classType ? FILLED_BOX : EMPTY_BOX),
      T(t),
      i < types.length - 1 ? T('　　') : T(''),
    ]),
    { alignment: AlignmentType.CENTER },
  );
}

// 適用班級
function buildApplicableClass(data: TeacherExamInput): Paragraph {
  return P([T('適用班級：'), T(data.applicableClass, { bold: true })]);
}

// 命題教師、命題範圍、學生填寫資訊
function buildTeacherRow(data: TeacherExamInput): Paragraph {
  return P([
    T('命題教師：　'),
    T(data.teacherName),
    T('　　命題範圍：'),
    T(data.scope, { bold: true }),
    T('　　班級：　　　　姓名：　　　　學號：　　　座號：'),
  ]);
}

// 誠信提醒
function buildHonestyNotice(): Paragraph {
  return P(
    [T('＊誠實是我們珍視的美德，我們喜愛「拒絕作弊，堅守正直」的你！', { size: SZ_NOTE })],
    { alignment: AlignmentType.LEFT },
  );
}

// 段落標題（粗體）
function buildSectionHeading(title: string): Paragraph {
  return P([T(title, { bold: true })]);
}

// 單一選擇題：N.　(　)題幹　(A)選項　(B)選項 …
function buildChoiceQuestion(num: number, q: TeacherExamChoiceQuestion): Paragraph {
  const opts = q.options.map((text, i) => `(${letterFor(i)})${text}`).join('　');
  return P(
    [
      T(`${num}.　(　)`),
      T(q.stem),
      T(`　${opts}　`),
    ],
    { spacing: { before: 60, after: 60, line: 320 } },
  );
}

// 答案欄：依題數動態產生（每列 COLS_PER_ROW 格），老師卷在答案格預填正解字母
function buildAnswerGrid(count: number, answersByNum: string[]): Table {
  // 頁面內容寬度 ≈ 14572 - 680 - 680 = 13212 DXA → 10 欄 × 1321 each
  const COL_WIDTH = 1321;
  const TABLE_WIDTH = COL_WIDTH * COLS_PER_ROW;
  const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const borders = { top: border, bottom: border, left: border, right: border };

  // 題號列（不足整列的格子留空）
  const headerRow = (start: number) =>
    new TableRow({
      height: { value: 360, rule: HeightRule.ATLEAST },
      children: Array.from({ length: COLS_PER_ROW }, (_, i) => {
        const num = start + i;
        const label = num <= count ? String(num) : '';
        return new TableCell({
          borders,
          width: { size: COL_WIDTH, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          shading: { fill: 'F2F2F2', type: ShadingType.CLEAR, color: 'auto' },
          margins: { top: 40, bottom: 40, left: 60, right: 60 },
          children: [P([T(label, { bold: true })], { alignment: AlignmentType.CENTER })],
        });
      }),
    });

  // 作答列（老師卷填正解，學生卷留白）
  const answerRow = (start: number) =>
    new TableRow({
      height: { value: 540, rule: HeightRule.ATLEAST },
      children: Array.from({ length: COLS_PER_ROW }, (_, i) => {
        const num = start + i;
        const ans = num <= count ? (answersByNum[num - 1] ?? '') : '';
        return new TableCell({
          borders,
          width: { size: COL_WIDTH, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 40, bottom: 40, left: 60, right: 60 },
          children: [P([T(ans, { bold: true })], { alignment: AlignmentType.CENTER })],
        });
      }),
    });

  const rows: TableRow[] = [];
  // 至少 1 列；題數為 0 時仍輸出一列空格
  const totalRows = Math.max(1, Math.ceil(count / COLS_PER_ROW));
  for (let r = 0; r < totalRows; r++) {
    const start = r * COLS_PER_ROW + 1;
    rows.push(headerRow(start), answerRow(start));
  }

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: Array(COLS_PER_ROW).fill(COL_WIDTH),
    rows,
  });
}

// 簡答題區：逐題題幹 + 作答線（學生卷）／參考答案（老師卷）
function buildShortAnswerSection(
  shortAnswers: TeacherExamShortQuestion[],
  variant: ExamVariant,
): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(P([T('')])); // 空行
  out.push(buildSectionHeading(`二、簡答題${pointsLabel(shortAnswers, '題')}：`));
  shortAnswers.forEach((q, i) => {
    out.push(P([T(`${i + 1}. `), T(q.stem)], { spacing: { before: 60, after: 40, line: 320 } }));
    if (variant === 'teacher') {
      out.push(
        P([T('　參考答案：', { bold: true }), T(q.refAnswer ?? '（無）')], {
          spacing: { before: 0, after: 60, line: 320 },
        }),
      );
    } else {
      out.push(
        P([T('　答：________________________________________________')], {
          spacing: { before: 0, after: 60, line: 320 },
        }),
      );
    }
  });
  return out;
}

// 頁尾：第 N 頁，共 M 頁
function buildFooter(): Footer {
  return new Footer({
    children: [
      P(
        [
          T('第 '),
          new TextRun({
            children: [PageNumber.CURRENT],
            font: { ascii: FONT, eastAsia: FONT, hAnsi: FONT },
            size: SZ_BODY,
            bold: true,
          }),
          T(' 頁，共 '),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            font: { ascii: FONT, eastAsia: FONT, hAnsi: FONT },
            size: SZ_BODY,
            bold: true,
          }),
          T(' 頁'),
        ],
        { alignment: AlignmentType.CENTER },
      ),
    ],
  });
}

// ─── Main Entry ──────────────────────────────────────────────────────────────

/**
 * 將測驗資料輸出成符合啟英高中試卷模板的 .docx Buffer。
 *
 * @throws Error 當缺少必填欄位時
 */
export async function generateTeacherExam(data: TeacherExamInput): Promise<Buffer> {
  validateInput(data);

  const variant: ExamVariant = data.variant ?? 'student';
  const choices = data.questions;
  const shortAnswers = data.shortAnswers ?? [];

  // 老師卷：每題正解字母字串（多選串接，如 "AC"）
  const answersByNum = choices.map(q =>
    variant === 'teacher'
      ? q.answerIndices.map(letterFor).join('')
      : '',
  );

  const children: Array<Paragraph | Table> = [
    buildTopHeader(data),
    buildClassTypeLine(data),
    buildApplicableClass(data),
    buildTeacherRow(data),
    buildHonestyNotice(),
    P([T('')]), // 空行
    buildSectionHeading(`一、選擇題${pointsLabel(choices, '格')}：`),
  ];

  choices.forEach((q, i) => {
    children.push(buildChoiceQuestion(i + 1, q));
  });

  // 答案欄
  children.push(P([T('')]));
  children.push(P([T('答案欄（請將答案書寫於答案格，未填寫不予計分）')]));
  children.push(buildAnswerGrid(choices.length, answersByNum));

  // 簡答題區（若有）
  if (shortAnswers.length > 0) {
    children.push(...buildShortAnswerSection(shortAnswers, variant));
  }

  const doc = new Document({
    creator: 'QuizFlow',
    title: data.subject,
    styles: {
      default: {
        document: {
          run: {
            font: { ascii: FONT, eastAsia: FONT, hAnsi: FONT, cs: 'Arial' },
            size: SZ_BODY,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 14572, height: 20639 }, // B4
            margin: { top: 567, right: 680, bottom: 851, left: 680, header: 567, footer: 567 },
          },
        },
        footers: { default: buildFooter() },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
