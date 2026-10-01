// 小組出的題目預覽（共創型態 question）：投票時 showAnswer=false 讓大家只比題目品質，
// 老師結果頁 showAnswer=true 顯示正確答案與解析。
// content 是 DB 原樣的 JSON 字串，可能是系統逾時代送的半成品或壞 JSON，一律不能 crash。
import {
  CREATED_QUESTION_TYPE_LABEL,
  parseCreatedQuestion,
  parseCreatedQuestionDraft,
} from '@/services/review/createModes';

type Props = {
  content: string;
  showAnswer: boolean;
  // 組員草稿區要看半成品內容；投票/結果頁對未完成的題目只顯示提示
  allowIncomplete?: boolean;
  emptyText?: string;
};

export function CreatedQuestionPreview({ content, showAnswer, allowIncomplete = false, emptyText = '（尚未撰寫）' }: Props) {
  const complete = parseCreatedQuestion(content);
  const draft = complete ?? (allowIncomplete ? parseCreatedQuestionDraft(content) : null);

  if (!draft) {
    if (content.trim().length === 0) {
      return <p className="text-sm text-muted-foreground">{emptyText}</p>;
    }
    return <p className="text-sm text-muted-foreground">⚠️ 這組的題目未完成</p>;
  }

  const options = draft.options.filter(o => complete || o.text.trim().length > 0);
  const correct = new Set(draft.correctAnswers);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-input px-2 py-0.5 text-xs text-muted-foreground">
          {CREATED_QUESTION_TYPE_LABEL[draft.type]}
        </span>
        {!complete && <span className="text-xs text-amber-600">未完成</span>}
      </div>
      <p className="whitespace-pre-wrap font-medium">{draft.body.trim() || '（題幹尚未撰寫）'}</p>
      {options.length > 0 && (
        <ol className="space-y-1">
          {options.map((o, i) => {
            const isCorrect = showAnswer && correct.has(o.id);
            return (
              <li
                key={o.id}
                className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
                  isCorrect ? 'border-emerald-500 bg-emerald-500/10' : 'border-input'
                }`}
              >
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {draft.type === 'true_false' ? (o.id === 'tf-true' ? '○' : '✕') : String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-words">{o.text}</span>
                {isCorrect && <span className="shrink-0 text-xs font-medium text-emerald-600">✓ 正確答案</span>}
              </li>
            );
          })}
        </ol>
      )}
      {showAnswer && (draft.explanation ?? '').trim().length > 0 && (
        <p className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs text-muted-foreground">
          解析：
          {draft.explanation}
        </p>
      )}
    </div>
  );
}
