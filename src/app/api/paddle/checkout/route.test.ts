// POST /api/paddle/checkout：env 缺漏、priceId 白名單、登入檢查
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
const currentUserMock = vi.fn();
const getOrCreateMock = vi.fn();

vi.mock('@clerk/nextjs/server', () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

vi.mock('@/libs/paddle', () => ({
  getOrCreatePaddleCustomer: (args: unknown) => getOrCreateMock(args),
}));

const { POST } = await import('./route');

function post(body: unknown) {
  return POST(new Request('https://quizflow.example/api/paddle/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/paddle/checkout', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ userId: 'user_1' });
    currentUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: 't@example.com' }],
      fullName: '王老師',
    });
    getOrCreateMock.mockResolvedValue('ctm_123');
    vi.stubEnv('PADDLE_API_KEY', 'pdl_live_apikey_x');
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY', 'pri_pro_m');
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY', 'pri_pro_y');
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY', 'pri_team_m');
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY', 'pri_team_y');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('PADDLE_API_KEY 未設 → 503 PADDLE_NOT_CONFIGURED，不呼叫 Paddle', async () => {
    vi.stubEnv('PADDLE_API_KEY', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ priceId: 'pri_pro_m' });

    expect(res.status).toBe(503);

    const data = await res.json();

    expect(data.code).toBe('PADDLE_NOT_CONFIGURED');
    expect(data.error).toBe('付款功能即將開放，請稍後再試');
    expect(getOrCreateMock).not.toHaveBeenCalled();
  });

  it('未登入 → 401', async () => {
    authMock.mockResolvedValue({ userId: null });
    const res = await post({ priceId: 'pri_pro_m' });

    expect(res.status).toBe(401);
  });

  it('priceId 不在 env 白名單 → 400 INVALID_PRICE', async () => {
    const res = await post({ priceId: 'pri_attacker' });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_PRICE');
    expect(getOrCreateMock).not.toHaveBeenCalled();
  });

  it('學校方案暫不開放：TEAM price env 未設 → team priceId 被拒 400 INVALID_PRICE', async () => {
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY', '');
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY', '');

    for (const priceId of ['pri_team_m', 'pri_team_y']) {
      const res = await post({ priceId });

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('INVALID_PRICE');
    }

    expect(getOrCreateMock).not.toHaveBeenCalled();
  });

  it('學校方案暫不開放時，Pro 仍可正常結帳', async () => {
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY', '');
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY', '');
    const res = await post({ priceId: 'pri_pro_y' });

    expect(res.status).toBe(200);
    expect((await res.json()).priceId).toBe('pri_pro_y');
  });

  it('缺 priceId → 400 INVALID_PRICE', async () => {
    const res = await post({});

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_PRICE');
  });

  it('正常 → 200 回 customerId，並帶 clerkUserId 給 checkout customData', async () => {
    const res = await post({ priceId: 'pri_team_y' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      customerId: 'ctm_123',
      priceId: 'pri_team_y',
      clerkUserId: 'user_1',
    });
    expect(getOrCreateMock).toHaveBeenCalledWith({
      clerkUserId: 'user_1',
      email: 't@example.com',
      name: '王老師',
    });
  });

  it('Paddle 呼叫失敗 → 500，不把內部錯誤細節回給前端', async () => {
    getOrCreateMock.mockRejectedValue(new Error('Paddle API 401 secret detail'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ priceId: 'pri_pro_m' });

    expect(res.status).toBe(500);

    const data = await res.json();

    expect(data.error).toBe('結帳初始化失敗，請稍後再試');
    expect(JSON.stringify(data)).not.toContain('secret detail');
  });
});
