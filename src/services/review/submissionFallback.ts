// 老師把階段從 creating 推進到 voting 時，若隊長還沒按下「確認送出」，
// 用這個函式決定要自動補送出什麼內容：優先用隊長目前最終答案文字框裡的
// 內容（即使是空字串也算數，代表隊長連基底都還沒選但至少開過那個欄位）；
// 如果那份最終答案整筆都不存在，才退而使用隊長自己的獨立草稿；兩者都沒有
// 就送出空字串。

export function resolveFallbackContent(params: {
  existingSubmissionContent: string | null;
  leaderDraftContent: string | null;
}): string {
  if (params.existingSubmissionContent !== null) {
    return params.existingSubmissionContent;
  }
  if (params.leaderDraftContent !== null) {
    return params.leaderDraftContent;
  }
  return '';
}
