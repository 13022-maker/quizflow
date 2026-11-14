/**
 * Paddle Customer Portal API
 * 為已訂閱用戶建立 Customer Portal session，回傳網址讓用戶自助管理 / 取消訂閱、更新付款方式、下載收據
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { findPaddleCustomerId, getPaddle } from '@/libs/paddle';
import { getMissingPaddleServerEnv } from '@/libs/paddleConfig';

export const runtime = 'nodejs';

export async function POST() {
  if (getMissingPaddleServerEnv(process.env, ['PADDLE_API_KEY']).length > 0) {
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

    const customerId = await findPaddleCustomerId(userId);
    if (!customerId) {
      return NextResponse.json({ error: '找不到訂閱紀錄', code: 'NO_CUSTOMER' }, { status: 404 });
    }

    // 不指定 subscriptionIds：portal 首頁會列出該客戶全部訂閱
    const session = await getPaddle().customerPortalSessions.create(customerId, []);
    return NextResponse.json({ url: session.urls.general.overview });
  } catch (err) {
    console.error('[Portal API] FAILED', err);
    return NextResponse.json(
      { error: '無法開啟訂閱管理頁面，請稍後再試', code: 'PORTAL_FAILED' },
      { status: 500 },
    );
  }
}
