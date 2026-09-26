import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { reviewPlayerSchema } from '@/models/Schema';
import { publishTick } from '@/services/review/ablyServer';
import { findGameByPin, isNicknameTaken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const BodySchema = z.object({
  pin: z.string().trim().toUpperCase().length(6, '房間碼需 6 碼'),
  nickname: z.string().trim().min(1, '請輸入暱稱').max(30, '暱稱最多 30 字'),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '資料格式錯誤' }, { status: 400 });
  }

  const game = await findGameByPin(parsed.data.pin);
  if (!game) {
    return NextResponse.json({ error: '找不到這個活動，請確認房間碼' }, { status: 404 });
  }
  if (game.status !== 'lobby') {
    return NextResponse.json({ error: '活動已開始，請等待老師開新場次' }, { status: 403 });
  }

  if (await isNicknameTaken(game.id, parsed.data.nickname)) {
    return NextResponse.json({ error: '這個暱稱已被使用' }, { status: 409 });
  }

  const playerToken = nanoid(32);
  try {
    const [inserted] = await db
      .insert(reviewPlayerSchema)
      .values({ gameId: game.id, nickname: parsed.data.nickname, playerToken })
      .returning();
    if (!inserted) {
      return NextResponse.json({ error: '加入失敗，請重試' }, { status: 500 });
    }

    await publishTick(game.id);

    return NextResponse.json({ gameId: game.id, playerId: inserted.id, playerToken });
  } catch {
    return NextResponse.json({ error: '這個暱稱已被使用' }, { status: 409 });
  }
}
