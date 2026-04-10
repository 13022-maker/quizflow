'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect, useId } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';

export const QUESTION_TYPE_LABELS = {
  single_choice: '單選題',
  multiple_choice: '多選題',
  true_false: '是非題',
  short_answer: '簡答題',
} as const;

const TRUE_FALSE_OPTIONS = [
  { id: 'tf-true', text: '正確' },
  { id: 'tf-false', text: '錯誤' },
];

const QuestionSchema = z.object({
  type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer']),
  body: z.string().min(1, '請輸入題目內容'),
  imageUrl: z.string().optional(), // 題目圖片網址
  options: z
    .array(z.object({ id: z.string(), text: z.string().min(1, '請輸入選項內容') }))
    .optional(),
  correctAnswers: z.array(z.string()).optional(),
  points: z.coerce.number().min(1).default(1),
});

export type QuestionFormValues = z.infer<typeof QuestionSchema>;

type Props = {
  defaultValues?: Partial<QuestionFormValues>;
  onSubmit: (data: QuestionFormValues) => Promise<void>;
  onCancel: () => void;
  isPending?: boolean;
};

export function QuestionForm({ defaultValues, onSubmit, onCancel, isPending }: Props) {
  // useId() 保證 server/client 渲染一致，避免 hydration mismatch
  const id1 = useId();
  const id2 = useId();

  const form = useForm<QuestionFormValues>({
    resolver: zodResolver(QuestionSchema),
    defaultValues: defaultValues
      ? { points: 1, correctAnswers: [], imageUrl: '', ...defaultValues }
      : {
          type: 'single_choice',
          body: '',
          imageUrl: '',
          options: [
            { id: id1, text: '' },
            { id: id2, text: '' },
          ],
          correctAnswers: [],
          points: 1,
        },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: 'options',
  });

  const type = form.watch('type');
  const correctAnswers = form.watch('correctAnswers') ?? [];

  // 切換題型時重設選項
  useEffect(() => {
    if (type === 'true_false') {
      replace(TRUE_FALSE_OPTIONS);
      form.setValue('correctAnswers', []);
    } else if (type === 'short_answer') {
      replace([]);
      form.setValue('correctAnswers', []);
    } else {
      // 從 true_false / short_answer 切換到選擇題時，初始化兩個空選項
      const current = form.getValues('options') ?? [];
      const isTrueFalse = current[0]?.id === 'tf-true';
      if (current.length === 0 || isTrueFalse) {
        replace([
          { id: crypto.randomUUID(), text: '' },
          { id: crypto.randomUUID(), text: '' },
        ]);
        form.setValue('correctAnswers', []);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // 切換正確答案
  const toggleCorrect = (optionId: string) => {
    if (type === 'single_choice' || type === 'true_false') {
      form.setValue('correctAnswers', [optionId]);
    } else {
      const current = form.getValues('correctAnswers') ?? [];
      form.setValue(
        'correctAnswers',
        current.includes(optionId)
          ? current.filter(id => id !== optionId)
          : [...current, optionId],
      );
    }
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    await onSubmit(data);
  });

  const isChoiceType = type === 'single_choice' || type === 'multiple_choice';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-muted/30 p-4">
      {/* 題型 + 配分 */}
      <div className="flex gap-3">
        <div className="flex-1">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="mb-1 block text-sm font-medium">題型</label>
          <select
            {...form.register('type')}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="w-20">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="mb-1 block text-sm font-medium">配分</label>
          <input
            type="number"
            min={1}
            {...form.register('points')}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
      </div>

      {/* 題目內容 */}
      <div>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="mb-1 block text-sm font-medium">題目內容</label>
        <textarea
          {...form.register('body')}
          rows={2}
          placeholder="輸入題目..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {form.formState.errors.body && (
          <p className="mt-1 text-xs text-destructive">
            {form.formState.errors.body.message}
          </p>
        )}
      </div>

      {/* 插入圖片 */}
      <div>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="mb-1 block text-sm font-medium">
          題目圖片
          <span className="ml-1 text-xs font-normal text-muted-foreground">（選填，貼上圖片網址）</span>
        </label>
        <div className="flex gap-2">
          <input
            {...form.register('imageUrl')}
            placeholder="https://example.com/image.jpg"
            className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={() => {
              const keyword = form.getValues('body') || '教學圖片';
              window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(keyword)}`, '_blank');
            }}
            className="shrink-0 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            搜尋圖片
          </button>
        </div>
        {/* 圖片預覽 */}
        {form.watch('imageUrl') && (
          <div className="mt-2 overflow-hidden rounded-md border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={form.watch('imageUrl')}
              alt="題目圖片預覽"
              className="h-[200px] w-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        )}
      </div>

      {/* 選項清單（選擇題 / 是非題） */}
      {type !== 'short_answer' && (
        <div>
          <label className="mb-1 block text-sm font-medium">
            選項
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              （
              {type === 'multiple_choice' ? '可選多個正確答案' : '點選正確答案'}
              ）
            </span>
          </label>
          <div className="space-y-2">
            {fields.map((field, index) => {
              const isCorrect = correctAnswers.includes(field.id);
              return (
                <div key={field.id} className="flex items-center gap-2">
                  {/* 正確答案按鈕 */}
                  <button
                    type="button"
                    onClick={() => toggleCorrect(field.id)}
                    className={`size-5 shrink-0 rounded-full border-2 transition-colors ${
                      isCorrect
                        ? 'border-green-500 bg-green-500'
                        : 'border-input bg-background hover:border-green-400'
                    }`}
                    title="設為正確答案"
                    aria-label={isCorrect ? '取消正確答案' : '設為正確答案'}
                  />
                  <input
                    {...form.register(`options.${index}.text`)}
                    placeholder={`選項 ${index + 1}`}
                    disabled={type === 'true_false'}
                    className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  {isChoiceType && fields.length > 2 && (
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="text-sm text-muted-foreground hover:text-destructive"
                      aria-label="刪除選項"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {isChoiceType && (
            <button
              type="button"
              onClick={() => append({ id: crypto.randomUUID(), text: '' })}
              className="mt-2 text-sm text-blue-500 hover:text-blue-600"
            >
              + 新增選項
            </button>
          )}
        </div>
      )}

      {/* 簡答題提示 */}
      {type === 'short_answer' && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          簡答題無法自動批改，需老師手動評分。
        </p>
      )}

      {/* 操作按鈕 */}
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? '儲存中…' : '儲存題目'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
