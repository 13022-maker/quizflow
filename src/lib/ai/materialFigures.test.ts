import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  attachFigureUrls,
  buildFigureManifest,
  buildFigurePromptRules,
  type FigureCandidate,
  type MaterialFigure,
  resolveFigureRefs,
  selectFigures,
  stripFigureFields,
} from './materialFigures';

function cand(
  pageNumber: number | null,
  content: string,
  width?: number,
  height?: number,
): FigureCandidate {
  return { pageNumber, buffer: Buffer.from(content), contentType: 'image/png', width, height };
}

function fig(id: string, pageNumber: number | null, content: string): MaterialFigure {
  return { id, pageNumber, buffer: Buffer.from(content), contentType: 'image/png' };
}

describe('selectFigures', () => {
  it('濾掉寬或高小於 minSide 的小圖示，依序編號 FIG1..FIGn', () => {
    const result = selectFigures([
      cand(1, 'bullet', 20, 20),
      cand(1, 'chart', 400, 300),
      cand(2, 'thin-line', 600, 10),
      cand(3, 'map', 200, 200),
    ]);

    expect(result.map(f => [f.id, f.pageNumber, f.buffer.toString()])).toEqual([
      ['FIG1', 1, 'chart'],
      ['FIG2', 3, 'map'],
    ]);
  });

  it('寬高未知的圖片（例如老師直接上傳的照片）一律保留', () => {
    const result = selectFigures([cand(null, 'photo-a'), cand(null, 'photo-b')]);

    expect(result.map(f => [f.id, f.pageNumber])).toEqual([
      ['FIG1', null],
      ['FIG2', null],
    ]);
  });

  it('依頁碼排序（穩定排序，同頁維持原順序）', () => {
    const result = selectFigures([
      cand(3, 'p3', 100, 100),
      cand(1, 'p1-a', 100, 100),
      cand(1, 'p1-b', 100, 100),
    ]);

    expect(result.map(f => `${f.id}:${f.buffer.toString()}`)).toEqual([
      'FIG1:p1-a',
      'FIG2:p1-b',
      'FIG3:p3',
    ]);
  });

  it('超過 maxFigures 只取前面幾張', () => {
    const result = selectFigures(
      [cand(1, 'a', 100, 100), cand(2, 'b', 100, 100), cand(3, 'c', 100, 100)],
      { maxFigures: 2 },
    );

    expect(result.map(f => f.buffer.toString())).toEqual(['a', 'b']);
  });

  it('minSide 可調整', () => {
    const result = selectFigures([cand(1, 'small', 50, 50)], { minSide: 40 });

    expect(result).toHaveLength(1);
  });

  it('保留寬高資訊', () => {
    const [first] = selectFigures([cand(2, 'x', 640, 480)]);

    expect(first).toEqual({
      id: 'FIG1',
      pageNumber: 2,
      buffer: Buffer.from('x'),
      contentType: 'image/png',
      width: 640,
      height: 480,
    });
  });

  it('空陣列回傳空陣列', () => {
    expect(selectFigures([])).toEqual([]);
  });
});

describe('buildFigureManifest', () => {
  it('PDF 圖片標示頁碼，上傳圖片標示第幾張', () => {
    const text = buildFigureManifest([
      fig('FIG1', 3, 'a'),
      fig('FIG2', 5, 'b'),
    ]);

    expect(text).toBe('可引用的教材圖片：\nFIG1（第3頁）\nFIG2（第5頁）');
  });

  it('上傳圖片（pageNumber 為 null）依順序標示上傳圖片N', () => {
    const text = buildFigureManifest([fig('FIG1', null, 'a'), fig('FIG2', null, 'b')]);

    expect(text).toBe('可引用的教材圖片：\nFIG1（上傳圖片1）\nFIG2（上傳圖片2）');
  });

  it('沒有圖片時回傳空字串', () => {
    expect(buildFigureManifest([])).toBe('');
  });
});

describe('buildFigurePromptRules', () => {
  it('沒有圖片時回傳空字串', () => {
    expect(buildFigurePromptRules(false)).toBe('');
  });

  it('有圖片時包含 figure 欄位與如圖用語等規則', () => {
    const rules = buildFigurePromptRules(true);

    expect(rules).toContain('"figure": "FIG1"');
    expect(rules).toContain('如圖');
    expect(rules).toContain('不可自行編造');
    expect(rules).toContain('不需要看圖的題目不要加 figure 欄位');
  });
});

describe('resolveFigureRefs', () => {
  const figures = [fig('FIG1', 1, 'one'), fig('FIG2', 2, 'two'), fig('FIG3', 4, 'three')];

  it('接受大小寫、空白、純數字等各種寫法', () => {
    const questions = [
      { question: 'q0', figure: 'FIG1' },
      { question: 'q1', figure: 'fig2' },
      { question: 'q2', figure: ' FIG 3 ' },
      { question: 'q3', figure: 1 },
      { question: 'q4', figure: '2' },
      { question: 'q5' },
    ];

    const { refsByIndex } = resolveFigureRefs(questions, figures);

    expect([...refsByIndex.entries()].map(([i, f]) => [i, f.id])).toEqual([
      [0, 'FIG1'],
      [1, 'FIG2'],
      [2, 'FIG3'],
      [3, 'FIG1'],
      [4, 'FIG2'],
    ]);
  });

  it('不存在的圖片編號或亂寫的值一律忽略', () => {
    const questions = [
      { figure: 'FIG9' },
      { figure: 'diagram' },
      { figure: null },
      { figure: { id: 'FIG1' } },
      { figure: 0 },
    ];

    const { refsByIndex, used } = resolveFigureRefs(questions, figures);

    expect(refsByIndex.size).toBe(0);
    expect(used).toEqual([]);
  });

  it('used 去重並依第一次被引用的順序排列', () => {
    const questions = [
      { figure: 'FIG3' },
      { figure: 'FIG1' },
      { figure: 'FIG3' },
    ];

    const { used } = resolveFigureRefs(questions, figures);

    expect(used.map(f => f.id)).toEqual(['FIG3', 'FIG1']);
  });

  it('題目不是物件時略過不炸', () => {
    const { refsByIndex } = resolveFigureRefs([null, 'text', { figure: 'FIG1' }], figures);

    expect([...refsByIndex.keys()]).toEqual([2]);
  });
});

describe('attachFigureUrls', () => {
  it('依圖片 id 對應網址設定 imageUrl，回傳附圖題數；上傳失敗（無網址）的略過', () => {
    const figures = [fig('FIG1', 1, 'one'), fig('FIG2', 2, 'two')];
    const questions: Record<string, unknown>[] = [
      { question: 'a' },
      { question: 'b' },
      { question: 'c' },
    ];
    const refsByIndex = new Map<number, MaterialFigure>([
      [0, figures[0]!],
      [2, figures[1]!],
    ]);
    const urlById = new Map([['FIG1', 'https://blob.example/1.png']]);

    const count = attachFigureUrls(questions, refsByIndex, urlById);

    expect(count).toBe(1);
    expect(questions).toEqual([
      { question: 'a', imageUrl: 'https://blob.example/1.png' },
      { question: 'b' },
      { question: 'c' },
    ]);
  });
});

describe('stripFigureFields', () => {
  it('移除每一題的 figure 欄位，其他欄位不動', () => {
    const questions: unknown[] = [
      { question: 'a', figure: 'FIG1', answer: 'A' },
      { question: 'b' },
      null,
    ];

    stripFigureFields(questions);

    expect(questions).toEqual([{ question: 'a', answer: 'A' }, { question: 'b' }, null]);
  });
});
