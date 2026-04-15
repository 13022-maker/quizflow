'use client';

/**
 * QuestionBreakdownTable
 * 成績頁「各題答對率」表格，支援展開每列看選項分佈 BarChart
 */

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// 序列化傳入（Date 省略，只要用得到的欄位）
export type BreakdownQuestion = {
  id: number;
  body: string;
  type: string; // questionTypeEnum 字串
  options: { id: string; text: string }[] | null;
  correctAnswers: string[] | null;
};

export type BreakdownRow = {
  question: BreakdownQuestion;
  total: number;
  correct: number;
  rate: number | null;
};

// 每題的選項分佈：{ [questionId]: { [optionId]: count } }
export type OptionStats = Record<number, Record<string, number>>;

type Props = {
  rows: BreakdownRow[];
  optionStats: OptionStats;
  labels: {
    header_index: string;
    header_question: string;
    header_correct: string;
    header_rate: string;
    short_answer_note: string;
    expand_distribution: string;
    collapse_distribution: string;
  };
};

// 支援展開的題型（排序題與簡答題不顯示）
const EXPANDABLE_TYPES = new Set(['single_choice', 'multiple_choice', 'true_false']);

// 是非題若 DB 無 options 時的預設
const TF_DEFAULT_OPTIONS = [
  { id: 'tf-true', text: '正確' },
  { id: 'tf-false', text: '錯誤' },
];

export function QuestionBreakdownTable({ rows, optionStats, labels }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">{labels.header_index}</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">{labels.header_question}</th>
            <th className="px-4 py-2 text-center font-medium text-muted-foreground">{labels.header_correct}</th>
            <th className="px-4 py-2 text-center font-medium text-muted-foreground">{labels.header_rate}</th>
            <th className="w-10 p-2" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ question, total, correct, rate }, i) => {
            const canExpand = EXPANDABLE_TYPES.has(question.type);
            const isOpen = expanded.has(question.id);

            return (
              <RowGroup
                key={question.id}
                index={i}
                question={question}
                total={total}
                correct={correct}
                rate={rate}
                canExpand={canExpand}
                isOpen={isOpen}
                onToggle={() => toggle(question.id)}
                optionStats={optionStats[question.id] ?? {}}
                labels={labels}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 單一題目的兩列（主列 + 可選展開圖表列）
function RowGroup({
  index,
  question,
  total,
  correct,
  rate,
  canExpand,
  isOpen,
  onToggle,
  optionStats,
  labels,
}: {
  index: number;
  question: BreakdownQuestion;
  total: number;
  correct: number;
  rate: number | null;
  canExpand: boolean;
  isOpen: boolean;
  onToggle: () => void;
  optionStats: Record<string, number>;
  labels: Props['labels'];
}) {
  // true_false 可能沒存 options，用預設補
  const rawOptions = question.options && question.options.length > 0
    ? question.options
    : question.type === 'true_false'
      ? TF_DEFAULT_OPTIONS
      : [];

  const correctIds = new Set(question.correctAnswers ?? []);

  // 為 BarChart 組資料：{ name, count, isCorrect }
  const chartData = rawOptions.map(opt => ({
    name: opt.text,
    count: optionStats[opt.id] ?? 0,
    isCorrect: correctIds.has(opt.id),
  }));

  return (
    <>
      <tr className="hover:bg-muted/30">
        <td className="px-4 py-3 text-muted-foreground">{index + 1}</td>
        <td className="px-4 py-3">
          <p className="line-clamp-2">{question.body}</p>
          {question.type === 'short_answer' && (
            <span className="mt-0.5 text-xs text-muted-foreground">{labels.short_answer_note}</span>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          {question.type === 'short_answer' ? '—' : `${correct} / ${total}`}
        </td>
        <td className="px-4 py-3 text-center">
          {rate !== null && question.type !== 'short_answer'
            ? <RateBar rate={rate} />
            : '—'}
        </td>
        <td className="px-2 py-3 text-right">
          {canExpand
            ? (
                <button
                  type="button"
                  onClick={onToggle}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? labels.collapse_distribution : labels.expand_distribution}
                  title={isOpen ? labels.collapse_distribution : labels.expand_distribution}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <span className={`inline-block transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
                </button>
              )
            : null}
        </td>
      </tr>
      {canExpand && isOpen && (
        <tr className="bg-muted/20">
          <td colSpan={5} className="p-4">
            {chartData.length === 0
              ? (
                  <p className="text-xs text-muted-foreground">此題沒有選項資料</p>
                )
              : (
                  <div style={{ width: '100%', height: 200 }}>
                    <ResponsiveContainer>
                      <BarChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 12 }}
                          interval={0}
                          height={40}
                        />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                        <Tooltip
                          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                          formatter={(value: unknown) => [`${Number(value)} 人`, '選擇人數']}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          <LabelList dataKey="count" position="top" style={{ fontSize: 12 }} />
                          {/* 每個 bar 依正解與否改色 */}
                          {chartData.map((d, idx) => (
                            <Cell key={`${d.name}-${idx}`} fill={d.isCorrect ? '#22c55e' : '#94a3b8'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
          </td>
        </tr>
      )}
    </>
  );
}

// 與原成績頁相同的 CSS 長條圖（保留一致視覺）
function RateBar({ rate }: { rate: number }) {
  const color = rate >= 70 ? 'bg-green-500' : rate >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center justify-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className="w-9 text-right text-xs font-medium">
        {rate}
        %
      </span>
    </div>
  );
}
