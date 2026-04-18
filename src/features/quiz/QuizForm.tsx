'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { createQuiz } from '@/actions/quizActions';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/buttonVariants';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const QuizSchema = z.object({
  title: z.string().min(1, '請輸入測驗標題').max(200),
  description: z.string().max(500).optional(),
});

type QuizFormValues = z.infer<typeof QuizSchema>;

const QUICK_TEMPLATES = [
  { label: '📝 隨堂測驗', title: '隨堂測驗', desc: '' },
  { label: '📋 期中考', title: '期中考', desc: '' },
  { label: '✏️ 課後練習', title: '課後練習', desc: '' },
  { label: '🔄 複習小考', title: '複習小考', desc: '' },
];

export function QuizForm() {
  const t = useTranslations('AddQuiz');
  const [isPending, startTransition] = useTransition();
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);

  const form = useForm<QuizFormValues>({
    resolver: zodResolver(QuizSchema),
    defaultValues: { title: '', description: '' },
  });

  const onSubmit = (data: QuizFormValues) => {
    startTransition(async () => {
      const result = await createQuiz(data);
      if (result?.error) {
        if (result.error === 'QUOTA_EXCEEDED') {
          window.location.href = '/dashboard/billing';
          return;
        }
        form.setError('title', { message: result.error });
      }
    });
  };

  const handleTemplateClick = (index: number) => {
    const tmpl = QUICK_TEMPLATES[index]!;
    setSelectedTemplate(index);
    form.setValue('title', tmpl.title);
    if (tmpl.desc) {
      form.setValue('description', tmpl.desc);
    }
  };

  return (
    <div className="space-y-6">
      {/* 快速範本 */}
      <div>
        <p className="mb-2.5 text-sm font-medium text-muted-foreground">快速開始 — 點一下自動填入標題</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_TEMPLATES.map((tmpl, i) => (
            <button
              key={tmpl.title}
              type="button"
              onClick={() => handleTemplateClick(i)}
              className={`rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                selectedTemplate === i
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-transparent bg-muted/60 text-foreground hover:border-muted-foreground/20'
              }`}
            >
              {tmpl.label}
            </button>
          ))}
        </div>
      </div>

      {/* 分隔線 */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">或自行輸入</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* 表單 */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('title_label')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('title_placeholder')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('description_label')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('description_placeholder')} {...field} />
                </FormControl>
                <FormDescription>{t('description_hint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isPending} size="lg">
              {isPending ? '建立中…' : t('submit_button')}
            </Button>
            <Link
              href="/dashboard/quizzes"
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('cancel_button')}
            </Link>
          </div>

          {/* 下一步提示 */}
          <div className="flex items-start gap-2.5 rounded-lg bg-blue-50 px-4 py-3">
            <svg className="mt-0.5 size-4 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs leading-relaxed text-blue-700">
              建立後會進入出題頁面，你可以<strong>手動出題</strong>或使用 <strong>AI 智慧出題</strong>。標題和設定隨時都能修改，不用擔心填錯。
            </p>
          </div>
        </form>
      </Form>
    </div>
  );
}
