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
  return <ReviewPlayerJoin initialPin={pin} />;
}
