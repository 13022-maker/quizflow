// E2E：學生公開作答流程
// 流程：seed 1 份測驗（單選 + 是非各一題，滿分 100）→ 學生開連結 → 兩題都答對 → 看到 100 分
// 環境：必須跑 PGlite in-memory（playwright.config.ts 已設 ENABLE_TEST_ENDPOINTS=true）

import { expect, test } from '@playwright/test';

const ACCESS_CODE = 'e2e-test-001';

const FIXTURE = {
  accessCode: ACCESS_CODE,
  title: 'E2E 測試題',
  questions: [
    {
      // 第 1 題：單選 — 1 + 1 = ?
      body: '一加一等於多少？',
      type: 'single_choice' as const,
      options: [
        { id: 'opt-a', text: '一' },
        { id: 'opt-b', text: '二' }, // 正解
        { id: 'opt-c', text: '三' },
        { id: 'opt-d', text: '四' },
      ],
      correctAnswers: ['opt-b'],
      points: 50,
    },
    {
      // 第 2 題：是非 — 預設 options 由 QuizTaker 自動補上「正確 / 錯誤」
      body: '台北是台灣的首都',
      type: 'true_false' as const,
      options: null,
      correctAnswers: ['tf-true'],
      points: 50,
    },
  ],
};

test.describe('Quiz Take（學生公開作答）', () => {
  test.beforeAll(async ({ request, baseURL }) => {
    // 用 test-only seed endpoint 預先建測驗到伺服器內的 PGlite
    const res = await request.post(`${baseURL}/api/test/seed-quiz`, {
      data: FIXTURE,
    });
    expect(
      res.ok(),
      `seed endpoint 失敗（${res.status()}）：可能是 webServer 沒跑、ENABLE_TEST_ENDPOINTS 沒設，或 DATABASE_URL 指向真實 DB`,
    ).toBe(true);
  });

  test('學生訪問已過期測驗 → 看到「此測驗已結束」', async ({ page, request, baseURL }) => {
    // seed 一份 expiresAt = 1 小時前 的測驗
    const expiredCode = 'e2e-test-expired';
    const seedRes = await request.post(`${baseURL}/api/test/seed-quiz`, {
      data: {
        accessCode: expiredCode,
        title: '已過期測驗',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        questions: [
          {
            body: '隨便一題',
            type: 'true_false',
            options: null,
            correctAnswers: ['tf-true'],
            points: 100,
          },
        ],
      },
    });
    expect(seedRes.ok(), `seed expired quiz failed: ${seedRes.status()}`).toBe(true);

    // 訪問已過期測驗
    await page.goto(`${baseURL}/zh/quiz/${expiredCode}`);

    // 驗證「已結束」提示（page.tsx 寫死的字串，非 i18n）
    await expect(page.getByText('此測驗已結束')).toBeVisible();
    await expect(page.getByText('測驗連結已過期，無法作答。')).toBeVisible();
  });

  test('學生用不存在的 accessCode 訪問 → 看到「測驗不可用」提示', async ({ page, baseURL }) => {
    // 訪問一個確定不在 DB 的 accessCode（不需要 seed）
    await page.goto(`${baseURL}/zh/quiz/this-code-does-not-exist-12345`);

    // 驗證提示訊息渲染（i18n key: QuizTake.not_available + not_available_description）
    await expect(page.getByText('這份測驗目前無法作答')).toBeVisible();
    await expect(
      page.getByText('測驗可能尚未發佈或已關閉，請聯絡老師確認。'),
    ).toBeVisible();
  });

  test('學生用 accessCode 進測驗 → 兩題答對 → 看到滿分', async ({ page, baseURL }) => {
    // 1. 訪問學生公開連結
    await page.goto(`${baseURL}/zh/quiz/${ACCESS_CODE}`);

    // 2. 驗證標題與題目都渲染出來
    await expect(page.getByRole('heading', { name: 'E2E 測試題' })).toBeVisible();
    await expect(page.getByText('一加一等於多少？')).toBeVisible();
    await expect(page.getByText('台北是台灣的首都')).toBeVisible();

    // 3. 第 1 題：點包住「二」這個選項的 label（input 有 sr-only，要 click label 觸發）
    await page.locator('label').filter({ hasText: /^二$/ }).click();

    // 4. 第 2 題：點「正確」label（是非題預設 options）
    await page.locator('label').filter({ hasText: /^正確$/ }).click();

    // 5. 送出
    await page.getByRole('button', { name: '送出作答' }).click();

    // 6. 驗證分數頁：「作答完成」+ 100/100
    await expect(page.getByText('作答完成')).toBeVisible();
    const scorePanel = page.getByText('作答完成').locator('..');
    await expect(scorePanel).toContainText('100');
    await expect(scorePanel).toContainText('100%');
  });
});
