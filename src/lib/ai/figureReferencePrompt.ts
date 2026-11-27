/**
 * 「題目不可依賴看不到的圖表」出題規則。
 *
 * 背景：曾出現 AI 從 PDF 出題「如右圖所示之電路，其中電流表 A 為理想的直流電流表，
 * 若讀值為 0.5A，則 R 值應為 ___ Ω。」——原始文件的電路圖沒有被擷取存成題目圖片，
 * 學生端完全看不到圖，無法作答。
 *
 * 用法比照 buildCodeSnippetRule() / buildSingleAnswerRule()：直接串在各出題 prompt 尾端。
 * 老師端另有 src/lib/figureReference.ts 的 needsFigure() 做事後偵測警告。
 */

/**
 * @param field 題目文字所在的 JSON 欄位名稱（大多是 question；bloom-studio 是 content；aiActions 是 body）
 */
export function buildNoFigureReferenceRule(field = 'question'): string {
  return `

【圖表依賴規則】學生作答時只看得到 ${field} 欄位的文字，看不到原始文件裡的任何圖片、電路圖、圖表或表格。
- ${field} 欄位不可出現「如圖」「如右圖」「如左圖」「如上圖」「如下圖」「下圖」「上圖」「附圖」「圖一」「圖 2」「如下表」「附表」等參照圖表的字樣
- 若原始內容是看圖題（例如電路圖、幾何圖形、實驗裝置、統計圖表），必須把作答需要的所有資訊用文字完整寫進題目（例：「12 V 直流電源與電阻 R 串聯，再接一個 8 Ω 電阻與 R 並聯，理想電流表 A 串接在 R 支路上……」），讓學生不看圖也能作答
- 若圖中資訊無法用文字完整、清楚地描述，就不要出這題，改出其他不需要圖的題目
- 本規則不影響 diagram 欄位：diagram 只是輔助理解的圖解，題目本身仍必須只靠文字就能作答`;
}

export type FigureSource = 'pdf' | 'image' | 'text';

/**
 * 檔案出題（PDF / 圖片）專用版本：不要求把圖改寫成文字，改要求 AI 標出圖在原始檔的位置
 * （figure 欄位），前端用 pdf.js / canvas 裁切成題目圖片（見 src/lib/figureLocator.ts）。
 *
 * 背景：PR #119 的文字改寫版本讓電路題變成一大段電路描述，老師反映學生很難讀；
 * 附上原圖後題幹寫「如圖所示之電路……」即可。
 *
 * @param field 題目文字所在的 JSON 欄位名稱
 * @param source 'pdf'：page = PDF 第幾頁；'image'：page = 第幾張圖片
 */
export function buildFigureLocatorRule(field = 'question', source: 'pdf' | 'image' = 'pdf'): string {
  const pageMeaning = source === 'image'
    ? 'page 是第幾張圖片（依上傳順序，從 1 起算）'
    : 'page 是 PDF 第幾頁（以你收到的這份 PDF 第 1 頁為 1）';
  return `

【圖表依賴規則】原始文件裡的圖（電路圖、幾何圖形、實驗裝置、統計圖表、表格等）會由系統依你標示的位置自動截圖，附在題目上給學生看。
- 若某題必須看圖才能作答，${field} 欄位請保持精簡，可以寫「如圖所示之電路……」「根據附圖……」，不要把整張圖改寫成一大段文字描述
- 這種題目必須在該題 JSON 加 "figure" 欄位標示圖的位置：{"page": 1, "bbox": {"left": 0.1, "top": 0.4, "right": 0.6, "bottom": 0.7}}
  - ${pageMeaning}
  - bbox 是圖在該頁的範圍，四個值都是相對整頁寬高的比例（0 到 1，左上角為 0,0），範圍要涵蓋整張圖連同圖上的標示（電阻值、電流表、圖說），寧可稍大不要切到圖
- 一題只標一張圖；不需要看圖的題目不要加 figure 欄位
- 若找不到或無法確定圖在哪一頁、哪個位置，就不要出這題，改出其他不需要圖的題目
- figure 欄位與 diagram 欄位無關：diagram 是 AI 自繪的輔助圖解，figure 是原始文件的圖`;
}

/**
 * 依素材來源選擇圖表依賴規則：PDF / 圖片可以截圖 → 定位版本；純文字來源沒有圖可截 → PR #119 的文字改寫版本。
 */
export function buildFigureRuleForSource(source: FigureSource, field = 'question'): string {
  return source === 'text'
    ? buildNoFigureReferenceRule(field)
    : buildFigureLocatorRule(field, source);
}
