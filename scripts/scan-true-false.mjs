// 一次性唯讀腳本：掃描是非題資料分布，找出 4a99d42 修復前遺留的「無 options」舊題
// 跑完即刪，不進版控
import { readFileSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

const { Client } = pg;

// 讀 .env.local 取得 DATABASE_URL
const envPath = path.resolve(process.cwd(), '.env.local');
const envText = readFileSync(envPath, 'utf8');
const match = envText.match(/^DATABASE_URL=(.+)$/m);
if (!match) {
  console.error('找不到 DATABASE_URL');
  process.exit(1);
}
const DATABASE_URL = match[1].trim();

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  console.log('\n=== 1. 是非題整體分布 ===');
  const dist = await client.query(`
    SELECT
      COUNT(*) AS total_true_false,
      COUNT(*) FILTER (WHERE options IS NULL) AS options_null,
      COUNT(*) FILTER (
        WHERE options IS NOT NULL AND jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 0
      ) AS options_empty_array,
      COUNT(*) FILTER (WHERE options::text LIKE '%tf-true%') AS has_tf_true_id,
      COUNT(*) FILTER (WHERE correct_answers IS NULL) AS correct_null
    FROM question
    WHERE type = 'true_false';
  `);
  console.table(dist.rows);

  console.log('\n=== 2. 列出所有「無 options」的是非題（顯示 correct_answers 實際樣貌）===');
  const noOpts = await client.query(`
    SELECT
      id,
      quiz_id,
      correct_answers,
      options,
      LEFT(body, 40) AS body_preview,
      created_at
    FROM question
    WHERE type = 'true_false'
      AND (
        options IS NULL
        OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 0)
      )
    ORDER BY created_at ASC
    LIMIT 50;
  `);
  if (noOpts.rows.length === 0) {
    console.log('  ✅ 沒有任何「無 options」的舊是非題');
  } else {
    console.log(`  ⚠️ 找到 ${noOpts.rows.length} 筆（上限 50）`);
    console.table(noOpts.rows);
  }

  console.log('\n=== 3. correct_answers 格式聚合（所有是非題）===');
  const fmt = await client.query(`
    SELECT
      correct_answers::text AS format,
      COUNT(*) AS n
    FROM question
    WHERE type = 'true_false'
    GROUP BY correct_answers::text
    ORDER BY n DESC
    LIMIT 20;
  `);
  console.table(fmt.rows);
} finally {
  await client.end();
}
