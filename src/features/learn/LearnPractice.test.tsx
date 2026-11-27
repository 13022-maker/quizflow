import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LearnPractice } from './LearnPractice';

const questions = [
  { question: '1 + 1 = ？', options: ['1', '2', '3', '4'], answer: 1, explanation: '1 加 1 是 2', difficulty: 1 as const },
  { question: '2 × 3 = ？', options: ['5', '6', '8', '9'], answer: 1, explanation: '2 乘 3 是 6', difficulty: 1 as const },
];

describe('LearnPractice', () => {
  it('交卷後顯示分數與詳解', () => {
    render(<LearnPractice questions={questions} />);

    fireEvent.click(screen.getByRole('button', { name: /^B\.\s*2$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^A\.\s*5$/ }));
    fireEvent.click(screen.getByRole('button', { name: '交卷看成績' }));

    expect(screen.getByRole('status')).toHaveTextContent(/1 \/ 2/);
    expect(screen.getByText('1 加 1 是 2')).toBeInTheDocument();
    expect(screen.getByText(/答錯 ✗，正解是 B/)).toBeInTheDocument();
  });

  it('重新作答會清空答案', () => {
    render(<LearnPractice questions={questions} />);

    fireEvent.click(screen.getByRole('button', { name: /^B\.\s*2$/ }));
    fireEvent.click(screen.getByRole('button', { name: '交卷看成績' }));
    fireEvent.click(screen.getByRole('button', { name: '重新作答' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(/已作答\s*0/)).toBeInTheDocument();
  });
});
