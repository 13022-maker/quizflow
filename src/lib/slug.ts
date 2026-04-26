/**
 * Slug 生成 + 唯一性檢查
 *
 * 設計決定（Phase 1 commit 2，Q1）:
 * - 用 nanoid 8 碼 alphanumeric,排除易混淆字符（O/0/I/l/1）
 * - 8 碼 32^8 ≈ 1.1 兆組合,collision 機率極低,但仍 retry 5 次防 race condition
 * - 不從 title slugify(中文 edge case 多;nanoid 短碼即可)
 */

import { eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';

import { db } from '@/libs/DB';
import { quizSchema } from '@/models/Schema';

// 32 字符,排除易混淆 0/O/1/I/l
const slugAlphabet = '23456789abcdefghijkmnpqrstuvwxyz';
const nanoSlug = customAlphabet(slugAlphabet, 8);

export function generateSlug(): string {
  return nanoSlug();
}

/**
 * 確保 slug 唯一,衝突時 re-roll(最多 5 次)
 *
 * @param seedSlug 候選 slug
 * @param excludeQuizId 自己的 quizId(更新自身時不算 collision)
 */
export async function ensureUniqueSlug(
  seedSlug: string,
  excludeQuizId?: number,
): Promise<string> {
  let candidate = seedSlug;

  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db
      .select({ id: quizSchema.id })
      .from(quizSchema)
      .where(eq(quizSchema.slug, candidate))
      .limit(1);

    // 沒人用 OR 是自己 → 可用
    if (existing.length === 0 || existing[0]?.id === excludeQuizId) {
      return candidate;
    }

    // collision → re-roll
    candidate = nanoSlug();
  }

  throw new Error(`Slug generation failed after 5 retries (seed: ${seedSlug})`);
}
