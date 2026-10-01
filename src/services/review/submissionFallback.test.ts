import { describe, expect, it } from 'vitest';

import { resolveFallbackContent } from './submissionFallback';

describe('resolveFallbackContent', () => {
  it('已有最終答案內容（即使是空字串）就直接用它，不退回草稿', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: '',
      leaderDraftContent: '隊長的草稿',
    })).toBe('');
  });

  it('已有最終答案內容時優先使用', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: '隊長整理好的最終答案',
      leaderDraftContent: '隊長的草稿',
    })).toBe('隊長整理好的最終答案');
  });

  it('沒有最終答案（整筆不存在）時退用隊長自己的草稿', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: null,
      leaderDraftContent: '隊長的草稿',
    })).toBe('隊長的草稿');
  });

  it('最終答案和隊長草稿都不存在時，落成空字串', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: null,
      leaderDraftContent: null,
    })).toBe('');
  });
});
