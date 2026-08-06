'use client';

/**
 * ClozeQuestion — 學生作答克漏字題（cloze）用的元件。
 * 依 body 的 [[ ]] 標記位置，把文章渲染成「文字 + 空格輸入框」交錯排列。
 * 受控元件：value 是每個空格目前的作答，依文章順序排列。
 *
 * 即時對錯回饋（框線變綠/變紅）：欄位失焦過（touched）後就即時判斷該格對錯，
 * 未 touched 或空白時維持中性樣式，不主動顯示正確答案文字（只用顏色，不講白）。
 * 這是刻意的產品決策：question.correctAnswers 本來就已經整份送到瀏覽器（跟其他
 * 6 種題型一樣，QuizTaker.tsx 的 gradeAnswer() 家教模式也讀得到），所以逐格判斷
 * 對錯不是新的外洩管道，只是把既有資料用 UI 呈現——但這也讓克漏字題變成
 * QuizFlow 目前唯一一個作答中就會即時揭露對錯的題型，跟其他題型的考試慣例不同。
 */
import { useState } from 'react';

import { gradeClozeAnswers, parseClozeBody } from '@/lib/cloze';

type Props = {
  body: string;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
  correctAnswers: string[] | null; // question.correctAnswers，用來即時逐格判斷對錯
};

export function ClozeQuestion({ body, value, onChange, correctAnswers }: Props) {
  const segments = parseClozeBody(body);
  const totalBlanks = segments.filter(s => s.kind === 'blank').length;
  // 已經失焦檢查過的空格 index；未 touched 前維持中性樣式，不會一開始就顯示紅色
  const [touched, setTouched] = useState<Set<number>>(new Set());

  const { perBlank } = gradeClozeAnswers(correctAnswers ?? [], value);
  const correctCount = perBlank.filter(Boolean).length;

  const handleBlankChange = (index: number, text: string) => {
    const next = [...(value ?? Array.from({ length: totalBlanks }, () => ''))];
    next[index] = text;
    onChange(next);
  };

  const handleBlankBlur = (index: number) => {
    setTouched(prev => new Set(prev).add(index));
  };

  return (
    <div>
      <p className="text-base leading-loose text-gray-800">
        {segments.map(seg => seg.kind === 'text'
          ? <span key={`t-${seg.text}-${segments.indexOf(seg)}`}>{seg.text}</span>
          : (() => {
              const filled = (value?.[seg.index] ?? '').trim() !== '';
              const isTouched = touched.has(seg.index);
              const isCorrect = perBlank[seg.index] === true;
              const stateClass = !isTouched
                ? 'border-gray-200 bg-gray-50/50 focus:border-emerald-400 focus:bg-white'
                : isCorrect
                  ? 'border-emerald-500 bg-emerald-50'
                  : filled
                    ? 'border-red-400 bg-red-50'
                    : 'border-red-300 bg-red-50/60'; // touched 但還是空白：提示還沒填
              return (
                <input
                  key={`b-${seg.index}`}
                  type="text"
                  aria-label={`空格 ${seg.index + 1}`}
                  value={value?.[seg.index] ?? ''}
                  onChange={e => handleBlankChange(seg.index, e.target.value)}
                  onBlur={() => handleBlankBlur(seg.index)}
                  className={`mx-1 inline-block w-24 rounded-md border-2 px-2 py-0.5 text-center text-base outline-none transition-colors ${stateClass}`}
                />
              );
            })())}
      </p>
      {totalBlanks > 0 && touched.size > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          答對
          {' '}
          {correctCount}
          {' / '}
          {totalBlanks}
          {' '}
          空格
        </p>
      )}
    </div>
  );
}
