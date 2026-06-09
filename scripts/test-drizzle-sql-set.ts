/**
 * 診斷：Drizzle .set({ field: sql`...` }) 為何沒寫入 next_transition_at
 * 用法：npx dotenv -e .env.local -- tsx scripts/test-drizzle-sql-set.ts
 */
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/models/Schema';

const { liveGameSchema } = schema;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 未設定');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 5 });
  const db = drizzle(pool, { schema });

  // 找測試對象 game
  const [g] = await db
    .select()
    .from(liveGameSchema)
    .where(eq(liveGameSchema.gamePin, '7X0P56'))
    .limit(1);

  if (!g) {
    console.error('找不到 game pin 7X0P56');
    process.exit(1);
  }

  console.log('改寫前 next_transition_at:', g.nextTransitionAt);

  // 嘗試 1：跟 startGame 一模一樣的 .set
  console.log('\n=== 測試 1：sql`NOW() + (25 * INTERVAL \'1 second\')` ===');
  const total = 25;
  const result1 = await db
    .update(liveGameSchema)
    .set({
      nextTransitionAt: sql`NOW() + (${total} * INTERVAL '1 second')`,
    })
    .where(eq(liveGameSchema.id, g.id))
    .returning();
  console.log('回傳：', { nextTransitionAt: result1[0]?.nextTransitionAt });

  // 嘗試 2：純常量
  console.log('\n=== 測試 2：sql`NOW() + INTERVAL \'30 seconds\'`（無 parameter） ===');
  const result2 = await db
    .update(liveGameSchema)
    .set({
      nextTransitionAt: sql`NOW() + INTERVAL '30 seconds'`,
    })
    .where(eq(liveGameSchema.id, g.id))
    .returning();
  console.log('回傳：', { nextTransitionAt: result2[0]?.nextTransitionAt });

  // 嘗試 3：直接 new Date()
  console.log('\n=== 測試 3：new Date(Date.now() + 35*1000) ===');
  const result3 = await db
    .update(liveGameSchema)
    .set({
      nextTransitionAt: new Date(Date.now() + 35 * 1000),
    })
    .where(eq(liveGameSchema.id, g.id))
    .returning();
  console.log('回傳：', { nextTransitionAt: result3[0]?.nextTransitionAt });

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
