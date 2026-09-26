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
  // 透過分享連結（QR Code / 房間連結）帶完整 6 碼 PIN 進來時，不用再讓學生看到/確認 PIN
  const pinLocked = pin.length === 6;
  return <LivePlayerJoin initialPin={pin} pinLocked={pinLocked} />;
}
