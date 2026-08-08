import { describe, expect, it } from 'vitest';

import {
  applyRandomClozeBlanks,
  countClozeBlanks,
  extractClozeAnswers,
  findClozeCandidates,
  gradeClozeAnswers,
  parseClozeBody,
  pickClozeHintOptions,
  stripClozeMarkers,
} from './cloze';

describe('parseClozeBody', () => {
  it('沒有標記時回傳單一 text 段落', () => {
    expect(parseClozeBody('光合作用是一個過程。')).toEqual([
      { kind: 'text', text: '光合作用是一個過程。' },
    ]);
  });

  it('解析單一標記，前後都有文字', () => {
    expect(parseClozeBody('光合作用需要[[陽光]]才能進行。')).toEqual([
      { kind: 'text', text: '光合作用需要' },
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '才能進行。' },
    ]);
  });

  it('解析多個標記，index 依出現順序遞增', () => {
    expect(parseClozeBody('需要[[陽光]]、水和[[二氧化碳]]。')).toEqual([
      { kind: 'text', text: '需要' },
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '、水和' },
      { kind: 'blank', index: 1, answer: '二氧化碳' },
      { kind: 'text', text: '。' },
    ]);
  });

  it('標記在開頭或結尾時不多出空的 text 段落', () => {
    expect(parseClozeBody('[[陽光]]很重要')).toEqual([
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '很重要' },
    ]);
    expect(parseClozeBody('很重要的是[[陽光]]')).toEqual([
      { kind: 'text', text: '很重要的是' },
      { kind: 'blank', index: 0, answer: '陽光' },
    ]);
  });

  it('標記內容前後空白會被 trim', () => {
    expect(parseClozeBody('需要[[ 陽光 ]]。')).toEqual([
      { kind: 'text', text: '需要' },
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '。' },
    ]);
  });
});

describe('extractClozeAnswers / countClozeBlanks', () => {
  it('依出現順序回傳答案陣列', () => {
    expect(extractClozeAnswers('需要[[陽光]]和[[水]]。')).toEqual(['陽光', '水']);
  });

  it('沒有標記時回傳空陣列', () => {
    expect(extractClozeAnswers('沒有標記的文字')).toEqual([]);
  });

  it('countClozeBlanks 回傳標記數量', () => {
    expect(countClozeBlanks('需要[[陽光]]、水和[[二氧化碳]]。')).toBe(2);
    expect(countClozeBlanks('沒有標記')).toBe(0);
  });
});

describe('stripClozeMarkers', () => {
  it('把標記換成預設佔位符，不洩漏答案', () => {
    expect(stripClozeMarkers('需要[[陽光]]和[[水]]。')).toBe('需要＿＿＿＿和＿＿＿＿。');
  });

  it('可自訂佔位符', () => {
    expect(stripClozeMarkers('需要[[陽光]]。', '___')).toBe('需要___。');
  });

  it('沒有標記時原樣回傳', () => {
    expect(stripClozeMarkers('普通文字')).toBe('普通文字');
  });
});

describe('gradeClozeAnswers', () => {
  it('全部答對 → isCorrect true，awardedRatio 1', () => {
    const result = gradeClozeAnswers(['陽光', '水'], ['陽光', '水']);

    expect(result).toEqual({
      perBlank: [true, true],
      correctCount: 2,
      totalBlanks: 2,
      isCorrect: true,
      awardedRatio: 1,
    });
  });

  it('部分答對 → isCorrect false，awardedRatio 按比例', () => {
    const result = gradeClozeAnswers(['陽光', '水', '二氧化碳'], ['陽光', '水', '土']);

    expect(result.correctCount).toBe(2);
    expect(result.totalBlanks).toBe(3);
    expect(result.isCorrect).toBe(false);
    expect(result.awardedRatio).toBeCloseTo(2 / 3);
  });

  it('比對忽略前後空白與英文大小寫', () => {
    const result = gradeClozeAnswers(['Sunlight'], [' sunlight ']);

    expect(result.perBlank).toEqual([true]);
  });

  it('學生沒填的空格算錯', () => {
    const result = gradeClozeAnswers(['陽光', '水'], ['陽光', undefined]);

    expect(result.perBlank).toEqual([true, false]);
    expect(result.correctCount).toBe(1);
  });

  it('studentAnswers 為 undefined 時全部算錯，不會炸', () => {
    const result = gradeClozeAnswers(['陽光', '水'], undefined);

    expect(result.correctCount).toBe(0);
    expect(result.isCorrect).toBe(false);
  });

  it('沒有空格（totalBlanks=0）時 isCorrect 為 false、awardedRatio 為 0', () => {
    const result = gradeClozeAnswers([], []);

    expect(result.isCorrect).toBe(false);
    expect(result.awardedRatio).toBe(0);
  });

  it('用過提示的空格答對時，該格只算半分（awardedRatio 反映）', () => {
    // 3 格全對，其中 1 格（index 1）用過提示 → (1 + 0.5 + 1) / 3
    const result = gradeClozeAnswers(['陽光', '水', '葉綠素'], ['陽光', '水', '葉綠素'], [1]);

    expect(result.perBlank).toEqual([true, true, true]);
    expect(result.correctCount).toBe(3);
    expect(result.isCorrect).toBe(true); // 全對，用提示不影響「是否全對」的判斷
    expect(result.awardedRatio).toBeCloseTo((1 + 0.5 + 1) / 3);
  });

  it('用過提示但答錯的空格，仍然算 0 分（不會因為用提示反而扣更多）', () => {
    const result = gradeClozeAnswers(['陽光', '水'], ['陽光', '土壤'], [1]);

    expect(result.perBlank).toEqual([true, false]);
    expect(result.awardedRatio).toBeCloseTo(1 / 2);
  });

  it('沒有提示（不傳第三參數）時行為完全不變，向後相容', () => {
    const result = gradeClozeAnswers(['陽光', '水', '葉綠素'], ['陽光', '水', '土壤']);

    expect(result.correctCount).toBe(2);
    expect(result.awardedRatio).toBeCloseTo(2 / 3);
  });

  it('hintedIndices 傳空陣列，效果跟不傳一樣', () => {
    const withEmpty = gradeClozeAnswers(['陽光', '水'], ['陽光', '水'], []);
    const withoutParam = gradeClozeAnswers(['陽光', '水'], ['陽光', '水']);

    expect(withEmpty.awardedRatio).toBe(withoutParam.awardedRatio);
  });
});

describe('findClozeCandidates', () => {
  it('抓出英文詞（≥3 字母）', () => {
    expect(findClozeCandidates('The sunlight is important')).toEqual(
      expect.arrayContaining(['The', 'sunlight', 'important']),
    );
  });

  it('抓出數字詞', () => {
    expect(findClozeCandidates('溫度是 100 度')).toEqual(expect.arrayContaining(['100']));
  });

  it('抓出 2-4 字中文詞組（分隔型）', () => {
    // 無分詞庫下，只能掃出「分隔符分開的 2-4 字詞組」
    const candidates = findClozeCandidates('光合。作用。需要陽光、水分。進行呼吸');

    expect(candidates).toEqual(
      expect.arrayContaining(['光合', '作用', '需要陽光', '水分', '進行呼吸']),
    );
  });

  it('太短的英文詞（<3 字母）不算候選', () => {
    expect(findClozeCandidates('a is it')).toEqual([]);
  });

  it('連續中文（沒有標點分隔）抓不到任何候選詞——已知限制，釘住行為避免之後誤改壞', () => {
    // 沒有分詞庫，只能用「標點分隔的整個詞組 2-4 字」判斷，超過 4 字的連續中文
    // 整段會被當成一個 token，長度不符就整個跳過。中文長句本來就建議老師手動標記。
    const candidates = findClozeCandidates('光合作用需要陽光水分和二氧化碳才能順利進行');

    expect(candidates).toEqual([]);
  });
});

describe('applyRandomClozeBlanks', () => {
  it('標記數量等於 min(count, 候選詞數量)', () => {
    const body = 'The sunlight and water are important for photosynthesis';
    const result = applyRandomClozeBlanks(body, 3);

    expect(countClozeBlanks(result)).toBe(3);
  });

  it('候選詞不足時，標記數 = 候選詞數，不會炸', () => {
    const body = 'ab cd';
    const result = applyRandomClozeBlanks(body, 5);

    // ab / cd 都只有 2 個字母，不符合候選規則，維持原文不變
    expect(result).toBe(body);
  });

  it('不會重複標記已經被 [[ ]] 包住的文字', () => {
    const body = '需要[[陽光]]才能進行 photosynthesis process';
    const result = applyRandomClozeBlanks(body, 5);

    // 「陽光」已經被標記過，不應該出現 [[[[陽光]]]] 這種雙重標記
    expect(result).not.toContain('[[[[');
    expect(extractClozeAnswers(result)).toContain('陽光');
  });

  it('沒有候選詞時原樣回傳', () => {
    expect(applyRandomClozeBlanks('。，！？', 3)).toBe('。，！？');
  });

  it('連續中文（沒有標點分隔）是已知限制，隨機挑選會是無動作（回傳原文）', () => {
    const body = '光合作用需要陽光水分和二氧化碳才能順利進行';

    expect(applyRandomClozeBlanks(body, 3)).toBe(body);
  });

  it('標記時保留空格和標點符號（回歸測試）', () => {
    // 驗證 TOKEN_SPLIT 的捕捉組正常工作，不會吃掉分隔符
    // 這個測試防止如下 bug：將「The sunlight and water」變成「[[The]][[sunlight]][[and]]waterare」
    const body = 'The sunlight and water are important for photosynthesis.';
    const result = applyRandomClozeBlanks(body, 5);

    // 驗證 1: 去掉標記後用佔位符替換，應該還能看到所有原始空格/標點
    const normalized = stripClozeMarkers(result);

    expect(normalized).toContain(' ');
    expect(normalized).toContain('.');

    // 驗證 2: 沒被標記的詞之間應該保留空格（不是「wordword」的形式）
    expect(result).not.toMatch(/\][A-Z]/i);
    expect(result).not.toMatch(/[a-z]\[/);
  });
});

describe('pickClozeHintOptions', () => {
  it('空格數足夠時，回傳含正確答案在內的 3 個選項', () => {
    const options = pickClozeHintOptions(['陽光', '水', '葉綠素'], 0);

    expect(options).not.toBeNull();
    expect(options).toHaveLength(3);
    expect(options).toContain('陽光');
  });

  it('幹擾項是從其他空格的答案抽的（不是憑空生成）', () => {
    const correctAnswers = ['陽光', '水', '葉綠素'];
    const options = pickClozeHintOptions(correctAnswers, 0)!;
    const distractors = options.filter(o => o !== '陽光');

    distractors.forEach((d) => {
      expect(['水', '葉綠素']).toContain(d);
    });
  });

  it('只有 2 個空格（湊不到 2 個幹擾項）時回傳 null', () => {
    expect(pickClozeHintOptions(['陽光', '水'], 0)).toBeNull();
  });

  it('其他空格答案跟目標答案重複、去重後不足 2 個時回傳 null', () => {
    // index 0 的答案是「陽光」，其他兩格也都是「陽光」，去重後幹擾項池是空的
    expect(pickClozeHintOptions(['陽光', '陽光', '陽光'], 0)).toBeNull();
  });

  it('blankIndex 超出範圍時回傳 null，不會炸', () => {
    expect(pickClozeHintOptions(['陽光', '水', '葉綠素'], 99)).toBeNull();
  });

  it('去重後幹擾項池剛好 2 個以上，仍然只回傳 2 個幹擾項（共 3 個選項）', () => {
    const options = pickClozeHintOptions(['陽光', '水', '葉綠素', '二氧化碳'], 0)!;

    expect(options).toHaveLength(3);
  });

  it('沒傳 passageBody 時行為完全不變（向後相容）：同題空格不夠仍回傳 null', () => {
    expect(pickClozeHintOptions(['陽光', '水'], 0)).toBeNull();
  });

  it('同題空格夠（≥3）時，即使有傳 passageBody 也優先用同題答案，不用管 passageBody 對不對', () => {
    // passageBody 給一個完全抽不到字的內容（純標點），確認不影響同題答案已經足夠的情況
    const options = pickClozeHintOptions(['陽光', '水', '葉綠素'], 0, '。，！？');

    expect(options).not.toBeNull();
    expect(options).toHaveLength(3);
  });

  it('同題空格不夠時，改用 passageBody 抽字當備援', () => {
    const passageBody = 'Photosynthesis needs [[陽光]] and water to occur naturally';
    const options = pickClozeHintOptions(['陽光', '水'], 0, passageBody);

    expect(options).not.toBeNull();
    expect(options).toHaveLength(3);
    expect(options).toContain('陽光');
  });

  it('文章抽字備援不會把「同題其他空格答案」重複列成第二個候選（不會跟第一層撞名）', () => {
    // "water" 本來就是這題另一格的答案，會透過第一層合法成為幹擾項候選——
    // 這是既有、預期的行為（同題其他空格答案本來就可以當幹擾項），不用排除。
    // 這個測試要確認的是：文章裡的 "water" 不會被第二層又「重複」加進候選池一次
    // （只會有一個 water，不會有兩個 water 佔掉 2 個幹擾項名額）。
    const passageBody = 'The process needs sunlight and water and energy and carbon to occur';
    const options = pickClozeHintOptions(['sunlight', 'water'], 0, passageBody)!;

    expect(options).not.toBeNull();
    expect(options.filter(o => o.toLowerCase() === 'water')).toHaveLength(options.includes('water') ? 1 : 0);
  });

  it('文章抽字備援也抽不到字（連續中文無標點）時，仍回傳 null，不會硬湊', () => {
    const passageBody = '光合作用需要陽光水分和二氧化碳才能順利進行';
    const options = pickClozeHintOptions(['陽光', '水分'], 0, passageBody);

    expect(options).toBeNull();
  });

  it('只有 1 個空格（同題完全沒有其他空格）時，兩個幹擾項都靠文章抽字備援', () => {
    const passageBody = 'The quick brown fox jumps over the lazy dog near [[river]]';
    const options = pickClozeHintOptions(['river'], 0, passageBody);

    expect(options).not.toBeNull();
    expect(options).toHaveLength(3);
    expect(options).toContain('river');
  });

  it('文章抽字備援不會把正確答案自己當成幹擾項（就算文章裡出現兩次）', () => {
    const passageBody = 'The sunlight and more sunlight and water and energy appear here today';
    const options = pickClozeHintOptions(['sunlight'], 0, passageBody)!;

    expect(options).not.toBeNull();
    expect(options.filter(o => o.toLowerCase() === 'sunlight')).toHaveLength(1);
  });
});
