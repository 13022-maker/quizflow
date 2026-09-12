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
