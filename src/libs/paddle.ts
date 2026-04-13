/**
 * Paddle Billing 服務端工具
 * - 初始化 Paddle SDK
 * - 建立/查找 Paddle 客戶
 * - 查詢用戶訂閱狀態
 */

import { Environment, LogLevel, Paddle } from '@paddle/paddle-node-sdk';
import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { paddleCustomerSchema, subscriptionSchema } from '@/models/Schema';

// Paddle SDK 實例（server-side only）
export const paddle = new Paddle(process.env.PADDLE_API_KEY || '', {
  environment:
    process.env.NEXT_PUBLIC_PADDLE_ENV === 'production'
      ? Environment.production
      : Environment.sandbox,
  logLevel: LogLevel.error,
});

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
  const customer = await paddle.customers.create({
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

// 查詢用戶目前的訂閱（取最新一筆）
export async function getUserSubscription(clerkUserId: string) {
  const [sub] = await db
    .select()
    .from(subscriptionSchema)
    .where(eq(subscriptionSchema.clerkUserId, clerkUserId))
    .orderBy(subscriptionSchema.createdAt)
    .limit(1);

  return sub ?? { plan: 'free', status: 'inactive' };
}
