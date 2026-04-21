'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { gradeEssayAnswerAction } from '@/actions/essayGradingActions';
import { getResponseDetail } from '@/actions/responseActions';

import { ResponseDetailDialog } from './ResponseDetailDialog';

// 表格用的序列化型別（Date 已轉成字串）
export type ResponseRow = {
  id: number;
  studentName: string | null;
  studentEmail: string | null;
  score: number | null;
  totalPoints: number | null;
  leaveCount: number;
  submittedAt: string; // ISO string
  // 申論題批改狀態
  hasEssay: boolean;
  hasUngradedEssay: boolean;
};

type SortKey = 'submittedAt' | 'rate';

function calcRate(row: ResponseRow): number | null {
  if (row.score === null || row.totalPoints === null || row.totalPoints === 0) {
    return null;
  }
  return Math.round((row.score / row.totalPoints) * 100);
}

export function ResultsResponseTable({ responses, quizId }: { responses: ResponseRow[]; quizId: number }) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>('submittedAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedResponseId, setSelectedResponseId] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchMsg, setBatchMsg] = useState<string>('');

  // 排序邏輯
  const sorted = [...responses].sort((a, b) => {
    if (sortKey === 'rate') {
      const ra = calcRate(a) ?? -1;
      const rb = calcRate(b) ?? -1;
      return sortAsc ? ra - rb : rb - ra;
    }
    // 預設以作答時間排序
    const ta = new Date(a.submittedAt).getTime();
    const tb = new Date(b.submittedAt).getTime();
    return sortAsc ? ta - tb : tb - ta;
  });

  const ungradedCount = responses.filter(r => r.hasUngradedEssay).length;

  // 切換排序欄位
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(prev => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <span className="ml-1 text-muted-foreground/40">↕</span>;
    }
    return <span className="ml-1">{sortAsc ? '↑' : '↓'}</span>;
  };

  // 匯出 CSV（透過 server-side API 下載，手機相容）
  const csvDownloadUrl = `/api/quizzes/${quizId}/export-csv`;

  // 共用：把資料轉成表格列（Google Sheets TSV 用）
  const getTableRows = () => {
    const header = ['姓名', 'Email', '答對題數', '答對率', '離開次數', '作答時間'];
    const rows = sorted.map(r => [
      r.studentName ?? '',
      r.studentEmail ?? '',
      r.score !== null && r.totalPoints !== null ? `${r.score}/${r.totalPoints}` : '—',
      calcRate(r) !== null ? `${calcRate(r)}%` : '—',
      String(r.leaveCount),
      new Date(r.submittedAt).toLocaleString('zh-TW'),
    ]);
    return { header, rows };
  };

  // 一鍵開啟 Google Sheets：複製 TSV 到剪貼簿 + 開新試算表
  const [sheetsCopied, setSheetsCopied] = useState(false);
  const handleOpenGoogleSheets = async () => {
    const { header, rows } = getTableRows();
    const tsv = [header, ...rows].map(row => row.join('\t')).join('\n');
    await navigator.clipboard.writeText(tsv);
    setSheetsCopied(true);
    setTimeout(() => setSheetsCopied(false), 5000);
    window.open('https://docs.google.com/spreadsheets/create', '_blank');
  };

  // 一鍵批改全班：client 端逐一呼叫 gradeEssayAnswerAction
  // 每份 5-6 秒，30 人約 3 分鐘；關閉瀏覽器會中斷
  const handleGradeAll = async () => {
    const ungraded = responses.filter(r => r.hasUngradedEssay);
    if (ungraded.length === 0) {
      return;
    }

    setBatchMsg('');
    setBatchProgress({ current: 0, total: ungraded.length });

    let done = 0;
    let failed = 0;
    let stopped = false;

    for (const response of ungraded) {
      if (stopped) {
        break;
      }
      setBatchProgress({ current: done, total: ungraded.length });

      // 取得該 response 的所有 answer，挑出未批改的簡答題
      const detail = await getResponseDetail(response.id);
      if (!detail) {
        failed += 1;
        continue;
      }
      const pending = detail.items.filter(
        it => it.questionType === 'short_answer' && !it.gradedAt,
      );

      for (const item of pending) {
        const res = await gradeEssayAnswerAction(item.answerId);
        if (res.status === 'quota_exceeded') {
          setBatchMsg(res.reason);
          stopped = true;
          break;
        }
        if (res.status === 'pro_required') {
          setBatchMsg('升級 Pro 方案即可使用 AI 批改');
          stopped = true;
          break;
        }
        if (res.status === 'failed') {
          failed += 1;
        }
      }
      done += 1;
      setBatchProgress({ current: done, total: ungraded.length });
    }

    setBatchProgress(null);
    if (!batchMsg) {
      setBatchMsg(
        failed > 0
          ? `批改完成 ${done - failed} 份，另 ${failed} 份失敗`
          : `已批改 ${done} 份`,
      );
    }
    router.refresh();
  };

  if (responses.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
        目前尚無學生作答
      </p>
    );
  }

  return (
    <div>
      {/* 工具列 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          共
          {' '}
          {responses.length}
          {' '}
          筆作答記錄
          {ungradedCount > 0 && (
            <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
              {ungradedCount}
              {' '}
              份待批改
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {ungradedCount > 0 && (
            <button
              type="button"
              onClick={handleGradeAll}
              disabled={batchProgress !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {batchProgress
                ? `🤖 批改中 ${batchProgress.current} / ${batchProgress.total}`
                : `✨ 一鍵批改全班（${ungradedCount}）`}
            </button>
          )}
          <a
            href={csvDownloadUrl}
            download
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            ↓ 匯出 CSV
          </a>
          <button
            type="button"
            onClick={handleOpenGoogleSheets}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
          >
            {sheetsCopied ? '✅ 已複製，請在試算表貼上' : '📊 Google Sheets'}
          </button>
        </div>
      </div>

      {batchMsg && (
        <div className="mb-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
          {batchMsg}
        </div>
      )}

      {/* 表格 */}
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">學生姓名</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Email</th>
              <th className="px-4 py-2 text-center font-medium text-muted-foreground">答對題數</th>
              <th
                className="cursor-pointer px-4 py-2 text-center font-medium text-muted-foreground hover:text-foreground"
                onClick={() => toggleSort('rate')}
              >
                答對率
                {sortIcon('rate')}
              </th>
              <th
                className="cursor-pointer px-4 py-2 text-right font-medium text-muted-foreground hover:text-foreground"
                onClick={() => toggleSort('submittedAt')}
              >
                作答時間
                {sortIcon('submittedAt')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((r) => {
              const rate = calcRate(r);
              return (
                <tr
                  key={r.id}
                  onClick={() => setSelectedResponseId(r.id)}
                  className="cursor-pointer hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.studentName ?? <span className="text-muted-foreground">—</span>}
                      {r.hasEssay && (
                        r.hasUngradedEssay
                          ? (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                🕒 待批改
                              </span>
                            )
                          : (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                                ✨ AI 已批改
                              </span>
                            )
                      )}
                      {r.leaveCount > 0 && (
                        <span
                          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
                          title="考試期間離開頁面次數（防作弊記錄）"
                        >
                          ⚠️ 離開
                          {' '}
                          {r.leaveCount}
                          {' '}
                          次
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">{r.studentEmail ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3 text-center">
                    {r.score !== null && r.totalPoints !== null ? `${r.score} / ${r.totalPoints}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {rate !== null
                      ? (
                          <span className={`font-medium ${rate >= 70 ? 'text-green-600' : rate >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                            {rate}
                            %
                          </span>
                        )
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {new Date(r.submittedAt).toLocaleString('zh-TW')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedResponseId !== null && (
        <ResponseDetailDialog
          responseId={selectedResponseId}
          onClose={() => {
            setSelectedResponseId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
