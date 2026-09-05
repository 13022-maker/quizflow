import { auth, clerkClient } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { createGoogleSheet, GoogleSheetsError } from '@/lib/google/sheetsExport';
import { buildClassScoreReport } from '@/libs/adaptive/classScoreReport';
import { parseDateRangeParams, todayInTaipei } from '@/libs/adaptive/dateRangeFilter';
import { getAdaptiveService } from '@/libs/adaptive/service';
import { db } from '@/libs/DB';
import { adaptivePracticeSchema } from '@/models/Schema';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: { practiceId: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const practiceId = Number(params.practiceId);
  if (!Number.isInteger(practiceId)) {
    return NextResponse.json({ error: '無效的練習 ID' }, { status: 400 });
  }

  const [practice] = await db
    .select()
    .from(adaptivePracticeSchema)
    .where(
      and(
        eq(adaptivePracticeSchema.id, practiceId),
        eq(adaptivePracticeSchema.ownerId, userId),
      ),
    )
    .limit(1);

  if (!practice) {
    return NextResponse.json({ error: '找不到練習或無權限' }, { status: 404 });
  }

  // 用 Clerk 既有的 Google 連線拿 access token；查無 token（從沒用 Google 登入過，
  // 或 scope 是舊的沒有 Sheets 權限）都算「未連接」，前端走同一套「重新連接」引導
  const clerk = await clerkClient();
  const tokenResponse = await clerk.users.getUserOauthAccessToken(userId, 'google');
  const accessToken = tokenResponse.data[0]?.token;
  if (!accessToken) {
    return NextResponse.json({ error: 'GOOGLE_NOT_CONNECTED' }, { status: 409 });
  }

  const { searchParams } = new URL(request.url);
  const dateRange = parseDateRangeParams({
    start: searchParams.get('start') ?? undefined,
    end: searchParams.get('end') ?? undefined,
  });

  const { header, rows } = await buildClassScoreReport(practice, dateRange);
  const service = await getAdaptiveService(practice.id, practice.subjectId);
  const title = `${practice.title}_${service.subject.name}_班級成績_${todayInTaipei()}`;

  try {
    const { spreadsheetUrl } = await createGoogleSheet(accessToken, title, header, rows);
    return NextResponse.json({ url: spreadsheetUrl });
  } catch (err) {
    if (err instanceof GoogleSheetsError && (err.status === 401 || err.status === 403)) {
      // token 存在但權限不足（scope 還沒補簽）→ 跟查無 token 走同一套「重新連接」流程
      return NextResponse.json({ error: 'GOOGLE_NOT_CONNECTED' }, { status: 409 });
    }
    console.error('[export-sheet] Google Sheets API 失敗', err);
    return NextResponse.json({ error: '匯出失敗，請重試' }, { status: 502 });
  }
}
