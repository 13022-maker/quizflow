import Link from 'next/link';

import type { QuizTemplate } from '@/data/templates';

const subjectColor: Record<string, string> = {
  國文: 'bg-rose-100 text-rose-700',
  英語: 'bg-blue-100 text-blue-700',
  數學: 'bg-violet-100 text-violet-700',
  自然: 'bg-emerald-100 text-emerald-700',
  社會: 'bg-amber-100 text-amber-700',
};

export function TemplateCard({ template }: { template: QuizTemplate }) {
  const color = subjectColor[template.subject] ?? 'bg-muted text-muted-foreground';
  return (
    <Link
      href={`/templates/${template.slug}`}
      className="group flex h-full flex-col rounded-2xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${color}`}>
          {template.subject}
        </span>
        <span className="text-muted-foreground">· {template.gradeLevel}</span>
      </div>
      <h2 className="mt-3 text-base font-bold tracking-tight text-foreground group-hover:text-primary">
        {template.title}
      </h2>
      <p className="mt-2 line-clamp-2 flex-1 text-sm text-foreground/70">
        {template.description}
      </p>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {template.questions.length}
          {' '}
          題 ·
          {' '}
          {template.estimatedMinutes}
          {' '}
          分鐘
        </span>
        <span className="font-medium text-primary">查看範本 →</span>
      </div>
    </Link>
  );
}
