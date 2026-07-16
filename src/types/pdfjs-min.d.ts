// pdfjs-dist 的 minified 進入點沒有附型別宣告，轉用主套件的型別。
// 為何用 min 版：本專案 webpack pipeline（Sentry wrapping loader）會把
// 非壓縮的 pdf.mjs 包壞（Object.defineProperty called on non-object），
// .min. 檔案會被 loader 跳過，故 client 端一律改載 build/pdf.min.mjs。
declare module 'pdfjs-dist/build/pdf.min.mjs' {
  export * from 'pdfjs-dist';
}
