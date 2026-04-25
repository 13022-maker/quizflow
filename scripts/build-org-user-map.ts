/**
 * Phase 1 — 抓 Clerk org → creator user 對照表,並生成 migration
 *
 * 用法:
 *   npx dotenv -e .env.local -- tsx scripts/build-org-user-map.ts
 *
 * 安全保證:
 *   - 只「讀」Clerk Backend API,不改 Clerk 任何資料
 *   - 不直接連 DB,只產出 SQL 檔讓 review 後再 db:migrate
 *   - 產出的 UPDATE 是 idempotent (WHERE owner_id = 'org_xxx',二次跑 0 筆)
 */
import fs from 'node:fs';
import path from 'node:path';

const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error('❌ CLERK_SECRET_KEY 未設定。確認 .env.local 有此值。');
  process.exit(1);
}

type Org = { id: string; name: string; createdBy: string | null };

async function fetchAllOrgs(): Promise<Org[]> {
  const all: Org[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await fetch(
      `https://api.clerk.com/v1/organizations?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${SECRET}` } },
    );
    if (!res.ok) {
      throw new Error(`Clerk API ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data: Array<{ id: string; name: string; created_by?: string | null }>;
    };

    if (!json.data?.length) break;
    for (const o of json.data) {
      all.push({ id: o.id, name: o.name, createdBy: o.created_by ?? null });
    }
    if (json.data.length < limit) break;
    offset += limit;
  }
  return all;
}

const TABLES = ['quiz', 'ai_usage', 'vocabulary_set', 'todo'] as const;

function buildSQL(map: Array<{ orgId: string; userId: string }>): string {
  const today = new Date().toISOString().split('T')[0];
  const lines: string[] = [
    `-- 0020_org_to_user_remap.sql`,
    `-- 自動生成於 ${today} (scripts/build-org-user-map.ts)`,
    `--`,
    `-- Phase 1: 4 張表 owner_id 從 Clerk org_xxx 換成 creator user_xxx`,
    `-- 範圍:quiz / ai_usage / vocabulary_set / todo`,
    `-- 不在範圍:`,
    `--   live_game (已有 host_user_id,Phase 3 改 code 即可)`,
    `--   publisher (B 案保留,2026-10-25 重評)`,
    `--`,
    `-- Idempotent:WHERE owner_id = 'org_xxx',二次跑 0 筆`,
    `-- 對照筆數:${map.length}`,
    ``,
  ];

  if (map.length === 0) {
    lines.push(`-- (empty mapping — 此 migration 等同 noop)`);
    lines.push(`SELECT 1;`);
    return lines.join('\n') + '\n';
  }

  for (const { orgId, userId } of map) {
    lines.push(`-- ${orgId} → ${userId}`);
    for (const t of TABLES) {
      lines.push(
        `UPDATE "${t}" SET owner_id = '${userId}' WHERE owner_id = '${orgId}';`,
      );
    }
    lines.push(`--> statement-breakpoint`);
  }
  return lines.join('\n') + '\n';
}

function appendJournalEntry() {
  const p = path.join('migrations', 'meta', '_journal.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (j.entries.some((e: any) => e.tag === '0020_org_to_user_remap')) {
    console.log('ℹ️  _journal.json 已含 0020,跳過追加');
    return;
  }
  const lastIdx = Math.max(...j.entries.map((e: any) => e.idx));
  j.entries.push({
    idx: lastIdx + 1,
    version: '7',
    when: Date.now(),
    tag: '0020_org_to_user_remap',
    breakpoints: true,
  });
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log('📝 _journal.json 追加 0020 entry');
}

async function main() {
  console.log('📡 抓取 Clerk organizations...');
  const orgs = await fetchAllOrgs();
  console.log(`✅ 共 ${orgs.length} 個 org`);

  const mapping: Array<{ orgId: string; userId: string }> = [];
  const orphans: Org[] = [];
  for (const o of orgs) {
    if (!o.createdBy) orphans.push(o);
    else mapping.push({ orgId: o.id, userId: o.createdBy });
  }

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(
    'tmp/org-user-map.json',
    JSON.stringify(
      { generatedAt: new Date().toISOString(), mapping, orphans },
      null, 2,
    ),
  );
  console.log('📝 對照表 → tmp/org-user-map.json');

  if (orphans.length) {
    console.warn(`⚠️  ${orphans.length} 個 org 無 createdBy:`);
    for (const o of orphans) console.warn(`   ${o.id} (${o.name})`);
  }

  const sqlPath = path.join('migrations', '0020_org_to_user_remap.sql');
  fs.writeFileSync(sqlPath, buildSQL(mapping));
  console.log(`📝 Migration → ${sqlPath}`);

  appendJournalEntry();

  console.log('\n🔍 下一步 (人工 review,不要自動跑 db:migrate):');
  console.log('  1. less migrations/0020_org_to_user_remap.sql');
  console.log('  2. head -50 tmp/org-user-map.json');
  console.log('  3. git diff migrations/');
}

main().catch((err) => {
  console.error('❌ 失敗:', err);
  process.exit(1);
});
