'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
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

export function QuizForm() {
  const t = useTranslations('AddQuiz');
  const [isPending, startTransition] = useTransition();

  const form = useForm<QuizFormValues>({
    resolver: zodResolver(QuizSchema),
    defaultValues: { title: '', description: '' },
  });

  const onSubmit = (data: QuizFormValues) => {
    startTransition(async () => {
      const result = await createQuiz(data);
      if (result?.error) {
        // QUOTA_EXCEEDED：免費方案已達測驗上限，引導升級
        if (result.error === 'QUOTA_EXCEEDED') {
          window.location.href = '/dashboard/billing';
          return;
        }
        form.setError('title', { message: result.error });
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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

        <div className="flex gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? '建立中…' : t('submit_button')}
          </Button>
          <Link
            href="/dashboard/quizzes"
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('cancel_button')}
          </Link>
        </div>
      </form>
    </Form>
  );
}
