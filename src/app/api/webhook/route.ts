/**
 * Paddle Webhook Endpoint
 * 接收 Paddle 的訂閱事件通知，更新 DB 中的訂閱狀態
 *
 * 回應碼語意（Paddle 收到非 2xx 會重送）：
 * - 503：PADDLE_WEBHOOK_SECRET 未設 → 設好 env 後 Paddle 重送即可補上
 * - 400：簽章錯誤（偽造或 secret 對不上）
 * - 500：DB 寫入失敗 → 交給 Paddle 重送
 * - 200：已處理，或非訂閱事件 / 找不到對應用戶（避免無限重送）
 */

import { EventName } from '@paddle/paddle-node-sdk';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { getPaddle } from '@/libs/paddle';
import { getMissingPaddleServerEnv, readPaddlePublicEnv, resolvePlanFromPriceId } from '@/libs/paddleConfig';
import { paddleCustomerSchema, subscriptionSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// 會寫入 subscription 表的事件（全部走同一個 upsert，狀態以 payload 的 status 為準）
const SUBSCRIPTION_EVENTS = new Set<string>([
  EventName.SubscriptionCreated,
  EventName.SubscriptionUpdated,
  EventName.SubscriptionActivated,
  EventName.SubscriptionCanceled,
  EventName.SubscriptionPastDue,
  EventName.SubscriptionPaused,
  EventName.SubscriptionResumed,
  EventName.SubscriptionTrialing,
]);

type SubscriptionPayload = {
  id: string;
  status: string;
  customerId: string;
  customData: unknown;
  items?: Array<{ price?: { id?: string } | null }>;
  billingCycle?: { interval?: string } | null;
  currentBillingPeriod?: { startsAt?: string; endsAt?: string } | null;
  scheduledChange?: { action?: string } | null;
};

async function resolveClerkUserId(sub: SubscriptionPayload): Promise<string | undefined> {
  // 優先從 subscription.customData 取 clerkUserId；沒有的話用 customer_id 反查 paddle_customer 表（關鍵 fix）
  const fromCustomData = (sub.customData as Record<string, unknown> | null)?.clerkUserId;
  if (typeof fromCustomData === 'string' && fromCustomData) {
    return fromCustomData;
  }
  if (!sub.customerId) {
    return undefined;
  }
  const [row] = await db
    .select({ clerkUserId: paddleCustomerSchema.clerkUserId })
    .from(paddleCustomerSchema)
    .where(eq(paddleCustomerSchema.paddleCustomerId, sub.customerId))
    .limit(1);
  return row?.clerkUserId;
}

async function upsertSubscription(sub: SubscriptionPayload, clerkUserId: string) {
  const values = {
    plan: resolvePlanFromPriceId(sub.items?.[0]?.price?.id, readPaddlePublicEnv().priceIds),
    status: sub.status,
    billingCycle: sub.billingCycle?.interval ?? 'month',
    currentPeriodStart: sub.currentBillingPeriod?.startsAt ? new Date(sub.currentBillingPeriod.startsAt) : null,
    currentPeriodEnd: sub.currentBillingPeriod?.endsAt ? new Date(sub.currentBillingPeriod.endsAt) : null,
    cancelAtPeriodEnd: sub.scheduledChange?.action === 'cancel',
  };

  // 以 paddle_subscription_id（UNIQUE）做原子 upsert，created / updated 同時到也不會重複新增
  await db
    .insert(subscriptionSchema)
    .values({
      clerkUserId,
      paddleSubscriptionId: sub.id,
      paddleCustomerId: sub.customerId ?? '',
      ...values,
    })
    .onConflictDoUpdate({
      target: subscriptionSchema.paddleSubscriptionId,
      set: values,
    });
}

export async function POST(req: Request) {
  const missing = getMissingPaddleServerEnv(process.env, ['PADDLE_WEBHOOK_SECRET']);
  if (missing.length > 0) {
    console.error('[Paddle Webhook] 缺少 env：', missing.join(', '));
    return NextResponse.json({ error: 'Webhook 尚未設定' }, { status: 503 });
  }

  const secret = process.env.PADDLE_WEBHOOK_SECRET!;
  const signature = req.headers.get('paddle-signature') ?? '';
  const rawBody = await req.text();
  const paddle = getPaddle();

  // 驗證 webhook 簽名
  let signatureValid = false;
  try {
    signatureValid = await paddle.webhooks.isSignatureValid(rawBody, secret, signature);
  } catch (err) {
    console.error('[Paddle Webhook] 簽名驗證例外', err);
  }
  if (!signatureValid) {
    console.error('[Paddle Webhook] 簽名驗證失敗');
    return NextResponse.json({ error: '簽名驗證失敗' }, { status: 400 });
  }

  let eventType: string | undefined;
  try {
    eventType = JSON.parse(rawBody)?.event_type;
  } catch {
    return NextResponse.json({ error: '無效的 JSON' }, { status: 400 });
  }

  // 非訂閱事件：簽章已驗過，直接 200 略過
  if (!eventType || !SUBSCRIPTION_EVENTS.has(eventType)) {
    return NextResponse.json({ received: true, ignored: eventType ?? null });
  }

  try {
    const event = await paddle.webhooks.unmarshal(rawBody, secret, signature);
    const sub = event.data as unknown as SubscriptionPayload;

    const clerkUserId = await resolveClerkUserId(sub);
    if (!clerkUserId) {
      console.warn('[Paddle Webhook] 找不到 clerkUserId, sub=', sub.id, 'cust=', sub.customerId);
      return NextResponse.json({ received: true, unmatched: true });
    }

    await upsertSubscription(sub, clerkUserId);
  } catch (err) {
    console.error('[Paddle Webhook] 處理失敗', eventType, err);
    return NextResponse.json({ error: '處理失敗' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
