'use client';

/** 練習清單的排序／學科篩選下拉選單：改變值即更新網址 query string，交給 page.tsx（Server Component）重新渲染 */
import { useRouter, useSearchParams } from 'next/navigation';

export function AdaptiveListControls({ subjects }: { subjects: { id: string; name: string }[] }) {
  const router = useRouter();
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
    <div className="flex flex-wrap items-center gap-2">
      <select
        defaultValue={searchParams.get('subject') ?? ''}
        onChange={e => updateParam('subject', e.target.value)}
        className="h-9 rounded-lg border bg-background px-2 text-sm"
      >
        <option value="">全部學科</option>
        {subjects.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <select
        defaultValue={searchParams.get('sort') ?? 'created_desc'}
        onChange={e => updateParam('sort', e.target.value)}
        className="h-9 rounded-lg border bg-background px-2 text-sm"
      >
        <option value="created_desc">建立時間：新到舊</option>
        <option value="created_asc">建立時間：舊到新</option>
        <option value="title_asc">標題 A-Z</option>
        <option value="students_desc">學生人數：多到少</option>
      </select>
    </div>
  );
}
