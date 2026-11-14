import { describe, expect, it } from 'vitest';

import type { AvailableSubject } from './subjectPicker';
import {
  buildSubjectSections,
  CUSTOM_CATEGORY,
  DEFAULT_BUILT_IN_CATEGORY,
  defaultCollapsedCategories,
  describeSubject,
  flattenVisibleOptions,
  matchesQuery,
  normalizeForSearch,
  pickRecentSubjects,
  subjectCategory,
  suggestTitle,
} from './subjectPicker';

/** 測試用學科工廠：只填必要欄位，其餘給預設值 */
function make(partial: Partial<AvailableSubject> & { id: string; name: string }): AvailableSubject {
  return {
    group: 'built-in',
    pinned: false,
    itemCount: 0,
    knowledgePointCount: 0,
    knowledgePointNames: [],
    searchText: '',
    ...partial,
  };
}

const cpp = make({ id: 'cpp', name: 'C++ 程式設計', itemCount: 40, knowledgePointCount: 8, searchText: '變數 迴圈 陣列' });
const python = make({ id: 'python', name: 'Python 入門' });
const calculus = make({ id: 'calculus', name: '微積分' });
const dzbPointer = make({
  id: 'dzb-pointer',
  name: '數位乙級｜指標與陣列',
  category: '數位乙級 C語言',
  description: '指標運算、陣列走訪與字串處理',
  searchText: '指標宣告 指標運算 二維陣列',
});
const dzbBit = make({
  id: 'dzb-bit',
  name: '數位乙級｜位元運算',
  category: '數位乙級 C語言',
  searchText: 'AND OR XOR 位移',
});
const myQuad = make({ id: 'db:1', name: '二次函數', group: 'custom', searchText: '頂點 判別式' });
const myPinned = make({ id: 'db:2', name: '光合作用', group: 'custom', pinned: true });

describe('normalizeForSearch', () => {
  it('轉小寫、移除空白與全形／半形「｜」', () => {
    expect(normalizeForSearch('數位乙級｜ 指標 與陣列')).toBe('數位乙級指標與陣列');
    expect(normalizeForSearch('數位乙級 | C語言')).toBe('數位乙級c語言');
  });

  it('全形英數轉半形', () => {
    expect(normalizeForSearch('ＣＰＰ　Ａｂｃ')).toBe('cppabc');
  });
});

describe('subjectCategory', () => {
  it('自建學科一律歸「我的學科」', () => {
    expect(subjectCategory(myQuad)).toBe('我的學科');
  });

  it('內建學科有 category 用 category，否則用預設組名', () => {
    expect(subjectCategory(dzbPointer)).toBe('數位乙級 C語言');
    expect(subjectCategory(cpp)).toBe('程式設計與數學');
    expect(DEFAULT_BUILT_IN_CATEGORY).toBe('程式設計與數學');
    expect(CUSTOM_CATEGORY).toBe('我的學科');
  });
});

describe('matchesQuery', () => {
  it('空字串全部符合', () => {
    expect(matchesQuery(cpp, '  ')).toBe(true);
  });

  it('比對名稱，不分大小寫', () => {
    expect(matchesQuery(cpp, 'c++')).toBe(true);
    expect(matchesQuery(python, 'PYTHON')).toBe(true);
  });

  it('比對分類：「乙級」找得到數位乙級學科', () => {
    expect(matchesQuery(dzbBit, '乙級')).toBe(true);
    expect(matchesQuery(cpp, '乙級')).toBe(false);
  });

  it('比對 description 與知識點名稱', () => {
    expect(matchesQuery(dzbPointer, '字串處理')).toBe(true);
    expect(matchesQuery(dzbPointer, '指標')).toBe(true);
    expect(matchesQuery(cpp, '迴圈')).toBe(true);
    expect(matchesQuery(dzbBit, 'xor')).toBe(true);
  });

  it('忽略「｜」與空白差異', () => {
    expect(matchesQuery(dzbPointer, '數位乙級 | 指標')).toBe(true);
    expect(matchesQuery(dzbPointer, '乙級指標')).toBe(true);
  });

  it('自建學科可用「我的學科」找到', () => {
    expect(matchesQuery(myQuad, '我的')).toBe(true);
  });
});

describe('describeSubject', () => {
  it('有 description 直接用', () => {
    expect(describeSubject({ description: '  練習指標  ', sourceTopic: 'x', knowledgePointNames: ['a'], knowledgePointCount: 1 }))
      .toBe('練習指標');
  });

  it('無 description：主題＋前 3 個知識點', () => {
    expect(describeSubject({
      sourceTopic: '國二二次函數',
      knowledgePointNames: ['頂點', '對稱軸', '判別式', '圖形平移'],
      knowledgePointCount: 6,
    })).toBe('國二二次函數：涵蓋頂點、對稱軸、判別式等 6 個知識點');
  });

  it('無主題時只列知識點；不超過 3 個就不加「等」', () => {
    expect(describeSubject({ knowledgePointNames: ['變數', '迴圈'], knowledgePointCount: 2 }))
      .toBe('涵蓋變數、迴圈 2 個知識點');
  });

  it('只有主題', () => {
    expect(describeSubject({ sourceTopic: '光合作用', knowledgePointNames: [], knowledgePointCount: 0 })).toBe('光合作用');
  });

  it('什麼都沒有回空字串', () => {
    expect(describeSubject({ knowledgePointNames: [], knowledgePointCount: 0 })).toBe('');
  });
});

describe('pickRecentSubjects', () => {
  it('依最近使用時間新到舊取前 3 個，沒用過的排除', () => {
    const subjects = [
      { ...cpp, recentlyUsedAt: '2026-10-01T00:00:00.000Z' },
      python,
      { ...calculus, recentlyUsedAt: '2026-10-20T00:00:00.000Z' },
      { ...dzbBit, recentlyUsedAt: '2026-10-10T00:00:00.000Z' },
      { ...myQuad, recentlyUsedAt: '2026-09-01T00:00:00.000Z' },
    ];

    expect(pickRecentSubjects(subjects).map(s => s.id)).toEqual(['calculus', 'dzb-bit', 'cpp']);
    expect(pickRecentSubjects(subjects, 2).map(s => s.id)).toEqual(['calculus', 'dzb-bit']);
  });
});

describe('buildSubjectSections', () => {
  const all = [
    { ...cpp, recentlyUsedAt: '2026-10-01T00:00:00.000Z' },
    python,
    calculus,
    dzbPointer,
    dzbBit,
    myQuad,
    myPinned,
  ];

  it('依分類分組：內建分類依首次出現順序，「我的學科」放最後且釘選優先', () => {
    const { recent, groups } = buildSubjectSections(all, '');

    expect(recent.map(s => s.id)).toEqual(['cpp']);
    expect(groups.map(g => [g.category, g.subjects.map(s => s.id)])).toEqual([
      ['程式設計與數學', ['cpp', 'python', 'calculus']],
      ['數位乙級 C語言', ['dzb-pointer', 'dzb-bit']],
      ['我的學科', ['db:2', 'db:1']],
    ]);
  });

  it('搜尋時隱藏「最近使用」、只留有結果的組', () => {
    const { recent, groups } = buildSubjectSections(all, '指標');

    expect(recent).toEqual([]);
    expect(groups.map(g => [g.category, g.subjects.map(s => s.id)])).toEqual([
      ['數位乙級 C語言', ['dzb-pointer']],
    ]);
  });
});

describe('defaultCollapsedCategories', () => {
  it('學科總數 ≤ 12 全部展開', () => {
    const { groups } = buildSubjectSections([cpp, python, dzbBit, myQuad], '');

    expect([...defaultCollapsedCategories(groups, '')]).toEqual([]);
  });

  it('學科多時收合所有組，但保留目前選中學科所在的組', () => {
    const many = [
      cpp,
      python,
      calculus,
      ...Array.from({ length: 6 }, (_, i) => make({ id: `dzb-${i}`, name: `乙級 ${i}`, category: '數位乙級 C語言' })),
      ...Array.from({ length: 5 }, (_, i) => make({ id: `db:${i + 10}`, name: `自建 ${i}`, group: 'custom' })),
    ];
    const { groups } = buildSubjectSections(many, '');

    expect([...defaultCollapsedCategories(groups, '')].sort()).toEqual(['我的學科', '數位乙級 C語言', '程式設計與數學'].sort());
    expect([...defaultCollapsedCategories(groups, 'dzb-3')].sort()).toEqual(['我的學科', '程式設計與數學'].sort());
  });
});

describe('flattenVisibleOptions', () => {
  const sections = buildSubjectSections(
    [cpp, python, { ...dzbBit, recentlyUsedAt: '2026-10-01T00:00:00.000Z' }, myQuad],
    '',
  );

  it('依畫面順序攤平（最近使用→各組），跳過收合的組，key 唯一', () => {
    const options = flattenVisibleOptions(sections, new Set(['我的學科']), '');

    expect(options.map(o => o.key)).toEqual([
      'recent:dzb-bit',
      '程式設計與數學:cpp',
      '程式設計與數學:python',
      '數位乙級 C語言:dzb-bit',
    ]);
  });

  it('搜尋中忽略收合狀態', () => {
    const searched = buildSubjectSections([cpp, myQuad], '二次');
    const options = flattenVisibleOptions(searched, new Set(['我的學科']), '二次');

    expect(options.map(o => o.subject.id)).toEqual(['db:1']);
  });
});

describe('suggestTitle', () => {
  it('名稱欄為空時帶入學科名', () => {
    expect(suggestTitle({ currentTitle: '', lastSuggested: '', subjectName: 'C++ 程式設計' })).toBe('C++ 程式設計');
    expect(suggestTitle({ currentTitle: '   ', lastSuggested: '', subjectName: '微積分' })).toBe('微積分');
  });

  it('名稱仍是上次自動帶入的值（老師沒改）時跟著換學科', () => {
    expect(suggestTitle({ currentTitle: 'C++ 程式設計', lastSuggested: 'C++ 程式設計', subjectName: '微積分' })).toBe('微積分');
  });

  it('老師已輸入自己的名稱就不覆蓋（回傳 null）', () => {
    expect(suggestTitle({ currentTitle: '一年甲班 迴圈', lastSuggested: '', subjectName: '微積分' })).toBeNull();
    expect(suggestTitle({ currentTitle: 'C++ 程式設計 期中', lastSuggested: 'C++ 程式設計', subjectName: '微積分' })).toBeNull();
  });
});
