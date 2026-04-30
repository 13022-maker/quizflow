// src/libs/teacherExam.ts
// QuizFlow — 教師 Word 試卷匯出（啟英高中標準格式）
// 將測驗資料輸出成 .docx Buffer，符合學校試卷模板（B4 紙、頁首勾選、答案欄）
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

export type TeacherExamQuestion = {
  stem: string;
  options: { A: string; B: string; C: string; D: string };
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
  questions: TeacherExamQuestion[];
};

// ─── Constants ───────────────────────────────────────────────────────────────

const FONT = '新細明體';
const SZ_BODY = 24; // 12pt
const SZ_TITLE = 28; // 14pt — 頁首大標
const SZ_NOTE = 20; // 10pt — 誠實提醒
const FILLED_BOX = '■';
const EMPTY_BOX = '□';

// 必填欄位（除 questions 之外都是 string）
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

// 單一題目：N.【  】題幹 (A) ... (B) ... (C) ... (D) ...
function buildQuestion(num: number, q: TeacherExamQuestion): Paragraph {
  return P(
    [
      T(`${num}.【　　】`),
      T(q.stem),
      T(` (A) ${q.options.A}　(B) ${q.options.B}　(C) ${q.options.C}　(D) ${q.options.D}`),
    ],
    { spacing: { before: 60, after: 60, line: 320 } },
  );
}

// 答案欄：3 列題號 + 3 列空格 = 共 30 格
function buildAnswerGrid(): Table {
  // 頁面內容寬度 ≈ 14572 - 680 - 680 = 13212 DXA → 10 欄 × 1321 each
  const COL_WIDTH = 1321;
  const TABLE_WIDTH = COL_WIDTH * 10;
  const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const borders = { top: border, bottom: border, left: border, right: border };

  const headerRow = (start: number) =>
    new TableRow({
      height: { value: 360, rule: HeightRule.ATLEAST },
      children: Array.from(
        { length: 10 },
        (_, i) =>
          new TableCell({
            borders,
            width: { size: COL_WIDTH, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            shading: { fill: 'F2F2F2', type: ShadingType.CLEAR, color: 'auto' },
            margins: { top: 40, bottom: 40, left: 60, right: 60 },
            children: [
              P([T(String(start + i), { bold: true })], { alignment: AlignmentType.CENTER }),
            ],
          }),
      ),
    });

  const answerRow = () =>
    new TableRow({
      height: { value: 540, rule: HeightRule.ATLEAST },
      children: Array.from(
        { length: 10 },
        () =>
          new TableCell({
            borders,
            width: { size: COL_WIDTH, type: WidthType.DXA },
            margins: { top: 40, bottom: 40, left: 60, right: 60 },
            children: [P([T('')])],
          }),
      ),
    });

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: Array(10).fill(COL_WIDTH),
    rows: [
      headerRow(1),
      answerRow(),
      headerRow(11),
      answerRow(),
      headerRow(21),
      answerRow(),
    ],
  });
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

  const children: Array<Paragraph | Table> = [
    buildTopHeader(data),
    buildClassTypeLine(data),
    buildApplicableClass(data),
    buildTeacherRow(data),
    buildHonestyNotice(),
    P([T('')]), // 空行
    buildSectionHeading('一、單選題'),
  ];

  data.questions.forEach((q, i) => {
    children.push(buildQuestion(i + 1, q));
  });

  children.push(P([T('')]));
  children.push(buildSectionHeading('一、選擇題(每格4分共100分)：'));
  children.push(P([T('答案欄（請將答案書寫於答案格，未填寫不予計分）')]));
  children.push(buildAnswerGrid());

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
