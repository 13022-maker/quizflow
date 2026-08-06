'use client';

/**
 * ClozeEditor — 克漏字題（cloze）的老師編輯介面。
 * 老師直接在文章裡用 [[詞彙]] 標記要挖空的重點，或按「隨機挑選」
 * 讓系統用純規則（不叫 AI）自動挑詞標記。下方即時預覽目前有幾個空格、位置在哪。
 */
import { useState } from 'react';

import { applyRandomClozeBlanks, countClozeBlanks, parseClozeBody } from '@/lib/cloze';

type Props = {
  body: string;
  onChange: (body: string) => void;
};

export function ClozeEditor({ body, onChange }: Props) {
  const [randomCount, setRandomCount] = useState(5);
  // 隨機挑選對連續中文（沒有標點分隔）是已知限制，挑不到詞時要明確告知，
  // 不然按鈕看起來像壞掉（見 code review 發現：純規則對一般中文段落常常挑不到任何候選詞）
  const [randomPickMessage, setRandomPickMessage] = useState('');
  const blankCount = countClozeBlanks(body);
  const segments = parseClozeBody(body);

  const handleRandomPick = () => {
    const next = applyRandomClozeBlanks(body, randomCount);
    if (next === body) {
      setRandomPickMessage('找不到適合的詞（純規則對連續中文效果有限），請手動用 [[ ]] 標記重點詞彙');
      return;
    }
    setRandomPickMessage('');
    onChange(next);
  };

  return (
    <div>
      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label className="mb-1 block text-sm font-medium">
        文章段落
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          （用 [[詞彙]] 標記要挖空的重點，或用下方按鈕自動挑選）
        </span>
      </label>
      <textarea
        value={body}
        onChange={e => onChange(e.target.value)}
        rows={6}
        placeholder="貼上文章段落，並用 [[詞彙]] 標記要挖空的重點，例如：光合作用需要[[陽光]]、水和[[二氧化碳]]。"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          max={10}
          value={randomCount}
          onChange={e => setRandomCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
          aria-label="隨機挑選空格數"
          className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
        />
        <button
          type="button"
          onClick={handleRandomPick}
          className="rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          🎲 隨機挑選
        </button>
        <span className="text-xs text-muted-foreground">
          隨機模式對英文/數字效果較佳，中文段落建議手動用 [[ ]] 標記重點詞彙
        </span>
      </div>
      {randomPickMessage && (
        <p className="mt-1 text-xs text-amber-600">{randomPickMessage}</p>
      )}

      <div className="mt-2 rounded-md border bg-muted/30 px-3 py-2 text-sm leading-relaxed">
        {segments.length === 0
          ? <span className="text-muted-foreground">尚未輸入文章</span>
          : segments.map(seg => seg.kind === 'text'
            ? <span key={`t-${seg.text}-${segments.indexOf(seg)}`}>{seg.text}</span>
            : (
                <span
                  key={`b-${seg.index}`}
                  className="mx-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                >
                  空格
                  {seg.index + 1}
                </span>
              ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        共
        {' '}
        {blankCount}
        {' '}
        個空格
      </p>
    </div>
  );
}
