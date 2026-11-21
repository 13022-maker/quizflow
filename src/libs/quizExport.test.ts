import { createRequire } from 'node:module';

import type { InferSelectModel } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { questionSchema, quizSchema } from '@/models/Schema';

import { generateQuizDocx } from './quizExport';

// jszip 是 docx 的相依套件，專案沒直接安裝，這裡只宣告用到的最小型別
type MinimalJsZip = {
  loadAsync: (data: Uint8Array) => Promise<{ file: (name: string) => { async: (t: 'string') => Promise<string> } | null }>;
};
const JSZip = createRequire(import.meta.url)('jszip') as MinimalJsZip;

type Quiz = InferSelectModel<typeof quizSchema>;
type Question = InferSelectModel<typeof questionSchema>;

async function documentXml(body: string): Promise<string> {
  const quiz = { title: 'C++ 測驗', description: null } as unknown as Quiz;
  const question = {
    id: 1,
    type: 'single_choice',
    body,
    options: [{ id: 'a', text: '6' }, { id: 'b', text: '3' }],
    correctAnswers: ['a'],
    points: 10,
    imageUrl: null,
    explanation: null,
  } as unknown as Question;
  const buf = await generateQuizDocx(quiz, [question], 'student');
  const zip = await JSZip.loadAsync(new Uint8Array(buf));
  return zip.file('word/document.xml')!.async('string');
}

describe('generateQuizDocx 程式題', () => {
  it('程式碼用 Consolas 等寬字體、保留縮排，不印出 ``` 圍欄', async () => {
    const xml = await documentXml('下列程式的輸出為何？\n```cpp\nint main() {\n    cout << 6;\n}\n```');

    expect(xml).toContain('Consolas');
    expect(xml).toContain('下列程式的輸出為何？');
    expect(xml).toContain('int main() {');
    expect(xml).toContain('    cout &lt;&lt; 6;');
    expect(xml).not.toContain('```');
  });

  it('一般題目不使用等寬字體', async () => {
    const xml = await documentXml('光合作用的產物為何？');

    expect(xml).toContain('光合作用的產物為何？');
    expect(xml).not.toContain('Consolas');
  });
});
