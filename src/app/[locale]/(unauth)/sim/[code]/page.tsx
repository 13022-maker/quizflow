import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getSimPracticeByCode } from '@/libs/sim/dao';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { code: string };
}): Promise<Metadata> {
  const practice = await getSimPracticeByCode(params.code);
  return {
    title: practice ? `${practice.title}｜實作模擬` : '實作模擬',
  };
}

/**
 * 實作模擬（hdfix3 電腦硬體裝修丙級）— 學生作答頁（免登入，分享碼進入）
 * 伺服器薄殼：以 accessCode 查練習，依模式全螢幕嵌入練習版／測驗版 HTML，
 * HTML 帶 ?code= 進入「QuizFlow 連線模式」自行讀取指定值並回報成績。
 */
export default async function SimStudentPage({
  params,
}: {
  params: { code: string };
}) {
  const practice = await getSimPracticeByCode(params.code);
  if (!practice) {
    notFound();
  }

  const file = practice.mode === 'exam' ? 'exam' : 'practice';
  const src = `/sims/hdfix3/${file}.html?code=${encodeURIComponent(practice.accessCode)}`;

  // 不加 sandbox：自家同網域靜態檔，需要 same-origin（相對路徑呼叫 /api/sim、localStorage）
  // 加上 allow-scripts 等於沒有隔離效果；clipboard-write 給「複製成績碼」用
  return (
    // eslint-disable-next-line react-dom/no-missing-iframe-sandbox
    <iframe
      src={src}
      title={practice.title}
      allow="clipboard-write"
      className="block w-full border-0"
      style={{ height: '100dvh' }}
    />
  );
}
