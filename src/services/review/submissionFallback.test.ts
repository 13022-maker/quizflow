import { describe, expect, it } from 'vitest';

import { resolveFallbackContent } from './submissionFallback';

describe('resolveFallbackContent', () => {
  it('已有最終答案內容時優先使用', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: '隊長整理好的最終答案',
      leaderDraftContent: '隊長的草稿',
      teammateDraftContents: ['組員草稿'],
    })).toBe('隊長整理好的最終答案');
  });

  it('最終答案是空字串時，不再直接送出空白，改退用隊長草稿', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: '',
      leaderDraftContent: '隊長的草稿',
      teammateDraftContents: [],
    })).toBe('隊長的草稿');
  });

  it('最終答案只有空白與零寬字元，視同空白', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: '  \n\u200B ',
      leaderDraftContent: '隊長的草稿',
      teammateDraftContents: [],
    })).toBe('隊長的草稿');
  });

  it('沒有最終答案（整筆不存在）時退用隊長自己的草稿', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: null,
      leaderDraftContent: '隊長的草稿',
      teammateDraftContents: ['組員草稿'],
    })).toBe('隊長的草稿');
  });

  it('最終答案與隊長草稿都空白時，改用字數最多的組員草稿（#17 第 1 組情境）', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: '',
      leaderDraftContent: '',
      teammateDraftContents: ['短', '   ', '這份比較長的草稿'],
    })).toBe('這份比較長的草稿');
  });

  it('所有來源都空白或不存在時，落成空字串', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: null,
      leaderDraftContent: null,
      teammateDraftContents: [' ', ''],
    })).toBe('');
  });
});
