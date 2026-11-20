import { describe, expect, it } from 'vitest';

import { computeSimScore, decodeSimCode, decodeSimCodeDetailed, parseSimResult, sanitizeSimSpec, summarizeClass } from './result';
import { HDFIX3_ITEMS, type SimItems } from './types';

// 15 題全部未通過的基底，測試用 literal 覆寫個別題
const EMPTY_ITEM = { passed: false, attempts: 0, firstPassSec: null };
function itemsWith(passedIds: number[]): SimItems {
  const items: SimItems = {};
  for (let i = 1; i <= 15; i++) {
    items[String(i)] = passedIds.includes(i)
      ? { passed: true, attempts: 1, firstPassSec: 60 }
      : { ...EMPTY_ITEM };
  }
  return items;
}

const VALID = {
  v: 1,
  exam: 'hdfix3',
  name: '王小明',
  sid: 's001',
  seat: '07',
  startedAt: '2026-11-20T01:00:00.000Z',
  submittedAt: '2026-11-20T01:30:00.000Z',
  durationSec: 1800,
  score: 99, // client 亂報的分數，server 要重算
  items: {
    1: { passed: true, attempts: 2, firstPassSec: 120 },
    2: { passed: true, attempts: 1, firstPassSec: 300 },
  },
};

// node 預先算好的 base64（UTF-8）：VALID 的 JSON（items key 為 "1"、"2"）
const CODE_B64 = 'eyJ2IjoxLCJleGFtIjoiaGRmaXgzIiwibmFtZSI6IueOi+Wwj+aYjiIsInNpZCI6InMwMDEiLCJzZWF0IjoiMDciLCJzdGFydGVkQXQiOiIyMDI2LTExLTIwVDAxOjAwOjAwLjAwMFoiLCJzdWJtaXR0ZWRBdCI6IjIwMjYtMTEtMjBUMDE6MzA6MDAuMDAwWiIsImR1cmF0aW9uU2VjIjoxODAwLCJzY29yZSI6OTksIml0ZW1zIjp7IjEiOnsicGFzc2VkIjp0cnVlLCJhdHRlbXB0cyI6MiwiZmlyc3RQYXNzU2VjIjoxMjB9LCIyIjp7InBhc3NlZCI6dHJ1ZSwiYXR0ZW1wdHMiOjEsImZpcnN0UGFzc1NlYyI6MzAwfX19';
const CODE_B64URL = 'eyJ2IjoxLCJleGFtIjoiaGRmaXgzIiwibmFtZSI6IueOi-Wwj-aYjiIsInNpZCI6InMwMDEiLCJzZWF0IjoiMDciLCJzdGFydGVkQXQiOiIyMDI2LTExLTIwVDAxOjAwOjAwLjAwMFoiLCJzdWJtaXR0ZWRBdCI6IjIwMjYtMTEtMjBUMDE6MzA6MDAuMDAwWiIsImR1cmF0aW9uU2VjIjoxODAwLCJzY29yZSI6OTksIml0ZW1zIjp7IjEiOnsicGFzc2VkIjp0cnVlLCJhdHRlbXB0cyI6MiwiZmlyc3RQYXNzU2VjIjoxMjB9LCIyIjp7InBhc3NlZCI6dHJ1ZSwiYXR0ZW1wdHMiOjEsImZpcnN0UGFzc1NlYyI6MzAwfX19';
// name "A"、sid "s2"、seat "12"、items {}，結尾有一個 '='
const CODE_PADDED = 'eyJ2IjoxLCJleGFtIjoiaGRmaXgzIiwibmFtZSI6IkEiLCJzaWQiOiJzMiIsInNlYXQiOiIxMiIsInN0YXJ0ZWRBdCI6IjIwMjYtMTEtMjBUMDI6MDA6MDAuMDAwWiIsInN1Ym1pdHRlZEF0IjoiMjAyNi0xMS0yMFQwMjoxMDowMC4wMDBaIiwiZHVyYXRpb25TZWMiOjYwMCwic2NvcmUiOjAsIml0ZW1zIjp7fX0=';

describe('HDFIX3_ITEMS', () => {
  it('共 15 題，id 1~15，第 2 題是 Linux 虛擬機記憶體、第 3 題雙系統', () => {
    expect(HDFIX3_ITEMS).toHaveLength(15);
    expect(HDFIX3_ITEMS.map(i => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(HDFIX3_ITEMS[1]).toEqual({ id: 2, title: '虛擬機記憶體', os: 'lx' });
    expect(HDFIX3_ITEMS[2]).toEqual({ id: 3, title: '電腦名稱', os: 'both' });
    expect(HDFIX3_ITEMS[14]).toEqual({ id: 15, title: '網頁字體顏色', os: 'win' });
  });
});

describe('computeSimScore', () => {
  it('0 題通過 = 0 分', () => {
    expect(computeSimScore(itemsWith([]))).toBe(0);
  });

  it('全部通過 = 100 分', () => {
    expect(computeSimScore(itemsWith([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]))).toBe(100);
  });

  it('2 題通過 = round(13.33) = 13；8 題 = round(53.33) = 53；9 題 = 60', () => {
    expect(computeSimScore(itemsWith([1, 2]))).toBe(13);
    expect(computeSimScore(itemsWith([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(53);
    expect(computeSimScore(itemsWith([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(60);
  });

  it('1 題通過 = round(6.67) = 7', () => {
    expect(computeSimScore(itemsWith([15]))).toBe(7);
  });

  it('非 1~15 的 key 不計分', () => {
    expect(computeSimScore({ 16: { passed: true, attempts: 1, firstPassSec: 1 } })).toBe(0);
  });
});

describe('parseSimResult', () => {
  it('合法資料：分數由 server 重算（2 題 → 13，不採信 client 的 99），缺題補成未通過', () => {
    const r = parseSimResult(VALID);

    expect(r.ok).toBe(true);

    if (!r.ok) {
      return;
    }

    expect(r.value.score).toBe(13);
    expect(r.value.name).toBe('王小明');
    expect(r.value.seat).toBe('07');
    expect(r.value.durationSec).toBe(1800);
    expect(Object.keys(r.value.items)).toHaveLength(15);
    expect(r.value.items['1']).toEqual({ passed: true, attempts: 2, firstPassSec: 120 });
    expect(r.value.items['15']).toEqual({ passed: false, attempts: 0, firstPassSec: null });
  });

  it('姓名、學號前後空白會被去掉', () => {
    const r = parseSimResult({ ...VALID, name: '  王小明 ', sid: ' s001 ' });

    expect(r.ok && r.value.name).toBe('王小明');
    expect(r.ok && r.value.sid).toBe('s001');
  });

  it('姓名超過 30 字 → 失敗', () => {
    expect(parseSimResult({ ...VALID, name: 'a'.repeat(31) }).ok).toBe(false);
  });

  it('學號空白 → 失敗', () => {
    expect(parseSimResult({ ...VALID, sid: '   ' }).ok).toBe(false);
  });

  it('崗位不是兩位數字 → 失敗', () => {
    expect(parseSimResult({ ...VALID, seat: '7' }).ok).toBe(false);
    expect(parseSimResult({ ...VALID, seat: 'ab' }).ok).toBe(false);
    expect(parseSimResult({ ...VALID, seat: '123' }).ok).toBe(false);
  });

  it('exam 不是 hdfix3 → 失敗', () => {
    expect(parseSimResult({ ...VALID, exam: 'other' }).ok).toBe(false);
  });

  it('v 不是 1 → 失敗', () => {
    expect(parseSimResult({ ...VALID, v: 2 }).ok).toBe(false);
  });

  it('submittedAt 不是合法時間 → 失敗', () => {
    expect(parseSimResult({ ...VALID, submittedAt: 'yesterday' }).ok).toBe(false);
  });

  it('非物件 → 失敗並帶錯誤訊息', () => {
    const r = parseSimResult('hello');

    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.length > 0).toBe(true);
  });

  it('未通過的題目 firstPassSec 一律清成 null', () => {
    const r = parseSimResult({ ...VALID, items: { 3: { passed: false, attempts: 4, firstPassSec: 50 } } });

    expect(r.ok && r.value.items['3']).toEqual({ passed: false, attempts: 4, firstPassSec: null });
  });

  it('負數 durationSec → 失敗', () => {
    expect(parseSimResult({ ...VALID, durationSec: -1 }).ok).toBe(false);
  });

  it('多餘的題號（16）被丟掉', () => {
    const r = parseSimResult({ ...VALID, items: { 16: { passed: true, attempts: 1, firstPassSec: 1 } } });

    expect(r.ok && r.value.items['16']).toBeUndefined();
    expect(r.ok && r.value.score).toBe(0);
  });
});

describe('decodeSimCode', () => {
  it('解析標準 base64 成績碼（含中文姓名 UTF-8），分數重算為 13', () => {
    const list = decodeSimCode(`HDFIX3:${CODE_B64}`);

    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('王小明');
    expect(list[0]!.score).toBe(13);
  });

  it('容忍 base64url（- _）', () => {
    const list = decodeSimCode(`HDFIX3:${CODE_B64URL}`);

    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('王小明');
  });

  it('容忍缺少結尾 =', () => {
    const list = decodeSimCode(`HDFIX3:${CODE_PADDED.replace(/=+$/, '')}`);

    expect(list).toHaveLength(1);
    expect(list[0]!.sid).toBe('s2');
    expect(list[0]!.seat).toBe('12');
  });

  it('從聊天紀錄中抓出多個成績碼，壞掉的略過', () => {
    const text = `老師這是我的成績 HDFIX3:${CODE_B64}\n另一位：HDFIX3: ${CODE_PADDED}\n壞的 HDFIX3:@@@\nHDFIX3:AAAA`;

    expect(decodeSimCode(text).map(r => r.sid)).toEqual(['s001', 's2']);
  });

  it('decodeSimCodeDetailed 回報壞掉的成績碼數量', () => {
    const { results, errors } = decodeSimCodeDetailed(`HDFIX3:${CODE_B64}\nHDFIX3:AAAA`);

    expect(results).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('接受原始 JSON（單筆物件）', () => {
    const list = decodeSimCode(JSON.stringify(VALID));

    expect(list).toHaveLength(1);
    expect(list[0]!.score).toBe(13);
  });

  it('接受原始 JSON 陣列', () => {
    const list = decodeSimCode(JSON.stringify([VALID, { ...VALID, sid: 's009' }]));

    expect(list.map(r => r.sid)).toEqual(['s001', 's009']);
  });

  it('什麼都沒有 → 空陣列', () => {
    expect(decodeSimCode('hello world')).toEqual([]);
  });
});

describe('summarizeClass', () => {
  it('空班級', () => {
    const s = summarizeClass([]);

    expect(s.count).toBe(0);
    expect(s.avgScore).toBeNull();
    expect(s.medianScore).toBeNull();
    expect(s.passRate).toBeNull();
    expect(s.avgDurationSec).toBeNull();
    expect(s.itemPassRates).toHaveLength(15);
    expect(s.itemPassRates[0]).toEqual({ id: 1, title: '硬碟磁區規劃', passedCount: 0, passRate: 0 });
    expect(s.weakest).toEqual([]);
  });

  it('4 人：分數 100/60/53/13、平均 56.5、中位數 56.5、及格率 50%、平均用時 750 秒', () => {
    const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const rows = [
      { score: 100, durationSec: 600, items: itemsWith(all) },
      { score: 60, durationSec: 900, items: itemsWith([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
      { score: 53, durationSec: 1200, items: itemsWith([1, 2, 3, 4, 5, 6, 7, 8]) },
      { score: 13, durationSec: 300, items: itemsWith([1, 2]) },
    ];
    const s = summarizeClass(rows);

    expect(s.count).toBe(4);
    expect(s.avgScore).toBe(56.5); // (100+60+53+13)/4 = 226/4
    expect(s.medianScore).toBe(56.5); // (60+53)/2
    expect(s.passRate).toBe(50); // 100、60 及格 → 2/4
    expect(s.avgDurationSec).toBe(750); // (600+900+1200+300)/4

    // 第 1、2 題 4/4 = 100；第 3~8 題 3/4 = 75；第 9 題 2/4 = 50；第 10~15 題 1/4 = 25
    expect(s.itemPassRates[0]).toEqual({ id: 1, title: '硬碟磁區規劃', passedCount: 4, passRate: 100 });
    expect(s.itemPassRates[2]!.passRate).toBe(75);
    expect(s.itemPassRates[8]!.passRate).toBe(50);
    expect(s.itemPassRates[9]!.passRate).toBe(25);

    // 最弱 3 題：通過率最低，同分依題號小的優先 → 10、11、12
    expect(s.weakest.map(w => w.id)).toEqual([10, 11, 12]);
  });

  it('奇數人數中位數取中間；平均分取到小數一位；通過率四捨五入到整數', () => {
    const rows = [
      { score: 7, durationSec: 100, items: itemsWith([15]) },
      { score: 13, durationSec: 200, items: itemsWith([1, 15]) },
      { score: 0, durationSec: 101, items: itemsWith([]) },
    ];
    const s = summarizeClass(rows);

    expect(s.medianScore).toBe(7);
    expect(s.avgScore).toBe(6.7); // 20/3 = 6.666…
    expect(s.passRate).toBe(0);
    expect(s.avgDurationSec).toBe(134); // 401/3 = 133.67
    expect(s.itemPassRates[14]!.passRate).toBe(67); // 2/3
    expect(s.itemPassRates[0]!.passRate).toBe(33); // 1/3
  });
});

describe('sanitizeSimSpec', () => {
  it('null / undefined → null（用預設）', () => {
    expect(sanitizeSimSpec(null)).toEqual({ ok: true, value: null });
    expect(sanitizeSimSpec(undefined)).toEqual({ ok: true, value: null });
  });

  it('只保留 DEF 欄位，丟掉未知 key 與空字串', () => {
    expect(sanitizeSimSpec({ sysGB: 90, color: 'blue', office: ['word', 'excel'], hacker: 'x', font: '' })).toEqual({
      ok: true,
      value: { sysGB: 90, color: 'blue', office: ['word', 'excel'] },
    });
  });

  it('全部都是未知 key → null', () => {
    expect(sanitizeSimSpec({ foo: 1 })).toEqual({ ok: true, value: null });
  });

  it('值是物件 → 失敗', () => {
    expect(sanitizeSimSpec({ sysGB: { a: 1 } }).ok).toBe(false);
  });

  it('陣列不是物件 → 失敗', () => {
    expect(sanitizeSimSpec(['sysGB']).ok).toBe(false);
  });
});
