import type { ReactNode } from 'react';

const DEFAULT_MARK_CLASS = 'mx-0.5 rounded bg-blue-100 px-1 font-bold text-blue-700';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把句子中出現的關鍵字（單字卡的詞）包成 <mark> 高亮。
 * - 支援多個關鍵字，長的優先比對（避免「伺服器」被「伺服」切掉）
 * - 英文大小寫不敏感
 * - 找不到關鍵字時原樣回傳句子
 */
export function highlightKeyword(
  text: string,
  terms: string | Array<string | null | undefined>,
  markClassName: string = DEFAULT_MARK_CLASS,
): ReactNode {
  if (!text) {
    return text;
  }
  const list = (Array.isArray(terms) ? terms : [terms])
    .map(t => (t ?? '').trim())
    .filter((t): t is string => t.length > 0);
  const unique = Array.from(new Set(list)).sort((a, b) => b.length - a.length);
  if (unique.length === 0) {
    return text;
  }

  const pattern = new RegExp(`(${unique.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);
  if (parts.length === 1) {
    return text;
  }

  // split 帶 capture group：奇數 index 即為命中的關鍵字
  return parts.map((part, i) => {
    const key = `${i}-${part}`;
    return i % 2 === 1
      ? <mark key={key} className={markClassName}>{part}</mark>
      : <span key={key}>{part}</span>;
  });
}
