import { describe, expect, it } from 'vitest';

import { buildUserPrompt, renderMarkdown } from './generate-summary';

describe('buildUserPrompt', () => {
  it('列出學科名稱與依序排列的知識點', () => {
    const prompt = buildUserPrompt({
      id: 'cpp',
      name: 'C++ 程式設計',
      graph: {
        nodes: [
          { id: 'k-var', name: '變數與資料型別', prerequisites: [] },
          { id: 'k-loop', name: '迴圈控制', prerequisites: ['k-var'] },
        ],
      },
      itemBank: { items: [] },
      tutor: { lessonExampleRule: '', formatRule: '' },
    });

    expect(prompt).toContain('C++ 程式設計');
    expect(prompt.indexOf('變數與資料型別')).toBeLessThan(prompt.indexOf('迴圈控制'));
  });
});

describe('renderMarkdown', () => {
  it('組出標題／概述／知識點條列，有教學建議時附加該節', () => {
    const markdown = renderMarkdown('C++ 程式設計', {
      overview: '學生理解迴圈的執行流程。',
      keyPoints: [
        { concept: 'for 迴圈', note: '初始化/條件/遞增三部件的執行順序' },
      ],
      teachingTips: ['學生容易混淆 for/while 使用時機'],
    });

    expect(markdown).toContain('# C++ 程式設計 課前重點');
    expect(markdown).toContain('## 本課概述');
    expect(markdown).toContain('學生理解迴圈的執行流程。');
    expect(markdown).toContain('## 知識點重點');
    expect(markdown).toContain('- **for 迴圈**：初始化/條件/遞增三部件的執行順序');
    expect(markdown).toContain('## 教學建議');
    expect(markdown).toContain('- 學生容易混淆 for/while 使用時機');
  });

  it('教學建議為空陣列時，不輸出「教學建議」該節', () => {
    const markdown = renderMarkdown('C++ 程式設計', {
      overview: '概述',
      keyPoints: [{ concept: 'for 迴圈', note: '重點' }],
      teachingTips: [],
    });

    expect(markdown).not.toContain('## 教學建議');
  });
});
