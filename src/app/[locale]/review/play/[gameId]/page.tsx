import { ReviewPlayRoom } from './ReviewPlayRoom';

export const metadata = {
  title: '協作批閱活動 | QuizFlow',
};

export default function ReviewPlayPage({
  params,
}: {
  params: { gameId: string; locale: string };
}) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-destructive">網址格式錯誤</p>
      </div>
    );
  }
  return <ReviewPlayRoom gameId={gameId} />;
}
