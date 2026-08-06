'use client';

/**
 * ClozeQuestion — 學生作答克漏字題（cloze）用的元件。
 * 依 body 的 [[ ]] 標記位置，把文章渲染成「文字 + 空格輸入框」交錯排列。
 * 受控元件：value 是每個空格目前的作答，依文章順序排列。
 * 這是計分測驗題（不是練習頁），作答中不做即時對錯提示，只顯示「已完成 N/M 空格」進度。
 */
import { parseClozeBody } from '@/lib/cloze';

type Props = {
  body: string;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
};

export function ClozeQuestion({ body, value, onChange }: Props) {
  const segments = parseClozeBody(body);
  const totalBlanks = segments.filter(s => s.kind === 'blank').length;
  const filledCount = segments.filter(
    s => s.kind === 'blank' && (value?.[s.index] ?? '').trim() !== '',
  ).length;

  const handleBlankChange = (index: number, text: string) => {
    const next = [...(value ?? Array.from({ length: totalBlanks }, () => ''))];
    next[index] = text;
    onChange(next);
  };

  return (
    <div>
      <p className="text-base leading-loose text-gray-800">
        {segments.map(seg => seg.kind === 'text'
          ? <span key={`t-${seg.text}-${segments.indexOf(seg)}`}>{seg.text}</span>
          : (
              <input
                key={`b-${seg.index}`}
                type="text"
                aria-label={`空格 ${seg.index + 1}`}
                value={value?.[seg.index] ?? ''}
                onChange={e => handleBlankChange(seg.index, e.target.value)}
                className="mx-1 inline-block w-24 rounded-md border-2 border-gray-200 bg-gray-50/50 px-2 py-0.5 text-center text-base focus:border-emerald-400 focus:bg-white focus:outline-none"
              />
            ))}
      </p>
      {totalBlanks > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          已完成
          {' '}
          {filledCount}
          {' / '}
          {totalBlanks}
          {' '}
          空格
        </p>
      )}
    </div>
  );
}
