'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, useTransition } from 'react';

import {
  getStatisticsData,
  type StatQuiz,
  type StatResponse,
} from '@/actions/statisticsActions';

// 日期格式化：ISO → M/D
function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 分數儲存格顯示
type ScoreCell = { score: number | null; totalPoints: number | null } | null;

function formatScore(cell: ScoreCell) {
  if (!cell || cell.score === null || cell.totalPoints === null) return '—';
  return `${cell.score}/${cell.totalPoints}`;
}

// 百分比（用於 tooltip）
function formatPercentage(cell: ScoreCell) {
  if (!cell || cell.score === null || cell.totalPoints === null || cell.totalPoints === 0)
    return '';
  return `${((cell.score / cell.totalPoints) * 100).toFixed(1)}%`;
}

export function StatisticsCrossTable() {
  const t = useTranslations('Statistics');
  const [isPending, startTransition] = useTransition();

  // 日期篩選
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 查詢結果
  const [quizzes, setQuizzes] = useState<StatQuiz[]>([]);
  const [responses, setResponses] = useState<StatResponse[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState('');

  // 姓名搜尋
  const [nameFilter, setNameFilter] = useState('');

  // 查詢
  const handleSearch = useCallback(() => {
    if (!startDate || !endDate) return;
    setError('');
    startTransition(async () => {
      const result = await getStatisticsData({ startDate, endDate });
      if (result.error) {
        setError(result.error);
        return;
      }
      setQuizzes(result.quizzes);
      setResponses(result.responses);
      setHasSearched(true);
    });
  }, [startDate, endDate]);

  // Pivot 邏輯：建立交叉表資料
  const pivotData = useMemo(() => {
    const studentSet = new Set(responses.map((r) => r.studentName));
    const students = Array.from(studentSet).sort();

    // 查找表：`${studentName}__${quizId}` → { score, totalPoints }
    const lookup = new Map<string, { score: number | null; totalPoints: number | null }>();
    for (const r of responses) {
      lookup.set(`${r.studentName}__${r.quizId}`, {
        score: r.score,
        totalPoints: r.totalPoints,
      });
    }

    return students.map((name) => {
      const cells = quizzes.map((q) => lookup.get(`${name}__${q.id}`) ?? null);

      let totalScore = 0;
      let totalPoints = 0;
      let hasAnyScore = false;
      for (const cell of cells) {
        if (cell && cell.score !== null && cell.totalPoints !== null) {
          totalScore += cell.score;
          totalPoints += cell.totalPoints;
          hasAnyScore = true;
        }
      }

      return {
        studentName: name,
        cells,
        totalScore: hasAnyScore ? totalScore : null,
        totalPoints: hasAnyScore ? totalPoints : null,
      };
    });
  }, [quizzes, responses]);

  // 姓名篩選
  const filteredRows = useMemo(() => {
    if (!nameFilter.trim()) return pivotData;
    const keyword = nameFilter.trim().toLowerCase();
    return pivotData.filter((row) => row.studentName.toLowerCase().includes(keyword));
  }, [pivotData, nameFilter]);

  // CSV 匯出
  const handleExportCSV = useCallback(() => {
    if (filteredRows.length === 0) return;

    const escapeCSV = (val: string) => `"${val.replace(/"/g, '""')}"`;

    const headers = [
      t('student_name'),
      ...quizzes.map((q) => `${q.title} (${formatDate(q.createdAt)})`),
      t('total'),
      t('total_full_score'),
      t('total_percentage'),
    ];

    const csvRows = filteredRows.map((row) => {
      const cells = row.cells.map((cell) =>
        cell && cell.score !== null ? String(cell.score) : '',
      );
      const total = row.totalScore !== null ? String(row.totalScore) : '';
      const totalFull = row.totalPoints !== null ? String(row.totalPoints) : '';
      const pct =
        row.totalScore !== null && row.totalPoints !== null && row.totalPoints > 0
          ? `${((row.totalScore / row.totalPoints) * 100).toFixed(1)}%`
          : '';
      return [escapeCSV(row.studentName), ...cells, total, totalFull, pct];
    });

    // BOM + CSV 內容
    const csv = `﻿${[headers.map(escapeCSV).join(','), ...csvRows.map((r) => r.join(','))].join('\n')}`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `成績統計_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredRows, quizzes, startDate, endDate, t]);

  return (
    <div className="space-y-4">
      {/* 日期篩選列 */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            {t('start_date')}
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            {t('end_date')}
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={handleSearch}
          disabled={!startDate || !endDate || isPending}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {isPending ? '查詢中...' : t('search')}
        </button>
      </div>

      {/* 錯誤提示 */}
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      {/* 搜尋 + 匯出列 */}
      {hasSearched && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            type="text"
            placeholder={t('search_student')}
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          {filteredRows.length > 0 && (
            <button
              type="button"
              onClick={handleExportCSV}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              {t('export_csv')}
            </button>
          )}
        </div>
      )}

      {/* 無資料提示 */}
      {hasSearched && filteredRows.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
          {t('no_results')}
        </div>
      )}

      {/* 交叉表 */}
      {filteredRows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left font-medium text-gray-700">
                  {t('student_name')}
                </th>
                {quizzes.map((q) => (
                  <th
                    key={q.id}
                    className="whitespace-nowrap px-4 py-3 text-center font-medium text-gray-700"
                  >
                    <div>{q.title}</div>
                    <div className="text-xs font-normal text-gray-400">
                      {formatDate(q.createdAt)}
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-center font-bold text-gray-900">
                  {t('total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.studentName} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 font-medium text-gray-900">
                    {row.studentName}
                  </td>
                  {row.cells.map((cell, i) => (
                    <td
                      key={`${row.studentName}-${quizzes[i]!.id}`}
                      className="whitespace-nowrap px-4 py-3 text-center text-gray-600"
                      title={formatPercentage(cell)}
                    >
                      {formatScore(cell)}
                    </td>
                  ))}
                  <td
                    className="whitespace-nowrap px-4 py-3 text-center font-bold text-gray-900"
                    title={
                      row.totalScore !== null && row.totalPoints !== null && row.totalPoints > 0
                        ? `${((row.totalScore / row.totalPoints) * 100).toFixed(1)}%`
                        : ''
                    }
                  >
                    {row.totalScore !== null ? `${row.totalScore}/${row.totalPoints}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 初始空狀態 */}
      {!hasSearched && !error && (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
          {t('no_data')}
        </div>
      )}
    </div>
  );
}
