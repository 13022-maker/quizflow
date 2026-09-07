/**
 * pdfImageMatch.ts — 把 PDF 逐頁擷取出來的圖片，對應回文字解析出來的題目（純函式，
 * 不碰 DB/Blob/PDF，方便測試）
 *
 * 設計取捨：unpdf 的 extractImages 只給像素資料，沒有每張圖在頁面上的座標(bbox)，
 * 沒辦法像「第一次」用 PyMuPDF 的 get_image_info(xrefs=True) 那樣精確對應圖片跟
 * 文字的上下位置。因此這裡刻意保守：只在「同一頁剛好 1 題疑似需要圖、剛好 1 張圖」
 * 時才自動配對；同一頁有多張圖或多題需要圖（例如三視圖選擇題那種一題配好幾張圖）
 * 一律不猜、留給老師手動附加——猜錯圖片比沒有圖片更糟，會誤導學生。
 */

// 題幹裡出現這些字眼，才視為「疑似需要圖片」的題目
const IMAGE_CUE_RE = /[上下左右]圖|如圖|如下圖/;

export function pageOfOffset(offset: number, pageStartOffsets: number[]): number {
  // pageStartOffsets[i] = 第 i+1 頁（1-based）在合併文字裡的起始字元位置，遞增排列
  let page = 1;
  for (let i = 0; i < pageStartOffsets.length; i++) {
    if (offset >= pageStartOffsets[i]!) {
      page = i + 1;
    } else {
      break;
    }
  }
  return page;
}

/** 由每頁文字長度算出各頁在合併文字裡的起始位置；合併時用 joiner（預設 '\n'）接頁。 */
export function computePageStartOffsets(pageTexts: string[], joiner = '\n'): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const text of pageTexts) {
    starts.push(offset);
    offset += text.length + joiner.length;
  }
  return starts;
}

export type MatchableQuestion = {
  question: string;
  sourceOffset: number;
};

export type MatchResult<Q extends MatchableQuestion, I> = {
  matched: Map<Q, I>;
  unmatchedQuestions: Q[]; // 疑似需要圖但沒能安全配對到的題目
};

export function matchImagesToQuestions<Q extends MatchableQuestion, I>(
  questions: Q[],
  pageStartOffsets: number[],
  imagesByPage: Map<number, I[]>,
): MatchResult<Q, I> {
  const matched = new Map<Q, I>();
  const unmatchedQuestions: Q[] = [];

  const questionsByPage = new Map<number, Q[]>();
  for (const q of questions) {
    if (!IMAGE_CUE_RE.test(q.question)) {
      continue; // 題幹沒有「下圖」之類字眼，視為不需要圖
    }
    const page = pageOfOffset(q.sourceOffset, pageStartOffsets);
    const list = questionsByPage.get(page);
    if (list) {
      list.push(q);
    } else {
      questionsByPage.set(page, [q]);
    }
  }

  for (const [page, qs] of questionsByPage) {
    const imgs = imagesByPage.get(page) ?? [];
    if (imgs.length === qs.length && imgs.length > 0) {
      qs.forEach((q, i) => matched.set(q, imgs[i]!));
    } else {
      unmatchedQuestions.push(...qs);
    }
  }

  return { matched, unmatchedQuestions };
}
