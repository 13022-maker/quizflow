# AI 出題附概念圖（SVG 圖解題）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 出題（文字模式 + 檔案模式）針對 mc/tf/fill 題型自動判斷是否需要圖解，若需要則附上一張自包含 SVG（4 種範本之一：流程/比較/時間軸/概念關係），渲染在學生作答頁與教材靜態匯出頁。

**Architecture:** AI 只回傳結構化語意資料（不回傳 SVG markup），`src/lib/ai/diagramSvg.ts` 用 4 個純函式 template 把資料渲染成最終 SVG 字串，存進 `question.diagram_svg`。AI 拿不到 SVG 語法控制權，是整個安全模型的基礎——sanitizer 只需處理「AI 文字插進 template 前要 escape」，不用擋整個 SVG 語法空間。

**Tech Stack:** Next.js API Routes、Drizzle ORM、Zod、Vitest。不新增任何依賴（不裝 dompurify/sanitize-html）。

**Spec:** `docs/superpowers/specs/2026-09-12-ai-diagram-svg-design.md`

## Global Constraints

- 語言：UI 文字、錯誤訊息、程式碼註解一律繁體中文；變數/函式/檔案名一律英文
- 每題 SVG 只能是 4 種範本之一（flow/compare/timeline/concept），AI 不得自由手刻 SVG markup
- 只有 mc（單選/多選）、tf（是非）、fill（填空）題型可附圖；short/rank/cloze/listening 不附圖
- 所有插進 SVG template 的 AI 文字都必須先過 `escapeSvgText`，沒有例外路徑
- 圖解生成失敗（超出範本上限或安全檢查未過）→ 該題單純不附圖，fail-open，不擋整批出題
- v1 範圍**不含**：docx 匯出（`quizExport.ts`/`teacherExam.ts`）、學生詳解區塊、老師成績頁、`textModel.ts` 遷移、通用 SVG sanitizer 套件
- 每個 Task 完成後跑 `npm run build && npm run check-types && npm run lint && npm run test`，四項都要有 fresh 輸出、0 failures，才進下一個 Task
- Migration 檔放 `migrations/`（非 `drizzle/`）；產生後手動檢查 SQL，刪掉不屬於本次改動的 CREATE/ALTER；每條 SQL 後要有 `--> statement-breakpoint`（專案已知踩坑，漏了 PG/PGlite 會炸 42601）

**Task 對應 spec checkpoint**：Task 1 = checkpoint 1（Schema）；Task 2-3 = checkpoint 2+3（AI 生成 + 安全，兩者共用同一個檔案，安全機制寫在生成邏輯之前）；Task 4-6 = checkpoint 2 延伸（接線）；Task 7 = checkpoint 4（渲染）；Task 8 = checkpoint 5（Export）。

---

## Task 1: Schema — 新增 `diagram_svg` 欄位

**Files:**
- Modify: `src/models/Schema.ts:188`（`questionSchema` 內，緊鄰 `imageUrl`）
- Create: `migrations/00XX_xxx.sql`（`npm run db:generate` 自動產生，檔名事先無法得知）

**Interfaces:**
- Produces: `questionSchema.diagramSvg`（Drizzle 欄位，`InferSelectModel<typeof questionSchema>` 會自動帶出 `diagramSvg: string | null`，後續 Task 直接用這個型別，不用另外宣告）

- [ ] **Step 1: 加欄位**

在 `src/models/Schema.ts` 的 `questionSchema` 定義裡，`imageUrl` 那一行後面加一行：

```ts
  imageUrl: text('image_url'), // 題目圖片網址
  diagramSvg: text('diagram_svg'), // AI 自動生成的圖解 SVG(4 種範本之一:流程/比較/時間軸/概念關係;無則 null)
  audioUrl: text('audio_url'), // 聽力題音檔網址（Vercel Blob）
```

- [ ] **Step 2: 產生 migration**

Run: `npm run db:generate`

檢查新產生的 `migrations/*.sql` 檔案：
- 只保留 `ALTER TABLE "question" ADD COLUMN "diagram_svg" text;` 這一條（加上 `--> statement-breakpoint`）
- 若檔案裡出現任何跟這次改動無關的 `CREATE TABLE` / `ALTER TABLE`（已知的 migration snapshot 脫鉤問題），手動刪除，只留 diagram_svg 那一條

- [ ] **Step 3: 型別檢查**

Run: `npm run check-types`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/models/Schema.ts migrations/
git commit -m "feat(schema): 新增 question.diagram_svg 欄位"
```

---

## Task 2: SVG 安全原語 — `escapeSvgText` + `assertSvgSafe`

**Files:**
- Create: `src/lib/ai/diagramSvg.ts`
- Test: `src/lib/ai/diagramSvg.test.ts`

**Interfaces:**
- Produces:
  - `export class DiagramTooComplexError extends Error {}`
  - `export function escapeSvgText(str: string): string`
  - `export function assertSvgSafe(svg: string): void`（命中禁止內容則 throw 一般 `Error`）

- [ ] **Step 1: 寫失敗測試**

Create `src/lib/ai/diagramSvg.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { assertSvgSafe, escapeSvgText } from './diagramSvg';

describe('escapeSvgText', () => {
  it('把 < > & " \' 都轉成 XML entity', () => {
    expect(escapeSvgText('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeSvgText('A & B "quoted" \'single\'')).toBe(
      'A &amp; B &quot;quoted&quot; &apos;single&apos;',
    );
  });

  it('沒有特殊字元的一般文字原樣輸出', () => {
    expect(escapeSvgText('光合作用')).toBe('光合作用');
  });
});

describe('assertSvgSafe', () => {
  it('乾淨的 SVG 不會 throw', () => {
    const svg = '<svg viewBox="0 0 10 10"><text x="1" y="1">安全</text></svg>';
    expect(() => assertSvgSafe(svg)).not.toThrow();
  });

  it('包含 <script> 會 throw', () => {
    const svg = '<svg><script>alert(1)</script></svg>';
    expect(() => assertSvgSafe(svg)).toThrow();
  });

  it('包含事件屬性(onload=)會 throw', () => {
    const svg = '<svg onload="alert(1)"><text>x</text></svg>';
    expect(() => assertSvgSafe(svg)).toThrow();
  });

  it('包含 javascript: 協議會 throw', () => {
    const svg = '<svg><a href="javascript:alert(1)">x</a></svg>';
    expect(() => assertSvgSafe(svg)).toThrow();
  });
});
```

- [ ] **Step 2: 執行測試,確認失敗**

Run: `npx vitest run src/lib/ai/diagramSvg.test.ts`
Expected: FAIL（`./diagramSvg` 模組不存在）

- [ ] **Step 3: 寫最小實作**

Create `src/lib/ai/diagramSvg.ts`：

```ts
/**
 * AI 出題圖解 SVG 產生器。
 *
 * AI 只回傳結構化語意資料(見下方 DiagramData),SVG markup 完全由這支檔案的 4 個
 * template 渲染函式產生 —— AI 從頭到尾拿不到 SVG 語法控制權,是這支檔案安全模型
 * 的基礎:文字插進 template 前一律先過 escapeSvgText,assertSvgSafe 是防禦性最後
 * 一關(理論上永遠不該觸發)。詳見 docs/superpowers/specs/2026-09-12-ai-diagram-svg-design.md
 */

export class DiagramTooComplexError extends Error {}

/**
 * 所有插進 SVG template 的 AI 文字都必須先過這層,沒有例外路徑。
 */
export function escapeSvgText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 防禦性最後一關(belt-and-suspenders):理論上這些字串永遠不會出現在我們自己的
 * template 輸出裡(template 本身沒有這些標籤/屬性),純粹防未來改 template 時手滑。
 */
export function assertSvgSafe(svg: string): void {
  const forbidden = [
    /<script/i,
    /on\w+\s*=/i,
    /javascript:/i,
    /<foreignObject/i,
    /(?:xlink:)?href\s*=/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(svg)) {
      throw new Error(`assertSvgSafe: 輸出包含禁止的內容(命中 ${pattern})`);
    }
  }
}
```

- [ ] **Step 4: 執行測試,確認通過**

Run: `npx vitest run src/lib/ai/diagramSvg.test.ts`
Expected: PASS（8 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/diagramSvg.ts src/lib/ai/diagramSvg.test.ts
git commit -m "feat(ai): 新增 SVG 安全原語 escapeSvgText/assertSvgSafe"
```

---

## Task 3: 4 種圖型 template 渲染器 + `renderDiagramSvg` 分派器

**Files:**
- Modify: `src/lib/ai/diagramSvg.ts`（延續 Task 2）
- Modify: `src/lib/ai/diagramSvg.test.ts`（延續 Task 2）

**Interfaces:**
- Consumes: `escapeSvgText`、`assertSvgSafe`、`DiagramTooComplexError`（Task 2 產出）
- Produces:
  - `export type FlowDiagram = { type: 'flow'; steps: string[] }`
  - `export type CompareDiagram = { type: 'compare'; leftTitle: string; leftPoints: string[]; rightTitle: string; rightPoints: string[] }`
  - `export type TimelineDiagram = { type: 'timeline'; events: { label: string; note?: string }[] }`
  - `export type ConceptDiagram = { type: 'concept'; nodes: string[]; edges: { from: string; to: string; label?: string }[] }`
  - `export type DiagramData = FlowDiagram | CompareDiagram | TimelineDiagram | ConceptDiagram`
  - `export function renderDiagramSvg(data: DiagramData): string`（丟 `DiagramTooComplexError` 或回傳完整 `<svg>...</svg>`）

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/ai/diagramSvg.test.ts` 加入（`import` 那行要加上新符號）：

```ts
import { assertSvgSafe, DiagramTooComplexError, escapeSvgText, renderDiagramSvg } from './diagramSvg';
```

```ts
describe('renderDiagramSvg - flow', () => {
  it('產生含 3 個步驟文字的 SVG', () => {
    const svg = renderDiagramSvg({ type: 'flow', steps: ['吸收陽光', '產生葡萄糖', '釋放氧氣'] });
    expect(svg).toContain('<svg');
    expect(svg).toContain('吸收陽光');
    expect(svg).toContain('產生葡萄糖');
    expect(svg).toContain('釋放氧氣');
  });

  it('步驟數少於 2 或多於 6 會丟 DiagramTooComplexError', () => {
    expect(() => renderDiagramSvg({ type: 'flow', steps: ['只有一步'] })).toThrow(DiagramTooComplexError);
    expect(() => renderDiagramSvg({
      type: 'flow',
      steps: ['1', '2', '3', '4', '5', '6', '7'],
    })).toThrow(DiagramTooComplexError);
  });

  it('步驟文字含惡意內容時,輸出裡的 < > 已被 escape,不會出現可執行的 <script>', () => {
    const svg = renderDiagramSvg({
      type: 'flow',
      steps: ['正常步驟', '"><script>alert(1)</script>'],
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

describe('renderDiagramSvg - compare', () => {
  it('產生含左右兩欄標題與要點的 SVG', () => {
    const svg = renderDiagramSvg({
      type: 'compare',
      leftTitle: '光合作用',
      leftPoints: ['吸收 CO2', '釋放 O2'],
      rightTitle: '呼吸作用',
      rightPoints: ['吸收 O2', '釋放 CO2'],
    });
    expect(svg).toContain('光合作用');
    expect(svg).toContain('呼吸作用');
    expect(svg).toContain('吸收 CO2');
  });

  it('每欄點數超過 5 會丟 DiagramTooComplexError', () => {
    expect(() => renderDiagramSvg({
      type: 'compare',
      leftTitle: 'A',
      leftPoints: ['1', '2', '3', '4', '5', '6'],
      rightTitle: 'B',
      rightPoints: ['1'],
    })).toThrow(DiagramTooComplexError);
  });
});

describe('renderDiagramSvg - timeline', () => {
  it('產生含事件標籤與備註的 SVG', () => {
    const svg = renderDiagramSvg({
      type: 'timeline',
      events: [
        { label: '文藝復興' },
        { label: '工業革命', note: '18 世紀' },
      ],
    });
    expect(svg).toContain('文藝復興');
    expect(svg).toContain('工業革命');
    expect(svg).toContain('18 世紀');
  });

  it('事件數少於 2 或多於 6 會丟 DiagramTooComplexError', () => {
    expect(() => renderDiagramSvg({ type: 'timeline', events: [{ label: '只有一個' }] }))
      .toThrow(DiagramTooComplexError);
  });
});

describe('renderDiagramSvg - concept', () => {
  it('產生含節點與關係標籤的 SVG', () => {
    const svg = renderDiagramSvg({
      type: 'concept',
      nodes: ['光合作用', '葡萄糖', '氧氣'],
      edges: [
        { from: '光合作用', to: '葡萄糖', label: '產生' },
        { from: '光合作用', to: '氧氣', label: '釋放' },
      ],
    });
    expect(svg).toContain('光合作用');
    expect(svg).toContain('葡萄糖');
    expect(svg).toContain('產生');
  });

  it('節點數超過 6 或關係數超過 8 會丟 DiagramTooComplexError', () => {
    expect(() => renderDiagramSvg({
      type: 'concept',
      nodes: ['1', '2', '3', '4', '5', '6', '7'],
      edges: [],
    })).toThrow(DiagramTooComplexError);
  });

  it('edge 參照到不存在的節點會丟 DiagramTooComplexError', () => {
    expect(() => renderDiagramSvg({
      type: 'concept',
      nodes: ['A', 'B'],
      edges: [{ from: 'A', to: '不存在的節點' }],
    })).toThrow(DiagramTooComplexError);
  });
});

describe('renderDiagramSvg - 輸出一定通過 assertSvgSafe', () => {
  it.each([
    { type: 'flow' as const, steps: ['a', 'b'] },
    { type: 'timeline' as const, events: [{ label: 'a' }, { label: 'b' }] },
  ])('$type 型別產生的 SVG 不會被 assertSvgSafe 擋下', (data) => {
    expect(() => assertSvgSafe(renderDiagramSvg(data))).not.toThrow();
  });
});
```

（`escapeSvgText` import 保留是因為 Task 2 的測試還在同一個檔案裡）

- [ ] **Step 2: 執行測試,確認失敗**

Run: `npx vitest run src/lib/ai/diagramSvg.test.ts`
Expected: FAIL（`renderDiagramSvg` 未定義）

- [ ] **Step 3: 實作 4 個 template + 分派器**

在 `src/lib/ai/diagramSvg.ts` 尾端加入：

```ts
export type FlowDiagram = { type: 'flow'; steps: string[] };
export type CompareDiagram = {
  type: 'compare';
  leftTitle: string;
  leftPoints: string[];
  rightTitle: string;
  rightPoints: string[];
};
export type TimelineDiagram = {
  type: 'timeline';
  events: { label: string; note?: string }[];
};
export type ConceptDiagram = {
  type: 'concept';
  nodes: string[];
  edges: { from: string; to: string; label?: string }[];
};
export type DiagramData = FlowDiagram | CompareDiagram | TimelineDiagram | ConceptDiagram;

// 統一風格常數(比照 src/lib/exportPracticePage.ts 既有色票,跟站內其他匯出頁一致)
const INK = '#0f2540';
const BLUE = '#1e5a8a';
const BLUE_LINE = '#b9d3e8';
const BLUE_SOFT = '#dceaf5';
const FONT = '-apple-system,BlinkMacSystemFont,\'PingFang TC\',\'Microsoft JhengHei\',\'Noto Sans TC\',sans-serif';

function renderFlow(data: FlowDiagram): string {
  const { steps } = data;
  if (steps.length < 2 || steps.length > 6) {
    throw new DiagramTooComplexError(`flow 步驟數需在 2-6 之間,收到 ${steps.length}`);
  }
  const boxW = 150;
  const boxH = 56;
  const gap = 40;
  const padding = 16;
  const width = steps.length * boxW + (steps.length - 1) * gap + padding * 2;
  const height = boxH + padding * 2;
  const cy = height / 2;

  const boxes = steps.map((step, i) => {
    const x = padding + i * (boxW + gap);
    const text = escapeSvgText(step);
    const arrow = i < steps.length - 1
      ? `<line x1="${x + boxW}" y1="${cy}" x2="${x + boxW + gap - 8}" y2="${cy}" stroke="${BLUE}" stroke-width="2" marker-end="url(#flow-arrow)" />`
      : '';
    return `
    <rect x="${x}" y="${padding}" width="${boxW}" height="${boxH}" rx="10" fill="${BLUE_SOFT}" stroke="${BLUE_LINE}" stroke-width="1.5" />
    <text x="${x + boxW / 2}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}" font-size="14" font-weight="600" fill="${INK}">${text}</text>
    ${arrow}`;
  }).join('\n');

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="${BLUE}" />
    </marker>
  </defs>
  ${boxes}
</svg>`;
}

function renderCompare(data: CompareDiagram): string {
  const { leftTitle, leftPoints, rightTitle, rightPoints } = data;
  if (leftPoints.length < 1 || leftPoints.length > 5 || rightPoints.length < 1 || rightPoints.length > 5) {
    throw new DiagramTooComplexError(
      `compare 每欄點數需在 1-5 之間,收到 left=${leftPoints.length}, right=${rightPoints.length}`,
    );
  }
  const colW = 260;
  const gap = 24;
  const headerH = 40;
  const rowH = 28;
  const padding = 16;
  const rows = Math.max(leftPoints.length, rightPoints.length);
  const width = colW * 2 + gap + padding * 2;
  const height = headerH + rows * rowH + padding * 2;

  const column = (x: number, title: string, points: string[]) => {
    const header = `
    <rect x="${x}" y="${padding}" width="${colW}" height="${headerH}" rx="8" fill="${BLUE}" />
    <text x="${x + colW / 2}" y="${padding + headerH / 2}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="#fff">${escapeSvgText(title)}</text>`;
    const body = points.map((p, i) => {
      const y = padding + headerH + i * rowH + rowH / 2;
      return `<text x="${x + 16}" y="${y}" dominant-baseline="middle" font-family="${FONT}" font-size="13" fill="${INK}">・ ${escapeSvgText(p)}</text>`;
    }).join('\n');
    return `${header}
    <rect x="${x}" y="${padding + headerH}" width="${colW}" height="${rows * rowH}" fill="#fff" stroke="${BLUE_LINE}" stroke-width="1.5" />
    ${body}`;
  };

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${column(padding, leftTitle, leftPoints)}
  ${column(padding + colW + gap, rightTitle, rightPoints)}
</svg>`;
}

function renderTimeline(data: TimelineDiagram): string {
  const { events } = data;
  if (events.length < 2 || events.length > 6) {
    throw new DiagramTooComplexError(`timeline 事件數需在 2-6 之間,收到 ${events.length}`);
  }
  const stepW = 160;
  const padding = 24;
  const lineY = 70;
  const width = events.length * stepW + padding * 2;
  const height = 150;

  const items = events.map((ev, i) => {
    const x = padding + i * stepW + stepW / 2;
    const label = escapeSvgText(ev.label);
    const note = ev.note
      ? `<text x="${x}" y="${lineY + 46}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}" opacity="0.7">${escapeSvgText(ev.note)}</text>`
      : '';
    return `
    <circle cx="${x}" cy="${lineY}" r="7" fill="${BLUE}" />
    <text x="${x}" y="${lineY - 20}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="${INK}">${label}</text>
    ${note}`;
  }).join('\n');

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <line x1="${padding}" y1="${lineY}" x2="${width - padding}" y2="${lineY}" stroke="${BLUE_LINE}" stroke-width="3" />
  ${items}
</svg>`;
}

function renderConcept(data: ConceptDiagram): string {
  const { nodes, edges } = data;
  if (nodes.length < 2 || nodes.length > 6) {
    throw new DiagramTooComplexError(`concept 節點數需在 2-6 之間,收到 ${nodes.length}`);
  }
  if (edges.length > 8) {
    throw new DiagramTooComplexError(`concept 關係數不能超過 8,收到 ${edges.length}`);
  }
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 110;
  const nodeR = 40;

  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    positions.set(node, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });

  const edgeLines = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) {
      throw new DiagramTooComplexError(`concept edge 參照到不存在的節點:${edge.from} → ${edge.to}`);
    }
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const label = edge.label
      ? `<text x="${midX}" y="${midY}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${INK}" opacity="0.75">${escapeSvgText(edge.label)}</text>`
      : '';
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${BLUE_LINE}" stroke-width="1.5" />
    ${label}`;
  }).join('\n');

  const nodeCircles = nodes.map((node) => {
    const pos = positions.get(node)!;
    return `
    <circle cx="${pos.x}" cy="${pos.y}" r="${nodeR}" fill="${BLUE_SOFT}" stroke="${BLUE}" stroke-width="1.5" />
    <text x="${pos.x}" y="${pos.y}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}" font-size="12" font-weight="600" fill="${INK}">${escapeSvgText(node)}</text>`;
  }).join('\n');

  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  ${edgeLines}
  ${nodeCircles}
</svg>`;
}

export function renderDiagramSvg(data: DiagramData): string {
  let svg: string;
  switch (data.type) {
    case 'flow':
      svg = renderFlow(data);
      break;
    case 'compare':
      svg = renderCompare(data);
      break;
    case 'timeline':
      svg = renderTimeline(data);
      break;
    case 'concept':
      svg = renderConcept(data);
      break;
    default:
      throw new DiagramTooComplexError('未知的 diagram type');
  }
  assertSvgSafe(svg);
  return svg;
}
```

- [ ] **Step 4: 執行測試,確認通過**

Run: `npx vitest run src/lib/ai/diagramSvg.test.ts`
Expected: PASS（全部測試，含 Task 2 的 8 個）

- [ ] **Step 5: 全項驗證**

Run: `npm run build && npm run check-types && npm run lint && npm run test`
Expected: 0 failures（貼出完整輸出）

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/diagramSvg.ts src/lib/ai/diagramSvg.test.ts
git commit -m "feat(ai): 新增 4 種圖型 template 渲染器 renderDiagramSvg"
```

**⏸ 停在這裡等使用者 review（對應 spec checkpoint 2+3：AI 生成 + 安全）**

---

## Task 4: `attachDiagramSvgs` 共用接線函式 + 接進 `generate-questions`

**Files:**
- Modify: `src/lib/ai/diagramSvg.ts`
- Modify: `src/app/api/ai/generate-questions/route.ts`

**Interfaces:**
- Consumes: `renderDiagramSvg`、`DiagramData`（Task 3 產出）
- Produces: `export function attachDiagramSvgs(questions: Array<{ type: string; diagram?: unknown; diagramSvg?: string }>): void`（mutate 傳入陣列，成功附上 `diagramSvg`，失敗或不適用則什麼都不做）

- [ ] **Step 1: 在 `diagramSvg.ts` 加共用接線函式**

在 `src/lib/ai/diagramSvg.ts` 尾端加入：

```ts
// mc(選擇題)、tf(是非題)、fill(填空題)才可能附圖,對應兩條出題路由的 type code
const DIAGRAM_ELIGIBLE_TYPES = new Set(['mc', 'tf', 'fill']);

/**
 * 兩條出題路由(generate-questions / generate-from-file)共用:
 * 把 AI 回傳的 result.questions 裡帶 "diagram" 欄位的題目轉成 diagramSvg 字串,
 * mutate 傳入的陣列。失敗(超出範本上限/型別不符/安全檢查未過)一律 fail-open:
 * 該題單純不附圖,不拋出、不影響其他題目。
 */
export function attachDiagramSvgs(
  questions: Array<{ type: string; diagram?: unknown; diagramSvg?: string }>,
): void {
  for (const q of questions) {
    if (!q.diagram || !DIAGRAM_ELIGIBLE_TYPES.has(q.type)) {
      delete q.diagram;
      continue;
    }
    try {
      q.diagramSvg = renderDiagramSvg(q.diagram as DiagramData);
    } catch (err) {
      console.warn(
        '[diagramSvg] 圖解生成失敗,該題不附圖:',
        err instanceof Error ? err.message : err,
      );
    }
    delete q.diagram;
  }
}
```

- [ ] **Step 2: 寫測試**

在 `src/lib/ai/diagramSvg.test.ts` 加入（import 加上 `attachDiagramSvgs`）：

```ts
describe('attachDiagramSvgs', () => {
  it('mc 題型帶合法 diagram → 附上 diagramSvg,拿掉 diagram', () => {
    const questions = [
      { type: 'mc', diagram: { type: 'flow', steps: ['A', 'B'] } },
    ];
    attachDiagramSvgs(questions);
    expect(questions[0]!.diagramSvg).toContain('<svg');
    expect(questions[0]!.diagram).toBeUndefined();
  });

  it('short 題型即使帶 diagram 也不附圖(不在適用題型內)', () => {
    const questions = [
      { type: 'short', diagram: { type: 'flow', steps: ['A', 'B'] } },
    ];
    attachDiagramSvgs(questions);
    expect(questions[0]!.diagramSvg).toBeUndefined();
    expect(questions[0]!.diagram).toBeUndefined();
  });

  it('diagram 資料超出範本上限 → fail-open,不附圖也不拋出', () => {
    const questions = [
      { type: 'mc', diagram: { type: 'flow', steps: ['只有一步'] } },
    ];
    expect(() => attachDiagramSvgs(questions)).not.toThrow();
    expect(questions[0]!.diagramSvg).toBeUndefined();
  });

  it('沒有 diagram 欄位的題目不受影響', () => {
    const questions = [{ type: 'mc' }];
    attachDiagramSvgs(questions);
    expect(questions[0]!.diagramSvg).toBeUndefined();
  });
});
```

- [ ] **Step 3: 執行測試,確認通過**

Run: `npx vitest run src/lib/ai/diagramSvg.test.ts`
Expected: PASS

- [ ] **Step 4: 接進 `generate-questions/route.ts`**

在檔案頂端 import 區加：

```ts
import { attachDiagramSvgs } from '@/lib/ai/diagramSvg';
```

在 prompt 組裝區（`answerDistNote` 定義之後，`const prompt = ...` 之前）加：

```ts
  // 圖解規則:只套用到 mc/tf/fill 題型,4 種範本形狀由 code 端 renderDiagramSvg 鎖死,
  // AI 只出結構化資料,不出 SVG markup(見 src/lib/ai/diagramSvg.ts)
  const diagramNote = `

若某題(限選擇題 mc、是非題 tf、填空題 fill)的內容適合用圖表輔助理解（流程步驟、兩者比較、時間先後、概念之間的關係），在該題 JSON 加一個 "diagram" 欄位，格式為以下 4 種之一（不適合就完全不要加這個欄位，不是每題都需要圖，大部分題目不需要）：
- 流程：{"type":"flow","steps":["步驟1","步驟2",...]}（2-6 步）
- 比較：{"type":"compare","leftTitle":"...","leftPoints":["..."],"rightTitle":"...","rightPoints":["..."]}（每欄 1-5 點）
- 時間軸：{"type":"timeline","events":[{"label":"...","note":"..."}]}（2-6 個事件，note 可省略）
- 概念關係：{"type":"concept","nodes":["A","B",...],"edges":[{"from":"A","to":"B","label":"..."}]}（2-6 節點，最多 8 條關係，label 可省略）`;
```

把 `const prompt = \`...\`` 模板字串結尾（目前是 `${answerDistNote}${listeningNote}\`;`）改成：

```ts
每種題型各出 ${count} 題，只出勾選的題型，所有文字使用繁體中文。${answerDistNote}${listeningNote}${diagramNote}`;
```

在「後處理：確保聽力題 type 正確」區塊之後、`return NextResponse.json(result)` 之前加：

```ts
  // 圖解:mc/tf/fill 題型若 AI 判斷需要,附上 diagramSvg(fail-open,失敗就不附圖)
  if (result.questions) {
    attachDiagramSvgs(result.questions);
  }

```

- [ ] **Step 5: 全項驗證**

Run: `npm run build && npm run check-types && npm run lint && npm run test`
Expected: 0 failures（貼出完整輸出）

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/diagramSvg.ts src/lib/ai/diagramSvg.test.ts src/app/api/ai/generate-questions/route.ts
git commit -m "feat(ai): generate-questions 接上圖解生成"
```

---

## Task 5: 接進 `generate-from-file`

**Files:**
- Modify: `src/app/api/ai/generate-from-file/route.ts`

**Interfaces:**
- Consumes: `attachDiagramSvgs`（Task 4 產出）

- [ ] **Step 1: import**

檔案頂端加：

```ts
import { attachDiagramSvgs } from '@/lib/ai/diagramSvg';
```

- [ ] **Step 2: prompt 加規則**

在非音檔分支的 prompt 模板（`: \`請根據以上文件內容出題...\`` 那段）結尾，把：

```ts
聽力題特別注意：
- type 必須為 "listening"
- 必須提供 listeningText 欄位：根據文件內容改寫成口語化的短文或對話，模擬真實聽力情境
- listeningText 控制在 50-200 字`
  : ''}`;
```

改成：

```ts
聽力題特別注意：
- type 必須為 "listening"
- 必須提供 listeningText 欄位：根據文件內容改寫成口語化的短文或對話，模擬真實聽力情境
- listeningText 控制在 50-200 字`
  : ''}

若某題(限選擇題 mc、是非題 tf、填空題 fill)的內容適合用圖表輔助理解（流程步驟、兩者比較、時間先後、概念之間的關係），在該題 JSON 加一個 "diagram" 欄位，格式為以下 4 種之一（不適合就完全不要加這個欄位，不是每題都需要圖，大部分題目不需要）：
- 流程：{"type":"flow","steps":["步驟1","步驟2",...]}（2-6 步）
- 比較：{"type":"compare","leftTitle":"...","leftPoints":["..."],"rightTitle":"...","rightPoints":["..."]}（每欄 1-5 點）
- 時間軸：{"type":"timeline","events":[{"label":"...","note":"..."}]}（2-6 個事件，note 可省略）
- 概念關係：{"type":"concept","nodes":["A","B",...],"edges":[{"from":"A","to":"B","label":"..."}]}（2-6 節點，最多 8 條關係，label 可省略）`;
```

（音檔分支的聽力題 prompt 不用改——聽力題 type 不在適用範圍內）

- [ ] **Step 3: 接 `attachDiagramSvgs`**

在「後處理：確保聽力題 type 正確」區塊之後、`return NextResponse.json(result)` 之前加：

```ts
    // 圖解:mc/tf/fill 題型若 AI 判斷需要,附上 diagramSvg(fail-open,失敗就不附圖)
    if (result.questions) {
      attachDiagramSvgs(result.questions);
    }

```

- [ ] **Step 4: 全項驗證**

Run: `npm run build && npm run check-types && npm run lint && npm run test`
Expected: 0 failures（貼出完整輸出）

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/generate-from-file/route.ts
git commit -m "feat(ai): generate-from-file 接上圖解生成"
```

**⏸ 停在這裡等使用者 review（對應 spec checkpoint 2 收尾：兩條出題路由都接好）**

---

## Task 6: 存檔路徑接線 — client 型別 + `questionActions.ts` + 批次匯入 route

**Files:**
- Modify: `src/components/quiz/AIQuizModal.tsx:36-46`（`GeneratedQuestion` type）
- Modify: `src/components/quiz/FileQuizGenerator.tsx:7`（`GeneratedQuestion` type）
- Modify: `src/features/quiz/QuizEditor.tsx:60-79`（`FileGeneratedQuestion`、`AIGeneratedQuestion` type）+ `handleFileImport` 三個 `createQuestion` call site（約 530/541/553 行）
- Modify: `src/actions/questionActions.ts:25-132`（`QuestionInputSchema` + `createQuestion`/`updateQuestion` 的 insert/update）
- Modify: `src/app/api/quizzes/[id]/questions/route.ts:17-166`（`GeneratedQuestion` type + `rows.map()`）

**Interfaces:**
- Consumes: `question.diagramSvg`（`InferSelectModel<typeof questionSchema>`，Task 1 產出）
- Produces: 無新符號，純粹讓 `diagramSvg` 從 AI 回傳一路帶到 DB insert/update（比照現有 `imageUrl` 完全同一套路徑）

- [ ] **Step 1: `AIQuizModal.tsx` 型別加欄位**

`GeneratedQuestion` type 的 `imageUrl?: string;` 那行後面加：

```ts
  imageUrl?: string; // 題目圖片網址（目前只有「題庫匯入」PDF 模式會帶，自動比對出的圖已上傳到 Blob）
  diagramSvg?: string; // AI 自動生成的圖解 SVG(mc/tf/fill 題型才可能有;由 generate-questions/generate-from-file 附上)
```

- [ ] **Step 2: `FileQuizGenerator.tsx` 型別加欄位**

同樣在該檔案第 7 行的 `GeneratedQuestion` type 裡加一行 `diagramSvg?: string;`（比照 Step 1 的註解）。

- [ ] **Step 3: `QuizEditor.tsx` 兩個型別加欄位**

`FileGeneratedQuestion` type（第 60-66 行）與 `AIGeneratedQuestion` type（第 70-79 行）都加一行：

```ts
  diagramSvg?: string; // AI 自動生成的圖解 SVG(mc/tf/fill 題型才可能有)
```

- [ ] **Step 4: `handleFileImport` 三個 `createQuestion` call site 帶入 `diagramSvg`**

在 `handleFileImport` 裡（約第 510-559 行），三個 `await createQuestion(initialQuiz.id, {...})` 呼叫都各加一行 `diagramSvg: q.diagramSvg || undefined,`。

第一處（mc 分支）：

```ts
        await createQuestion(initialQuiz.id, {
          type,
          body: q.question,
          options,
          correctAnswers: matched ? [matched.id] : undefined,
          diagramSvg: q.diagramSvg || undefined,
          points: 1,
        });
```

第二處（tf 分支）：

```ts
        await createQuestion(initialQuiz.id, {
          type,
          body: q.question,
          options: [
            { id: 'tf-true', text: '正確' },
            { id: 'tf-false', text: '錯誤' },
          ],
          correctAnswers: [isTrue ? 'tf-true' : 'tf-false'],
          diagramSvg: q.diagramSvg || undefined,
          points: 1,
        });
```

第三處（fill / short 分支，else 區塊）：

```ts
        await createQuestion(initialQuiz.id, {
          type,
          body: q.question,
          correctAnswers: q.answer ? [q.answer] : undefined,
          diagramSvg: q.diagramSvg || undefined,
          points: 1,
        });
```

- [ ] **Step 5: `questionActions.ts` — `QuestionInputSchema` 加欄位 + insert/update 帶入**

在 `QuestionInputSchema` 的 `imageUrl` 那行後面加：

```ts
  imageUrl: z.string().url().optional().or(z.literal('')), // 題目圖片網址
  diagramSvg: z.string().optional(), // AI 自動生成的圖解 SVG(mc/tf/fill 題型才可能有)
```

`createQuestion` 裡 `db.insert(questionSchema).values({...})` 的 `imageUrl: parsed.data.imageUrl || null,` 那行後面加：

```ts
    imageUrl: parsed.data.imageUrl || null,
    diagramSvg: parsed.data.diagramSvg || null,
```

`updateQuestion` 裡 `.set({...})` 的同一位置同樣加：

```ts
      imageUrl: parsed.data.imageUrl || null,
      diagramSvg: parsed.data.diagramSvg || null,
```

- [ ] **Step 6: `/api/quizzes/[id]/questions/route.ts` — 批次匯入路徑帶入**

`GeneratedQuestion` type（第 17-27 行）的 `imageUrl?: string;` 那行後面加：

```ts
  imageUrl?: string; // 題目圖片網址（目前只有「題庫匯入」PDF 模式會帶）
  diagramSvg?: string; // AI 自動生成的圖解 SVG(mc/tf/fill 題型才可能有)
```

`rows.map()` 回傳物件裡 `imageUrl: q.imageUrl || null,` 那行後面加：

```ts
      imageUrl: q.imageUrl || null,
      diagramSvg: q.diagramSvg || null,
```

- [ ] **Step 7: 全項驗證**

Run: `npm run build && npm run check-types && npm run lint && npm run test`
Expected: 0 failures（貼出完整輸出）

- [ ] **Step 8: 手動驗證**

Run: `npm run dev`，用 AIQuizModal 對一個「流程」相關主題（例如「光合作用的過程」）出 3-5 題單選題，觀察：
1. API 回應（瀏覽器 devtools Network）裡是否有題目帶 `diagramSvg` 欄位
2. 匯入後，`npm run db:studio` 打開 `question` 表，確認 `diagram_svg` 欄位有存到值

- [ ] **Step 9: Commit**

```bash
git add src/components/quiz/AIQuizModal.tsx src/components/quiz/FileQuizGenerator.tsx \
  src/features/quiz/QuizEditor.tsx src/actions/questionActions.ts \
  src/app/api/quizzes/\[id\]/questions/route.ts
git commit -m "feat(quiz): diagramSvg 接通從 AI 回應到 DB 的存檔路徑"
```

**⏸ 停在這裡等使用者 review**

---

## Task 7: 學生作答頁渲染 — `QuizTaker.tsx`

**Files:**
- Modify: `src/features/quiz/QuizTaker.tsx:150-164`

**Interfaces:**
- Consumes: `question.diagramSvg`（`Question = InferSelectModel<typeof questionSchema>`，已含此欄位，不用額外宣告型別）

- [ ] **Step 1: 加渲染區塊**

在既有的「題目圖片」`{question.imageUrl && (...)}` 區塊（第 150-164 行）後面加：

```tsx
      {/* 題目圖解 SVG —— 這裡放的是 server 端 renderDiagramSvg 產生、
          已過 escapeSvgText + assertSvgSafe 的字串,禁止改成顯示使用者原始輸入 */}
      {question.diagramSvg && (
        <div
          className="mb-4 flex items-center justify-center overflow-hidden rounded-lg border border-[#e0e0e0] bg-white p-3"
          dangerouslySetInnerHTML={{ __html: question.diagramSvg }}
        />
      )}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 0 errors

- [ ] **Step 3: 手動驗證**

Run: `npm run dev`，開啟 Task 6 手動驗證時建立的測驗（含 `diagram_svg` 已存進 DB 的題目），到學生作答頁 `/quiz/[accessCode]` 確認圖解正常顯示、版面沒有跑掉。

- [ ] **Step 4: 全項驗證**

Run: `npm run build && npm run check-types && npm run lint && npm run test`
Expected: 0 failures（貼出完整輸出）

- [ ] **Step 5: Commit**

```bash
git add src/features/quiz/QuizTaker.tsx
git commit -m "feat(quiz): 學生作答頁渲染題目圖解 SVG"
```

**⏸ 停在這裡等使用者 review（對應 spec checkpoint 4：渲染）**

---

## Task 8: 教材靜態匯出嵌入 — `exportPracticePage.ts`

**Files:**
- Modify: `src/lib/exportPracticePage.ts`
- Modify: `src/app/api/quizzes/[id]/export-practice-page/route.ts:94-101`
- Test: `src/lib/exportPracticePage.test.ts`

**Interfaces:**
- Consumes: `question.diagramSvg`（Task 1 產出）
- Produces: `PracticePageQuestion.diagramSvg?: string`（新欄位）

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/exportPracticePage.test.ts` 加入一個新的 `it`：

```ts
  it('題目若有 diagramSvg,會內嵌進 QUESTIONS 資料,且畫面渲染邏輯有處理這個欄位', () => {
    const html = buildPracticePageHtml({
      title: '測試',
      kick: 'k',
      noteHtml: 'n',
      questions: [
        {
          groupLabel: 'g',
          question: '流程圖題',
          diagramSvg: '<svg viewBox="0 0 100 50"><text x="10" y="20">A</text></svg>',
          options: ['a', 'b'],
          correctIndex: 0,
        },
      ],
    });

    // JSON 裡的 "<" 全部跳脫成 <(既有機制,見 toEmbeddableJson),
    // 所以檢查跳脫後的字樣,不是原始 "<svg>"
    expect(html).toContain('"diagramSvg":"\\u003csvg');
    // 渲染邏輯要處理這個新欄位
    expect(html).toContain('function diagramHtml');
  });
```

- [ ] **Step 2: 執行測試,確認失敗**

Run: `npx vitest run src/lib/exportPracticePage.test.ts`
Expected: FAIL（`diagramSvg` 型別不存在 / `diagramHtml` 函式不存在）

- [ ] **Step 3: `PracticePageQuestion` 型別加欄位**

在 `src/lib/exportPracticePage.ts` 的 `PracticePageQuestion` type，`image?: string | false;` 那行後面加：

```ts
  image?: string | false; // '<img src="...">' 字串,或 false 表示無圖
  diagramSvg?: string; // AI 出題附的圖解 SVG(完整 <svg>...</svg> 字串,無則不填)
```

- [ ] **Step 4: client script 加 `diagramHtml` 渲染函式**

在內嵌 `<script>` 裡的 `function imageHtml(q){...}` 定義後面加：

```js
  function diagramHtml(q){
    if(!q.diagramSvg) return ''; /* 沒有圖解就不顯示 */
    return '<div class="qimg">'+q.diagramSvg+'</div>';
  }
```

把 `renderQuestion()` 裡的：

```js
    var imgHtml=imageHtml(q);
```

改成：

```js
    var imgHtml=imageHtml(q)+diagramHtml(q);
```

（沿用既有 `.qimg` CSS class，該 class 已經有 `svg{max-width:100%;height:auto}` 規則，不用加新 CSS）

- [ ] **Step 5: 執行測試,確認通過**

Run: `npx vitest run src/lib/exportPracticePage.test.ts`
Expected: PASS（全部測試）

- [ ] **Step 6: 接進 `export-practice-page/route.ts`**

在 `practiceQuestions.push({...})` 的 `image: q.imageUrl ? ... : false,` 那行後面加：

```ts
      image: q.imageUrl ? `<img src="${q.imageUrl.replace(/"/g, '&quot;')}">` : false,
      diagramSvg: q.diagramSvg || undefined,
```

- [ ] **Step 7: 全項驗證**

Run: `npm run build && npm run check-types && npm run lint && npm run test`
Expected: 0 failures（貼出完整輸出）

- [ ] **Step 8: 手動驗證**

Run: `npm run dev`，對 Task 6 建立的測驗（single_choice/true_false 題型且含 `diagram_svg`）打開「匯出教材靜態頁」功能，確認匯出的 HTML 檔案裡圖解正常顯示。

（注意：`export-practice-page/route.ts` 的 `SUPPORTED_TYPES` 目前只有 `single_choice`/`true_false`，fill 題型（DB 存為 `short_answer`）本來就不會被這個匯出功能選中——這是既有限制，本次不擴大它的範圍）

- [ ] **Step 9: Commit**

```bash
git add src/lib/exportPracticePage.ts src/lib/exportPracticePage.test.ts \
  src/app/api/quizzes/\[id\]/export-practice-page/route.ts
git commit -m "feat(quiz): 教材靜態匯出頁嵌入題目圖解 SVG"
```

**⏸ 完成，等使用者 review（對應 spec checkpoint 5：Export）**

---

## 完成後

全部 8 個 Task 做完，跑一次完整驗證：

```bash
npm run build && npm run check-types && npm run lint && npm run test
```

確認 0 failures 後，回頭看 spec 的「不做的事」清單，跟使用者確認 v1 範圍是否要在這裡結束，或是要接著做 docx 匯出（`quizExport.ts`/`teacherExam.ts`，需要額外處理 `docx` 套件的 SVG `fallback` PNG rasterize，可用既有 `sharp` 依賴）。
