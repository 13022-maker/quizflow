/**
 * AI 出題 streaming 用的增量 JSON 解析器
 *
 * AI 回傳格式固定為 { "title": "...", "questions": [ {...}, {...} ] }。
 * 這個 parser 一邊吃 chunk 一邊掃描，每當 questions 陣列裡有一個題目物件「完整閉合」，
 * 就立刻 JSON.parse 吐出來，讓前端不用等整包 JSON 生完才看到第一題。
 *
 * - 會正確處理字串內的 { } [ ] 與跳脫字元（題目文字常出現括號、引號）
 * - 根物件之前的雜訊（例如 ```json 圍欄）會被忽略
 * - 單一題目 parse 失敗就跳過該題（fail-open），不影響其他題
 */

export type StreamParseResult = {
  title?: string;
  questions: Record<string, unknown>[];
};

export class QuestionStreamParser {
  private buf = '';
  private pos = 0;
  private stack: string[] = [];
  private inString = false;
  private escape = false;
  private strStart = -1;
  private lastRootString: string | null = null;
  private currentRootKey: string | null = null;
  private inQuestionsArray = false;
  private objStart = -1;
  private title: string | undefined;
  private titleEmitted = false;

  /** 餵入新的文字片段，回傳這次新完成的 title（只回一次）與題目 */
  push(chunk: string): StreamParseResult {
    this.buf += chunk;
    const out: StreamParseResult = { questions: [] };

    for (; this.pos < this.buf.length; this.pos++) {
      const ch = this.buf[this.pos]!;
      const depth = this.stack.length;

      if (this.inString) {
        if (this.escape) {
          this.escape = false;
        } else if (ch === '\\') {
          this.escape = true;
        } else if (ch === '"') {
          this.inString = false;
          if (depth === 1) {
            const raw = this.buf.slice(this.strStart, this.pos + 1);
            let value: string | null = null;
            try {
              value = JSON.parse(raw) as string;
            } catch {
              value = null;
            }
            // 根層級：字串若是 value（title 的值）就記下，否則當作下一個 key 候選
            if (this.currentRootKey === 'title' && this.title === undefined && value !== null) {
              this.title = value;
              this.currentRootKey = null;
            } else {
              this.lastRootString = value;
            }
          }
        }
        continue;
      }

      if (depth === 0) {
        // 根物件之前的雜訊一律略過
        if (ch === '{') {
          this.stack.push('{');
        }
        continue;
      }

      switch (ch) {
        case '"':
          this.inString = true;
          this.strStart = this.pos;
          break;
        case ':':
          if (depth === 1) {
            this.currentRootKey = this.lastRootString;
            this.lastRootString = null;
          }
          break;
        case ',':
          if (depth === 1) {
            this.currentRootKey = null;
          }
          break;
        case '[':
          if (depth === 1 && this.currentRootKey === 'questions') {
            this.inQuestionsArray = true;
          }
          this.stack.push('[');
          break;
        case '{':
          if (depth === 2 && this.inQuestionsArray) {
            this.objStart = this.pos;
          }
          this.stack.push('{');
          break;
        case '}':
        case ']':
          this.stack.pop();
          if (ch === '}' && this.stack.length === 2 && this.inQuestionsArray && this.objStart >= 0) {
            const raw = this.buf.slice(this.objStart, this.pos + 1);
            this.objStart = -1;
            try {
              const q = JSON.parse(raw);
              if (q && typeof q === 'object' && !Array.isArray(q)) {
                out.questions.push(q as Record<string, unknown>);
              }
            } catch {
              // 單題壞掉就跳過
            }
          }
          if (ch === ']' && this.stack.length === 1 && this.inQuestionsArray) {
            this.inQuestionsArray = false;
          }
          break;
      }
    }

    if (this.title !== undefined && !this.titleEmitted) {
      this.titleEmitted = true;
      out.title = this.title;
    }
    return out;
  }

  /** 目前累積的完整原始文字（串流中斷時 fallback 用） */
  get text(): string {
    return this.buf;
  }
}
