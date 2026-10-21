// 段考命題助手（public/tools/exam-composer.html）批次貼上解析的行為測試。
// 工具是單一靜態 HTML，邏輯包在 IIFE 內，所以用 jsdom 載入整頁、操作 UI，
// 再讀它自動存進 localStorage 的草稿來斷言結果。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const HTML = fs.readFileSync(path.join(process.cwd(), 'public/tools/exam-composer.html'), 'utf8');
const DRAFT_KEY = 'exam-helper-draft-v1';

type DraftQ = { type: string; options: string[]; answer: number | string | null };

async function paste(text: string) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://quizflow.test/tools/exam-composer.html',
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });
  const d = dom.window.document;
  // 先清空範例，只留空白考卷的 1 題
  (d.getElementById('clear-all') as HTMLButtonElement).click();
  (d.getElementById('clear-all') as HTMLButtonElement).click();
  (d.getElementById('bulk-input') as HTMLTextAreaElement).value = text;
  (d.getElementById('bulk-parse') as HTMLButtonElement).click();
  const status = d.getElementById('bulk-status')!.textContent ?? '';
  await new Promise(r => setTimeout(r, 500)); // 等自動存檔（400ms debounce）
  const draft = JSON.parse(dom.window.localStorage.getItem(DRAFT_KEY)!);
  dom.window.close();
  // 第 1 題是清空後的空白題，貼上的從第 2 題開始
  return { qs: draft.qs.slice(1) as DraftQ[], status };
}

describe('exam-composer 批次貼上', () => {
  it('是非題答案接受全形 Ｏ／Ｘ 與小寫、全形小寫', async () => {
    const { qs } = await paste([
      '是非｜3\n甲\n答案：Ｏ',
      '是非｜3\n乙\n答案：Ｘ',
      '是非｜3\n丙\n答案：o',
      '是非｜3\n丁\n答案：ｘ',
    ].join('\n\n'));

    expect(qs.map(q => q.answer)).toEqual(['O', 'X', 'O', 'X']);
  });

  it('選擇題答案與選項字母接受全形', async () => {
    const { qs } = await paste('選擇｜4\n題目\n（Ａ）甲　（Ｂ）乙　（Ｃ）丙　（Ｄ）丁\n答案：Ｃ');

    expect(qs[0]!.options).toEqual(['甲', '乙', '丙', '丁']);
    expect(qs[0]!.answer).toBe(2);
  });

  it('選項字母跳號：選項放回對應字母位置，答案不會錯位，並提示老師', async () => {
    const { qs, status } = await paste('選擇｜4\n題目\n(A) 甲 (B) 乙 (D) 丁\n答案：D');

    expect(qs[0]!.options).toEqual(['甲', '乙', '', '丁']);
    expect(qs[0]!.answer).toBe(3);
    expect(status).toContain('跳號');
  });

  it('連續字母照常解析，不出現跳號提示', async () => {
    const { qs, status } = await paste('選擇｜4\n題目\n(A) 甲\n(B) 乙\n(C) 丙\n(D) 丁\n答案：b');

    expect(qs[0]!.options).toEqual(['甲', '乙', '丙', '丁']);
    expect(qs[0]!.answer).toBe(1);
    expect(status).not.toContain('跳號');
  });
});
