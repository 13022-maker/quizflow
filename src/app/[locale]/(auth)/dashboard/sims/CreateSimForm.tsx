'use client';

/**
 * 建立實作模擬表單：標題、模式（練習／測驗）、限時（選填）、監評指定內容（選填，預設表 A）。
 * 寫入走 createSimPractice server action（server 端 auth + Zod 驗證）。
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createSimPractice } from '@/actions/simActions';
import type { SimMode } from '@/libs/sim/types';

import {
  diffSpec,
  HDFIX3_DEFAULT_SPEC,
  OFFICE_OPTIONS,
  OTHER_FIELDS,
  PRIMARY_FIELDS,
  type SpecDraft,
  type SpecField,
} from './specFields';

const inputCls = 'h-11 w-full rounded-md border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:h-9';

const MODE_OPTIONS: { value: SimMode; label: string; desc: string }[] = [
  { value: 'practice', label: '📘 練習', desc: '有步驟教學與參考答案，每通過一題即回傳進度' },
  { value: 'exam', label: '📝 測驗', desc: '無解答，學生交卷後才回傳成績' },
];

function initialDraft(): SpecDraft {
  return { ...HDFIX3_DEFAULT_SPEC, office: [...HDFIX3_DEFAULT_SPEC.office] };
}

export function CreateSimForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<SimMode>('practice');
  const [timeLimit, setTimeLimit] = useState('');
  const [draft, setDraft] = useState<SpecDraft>(initialDraft);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = diffSpec(draft);

  function setField(key: keyof SpecDraft, value: string | string[]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  function renderField(f: SpecField) {
    const id = `sim-spec-${f.key}`;
    const def = HDFIX3_DEFAULT_SPEC[f.key];
    if (f.type === 'office') {
      const selected = draft.office as string[];
      return (
        <fieldset key={f.key} className="flex flex-col gap-1">
          <legend className="text-xs font-medium text-muted-foreground">{f.label}</legend>
          <div className="flex flex-wrap gap-3 py-1.5">
            {OFFICE_OPTIONS.map(o => (
              <label key={o.value} className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={e => setField('office', e.target.checked
                    ? [...selected, o.value]
                    : selected.filter(v => v !== o.value))}
                />
                {o.label.replace(/（.*/, '')}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    if (f.type === 'select') {
      return (
        <div key={f.key} className="flex flex-col gap-1">
          <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{f.label}</label>
          <select
            id={id}
            value={String(draft[f.key])}
            onChange={e => setField(f.key, e.target.value)}
            className={inputCls}
          >
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    }
    return (
      <div key={f.key} className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{f.label}</label>
        <input
          id={id}
          type={f.type}
          min={f.type === 'number' ? 0 : undefined}
          value={String(draft[f.key])}
          placeholder={String(def)}
          onChange={e => setField(f.key, e.target.value)}
          className={inputCls}
        />
      </div>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minutes = timeLimit.trim() === '' ? null : Number(timeLimit);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) {
      setError('限時請填 1–600 的整數分鐘，或留空表示不限時');
      return;
    }
    startTransition(async () => {
      try {
        const res = await createSimPractice({
          title: title.trim(),
          mode,
          timeLimitMin: minutes,
          spec: changed,
        });
        if ('error' in res) {
          setError(res.error);
          return;
        }
        router.push(`/dashboard/sims/${res.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : '建立失敗，請重試');
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-4">
      <div className="flex w-full flex-col gap-1 sm:w-96">
        <label htmlFor="sim-title" className="text-sm font-medium">名稱</label>
        <input
          id="sim-title"
          required
          maxLength={100}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="例如：資訊二甲 硬體裝修丙級 模擬一"
          className={inputCls}
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">模式</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODE_OPTIONS.map(o => (
            <label
              key={o.value}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 transition-colors ${
                mode === o.value ? 'border-primary bg-primary/5' : 'hover:bg-muted'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="radio"
                  name="sim-mode"
                  value={o.value}
                  checked={mode === o.value}
                  onChange={() => setMode(o.value)}
                />
                {o.label}
              </span>
              <span className="pl-5 text-xs text-muted-foreground">{o.desc}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex w-full flex-col gap-1 sm:w-48">
        <label htmlFor="sim-time" className="text-sm font-medium">限時（分鐘，選填）</label>
        <input
          id="sim-time"
          type="number"
          inputMode="numeric"
          min={1}
          max={600}
          value={timeLimit}
          onChange={e => setTimeLimit(e.target.value)}
          placeholder="不限時"
          className={inputCls}
        />
      </div>

      <details className="group rounded-lg border p-4">
        <summary className="cursor-pointer list-none text-sm font-medium marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block transition-transform group-open:rotate-90">▶</span>
            進階：監評指定內容
            <span className="text-xs font-normal text-muted-foreground">
              {changed ? `（已修改 ${Object.keys(changed).length} 項）` : '（預設：表 A）'}
            </span>
          </span>
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          依當次監評指定內容表修改；沒改的欄位沿用表 A 預設值。學生端會鎖定這份規格，不能自行修改。
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRIMARY_FIELDS.map(renderField)}
        </div>
        <details className="group/more mt-4">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">更多欄位</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {OTHER_FIELDS.map(renderField)}
          </div>
        </details>
        {changed && (
          <button
            type="button"
            onClick={() => setDraft(initialDraft())}
            className="mt-3 text-xs text-muted-foreground underline hover:text-foreground"
          >
            還原為表 A
          </button>
        )}
      </details>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-auto"
        >
          {pending ? '建立中…' : '＋ 建立實作模擬'}
        </button>
      </div>
    </form>
  );
}
