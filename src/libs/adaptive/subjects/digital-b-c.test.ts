import { marked } from 'marked';
import { describe, expect, it } from 'vitest';

import type { Item } from '../engine';
import { AdaptiveEngine } from '../engine';
import { DZB_ALL_SUBJECT_ID, DZB_SUBJECTS } from './digital-b-c';
import { getSubject, listSubjects, type Subject } from './index';

/** 引擎實務最低需求：每個知識點至少 3 題（BKT 連續答對約 3 題才跨過精熟門檻 0.8，少於 3 題就得重派舊題） */
const MIN_ITEMS_PER_KNOWLEDGE = 3;

const TOPIC_SUBJECT_IDS = [
  'dzb-c-type',
  'dzb-c-opr',
  'dzb-c-flow',
  'dzb-c-bit',
  'dzb-c-func',
  'dzb-c-ptr',
  'dzb-c-mem',
  'dzb-c-cmp',
];

function findItem(subject: Subject, itemId: string): Item {
  const item = subject.itemBank.items.find(it => it.id === itemId);
  if (!item) {
    throw new Error(`找不到題目 ${itemId}`);
  }
  return item;
}

/** 檢查圖譜無環且前置都存在（DFS） */
function assertAcyclic(subject: Subject): void {
  const nodeMap = new Map(subject.graph.nodes.map(n => [n.id, n]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id)) {
      return;
    }

    expect(visiting.has(id), `${subject.id} 圖譜含循環：${id}`).toBe(false);

    visiting.add(id);
    const node = nodeMap.get(id);

    expect(node, `${subject.id} 缺少前置節點：${id}`).toBeDefined();

    node!.prerequisites.forEach(visit);
    visiting.delete(id);
    done.add(id);
  };
  subject.graph.nodes.forEach(n => visit(n.id));
}

describe('數位乙級 C 語言內建學科', () => {
  it('註冊表保留既有三科在前，之後依序為 8 個主題學科＋總複習', () => {
    const ids = listSubjects().map(s => s.id);

    expect(ids).toEqual(['cpp', 'python', 'calculus', ...TOPIC_SUBJECT_IDS, 'dzb-c-all']);
    expect(DZB_ALL_SUBJECT_ID).toBe('dzb-c-all');
  });

  it.each(DZB_SUBJECTS.map(s => [s.id, s] as const))('%s：中繼資料正確', (_id, subject) => {
    expect(subject.name.startsWith('數位乙級｜')).toBe(true);
    expect(subject.category).toBe('數位乙級 C語言');
    expect(subject.description).toBeTruthy();
    expect([...subject.description!].length).toBeLessThanOrEqual(40);
    expect(getSubject(subject.id)).toBe(subject);
  });

  it.each(DZB_SUBJECTS.map(s => [s.id, s] as const))('%s：圖譜與題庫結構合法', (_id, subject) => {
    const nodeIds = new Set(subject.graph.nodes.map(n => n.id));

    expect(nodeIds.size).toBe(subject.graph.nodes.length);

    assertAcyclic(subject);

    const itemIds = subject.itemBank.items.map(it => it.id);

    expect(new Set(itemIds).size).toBe(itemIds.length);

    for (const item of subject.itemBank.items) {
      expect(item.id).toMatch(/^DZB-Q\d+$/);
      expect(nodeIds.has(item.knowledgeId), `${item.id} 的 knowledgeId 不在圖譜中`).toBe(true);
      expect(item.options).toHaveLength(4);
      expect(new Set(item.options).size, `${item.id} 選項重複`).toBe(4);
      expect(Number.isInteger(item.answerIndex)).toBe(true);
      expect(item.answerIndex).toBeGreaterThanOrEqual(0);
      expect(item.answerIndex).toBeLessThan(4);
      expect(item.difficulty).toBeGreaterThanOrEqual(0.1);
      expect(item.difficulty).toBeLessThanOrEqual(1.0);
      expect(item.explanation).toBeTruthy();
    }

    for (const node of subject.graph.nodes) {
      const nodeItems = subject.itemBank.items.filter(it => it.knowledgeId === node.id);

      expect(nodeItems.length, `${node.id} 題數不足`).toBeGreaterThanOrEqual(MIN_ITEMS_PER_KNOWLEDGE);
      expect(new Set(nodeItems.map(it => it.difficulty)).size, `${node.id} 難度未分散`).toBeGreaterThanOrEqual(2);
    }
  });

  it('主題學科每科 2–4 個知識點，知識點 id 全域唯一', () => {
    const topics = DZB_SUBJECTS.filter(s => s.id !== 'dzb-c-all');
    const allNodeIds = topics.flatMap(s => s.graph.nodes.map(n => n.id));

    for (const s of topics) {
      expect(s.graph.nodes.length).toBeGreaterThanOrEqual(2);
      expect(s.graph.nodes.length).toBeLessThanOrEqual(4);
    }

    expect(new Set(allNodeIds).size).toBe(allNodeIds.length);
  });

  it('總複習 79 題、涵蓋所有主題節點；主題學科題數加總也是 79 且不重複', () => {
    const all = getSubject('dzb-c-all');
    const topics = TOPIC_SUBJECT_IDS.map(getSubject);
    const topicItemIds = topics.flatMap(s => s.itemBank.items.map(it => it.id));
    const topicNodeIds = topics.flatMap(s => s.graph.nodes.map(n => n.id));

    expect(all.name).toBe('數位乙級｜C語言總複習（全 79 題）');
    expect(all.itemBank.items).toHaveLength(79);
    expect(topicItemIds).toHaveLength(79);
    expect(new Set(topicItemIds).size).toBe(79);
    expect(new Set(all.graph.nodes.map(n => n.id))).toEqual(new Set(topicNodeIds));
  });

  it('手算驗證：Q17 x+=x+y++ → x=16,y=7', () => {
    const item = findItem(getSubject('dzb-c-opr'), 'DZB-Q17');

    expect(item.answerIndex).toBe(0);
    expect(item.options[item.answerIndex]).toBe('x=16,y=7');
    expect(item.prompt).toContain('```c\n');
    expect(item.prompt).toContain('x+=x+y++;');
  });

  it('手算驗證：Q66 複選轉組合單選，正解為 ①③④（0x26&0xe2=0x22、0x26<<3 截 8 位=0x30、0xe2>>2=0x38）', () => {
    const item = findItem(getSubject('dzb-c-bit'), 'DZB-Q66');

    expect(item.options[item.answerIndex]).toBe('①③④');
    // 干擾組合規則：少最後一個（①③）、多最小的錯誤敘述（①②③④）、最後一個換成最小錯誤敘述（①②③）；
    // 依（個數, 字典序）排序後旋轉使正解落在 66 % 4 = 2
    expect(item.answerIndex).toBe(2);
    expect(item.options).toEqual(['①③', '①②③', '①③④', '①②③④']);
    expect(item.prompt).toContain('① 執行 z=x&y 後，z=0x22');
    expect(item.prompt).toContain('④ 執行 z=y>>2 後，z=0x38');
    expect(item.explanation).toContain('⚠️');
  });

  it('手算驗證：Q28 官方答案 ①（k-=2），解析附命題瑕疵警語', () => {
    const item = findItem(getSubject('dzb-c-flow'), 'DZB-Q28');

    expect(item.answerIndex).toBe(0);
    expect(item.options[0]).toBe('for(k=10;k<=2;k-=2)');
    expect(item.explanation).toMatch(/\n\n⚠️ /);
  });

  it('題幹經 marked 渲染：程式碼成 <pre><code>，題幹的 * 不會被誤判成斜體', () => {
    const q13 = findItem(getSubject('dzb-c-opr'), 'DZB-Q13');
    const html13 = String(marked.parse(q13.prompt));

    expect(html13).not.toContain('<em>');
    expect(html13).toContain('a=5*3&gt;4*3');

    const q17 = findItem(getSubject('dzb-c-opr'), 'DZB-Q17');

    expect(String(marked.parse(q17.prompt))).toContain('<pre><code class="language-c">');
  });

  it.each(DZB_SUBJECTS.map(s => [s.id, s] as const))('%s：新學生可派題，且全答對能走完課程不丟錯', async (_id, subject) => {
    const engine = new AdaptiveEngine(subject.graph, subject.itemBank);
    await engine.registerStudent('s1');
    const first = await engine.getNextItem('s1');

    expect(first).not.toBeNull();

    const roots = subject.graph.nodes.filter(n => n.prerequisites.length === 0).map(n => n.id);

    expect(roots).toContain(first!.item.knowledgeId);

    let dispatch = first;
    let steps = 0;
    while (dispatch && steps < 500) {
      await engine.updateStudentState('s1', dispatch.item.id, true, 0, 10);
      dispatch = await engine.getNextItem('s1');
      steps += 1;
    }

    expect(dispatch).toBeNull();
  });
});
