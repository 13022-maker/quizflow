import type { ElementType } from 'react';

import { type InlineSegment, parseInlineCode, parseRichText } from '@/lib/richText';
import { cn } from '@/utils/Helpers';

/**
 * 題目文字渲染元件（題幹／選項／詳解共用）
 *
 * - ```lang ... ``` → <pre><code>：等寬字型、保留空白縮排、過寬時橫向捲動，不撐破版面
 * - `x` → 行內 <code>
 * - 其餘文字維持外層樣式，換行保留（whitespace-pre-wrap）
 *
 * 全部走 React 文字節點，不用 dangerouslySetInnerHTML，題目內容無 XSS 風險。
 * 沒有 server-only / client-only API，Server 與 Client Component 都能直接用。
 *
 * 注意：外層不可以是 <p>（<pre> 放在 <p> 裡是不合法 HTML，SSR 會被瀏覽器拆開造成 hydration 錯誤），
 * 需要行內排版時用 as="span"。
 */

const CODE_BLOCK_CLASS
  = 'my-2 block max-w-full overflow-x-auto whitespace-pre rounded-md border border-slate-200 bg-slate-50 p-3 '
  + 'text-left font-mono text-[0.85em] font-normal leading-relaxed text-slate-800';

const INLINE_CODE_CLASS
  = 'rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] font-normal text-slate-800';

function InlineSegments({ segments }: { segments: InlineSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'code'
          // eslint-disable-next-line react/no-array-index-key -- 片段為靜態解析結果，順序不會變動
          ? <code key={i} className={INLINE_CODE_CLASS}>{seg.text}</code>
          : seg.text,
      )}
    </>
  );
}

type RichTextProps = {
  text: string | null | undefined;
  className?: string;
  /** 外層元素，預設 div；放在 label / button 等行內容器時用 span */
  as?: ElementType;
};

export function RichText({ text, className, as: Tag = 'div' }: RichTextProps) {
  const blocks = parseRichText(text ?? '');

  return (
    <Tag className={cn('min-w-0 whitespace-pre-wrap break-words', className)}>
      {blocks.map((block, i) =>
        block.kind === 'code'
          ? (
              // eslint-disable-next-line react/no-array-index-key -- 區塊為靜態解析結果，順序不會變動
              <pre key={i} className={CODE_BLOCK_CLASS} style={{ tabSize: 4 }} data-lang={block.lang || undefined}>
                <code>{block.code}</code>
              </pre>
            )
          : (
              // eslint-disable-next-line react/no-array-index-key -- 區塊為靜態解析結果，順序不會變動
              <span key={i} className={blocks.length > 1 ? 'block' : undefined}>
                <InlineSegments segments={parseInlineCode(block.text)} />
              </span>
            ),
      )}
    </Tag>
  );
}
