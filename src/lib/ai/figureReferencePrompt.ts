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
