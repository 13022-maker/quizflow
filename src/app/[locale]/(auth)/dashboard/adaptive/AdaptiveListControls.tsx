'use client';

/** 練習清單的排序／學科篩選下拉選單：改變值即更新網址 query string，交給 page.tsx（Server Component）重新渲染 */
import { useRouter, useSearchParams } from 'next/navigation';

import type { AvailableSubject } from '@/libs/adaptive/subjectPicker';
import { buildSubjectSections } from '@/libs/adaptive/subjectPicker';

type SubjectFilterOption = Pick<AvailableSubject, 'id' | 'name' | 'group' | 'category'>;

export function AdaptiveListControls({ subjects }: { subjects: SubjectFilterOption[] }) {
  const router = useRouter();
  // 依分類分組（與建立練習的學科選單同一套規則）；這裡不需要搜尋與最近使用
  const { groups } = buildSubjectSections(
    subjects.map(s => ({ ...s, pinned: false, itemCount: 0, knowledgePointCount: 0, knowledgePointNames: [], searchText: '' })),
    '',
  );
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
      <select
        defaultValue={searchParams.get('subject') ?? ''}
        onChange={e => updateParam('subject', e.target.value)}
        aria-label="依學科篩選"
        className="h-11 w-full max-w-full rounded-lg border bg-background px-2 text-sm sm:h-9 sm:w-auto"
      >
        <option value="">全部學科</option>
        {groups.map(g => (
          <optgroup key={g.category} label={`${g.category}（${g.subjects.length}）`}>
            {g.subjects.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <select
        defaultValue={searchParams.get('sort') ?? 'created_desc'}
        onChange={e => updateParam('sort', e.target.value)}
        aria-label="排序方式"
        className="h-11 w-full rounded-lg border bg-background px-2 text-sm sm:h-9 sm:w-auto"
      >
        <option value="created_desc">建立時間：新到舊</option>
        <option value="created_asc">建立時間：舊到新</option>
        <option value="title_asc">標題 A-Z</option>
        <option value="students_desc">學生人數：多到少</option>
      </select>
    </div>
  );
}
