'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect, useId, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';

export const QUESTION_TYPE_LABELS = {
  single_choice: '單選題',
  multiple_choice: '多選題',
  true_false: '是非題',
  short_answer: '簡答題',
  ranking: '排序題',
} as const;

const TRUE_FALSE_OPTIONS = [
  { id: 'tf-true', text: '正確' },
  { id: 'tf-false', text: '錯誤' },
];

const QuestionSchema = z.object({
  type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'ranking']),
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
  quizId: number; // 圖片上傳需指定所屬測驗
};

export function QuestionForm({ defaultValues, onSubmit, onCancel, isPending, quizId }: Props) {
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

  // 圖片上傳（本地檔案 → Vercel Blob）
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    setUploadError('');
    if (!file.type.startsWith('image/')) {
      setUploadError('請選擇圖片檔');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('檔案超過 5 MB');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/upload/quiz-image/${quizId}`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? '上傳失敗');
      }
      form.setValue('imageUrl', data.url, { shouldDirty: true });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上傳失敗');
    } finally {
      setUploading(false);
      // 清空 input 以便重複選同一檔案
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 切換題型時重設選項
  useEffect(() => {
    if (type === 'true_false') {
      replace(TRUE_FALSE_OPTIONS);
      form.setValue('correctAnswers', []);
    } else if (type === 'short_answer') {
      replace([]);
      form.setValue('correctAnswers', []);
    } else if (type === 'ranking') {
      // 排序題：至少 3 個選項才有意義
      const current = form.getValues('options') ?? [];
      const isTrueFalseShape = current[0]?.id === 'tf-true';
      if (current.length < 3 || isTrueFalseShape) {
        replace([
          { id: crypto.randomUUID(), text: '' },
          { id: crypto.randomUUID(), text: '' },
          { id: crypto.randomUUID(), text: '' },
        ]);
      }
      // 排序題的 correctAnswers 在 submit 時根據選項順序決定，這裡先清空
      form.setValue('correctAnswers', []);
    } else {
      // 從 true_false / short_answer / ranking 切換到一般選擇題，初始化兩個空選項
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
    // 排序題：correctAnswers 由選項輸入順序決定（從上到下即正解）
    if (data.type === 'ranking' && data.options) {
      data.correctAnswers = data.options.map(o => o.id);
    }
    await onSubmit(data);
  });

  const isChoiceType = type === 'single_choice' || type === 'multiple_choice';
  const isOrderingType = type === 'ranking';
  const allowsMultipleOptions = isChoiceType || isOrderingType;

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
          <span className="ml-1 text-xs font-normal text-muted-foreground">（選填，可上傳、貼網址或搜尋）</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            {...form.register('imageUrl')}
            placeholder="https://example.com/image.jpg"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {/* 本地上傳（hidden input + 按鈕觸發） */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="shrink-0 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            {uploading ? '上傳中…' : '📤 上傳'}
          </button>
          <button
            type="button"
            onClick={() => {
              const keyword = form.getValues('body') || '教學圖片';
              window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(keyword)}`, '_blank');
            }}
            className="shrink-0 rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            🔍 搜尋
          </button>
        </div>
        {uploadError && (
          <p className="mt-1 text-xs text-destructive">{uploadError}</p>
        )}
        {/* 圖片預覽 */}
        {form.watch('imageUrl') && (
          <div className="mt-2 flex items-center justify-center overflow-hidden rounded-lg bg-[#f5f5f5]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={form.watch('imageUrl')}
              alt="題目圖片預覽"
              className="max-h-[300px] w-full object-contain"
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = 'none';
                el.parentElement!.innerHTML = '<p class="py-6 text-sm text-muted-foreground">圖片無法載入</p>';
              }}
            />
          </div>
        )}
      </div>

      {/* 選項清單（選擇題 / 是非題 / 排序題） */}
      {type !== 'short_answer' && (
        <div>
          <label className="mb-1 block text-sm font-medium">
            選項
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              （
              {type === 'multiple_choice'
                ? '可選多個正確答案'
                : isOrderingType
                  ? '由上到下即正確順序，學生作答時順序會被打亂'
                  : '點選正確答案'}
              ）
            </span>
          </label>
          <div className="space-y-2">
            {fields.map((field, index) => {
              const isCorrect = correctAnswers.includes(field.id);
              return (
                <div key={field.id} className="flex items-center gap-2">
                  {/* 排序題：左側顯示順序編號；其他題型：正解圓鈕 */}
                  {isOrderingType
                    ? (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {index + 1}
                        </span>
                      )
                    : (
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
                      )}
                  <input
                    {...form.register(`options.${index}.text`)}
                    placeholder={`選項 ${index + 1}`}
                    disabled={type === 'true_false'}
                    className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  {allowsMultipleOptions && fields.length > (isOrderingType ? 3 : 2) && (
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
          {allowsMultipleOptions && (
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
