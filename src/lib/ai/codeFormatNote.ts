// 程式題格式規則：所有出題 prompt 共用（generate-questions / generate-from-file / generate-from-url /
// regenerate-question / generate-remedial / bloom-studio / 一鍵備課 prompt）。
//
// 踩過的坑：AI 出 C/C++ 程式題時常把整段程式碼塞進 question 字串、換行全部消失，
// 學生端看到的是「#include <stdio.h> int main() { ... }」擠成一行，根本無法閱讀。
// 這裡要求一律用 Markdown fenced code block（```c ... ```）並保留換行縮排，
// 前端由 src/components/quiz/RichText.tsx 解析成 <pre><code> 顯示。
//
// 注意：各 prompt 原本都有「只回傳合法 JSON，不要 markdown」的規則，指的是「整份回應」不能包 ```json，
// 跟「欄位字串值裡可以有 code fence」不衝突，所以規則內明確區分兩者，避免模型誤會而不敢用 fence。
// 本規則不論題目是否為程式題都會加進 prompt，非程式內容不受影響（模型只在有程式碼時才會用 fence）。
export const CODE_FORMAT_NOTE = `

程式碼格式規則（只要題目、選項或詳解內含程式碼就必須遵守；非程式題可忽略）：
- 多行程式碼一律放在 Markdown fenced code block 中，開頭 \`\`\` 後面標註語言，例如 \`\`\`c、\`\`\`cpp、\`\`\`python、\`\`\`java、\`\`\`javascript、\`\`\`html，結尾再用 \`\`\` 收尾；程式碼必須保留原本的換行與縮排（每個敘述一行、區塊內縮 4 個空白），絕對不可以把整段程式碼壓成一行
- 適用欄位：題幹（question / content）、選項（options 的每個字串）、詳解（explanation）都一樣
- 題幹範例（JSON 字串值）："下列程式的輸出為何？\\n\`\`\`c\\n#include <stdio.h>\\nint main() {\\n    int a = 3;\\n    printf(\\"%d\\", a * 2);\\n    return 0;\\n}\\n\`\`\`"
- 短的行內片段（變數名、單一運算式、函式名，例如 \`i++\`、\`printf()\`）用單反引號包起來即可，不需要 code block
- 因為輸出是 JSON，字串內的換行必須寫成 \\n、雙引號寫成 \\"，確保 JSON 合法
- 「只回傳合法 JSON、不要 markdown」指的是整份回應不要用 \`\`\`json 包起來；JSON 欄位的字串值裡照上面規則使用 code block 是允許且必要的`;
