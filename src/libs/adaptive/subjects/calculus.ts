/**
 * 學科設定：微積分（第一個非程式學科）
 * 知識圖譜：極限 → 導數 → 積分（線性前置鏈）
 * 導師風格重點：範例改為「逐步算式推導」，並嚴格要求純文字數學式
 * （前端 Markdown 渲染不支援 LaTeX，$\frac{}{}$ 之類會原樣顯示成亂碼）。
 * 每題為單選題：options 為選項（同樣用 Unicode 數學符號）、answerIndex 為正解索引。
 */

import type { KnowledgeGraph, ItemBank } from "../engine";
import type { Subject } from "./index";

/** 知識圖譜：極限 → 導數 → 積分（線性前置鏈） */
const graph: KnowledgeGraph = {
  nodes: [
    { id: "cal-limit", name: "極限", prerequisites: [] },
    { id: "cal-deriv", name: "導數", prerequisites: ["cal-limit"] },
    { id: "cal-int", name: "積分", prerequisites: ["cal-deriv"] },
  ],
};

const itemBank: ItemBank = {
  items: [
    // --- 極限 ---
    {
      id: "CL1", knowledgeId: "cal-limit", difficulty: 0.2,
      prompt: "lim(x→2) x² 的值是？",
      options: ["2", "4", "0", "不存在"],
      answerIndex: 1,
      explanation: "x² 在 x = 2 處連續，極限就是函數值 2² = 4。",
    },
    {
      id: "CL2", knowledgeId: "cal-limit", difficulty: 0.5,
      prompt: "lim(x→0) sin(x)/x 的值是？",
      options: ["0", "∞", "1", "不存在"],
      answerIndex: 2,
      explanation: "x 趨近 0 時 sin(x) ≈ x，比值趨近 1；可由夾擠定理嚴格證明。",
    },
    {
      id: "CL3", knowledgeId: "cal-limit", difficulty: 0.8,
      prompt: "lim(x→∞) (1 + 1/x)^x 的值是？",
      options: ["1", "∞", "0", "e ≈ 2.718"],
      answerIndex: 3,
      explanation: "這是 1^∞ 未定型，不能直接代入；此極限正是自然常數 e 的定義。",
    },
    // --- 導數 ---
    {
      id: "CD1", knowledgeId: "cal-deriv", difficulty: 0.2,
      prompt: "f(x) = x²，則 f′(x) = ?",
      options: ["2x", "x", "2", "x²/2"],
      answerIndex: 0,
      explanation: "冪次法則：(xⁿ)′ = n·xⁿ⁻¹，所以 (x²)′ = 2x。",
    },
    {
      id: "CD2", knowledgeId: "cal-deriv", difficulty: 0.4,
      prompt: "f′(a) 的幾何意義是？",
      options: [
        "曲線在 x = a 處的高度",
        "曲線在 x = a 處切線的斜率",
        "曲線在 0 到 a 之間圍出的面積",
        "曲線在 x = a 處的曲率",
      ],
      answerIndex: 1,
      explanation: "導數是割線斜率的極限——割線兩點無限靠近，就成了切線的斜率。",
    },
    {
      id: "CD3", knowledgeId: "cal-deriv", difficulty: 0.6,
      prompt: "(x·sin x)′ = ?",
      options: [
        "cos x",
        "x·cos x",
        "sin x − x·cos x",
        "sin x + x·cos x",
      ],
      answerIndex: 3,
      explanation: "乘積法則 (uv)′ = u′v + uv′：(x)′·sin x + x·(sin x)′ = sin x + x·cos x。",
    },
    {
      id: "CD4", knowledgeId: "cal-deriv", difficulty: 0.8,
      prompt: "d/dx sin(x²) = ?",
      options: ["2x·cos(x²)", "cos(x²)", "2x·sin(x)", "cos(2x)"],
      answerIndex: 0,
      explanation: "鏈鎖法則：外層 sin 的導數是 cos(x²)，再乘上內層 x² 的導數 2x。",
    },
    // --- 積分 ---
    {
      id: "CI1", knowledgeId: "cal-int", difficulty: 0.3,
      prompt: "∫ x² dx = ?",
      options: ["x³ + C", "2x + C", "x³/3 + C", "x²/2 + C"],
      answerIndex: 2,
      explanation: "反冪次法則：∫ xⁿ dx = xⁿ⁺¹/(n+1) + C；驗算 (x³/3)′ = x²。",
    },
    {
      id: "CI2", knowledgeId: "cal-int", difficulty: 0.5,
      prompt: "∫₀¹ x dx 的值與幾何意義是？",
      options: [
        "1，正方形面積",
        "1/3，拋物線下面積",
        "2，梯形面積",
        "1/2，底 1 高 1 的三角形面積",
      ],
      answerIndex: 3,
      explanation: "y = x 在 0 到 1 之間與 x 軸圍成三角形，面積 = 1×1÷2 = 1/2。",
    },
    {
      id: "CI3", knowledgeId: "cal-int", difficulty: 0.8,
      prompt: "微積分基本定理的內容是？",
      options: [
        "微分與積分互為逆運算：∫ₐᵇ f(x) dx = F(b) − F(a)，其中 F′ = f",
        "所有連續函數都有導數",
        "極限存在則函數必連續",
        "任何函數的積分都能寫成初等函數",
      ],
      answerIndex: 0,
      explanation: "它把「求面積」化為「找反導函數再相減」，把微分與積分兩個世界接了起來。",
    },
  ],
};

export const calculusSubject: Subject = {
  id: "calculus",
  name: "微積分",
  graph,
  itemBank,
  tutor: {
    lessonExampleRule:
      "必須含至少一段完整的算式逐步推導——每一步單獨成行，並用一句話說明該步的理由",
    formatRule:
      "數學式一律用純文字與 Unicode 符號表示（例如 f′(x) = 2x、∫₀¹ x dx、x²、√x、lim(x→0)、π），" +
      "絕對不要使用 LaTeX 語法（\\frac、\\int、$…$ 等），因為閱讀介面不支援 LaTeX 渲染；" +
      "多步推導可放在程式碼區塊（```）中逐行對齊呈現",
  },
};
