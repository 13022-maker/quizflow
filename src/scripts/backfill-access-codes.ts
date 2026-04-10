/* eslint-disable no-console */
/**
 * 補齊舊測驗的 accessCode 欄位（針對 PostgreSQL 生產環境）
 *
 * 執行方式：
 *   DATABASE_URL=<your_db_url> npx tsx src/scripts/backfill-access-codes.ts
 *
 * 注意：開發環境使用 PGlite in-memory，每次重啟資料庫都是全新的，
 * 不需要補齊（新建的測驗已自動產生 accessCode）。
 * 此 script 主要用於生產環境 PostgreSQL。
 */

import { Client } from 'pg';

// 產生隨機 8 碼英數字（不依賴 nanoid，避免 ESM/CJS 問題）
function generateCode(length = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

async function backfill() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('ℹ️  未設定 DATABASE_URL，跳過補齊。');
    console.log('   開發環境使用 PGlite in-memory，不需要補齊。');
    console.log('   生產環境請設定：DATABASE_URL=<url> npx tsx src/scripts/backfill-access-codes.ts');
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  console.log('🔗 已連線至資料庫');

  try {
    // 查出所有 access_code 為空的測驗
    const { rows: quizzes } = await client.query<{ id: number; title: string }>(
      'SELECT id, title FROM quiz WHERE access_code IS NULL ORDER BY id',
    );

    if (quizzes.length === 0) {
      console.log('✅ 所有測驗已有 accessCode，無需補齊。');
      return;
    }

    console.log(`🔧 找到 ${quizzes.length} 筆測驗需要補齊 accessCode...`);

    for (const quiz of quizzes) {
      // 避免衝突：最多重試 5 次
      let code = '';
      for (let attempt = 0; attempt < 5; attempt++) {
        code = generateCode(8);
        const { rowCount } = await client.query(
          'SELECT 1 FROM quiz WHERE access_code = $1',
          [code],
        );
        if (rowCount === 0) {
          break; // 無衝突，直接使用
        }
      }

      await client.query(
        'UPDATE quiz SET access_code = $1 WHERE id = $2',
        [code, quiz.id],
      );
      console.log(`  ✓ 更新 quiz ${quiz.id}（${quiz.title}）→ ${code}`);
    }

    console.log('✅ Done！');
  } finally {
    await client.end();
  }
}

backfill().catch((err) => {
  console.error('❌ 補齊失敗：', err);
  process.exit(1);
});
