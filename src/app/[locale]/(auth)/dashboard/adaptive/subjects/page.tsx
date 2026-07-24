import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';

import { listMySubjectsForManagement } from '@/actions/adaptiveActions';
import { SubjectActionsMenu } from '@/components/adaptive/SubjectActionsMenu';
import { TitleBar } from '@/features/dashboard/TitleBar';

export const dynamic = 'force-dynamic';

// 建立日期顯示格式：M/D
function formatDate(d: Date) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 學科管理頁 — 重新命名／釘選／封存／刪除老師自建的適性學習學科。
 * 內建三科（C++／Python／微積分）不在這裡管理。
 */
export default async function AdaptiveSubjectsPage() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const subjects = await listMySubjectsForManagement();
  const active = subjects.filter(s => s.archivedAt === null);
  const archived = subjects.filter(s => s.archivedAt !== null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <TitleBar
        title="⚙️ 學科管理"
        description="重新命名、釘選、封存或刪除你 AI 生成的學科，避免「建立新練習」的下拉選單越長越亂。"
        action={(
          <Link href="/dashboard/adaptive" className="text-sm text-muted-foreground hover:underline">
            ← 回適性學習
          </Link>
        )}
      />

      {subjects.length === 0
        ? (
            <div className="rounded-xl border-2 border-dashed py-16 text-center text-muted-foreground">
              <div className="mb-3 text-4xl">📚</div>
              <p className="text-sm">還沒有自建學科——用「AI 生成學科」建立第一個吧。</p>
            </div>
          )
        : (
            <>
              <h2 className="mb-2 text-sm font-semibold">使用中</h2>
              {active.length === 0
                ? <p className="mb-6 text-sm text-muted-foreground">沒有使用中的學科。</p>
                : (
                    <div className="mb-8 overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left">
                          <tr>
                            <th className="px-4 py-2 font-medium">名稱</th>
                            <th className="px-4 py-2 font-medium">來源主題</th>
                            <th className="px-4 py-2 font-medium">知識點</th>
                            <th className="px-4 py-2 font-medium">題目</th>
                            <th className="px-4 py-2 font-medium">建立日期</th>
                            <th className="px-4 py-2 font-medium" />
                          </tr>
                        </thead>
                        <tbody>
                          {active.map(s => (
                            <tr key={s.id} className="border-t">
                              <td className="px-4 py-3">
                                <span className="font-medium">{s.name}</span>
                                {s.pinned && (
                                  <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                    📌 已釘選
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">{s.sourceTopic}</td>
                              <td className="px-4 py-3 text-muted-foreground">{s.knowledgeCount}</td>
                              <td className="px-4 py-3 text-muted-foreground">{s.itemCount}</td>
                              <td className="px-4 py-3 text-muted-foreground">{formatDate(s.createdAt)}</td>
                              <td className="px-4 py-3 text-right">
                                <SubjectActionsMenu subject={s} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

              {archived.length > 0 && (
                <>
                  <h2 className="mb-2 text-sm font-semibold text-muted-foreground">已封存</h2>
                  <div className="overflow-x-auto rounded-lg border opacity-70">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="px-4 py-2 font-medium">名稱</th>
                          <th className="px-4 py-2 font-medium">來源主題</th>
                          <th className="px-4 py-2 font-medium">知識點</th>
                          <th className="px-4 py-2 font-medium">題目</th>
                          <th className="px-4 py-2 font-medium">建立日期</th>
                          <th className="px-4 py-2 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {archived.map(s => (
                          <tr key={s.id} className="border-t">
                            <td className="px-4 py-3">{s.name}</td>
                            <td className="px-4 py-3 text-muted-foreground">{s.sourceTopic}</td>
                            <td className="px-4 py-3 text-muted-foreground">{s.knowledgeCount}</td>
                            <td className="px-4 py-3 text-muted-foreground">{s.itemCount}</td>
                            <td className="px-4 py-3 text-muted-foreground">{formatDate(s.createdAt)}</td>
                            <td className="px-4 py-3 text-right">
                              <SubjectActionsMenu subject={s} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
    </div>
  );
}
