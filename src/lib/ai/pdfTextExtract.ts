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
 * 踩過的坑：直接用 pdfjs-dist/legacy/build/pdf.mjs 在 Vercel Node runtime 跑，
 * 遇到某些內嵌字型（例如 Type3 字型）會在文字擷取過程中觸發
 * 「ReferenceError: DOMMatrix is not defined」而整支 API 500——pdfjs-dist 本身
 * 只有在偵測到 optional 的 `canvas` 套件時才會自動 polyfill DOMMatrix，沒裝就
 * 直接炸。改用 unpdf：它內建一份專為 serverless/edge 環境編譯的 PDF.js，已經
 * 處理好這類瀏覽器專屬全域變數的相容性問題，不用自己手動 polyfill。
 */
import { extractText, getDocumentProxy } from 'unpdf';

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(data);
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}
