import { describe, expect, it } from 'vitest';

import { parseExamBankText } from './examBankParser';

describe('parseExamBankText', () => {
  it('解析格式 A(官方學科題庫常見：題號在前、圈選數字選項)', () => {
    const text = '1. (3) 下圖所示之D型正反器，Clock採何種準位觸發？ ①正電位觸發動作 ②負電位觸發動作 ③正緣觸發動作 ④負緣觸發動作 。'
      + '2. (1) 下列何者不是Linux的文書編輯器？ ①vi ②ed ③edit ④emacs 。';

    const { questions, failedSegments } = parseExamBankText(text);

    expect(failedSegments).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      number: 1,
      question: '下圖所示之D型正反器，Clock採何種準位觸發？',
      options: ['正電位觸發動作', '負電位觸發動作', '正緣觸發動作', '負緣觸發動作'],
      correctIndex: 2,
    });
    expect(questions[1]!.correctIndex).toBe(0);
  });

  it('解析格式 B(坊間題庫常見：正解在前、括號數字選項)', () => {
    const text = '( 3 ) 1. 下列何者不是微處理機的內部基本架構？ (1)控制單元 (2)算術邏輯單元 (3)輸入輸出單元 (4)暫存器。\n'
      + '( 2 ) 2. 在Windows系統中，欲將目前的畫面複製到剪貼簿中，應按鍵盤上的哪一個鍵？ (1)Pause (2)Print Screen (3)Scroll Lock (4)Insert。';

    const { questions, failedSegments } = parseExamBankText(text);

    expect(failedSegments).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      number: 1,
      question: '下列何者不是微處理機的內部基本架構？',
      options: ['控制單元', '算術邏輯單元', '輸入輸出單元', '暫存器'],
      correctIndex: 2,
    });
    expect(questions[1]!.correctIndex).toBe(1);
  });

  it('接受 (A)(B)(C)(D) 字母選項標記', () => {
    const text = '(C) 1. 下列何者是電機電子工程師學會的簡稱？ (A)CNS (B)ASCII (C)IEEE (D)ISO。';
    const { questions } = parseExamBankText(text);

    expect(questions).toHaveLength(1);
    expect(questions[0]!.correctIndex).toBe(2);
    expect(questions[0]!.options[2]).toBe('IEEE');
  });

  it('兩種格式混用在同一份文字裡也能各自解析', () => {
    const text = '1. (3) 格式A的題目？ ①甲 ②乙 ③丙 ④丁 。'
      + '(2) 2. 格式B的題目？ (1)甲 (2)乙 (3)丙 (4)丁。';
    const { questions } = parseExamBankText(text);

    expect(questions).toHaveLength(2);
    expect(questions[0]!.correctIndex).toBe(2);
    expect(questions[1]!.correctIndex).toBe(1);
  });

  it('切不出剛好 4 個選項的題目會放進 failedSegments，不影響其他題目解析', () => {
    const text = '1. (1) 正常題目？ ①甲 ②乙 ③丙 ④丁 。'
      + '2. (2) 選項殘缺的題目 ①甲 ②乙 。'
      + '3. (1) 另一題正常的？ ①子 ②丑 ③寅 ④卯 。';
    const { questions, failedSegments } = parseExamBankText(text);

    expect(questions.map(q => q.number)).toEqual([1, 3]);
    expect(failedSegments).toHaveLength(1);
    expect(failedSegments[0]).toContain('第 2 題');
  });

  it('正解編號超出選項數量時歸類為失敗，不會產生越界的 correctIndex', () => {
    // 正解標成 4(index 3)，但選項只切出 3 個
    const text = '1. (4) 選項只有三個的題目？ ①甲 ②乙 ③丙 。';
    const { questions, failedSegments } = parseExamBankText(text);

    expect(questions).toHaveLength(0);
    expect(failedSegments).toHaveLength(1);
  });

  it('unpdf 在 PDF 原始換行處插入的 \\n 剛好斷在中文詞中間時，選項文字要合併回去，不留空格', () => {
    // 真實踩過的坑：官方題庫 PDF 排版把「壓縮檔案」斷行成「壓縮檔」/「案」兩行，
    // unpdf 擷取文字層時在斷行處插入 \n，若不處理，畫面上會顯示成「壓縮檔 案」
    const text = '45. (2) 下列何者是「WinZip」工具軟體的主要功能？ ①檔案上傳或下載 ②壓縮檔\n案或解壓縮檔案 ③聲音或影片播放軟體 ④燒錄 CD 或 DVD 。';
    const { questions, failedSegments } = parseExamBankText(text);

    expect(failedSegments).toEqual([]);
    expect(questions[0]!.options[1]).toBe('壓縮檔案或解壓縮檔案');
    // 中文跟英文交界的正常空格(「燒錄 CD」)要保留，不能一併被吃掉
    expect(questions[0]!.options[3]).toBe('燒錄 CD 或 DVD');
  });

  it('空字串輸入回傳空結果，不拋錯', () => {
    const { questions, failedSegments } = parseExamBankText('');

    expect(questions).toEqual([]);
    expect(failedSegments).toEqual([]);
  });

  it('解析官方 PDF 文字層真實擷取出來的原始字串(逐字元,無換行)', () => {
    // 逐字複製自 12000 電腦硬體裝修 丙級 學科題庫工作項目01 第1頁,pdfjs-dist 文字層擷取結果
    const text = '12000 電腦硬體裝修 丙級 工作項目 01：電腦、電子及電機機械識圖'
      + '1. (3) 下圖所示之 D 型正反器，Clock 採何種準位觸發？ ①正電位觸發動作 ②負電位觸發動作 ③正緣觸發動作 ④負緣觸發動作 。'
      + '2. (3) 下圖所示符號用來表示 ①多工器 ②編碼器 ③解多工器 ④解碼器 。'
      + '4. (3) 下圖所示邏輯符號功能相當於 ①OR ②AND ③XOR ④XNOR 。'
      + '5. (2) 下圖 IC 符號第一支接腳位置在 ①Ａ腳 ②Ｂ腳 ③Ｃ腳 ④Ｄ腳 。';

    const { questions, failedSegments } = parseExamBankText(text);

    // 第 3 題(三視圖選擇題,選項本身是圖)刻意沒放進這段測試文字,只驗證純文字題能正確解析
    expect(failedSegments).toEqual([]);
    expect(questions.map(q => q.number)).toEqual([1, 2, 4, 5]);
    expect(questions[3]).toMatchObject({
      number: 5,
      question: '下圖 IC 符號第一支接腳位置在',
      options: ['Ａ腳', 'Ｂ腳', 'Ｃ腳', 'Ｄ腳'],
      correctIndex: 1,
    });
  });

  it('每題記錄 sourceOffset(anchor 在輸入文字裡的起始位置)，給圖片配對用', () => {
    const text = '1. (1) 第一題？ ①甲 ②乙 ③丙 ④丁 。2. (1) 第二題？ ①甲 ②乙 ③丙 ④丁 。';
    const { questions } = parseExamBankText(text);

    expect(questions[0]!.sourceOffset).toBe(0);
    // 第二題的 anchor「2. (1)」要出現在第一題完整結束之後
    expect(questions[1]!.sourceOffset).toBeGreaterThan(questions[0]!.sourceOffset);
    expect(text.slice(questions[1]!.sourceOffset, questions[1]!.sourceOffset + 6)).toBe('2. (1)');
  });
});
