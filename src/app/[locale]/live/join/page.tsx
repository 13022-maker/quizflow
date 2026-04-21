import { LivePlayerJoin } from '@/features/live/LivePlayerJoin';

export const metadata = {
  title: '加入直播測驗 | QuizFlow',
};

export default function LiveJoinPage({
  searchParams,
}: {
  searchParams: { pin?: string };
}) {
  const pin = (searchParams.pin ?? '').trim().toUpperCase().slice(0, 6);
  return <LivePlayerJoin initialPin={pin} />;
}
