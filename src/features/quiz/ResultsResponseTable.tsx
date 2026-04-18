'use client';

import { useState } from 'react';

// 表格用的序列化型別（Date 已轉成字串）
export type ResponseRow = {
  id: number;
  studentName: string | null;
  studentEmail: string | null;
  score: number | null;
  totalPoints: number | null;
  leaveCount: number;
  submittedAt: string; // ISO string
};

type SortKey = 'submittedAt' | 'rate';

function calcRate(row: ResponseRow): number | null {
  if (row.score === null || row.totalPoints === null || row.totalPoints === 0) {
    return null;
  }
  return Math.round((row.score / row.totalPoints) * 100);
}

export function ResultsResponseTable({ responses, quizId }: { responses: ResponseRow[]; quizId: number }) {
  const [sortKey, setSortKey] = useState<SortKey>('submittedAt');
  const [sortAsc, setSortAsc] = useState(false);

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
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          共
          {' '}
          {responses.length}
          {' '}
          筆作答記錄
        </p>
        <a
          href={csvDownloadUrl}
          download
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          ↓ 匯出 CSV
        </a>
      </div>

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
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {r.studentName ?? <span className="text-muted-foreground">—</span>}
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
    </div>
  );
}
