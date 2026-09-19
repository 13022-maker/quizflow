import { describe, expect, it } from 'vitest';

import { buildYoutubeUserPrompt, validateYoutubeSemantics } from './generate-subject-from-youtube';

describe('buildYoutubeUserPrompt', () => {
  it('帶入主題與逐字稿內容', () => {
    const prompt = buildYoutubeUserPrompt('光合作用', '=== 影片 1：abc123 ===\n[t=0s] 今天講光合作用');

    expect(prompt).toContain('光合作用');
    expect(prompt).toContain('abc123');
    expect(prompt).toContain('影片逐字稿');
  });
});

describe('validateYoutubeSemantics', () => {
  const baseGenerated = {
    name: '光合作用',
    knowledgePoints: [
      { id: 'kc1', name: '葉綠體', prerequisites: [] },
      { id: 'kc2', name: '光反應', prerequisites: ['kc1'] },
      { id: 'kc3', name: '暗反應', prerequisites: ['kc2'] },
    ],
    items: Array.from({ length: 9 }, (_, i) => ({
      id: `item${i}`,
      knowledgeId: i < 3 ? 'kc1' : i < 6 ? 'kc2' : 'kc3',
      difficulty: 0.5,
      prompt: `題目 ${i}`,
      options: ['A', 'B', 'C', 'D'],
      answerIndex: 0,
      explanation: '解析',
      bloomLevel: '理解' as const,
    })),
    tutor: { lessonExampleRule: '規則', formatRule: '格式' },
  };

  it('videoRef 指向送進去的 videoId：通過', () => {
    const generated = {
      ...baseGenerated,
      knowledgePoints: [
        { ...baseGenerated.knowledgePoints[0]!, videoRef: { videoId: 'abc123', startSec: 10, endSec: 60 } },
        baseGenerated.knowledgePoints[1]!,
        baseGenerated.knowledgePoints[2]!,
      ],
    };

    expect(() => validateYoutubeSemantics(generated, ['abc123'])).not.toThrow();
  });

  it('videoRef 指向沒送進去的 videoId：丟錯', () => {
    const generated = {
      ...baseGenerated,
      knowledgePoints: [
        { ...baseGenerated.knowledgePoints[0]!, videoRef: { videoId: 'not-submitted', startSec: 10, endSec: 60 } },
        baseGenerated.knowledgePoints[1]!,
        baseGenerated.knowledgePoints[2]!,
      ],
    };

    expect(() => validateYoutubeSemantics(generated, ['abc123'])).toThrow(/videoId/);
  });

  it('startSec >= endSec：丟錯', () => {
    const generated = {
      ...baseGenerated,
      knowledgePoints: [
        { ...baseGenerated.knowledgePoints[0]!, videoRef: { videoId: 'abc123', startSec: 60, endSec: 60 } },
        baseGenerated.knowledgePoints[1]!,
        baseGenerated.knowledgePoints[2]!,
      ],
    };

    expect(() => validateYoutubeSemantics(generated, ['abc123'])).toThrow();
  });

  it('沒有 videoRef 的知識點：允許（不強求每個 KC 都要有片段）', () => {
    expect(() => validateYoutubeSemantics(baseGenerated, ['abc123'])).not.toThrow();
  });

  it('題目引用不存在的知識點：丟錯（沿用既有語意驗證規則）', () => {
    const generated = {
      ...baseGenerated,
      items: [{ ...baseGenerated.items[0]!, knowledgeId: 'not-exist' }, ...baseGenerated.items.slice(1)],
    };

    expect(() => validateYoutubeSemantics(generated, ['abc123'])).toThrow();
  });
});
