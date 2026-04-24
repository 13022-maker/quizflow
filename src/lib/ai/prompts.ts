/**
 * 集中管理 AI 提示詞（CLAUDE.md 規定：所有 prompt 統一放在此處）
 *
 * 目前涵蓋：
 * - gradeSpeechPrompt：口說題評分（發音 / 流暢度 / 內容三維度）
 *
 * 後續可逐步把 generate-questions / analyze-weak-points 等 route 內 inline prompt 搬進來
 */

export type SpeechGradingInput = {
  /** 老師設定的題目（口說 prompt） */
  prompt: string;
  /** 學生實際說出的內容（Whisper 轉出的逐字稿） */
  transcript: string;
  /** 預期答案 / 範例答案（選填，老師可給出標準回答供 AI 比對） */
  referenceText?: string;
  /** 評量語言（影響評分標準與回饋語言） */
  language: 'zh-TW' | 'en' | 'ja' | 'ko' | 'zh-CN';
  /** 學生說話總秒數（用於流暢度評分，避免「太短」也拿高分） */
  durationSeconds: number;
};

const LANGUAGE_LABELS: Record<SpeechGradingInput['language'], string> = {
  'zh-TW': '繁體中文',
  'zh-CN': '簡體中文',
  'en': '英文',
  'ja': '日文',
  'ko': '韓文',
};

/**
 * 口說評分提示詞：要求 Claude 從三個維度評分（0–100），並產出簡短回饋
 * 嚴格要求 JSON 輸出，避免 client 端二次解析麻煩
 */
export function gradeSpeechPrompt(input: SpeechGradingInput): string {
  const { prompt, transcript, referenceText, language, durationSeconds } = input;
  const langLabel = LANGUAGE_LABELS[language] ?? '英文';

  return `你是專業的語言口說評量助教，正在批改一位學生的${langLabel}口說作答。

【題目】
${prompt}

${referenceText ? `【標準回答 / 參考答案】\n${referenceText}\n\n` : ''}【學生實際說的內容（逐字稿）】
${transcript || '（學生未說出任何可辨識內容）'}

【作答時長】
${durationSeconds.toFixed(1)} 秒

請依以下三個維度評分，每項 0–100 分（60 為及格、80 為良好、90 以上為優秀）：

1. **pronunciationScore（發音）**：根據逐字稿與題目語言的標準發音邏輯推測；逐字稿與預期文本越接近、辨識率越高，分數越高
2. **fluencyScore（流暢度）**：考量說話速度（每秒字數）、停頓次數（從逐字稿語句結構推估）、是否有反覆改口；過短（< 5 秒）扣分
3. **contentScore（內容切題度）**：學生回答是否切合題目要求；若有 referenceText，也評估與標準答案的概念相符度

並計算 overallScore = round(pronunciation * 0.3 + fluency * 0.3 + content * 0.4)。

最後給一段繁體中文的簡短 feedback（≤ 80 字），鼓勵 + 1～2 條具體改善建議。

請只回傳合法 JSON，禁止輸出任何額外文字 / markdown：
{
  "pronunciationScore": 0,
  "fluencyScore": 0,
  "contentScore": 0,
  "overallScore": 0,
  "feedback": "..."
}`;
}

/**
 * Whisper 語言代碼映射（OpenAI Whisper API 用的 ISO-639-1）
 */
export function whisperLanguageCode(language: SpeechGradingInput['language']): string {
  const map: Record<SpeechGradingInput['language'], string> = {
    'zh-TW': 'zh',
    'zh-CN': 'zh',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
  };
  return map[language] ?? 'en';
}
