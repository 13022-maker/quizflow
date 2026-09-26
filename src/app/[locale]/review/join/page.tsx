import { ReviewPlayerJoin } from '@/features/review/ReviewPlayerJoin';

export const metadata = {
  title: '加入協作批閱活動 | QuizFlow',
};

export default function ReviewJoinPage({
  searchParams,
}: {
  searchParams: { pin?: string };
}) {
  const pin = (searchParams.pin ?? '').trim().toUpperCase().slice(0, 6);
  // 透過分享連結（QR Code / 房間連結）帶完整 6 碼房間碼進來時，不用再讓學生看到/確認房間碼
  const pinLocked = pin.length === 6;
  return <ReviewPlayerJoin initialPin={pin} pinLocked={pinLocked} />;
}
