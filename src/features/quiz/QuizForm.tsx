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

const TEMPLATE_GROUPS = [
  {
    label: '考試測驗',
    items: [
      { label: '📝 隨堂測驗', title: '隨堂測驗' },
      { label: '📋 期中考', title: '期中考' },
      { label: '🔄 複習小考', title: '複習小考' },
    ],
  },
  {
    label: '自學練習',
    items: [
      { label: '🎯 自學挑戰', title: '自學挑戰' },
      { label: '📖 課前預習', title: '課前預習' },
      { label: '💡 知識檢測', title: '知識檢測' },
      { label: '🔤 單字記憶', title: '單字記憶', description: '請輸入要記憶的單字清單，AI 會根據單字生成填空、選擇、配對等記憶練習題' },
    ],
  },
];

export function QuizForm() {
  const t = useTranslations('AddQuiz');
  const [isPending, startTransition] = useTransition();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

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

  const handleTemplateClick = (tmpl: { title: string; description?: string }) => {
    setSelectedTemplate(tmpl.title);
    form.setValue('title', tmpl.title);
    if (tmpl.description) {
      form.setValue('description', tmpl.description);
    }
  };

  return (
    <div className="space-y-6">
      {/* 快速範本 */}
      <div className="space-y-4">
        {TEMPLATE_GROUPS.map(group => (
          <div key={group.label}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
            <div className="flex flex-wrap gap-2">
              {group.items.map(tmpl => (
                <button
                  key={tmpl.title}
                  type="button"
                  onClick={() => handleTemplateClick(tmpl)}
                  className={`rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                    selectedTemplate === tmpl.title
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-transparent bg-muted/60 text-foreground hover:border-muted-foreground/20'
                  }`}
                >
                  {tmpl.label}
                </button>
              ))}
            </div>
          </div>
        ))}
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
              建立後會進入出題頁面，你可以<strong>手動出題</strong>或使用 <strong>AI 智慧出題</strong>。不只考試，也適合學生自學、課前預習。標題和設定隨時都能修改。
            </p>
          </div>
        </form>
      </Form>
    </div>
  );
}
