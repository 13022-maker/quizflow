import Link from 'next/link';

import { NewSubjectForm } from './NewSubjectForm';

export const dynamic = 'force-dynamic';

/** AI 生成學科 — 老師輸入單元主題（可選附教材），Claude 生成知識圖譜＋題庫 */
export default function NewSubjectPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold">✨ AI 生成學科</h1>
        <Link href="/dashboard/adaptive" className="text-sm text-muted-foreground hover:underline">
          ← 回適性學習
        </Link>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        輸入單元主題，AI 會自動規劃 3～5 個知識點（含前置依賴）與每點 5～8 題單選題。
        生成後可直接用來建立練習。
      </p>
      <NewSubjectForm />
    </div>
  );
}
