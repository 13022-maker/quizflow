'use client';

/**
 * 學科下拉選單（可搜尋）
 * 老師自建學科一多，原生 <select> 選單會拉得很長不好找，
 * 改成可打字篩選的 combobox；表單提交仍靠隱藏 input 帶 subjectId。
 */
import { useEffect, useMemo, useRef, useState } from 'react';

type SubjectOption = {
  id: string;
  name: string;
  pinned?: boolean;
};

export function SubjectCombobox({
  builtInSubjects,
  customSubjects,
}: {
  builtInSubjects: SubjectOption[];
  customSubjects: SubjectOption[];
}) {
  const allSubjects = useMemo(
    () => [...builtInSubjects, ...customSubjects],
    [builtInSubjects, customSubjects],
  );
  const [selectedId, setSelectedId] = useState(allSubjects[0]?.id ?? '');
  const [query, setQuery] = useState(allSubjects[0]?.name ?? '');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 點外面收起選單
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        // 沒選到有效學科時，把輸入框文字還原成目前選中的名稱
        const current = allSubjects.find(s => s.id === selectedId);
        setQuery(current?.name ?? '');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [allSubjects, selectedId]);

  const keyword = query.trim().toLowerCase();
  const filteredBuiltIn = keyword
    ? builtInSubjects.filter(s => s.name.toLowerCase().includes(keyword))
    : builtInSubjects;
  const filteredCustom = keyword
    ? customSubjects.filter(s => s.name.toLowerCase().includes(keyword))
    : customSubjects;

  function selectSubject(s: SubjectOption) {
    setSelectedId(s.id);
    setQuery(s.name);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      <label htmlFor="adaptive-subject" className="text-sm font-medium">學科</label>
      <input
        id="adaptive-subject"
        role="combobox"
        aria-expanded={open}
        aria-controls="adaptive-subject-listbox"
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="輸入關鍵字搜尋學科"
        className="h-9 w-56 rounded-lg border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {/* 真正隨表單送出的值 */}
      <input type="hidden" name="subjectId" value={selectedId} />

      {open && (
        <div
          id="adaptive-subject-listbox"
          role="listbox"
          className="absolute top-full z-10 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
        >
          {filteredBuiltIn.length > 0 && (
            <div>
              <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">內建科目</div>
              {filteredBuiltIn.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectSubject(s)}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                    s.id === selectedId ? 'bg-primary/10 text-primary' : ''
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          {filteredCustom.length > 0 && (
            <div>
              <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">我的學科</div>
              {filteredCustom.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectSubject(s)}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                    s.id === selectedId ? 'bg-primary/10 text-primary' : ''
                  }`}
                >
                  {s.pinned ? `📌 ${s.name}` : s.name}
                </button>
              ))}
            </div>
          )}
          {filteredBuiltIn.length === 0 && filteredCustom.length === 0 && (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">找不到符合的學科</div>
          )}
        </div>
      )}
    </div>
  );
}
