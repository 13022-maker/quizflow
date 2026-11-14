/**
 * 學科選擇器的純邏輯（不依賴 React，可單元測試）
 * 給「適性學習 → 建立新練習」的學科選單與練習清單篩選共用：
 * 分組、搜尋正規化與比對、最近使用、description fallback、練習名稱自動帶入。
 */

/** listAvailableSubjects() 回傳給前端的單一學科（只含統計與名稱，不含題庫內容） */
export type AvailableSubject = {
  id: string;
  name: string;
  group: 'built-in' | 'custom';
  pinned: boolean;
  /** 內建學科的分類（如「數位乙級 C語言」）；自建學科不設 */
  category?: string;
  /** 一句話說明；自建學科沒有時由 server 端用 describeSubject() 組出 */
  description?: string;
  itemCount: number;
  knowledgePointCount: number;
  /** 前 5 個知識點名稱（預覽卡用） */
  knowledgePointNames: string[];
  /** 搜尋用文字：分類＋說明＋全部知識點名稱（已在 server 端串好，前端不需要完整圖譜） */
  searchText: string;
  /** 老師最近一次用這個學科建立練習的時間（ISO 字串）；沒用過則不設 */
  recentlyUsedAt?: string;
};

/** 內建學科未設 category 時的預設組名（既有 cpp／python／calculus） */
export const DEFAULT_BUILT_IN_CATEGORY = '程式設計與數學';
/** 老師自建學科的組名 */
export const CUSTOM_CATEGORY = '我的學科';
/** 學科總數超過此值時，選單預設收合各組（避免一打開就是一長串） */
export const COLLAPSE_THRESHOLD = 12;
/** 「最近使用」最多顯示幾個 */
export const RECENT_LIMIT = 3;

/**
 * 搜尋正規化：全形英數轉半形、轉小寫、移除空白與「｜」「|」
 * 讓「數位乙級 | 指標」「數位乙級｜指標」「乙級指標」都能互相比對。
 */
export function normalizeForSearch(text: string): string {
  // NFKC 會把全形英數、全形「｜」、全形空白轉成半形
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s|]/g, '');
}

/** 學科所屬分組名稱 */
export function subjectCategory(subject: Pick<AvailableSubject, 'group' | 'category'>): string {
  if (subject.group === 'custom') {
    return CUSTOM_CATEGORY;
  }
  return subject.category?.trim() || DEFAULT_BUILT_IN_CATEGORY;
}

/** 關鍵字是否命中：名稱、分組名、說明、知識點名稱（searchText） */
export function matchesQuery(
  subject: Pick<AvailableSubject, 'name' | 'group' | 'category' | 'description' | 'searchText'>,
  query: string,
): boolean {
  const keyword = normalizeForSearch(query);
  if (!keyword) {
    return true;
  }
  const haystack = normalizeForSearch(
    [subject.name, subjectCategory(subject), subject.description ?? '', subject.searchText].join(' '),
  );
  return haystack.includes(keyword);
}

/**
 * 學科一句話說明：有 description 直接用；
 * 否則用「主題：涵蓋 A、B、C 等 N 個知識點」組一句（自建學科常見）。
 */
export function describeSubject(input: {
  description?: string;
  sourceTopic?: string;
  knowledgePointNames: string[];
  knowledgePointCount: number;
}): string {
  const description = input.description?.trim();
  if (description) {
    return description;
  }
  const topic = input.sourceTopic?.trim() ?? '';
  const names = input.knowledgePointNames.slice(0, 3);
  if (names.length === 0) {
    return topic;
  }
  const more = input.knowledgePointCount > names.length ? '等' : '';
  const coverage = `涵蓋${names.join('、')}${more} ${input.knowledgePointCount} 個知識點`;
  return topic ? `${topic}：${coverage}` : coverage;
}

/** 依 recentlyUsedAt 新到舊取前 limit 個用過的學科 */
export function pickRecentSubjects<T extends Pick<AvailableSubject, 'recentlyUsedAt'>>(
  subjects: T[],
  limit = RECENT_LIMIT,
): T[] {
  return subjects
    .filter(s => s.recentlyUsedAt)
    .sort((a, b) => (b.recentlyUsedAt! > a.recentlyUsedAt! ? 1 : b.recentlyUsedAt! < a.recentlyUsedAt! ? -1 : 0))
    .slice(0, limit);
}

export type SubjectGroup<T> = { category: string; subjects: T[] };

/**
 * 組出選單內容：最近使用（搜尋時隱藏）＋依分類分組。
 * 內建分類依註冊順序（首次出現）排列，「我的學科」固定最後、釘選優先（其餘維持傳入順序）。
 */
export function buildSubjectSections<T extends AvailableSubject>(
  subjects: T[],
  query: string,
): { recent: T[]; groups: SubjectGroup<T>[] } {
  const searching = normalizeForSearch(query) !== '';
  const matched = subjects.filter(s => matchesQuery(s, query));

  const byCategory = new Map<string, T[]>();
  for (const s of matched) {
    const category = subjectCategory(s);
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category)!.push(s);
  }

  const groups: SubjectGroup<T>[] = [];
  for (const [category, list] of byCategory) {
    if (category === CUSTOM_CATEGORY) {
      continue;
    }
    groups.push({ category, subjects: list });
  }
  const custom = byCategory.get(CUSTOM_CATEGORY);
  if (custom) {
    // 穩定排序：釘選在前，其餘維持原順序
    const sorted = [...custom.filter(s => s.pinned), ...custom.filter(s => !s.pinned)];
    groups.push({ category: CUSTOM_CATEGORY, subjects: sorted });
  }

  return { recent: searching ? [] : pickRecentSubjects(subjects), groups };
}

/** 預設收合哪些組：總數少就全展開；多則全收合，但保留目前選中學科所在的組 */
export function defaultCollapsedCategories<T extends AvailableSubject>(
  groups: SubjectGroup<T>[],
  selectedId: string,
): Set<string> {
  const total = groups.reduce((sum, g) => sum + g.subjects.length, 0);
  if (total <= COLLAPSE_THRESHOLD) {
    return new Set();
  }
  return new Set(
    groups
      .filter(g => !g.subjects.some(s => s.id === selectedId))
      .map(g => g.category),
  );
}

export type VisibleOption<T> = { key: string; subject: T };

/** 依畫面順序攤平可見選項（鍵盤上下鍵導覽用）；同一學科可能同時出現在「最近使用」與所屬組，用 key 區分 */
export function flattenVisibleOptions<T extends AvailableSubject>(
  sections: { recent: T[]; groups: SubjectGroup<T>[] },
  collapsed: Set<string>,
  query: string,
): VisibleOption<T>[] {
  const searching = normalizeForSearch(query) !== '';
  const options: VisibleOption<T>[] = sections.recent.map(s => ({ key: `recent:${s.id}`, subject: s }));
  for (const group of sections.groups) {
    if (!searching && collapsed.has(group.category)) {
      continue;
    }
    for (const s of group.subjects) {
      options.push({ key: `${group.category}:${s.id}`, subject: s });
    }
  }
  return options;
}

/**
 * 練習名稱自動帶入：名稱欄為空、或仍是上次自動帶入的值（老師沒改過）時回傳學科名；
 * 老師已輸入自己的名稱則回傳 null（不覆蓋）。
 */
export function suggestTitle(input: { currentTitle: string; lastSuggested: string; subjectName: string }): string | null {
  const current = input.currentTitle.trim();
  if (current === '' || (input.lastSuggested !== '' && current === input.lastSuggested.trim())) {
    return input.subjectName;
  }
  return null;
}
