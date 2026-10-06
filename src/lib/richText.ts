/**
 * 題目文字（題幹／選項／詳解）的輕量 Markdown 解析
 *
 * 只支援兩種語法，其餘一律當純文字：
 * - fenced code block：```lang\n...\n```（程式題的程式碼，保留換行與縮排）
 * - 行內 code：`x++`
 *
 * 刻意不用 marked + dangerouslySetInnerHTML：題目內容可能是老師手打或市集 fork 來的，
 * 全部走 React 文字節點渲染即可天然防 XSS，也不必另外引入 sanitizer。
 */

export type RichTextBlock =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; code: string };

export type InlineSegment = { kind: 'text' | 'code'; text: string };

const FENCE = '```';

// fence 開頭那行若只有「語言名稱」才視為 info string（c、cpp、c++、c#、objective-c、python3…）；
// 含空白等其他字元就代表 AI 直接把程式碼接在 ``` 後面，整行當程式碼內容
const LANG_RE = /^[\w+#.-]*$/;

/** 文字是否含 fenced code block */
export function hasCodeBlock(text: string): boolean {
  return text.includes(FENCE);
}

/** 拆出 fence 內容的語言標記與程式碼本體 */
function splitFenceContent(raw: string): { lang: string; code: string } {
  const newlineIdx = raw.indexOf('\n');
  let lang = '';
  let code = raw;
  if (newlineIdx >= 0) {
    const firstLine = raw.slice(0, newlineIdx).trim();
    if (LANG_RE.test(firstLine)) {
      lang = firstLine;
      code = raw.slice(newlineIdx + 1);
    }
  }
  // 只去掉結尾換行（收尾 ``` 前那個 \n），開頭縮排要保留
  return { lang, code: code.replace(/\n+$/, '') };
}

/**
 * 把文字拆成「一般文字」與「程式碼區塊」。
 * - 沒有 fence → 原字串原樣回傳（舊資料顯示完全不變）
 * - 未閉合的 fence → 其後全部視為程式碼（AI 輸出被截斷時仍可閱讀）
 */
export function parseRichText(input: string): RichTextBlock[] {
  if (!input) {
    return [];
  }
  if (!hasCodeBlock(input)) {
    return [{ kind: 'text', text: input }];
  }

  const src = input.replace(/\r\n?/g, '\n');
  const blocks: RichTextBlock[] = [];
  const pushText = (s: string) => {
    // 夾在 fence 之間的文字，去掉頭尾換行（那是 fence 自己佔的行），內部換行保留
    const t = s.replace(/^\n+|\n+$/g, '');
    if (t.trim()) {
      blocks.push({ kind: 'text', text: t });
    }
  };

  let pos = 0;
  while (pos < src.length) {
    const open = src.indexOf(FENCE, pos);
    if (open < 0) {
      pushText(src.slice(pos));
      break;
    }
    pushText(src.slice(pos, open));

    const contentStart = open + FENCE.length;
    const close = src.indexOf(FENCE, contentStart);
    const raw = close < 0 ? src.slice(contentStart) : src.slice(contentStart, close);
    const { lang, code } = splitFenceContent(raw);
    if (code.trim()) {
      blocks.push({ kind: 'code', lang, code });
    }
    pos = close < 0 ? src.length : close + FENCE.length;
  }
  return blocks;
}

/** 解析行內 `code`（不跨行；落單的反引號維持原樣） */
export function parseInlineCode(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) {
      segments.push({ kind: 'text', text: text.slice(last, m.index) });
    }
    segments.push({ kind: 'code', text: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: 'text', text: text.slice(last) });
  }
  return segments.length > 0 ? segments : [{ kind: 'text', text }];
}

function stripInlineTicks(text: string): string {
  return parseInlineCode(text).map(s => s.text).join('');
}

/**
 * 轉成純文字（列表單行預覽、TTS 朗讀等不適合顯示程式碼區塊的地方用）。
 * 程式碼換行壓成空白，去掉 ``` 與行內反引號。
 */
export function toPlainText(input: string): string {
  if (!hasCodeBlock(input)) {
    return stripInlineTicks(input);
  }
  return parseRichText(input)
    .map(b => (b.kind === 'code' ? b.code.replace(/\s*\n\s*/g, ' ').trim() : stripInlineTicks(b.text)))
    .join(' ');
}
