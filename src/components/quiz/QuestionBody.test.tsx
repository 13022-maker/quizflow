import { render, screen } from '@testing-library/react';

import { QuestionBody } from './QuestionBody';

describe('QuestionBody', () => {
  it('一般題目：純文字顯示，保留換行（whitespace-pre-wrap）', () => {
    const { container } = render(<QuestionBody text={'第一行\n第二行'} />);
    const root = container.firstElementChild as HTMLElement;

    expect(root.tagName).toBe('DIV');
    expect(root.className).toContain('whitespace-pre-wrap');
    expect(root).toHaveTextContent('第一行\n第二行', { normalizeWhitespace: false });
    expect(container.querySelector('pre')).toBeNull();
  });

  it('程式題：圍欄內容渲染成 <pre><code>，保留縮排，不顯示 ``` 符號', () => {
    const body = '下列 C++ 程式的輸出為何？\n```cpp\nint main() {\n    cout << 6;\n}\n```';
    const { container } = render(<QuestionBody text={body} />);

    const pre = screen.getByTestId('question-code-block');

    expect(pre.tagName).toBe('PRE');
    expect(pre).toHaveAttribute('data-lang', 'cpp');
    expect(pre).toHaveClass('font-mono');
    expect(pre.querySelector('code')!).toHaveTextContent('int main() {\n    cout << 6;\n}', { normalizeWhitespace: false });
    expect(screen.getByText('下列 C++ 程式的輸出為何？')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/```/);
  });

  it('程式碼內含 HTML 會被 escape，不會變成真的元素（XSS 防護）', () => {
    const body = '輸出？\n```html\n<script>alert(1)</script><img src=x onerror=alert(1)>\n```';
    const { container } = render(<QuestionBody text={body} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('question-code-block'))
      .toHaveTextContent('<script>alert(1)</script><img src=x onerror=alert(1)>');
  });

  it('prefix 顯示在題目最前面', () => {
    const { container } = render(<QuestionBody text={'```cpp\nx++;\n```'} prefix="Q1. " />);

    expect(container).toHaveTextContent('Q1. x++;');
  });

  it('as="span" 時外層為 span', () => {
    const { container } = render(<QuestionBody as="span" text="abc" />);

    expect(container.firstElementChild!.tagName).toBe('SPAN');
  });
});
