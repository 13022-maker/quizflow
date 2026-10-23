// AI quota 退還整合測試：真實 aiUsageActions + route + 全部 migration（無 DATABASE_URL 時
// src/libs/DB.ts 自動用 in-memory PGlite）。Clerk 身分 mock 成固定的免費老師（試用已過期），
// 才會真的走到計數邏輯；AI 金鑰在測試環境未設定，AI 呼叫一律以 503 失敗。
import { and, eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { POST as generateFromFile } from '@/app/api/ai/generate-from-file/route';
import { POST as parseExamBank } from '@/app/api/ai/parse-exam-bank/route';
import { db } from '@/libs/DB';
import { aiUsageSchema, userTrialSchema } from '@/models/Schema';

import { refundAiUsage } from './aiUsageRefund';

const USER = 'user_refund_test';

// vitest.config 會用 loadEnv 讀進 .env.local；開發者本機若設了真的 AI 金鑰，這裡的
// 「AI 失敗」情境就會真的打到外部 API。route 在 module 載入時就讀金鑰，所以要 hoisted 先清掉。
vi.hoisted(() => {
  for (const key of ['GEMINI_API_KEY', 'GEMINI_API_KEY_BACKUP', 'ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_BACKUP', 'GROK_API_KEY', 'GROK_API_KEY_BACKUP', 'OPENAI_API_KEY', 'OPENAI_API_KEY_BACKUP']) {
    delete process.env[key];
  }
});

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_refund_test' }),
  currentUser: async () => null,
}));

async function usageRows() {
  return db.select().from(aiUsageSchema).where(eq(aiUsageSchema.ownerId, USER));
}

async function countFor(yearMonth: string): Promise<number | undefined> {
  const [row] = await db
    .select()
    .from(aiUsageSchema)
    .where(and(eq(aiUsageSchema.ownerId, USER), eq(aiUsageSchema.yearMonth, yearMonth)));
  return row?.count;
}

async function setCurrentCount(count: number): Promise<string> {
  // 先扣一次拿到這次實際使用的 yearMonth key，再把計數設成指定值
  const r = await checkAndIncrementAiUsage(USER);
  if (!r.allowed || !r.charged) {
    throw new Error('測試前置失敗：應該要被計次');
  }
  await db.update(aiUsageSchema).set({ count }).where(and(eq(aiUsageSchema.ownerId, USER), eq(aiUsageSchema.yearMonth, r.yearMonth)));
  return r.yearMonth;
}

function formRequest(url: string, fd: FormData): Request {
  return new Request(url, { method: 'POST', body: fd });
}

async function pdfFile(): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([200, 100]).drawText('Photosynthesis', { x: 10, y: 50, size: 10, font });
  return new File([await doc.save()], 'lesson.pdf', { type: 'application/pdf' });
}

beforeEach(async () => {
  await db.delete(aiUsageSchema).where(eq(aiUsageSchema.ownerId, USER));
  await db.delete(userTrialSchema).where(eq(userTrialSchema.clerkUserId, USER));
  // 試用已過期 → 免費方案，每月 10 次
  await db.insert(userTrialSchema).values({
    clerkUserId: USER,
    startedAt: new Date('2020-01-01T00:00:00Z'),
    endsAt: new Date('2020-01-31T00:00:00Z'),
  });
});

describe('checkAndIncrementAiUsage + refundAiUsage', () => {
  it('免費方案扣次會回傳 charged 與當次 yearMonth；退還後計數回到 0', async () => {
    const r = await checkAndIncrementAiUsage(USER);

    expect(r).toMatchObject({ allowed: true, charged: true, remaining: 9 });

    const yearMonth = (r as { yearMonth: string }).yearMonth;

    expect(yearMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(await countFor(yearMonth)).toBe(1);

    await refundAiUsage(USER, yearMonth);

    expect(await countFor(yearMonth)).toBe(0);
  });

  it('計數已經是 0 時退還不會變負數', async () => {
    const yearMonth = await setCurrentCount(0);

    await refundAiUsage(USER, yearMonth);

    expect(await countFor(yearMonth)).toBe(0);
  });

  it('退還只動指定月份那一列', async () => {
    const yearMonth = await setCurrentCount(4);
    await db.insert(aiUsageSchema).values({ ownerId: USER, yearMonth: '1999-01', count: 7 });

    await refundAiUsage(USER, yearMonth);

    expect(await countFor(yearMonth)).toBe(3);
    expect(await countFor('1999-01')).toBe(7);
  });
});

describe('generate-from-file 失敗時不扣 quota', () => {
  it('types 參數格式錯誤 → 400，計數不變', async () => {
    const yearMonth = await setCurrentCount(3);
    const fd = new FormData();
    fd.append('file', await pdfFile());
    fd.append('types', '[mc');

    const res = await generateFromFile(formRequest('http://localhost/api/ai/generate-from-file', fd));

    expect(res.status).toBe(400);
    expect(await countFor(yearMonth)).toBe(3);
  });

  it('損毀的 PDF → 400「損毀或受保護」，計數不變', async () => {
    const yearMonth = await setCurrentCount(3);
    const fd = new FormData();
    fd.append('file', new File(['not a pdf'], 'broken.pdf', { type: 'application/pdf' }));

    const res = await generateFromFile(formRequest('http://localhost/api/ai/generate-from-file', fd));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('PDF 檔案損毀或受保護，請另存新檔後再上傳');
    expect(await countFor(yearMonth)).toBe(3);
  });

  it('沒上傳檔案 → 400，計數不變', async () => {
    const yearMonth = await setCurrentCount(3);

    const res = await generateFromFile(formRequest('http://localhost/api/ai/generate-from-file', new FormData()));

    expect(res.status).toBe(400);
    expect(await countFor(yearMonth)).toBe(3);
  });

  it('AI 服務不可用（測試環境沒有金鑰）→ 503，計數不變', async () => {
    const yearMonth = await setCurrentCount(3);
    const fd = new FormData();
    fd.append('file', await pdfFile());

    const res = await generateFromFile(formRequest('http://localhost/api/ai/generate-from-file', fd));

    expect(res.status).toBe(503);
    expect(await countFor(yearMonth)).toBe(3);
  });

  it('額度已用完 → 403，不會被退還成負數或少扣', async () => {
    const yearMonth = await setCurrentCount(10);
    const fd = new FormData();
    fd.append('file', await pdfFile());

    const res = await generateFromFile(formRequest('http://localhost/api/ai/generate-from-file', fd));

    expect(res.status).toBe(403);
    expect(await countFor(yearMonth)).toBe(10);
  });
});

describe('parse-exam-bank 失敗時不扣 quota', () => {
  it('貼上空白文字 → 400，計數不變', async () => {
    const yearMonth = await setCurrentCount(2);

    const res = await parseExamBank(new Request('http://localhost/api/ai/parse-exam-bank', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    }));

    expect(res.status).toBe(400);
    expect(await countFor(yearMonth)).toBe(2);
  });

  it('解析不出任何題目 → 400，計數不變', async () => {
    const yearMonth = await setCurrentCount(2);

    const res = await parseExamBank(new Request('http://localhost/api/ai/parse-exam-bank', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '這段文字完全不是題庫格式' }),
    }));

    expect(res.status).toBe(400);
    expect(await countFor(yearMonth)).toBe(2);
  });

  it('上傳沒有文字層的 PDF → 422，計數不變', async () => {
    const yearMonth = await setCurrentCount(2);
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]); // 空白頁，沒有任何文字
    const fd = new FormData();
    fd.append('file', new File([await doc.save()], 'scan.pdf', { type: 'application/pdf' }));

    const res = await parseExamBank(formRequest('http://localhost/api/ai/parse-exam-bank', fd));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('讀不到文字：可能是掃描檔（圖片），或字型無法解析');
    expect(await countFor(yearMonth)).toBe(2);
  });

  it('成功解析（AI 補詳解失敗會留白，不算失敗）→ 照常扣 1 次', async () => {
    const yearMonth = await setCurrentCount(2);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await parseExamBank(new Request('http://localhost/api/ai/parse-exam-bank', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '1.(2) 下列何者為網路通訊協定？①PDF ②TCP ③JPG ④MP3' }),
    }));

    expect(res.status).toBe(200);
    expect(await countFor(yearMonth)).toBe(3);

    vi.restoreAllMocks();
  });
});

it('測試用的 usage 列只屬於測試使用者', async () => {
  // 防呆：確認 beforeEach 清理有作用，不會跨測試累積
  expect(await usageRows()).toEqual([]);
});
