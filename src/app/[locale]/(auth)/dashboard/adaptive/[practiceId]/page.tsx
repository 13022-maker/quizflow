import { auth } from '@clerk/nextjs/server';
import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { KnowledgeDiagnosis } from '@/libs/adaptive/engine';
import { getAdaptiveService } from '@/libs/adaptive/service';
import { db } from '@/libs/DB';
import { adaptiveEventSchema, adaptivePracticeSchema } from '@/models/Schema';

import { AutoRefresh } from '../AutoRefresh';
import { CopyLinkButton } from '../CopyLinkButton';
import { DeletePracticeButton } from './DeleteButton';

export const dynamic = 'force-dynamic';

/** 事件類型 → 圖示與中文標籤（時間軸） */
const EVENT_META: Record<string, { icon: string; label: string }> = {
  remedial_lesson_dispatched: { icon: '📖', label: '觸發補強課文' },
  annotation_added: { icon: '✏️', label: '劃線提問' },
  lesson_completed: { icon: '✅', label: '讀完課文' },
  knowledge_mastered: { icon: '🏆', label: '達成精熟' },
  course_completed: { icon: '🎓', label: '完成課程' },
};

const STATUS_META = {
  mastered: { label: '✅ 已精熟', bar: 'bg-green-500' },
  learning: { label: '📖 學習中', bar: 'bg-blue-500' },
  locked: { label: '🔒 鎖定中', bar: 'bg-gray-400' },
} as const;

/**
 * 適性練習 — 班級儀表板
 * 全班 × 知識點精熟度總覽（重用引擎的診斷邏輯）＋學習日誌時間軸，10 秒自動刷新。
 */
export default async function AdaptiveBoardPage({
  params,
}: {
  params: { practiceId: string };
}) {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const practiceId = Number(params.practiceId);
  if (!Number.isInteger(practiceId)) {
    notFound();
  }

  // 只能看自己的練習
  const [practice] = await db
    .select()
    .from(adaptivePracticeSchema)
    .where(
      and(
        eq(adaptivePracticeSchema.id, practiceId),
        eq(adaptivePracticeSchema.ownerId, userId),
      ),
    );
  if (!practice) {
    notFound();
  }

  const service = await getAdaptiveService(practice.id, practice.subjectId);

  // 全班診斷：引擎的 mastered / learning / locked 判定逐生計算
  const states = await service.repo.list();
  const names = await service.repo.getDisplayNames();
  const students: { studentKey: string; displayName: string; diagnosis: KnowledgeDiagnosis[] }[]
    = await Promise.all(
      states.map(async s => ({
        studentKey: s.studentId,
        displayName: names.get(s.studentId) ?? s.studentId,
        diagnosis: await service.engine.getDiagnosis(s.studentId),
      })),
    );

  // 學習日誌時間軸（最新在前）
  const events = await db
    .select()
    .from(adaptiveEventSchema)
    .where(eq(adaptiveEventSchema.practiceId, practice.id))
    .orderBy(desc(adaptiveEventSchema.createdAt))
    .limit(50);
  const knowledgeNames = new Map(service.subject.graph.nodes.map(n => [n.id, n.name]));

  // 知識點欄位以第一位學生的診斷排序為準（引擎回傳已按學習路徑排序）
  const knowledgeColumns = students[0]?.diagnosis ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <AutoRefresh />

      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">
          📊
          {' '}
          {practice.title}
        </h1>
        <div className="flex items-center gap-2">
          <CopyLinkButton path={`/adaptive/${practice.accessCode}`} />
          <DeletePracticeButton id={practice.id} />
        </div>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {service.subject.name}
        {' · 學生連結：'}
        <code className="rounded bg-muted px-1.5 py-0.5">{`/adaptive/${practice.accessCode}`}</code>
        {' · 每 10 秒自動刷新'}
        {' · '}
        <Link href="/dashboard/adaptive" className="hover:underline">← 回練習清單</Link>
      </p>

      {students.length === 0
        ? (
            <div className="rounded-lg border p-6 text-sm text-muted-foreground">
              還沒有學生加入——把上面的學生連結發給班上，輸入姓名＋學號即可開始。
            </div>
          )
        : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">學生</th>
                    {knowledgeColumns.map(k => (
                      <th key={k.knowledgeId} className="px-4 py-2 font-medium">{k.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map(s => (
                    <tr key={s.studentKey} className="border-t">
                      <td className="px-4 py-3">
                        <span className="font-medium">{s.displayName}</span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          （
                          {s.studentKey}
                          ）
                        </span>
                      </td>
                      {s.diagnosis.map((d) => {
                        const meta = STATUS_META[d.status];
                        return (
                          <td key={d.knowledgeId} className="px-4 py-3">
                            <div className="text-xs">
                              {meta.label}
                              {' '}
                              {(d.mastery * 100).toFixed(0)}
                              %
                            </div>
                            <div className="my-1.5 h-1.5 w-24 overflow-hidden rounded bg-muted">
                              <div
                                className={`h-full ${meta.bar}`}
                                style={{ width: `${Math.round(d.mastery * 100)}%` }}
                              />
                            </div>
                            <div className="text-xs text-muted-foreground">
                              作答
                              {' '}
                              {d.attempts}
                              {' '}
                              次
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      {/* 學習日誌時間軸 */}
      <h2 className="mb-2 mt-8 font-semibold">🕐 學習日誌時間軸</h2>
      {events.length === 0
        ? <p className="text-sm text-muted-foreground">尚無學習事件。</p>
        : (
            <div className="rounded-lg border px-4 py-1">
              {events.map((e) => {
                const meta = EVENT_META[e.eventType] ?? { icon: '📌', label: e.eventType };
                return (
                  <div key={e.id} className="flex items-baseline gap-2.5 border-b py-2 text-sm last:border-b-0">
                    <span className="w-36 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {e.createdAt.toLocaleString('zh-TW', { hour12: false })}
                    </span>
                    <span className="shrink-0">{meta.icon}</span>
                    <span>
                      <span className="font-medium">{e.displayName}</span>
                      {' '}
                      {meta.label}
                      {e.knowledgeId && (
                        <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs">
                          {knowledgeNames.get(e.knowledgeId) ?? e.knowledgeId}
                        </span>
                      )}
                      {e.detail && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{e.detail}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
    </div>
  );
}
