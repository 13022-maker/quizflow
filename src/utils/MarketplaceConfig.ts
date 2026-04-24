export const MARKETPLACE_CATEGORIES = [
  '國文',
  '英語',
  '數學',
  '自然',
  '社會',
  '藝術',
  '健體',
  '科技',
  '綜合',
  '其他',
] as const;

export const GRADE_LEVELS = [
  '國小一年級',
  '國小二年級',
  '國小三年級',
  '國小四年級',
  '國小五年級',
  '國小六年級',
  '國中一年級',
  '國中二年級',
  '國中三年級',
  '高中一年級',
  '高中二年級',
  '高中三年級',
  '大學',
  '社會人士',
] as const;

// 書商認證狀態（Phase 2）：新申請預設 pending，管理員（VIP_EMAILS）到後台審核
export const PUBLISHER_VERIFICATION_STATUSES = [
  'pending', // 申請中，尚未審核
  'verified', // 已認證，可在 marketplace / 學生頁顯示徽章
  'rejected', // 已拒絕（附原因）
] as const;

export type PublisherVerificationStatus = typeof PUBLISHER_VERIFICATION_STATUSES[number];
