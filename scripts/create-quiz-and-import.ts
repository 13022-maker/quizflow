/**
 * 一次性腳本：建立新測驗 + 匯入轉好格式的 JSON 題目
 * 用法：npx dotenv -e .env.production.local -- tsx scripts/create-quiz-and-import.ts <ownerId> <title> <json檔路徑>
 *
 * 註：直接用 pg client 寫 DB，不呼叫 createQuiz/createQuestion server action——
 * 這兩個 action 都依賴 Clerk auth() 的 request context，純 Node 腳本沒有這個 context 會直接噴 Unauthorized。
 * accessCode/roomCode 產生邏輯複製 src/actions/quizActions.ts 的 createQuiz；
 * 題目匯入邏輯複製 src/features/quiz/QuizEditor.tsx 的 handleFileImport（mc 分支）。
 */
import fs from 'node:fs';

import { nanoid } from 'nanoid';
import { Client } from 'pg';

type ImportQuestion = {
  type: 'mc';
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
};

const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

async function generateUniqueRoomCode(client: Client): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const { rows } = await client.query('SELECT id FROM quiz WHERE room_code = $1 LIMIT 1', [code]);
    if (rows.length === 0) {
      return code;
    }
  }
  return generateRoomCode() + generateRoomCode().slice(0, 1);
}

async function main() {
  const [ownerId, title, jsonPath] = process.argv.slice(2);
  if (!ownerId || !title || !jsonPath) {
    console.error('用法：tsx scripts/create-quiz-and-import.ts <ownerId> <title> <json檔路徑>');
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

  const accessCode = nanoid(8);
  const roomCode = await generateUniqueRoomCode(client);

  const quizRes = await client.query(
    `INSERT INTO quiz (owner_id, title, access_code, room_code)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [ownerId, title, accessCode, roomCode],
  );
  const quizId = quizRes.rows[0].id as number;
  console.log(`✅ 已建立測驗 #${quizId} 「${title}」（roomCode=${roomCode}）`);

  let position = 1;
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
      [quizId, q.question, JSON.stringify(options), JSON.stringify([matched.id]), q.explanation ?? null, position],
    );
    position += 1;
    inserted += 1;
  }

  // 平均配分：Math.floor(100/N) 每題基礎分，最後一題補足餘數至 100（對齊 distributePoints 邏輯）
  if (inserted > 0) {
    const base = Math.floor(100 / inserted);
    const remainder = 100 - base * inserted;
    const idsRes = await client.query('SELECT id FROM question WHERE quiz_id = $1 ORDER BY position ASC', [quizId]);
    const ids: number[] = idsRes.rows.map((r: { id: number }) => r.id);
    for (let i = 0; i < ids.length; i++) {
      const points = base + (i === ids.length - 1 ? remainder : 0);
      await client.query('UPDATE question SET points = $1 WHERE id = $2', [points, ids[i]]);
    }
  }

  console.log(`✅ 匯入完成：${inserted} / ${questions.length} 題寫入 quizId = ${quizId}，總分已平均配分至 100`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
