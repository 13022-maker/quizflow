// TODO(子代理)：挑錯標註 題型——目前是佔位 stub，validateSet 一律擋下，老師無法建立此題型
import type { ReviewModeHandler } from './types';

export const errorSpotHandler: ReviewModeHandler = {
  mode: 'error_spot',
  label: '挑錯標註',
  description: '尚未開放',
  refSchema: null,
  responseSchema: null,
  validateSet: () => '此題型尚未開放',
  toClientData: () => null,
  calcSampleAccuracy: () => 0,
  summarize: () => ({ team: '-', ref: '-' }),
  aiInstruction: '',
};
