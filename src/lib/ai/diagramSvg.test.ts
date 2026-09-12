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
