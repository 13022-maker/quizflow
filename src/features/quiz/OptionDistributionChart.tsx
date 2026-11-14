'use client';

/**
 * 成績頁單題「選項分佈」長條圖
 * 從 QuestionBreakdownTable 拆出來，讓 recharts（~140 kB gzip）只在老師展開某一題時才下載
 */

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

export type OptionChartDatum = {
  name: string;
  count: number;
  isCorrect: boolean;
};

export default function OptionDistributionChart({ data }: { data: OptionChartDatum[] }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
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
          {data.map((d, idx) => (
            <Cell key={`${d.name}-${idx}`} fill={d.isCorrect ? '#22c55e' : '#94a3b8'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
