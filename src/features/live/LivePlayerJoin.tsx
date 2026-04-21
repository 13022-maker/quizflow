'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { savePlayerSession } from '@/services/live/playerSession';

type Props = {
  initialPin?: string;
};

export function LivePlayerJoin({ initialPin = '' }: Props) {
  const router = useRouter();
  const [pin, setPin] = useState(initialPin);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/live/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: pin.trim().toUpperCase(),
          nickname: nickname.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        gameId?: number;
        playerId?: number;
        playerToken?: string;
      };
      if (!res.ok || !data.gameId || !data.playerId || !data.playerToken) {
        setError(data.error ?? '加入失敗');
        return;
      }
      savePlayerSession(data.gameId, data.playerId, data.playerToken);
      router.push(`/live/play/${data.gameId}`);
    } catch {
      setError('網路錯誤，請重試');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6">
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">加入直播測驗</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            輸入 6 碼 PIN 與你的暱稱
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="pin" className="text-sm font-medium">
              遊戲 PIN
            </label>
            <Input
              id="pin"
              value={pin}
              onChange={e => setPin(e.target.value.toUpperCase())}
              maxLength={6}
              autoComplete="off"
              className="h-14 text-center font-mono text-2xl tracking-widest"
              placeholder="A1B2C3"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="nickname" className="text-sm font-medium">
              你的暱稱
            </label>
            <Input
              id="nickname"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              maxLength={30}
              placeholder="Alice"
              required
            />
          </div>
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? '加入中⋯' : '加入'}
          </Button>
        </form>
      </div>
    </div>
  );
}
