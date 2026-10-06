import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RichText } from './RichText';

describe('RichText', () => {
  it('沒有 code fence 的舊題目：文字原樣顯示，不產生 <pre>', () => {
    const { container } = render(<RichText text="下列何者為質數？" />);

    expect(container).toHaveTextContent('下列何者為質數？');
    expect(container.querySelector('pre')).toBeNull();
  });

  it('fenced code block 渲染成 <pre><code>，保留換行與縮排', () => {
    const { container } = render(
      <RichText text={'輸出為何？\n```c\nint main() {\n    return 0;\n}\n```'} />,
    );
    const code = container.querySelector('pre > code');

    expect(code?.textContent).toBe('int main() {\n    return 0;\n}');
    expect(container.querySelector('pre')?.getAttribute('data-lang')).toBe('c');
  });

  it('行內 code 渲染成 <code>', () => {
    const { container } = render(<RichText as="span" text="變數 `i` 的值" />);

    expect(container.querySelector('code')?.textContent).toBe('i');
    expect(container.querySelector('span')).not.toBeNull();
  });

  it('程式碼內的 HTML 只當文字顯示，不會被解析成元素（防 XSS）', () => {
    const { container } = render(
      <RichText text={'```html\n<img src=x onerror="alert(1)">\n```'} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it('null / undefined 不會 crash', () => {
    const { container } = render(<RichText text={null} />);

    expect(container.firstChild).toBeEmptyDOMElement();
  });
});
