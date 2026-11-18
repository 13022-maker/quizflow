/**
 * figureLocator.ts — AI 從檔案出題時「這題的圖在原始檔第幾頁、哪個區塊」的解析與裁切座標計算
 * （純函式，不碰 DOM / PDF / Blob，方便測試）。
 *
 * 背景：PR #119 要 AI 把電路圖改寫成文字，結果題幹變成一大段電路描述，學生很難讀。
 * 改為：AI 只輸出圖的位置（figure 欄位），前端用 pdf.js 把該頁畫到 canvas 後裁切成
 * PNG、上傳成題目圖片（question.image_url），題幹維持「如圖所示之電路……」的精簡寫法。
 *
 * figure 欄位格式（見 src/lib/ai/figureReferencePrompt.ts 的 buildFigureLocatorRule）：
 *   { "page": 1, "bbox": { "left": 0.1, "top": 0.4, "right": 0.6, "bottom": 0.7 } }
 * - page：PDF 為第幾頁（從 AI 收到的檔案第 1 頁起算）；圖片來源為第幾張圖片
 * - bbox：相對於整頁的比例 0–1；也容忍 [x0, y0, x1, y1] 陣列與 0–1000 刻度（Gemini 習慣）
 * - bbox 缺漏 / 不合法 → 保留 page、bbox 為 null，前端退回整頁截圖（寧可整頁也不要沒圖）
 */

export type FigureBBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type FigureLocator = {
  /** 1-based；經 attachFigureLocators 後為「上傳檔案」的頁碼／圖片序號 */
  page: number;
  bbox: FigureBBox | null;
};

// 比例座標最小寬高：小於頁面 2% 幾乎不可能是一張完整的圖，多半是 AI 亂填
const MIN_SIZE = 0.02;
// 最大值超過這個門檻就視為 0–1000 刻度（Gemini 原生 bounding box 刻度）
const THOUSAND_SCALE_THRESHOLD = 1.5;
// 換算後容許稍微超出頁面（之後夾回 0–1），超出太多視為亂填
const OUT_OF_RANGE_TOLERANCE = 0.1;

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function normalizeFigureBBox(raw: unknown): FigureBBox | null {
  let values: unknown[];
  if (Array.isArray(raw)) {
    if (raw.length !== 4) {
      return null;
    }
    values = raw;
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    values = [o.left, o.top, o.right, o.bottom];
  } else {
    return null;
  }

  const nums = values.map(toFiniteNumber);
  if (nums.includes(null)) {
    return null;
  }
  let [x0, y0, x1, y1] = nums as [number, number, number, number];

  if (Math.max(x0, y0, x1, y1) > THOUSAND_SCALE_THRESHOLD) {
    x0 /= 1000;
    y0 /= 1000;
    x1 /= 1000;
    y1 /= 1000;
  }

  const lo = -OUT_OF_RANGE_TOLERANCE;
  const hi = 1 + OUT_OF_RANGE_TOLERANCE;
  if ([x0, y0, x1, y1].some(n => n < lo || n > hi)) {
    return null;
  }

  const left = clamp01(Math.min(x0, x1));
  const right = clamp01(Math.max(x0, x1));
  const top = clamp01(Math.min(y0, y1));
  const bottom = clamp01(Math.max(y0, y1));

  if (right - left < MIN_SIZE || bottom - top < MIN_SIZE) {
    return null;
  }
  return { left, top, right, bottom };
}

/**
 * 解析 AI 回傳的 figure 欄位；pageCount 為 AI 收到的檔案頁數（PDF 頁數或圖片張數），page 超出範圍視為不合法。
 */
export function parseFigureLocator(raw: unknown, pageCount: number): FigureLocator | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const page = toFiniteNumber(o.page);
  if (page === null || !Number.isInteger(page) || page < 1 || page > pageCount) {
    return null;
  }
  return { page, bbox: normalizeFigureBBox(o.bbox) };
}

/**
 * 伺服器端後處理：逐題驗證 AI 回傳的 figure 欄位，合法的換成標準格式並把頁碼
 * 加上 pageOffset（伺服器端只截取 startPage–endPage 送給 AI，AI 的第 1 頁 = 上傳檔案的第 startPage 頁），
 * 不合法的直接刪除（前端 needsFigure() 會另外警告老師）。
 * @returns 保留下來的 figure 數
 */
export function attachFigureLocators(
  questions: unknown,
  opts: { pageCount: number; pageOffset: number },
): number {
  if (!Array.isArray(questions)) {
    return 0;
  }
  let kept = 0;
  for (const q of questions) {
    if (!q || typeof q !== 'object' || !('figure' in q)) {
      continue;
    }
    const rec = q as Record<string, unknown>;
    const parsed = parseFigureLocator(rec.figure, opts.pageCount);
    if (parsed) {
      rec.figure = { page: parsed.page + opts.pageOffset, bbox: parsed.bbox };
      kept++;
    } else {
      delete rec.figure;
    }
  }
  return kept;
}

export type CropRect = { x: number; y: number; width: number; height: number };

// 浮點誤差保險：0.6 * 100 = 60.00000000000001，直接 ceil 會多 1px
const EPS = 1e-6;

/**
 * 把比例 bbox 換成畫布像素裁切範圍，四邊各加 padding（相對頁面比例），並夾在畫布內。
 * bbox 為 null → 整頁。
 */
export function computeCropRect(
  bbox: FigureBBox | null,
  canvasWidth: number,
  canvasHeight: number,
  padding = 0.02,
): CropRect {
  if (!bbox) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  }
  const padX = padding * canvasWidth;
  const padY = padding * canvasHeight;
  const x0 = Math.max(0, Math.floor(bbox.left * canvasWidth - padX + EPS));
  const y0 = Math.max(0, Math.floor(bbox.top * canvasHeight - padY + EPS));
  const x1 = Math.min(canvasWidth, Math.ceil(bbox.right * canvasWidth + padX - EPS));
  const y1 = Math.min(canvasHeight, Math.ceil(bbox.bottom * canvasHeight + padY - EPS));
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}
