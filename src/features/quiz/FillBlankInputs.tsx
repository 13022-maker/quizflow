'use client';

/**
 * FillBlankInputs — 多格填空題的學生作答區：每個空格一個輸入框。
 * 題幹會先經過 numberBlanks() 把空格標成 ___(1)___、___(2)___，這裡的 (1)(2) 對應同一格。
 * 受控元件：value 是每格目前的作答（依空格順序），送出前由 QuizTaker 合併成單一字串。
 */
type Props = {
  count: number;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
};

export function FillBlankInputs({ count, value, onChange }: Props) {
  const values = Array.from({ length: count }, (_, i) => value?.[i] ?? '');

  const handleChange = (index: number, text: string) => {
    const next = [...values];
    next[index] = text;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500">
        本題有
        {' '}
        {count}
        {' '}
        個空格，請依序填入
      </p>
      {values.map((text, i) => (
        // eslint-disable-next-line react/no-array-index-key -- 空格順序固定，index 即穩定 key
        <label key={i} className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-sm font-medium text-gray-600">{`(${i + 1})`}</span>
          <input
            type="text"
            value={text}
            onChange={e => handleChange(i, e.target.value)}
            aria-label={`第 ${i + 1} 格`}
            placeholder={`第 ${i + 1} 格答案`}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-xl border-2 border-gray-100 bg-gray-50/50 px-4 py-2.5 text-base text-gray-800 placeholder:text-gray-400 focus:border-emerald-400 focus:bg-white focus:outline-none"
          />
        </label>
      ))}
    </div>
  );
}
