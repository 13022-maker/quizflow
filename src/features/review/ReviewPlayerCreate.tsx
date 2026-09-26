'use client';

import { useEffect, useRef, useState } from 'react';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const AUTOSAVE_DEBOUNCE_MS = 1500;

type Props = {
  topicPrompt: string;
  initialContent: string;
  onSave: (content: string) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export function ReviewPlayerCreate({ topicPrompt, initialContent, onSave }: Props) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (value: string) => {
    setContent(value);
    setStatus('idle');
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(async () => {
      setStatus('saving');
      const result = await onSave(value);
      setStatus(result.ok ? 'saved' : 'idle');
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="text-lg font-bold">共同創作延伸答案</h1>
      <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{topicPrompt}</p>
      <p className="text-xs text-muted-foreground">
        ⚠️ 組員可能同時在編輯，晚存檔的版本會蓋過先存的版本，建議討論好由一人主要輸入
      </p>
      <textarea
        value={content}
        onChange={e => handleChange(e.target.value)}
        rows={10}
        placeholder="在這裡跟組員一起寫下延伸想法⋯"
        className={TEXTAREA_CLASS}
      />
      <p className="text-xs text-muted-foreground">
        {status === 'saving' ? '儲存中⋯' : status === 'saved' ? '已儲存' : ' '}
      </p>
    </div>
  );
}
