/**
 * hdfix3 監評指定內容表（表 A）預設值與欄位定義：對應 public/sims/hdfix3 的 DEF / FIELDS。
 * 老師在建立表單只填想改的欄位；送出時只帶與預設不同的值（spec 覆蓋值），其餘沿用預設。
 */

export const HDFIX3_DEFAULT_SPEC = {
  sysGB: 80,
  dataGB: 30,
  vmRAM: 2,
  winName: 'cXX',
  linName: 'vXX',
  winIP: 'static',
  linIP: 'dhcp',
  ipPrefix: '192.168.240.1',
  backupMin: 1,
  backupFile: 'hosts',
  backupDest: 'D:\\XX',
  u1: 'u01',
  p1: 'p123456',
  u2: 'u02',
  p2: 'go8868@TW',
  printerMfr: 'Generic',
  printerModel: 'MS Publisher Color Printer',
  saverMin: 3,
  ime: '微軟倉頡',
  font: '漢鼎繁勘亭',
  office: ['word'] as string[],
  ftpIP: '192.168.240.200',
  ftpPwd: 'go8868@TW',
  transfer: 'C:\\windows\\win.ini',
  zip: 'C:\\windows\\twain_32.dll',
  color: 'red',
};

export type Hdfix3SpecKey = keyof typeof HDFIX3_DEFAULT_SPEC;

export type SpecField =
  | { key: Hdfix3SpecKey; label: string; type: 'number' | 'text' }
  | { key: Hdfix3SpecKey; label: string; type: 'select'; options: { value: string; label: string }[] }
  | { key: 'office'; label: string; type: 'office' };

const IP_OPTIONS = [
  { value: 'static', label: '固定式' },
  { value: 'dhcp', label: '動態式' },
];

export const OFFICE_OPTIONS = [
  { value: 'word', label: '文書軟體（Word）' },
  { value: 'excel', label: '電子試算表（Excel）' },
  { value: 'ppt', label: '簡報軟體（PowerPoint）' },
];

/** 常用欄位：預設展開 */
export const PRIMARY_FIELDS: SpecField[] = [
  { key: 'vmRAM', label: '2. VM 記憶體 (GB)', type: 'number' },
  { key: 'winIP', label: '4. Windows IP', type: 'select', options: IP_OPTIONS },
  { key: 'linIP', label: '4. Linux IP', type: 'select', options: IP_OPTIONS },
  { key: 'backupMin', label: '5. 幾分鐘後啟動備份', type: 'number' },
  { key: 'saverMin', label: '8. 螢幕保護（分）', type: 'number' },
  {
    key: 'ime',
    label: '9. 中文輸入法',
    type: 'select',
    options: ['微軟注音', '微軟倉頡', '微軟速成'].map(v => ({ value: v, label: v })),
  },
  { key: 'font', label: '10. 中文字型', type: 'text' },
  { key: 'office', label: '11. Office 軟體', type: 'office' },
  {
    key: 'color',
    label: '15. 網頁字體顏色',
    type: 'select',
    options: [
      { value: 'red', label: '紅' },
      { value: 'green', label: '綠' },
      { value: 'blue', label: '藍' },
    ],
  },
];

/** 其餘欄位：收在「更多欄位」 */
export const OTHER_FIELDS: SpecField[] = [
  { key: 'sysGB', label: '1. 系統磁區 (GB)', type: 'number' },
  { key: 'dataGB', label: '1. 資料磁區 (GB)', type: 'number' },
  { key: 'winName', label: '3. Windows 電腦名稱', type: 'text' },
  { key: 'linName', label: '3. Linux 電腦名稱', type: 'text' },
  { key: 'ipPrefix', label: '4. 固定 IP 前綴（後接 XX）', type: 'text' },
  { key: 'backupFile', label: '5. 備份檔案（hosts 或完整路徑）', type: 'text' },
  { key: 'backupDest', label: '5. 備份目的資料夾', type: 'text' },
  { key: 'u1', label: '6. 使用者一帳號', type: 'text' },
  { key: 'p1', label: '6. 使用者一密碼', type: 'text' },
  { key: 'u2', label: '6. 使用者二帳號', type: 'text' },
  { key: 'p2', label: '6. 使用者二密碼', type: 'text' },
  { key: 'printerMfr', label: '7. 印表機製造商', type: 'text' },
  { key: 'printerModel', label: '7. 印表機型號', type: 'text' },
  { key: 'ftpIP', label: '12. FTP 主機 IP', type: 'text' },
  { key: 'ftpPwd', label: '12. 新 FTP 密碼', type: 'text' },
  { key: 'transfer', label: '13. 傳輸檔案（完整路徑）', type: 'text' },
  { key: 'zip', label: '14. 壓縮檔案（完整路徑）', type: 'text' },
];

export type SpecDraft = Record<Hdfix3SpecKey, string | number | string[]>;

/** 只留下與預設不同的欄位；全部沒改回傳 null（＝用表 A 預設） */
export function diffSpec(draft: SpecDraft): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(HDFIX3_DEFAULT_SPEC) as Hdfix3SpecKey[]) {
    const def = HDFIX3_DEFAULT_SPEC[key];
    const val = draft[key];
    if (Array.isArray(def)) {
      const a = [...(val as string[])].sort().join(',');
      const b = [...def].sort().join(',');
      if (a !== b) {
        out[key] = OFFICE_OPTIONS.map(o => o.value).filter(v => (val as string[]).includes(v));
      }
    } else if (typeof def === 'number') {
      const n = Number(val);
      if (Number.isFinite(n) && n !== def) {
        out[key] = n;
      }
    } else {
      const s = String(val).trim();
      if (s && s !== def) {
        out[key] = s;
      }
    }
  }
  return Object.keys(out).length ? out : null;
}
