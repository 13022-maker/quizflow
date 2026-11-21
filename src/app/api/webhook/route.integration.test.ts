// Paddle webhook 整合測試：真實 SDK 簽章驗證 + 真實 migration（無 DATABASE_URL 時 src/libs/DB.ts 用 in-memory PGlite）。
// 簽章格式依 Paddle 規格手算：h1 = HMAC-SHA256(secret, `${ts}:${rawBody}`)（hex）。
import { createHmac } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/libs/DB';
import { paddleCustomerSchema, subscriptionSchema } from '@/models/Schema';

import { POST } from './route';

const SECRET = 'pdl_ntfset_test_secret';

function sign(body: string, secret = SECRET) {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

function sendEvent(payload: unknown, opts: { secret?: string; signature?: string } = {}) {
  const body = JSON.stringify(payload);
  return POST(new Request('https://quizflow.example/api/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'paddle-signature': opts.signature ?? sign(body, opts.secret),
    },
    body,
  }));
}

let seq = 0;
function subscriptionEvent(input: {
  eventType: string;
  subId: string;
  customerId: string;
  priceId: string;
  status: string;
  customData?: Record<string, unknown> | null;
  interval?: 'month' | 'year';
}) {
  seq += 1;
  return {
    event_id: `evt_${seq}`,
    notification_id: `ntf_${seq}`,
    event_type: input.eventType,
    occurred_at: '2026-11-14T00:00:00.000Z',
    data: {
      id: input.subId,
      status: input.status,
      customer_id: input.customerId,
      address_id: 'add_1',
      currency_code: 'TWD',
      created_at: '2026-11-14T00:00:00.000Z',
      updated_at: '2026-11-14T00:00:00.000Z',
      collection_mode: 'automatic',
      billing_cycle: { interval: input.interval ?? 'month', frequency: 1 },
      current_billing_period: {
        starts_at: '2026-11-14T00:00:00.000Z',
        ends_at: '2026-12-14T00:00:00.000Z',
      },
      scheduled_change: null,
      custom_data: input.customData ?? null,
      items: [{
        status: 'active',
        quantity: 1,
        recurring: true,
        created_at: '2026-11-14T00:00:00.000Z',
        updated_at: '2026-11-14T00:00:00.000Z',
        price: { id: input.priceId, product_id: 'pro_1' },
      }],
    },
  };
}

describe('POST /api/webhook（Paddle）', () => {
  beforeEach(() => {
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY', 'pri_pro_m');
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY', 'pri_pro_y');
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY', 'pri_team_m');
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY', 'pri_team_y');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('PADDLE_WEBHOOK_SECRET 未設 → 503（讓 Paddle 之後重送），不寫 DB', async () => {
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', '');
    const res = await sendEvent(subscriptionEvent({
      eventType: 'subscription.created',
      subId: 'sub_nosecret',
      customerId: 'ctm_nosecret',
      priceId: 'pri_pro_m',
      status: 'active',
      customData: { clerkUserId: 'user_nosecret' },
    }), { signature: 'ts=1;h1=x' });

    expect(res.status).toBe(503);

    const rows = await db.select().from(subscriptionSchema).where(eq(subscriptionSchema.paddleSubscriptionId, 'sub_nosecret'));

    expect(rows).toHaveLength(0);
  });

  it('簽章錯誤 → 400，不寫 DB', async () => {
    const res = await sendEvent(subscriptionEvent({
      eventType: 'subscription.created',
      subId: 'sub_badsig',
      customerId: 'ctm_badsig',
      priceId: 'pri_pro_m',
      status: 'active',
      customData: { clerkUserId: 'user_badsig' },
    }), { secret: 'wrong_secret' });

    expect(res.status).toBe(400);

    const rows = await db.select().from(subscriptionSchema).where(eq(subscriptionSchema.paddleSubscriptionId, 'sub_badsig'));

    expect(rows).toHaveLength(0);
  });

  it('customData 為 null → 用 customer_id 反查 paddle_customer 取得 clerkUserId', async () => {
    await db.insert(paddleCustomerSchema).values({
      clerkUserId: 'user_lookup',
      paddleCustomerId: 'ctm_lookup',
      email: 'lookup@example.com',
    });

    const res = await sendEvent(subscriptionEvent({
      eventType: 'subscription.created',
      subId: 'sub_lookup',
      customerId: 'ctm_lookup',
      priceId: 'pri_pro_y',
      status: 'active',
      customData: null,
      interval: 'year',
    }));

    expect(res.status).toBe(200);

    const [row] = await db.select().from(subscriptionSchema).where(eq(subscriptionSchema.paddleSubscriptionId, 'sub_lookup'));

    expect(row?.clerkUserId).toBe('user_lookup');
    expect(row?.paddleCustomerId).toBe('ctm_lookup');
    expect(row?.plan).toBe('pro');
    expect(row?.status).toBe('active');
    expect(row?.billingCycle).toBe('year');
    expect(row?.currentPeriodEnd?.toISOString()).toBe('2026-12-14T00:00:00.000Z');
  });

  it('customData 有 clerkUserId → 直接使用；team price → plan=team', async () => {
    const res = await sendEvent(subscriptionEvent({
      eventType: 'subscription.created',
      subId: 'sub_custom',
      customerId: 'ctm_custom',
      priceId: 'pri_team_m',
      status: 'active',
      customData: { clerkUserId: 'user_custom' },
    }));

    expect(res.status).toBe(200);

    const [row] = await db.select().from(subscriptionSchema).where(eq(subscriptionSchema.paddleSubscriptionId, 'sub_custom'));

    expect(row?.clerkUserId).toBe('user_custom');
    expect(row?.plan).toBe('team');
  });

  it('同一訂閱 updated → 更新同一筆（不重複新增）；canceled → status=canceled', async () => {
    const base = { subId: 'sub_life', customerId: 'ctm_life', customData: { clerkUserId: 'user_life' } };
    await sendEvent(subscriptionEvent({ ...base, eventType: 'subscription.created', priceId: 'pri_pro_m', status: 'active' }));
    await sendEvent(subscriptionEvent({ ...base, eventType: 'subscription.updated', priceId: 'pri_team_m', status: 'past_due' }));

    let rows = await db.select().from(subscriptionSchema).where(eq(subscriptionSchema.paddleSubscriptionId, 'sub_life'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.plan).toBe('team');
    expect(rows[0]?.status).toBe('past_due');

    const res = await sendEvent(subscriptionEvent({ ...base, eventType: 'subscription.canceled', priceId: 'pri_team_m', status: 'canceled' }));

    expect(res.status).toBe(200);

    rows = await db.select().from(subscriptionSchema).where(eq(subscriptionSchema.paddleSubscriptionId, 'sub_life'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('canceled');
  });

  it('找不到 clerkUserId（無 customData、DB 也查不到）→ 200 但不寫 DB（避免 Paddle 無限重送）', async () => {
    const res = await sendEvent(subscriptionEvent({
      eventType: 'subscription.created',
      subId: 'sub_orphan',
      customerId: 'ctm_orphan',
      priceId: 'pri_pro_m',
      status: 'active',
    }));

    expect(res.status).toBe(200);

    const rows = await db.select().from(subscriptionSchema).where(eq(subscriptionSchema.paddleSubscriptionId, 'sub_orphan'));

    expect(rows).toHaveLength(0);
  });

  it('非訂閱事件（transaction.completed）→ 200 略過', async () => {
    const body = {
      event_id: 'evt_txn',
      notification_id: 'ntf_txn',
      event_type: 'transaction.completed',
      occurred_at: '2026-11-14T00:00:00.000Z',
      data: { id: 'txn_1' },
    };
    const res = await sendEvent(body);

    expect(res.status).toBe(200);
  });
});
