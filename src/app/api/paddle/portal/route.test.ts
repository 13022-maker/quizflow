// POST /api/paddle/portal：建立 Paddle Customer Portal session（管理 / 取消訂閱、更新付款方式）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.fn();
const findCustomerMock = vi.fn();
const portalCreateMock = vi.fn();

vi.mock('@clerk/nextjs/server', () => ({
  auth: () => authMock(),
}));

vi.mock('@/libs/paddle', () => ({
  findPaddleCustomerId: (userId: string) => findCustomerMock(userId),
  getPaddle: () => ({ customerPortalSessions: { create: portalCreateMock } }),
}));

const { POST } = await import('./route');

describe('POST /api/paddle/portal', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ userId: 'user_1' });
    findCustomerMock.mockResolvedValue('ctm_1');
    portalCreateMock.mockResolvedValue({
      urls: { general: { overview: 'https://customer-portal.paddle.com/cpl_1' } },
    });
    vi.stubEnv('PADDLE_API_KEY', 'pdl_live_apikey_x');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('PADDLE_API_KEY 未設 → 503 PADDLE_NOT_CONFIGURED', async () => {
    vi.stubEnv('PADDLE_API_KEY', '');
    const res = await POST();

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('PADDLE_NOT_CONFIGURED');
    expect(portalCreateMock).not.toHaveBeenCalled();
  });

  it('未登入 → 401', async () => {
    authMock.mockResolvedValue({ userId: null });
    const res = await POST();

    expect(res.status).toBe(401);
  });

  it('沒有 Paddle 客戶紀錄 → 404 NO_CUSTOMER', async () => {
    findCustomerMock.mockResolvedValue(null);
    const res = await POST();

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NO_CUSTOMER');
  });

  it('正常 → 回傳 portal overview URL', async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://customer-portal.paddle.com/cpl_1' });
    expect(portalCreateMock).toHaveBeenCalledWith('ctm_1', []);
  });

  it('Paddle 失敗 → 500 且不外洩細節', async () => {
    portalCreateMock.mockRejectedValue(new Error('forbidden secret'));
    const res = await POST();

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});
