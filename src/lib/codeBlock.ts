/**
 * 題目內程式碼區塊（markdown 圍欄 ```lang ... ```）的解析與檢查工具
 *
 * 背景（bug）：AI 出程式題時題幹寫「下列程式的輸出為何？」，但出題 prompt 從沒要求
 * 附上程式碼、又規定「不要 markdown」，模型常常把程式碼省略或塞到不會被存的欄位，
 * 學生端只看到「下列程式」卻看不到程式。
 *
 * 約定：程式碼一律以 markdown 圍欄區塊直接存在題目 body 裡（不另開 DB 欄位），
 * 顯示端用 parseCodeBlocks() 切段，程式碼段渲染成等寬 <pre><code>（React 自動 escape，無 XSS）。
 *
 * 本檔是純函式，前後端都可以 import。
 */

export type CodeBlockSegment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; code: string };

const FENCE = '```';

/** 去掉段落頭尾多餘的空行，但保留行內縮排 */
function trimBlankLines(s: string): string {
  return s.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
}

/**
 * 把題目文字切成「一般文字」與「程式碼」段落。
 * - 支援 ```lang 開頭（lang 可省略，可含 + # . - 例如 c++ / c#）
 * - 圍欄緊貼在文字後面（「輸出為何？```cpp」）或程式最後一行後面（「return 0;```」）也能解析
 * - 未關閉的圍欄：剩下內容全部當程式碼，避免內容被吃掉
 */
export function parseCodeBlocks(input: string): CodeBlockSegment[] {
  if (!input) {
    return [];
  }
  const text = input.replace(/\r\n?/g, '\n');
  if (!text.includes(FENCE)) {
    return [{ kind: 'text', text }];
  }

  const segments: CodeBlockSegment[] = [];
  const pushText = (raw: string) => {
    const t = trimBlankLines(raw);
    if (t) {
      segments.push({ kind: 'text', text: t });
    }
  };

  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf(FENCE, pos);
    if (open === -1) {
      pushText(text.slice(pos));
      break;
    }
    pushText(text.slice(pos, open));

    // 開頭圍欄這一行剩下的部分 = 語言標記
    const afterOpen = open + FENCE.length;
    const lineEnd = text.indexOf('\n', afterOpen);
    const infoLine = lineEnd === -1 ? text.slice(afterOpen) : text.slice(afterOpen, lineEnd);

    // 同一行就關閉的情況：```int a = 1;```
    const sameLineClose = infoLine.indexOf(FENCE);
    if (sameLineClose !== -1) {
      const code = infoLine.slice(0, sameLineClose).trim();
      if (code) {
        segments.push({ kind: 'code', lang: '', code });
      }
      pos = afterOpen + sameLineClose + FENCE.length;
      continue;
    }

    const lang = (infoLine.trim().match(/^[\w+#.-]*/)?.[0] ?? '').toLowerCase();
    const codeStart = lineEnd === -1 ? text.length : lineEnd + 1;
    const close = text.indexOf(FENCE, codeStart);
    const rawCode = close === -1 ? text.slice(codeStart) : text.slice(codeStart, close);
    const code = trimBlankLines(rawCode);
    if (code) {
      segments.push({ kind: 'code', lang, code });
    }
    pos = close === -1 ? text.length : close + FENCE.length;
  }

  return segments;
}

/** 題目是否含有（非空的）程式碼區塊 */
export function hasCodeBlock(text: string): boolean {
  return parseCodeBlocks(text).some(s => s.kind === 'code');
}

/**
 * 去掉圍欄標記，只留文字與程式碼內容。
 * 給 line-clamp 摘要、TTS、純文字匯出等「不渲染區塊」的地方用，避免出現 ``` 符號。
 */
export function stripCodeFences(text: string): string {
  if (!text || !text.includes(FENCE)) {
    return text;
  }
  return parseCodeBlocks(text)
    .map(s => (s.kind === 'code' ? s.code : s.text))
    .join('\n');
}

// ── 偵測「題目提到程式碼」 ─────────────────────────────────────────────
const CODE_REFERENCE_PATTERNS: RegExp[] = [
  // 下列程式、以下程式碼、下面這段程式、上述 C++ 程式片段…
  /(?:下列|以下|如下|下面|下方|上述|上面|右列|左列)(?:這段|這個|的|所示的?|所列的?)?\s*(?:(?:C\+\+|C#|C|Python|Java(?:Script)?|JS|VB|Scratch)\s*)?(?:程式(?!語言|設計)|代碼|代码|code)/i,
  // 程式碼中、程式片段裡
  /(?:程式碼|程式片段|代碼|代码)[中裡里內]/,
  // 「程式…輸出為何」「程式執行後印出」
  /程式.{0,8}(?:執行|運行).{0,8}(?:輸出|印出|結果)/,
  // 英文
  /\b(?:following|below|given|above)\s+(?:\w+\s+)?(?:code|program|snippet|function)\b/i,
  /\b(?:code|program|snippet)\s+(?:below|above|shown)\b/i,
];

/** 題目文字是否在引用一段程式碼（例如「下列程式的輸出為何？」） */
export function referencesCode(text: string): boolean {
  if (!text) {
    return false;
  }
  return CODE_REFERENCE_PATTERNS.some(re => re.test(text));
}

// 看起來像程式碼的一行（題幹沒有圍欄、但程式碼本身其實有附上的情況，避免誤報）
const CODE_LINE_RE = /#include|\bint\s+main\b|\bcout\s*<<|\bcin\s*>>|\bprintf\s*\(|\bdef\s+\w+\s*\(|\bprint\s*\(|System\.out|;\s*$|^\s*[{}]\s*$/;

function countCodeLikeLines(text: string): number {
  return text.split(/\r?\n/).filter(line => CODE_LINE_RE.test(line)).length;
}

/**
 * 題目提到程式碼，但題目裡沒有程式碼 → true（需要老師處理 / AI 補）。
 * 沒圍欄但已經有 ≥2 行像程式碼的內容，視為有附程式碼，不誤報。
 */
export function needsCodeSnippet(text: string): boolean {
  if (!referencesCode(text) || hasCodeBlock(text)) {
    return false;
  }
  return countCodeLikeLines(text) < 2;
}

// ── AI 回傳後處理 ─────────────────────────────────────────────────────
// AI 有時不照指示，把程式碼放到獨立欄位；這些欄位不會被存進 DB，要併回題目
const ALT_CODE_FIELDS = ['code', 'codeSnippet', 'code_snippet', 'snippet', 'program', 'sourceCode', 'source_code'];
const ALT_LANG_FIELDS = ['language', 'lang', 'codeLanguage', 'code_language'];

function guessLang(code: string): string {
  if (/#include|\bcout\s*<<|\bcin\s*>>|\bstd::|\busing\s+namespace\b/.test(code)) {
    return 'cpp';
  }
  if (/\bpublic\s+(?:static\s+)?(?:class|void)\b|System\.out/.test(code)) {
    return 'java';
  }
  if (/^\s*def\s+\w+\s*\(|\bprint\s*\(|^\s*import\s+\w+\s*$/m.test(code)) {
    return 'python';
  }
  if (/\bprintf\s*\(|\bscanf\s*\(/.test(code)) {
    return 'c';
  }
  return '';
}

export type EnsureCodeSnippetsResult = {
  repaired: number; // 從獨立欄位併回題目的題數
  missing: number[]; // 提到程式碼卻沒有程式碼的題目 index（0-based）
};

/**
 * 就地（in-place）修正 AI 回傳的題目陣列：
 * 1. 程式碼若被放在 code / codeSnippet… 等獨立欄位 → 併回題目成為圍欄區塊，並刪掉該欄位
 * 2. 回報仍然「提到程式但沒附程式碼」的題目 index，讓呼叫端記 log / 前端警告
 */
export function ensureCodeSnippets(questions: unknown, field = 'question'): EnsureCodeSnippetsResult {
  const result: EnsureCodeSnippetsResult = { repaired: 0, missing: [] };
  if (!Array.isArray(questions)) {
    return result;
  }

  questions.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const q = item as Record<string, unknown>;
    const body = q[field];
    if (typeof body !== 'string') {
      return;
    }

    const altKey = ALT_CODE_FIELDS.find(k => typeof q[k] === 'string' && (q[k] as string).trim());
    const langKey = ALT_LANG_FIELDS.find(k => typeof q[k] === 'string');
    let nextBody = body;

    if (altKey && !hasCodeBlock(body)) {
      const code = trimBlankLines((q[altKey] as string).replace(/\r\n?/g, '\n'));
      const lang = langKey
        ? (q[langKey] as string).trim().toLowerCase().replace(/[^\w+#.-]/g, '')
        : guessLang(code);
      nextBody = `${body.trimEnd()}\n${FENCE}${lang}\n${code}\n${FENCE}`;
      q[field] = nextBody;
      result.repaired += 1;
    }

    // 清掉 AI 多給的程式碼欄位（不論有沒有併回）
    for (const k of ALT_CODE_FIELDS) {
      delete q[k];
    }
    if (altKey) {
      for (const k of ALT_LANG_FIELDS) {
        delete q[k];
      }
    }

    if (needsCodeSnippet(nextBody)) {
      result.missing.push(index);
    }
  });

  return result;
}
