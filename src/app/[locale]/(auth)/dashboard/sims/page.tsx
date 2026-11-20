import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';

import { TitleBar } from '@/features/dashboard/TitleBar';
import { listSimPractices } from '@/libs/sim/dao';
import type { SimMode } from '@/libs/sim/types';

import { CopyLinkButton } from '../adaptive/CopyLinkButton';
import { ShareClassroomButton } from '../adaptive/ShareClassroomButton';
import { CreateSimForm } from './CreateSimForm';
import { SIM_MODE_BADGE, simStudentPath } from './simPaths';

export const dynamic = 'force-dynamic';

function formatDate(d: Date) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 實作模擬 — 清單＋建立
 * 電腦硬體裝修丙級 15 題實作模擬：建立後把連結發給學生（免登入），點進去看班級儀表板。
 */
export default async function SimListPage({ params }: { params: { locale: string } }) {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const practices = await listSimPractices(userId);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <TitleBar
        title="🛠️ 實作模擬"
        description="電腦硬體裝修丙級 15 題實作模擬（Windows／Linux 操作情境）——建立後把連結發給學生，免登入即可作答，成績自動回傳班級儀表板。"
      />

      <details className="group mb-8 rounded-xl border bg-card p-5 shadow-sm" open={practices.length === 0}>
        <summary className="cursor-pointer list-none text-sm font-semibold marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block transition-transform group-open:rotate-90">▶</span>
            ＋ 建立實作模擬
          </span>
        </summary>
        <CreateSimForm />
      </details>

      {practices.length > 0
        ? (
            <div className="mb-8 grid gap-4 sm:grid-cols-2">
              {practices.map((p) => {
                const badge = SIM_MODE_BADGE[p.mode as SimMode] ?? SIM_MODE_BADGE.practice;
                const path = simStudentPath(params.locale, p.accessCode);
                return (
                  <div key={p.id} className="group rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md">
                    <Link href={`/dashboard/sims/${p.id}`} className="block border-l-[3px] border-primary/70 pl-3">
                      <span className="text-lg font-bold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
                        {p.title}
                      </span>
                    </Link>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span
                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          p.studentCount > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-500'
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${p.studentCount > 0 ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                        {p.studentCount}
                        {' 位學生'}
                      </span>
                      {p.timeLimitMin && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                          {`⏱ ${p.timeLimitMin} 分`}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDate(p.createdAt)}
                        {' 建立'}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
                      <CopyLinkButton path={path} />
                      <ShareClassroomButton path={path} title={p.title} />
                      <Link
                        href={`/dashboard/sims/${p.id}`}
                        className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                      >
                        班級儀表板 →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        : (
            <div className="mb-8 rounded-xl border-2 border-dashed px-6 py-12 text-center text-muted-foreground">
              <div className="mb-3 text-4xl">🛠️</div>
              <p className="mb-2 text-sm font-semibold text-foreground">還沒有實作模擬</p>
              <ol className="mx-auto max-w-md list-decimal space-y-1 pl-5 text-left text-sm">
                <li>用上面的表單建立：選「練習」（有步驟教學）或「測驗」（無解答、交卷）。</li>
                <li>有指定監評內容（VM 記憶體、IP 方式、字型…）就在「進階」修改，沒改則用表 A。</li>
                <li>把學生連結貼到 Classroom／LINE，學生輸入姓名、學號、崗位號碼即可開始。</li>
                <li>學生作答時，班級儀表板每 10 秒自動更新每題通過狀況。</li>
              </ol>
            </div>
          )}
    </div>
  );
}
