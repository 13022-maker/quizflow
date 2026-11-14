// Paddle 設定純函數測試：期望值皆為手寫 literal，不用被測函式自己算
import { describe, expect, it } from 'vitest';

import {
  getMissingPaddleServerEnv,
  isAllowedPriceId,
  isPaddleClientReady,
  isPricingEnabled,
  pickEffectiveSubscription,
  resolvePlanFromPriceId,
} from './paddleConfig';

const PRICE_IDS = {
  proMonthly: 'pri_pro_m',
  proYearly: 'pri_pro_y',
  teamMonthly: 'pri_team_m',
  teamYearly: 'pri_team_y',
  publisherMonthly: '',
  publisherYearly: '',
};

describe('resolvePlanFromPriceId', () => {
  it('Pro 月/年 price → pro', () => {
    expect(resolvePlanFromPriceId('pri_pro_m', PRICE_IDS)).toBe('pro');
    expect(resolvePlanFromPriceId('pri_pro_y', PRICE_IDS)).toBe('pro');
  });

  it('Team 月/年 price → team', () => {
    expect(resolvePlanFromPriceId('pri_team_m', PRICE_IDS)).toBe('team');
    expect(resolvePlanFromPriceId('pri_team_y', PRICE_IDS)).toBe('team');
  });

  it('未知 price → free', () => {
    expect(resolvePlanFromPriceId('pri_unknown', PRICE_IDS)).toBe('free');
  });

  // 舊實作把未設定的 env 當成 '' key 塞進 map，priceId 缺漏時會被誤判成最後一個（publisher）
  it('priceId 缺漏且有未設定的 env 時 → free（不可誤判成 publisher）', () => {
    expect(resolvePlanFromPriceId(undefined, PRICE_IDS)).toBe('free');
    expect(resolvePlanFromPriceId('', PRICE_IDS)).toBe('free');
  });
});

describe('isAllowedPriceId', () => {
  it('只接受已設定的 4 個（+ publisher）price ID', () => {
    expect(isAllowedPriceId('pri_pro_m', PRICE_IDS)).toBe(true);
    expect(isAllowedPriceId('pri_team_y', PRICE_IDS)).toBe(true);
    expect(isAllowedPriceId('pri_evil', PRICE_IDS)).toBe(false);
  });

  it('空字串永遠不合法（即使有 env 沒設定）', () => {
    expect(isAllowedPriceId('', PRICE_IDS)).toBe(false);
  });
});

describe('isPaddleClientReady', () => {
  it('client token 與 priceId 都有才算 ready', () => {
    expect(isPaddleClientReady({ clientToken: 'live_x', priceId: 'pri_pro_m' })).toBe(true);
  });

  it('缺 client token（production 目前狀況）→ 不 ready', () => {
    expect(isPaddleClientReady({ clientToken: undefined, priceId: 'pri_pro_m' })).toBe(false);
    expect(isPaddleClientReady({ clientToken: '', priceId: 'pri_pro_m' })).toBe(false);
  });

  it('缺 priceId → 不 ready', () => {
    expect(isPaddleClientReady({ clientToken: 'live_x', priceId: '' })).toBe(false);
    expect(isPaddleClientReady({ clientToken: 'live_x', priceId: undefined })).toBe(false);
  });
});

describe('getMissingPaddleServerEnv', () => {
  it('全部缺 → 回傳兩個 key', () => {
    expect(getMissingPaddleServerEnv({}, ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET']))
      .toEqual(['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET']);
  });

  it('空字串視為缺漏', () => {
    expect(getMissingPaddleServerEnv({ PADDLE_API_KEY: '' }, ['PADDLE_API_KEY'])).toEqual(['PADDLE_API_KEY']);
  });

  it('都有 → 空陣列', () => {
    expect(getMissingPaddleServerEnv({ PADDLE_API_KEY: 'pdl_x' }, ['PADDLE_API_KEY'])).toEqual([]);
  });
});

describe('isPricingEnabled', () => {
  it('未設定 → 預設開啟（正式收費後定價頁常態可見）', () => {
    expect(isPricingEnabled(undefined)).toBe(true);
    expect(isPricingEnabled('')).toBe(true);
    expect(isPricingEnabled('true')).toBe(true);
  });

  it('明確設 false → 關閉（緊急回滾用 kill switch）', () => {
    expect(isPricingEnabled('false')).toBe(false);
  });
});

describe('pickEffectiveSubscription', () => {
  const canceledOld = { plan: 'pro', status: 'canceled', updatedAt: new Date('2026-10-01T00:00:00Z') };
  const activeNew = { plan: 'team', status: 'active', updatedAt: new Date('2026-11-01T00:00:00Z') };
  const pastDue = { plan: 'pro', status: 'past_due', updatedAt: new Date('2026-09-01T00:00:00Z') };

  it('沒有訂閱 → null', () => {
    expect(pickEffectiveSubscription([])).toBeNull();
  });

  // 取消後重新訂閱會有兩筆；不能因為 DB 回傳順序拿到已取消那筆而把付費用戶降成 Free
  it('有效狀態優先於已取消（不論順序）', () => {
    expect(pickEffectiveSubscription([canceledOld, activeNew])).toBe(activeNew);
    expect(pickEffectiveSubscription([activeNew, canceledOld])).toBe(activeNew);
  });

  it('多筆有效 → 取最新更新的', () => {
    expect(pickEffectiveSubscription([pastDue, activeNew])).toBe(activeNew);
  });

  it('全部無效 → 回傳最新那筆（呼叫端會判成 Free）', () => {
    const canceledNew = { plan: 'team', status: 'canceled', updatedAt: new Date('2026-11-05T00:00:00Z') };

    expect(pickEffectiveSubscription([canceledOld, canceledNew])).toBe(canceledNew);
  });
});
