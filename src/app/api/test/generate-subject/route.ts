// E2E 測試專用 API：直接觸發 AI 學科生成（免 Clerk 登入），驗證生成器與資料表。
// 三重安全閘同 seed-quiz（production 永遠 404、需顯式開啟、拒絕外部 DB）。
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { generateSubject, toSubject } from '@/libs/adaptive/generate-subject';
import { db } from '@/libs/DB';
import { adaptiveSubjectSchema } from '@/models/Schema';

export const runtime = 'nodejs';
export const maxDuration = 300; // 生成約需 1~3 分鐘

const bodySchema = z.object({
  topic: z.string().min(2).max(100),
  material: z.string().max(20000).optional(),
});

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Refusing against external DATABASE_URL' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const generated = await generateSubject(parsed.data.topic, parsed.data.material);
  const { subject } = toSubject(generated, 'pending');

  const [row] = await db
    .insert(adaptiveSubjectSchema)
    .values({
      ownerId: 'e2e-test-teacher',
      name: generated.name,
      sourceTopic: parsed.data.topic,
      graph: subject.graph,
      itemBank: subject.itemBank,
      tutor: subject.tutor,
    })
    .returning();

  return NextResponse.json({
    subjectId: `db:${row!.id}`,
    name: generated.name,
    knowledgePoints: subject.graph.nodes.map(n => ({ id: n.id, name: n.name, prerequisites: n.prerequisites })),
    itemCount: subject.itemBank.items.length,
  });
}
