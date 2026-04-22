// AI 出題 / 單字 / 補救教學等 prompt 的「輸出語言」綁定：
// 保留繁中 system prompt（Claude/Gemini 對繁中指令品質最穩），
// 末端追加一段語言指定句，讓回傳的題目、選項、解析使用使用者當前的 UI 語系。

export type AiOutputLocale = 'zh' | 'en' | 'ja' | 'ko';

const LOCALE_DISPLAY: Record<AiOutputLocale, string> = {
  zh: '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
};

export function normalizeAiLocale(input: unknown): AiOutputLocale {
  if (typeof input === 'string' && input in LOCALE_DISPLAY) {
    return input as AiOutputLocale;
  }
  return 'zh';
}

/**
 * 產生「請以指定語言輸出」的 prompt 附加段落。
 * 接在既有繁中 prompt 末端，不影響主題指令的邏輯。
 */
export function getOutputLanguageInstruction(locale: AiOutputLocale): string {
  return `
---
輸出語言要求（必須嚴格遵守）：
請以「${LOCALE_DISPLAY[locale]}」輸出所有題目、選項、答案、解析、題目標題。
- 即使原始素材是其他語言，也要將生成內容翻譯為指定語言。
- 保留數學／科學符號、公式、專有名詞、人名、品牌名稱原樣。
- zh → 繁體中文（台灣用語）
- en → natural American English
- ja → 日本語（丁寧語）
- ko → 한국어（표준어）
目前指定語言代碼：${locale}`;
}
