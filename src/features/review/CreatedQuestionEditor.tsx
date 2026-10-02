'use client';

// 小組出題編輯器（共創型態 question）：受控元件，value / onChange 都是題目 JSON 字串，
// 直接接在 ReviewPlayerCreate 的 useAutosaveTextarea 後面，沿用同一套 debounce 存檔節奏。
// 半成品也照樣寫回（不擋編輯），合法與否只在隊長送出時檢查。
import {
  CREATED_QUESTION_LIMITS,
  CREATED_QUESTION_TYPE_LABEL,
  type CreatedQuestion,
  type CreatedQuestionType,
  emptyCreatedQuestion,
  nextOptionId,
  parseCreatedQuestionDraft,
  serializeCreatedQuestion,
  switchCreatedQuestionType,
} from '@/services/review/createModes';

const FIELD_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';
const TYPES: CreatedQuestionType[] = ['single_choice', 'multiple_choice', 'true_false'];
const L = CREATED_QUESTION_LIMITS;

type DraftQuestion = CreatedQuestion & { explanation: string };

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  // 同一頁可能有兩個編輯器（我的草稿、隊長整合），radio name 要分開
  idPrefix: string;
};

export function CreatedQuestionEditor({ value, onChange, disabled = false, idPrefix }: Props) {
  // 空字串、壞 JSON 或舊的自由文字草稿都從空白單選題開始
  const q: DraftQuestion = parseCreatedQuestionDraft(value) ?? emptyCreatedQuestion('single_choice');
  const isChoice = q.type !== 'true_false';
  const isMultiple = q.type === 'multiple_choice';

  const update = (next: DraftQuestion) => onChange(serializeCreatedQuestion(next));

  const toggleCorrect = (optionId: string) => {
    if (isMultiple) {
      const has = q.correctAnswers.includes(optionId);
      update({
        ...q,
        correctAnswers: has ? q.correctAnswers.filter(id => id !== optionId) : [...q.correctAnswers, optionId],
      });
    } else {
      update({ ...q, correctAnswers: [optionId] });
    }
  };

  const addOption = () => {
    const id = nextOptionId(q.options);
    if (id && q.options.length < L.optionMax) {
      update({ ...q, options: [...q.options, { id, text: '' }] });
    }
  };

  const removeOption = (optionId: string) => {
    update({
      ...q,
      options: q.options.filter(o => o.id !== optionId),
      correctAnswers: q.correctAnswers.filter(id => id !== optionId),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="題型">
        {TYPES.map(t => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={q.type === t}
            disabled={disabled}
            onClick={() => update(switchCreatedQuestionType(q, t))}
            className={`min-h-11 rounded-md border px-2 text-sm disabled:opacity-50 ${
              q.type === t ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-input'
            }`}
          >
            {CREATED_QUESTION_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-body`} className="text-xs font-medium text-muted-foreground">題幹</label>
        <textarea
          id={`${idPrefix}-body`}
          value={q.body}
          onChange={e => update({ ...q, body: e.target.value })}
          rows={3}
          maxLength={L.bodyMax}
          disabled={disabled}
          placeholder={q.type === 'true_false' ? '寫一個可以判斷對錯的敘述⋯' : '寫下題目要問什麼⋯'}
          className={FIELD_CLASS}
        />
      </div>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-xs font-medium text-muted-foreground">
          {isMultiple ? '選項（勾選所有正確答案）' : '選項（點選正確答案）'}
        </legend>
        {q.options.map((o, i) => {
          const checked = q.correctAnswers.includes(o.id);
          return (
            <div
              key={o.id}
              className={`flex items-center gap-2 rounded-md border p-2 ${checked ? 'border-emerald-500 bg-emerald-500/10' : 'border-input'}`}
            >
              <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center" aria-label={`設為正確答案：選項 ${i + 1}`}>
                <input
                  type={isMultiple ? 'checkbox' : 'radio'}
                  name={`${idPrefix}-correct`}
                  checked={checked}
                  onChange={() => toggleCorrect(o.id)}
                  className="size-5 accent-emerald-600"
                />
              </label>
              {isChoice
                ? (
                    <input
                      type="text"
                      value={o.text}
                      onChange={e => update({
                        ...q,
                        options: q.options.map(x => (x.id === o.id ? { ...x, text: e.target.value } : x)),
                      })}
                      maxLength={L.optionTextMax}
                      placeholder={`選項 ${String.fromCharCode(65 + i)}`}
                      className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  )
                : <span className="flex-1 text-sm">{o.text}</span>}
              {isChoice && (
                <button
                  type="button"
                  onClick={() => removeOption(o.id)}
                  disabled={q.options.length <= L.optionMin}
                  aria-label={`刪除選項 ${String.fromCharCode(65 + i)}`}
                  className="flex size-11 shrink-0 items-center justify-center rounded-md text-lg text-muted-foreground disabled:opacity-30"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        {isChoice && q.options.length < L.optionMax && (
          <button
            type="button"
            onClick={addOption}
            className="min-h-11 w-full rounded-md border border-dashed border-input text-sm text-muted-foreground"
          >
            ＋ 新增選項
          </button>
        )}
      </fieldset>

      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-explanation`} className="text-xs font-medium text-muted-foreground">解析（選填）</label>
        <textarea
          id={`${idPrefix}-explanation`}
          value={q.explanation}
          onChange={e => update({ ...q, explanation: e.target.value })}
          rows={2}
          maxLength={L.explanationMax}
          disabled={disabled}
          placeholder="為什麼這個是正確答案？"
          className={FIELD_CLASS}
        />
      </div>
    </div>
  );
}
