import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { db } from '@/libs/DB';
import { getSubject } from '@/libs/adaptive/subjects';
import { adaptivePracticeSchema } from '@/models/Schema';

import { AdaptiveLearnClient } from './AdaptiveLearnClient';

export const dynamic = 'force-dynamic';

/**
 * 適性學習 — 學生作答頁（免登入，分享碼進入）
 * 伺服器薄殼：以 accessCode 查練習拿標題與學科名稱，主體交給 client 元件。
 */
export default async function AdaptiveStudentPage({
  params,
}: {
  params: { code: string };
}) {
  const [practice] = await db
    .select()
    .from(adaptivePracticeSchema)
    .where(eq(adaptivePracticeSchema.accessCode, params.code));
  if (!practice) {
    notFound();
  }

  const subject = getSubject(practice.subjectId);

  return (
    <AdaptiveLearnClient
      code={params.code}
      title={practice.title}
      subjectName={subject.name}
    />
  );
}
