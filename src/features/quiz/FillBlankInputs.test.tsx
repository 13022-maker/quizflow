import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { FillBlankInputs } from './FillBlankInputs';

describe('FillBlankInputs', () => {
  it('依空格數渲染對應數量的輸入框', () => {
    render(<FillBlankInputs count={2} value={undefined} onChange={() => {}} />);

    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByLabelText('第 1 格')).toBeInTheDocument();
    expect(screen.getByLabelText('第 2 格')).toBeInTheDocument();
  });

  it('改某一格只更新那一格，其他格保留原值', () => {
    const onChange = vi.fn();
    render(<FillBlankInputs count={3} value={['甲', '', '丙']} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('第 2 格'), { target: { value: '乙' } });

    expect(onChange).toHaveBeenCalledWith(['甲', '乙', '丙']);
  });

  it('沒有作答時從空白開始', () => {
    const onChange = vi.fn();
    render(<FillBlankInputs count={2} value={undefined} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('第 2 格'), { target: { value: '氧氣' } });

    expect(onChange).toHaveBeenCalledWith(['', '氧氣']);
  });
});
