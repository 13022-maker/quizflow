/**
 * 檢查指定 quizId 的題型分布，確認是否 Live Mode MVP 支援
 * 用法：npx dotenv -e .env.local -- tsx scripts/inspect-quiz-types.ts
 *
 * Live Mode MVP 僅支援：single_choice / multiple_choice / true_false
 */
import { Client } from 'pg';

const TARGET_QUIZ_IDS = [242, 222, 233, 219];
const LIVE_SUPPORTED = new Set(['single_choice', 'multiple_choice', 'true_false']);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL 未設定');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  for (const quizId of TARGET_QUIZ_IDS) {
    const { rows } = await client.query(
      `SELECT type, COUNT(*)::int AS n
       FROM question
       WHERE quiz_id = $1
       GROUP BY type
       ORDER BY type`,
      [quizId],
    );

    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    const unsupported = rows.filter(r => !LIVE_SUPPORTED.has(r.type));
    const liveOk = unsupported.length === 0;

    console.log(`\n=== quizId ${quizId} (共 ${total} 題) ${liveOk ? '✅ Live OK' : '⚠️  含不支援題型'} ===`);
    for (const r of rows) {
      const flag = LIVE_SUPPORTED.has(r.type) ? '✅' : '❌';
      console.log(`  ${flag} ${r.type.padEnd(18)} ${r.n} 題`);
    }
  }

  await client.end();
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
