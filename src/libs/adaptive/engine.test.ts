import { describe, expect, it } from 'vitest';

import type { Item } from './engine';
import { pickNearestByDifficulty } from './engine';

function makeItem(id: string, difficulty: number): Item {
  return {
    id,
    knowledgeId: 'k1',
    difficulty,
    prompt: `題目 ${id}`,
    options: ['A', 'B'],
    answerIndex: 0,
  };
}

describe('pickNearestByDifficulty', () => {
  it('只有一題最接近目標難度時，必挑那一題', () => {
    const pool = [makeItem('near', 0.5), makeItem('far', 0.9)];
    const picked = pickNearestByDifficulty(pool, 0.5);

    expect(picked.id).toBe('near');
  });

  it('多題並列最接近目標難度時，多次呼叫應有機會選到不同題目（隨機化生效）', () => {
    const pool = [makeItem('tie-a', 0.4), makeItem('tie-b', 0.6), makeItem('far', 0.9)];
    // 目標難度 0.5：tie-a 與 tie-b 距離都是 0.1，far 距離 0.4，far 永遠不該被選到
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(pickNearestByDifficulty(pool, 0.5).id);
    }

    expect(seen.has('far')).toBe(false);
    expect(seen.size).toBe(2); // tie-a 與 tie-b 都應該在 200 次內至少出現過一次
  });
});
