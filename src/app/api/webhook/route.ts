/**
 * Paddle Webhook Endpoint
 * 接收 Paddle 的訂閱事件通知，更新 DB 中的訂閱狀態
 */

import { EventName } from '@paddle/paddle-node-sdk';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { paddle } from '@/libs/paddle';
import { subscriptionSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// Paddle Price ID → 方案名稱對映
function resolvePlan(priceId?: string): string {
  const map: Record<string, string> = {
    [process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY ?? '']: 'pro',
    [process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY ?? '']: 'pro',
    [process.env.NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY ?? '']: 'team',
    [process.env.NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY ?? '']: 'team',
  };
  return map[priceId ?? ''] ?? 'free';
}

export async function POST(req: Request) {
  const signature = req.headers.get('paddle-signature') ?? '';
  const rawBody = await req.text();

  // 驗證 webhook 簽名
  let event;
  try {
    event = await paddle.webhooks.unmarshal(rawBody, process.env.PADDLE_WEBHOOK_SECRET!, signature);
  } catch (err) {
    console.error('[Paddle Webhook] 簽名驗證失敗', err);
    return NextResponse.json({ error: '簽名驗證失敗' }, { status: 400 });
  }

  switch (event.eventType) {
    // 訂閱建立或更新
    case EventName.SubscriptionCreated:
    case EventName.SubscriptionUpdated: {
      const sub = event.data;
      const clerkUserId = (sub.customData as Record<string, unknown>)?.clerkUserId as string;
      if (!clerkUserId) {
        break;
      }

      const plan = resolvePlan(sub.items?.[0]?.price?.id);

      // Upsert：有就更新，沒有就新增
      const [existing] = await db
        .select({ id: subscriptionSchema.id })
        .from(subscriptionSchema)
        .where(eq(subscriptionSchema.paddleSubscriptionId, sub.id))
        .limit(1);

      if (existing) {
        await db
          .update(subscriptionSchema)
          .set({
            plan,
            status: sub.status,
            billingCycle: sub.billingCycle?.interval ?? 'month',
            currentPeriodStart: sub.currentBillingPeriod?.startsAt
              ? new Date(sub.currentBillingPeriod.startsAt)
              : null,
            currentPeriodEnd: sub.currentBillingPeriod?.endsAt
              ? new Date(sub.currentBillingPeriod.endsAt)
              : null,
            cancelAtPeriodEnd: sub.scheduledChange?.action === 'cancel',
          })
          .where(eq(subscriptionSchema.id, existing.id));
      } else {
        await db.insert(subscriptionSchema).values({
          clerkUserId,
          paddleSubscriptionId: sub.id,
          paddleCustomerId: sub.customerId ?? '',
          plan,
          status: sub.status,
          billingCycle: sub.billingCycle?.interval ?? 'month',
          currentPeriodStart: sub.currentBillingPeriod?.startsAt
            ? new Date(sub.currentBillingPeriod.startsAt)
            : null,
          currentPeriodEnd: sub.currentBillingPeriod?.endsAt
            ? new Date(sub.currentBillingPeriod.endsAt)
            : null,
          cancelAtPeriodEnd: sub.scheduledChange?.action === 'cancel',
        });
      }
      break;
    }

    // 訂閱取消
    case EventName.SubscriptionCanceled: {
      const sub = event.data;
      await db
        .update(subscriptionSchema)
        .set({ status: 'canceled' })
        .where(eq(subscriptionSchema.paddleSubscriptionId, sub.id));
      break;
    }

    default:
      // 未處理的事件類型（靜默略過）
  }

  return NextResponse.json({ received: true });
}
