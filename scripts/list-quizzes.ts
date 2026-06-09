/**
 * 列出 DB 中最近的測驗，供 Live Mode 壓測選用
 * 用法：npx dotenv -e .env.local -- tsx scripts/list-quizzes.ts
 *
 * 註：直接用 pg client，避開 @/libs/DB 的 top-level await
 */
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL 未設定');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  const { rows } = await client.query(`
    SELECT
      q.id,
      q.title,
      q.owner_id,
      q.created_at,
      (SELECT COUNT(*)::int FROM question WHERE quiz_id = q.id) AS q_count
    FROM quiz q
    ORDER BY q.created_at DESC
    LIMIT 20
  `);

  console.log('\n=== 最近 20 個測驗 ===\n');
  console.log('quizId                               | 題數 | 標題                          | ownerId');
  console.log('-'.repeat(120));
  for (const r of rows) {
    const id = String(r.id).padEnd(36);
    const qc = String(r.q_count).padStart(3);
    const title = (r.title ?? '(無標題)').padEnd(28).slice(0, 28);
    const owner = String(r.owner_id).slice(0, 30);
    console.log(`${id} | ${qc} | ${title} | ${owner}`);
  }
  console.log(`\n共 ${rows.length} 筆\n`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
