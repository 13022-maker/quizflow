// 科目學群分組：科目數量持續增加，用學群把相近科目歸在一起，方便篩選列 / 下拉選單好找
// 新增科目時只改這裡，MARKETPLACE_CATEGORIES 會自動同步（別再手動維護兩份清單）
export const MARKETPLACE_CATEGORY_GROUPS = [
  { label: '語文類', categories: ['國文', '英語', '華語檢測'] },
  { label: '數理科技', categories: ['數學', '自然', '科技'] },
  { label: '人文社會', categories: ['社會', '綜合'] },
  { label: '藝術體育', categories: ['藝術', '健體'] },
  { label: '其他', categories: ['其他'] },
] as const;

export const MARKETPLACE_CATEGORIES = MARKETPLACE_CATEGORY_GROUPS.flatMap(g => g.categories);

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
  '不分級',
] as const;

// 書商認證狀態（Phase 2）：新申請預設 pending，管理員（VIP_EMAILS）到後台審核
export const PUBLISHER_VERIFICATION_STATUSES = [
  'pending', // 申請中，尚未審核
  'verified', // 已認證，可在 marketplace / 學生頁顯示徽章
  'rejected', // 已拒絕（附原因）
] as const;

export type PublisherVerificationStatus = typeof PUBLISHER_VERIFICATION_STATUSES[number];
