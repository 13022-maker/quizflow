/**
 * pdfTextExtract.ts — 伺服器端從 PDF 擷取「文字層」原始文字(不是 OCR、不是 AI 判讀)
 *
 * 用途：題庫 PDF 解析(parse-exam-bank route)需要逐字元精確的原始文字，才能用
 * examBankParser 的 regex 對應官方標示的正解；不能改用 AI 讀圖重新描述題目一次，
 * 那樣正解就變成「AI 判斷」而不是官方文件本身(跟這次設計的核心原則牴觸)。
 *
 * 只吃「文字型 PDF」(文字可反白複製的那種)；掃描圖檔式 PDF 沒有文字層，會回傳
 * 空字串或極少字元，呼叫端要處理「解析不到題目」的情況並提示老師改用貼上文字。
 *
 * 用 legacy build 是因為這支只在 Vercel Node runtime(伺服器端)執行，沒有瀏覽器
 * DOM/Worker 環境；client 端(AIQuizModal.tsx)另外用 build/pdf.min.mjs + Worker，
 * 兩邊用途不同、不要混用。
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractPdfText(data: Uint8Array): Promise<string> {
  // Node 環境沒有 Worker/DOM，pdfjs 偵測不到就自動退回同執行緒的 fake worker，
  // 不需要(也不能)手動指定 disableWorker 之類的選項。
  const doc = await getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);

    const content = await page.getTextContent();
    const pageText = content.items
      .map(item => ('str' in item ? item.str : ''))
      .join('');
    pageTexts.push(pageText);
  }

  return pageTexts.join('\n');
}
