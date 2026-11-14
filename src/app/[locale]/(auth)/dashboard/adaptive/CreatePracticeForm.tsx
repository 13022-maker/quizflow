'use client';

/**
 * 建立適性練習表單（練習名稱＋學科選擇＋送出）
 * 抽成 client component 是為了：選學科後自動帶入練習名稱建議、未選學科時停用送出鈕。
 * 實際寫入仍走 createAdaptivePractice server action（server 端驗證 title／subjectId）。
 */
import { useRef, useState } from 'react';

import { createAdaptivePractice } from '@/actions/adaptiveActions';
import type { AvailableSubject } from '@/libs/adaptive/subjectPicker';
import { suggestTitle } from '@/libs/adaptive/subjectPicker';

import { SubjectCombobox } from './SubjectCombobox';

export function CreatePracticeForm({ subjects }: { subjects: AvailableSubject[] }) {
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  // 上一次自動帶入的名稱：老師沒改過時，換學科會跟著換
  const lastSuggested = useRef('');

  function handleSelect(subject: AvailableSubject) {
    setSelectedId(subject.id);
    const suggestion = suggestTitle({ currentTitle: title, lastSuggested: lastSuggested.current, subjectName: subject.name });
    if (suggestion !== null) {
      setTitle(suggestion);
      lastSuggested.current = suggestion;
    }
  }

  return (
    <form action={createAdaptivePractice} className="mt-3 flex flex-col gap-4">
      <SubjectCombobox subjects={subjects} selectedId={selectedId} onSelect={handleSelect} />
      {/* 真正隨表單送出的值 */}
      <input type="hidden" name="subjectId" value={selectedId} />

      <div className="flex w-full flex-col gap-1 sm:w-96">
        <label htmlFor="adaptive-title" className="text-sm font-medium">練習名稱</label>
        <input
          id="adaptive-title"
          name="title"
          required
          maxLength={100}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="例如：一年甲班 迴圈練習"
          className="h-11 w-full rounded-md border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:h-9"
        />
        {selectedId && title === lastSuggested.current && (
          <p className="text-xs text-muted-foreground">已帶入學科名稱，可改成班級或單元名稱</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <button
          type="submit"
          disabled={!selectedId}
          aria-describedby={selectedId ? undefined : 'adaptive-submit-hint'}
          className="h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-auto"
        >
          ＋ 建立練習
        </button>
        {!selectedId && (
          <p id="adaptive-submit-hint" className="text-xs text-muted-foreground">請先選擇學科</p>
        )}
      </div>
    </form>
  );
}
