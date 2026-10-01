// 協作批閱「共創產出型態」：free_text（原始做法，自由文字）／question（小組出一道題目）
// 純函式模組，server（送出驗證）與 client（編輯頁下拉選單）共用。
import type { ReviewCreateMode } from './modes/types';

export type CreateModeInfo = {
  mode: ReviewCreateMode;
  label: string;
  description: string;
};

const CREATE_MODES: CreateModeInfo[] = [
  { mode: 'free_text', label: '自由文字創作', description: '小組共同寫出一份延伸創作答案' },
  // TODO(子代理)：question 共創型態——目前是佔位，validateCreateModeSet 一律擋下
  { mode: 'question', label: '小組出一道題目（尚未開放）', description: '尚未開放' },
];

export function listCreateModes(): CreateModeInfo[] {
  return CREATE_MODES;
}

/** 建立/編輯題組時檢查此共創型態可否使用；可用回 null，否則回傳繁中錯誤訊息 */
export function validateCreateModeSet(mode: ReviewCreateMode): string | null {
  return mode === 'free_text' ? null : '此共創型態尚未開放';
}

/**
 * 隊長正式送出（或系統代送）前驗證內容格式。free_text 不限制（空字串由既有流程處理）；
 * 回傳 null 代表通過，否則回傳繁中錯誤訊息。
 */
export function validateCreateContent(mode: ReviewCreateMode, _content: string): string | null {
  return mode === 'free_text' ? null : '此共創型態尚未開放';
}
