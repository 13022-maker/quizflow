/**
 * Paddle Checkout 初始化 API
 * 前端呼叫此 API 取得 Paddle 客戶 ID，再用 Paddle.js 開啟 checkout overlay
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { getOrCreatePaddleCustomer } from '@/libs/paddle';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const user = await currentUser();
  const { priceId } = await req.json();

  if (!priceId) {
    return NextResponse.json({ error: '缺少 priceId' }, { status: 400 });
  }

  const email = user?.emailAddresses?.[0]?.emailAddress;
  if (!email) {
    return NextResponse.json({ error: '找不到用戶 email' }, { status: 400 });
  }

  const paddleCustomerId = await getOrCreatePaddleCustomer({
    clerkUserId: userId,
    email,
    name: user.fullName ?? undefined,
  });

  return NextResponse.json({
    customerId: paddleCustomerId,
    priceId,
  });
}
