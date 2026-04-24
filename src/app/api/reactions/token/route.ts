// 課堂 Emoji 回饋 Ably token 發行
// host：需 Clerk 登入（防匿名用戶當老師）
// student：完全公開（學生不用登入）
// 兩種角色都拿到 publish + subscribe 權限到 reactions:{PIN} channel
// （單向 broadcast 也 OK，但允許 publish 讓未來功能擴充更彈性）
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createTokenRequest, isAblyEnabled } from '@/services/live/ablyServer';
import { reactionChannelName } from '@/services/reactions/types';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  role: z.enum(['host', 'student']),
  pin: z.string().regex(/^[A-Z0-9]{6}$/i, 'PIN 必須為 6 碼英數'),
});

async function handle(request: Request) {
  if (!isAblyEnabled()) {
    return NextResponse.json(
      { error: 'Ably 未啟用（ABLY_API_KEY 未設定）' },
      { status: 503 },
    );
  }

  // 接受 GET query 或 POST body / query（Ably authMethod=POST 時 query string）
  const url = new URL(request.url);
  let params: Record<string, string> = Object.fromEntries(url.searchParams.entries());
  if (Object.keys(params).length === 0 && request.method === 'POST') {
    try {
      const body = await request.json();
      if (body && typeof body === 'object') {
        params = body as Record<string, string>;
      }
    } catch {
      // 沒 body 也 OK
    }
  }

  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? '參數錯誤' },
      { status: 400 },
    );
  }

  const { role, pin } = parsed.data;
  const channelName = reactionChannelName(pin);

  // Host：要 Clerk 驗證
  if (role === 'host') {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }
    const tokenRequest = await createTokenRequest({
      clientId: `reactions-host:${orgId}:${pin}`,
      capability: { [channelName]: ['publish', 'subscribe'] },
      ttlMs: 4 * 60 * 60 * 1000, // 4 小時，撐一堂課
    });
    return NextResponse.json(tokenRequest);
  }

  // Student：無驗證（匿名）
  const tokenRequest = await createTokenRequest({
    clientId: `reactions-student:${pin}:${Math.random().toString(36).slice(2, 10)}`,
    capability: { [channelName]: ['publish', 'subscribe'] },
    ttlMs: 4 * 60 * 60 * 1000,
  });
  return NextResponse.json(tokenRequest);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
