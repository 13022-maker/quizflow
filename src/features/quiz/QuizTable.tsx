'use client';

import type { InferSelectModel } from 'drizzle-orm';

import { DataTable } from '@/components/ui/data-table';
import type { quizSchema } from '@/models/Schema';

import { useQuizColumns } from './QuizTableColumns';

type Quiz = InferSelectModel<typeof quizSchema>;

export function QuizTable({ quizzes }: { quizzes: Quiz[] }) {
  const columns = useQuizColumns();
  return <DataTable columns={columns} data={quizzes} />;
}
