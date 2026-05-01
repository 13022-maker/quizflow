// 分享 Fork 連結 preview 頁
// 對方點 https://app/quiz/{accessCode}/fork 時看到的內容:測驗標題 / 題數 / 標籤 +「複製」按鈕
// private quiz 直接擋掉(顯示提示請擁有者改 visibility)
// 未登入 / 已登入 / 已是擁有者 三態由 client component 用 ClerkProvider 偵測
// （Server Component 不呼叫 auth()，本路由不在 clerkMiddleware 覆蓋範圍）

import { count, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

import { ForkPreviewClient } from './ForkPreviewClient';

export async function generateMetadata({ params }: { params: { accessCode: string } }) {
  const [quiz] = await db
    .select({ title: quizSchema.title })
    .from(quizSchema)
    .where(eq(quizSchema.accessCode, params.accessCode))
    .limit(1);

  return { title: quiz ? `複製「${quiz.title}」 - QuizFlow` : '測驗 - QuizFlow' };
}

export default async function ForkPreviewPage({ params }: { params: { accessCode: string } }) {
  // 取 source quiz 預覽資訊（不需要 SourceQuiz 全欄位,只要 UI 顯示用的）
  const [quiz] = await db
    .select({
      id: quizSchema.id,
      ownerId: quizSchema.ownerId,
      title: quizSchema.title,
      description: quizSchema.description,
      visibility: quizSchema.visibility,
      category: quizSchema.category,
      gradeLevel: quizSchema.gradeLevel,
      tags: quizSchema.tags,
      forkCount: quizSchema.forkCount,
    })
    .from(quizSchema)
    .where(eq(quizSchema.accessCode, params.accessCode))
    .limit(1);

  if (!quiz) {
    notFound();
  }

  // private quiz 不允許走 fork 連結(對齊 Q2:可 fork = public + unlisted)
  if (quiz.visibility === 'private') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
          <p className="text-2xl">🔒</p>
          <p className="mt-3 text-lg font-semibold">無法複製此測驗</p>
          <p className="mt-2 text-sm text-muted-foreground">
            此測驗為私有,擁有者尚未開放分享連結。
            <br />
            請聯絡擁有者把可見度設為「🔗 連結」或「🌐 公開」。
          </p>
        </div>
      </div>
    );
  }

  // 題目數量(不抓內容,只顯示「N 題」)
  const [{ total = 0 } = {}] = await db
    .select({ total: count() })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quiz.id));

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50/60 via-white to-amber-50/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-xs font-medium text-muted-foreground">📋 有人想分享這份測驗給你</p>
        <h1 className="mt-2 text-xl font-bold leading-tight">{quiz.title}</h1>
        {quiz.description && (
          <p className="mt-1 text-sm text-muted-foreground">{quiz.description}</p>
        )}

        {/* 統計列：題數 / 已被複製次數 / 年級 */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-muted/50 p-2">
            <div className="text-base font-semibold">{total}</div>
            <div className="text-muted-foreground">題</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <div className="text-base font-semibold">{quiz.forkCount}</div>
            <div className="text-muted-foreground">人複製</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <div className="text-base font-semibold">
              {quiz.gradeLevel ?? '—'}
            </div>
            <div className="text-muted-foreground">{quiz.category ?? '分類'}</div>
          </div>
        </div>

        {/* 標籤 */}
        {quiz.tags && quiz.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {quiz.tags.slice(0, 6).map(tag => (
              <span
                key={tag}
                className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* 動作按鈕（client component,用 SignedIn / SignedOut 偵測登入狀態,
            self-fork 由 Server Action 拋錯顯示） */}
        <ForkPreviewClient accessCode={params.accessCode} />

        {/* 底部資訊 */}
        <p className="mt-4 text-center text-[10px] text-muted-foreground">
          複製後會以「私有草稿」形式進入你的儀表板,你可隨時編輯。
        </p>
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
