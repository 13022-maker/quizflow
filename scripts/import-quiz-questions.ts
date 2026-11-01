/**
 * 一次性腳本：把轉好格式的 JSON 題目匯入到指定 quizId
 * 用法：npx dotenv -e .env.local -- tsx scripts/import-quiz-questions.ts <quizId> <json檔路徑>
 * 範例：npx dotenv -e .env.local -- tsx scripts/import-quiz-questions.ts 42 /Users/hsiehchinhung/Downloads/questions-quizflow.json
 *
 * 註：直接用 pg client 寫 DB，不呼叫 createQuestion server action——
 * 該 action 依賴 Clerk auth() 的 request context，純 Node 腳本沒有這個 context 會直接噴 Unauthorized。
 * 這裡複製 src/features/quiz/QuizEditor.tsx 的 handleFileImport（mc 分支）同一套邏輯：
 * 字母答案比對 option id、position 接續現有題目之後。
 */
import fs from 'node:fs';

import { Client } from 'pg';

type ImportQuestion = {
  type: 'mc';
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
};

async function main() {
  const [quizIdArg, jsonPath] = process.argv.slice(2);
  if (!quizIdArg || !jsonPath) {
    console.error('用法：tsx scripts/import-quiz-questions.ts <quizId> <json檔路徑>');
    process.exit(1);
  }

  const quizId = Number(quizIdArg);
  if (!Number.isInteger(quizId)) {
    console.error(`❌ quizId 不是合法整數：${quizIdArg}`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL 未設定');
    process.exit(1);
  }

  const questions: ImportQuestion[] = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const client = new Client({ connectionString: url });
  await client.connect();

  const quizRes = await client.query('SELECT id, title FROM quiz WHERE id = $1', [quizId]);
  if (quizRes.rows.length === 0) {
    console.error(`❌ 找不到 quizId = ${quizId}`);
    await client.end();
    process.exit(1);
  }
  console.log(`目標測驗：#${quizId} 「${quizRes.rows[0].title}」`);

  const posRes = await client.query(
    'SELECT COALESCE(MAX(position), 0) AS max_pos FROM question WHERE quiz_id = $1',
    [quizId],
  );
  let nextPosition = Number(posRes.rows[0].max_pos) + 1;

  let inserted = 0;
  for (const q of questions) {
    const options = q.options.map((text, i) => ({
      id: String.fromCharCode(97 + i), // a, b, c, d
      text,
    }));
    const answerKey = q.answer.trim().toLowerCase();
    const matched = options.find(o => o.id === answerKey);
    if (!matched) {
      console.warn(`⚠️  跳過一題，答案「${q.answer}」比對不到選項：${q.question.slice(0, 40)}...`);
      continue;
    }

    await client.query(
      `INSERT INTO question (quiz_id, type, body, options, correct_answers, explanation, points, position)
       VALUES ($1, 'single_choice', $2, $3, $4, $5, 1, $6)`,
      [quizId, q.question, JSON.stringify(options), JSON.stringify([matched.id]), q.explanation ?? null, nextPosition],
    );
    nextPosition += 1;
    inserted += 1;
  }

  console.log(`✅ 匯入完成：${inserted} / ${questions.length} 題寫入 quizId = ${quizId}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
