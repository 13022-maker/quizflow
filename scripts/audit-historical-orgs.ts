/**
 * Phase 1 audit — 對 DB 裡每個歷史 org_id 查 Clerk Backend API
 *
 * 用法:
 *   npx dotenv -e .env.local -- tsx scripts/audit-historical-orgs.ts
 *
 * 輸入:tmp/historical-orgs.json (從 Neon production fork 撈出來的彙總)
 * 輸出:
 *   tmp/clerk-org-audit.json — 結構化結果
 *   tmp/clerk-org-audit.md   — 給人看的摘要
 *
 * 安全:只讀 Clerk Backend API,不改 Clerk / 不動 DB
 */
import fs from 'node:fs';
import path from 'node:path';

const SECRET = process.env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error('❌ CLERK_SECRET_KEY 未設定');
  process.exit(1);
}

type DbOrg = {
  ownerId: string;
  quizRows: number;
  aiUsageRows: number;
  vocabRows: number;
  todoRows: number;
  totalRows: number;
};

type AuditResult = DbOrg & {
  status: 'active' | 'not_found' | 'error';
  httpStatus: number;
  clerkName?: string;
  clerkSlug?: string | null;
  createdBy?: string | null;
  createdAt?: number;
  errorMessage?: string;
};

const SLEEP_MS = 120; // 防 Clerk rate limit

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function lookupOrg(orgId: string): Promise<AuditResult> {
  const dbOrg = dbOrgs.find((o) => o.ownerId === orgId)!;
  try {
    const res = await fetch(
      `https://api.clerk.com/v1/organizations/${orgId}`,
      { headers: { Authorization: `Bearer ${SECRET}` } },
    );

    if (res.status === 404) {
      return { ...dbOrg, status: 'not_found', httpStatus: 404 };
    }
    if (!res.ok) {
      const body = await res.text();
      return {
        ...dbOrg,
        status: 'error',
        httpStatus: res.status,
        errorMessage: body.slice(0, 300),
      };
    }
    const data = (await res.json()) as {
      id: string;
      name: string;
      slug: string | null;
      created_by: string | null;
      created_at: number;
    };
    return {
      ...dbOrg,
      status: 'active',
      httpStatus: 200,
      clerkName: data.name,
      clerkSlug: data.slug,
      createdBy: data.created_by,
      createdAt: data.created_at,
    };
  } catch (err) {
    return {
      ...dbOrg,
      status: 'error',
      httpStatus: 0,
      errorMessage: (err as Error).message,
    };
  }
}

const inputPath = 'tmp/historical-orgs.json';
if (!fs.existsSync(inputPath)) {
  console.error(`❌ 找不到 ${inputPath},先跑前一步 dump 流程`);
  process.exit(1);
}
const dbOrgs = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as DbOrg[];
console.log(`📦 讀進 ${dbOrgs.length} 個歷史 org`);

async function main() {
  const results: AuditResult[] = [];
  for (let i = 0; i < dbOrgs.length; i++) {
    const o = dbOrgs[i]!;
    process.stdout.write(`[${i + 1}/${dbOrgs.length}] ${o.ownerId}... `);
    const r = await lookupOrg(o.ownerId);
    results.push(r);
    console.log(r.status === 'active' ? `✅ active(createdBy=${r.createdBy ?? 'null'})` : r.status === 'not_found' ? '🪦 not_found(已刪除)' : `⚠️  error(${r.httpStatus})`);
    if (i < dbOrgs.length - 1) await sleep(SLEEP_MS);
  }

  // 寫 JSON
  fs.writeFileSync(
    'tmp/clerk-org-audit.json',
    JSON.stringify(results, null, 2),
  );

  // 統計
  const active = results.filter((r) => r.status === 'active');
  const notFound = results.filter((r) => r.status === 'not_found');
  const errors = results.filter((r) => r.status === 'error');
  const activeWithCreator = active.filter((r) => r.createdBy);
  const activeNoCreator = active.filter((r) => !r.createdBy);

  const activeRows = active.reduce((s, r) => s + r.totalRows, 0);
  const notFoundRows = notFound.reduce((s, r) => s + r.totalRows, 0);
  const errorRows = errors.reduce((s, r) => s + r.totalRows, 0);

  // 寫 markdown
  const lines: string[] = [
    `# Clerk org audit — ${new Date().toISOString().split('T')[0]}`,
    ``,
    `## 總覽`,
    ``,
    `| 類別 | org 數 | DB row 數 |`,
    `|---|---:|---:|`,
    `| ✅ Clerk 上仍 active(可救) | ${active.length} | ${activeRows} |`,
    `| 🪦 已從 Clerk 刪除(救不回) | ${notFound.length} | ${notFoundRows} |`,
    `| ⚠️  API 錯誤(要重查) | ${errors.length} | ${errorRows} |`,
    `| **合計** | **${results.length}** | **${results.reduce((s, r) => s + r.totalRows, 0)}** |`,
    ``,
    `Active 中:`,
    `- 有 createdBy 可 mapping: ${activeWithCreator.length}`,
    `- 無 createdBy(早期 SDK 沒記錄): ${activeNoCreator.length}`,
    ``,
    `## ✅ Active orgs(${active.length}) — 有救`,
    ``,
    `| owner_id | DB rows | createdBy | name | created_at |`,
    `|---|---:|---|---|---|`,
  ];
  for (const r of active.sort((a, b) => b.totalRows - a.totalRows)) {
    const createdAtStr = r.createdAt
      ? new Date(r.createdAt).toISOString().split('T')[0]
      : '?';
    lines.push(
      `| \`${r.ownerId}\` | ${r.totalRows} | \`${r.createdBy ?? '(null)'}\` | ${r.clerkName ?? '?'} | ${createdAtStr} |`,
    );
  }

  lines.push(``);
  lines.push(`## 🪦 Not found(${notFound.length}) — 已從 Clerk 刪除`);
  lines.push(``);
  if (notFound.length === 0) {
    lines.push(`(無)`);
  } else {
    lines.push(`| owner_id | DB rows |`);
    lines.push(`|---|---:|`);
    for (const r of notFound.sort((a, b) => b.totalRows - a.totalRows)) {
      lines.push(`| \`${r.ownerId}\` | ${r.totalRows} |`);
    }
  }

  if (errors.length) {
    lines.push(``);
    lines.push(`## ⚠️  Errors(${errors.length})`);
    lines.push(``);
    lines.push(`| owner_id | http | message |`);
    lines.push(`|---|---:|---|`);
    for (const r of errors) {
      lines.push(
        `| \`${r.ownerId}\` | ${r.httpStatus} | ${r.errorMessage?.slice(0, 80) ?? '?'} |`,
      );
    }
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`下一步參考(由人決定):`);
  lines.push(`- Active+createdBy: 可加進 mapping,跑 0020 時會被 remap`);
  lines.push(`- Active 但 createdBy=null: 需個案決定(問 org 成員? 認領?)`);
  lines.push(`- Not found(🪦): Clerk 已刪除,DB 那 N row 變死資料`);
  lines.push(`  → 選項: a) 也 DELETE  b) 改 owner_id 給特定 user  c) 維持原狀`);

  fs.writeFileSync(path.join('tmp', 'clerk-org-audit.md'), lines.join('\n') + '\n');

  console.log(``);
  console.log(`📝 結果:`);
  console.log(`   tmp/clerk-org-audit.json`);
  console.log(`   tmp/clerk-org-audit.md`);
  console.log(``);
  console.log(`摘要: ✅${active.length}  🪦${notFound.length}  ⚠️${errors.length}`);
}

main().catch((err) => {
  console.error('❌ 失敗:', err);
  process.exit(1);
});
