import { countMeaningfulChars } from './scoring';

// 老師把階段從 creating 推進到 voting 時，若隊長還沒按下「確認送出」，
// 用這個函式決定要自動補送出什麼內容。依序取第一個「非空白」的來源：
//   1. 隊長目前最終答案文字框的內容
//   2. 隊長自己的獨立草稿
//   3. 字數最多的組員草稿
// 都沒有才送出空字串。
// 2026-10 調整：原本最終答案「即使是空字串也算數」，導致協作批閱 #17
// 有組員寫了上千字草稿，最終答案卻是空白，所以改成空白一律往下遞補。

function hasContent(content: string | null): content is string {
  return content !== null && countMeaningfulChars(content) > 0;
}

export function resolveFallbackContent(params: {
  existingSubmissionContent: string | null;
  leaderDraftContent: string | null;
  teammateDraftContents: string[];
}): string {
  if (hasContent(params.existingSubmissionContent)) {
    return params.existingSubmissionContent;
  }
  if (hasContent(params.leaderDraftContent)) {
    return params.leaderDraftContent;
  }
  const longestTeammateDraft = params.teammateDraftContents
    .filter(hasContent)
    .sort((a, b) => countMeaningfulChars(b) - countMeaningfulChars(a))[0];
  return longestTeammateDraft ?? '';
}
