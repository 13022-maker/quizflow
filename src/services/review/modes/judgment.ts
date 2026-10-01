// TODO(子代理)：對錯判斷 + 錯因 題型——目前是佔位 stub，validateSet 一律擋下，老師無法建立此題型
import type { ReviewModeHandler } from './types';

export const judgmentHandler: ReviewModeHandler = {
  mode: 'judgment',
  label: '對錯判斷 + 錯因',
  description: '尚未開放',
  refSchema: null,
  responseSchema: null,
  validateSet: () => '此題型尚未開放',
  toClientData: () => null,
  calcSampleAccuracy: () => 0,
  summarize: () => ({ team: '-', ref: '-' }),
  aiInstruction: '',
};
