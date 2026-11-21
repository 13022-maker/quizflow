import { needsCodeSnippet } from '@/lib/codeBlock';

type Props = {
  questions: { question: string }[];
};

/**
 * AI 命題完成後的警告：題目提到「下列程式」但沒有附程式碼的題號列出來，
 * 讓老師匯入前就知道要重新命題或匯入後手動補程式碼（server 端已先嘗試自動修補）。
 */
export function MissingCodeWarning({ questions }: Props) {
  const missing = questions
    .map((q, i) => (typeof q.question === 'string' && needsCodeSnippet(q.question) ? i + 1 : 0))
    .filter(n => n > 0);

  if (missing.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
      ⚠️ 第
      {' '}
      {missing.join('、')}
      {' '}
      題提到程式碼，但 AI 沒有附上程式碼。建議按「重新命題」，或匯入後在題目中補上程式碼（以 ```cpp 開頭、``` 結尾），或對該題按「重生」。
    </div>
  );
}
