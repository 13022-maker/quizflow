import { HostReactionConsole } from '@/features/reactions/HostReactionConsole';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '課堂回饋 | QuizFlow',
};

export default function HostReactionPinPage({
  params,
}: {
  params: { pin: string };
}) {
  const pin = params.pin.toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(pin)) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm text-destructive">PIN 格式錯誤</p>
      </div>
    );
  }
  return <HostReactionConsole pin={pin} />;
}
