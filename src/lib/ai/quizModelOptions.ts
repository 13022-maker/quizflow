/**
 * 出題（檔案 / 連結模式）可選的 AI 模型。
 *
 * 前端選擇器的顯示名稱與 generate-from-file / generate-from-url route 實際呼叫的 model id
 * 都從這裡取，避免 UI 寫「Claude Sonnet 4」實際卻打 claude-sonnet-4-6 這種不一致。
 * 純常數 + 純函數，client / server 都可 import。
 */
export type QuizModelChoice = 'gemini' | 'claude';

export const QUIZ_MODEL_OPTIONS = {
  gemini: { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  claude: { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
} as const satisfies Record<QuizModelChoice, { id: string; label: string }>;

/**
 * 實際送給 server 的模型選擇：非 Pro（Free）一律 gemini。
 * server 端 canUseClaude() 本來就會把 Free 改走 Gemini，這裡讓前端送出的值與實際行為一致。
 */
export function resolveQuizModelChoice(choice: QuizModelChoice, isPro: boolean): QuizModelChoice {
  return isPro ? choice : 'gemini';
}
