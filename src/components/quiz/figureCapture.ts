/**
 * figureCapture.ts — 瀏覽器端：依 AI 回傳的 figure 定位（見 src/lib/figureLocator.ts），
 * 從老師上傳的原始檔截圖，上傳成題目圖片（Vercel Blob，沿用 /api/upload/quiz-image/[quizId]），
 * 把網址寫進題目的 imageUrl。
 *
 * 為何在瀏覽器端用 pdf.js 渲染、而不是伺服器端擷取內嵌圖片：
 * - 電路圖等示意圖在 PDF 裡常是向量繪圖指令，不是內嵌點陣圖，pdfImageExtract.ts（unpdf
 *   extractImages）抓不到；必須把頁面「畫出來」再裁切
 * - 伺服器端渲染頁面需要 node canvas（原生模組，Vercel 上不穩）；前端本來就載了
 *   pdfjs-dist（讀頁數 / 書籤）與原始檔，直接畫到 <canvas> 最省事，也不增加 serverless 負擔
 *
 * 失敗一律 fail-open：截圖或上傳失敗就不附圖，預覽區的 needsFigure() 會提醒老師手動補。
 */
import { computeCropRect, type FigureBBox, type FigureLocator } from '@/lib/figureLocator';

export type FigureSourceFiles =
  /** pageOffset：上傳給 AI 的 PDF 第 1 頁 = 原始檔第 (1 + pageOffset) 頁（前端裁切過大 PDF 時 > 0） */
  | { kind: 'pdf'; file: File; pageOffset: number }
  | { kind: 'images'; files: File[] };

export type FigureCapturable = {
  figure?: FigureLocator;
  imageUrl?: string;
};

// 頁面渲染倍率：2x 讓截圖在手機 / 投影上仍清楚
const RENDER_SCALE = 2;
// 畫布最長邊上限，避免 A3 / 海報尺寸的 PDF 畫出過大的 canvas（瀏覽器記憶體限制）
const MAX_CANVAS_SIDE = 3000;
// 輸出圖片最長邊上限（相片裁切後縮圖）
const MAX_OUTPUT_SIDE = 2000;
// /api/upload/quiz-image 上限 5MB，留點餘裕
const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas 轉圖片失敗'))), type, quality);
  });
}

/** 從來源 canvas / bitmap 裁出 bbox 區塊（含內距），必要時縮小，輸出 PNG（過大改 JPEG） */
async function cropToBlob(
  source: CanvasImageSource,
  width: number,
  height: number,
  bbox: FigureBBox | null,
  preferJpeg: boolean,
): Promise<Blob> {
  const rect = computeCropRect(bbox, width, height);
  const shrink = Math.min(1, MAX_OUTPUT_SIDE / Math.max(rect.width, rect.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(rect.width * shrink));
  out.height = Math.max(1, Math.round(rect.height * shrink));
  const ctx = out.getContext('2d');
  if (!ctx) {
    throw new Error('無法建立 canvas');
  }
  // 白底：PDF 頁面透明區、PNG 透明背景在深色模式下才不會變黑
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);

  if (!preferJpeg) {
    const png = await canvasToBlob(out, 'image/png');
    if (png.size <= MAX_UPLOAD_BYTES) {
      return png;
    }
  }
  return canvasToBlob(out, 'image/jpeg', 0.88);
}

async function uploadQuestionImage(quizId: string | number, blob: Blob): Promise<string> {
  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  const fd = new FormData();
  fd.append('file', new File([blob], `figure.${ext}`, { type: blob.type }));
  const res = await fetch(`/api/upload/quiz-image/${quizId}`, { method: 'POST', body: fd, credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.url !== 'string') {
    throw new Error(data.error || `上傳失敗（${res.status}）`);
  }
  return data.url;
}

type PageRenderer = (page: number) => Promise<{ canvas: HTMLCanvasElement }>;

async function createPdfRenderer(file: File): Promise<{ render: PageRenderer; destroy: () => void }> {
  // 用 minified 進入點：非壓縮 pdf.mjs 會被 Sentry wrapping loader 包壞（見 src/types/pdfjs-min.d.ts）
  const pdfjsLib = await import('pdfjs-dist/build/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  // 同一頁可能有好幾題的圖：每頁只渲染一次
  const cache = new Map<number, Promise<{ canvas: HTMLCanvasElement }>>();

  const render: PageRenderer = (pageNumber) => {
    const cached = cache.get(pageNumber);
    if (cached) {
      return cached;
    }
    const task = (async () => {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(RENDER_SCALE, MAX_CANVAS_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      return { canvas };
    })();
    cache.set(pageNumber, task);
    return task;
  };

  return { render, destroy: () => void pdf.destroy() };
}

/**
 * 逐題截圖並上傳；成功的題目寫入 imageUrl。不論成功與否都移除 figure 欄位（不送進 DB）。
 * 已經有 imageUrl 的題目不覆蓋。
 */
export async function captureFigures(
  questions: FigureCapturable[],
  source: FigureSourceFiles,
  quizId: string | number,
): Promise<{ attached: number; failed: number }> {
  const targets = questions.filter(q => q.figure && !q.imageUrl);
  let attached = 0;
  let failed = 0;
  if (targets.length === 0) {
    questions.forEach(q => delete q.figure);
    return { attached, failed };
  }

  let pdfRenderer: Awaited<ReturnType<typeof createPdfRenderer>> | null = null;
  try {
    if (source.kind === 'pdf') {
      pdfRenderer = await createPdfRenderer(source.file);
    }

    for (const q of targets) {
      const fig = q.figure!;
      try {
        let blob: Blob;
        if (source.kind === 'pdf') {
          const { canvas } = await pdfRenderer!.render(fig.page + source.pageOffset);
          blob = await cropToBlob(canvas, canvas.width, canvas.height, fig.bbox, false);
        } else {
          const file = source.files[fig.page - 1];
          if (!file) {
            throw new Error('找不到對應的圖片');
          }
          const bitmap = await createImageBitmap(file);
          try {
            // 照片 / 掃描檔裁切後用 JPEG，PNG 會大到超過上傳上限
            blob = await cropToBlob(bitmap, bitmap.width, bitmap.height, fig.bbox, true);
          } finally {
            bitmap.close();
          }
        }
        q.imageUrl = await uploadQuestionImage(quizId, blob);
        attached++;
      } catch (err) {
        console.warn('[figureCapture] 題目附圖擷取失敗', err);
        failed++;
      }
    }
  } catch (err) {
    // PDF 本身打不開（加密 / 損毀）：全部視為失敗，交給老師手動補圖
    console.warn('[figureCapture] 無法開啟原始檔截圖', err);
    failed = targets.length - attached;
  } finally {
    pdfRenderer?.destroy();
    questions.forEach(q => delete q.figure);
  }
  return { attached, failed };
}
