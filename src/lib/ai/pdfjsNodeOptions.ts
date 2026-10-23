/**
 * pdfjsNodeOptions.ts — 伺服器端呼叫 unpdf getDocumentProxy 時要帶的 pdfjs 資源路徑
 *
 * 踩過的坑：使用「不內嵌」CJK 字型的 PDF（例如 MSung-Light / MHei-Medium 搭配
 * UniCNS-UCS2-H 這類預先定義的 CMap，常見於學校、出版社匯出的題庫）要靠
 * pdfjs-dist/cmaps/*.bcmap 才能把字碼解回 Unicode，載不到 CMap 時整份文字擷取會變成
 * 空字串。unpdf 1.8 在 Node 預設把 cMapUrl 設成 `file:///.../cmaps/`，但它內建的
 * PDF.js 在 Node 上是用 fs.readFile(字串) 讀檔，`file://` URL 字串會被當成相對路徑 →
 * 「Unable to load CMap data」。所以這裡改傳「檔案系統絕對路徑」（結尾要有分隔符）。
 *
 * 路徑用 process.cwd() 推算而不用 require.resolve：route 會被 webpack 打包，
 * require.resolve 在 bundle 裡可能回傳 module id 而不是檔案路徑。Vercel 上 cwd 是
 * /var/task，traced 的 node_modules 也在那裡。
 *
 * 部署：cmaps / standard_fonts 不是 JS import，Vercel 的 output file tracing 不會自動
 * 帶上，next.config.mjs 的 outputFileTracingIncludes 有把它們加進用到這支的 route。
 */
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';

type PdfjsNodeOptions = {
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
};

let cached: PdfjsNodeOptions | null = null;

export function getPdfjsNodeOptions(): PdfjsNodeOptions {
  if (cached) {
    return cached;
  }
  const base = join(process.cwd(), 'node_modules', 'pdfjs-dist');
  const cMapDir = join(base, 'cmaps');
  const fontDir = join(base, 'standard_fonts');
  if (existsSync(cMapDir)) {
    cached = {
      cMapUrl: cMapDir + sep,
      cMapPacked: true,
      ...(existsSync(fontDir) ? { standardFontDataUrl: fontDir + sep } : {}),
    };
  } else {
    // 找不到 cmaps（部署時沒被 trace 進去）：退回 unpdf 預設值，內嵌字型的 PDF 仍可擷取
    console.warn('[pdfjsNodeOptions] 找不到 pdfjs-dist/cmaps，非內嵌 CJK 字型的 PDF 可能擷取不到文字', cMapDir);
    cached = {};
  }
  return cached;
}
