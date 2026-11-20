/**
 * 實作模擬（hdfix3 電腦硬體裝修丙級）共用型別。
 * client / server 都可 import（純型別與常數，不碰 DB）。
 */

export type SimMode = 'practice' | 'exam';

export type SimKind = 'hdfix3';

export type SimItemResult = {
  passed: boolean;
  attempts: number;
  firstPassSec: number | null; // 第一次通過時距開始的秒數；未通過為 null
};

/** key 為題號字串 "1"~"15" */
export type SimItems = Record<string, SimItemResult>;

/** hdfix3 成績 JSON（exam.html buildResult() 的格式，v:1） */
export type SimResultPayload = {
  v: 1;
  exam: 'hdfix3';
  name: string;
  sid: string;
  seat: string;
  startedAt: string;
  submittedAt: string;
  durationSec: number;
  score: number;
  items: SimItems;
};

/** hdfix3 的 15 題（題目名稱與 hdfix3 exam.html / dashboard.html 的 ITEMS 一致） */
export const HDFIX3_ITEMS: { id: number; title: string; os: 'win' | 'lx' | 'both' }[] = [
  { id: 1, title: '硬碟磁區規劃', os: 'win' },
  { id: 2, title: '虛擬機記憶體', os: 'lx' },
  { id: 3, title: '電腦名稱', os: 'both' },
  { id: 4, title: 'TCP/IP 設定', os: 'both' },
  { id: 5, title: '自動排程備份', os: 'win' },
  { id: 6, title: '新增使用者', os: 'lx' },
  { id: 7, title: '印表機', os: 'win' },
  { id: 8, title: '螢幕保護時間', os: 'lx' },
  { id: 9, title: '中文輸入法', os: 'win' },
  { id: 10, title: '中文字型', os: 'win' },
  { id: 11, title: 'Office 安裝', os: 'win' },
  { id: 12, title: 'FTP 改密碼', os: 'win' },
  { id: 13, title: '檔案傳輸', os: 'win' },
  { id: 14, title: '壓縮檔案', os: 'win' },
  { id: 15, title: '網頁字體顏色', os: 'win' },
];

export const HDFIX3_ITEM_COUNT = 15;

/** 及格分數（summarizeClass 的及格率用） */
export const SIM_PASS_SCORE = 60;

/** hdfix3 DEF（監評指定內容）的欄位名；老師的 spec 覆蓋值只接受這些 key（見 hdfix3 exam.html DEF） */
export const HDFIX3_SPEC_KEYS = [
  'sysGB',
  'dataGB',
  'vmRAM',
  'winName',
  'linName',
  'winIP',
  'linIP',
  'ipPrefix',
  'backupMin',
  'backupFile',
  'backupDest',
  'u1',
  'p1',
  'u2',
  'p2',
  'printerMfr',
  'printerModel',
  'saverMin',
  'ime',
  'font',
  'office',
  'ftpIP',
  'ftpPwd',
  'transfer',
  'zip',
  'color',
] as const;
