import { describe, expect, it, vi } from 'vitest';

import { assertSvgSafe, attachDiagramSvgs, DiagramTooComplexError, escapeSvgText, renderDiagramSvg } from './diagramSvg';

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

// attachDiagramSvgs 會 mutate 傳入陣列(拿掉 diagram、加上 diagramSvg),
// 測試用的陣列型別要跟函式簽章一致,不然 TS 會用字面值型別推斷,讀不到 mutate 後新增的欄位
type TestQuestion = { type: string; diagram?: unknown; diagramSvg?: string };

describe('attachDiagramSvgs', () => {
  it('mc 題型帶合法 diagram → 附上 diagramSvg,拿掉 diagram', () => {
    const questions: TestQuestion[] = [
      { type: 'mc', diagram: { type: 'flow', steps: ['A', 'B'] } },
    ];
    attachDiagramSvgs(questions);

    expect(questions[0]!.diagramSvg).toContain('<svg');
    expect(questions[0]!.diagram).toBeUndefined();
  });

  it('short 題型即使帶 diagram 也不附圖(不在適用題型內)', () => {
    const questions: TestQuestion[] = [
      { type: 'short', diagram: { type: 'flow', steps: ['A', 'B'] } },
    ];
    attachDiagramSvgs(questions);

    expect(questions[0]!.diagramSvg).toBeUndefined();
    expect(questions[0]!.diagram).toBeUndefined();
  });

  it('diagram 資料超出範本上限 → fail-open,不附圖也不拋出', () => {
    // 預期會觸發 console.warn(fail-open 的提示訊息),故意 mock 掉避免測試環境的
    // console.warn 攔截器(vitest-fail-on-console)誤判成未預期的錯誤
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const questions: TestQuestion[] = [
      { type: 'mc', diagram: { type: 'flow', steps: ['只有一步'] } },
    ];

    expect(() => attachDiagramSvgs(questions)).not.toThrow();
    expect(questions[0]!.diagramSvg).toBeUndefined();

    warnSpy.mockRestore();
  });

  it('沒有 diagram 欄位的題目不受影響', () => {
    const questions: TestQuestion[] = [{ type: 'mc' }];
    attachDiagramSvgs(questions);

    expect(questions[0]!.diagramSvg).toBeUndefined();
  });
});
