/**
 * Paddle Billing 服務端工具
 * - 初始化 Paddle SDK（lazy：env 缺漏時不在 import 階段建立，避免 build / 頁面受影響）
 * - 建立/查找 Paddle 客戶
 */

import { Environment, LogLevel, Paddle } from '@paddle/paddle-node-sdk';
import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { paddleCustomerSchema } from '@/models/Schema';

let paddleInstance: Paddle | null = null;
let paddleInstanceKey = '';

// Paddle SDK 實例（server-side only）；呼叫前請先確認 PADDLE_API_KEY 已設定
export function getPaddle(): Paddle {
  const apiKey = process.env.PADDLE_API_KEY || '';
  if (!paddleInstance || paddleInstanceKey !== apiKey) {
    paddleInstance = new Paddle(apiKey, {
      environment:
        process.env.NEXT_PUBLIC_PADDLE_ENV === 'production'
          ? Environment.production
          : Environment.sandbox,
      logLevel: LogLevel.error,
    });
    paddleInstanceKey = apiKey;
  }
  return paddleInstance;
}

// 取得或建立 Paddle 客戶（確保 Clerk 用戶有對應的 Paddle 客戶 ID）
export async function getOrCreatePaddleCustomer({
  clerkUserId,
  email,
  name,
}: {
  clerkUserId: string;
  email: string;
  name?: string;
}): Promise<string> {
  // 先查本地 DB
  const [existing] = await db
    .select({ paddleCustomerId: paddleCustomerSchema.paddleCustomerId })
    .from(paddleCustomerSchema)
    .where(eq(paddleCustomerSchema.clerkUserId, clerkUserId))
    .limit(1);

  if (existing) {
    return existing.paddleCustomerId;
  }

  // 在 Paddle 建立客戶
  const customer = await getPaddle().customers.create({
    email,
    name: name ?? email,
    customData: { clerkUserId },
  });

  // 寫入本地 DB
  await db.insert(paddleCustomerSchema).values({
    clerkUserId,
    paddleCustomerId: customer.id,
    email,
  });

  return customer.id;
}

// 查詢用戶在本地 DB 對應的 Paddle 客戶 ID（Customer Portal 用）
export async function findPaddleCustomerId(clerkUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ paddleCustomerId: paddleCustomerSchema.paddleCustomerId })
    .from(paddleCustomerSchema)
    .where(eq(paddleCustomerSchema.clerkUserId, clerkUserId))
    .limit(1);
  return row?.paddleCustomerId ?? null;
}
