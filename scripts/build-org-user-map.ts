/**
 * Phase 1 — 抓 Clerk org → creator user 對照表,並生成 migration
 *
 * 用法:
 *   npx dotenv -e .env.local -- tsx scripts/build-org-user-map.ts
 *
 * 安全保證:
 *   - 只「讀」Clerk Backend API,不改 Clerk 任何資料
 *   - 不直接連 DB,只產出 SQL 檔讓 review 後再 db:migrate
 *   - 所有 UPDATE idempotent (WHERE 比對特定 owner_id,二次跑 0 筆)
 *
 * 兩段式 migration:
 *   Section A: Active orgs(從 Clerk listOrganizations 撈) → 各自的 createdBy
 *   Section B: Audit 標 not_found 的 dead orgs(若 tmp/clerk-org-audit.json 存在)
 *              → 統一 fallback 給 DEAD_ORG_FALLBACK_USER
 */
import fs from 'node:fs';
import path from 'node:path';

const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error('❌ CLERK_SECRET_KEY 未設定。確認 .env.local 有此值。');
  process.exit(1);
}

// 已從 Clerk 刪除的 org 之 row 統一改 owner_id 給這個 user
// 決議:2026-04-25,選擇學校帳號 13022@cyvs.tyc.edu.tw
const DEAD_ORG_FALLBACK_USER = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58';

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

function buildSQL(
  map: Array<{ orgId: string; userId: string }>,
  deadOrgIds: string[],
): string {
  const today = new Date().toISOString().split('T')[0];
  const lines: string[] = [
    `-- 0020_org_to_user_remap.sql`,
    `-- 自動生成於 ${today} (scripts/build-org-user-map.ts)`,
    `--`,
    `-- Phase 1: 4 張表 owner_id 從 Clerk org_xxx 換成 user_xxx`,
    `-- 範圍:quiz / ai_usage / vocabulary_set / todo`,
    `-- 不在範圍:`,
    `--   live_game (已有 host_user_id,Phase 3 改 code 即可)`,
    `--   publisher (B 案保留,2026-10-25 重評)`,
    `--`,
    `-- Idempotent:每條 UPDATE 都用 WHERE 比對特定 owner_id,二次跑 0 筆`,
    `-- 兩段:`,
    `--   A. Active orgs (Clerk listOrganizations 回的) → 各自的 createdBy`,
    `--      ${map.length} 個 org`,
    `--   B. Dead orgs (Clerk 已刪除,從 audit 撈出) → ${DEAD_ORG_FALLBACK_USER}`,
    `--      ${deadOrgIds.length} 個 org`,
    ``,
  ];

  if (map.length === 0 && deadOrgIds.length === 0) {
    lines.push(`-- (empty — 此 migration 等同 noop)`);
    lines.push(`SELECT 1;`);
    return lines.join('\n') + '\n';
  }

  // ---- Section A: Active orgs ----
  if (map.length) {
    lines.push(`-- =============================================`);
    lines.push(`-- Section A: Active orgs → 各自 createdBy`);
    lines.push(`-- =============================================`);
    // 每條 UPDATE 後都接 --> statement-breakpoint
    // 否則 Drizzle 會把多條 SQL 餵成單一 prepared statement,PG/PGlite 都會拒絕
    // (error: "cannot insert multiple commands into a prepared statement")
    for (const { orgId, userId } of map) {
      lines.push(`-- ${orgId} → ${userId}`);
      for (const t of TABLES) {
        lines.push(
          `UPDATE "${t}" SET owner_id = '${userId}' WHERE owner_id = '${orgId}';`,
        );
        lines.push(`--> statement-breakpoint`);
      }
    }
  }

  // ---- Section B: Dead orgs(Clerk 已刪除) ----
  if (deadOrgIds.length) {
    lines.push(``);
    lines.push(`-- =============================================`);
    lines.push(`-- Section B: Dead orgs (${deadOrgIds.length} 個) → ${DEAD_ORG_FALLBACK_USER}`);
    lines.push(`-- =============================================`);
    const inList = deadOrgIds.map((id) => `  '${id}'`).join(',\n');
    for (const t of TABLES) {
      lines.push(`UPDATE "${t}" SET owner_id = '${DEAD_ORG_FALLBACK_USER}' WHERE owner_id IN (`);
      lines.push(inList);
      lines.push(`);`);
      lines.push(`--> statement-breakpoint`);
    }
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

function loadDeadOrgIds(): string[] {
  const auditPath = 'tmp/clerk-org-audit.json';
  if (!fs.existsSync(auditPath)) {
    console.log('ℹ️  tmp/clerk-org-audit.json 不存在,跳過 Section B');
    return [];
  }
  type AuditRow = { ownerId: string; status: 'active' | 'not_found' | 'error' };
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8')) as AuditRow[];
  const deadIds = audit.filter((r) => r.status === 'not_found').map((r) => r.ownerId);
  console.log(`📦 audit 抓到 ${deadIds.length} 個 dead org → reassign 給 ${DEAD_ORG_FALLBACK_USER}`);
  return deadIds;
}

async function main() {
  console.log('📡 抓取 Clerk organizations...');
  const orgs = await fetchAllOrgs();
  console.log(`✅ 共 ${orgs.length} 個 active org`);

  const mapping: Array<{ orgId: string; userId: string }> = [];
  const noCreator: Org[] = [];
  for (const o of orgs) {
    if (!o.createdBy) noCreator.push(o);
    else mapping.push({ orgId: o.id, userId: o.createdBy });
  }

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(
    'tmp/org-user-map.json',
    JSON.stringify(
      { generatedAt: new Date().toISOString(), mapping, noCreator },
      null, 2,
    ),
  );
  console.log('📝 對照表 → tmp/org-user-map.json');

  if (noCreator.length) {
    console.warn(`⚠️  ${noCreator.length} 個 active org 無 createdBy:`);
    for (const o of noCreator) console.warn(`   ${o.id} (${o.name})`);
  }

  const deadOrgIds = loadDeadOrgIds();

  const sqlPath = path.join('migrations', '0020_org_to_user_remap.sql');
  fs.writeFileSync(sqlPath, buildSQL(mapping, deadOrgIds));
  console.log(`📝 Migration → ${sqlPath}`);

  appendJournalEntry();

  console.log('\n🔍 下一步 (人工 review,不要自動跑 db:migrate):');
  console.log('  1. less migrations/0020_org_to_user_remap.sql');
  console.log('  2. git diff migrations/');
}

main().catch((err) => {
  console.error('❌ 失敗:', err);
  process.exit(1);
});
