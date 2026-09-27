import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { PHASE_PRODUCTION_BUILD } from 'next/dist/shared/lib/constants';
import { Pool } from 'pg';

import * as schema from '@/models/Schema';

import { Env } from './Env';

let client;
let drizzle;

// 任意固定值，只用來當 Postgres advisory lock 的 key，跟其他鎖不衝突即可
const MIGRATION_LOCK_ID = 727_310_927;

// Need a database for production? Check out https://www.prisma.io/?via=saasboilerplatesrc
// Tested and compatible with Next.js Boilerplate
if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD && Env.DATABASE_URL) {
  // 改用 Pool，避免單一連線在高併發（如 Live Mode 多玩家）時排隊
  // max=20：dev/prod 都夠用；Neon serverless 連線數上限視方案而定
  client = new Pool({
    connectionString: Env.DATABASE_URL,
    max: 20,
  });

  drizzle = drizzlePg(client, { schema });

  // Serverless 冷啟動時每個 lambda instance 都會跑到這裡，部署後短時間內
  // 常有好幾個 instance 同時冷啟動 → 同時看到「migration 還沒跑」→ 一起搶著
  // 執行同一條 ALTER TABLE，其中一個先 commit 後，其他就會撞到
  // 「column already exists」而炸掉（2026-09-27 production 就發生過這樣的
  // 連續 500）。用 pg_advisory_lock 讓同時冷啟動的 instance 排隊：拿到鎖的先
  // 跑，其他等鎖釋放後才跑 migrate()，這時 migration 已經跑完，drizzle 比對
  // journal 後發現沒有待跑的項目，直接跳過，不會重複執行。
  const migrationClient = await client.connect();
  try {
    await migrationClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await migratePg(drizzle, {
      migrationsFolder: path.join(process.cwd(), 'migrations'),
    });
  } finally {
    await migrationClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    migrationClient.release();
  }
} else {
  // Stores the db connection in the global scope to prevent multiple instances due to hot reloading with Next.js
  const global = globalThis as unknown as { client: PGlite; drizzle: PgliteDatabase<typeof schema> };

  if (!global.client) {
    global.client = new PGlite();
    await global.client.waitReady;

    global.drizzle = drizzlePglite(global.client, { schema });
  }

  drizzle = global.drizzle;
  await migratePglite(global.drizzle, {
    migrationsFolder: path.join(process.cwd(), 'migrations'),
  });
}

export const db = drizzle;
