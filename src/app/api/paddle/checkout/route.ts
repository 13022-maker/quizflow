/**
 * Paddle Checkout 初始化 API
 * 前端呼叫此 API 取得 Paddle 客戶 ID，再用 Paddle.js 開啟 checkout overlay
 *
 * 防呆：
 * - PADDLE_API_KEY 未設 → 503 PADDLE_NOT_CONFIGURED（前端顯示「即將開放」）
 * - priceId 只接受 env 設定的方案 price → 否則 400 INVALID_PRICE
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { getOrCreatePaddleCustomer } from '@/libs/paddle';
import { getMissingPaddleServerEnv, isAllowedPriceId, readPaddlePublicEnv } from '@/libs/paddleConfig';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const missing = getMissingPaddleServerEnv(process.env, ['PADDLE_API_KEY']);
  if (missing.length > 0) {
    console.error('[Checkout API] Paddle 尚未設定，缺少 env：', missing.join(', '));
    return NextResponse.json(
      { error: '付款功能即將開放，請稍後再試', code: 'PADDLE_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: '未登入', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const priceId: unknown = body?.priceId;

    if (!isAllowedPriceId(priceId, readPaddlePublicEnv().priceIds)) {
      return NextResponse.json({ error: '方案不存在或尚未開放', code: 'INVALID_PRICE' }, { status: 400 });
    }

    const user = await currentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress;
    if (!email) {
      return NextResponse.json({ error: '找不到用戶 email', code: 'NO_EMAIL' }, { status: 400 });
    }

    const paddleCustomerId = await getOrCreatePaddleCustomer({
      clerkUserId: userId,
      email,
      name: user?.fullName ?? undefined,
    });

    return NextResponse.json({
      customerId: paddleCustomerId,
      priceId,
      // 前端把 clerkUserId 塞進 checkout customData，webhook 可直接對應（customer_id 反查為備援）
      clerkUserId: userId,
    });
  } catch (err) {
    // 內部錯誤細節只寫 log，不回給前端
    console.error('[Checkout API] FAILED', err);
    return NextResponse.json(
      { error: '結帳初始化失敗，請稍後再試', code: 'CHECKOUT_FAILED' },
      { status: 500 },
    );
  }
}
