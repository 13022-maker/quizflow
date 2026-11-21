import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getSimPracticeForOwner, listSubmissions } from '@/libs/sim/dao';
import { summarizeClass } from '@/libs/sim/result';
import type { SimMode } from '@/libs/sim/types';

import { AutoRefresh } from '../../adaptive/AutoRefresh';
import { CopyLinkButton } from '../../adaptive/CopyLinkButton';
import { ShareClassroomButton } from '../../adaptive/ShareClassroomButton';
import { type BoardSubmission, groupByStudent } from '../simBoardData';
import { SIM_MODE_BADGE, simStudentPath } from '../simPaths';
import { DeleteSimButton } from './DeleteSimButton';
import { ImportCodesForm } from './ImportCodesForm';
import { SimBoard } from './SimBoard';
import { SimCsvButton } from './SimCsvButton';
import { SimQrButton } from './SimQrButton';

export const dynamic = 'force-dynamic';

/**
 * 實作模擬 — 班級儀表板（每 10 秒自動刷新）
 * exam：每位學生顯示最新一次交卷；practice：顯示即時進度（標「進行中」）。
 */
export default async function SimBoardPage({ params }: { params: { locale: string; id: string } }) {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const practice = await getSimPracticeForOwner(Number(params.id), userId);
  if (!practice) {
    notFound();
  }

  const mode = (practice.mode === 'exam' ? 'exam' : 'practice') as SimMode;
  const groups = await listSubmissions(practice.id);
  // 攤平成可序列化的紀錄（Date → ISO）再分組，排序與「最新一筆」判定由 simBoardData 統一處理
  const rows: BoardSubmission[] = groups.flatMap(g => g.history.map(h => ({
    id: h.id,
    studentKey: h.studentKey,
    displayName: h.displayName,
    seat: h.seat,
    attemptNo: h.attemptNo,
    isFinal: h.isFinal,
    startedAt: h.startedAt.toISOString(),
    submittedAt: h.submittedAt.toISOString(),
    durationSec: h.durationSec,
    score: h.score,
    items: h.items,
  })));
  const students = groupByStudent(rows);
  const summary = summarizeClass(students.map(s => s.latest));

  const path = simStudentPath(params.locale, practice.accessCode);
  const badge = SIM_MODE_BADGE[mode];
  const specCount = practice.spec ? Object.keys(practice.spec).length : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <AutoRefresh />

      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
          <span>{`📊 ${practice.title}`}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <CopyLinkButton path={path} />
          <SimQrButton path={path} title={practice.title} />
          <ShareClassroomButton path={path} title={practice.title} />
          <SimCsvButton students={students} title={practice.title} />
          <DeleteSimButton id={practice.id} />
        </div>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        電腦硬體裝修丙級 15 題 · 學生連結：
        <code className="rounded bg-muted px-1.5 py-0.5">{path}</code>
        {practice.timeLimitMin ? ` · 限時 ${practice.timeLimitMin} 分` : ' · 不限時'}
        {specCount > 0 ? ` · 監評指定內容已修改 ${specCount} 項` : ' · 監評內容：表 A'}
        {' · 每 10 秒自動刷新 · '}
        <Link href="/dashboard/sims" className="hover:underline">← 回清單</Link>
      </p>

      {students.length === 0
        ? (
            <div className="mb-6 rounded-xl border-2 border-dashed py-12 text-center">
              <div className="mb-3 text-4xl">👥</div>
              <p className="mb-1.5 text-sm font-semibold">
                {mode === 'exam' ? '還沒有學生交卷' : '還沒有學生開始作答'}
              </p>
              <p className="mx-auto mb-5 max-w-md text-sm text-muted-foreground">
                {mode === 'exam'
                  ? '學生交卷後，這裡會顯示班級統計、15 題通過率與學生×題目矩陣。學生若在沒網路的電腦作答，可請他交出 HDFIX3: 成績碼，用下方「匯入離線成績碼」補登。'
                  : '學生每通過一題就會即時回傳進度，這裡會顯示每人每題的通過狀況（✅／❌／—）與作答次數。'}
              </p>
              <div className="flex justify-center gap-2">
                <CopyLinkButton path={path} />
                <SimQrButton path={path} title={practice.title} />
              </div>
            </div>
          )
        : <SimBoard mode={mode} students={students} summary={summary} />}

      <div className="mt-6">
        <ImportCodesForm practiceId={practice.id} />
      </div>
    </div>
  );
}
