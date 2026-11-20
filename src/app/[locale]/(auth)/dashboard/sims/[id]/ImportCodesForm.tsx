'use client';

/** 匯入離線成績碼：學生在沒網路的電腦作答後交出的 `HDFIX3:` 成績碼，可整段聊天紀錄直接貼上 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { importSimResults } from '@/actions/simActions';

type Msg = { ok?: string; errors: string[] };

export function ImportCodesForm({ practiceId }: { practiceId: number }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<Msg | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await importSimResults(practiceId, text);
        if ('error' in res) {
          setMsg({ errors: [res.error] });
          return;
        }
        setMsg({
          ok: `成功匯入 ${res.inserted} 筆${res.skipped ? `，${res.skipped} 筆與既有紀錄相同已略過` : ''}`,
          errors: res.errors,
        });
        if (res.errors.length === 0) {
          setText('');
        }
        router.refresh();
      } catch {
        setMsg({ errors: ['匯入失敗，請重試'] });
      }
    });
  }

  return (
    <details className="group rounded-xl border bg-card p-4 shadow-sm">
      <summary className="cursor-pointer list-none text-sm font-semibold marker:content-none">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block transition-transform group-open:rotate-90">▶</span>
          📥 匯入離線成績碼
          <span className="text-xs font-normal text-muted-foreground">（學生斷線時交出的 HDFIX3: 成績碼）</span>
        </span>
      </summary>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={5}
        placeholder="每行一個 HDFIX3:xxxx… 成績碼；可整段聊天紀錄直接貼上，系統會自動抓出成績碼。也接受 JSON。"
        className="mt-3 w-full rounded-md border bg-background p-2 font-mono text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !text.trim()}
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? '匯入中…' : '匯入'}
        </button>
        {text && (
          <button type="button" onClick={() => setText('')} className="text-xs text-muted-foreground underline">
            清空
          </button>
        )}
      </div>
      {msg && (
        <div className="mt-3 space-y-2 text-sm">
          {msg.ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-700">{`✔ ${msg.ok}`}</div>}
          {msg.errors.length > 0 && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-red-700">
              {`✖ 有 ${msg.errors.length} 筆無法匯入：`}
              <ul className="mt-1 list-disc pl-5 text-xs">
                {msg.errors.map(e => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
