/**
 * materialFigures.ts — 「上傳講義命題」自動附加教材圖片的純函式（無 I/O、無 console）
 *
 * 流程：
 * 1. selectFigures：從 PDF 擷取的內嵌圖片（或老師直接上傳的圖片）挑出值得引用的圖，
 *    濾掉項目符號、小圖示等過小的圖片，依頁碼排序並編號 FIG1..FIGn
 * 2. buildFigureManifest / buildFigurePromptRules：產生要附在 prompt 後面的圖片清單與規則，
 *    請 AI 在「真的需要看圖才能作答」的題目加上 "figure": "FIGn"
 * 3. resolveFigureRefs：AI 回傳後把各題的 figure 欄位對回實際圖片（容錯各種寫法）
 * 4. attachFigureUrls / stripFigureFields：上傳完成後把網址寫進 imageUrl，並移除 figure 欄位
 */
import type { Buffer } from 'node:buffer';

// 候選圖片：PDF 擷取的圖（有頁碼、寬高）或老師上傳的圖（pageNumber 為 null）
export type FigureCandidate = {
  pageNumber: number | null;
  buffer: Buffer;
  contentType: string;
  width?: number;
  height?: number;
};

export type MaterialFigure = FigureCandidate & {
  id: string; // 'FIG1'、'FIG2'...
};

export type SelectFiguresOptions = {
  maxFigures?: number;
  minSide?: number;
};

export function selectFigures(
  images: FigureCandidate[],
  { maxFigures = 10, minSide = 80 }: SelectFiguresOptions = {},
): MaterialFigure[] {
  // 寬高未知（例如老師直接上傳的照片）就不過濾，只濾掉「已知」太小的圖
  const isTooSmall = (img: FigureCandidate) =>
    (img.width !== undefined && img.width < minSide)
    || (img.height !== undefined && img.height < minSide);

  // Array.prototype.sort 是穩定排序，同頁圖片維持原本擷取順序；pageNumber 為 null 的排在最後
  const pageKey = (img: FigureCandidate) => img.pageNumber ?? Number.POSITIVE_INFINITY;

  return images
    .filter(img => !isTooSmall(img))
    .map((img, i) => ({ img, i }))
    .sort((a, b) => pageKey(a.img) - pageKey(b.img) || a.i - b.i)
    .slice(0, maxFigures)
    .map(({ img }, i) => ({ ...img, id: `FIG${i + 1}` }));
}

// 單張圖的標籤，例如「FIG1（第3頁）」或「FIG2（上傳圖片2）」
export function figureLabel(figure: MaterialFigure, uploadIndex: number): string {
  return figure.pageNumber !== null
    ? `${figure.id}（第${figure.pageNumber}頁）`
    : `${figure.id}（上傳圖片${uploadIndex}）`;
}

export function buildFigureManifest(figures: MaterialFigure[]): string {
  if (figures.length === 0) {
    return '';
  }
  let uploadCount = 0;
  const lines = figures.map((f) => {
    if (f.pageNumber === null) {
      uploadCount++;
    }
    return figureLabel(f, uploadCount);
  });
  return ['可引用的教材圖片：', ...lines].join('\n');
}

export function buildFigurePromptRules(hasFigures: boolean): string {
  if (!hasFigures) {
    return '';
  }
  return [
    '教材圖片引用規則：',
    '- 若某題「真的需要看圖才能作答」（例如判讀圖表、辨認圖中構造、依圖計算），在該題 JSON 加上 "figure": "FIG1" 這樣的欄位，並在題幹用「如圖」「下圖」等用語提到圖片',
    '- 只能使用上面清單列出的圖片編號，不可自行編造不存在的編號',
    '- 不需要看圖的題目不要加 figure 欄位（大部分題目不需要）',
    '- 若圖片內容看不清楚或無法確定，不要出答案取決於該圖的題目',
  ].join('\n');
}

// 把 AI 回傳的各種寫法正規化成 'FIGn'：'FIG1'、'fig1'、' FIG 1 '、1、'1'
function normalizeFigureRef(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const compact = String(value).toUpperCase().replace(/\s+/g, '');
  const match = compact.match(/^(?:FIG)?(\d+)$/);
  return match ? `FIG${Number(match[1])}` : null;
}

export type FigureRefs = {
  refsByIndex: Map<number, MaterialFigure>;
  used: MaterialFigure[]; // 去重，依第一次被引用順序
};

export function resolveFigureRefs(questions: unknown[], figures: MaterialFigure[]): FigureRefs {
  const byId = new Map(figures.map(f => [f.id, f]));
  const refsByIndex = new Map<number, MaterialFigure>();
  const used: MaterialFigure[] = [];
  const usedIds = new Set<string>();

  questions.forEach((q, i) => {
    if (!q || typeof q !== 'object') {
      return;
    }
    const id = normalizeFigureRef((q as Record<string, unknown>).figure);
    const figure = id ? byId.get(id) : undefined;
    if (!figure) {
      return;
    }
    refsByIndex.set(i, figure);
    if (!usedIds.has(figure.id)) {
      usedIds.add(figure.id);
      used.push(figure);
    }
  });

  return { refsByIndex, used };
}

// 依圖片 id → 網址設定 imageUrl；沒有網址（上傳失敗）的題目就不附圖。回傳成功附圖的題數
export function attachFigureUrls(
  questions: unknown[],
  refsByIndex: Map<number, MaterialFigure>,
  urlById: Map<string, string>,
): number {
  let count = 0;
  for (const [i, figure] of refsByIndex) {
    const q = questions[i];
    const url = urlById.get(figure.id);
    if (url && q && typeof q === 'object') {
      (q as Record<string, unknown>).imageUrl = url;
      count++;
    }
  }
  return count;
}

// figure 只是 AI 與後端之間的中介欄位，回應前一律移除
export function stripFigureFields(questions: unknown[]): void {
  for (const q of questions) {
    if (q && typeof q === 'object') {
      delete (q as Record<string, unknown>).figure;
    }
  }
}
