import { parseCodeBlocks } from '@/lib/codeBlock';

type Props = {
  text: string;
  /** 外層容器 class（字級、粗細等沿用原本 <p> 的樣式） */
  className?: string;
  /** 外層元素：預設 div；題號等行內前綴請放在 prefix */
  as?: 'div' | 'span';
  /** 接在第一段文字前面的行內內容（例如「Q1. 」） */
  prefix?: React.ReactNode;
};

/**
 * 題目文字渲染：一般文字保留換行（whitespace-pre-wrap），
 * markdown 圍欄程式碼區塊（```cpp ... ```）渲染成等寬 <pre><code>，保留縮排、可水平捲動。
 *
 * 安全性：全部走 React 文字節點（自動 escape），不使用 dangerouslySetInnerHTML，
 * 題目內容即使含 <script> 或 HTML 也只會被當成純文字顯示。
 *
 * 注意：外層不能是 <p>，因為 <pre> 不能放在 <p> 裡（hydration error）。
 */
export function QuestionBody({ text, className, as = 'div', prefix }: Props) {
  const segments = parseCodeBlocks(text ?? '');
  const Wrapper = as;
  const hasCode = segments.some(s => s.kind === 'code');

  // 沒有程式碼：維持原本純文字行為（最常見，避免多一層 DOM）
  if (!hasCode) {
    return (
      <Wrapper className={`whitespace-pre-wrap ${className ?? ''}`}>
        {prefix}
        {text}
      </Wrapper>
    );
  }

  return (
    <Wrapper className={className}>
      {prefix && segments[0]?.kind === 'code' ? <span className="block">{prefix}</span> : null}
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return (
            // eslint-disable-next-line react/no-array-index-key -- 段落順序固定，index 即穩定 key
            <span key={i} className="block whitespace-pre-wrap">
              {i === 0 ? prefix : null}
              {seg.text}
            </span>
          );
        }
        return (
          <pre
            // eslint-disable-next-line react/no-array-index-key -- 段落順序固定，index 即穩定 key
            key={i}
            data-testid="question-code-block"
            data-lang={seg.lang || undefined}
            className="my-2 overflow-x-auto whitespace-pre rounded-lg border border-slate-200 bg-slate-50 p-3 text-left font-mono text-[13px] font-normal leading-relaxed text-slate-800 sm:text-sm"
          >
            <code>{seg.code}</code>
          </pre>
        );
      })}
    </Wrapper>
  );
}
