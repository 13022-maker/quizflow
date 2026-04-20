'use client';

/**
 * StreakCard — Dashboard 顯示老師連勝天數與本週活動格
 * 視覺主題：學生答題數越多，一週七格中的樹木從幼苗長成大樹，最終長滿成森林
 * 資料來源：GET /api/streak + totalResponses（由父層 props 傳入）
 */

import { useEffect, useState } from 'react';

type StreakData = {
  currentStreak: number;
  longestStreak: number;
  freezesLeft: number;
  weeklyActivity: boolean[]; // 週一到週日，7 個 boolean
};

// 依學生總答題數決定樹木最大成長階段（0 ~ 5）
// 0: 空地 / 1: 幼苗 / 2: 小樹 / 3: 樹 / 4: 大樹 / 5: 古樹（有果實）
function stageFromResponses(total: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (total <= 0) {
    return 0;
  }
  if (total < 5) {
    return 1;
  }
  if (total < 15) {
    return 2;
  }
  if (total < 40) {
    return 3;
  }
  if (total < 100) {
    return 4;
  }
  return 5;
}

function stageLabel(stage: number): string {
  return ['尚未種下', '幼苗萌芽', '小樹成形', '茁壯成樹', '枝繁葉茂', '森林已成'][stage] ?? '';
}

// 台北時區今天是星期幾（0=週日 1=週一 ... 6=週六）
function getTaipeiDayOfWeek(): number {
  const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
  const taipeiNow = new Date(Date.now() + TAIPEI_OFFSET_MS);
  return taipeiNow.getUTCDay();
}

// 單棵樹 SVG，依 stage 展現從土壤 → 幼苗 → 大樹
function Tree({ stage, glow = false }: { stage: 0 | 1 | 2 | 3 | 4 | 5; glow?: boolean }) {
  // viewBox 40x50，底部 y=48 是土壤線
  return (
    <svg viewBox="0 0 40 50" className={`size-full ${glow ? 'drop-shadow-[0_0_6px_rgba(251,146,60,0.6)]' : ''}`} aria-hidden="true">
      {/* 土壤 */}
      <ellipse cx="20" cy="47" rx="14" ry="2.5" fill="#b08968" />
      <ellipse cx="20" cy="46" rx="12" ry="1.5" fill="#ddb892" />

      {stage === 0 && (
        // 空地：只有土 + 一根小草
        <path d="M20 46 L20 43 M18 46 L19 44 M22 46 L21 44" stroke="#a8c686" strokeWidth="0.8" strokeLinecap="round" />
      )}

      {stage === 1 && (
        // 幼苗：短莖 + 兩片嫩葉
        <g>
          <path d="M20 46 L20 38" stroke="#7cb342" strokeWidth="1.2" strokeLinecap="round" />
          <ellipse cx="17" cy="39" rx="2.5" ry="1.6" fill="#9ccc65" transform="rotate(-30 17 39)" />
          <ellipse cx="23" cy="39" rx="2.5" ry="1.6" fill="#9ccc65" transform="rotate(30 23 39)" />
        </g>
      )}

      {stage === 2 && (
        // 小樹：細幹 + 圓葉
        <g>
          <rect x="19" y="32" width="2" height="14" fill="#8d6e63" />
          <circle cx="20" cy="28" r="7" fill="#81c784" />
          <circle cx="16" cy="31" r="3.5" fill="#a5d6a7" />
          <circle cx="24" cy="31" r="3.5" fill="#a5d6a7" />
        </g>
      )}

      {stage === 3 && (
        // 樹：中幹 + 豐滿樹冠
        <g>
          <rect x="18" y="28" width="4" height="18" fill="#795548" />
          <circle cx="20" cy="20" r="10" fill="#66bb6a" />
          <circle cx="13" cy="24" r="5" fill="#81c784" />
          <circle cx="27" cy="24" r="5" fill="#81c784" />
          <circle cx="20" cy="14" r="5" fill="#a5d6a7" />
        </g>
      )}

      {stage === 4 && (
        // 大樹：粗幹 + 層次樹冠 + 紋理
        <g>
          <rect x="17" y="26" width="6" height="20" fill="#5d4037" />
          <path d="M19 30 L19 42 M21 28 L21 44" stroke="#3e2723" strokeWidth="0.4" opacity="0.4" />
          <circle cx="20" cy="18" r="12" fill="#43a047" />
          <circle cx="12" cy="22" r="6" fill="#66bb6a" />
          <circle cx="28" cy="22" r="6" fill="#66bb6a" />
          <circle cx="20" cy="10" r="6" fill="#81c784" />
          <circle cx="15" cy="14" r="3" fill="#a5d6a7" />
          <circle cx="26" cy="16" r="3" fill="#a5d6a7" />
        </g>
      )}

      {stage === 5 && (
        // 古樹：最粗 + 果實點綴
        <g>
          <rect x="16" y="24" width="8" height="22" fill="#4e342e" />
          <path d="M18 28 L18 42 M22 28 L22 44 M20 26 L20 44" stroke="#3e2723" strokeWidth="0.5" opacity="0.5" />
          <circle cx="20" cy="16" r="14" fill="#2e7d32" />
          <circle cx="10" cy="20" r="7" fill="#43a047" />
          <circle cx="30" cy="20" r="7" fill="#43a047" />
          <circle cx="20" cy="7" r="7" fill="#66bb6a" />
          <circle cx="14" cy="12" r="3" fill="#81c784" />
          <circle cx="26" cy="12" r="3" fill="#81c784" />
          {/* 果實 */}
          <circle cx="14" cy="18" r="1.2" fill="#ef5350" />
          <circle cx="25" cy="22" r="1.2" fill="#ef5350" />
          <circle cx="19" cy="13" r="1.2" fill="#ef5350" />
        </g>
      )}
    </svg>
  );
}

export function StreakCard({ totalResponses = 0 }: { totalResponses?: number }) {
  const [data, setData] = useState<StreakData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/streak')
      .then((r) => {
        if (!r.ok) {
          throw new Error('fetch streak failed');
        }
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return null;
  }

  if (!data) {
    return <div className="h-44 animate-pulse rounded-xl border bg-card p-5" aria-label="載入中" />;
  }

  const DAYS = ['一', '二', '三', '四', '五', '六', '日'];
  const dow = getTaipeiDayOfWeek();
  const todayIndex = dow === 0 ? 6 : dow - 1;
  const maxStage = stageFromResponses(totalResponses);
  const activeCount = data.weeklyActivity.filter(Boolean).length;

  // 森林進度：0 ~ 100，讓使用者看見距離下個階段多遠
  const thresholds = [0, 5, 15, 40, 100];
  const nextThreshold = thresholds[maxStage + 1];
  const progressPercent = nextThreshold
    ? Math.min(100, Math.round((totalResponses / nextThreshold) * 100))
    : 100;

  return (
    <div className="relative overflow-hidden rounded-xl border border-amber-200/60 bg-gradient-to-b from-amber-50 via-orange-50/70 to-yellow-100/80 p-5 shadow-sm">
      {/* 沙漠沙丘背景 */}
      <svg
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full opacity-60"
        viewBox="0 0 400 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M0 70 Q100 40 200 60 T400 55 L400 100 L0 100 Z" fill="#f5deb3" opacity="0.5" />
        <path d="M0 85 Q120 65 240 78 T400 75 L400 100 L0 100 Z" fill="#e6c98a" opacity="0.6" />
      </svg>

      {/* 太陽光暈（右上角） */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 size-40 rounded-full opacity-50"
        style={{ background: 'radial-gradient(circle, rgba(253,186,116,0.55) 0%, rgba(253,186,116,0) 70%)' }}
        aria-hidden="true"
      />

      {/* 標題 */}
      <div className="relative mb-3 flex items-center justify-center">
        <span className="text-sm font-bold tracking-wide text-amber-900 drop-shadow-sm">
          考完成績馬上到…
        </span>
      </div>

      {/* 頭部：連勝 + 森林規模 */}
      <div className="relative mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden="true">🔥</span>
          <div>
            <p className="text-2xl font-bold leading-none text-amber-950">
              {data.currentStreak}
              <span className="ml-1 text-sm font-normal text-amber-900/70">天連勝</span>
            </p>
            <p className="mt-1 text-xs text-amber-900/60">
              最長紀錄：
              {data.longestStreak}
              {' '}
              天
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-xs font-semibold text-emerald-800">
            🌴
            {' '}
            {stageLabel(maxStage)}
          </p>
          <p className="mt-0.5 text-[11px] text-amber-900/70">
            學生已答題
            {' '}
            <span className="font-semibold text-amber-950">{totalResponses}</span>
            {' '}
            次
          </p>
          {data.freezesLeft > 0 && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] text-blue-600">
              <span aria-hidden="true">❄️</span>
              <span>
                補簽 ×
                {data.freezesLeft}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 本週七格：沙地中的綠洲 */}
      <div className="relative flex gap-1.5">
        {DAYS.map((day, i) => {
          const isActive = data.weeklyActivity[i];
          const isToday = i === todayIndex;
          const isFuture = i > todayIndex;
          const stage: 0 | 1 | 2 | 3 | 4 | 5 = isActive ? maxStage : 0;

          return (
            <div key={day} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={`relative aspect-[4/5] w-full overflow-hidden rounded-lg border bg-gradient-to-b transition-all ${
                  isFuture
                    ? 'border-amber-100 from-amber-50/40 to-yellow-100/40 opacity-50'
                    : isActive
                      ? 'border-emerald-200 from-sky-100 via-emerald-50 to-amber-100 shadow-inner'
                      : 'border-amber-200/70 from-amber-100 to-yellow-200/70'
                } ${isToday && isActive ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-amber-50' : ''}`}
              >
                <Tree stage={stage} glow={isToday && isActive} />
              </div>
              <span className={`text-[10px] ${isToday ? 'font-bold text-orange-600' : 'text-amber-900/70'}`}>
                {day}
              </span>
            </div>
          );
        })}
      </div>

      {/* 進度條：距離下一個森林階段 */}
      {maxStage < 5 && (
        <div className="relative mt-4">
          <div className="mb-1 flex items-center justify-between text-[11px] text-amber-900/70">
            <span>
              本週
              {' '}
              <span className="font-semibold text-emerald-700">{activeCount}</span>
              {' '}
              天有栽種
            </span>
            <span>
              再
              {' '}
              <span className="font-semibold text-amber-900">{Math.max(0, (nextThreshold ?? 0) - totalResponses)}</span>
              {' '}
              次答題升級
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-amber-200/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-400 via-amber-500 to-emerald-500 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {maxStage === 5 && (
        <p className="relative mt-4 text-center text-xs font-medium text-emerald-800">
          🌲 您的班級已成為一片綠洲！學生累積
          {' '}
          {totalResponses}
          {' '}
          次答題
        </p>
      )}
    </div>
  );
}
