/**
 * pdfImageExtract.ts — 伺服器端從 PDF 逐頁擷取內嵌圖片（不是螢幕截圖，是原始內嵌圖）
 *
 * 用途：parse-exam-bank 匯入題庫 PDF 時，需要把「下圖所示...」這類題目附的圖也一併
 * 帶進去，不然只有文字題幹會讓題目看不懂。用 unpdf（已用於 pdfTextExtract.ts）的
 * extractImages，它回傳的是解碼後的原始像素（RGB/RGBA raw data），不是可以直接存檔
 * 的 PNG/JPEG，這裡用專案既有的 sharp 套件重新編碼成 PNG。
 *
 * 只做「擷取」，不做「配對」——圖片要對應到哪一題是 pdfImageMatch.ts 的事，這支只
 * 負責把每一頁的文字跟每一頁的圖片都撈出來。
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { extractImages, extractText, getDocumentProxy } from 'unpdf';

export type PageImage = {
  pageNumber: number; // 1-based
  buffer: Buffer;
  contentType: 'image/png';
};

export type PdfPageContent = {
  pageTexts: string[]; // 每一頁的文字，索引 0 = 第 1 頁
  images: PageImage[];
};

export async function extractPdfPageContent(data: Uint8Array): Promise<PdfPageContent> {
  const doc = await getDocumentProxy(data);
  const { text: pageTexts } = await extractText(doc, { mergePages: false });

  const rawImages: PageImage[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const pageImages = await extractImages(doc, pageNumber);
    for (const img of pageImages) {
      // sharp raw 輸入吃 Buffer/Uint8Array，channels 只能是 1(灰階)/3(RGB)/4(RGBA)，
      // unpdf 回傳的型別剛好就是這三種，可以直接餵進去不用額外轉換色彩空間。

      const png = await sharpEncodePng(img.data, img.width, img.height, img.channels);
      rawImages.push({ pageNumber, buffer: png, contentType: 'image/png' });
    }
  }

  return { pageTexts, images: removeRepeatedDecorationImages(rawImages) };
}

// 踩過的坑：很多題庫 PDF 每頁都嵌了同一張校徽/浮水印/裝訂線圖片，這種裝飾圖跟
// pdfImageMatch.ts「這頁圖片數量剛好等於這頁疑似需要圖的題目數」的配對假設完全
// 無關，卻會把每頁的圖片數量灌水，害真正該配對成功的頁面也被誤判成「數量對不
// 上」而放棄配對。用內容 hash 偵測：同一張圖片（byte 完全相同）出現在 2 頁以上，
// 視為裝飾圖，直接濾掉不參與配對——一張圖逐 byte 相同又橫跨多頁通常不會是真的
// 題目附圖（不同題目的圖幾乎不可能完全一樣）。
export function removeRepeatedDecorationImages(images: PageImage[]): PageImage[] {
  const pagesByHash = new Map<string, Set<number>>();
  const hashByImage = images.map((img) => {
    const hash = createHash('md5').update(img.buffer).digest('hex');
    const pages = pagesByHash.get(hash);
    if (pages) {
      pages.add(img.pageNumber);
    } else {
      pagesByHash.set(hash, new Set([img.pageNumber]));
    }
    return hash;
  });
  return images.filter((_, i) => (pagesByHash.get(hashByImage[i]!)?.size ?? 1) <= 1);
}

async function sharpEncodePng(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 3 | 4,
): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    raw: { width, height, channels },
  }).png().toBuffer();
}
