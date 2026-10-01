// TODO(子代理)：排序比較 題型——目前是佔位 stub，validateSet 一律擋下，老師無法建立此題型
import type { ReviewModeHandler } from './types';

export const rankingHandler: ReviewModeHandler = {
  mode: 'ranking',
  label: '排序比較',
  description: '尚未開放',
  refSchema: null,
  responseSchema: null,
  validateSet: () => '此題型尚未開放',
  toClientData: () => null,
  calcSampleAccuracy: () => 0,
  summarize: () => ({ team: '-', ref: '-' }),
  aiInstruction: '',
};
