'use client';

/**
 * 學科選擇器（可搜尋 combobox）
 * - 依分類分組（組標題顯示科目數，學科多時可收合）＋最上方「最近使用」
 * - 選項顯示一句話說明與題數／知識點數；選定後下方顯示預覽卡（知識點＋課前重點摘要）
 * - 搜尋比對名稱、分類、說明、知識點名稱（忽略大小寫、全半形、「｜」與空白）
 * - 初始為「未選擇」，避免老師沒注意就建了第一科的練習
 * 表單提交仍靠隱藏 input 帶 subjectId（server 端會再驗證）。
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import type { AvailableSubject } from '@/libs/adaptive/subjectPicker';
import {
  buildSubjectSections,
  defaultCollapsedCategories,
  flattenVisibleOptions,
  normalizeForSearch,
} from '@/libs/adaptive/subjectPicker';

import { PreLessonSummaryModal } from './PreLessonSummaryModal';

function subjectStats(s: AvailableSubject): string {
  return `${s.itemCount} 題 · ${s.knowledgePointCount} 個知識點`;
}

export function SubjectCombobox({
  subjects,
  selectedId,
  onSelect,
}: {
  subjects: AvailableSubject[];
  selectedId: string;
  onSelect: (subject: AvailableSubject) => void;
}) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;
  const optionId = (key: string) => `${baseId}-opt-${key.replace(/[^\w-]/g, '_')}`;

  const selectedSubject = subjects.find(s => s.id === selectedId);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sections = useMemo(() => buildSubjectSections(subjects, query), [subjects, query]);
  // 收合狀態只在第一次算預設值（學科多時收合），之後由老師自己切換
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => defaultCollapsedCategories(buildSubjectSections(subjects, '').groups, selectedId),
  );
  const searching = normalizeForSearch(query) !== '';
  const visibleOptions = useMemo(
    () => flattenVisibleOptions(sections, collapsed, query),
    [sections, collapsed, query],
  );
  // 鍵盤導覽序列：選項＋（非搜尋時）各組標題，讓鍵盤使用者也能展開收合的組
  const navItems = useMemo(() => {
    const items: { key: string; subject?: AvailableSubject; category?: string }[] = sections.recent.map(s => ({ key: `recent:${s.id}`, subject: s }));
    for (const group of sections.groups) {
      if (!searching) {
        items.push({ key: `header:${group.category}`, category: group.category });
      }
      if (searching || !collapsed.has(group.category)) {
        for (const s of group.subjects) {
          items.push({ key: `${group.category}:${s.id}`, subject: s });
        }
      }
    }
    return items;
  }, [sections, collapsed, searching]);

  // 點外面收起選單、清掉未完成的搜尋字
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  // 鍵盤移動時把目前項目捲進可視範圍
  useEffect(() => {
    if (!open || !activeKey) {
      return;
    }
    document.getElementById(optionId(activeKey))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId 只依賴穩定的 baseId
  }, [activeKey, open]);

  // 選項變動（搜尋／收合）後，若目前項目已不可見就重設到第一個
  useEffect(() => {
    if (activeKey && !navItems.some(o => o.key === activeKey)) {
      setActiveKey(visibleOptions[0]?.key ?? null);
    }
  }, [navItems, visibleOptions, activeKey]);

  function openList() {
    setOpen(true);
    if (!activeKey) {
      const current = visibleOptions.find(o => o.subject.id === selectedId);
      setActiveKey(current?.key ?? visibleOptions[0]?.key ?? null);
    }
  }

  function choose(subject: AvailableSubject) {
    onSelect(subject);
    setQuery('');
    setOpen(false);
    setActiveKey(null); // 下次打開時重新定位到選中的學科
    inputRef.current?.blur();
  }

  function toggleGroup(category: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const index = navItems.findIndex(o => o.key === activeKey);
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (!open) {
          openList();
          return;
        }
        const next = navItems[Math.min(index + 1, navItems.length - 1)];
        setActiveKey(next?.key ?? null);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (!open) {
          openList();
          return;
        }
        const prev = navItems[Math.max(index - 1, 0)];
        setActiveKey(prev?.key ?? null);
        break;
      }
      case 'Home':
      case 'End': {
        if (!open) {
          return;
        }
        e.preventDefault();
        const target = e.key === 'Home' ? navItems[0] : navItems[navItems.length - 1];
        setActiveKey(target?.key ?? null);
        break;
      }
      case 'Enter': {
        // 選單開著時 Enter = 選取，避免誤送出表單
        if (open) {
          e.preventDefault();
          const active = navItems[index];
          if (active?.subject) {
            choose(active.subject);
          } else if (active?.category) {
            toggleGroup(active.category); // 組標題：Enter 展開／收合
          }
        }
        break;
      }
      case 'Escape': {
        if (open) {
          e.preventDefault();
          setOpen(false);
          setQuery('');
        }
        break;
      }
      case 'Tab':
        setOpen(false);
        setQuery('');
        break;
    }
  }

  function renderOption(key: string, s: AvailableSubject) {
    const isSelected = s.id === selectedId;
    const isActive = key === activeKey;
    return (
      // 鍵盤操作由 combobox input 統一處理（aria-activedescendant 模式），選項本身不需取得焦點
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events
      <div
        key={key}
        id={optionId(key)}
        role="option"
        tabIndex={-1}
        aria-selected={isSelected}
        // 用 onMouseDown 防止 input 失焦；點選在 onClick 完成
        onMouseDown={e => e.preventDefault()}
        onClick={() => choose(s)}
        onMouseMove={() => setActiveKey(key)}
        className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-2 text-left ${
          isActive ? 'bg-muted' : ''
        } ${isSelected ? 'text-primary' : ''}`}
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {s.pinned ? `📌 ${s.name}` : s.name}
          </span>
          {isSelected && <span aria-hidden className="text-xs">✓</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          {s.description && <span className="min-w-0 flex-1 truncate">{s.description}</span>}
          <span className="shrink-0 tabular-nums">{subjectStats(s)}</span>
        </div>
      </div>
    );
  }

  const hasResults = sections.recent.length > 0 || sections.groups.length > 0;
  // 只有真正的 option 才放進 aria-activedescendant（組標題是按鈕）
  const activeOptionId = open && activeKey && !activeKey.startsWith('header:') ? optionId(activeKey) : undefined;

  return (
    <div className="flex w-full flex-col gap-2 sm:w-96">
      <div ref={rootRef} className="relative flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium">學科</label>
        <div className="relative">
          <input
            ref={inputRef}
            id={inputId}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            aria-describedby={selectedSubject ? `${baseId}-preview` : undefined}
            autoComplete="off"
            value={open ? query : (selectedSubject?.name ?? '')}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={openList}
            onClick={openList}
            onKeyDown={onKeyDown}
            placeholder={open ? '搜尋學科、分類或知識點（如：指標、乙級、迴圈）' : '請選擇學科'}
            className="h-11 w-full rounded-md border bg-background pl-3 pr-9 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:h-9"
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            {open ? '▲' : '▼'}
          </span>
        </div>

        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-label="學科清單"
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 shadow-lg"
          >
            {sections.recent.length > 0 && (
              <div role="group" aria-labelledby={`${baseId}-g-recent`}>
                <div id={`${baseId}-g-recent`} className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  最近使用
                </div>
                {sections.recent.map(s => renderOption(`recent:${s.id}`, s))}
              </div>
            )}

            {sections.groups.map((group, gi) => {
              const isCollapsed = !searching && collapsed.has(group.category);
              const labelId = `${baseId}-g-${gi}`;
              const headerKey = `header:${group.category}`;
              return (
                <div key={group.category} role="group" aria-labelledby={labelId}>
                  <button
                    type="button"
                    id={optionId(headerKey)}
                    tabIndex={-1}
                    aria-expanded={!isCollapsed}
                    disabled={searching}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => toggleGroup(group.category)}
                    onMouseMove={() => setActiveKey(headerKey)}
                    className={`mt-1 flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-medium text-muted-foreground hover:bg-muted/60 ${activeKey === headerKey ? 'bg-muted/60' : ''} disabled:cursor-default disabled:hover:bg-transparent sm:min-h-8`}
                  >
                    {!searching && (
                      <span aria-hidden className={`inline-block transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                    )}
                    <span id={labelId} className="flex-1">{group.category}</span>
                    <span className="rounded-full border px-2 py-0.5 tabular-nums" aria-label={`${group.subjects.length} 個學科`}>{group.subjects.length}</span>
                  </button>
                  {!isCollapsed && group.subjects.map(s => renderOption(`${group.category}:${s.id}`, s))}
                </div>
              );
            })}

            {!hasResults && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                找不到符合「
                {query.trim()}
                」的學科
              </div>
            )}
          </div>
        )}
      </div>

      {/* 選定後的預覽卡：說明、統計、前 5 個知識點、課前重點摘要 */}
      {selectedSubject && (
        <div id={`${baseId}-preview`} className="rounded-lg border bg-muted/30 p-3 text-sm">
          {selectedSubject.description && (
            <p className="text-muted-foreground">{selectedSubject.description}</p>
          )}
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">{subjectStats(selectedSubject)}</p>
          {selectedSubject.knowledgePointNames.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="知識點">
              {selectedSubject.knowledgePointNames.map(name => (
                <li key={name} className="rounded-full border bg-background px-2.5 py-0.5 text-xs">{name}</li>
              ))}
              {selectedSubject.knowledgePointCount > selectedSubject.knowledgePointNames.length && (
                <li className="px-1 py-0.5 text-xs text-muted-foreground">
                  …共
                  {' '}
                  {selectedSubject.knowledgePointCount}
                  {' '}
                  個
                </li>
              )}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setShowSummaryModal(true)}
            className="mt-3 inline-flex min-h-11 items-center rounded-md border bg-background px-3 text-sm hover:bg-muted sm:min-h-8"
          >
            📄 查看課前重點摘要
          </button>
        </div>
      )}

      {showSummaryModal && selectedSubject && (
        <PreLessonSummaryModal
          subjectId={selectedSubject.id}
          subjectName={selectedSubject.name}
          onClose={() => setShowSummaryModal(false)}
        />
      )}
    </div>
  );
}
