/**
 * 稽核適性學習「自建學科」題庫的答案鍵（adaptive_subject.item_bank）
 *
 * 背景：item-for-loop-step-005 答案鍵標 9，實際輸出與解析都是 3，學生選對被判錯。
 * 這支腳本對 DB 裡所有自建學科做兩種檢查：
 *   1. 執行驗證：題幹含 ```c / ```cpp 程式碼的題目，用本機 g++ 實際編譯執行，
 *      stdout 對到的選項 ≠ answerIndex → EXEC_MISMATCH
 *      選項全是「變數＝值」（name[3]='y'、used[3]=5）時，改成在程式後逐一印出每個選項是否成立：
 *      恰好一個成立但 ≠ answerIndex → EXEC_MISMATCH；兩個以上成立 → MULTI_CORRECT；都不成立 → NO_CORRECT
 *   2. 解析自洽：解析結論提到的選項 ≠ answerIndex → EXPLANATION_CONFLICT（只回報，不自動修）
 *   3. 格式：題幹引用程式卻沒有 ```cpp 圍欄 → NO_CODE_FENCE（--fix 時把行號擠成一行的程式碼改寫成圍欄）
 *
 * 用法（需本機有 g++）：
 *   npx dotenv -e .env.local -- tsx scripts/audit-adaptive-answer-keys.ts            # 只報告（預設 dry-run）
 *   npx dotenv -e .env.local -- tsx scripts/audit-adaptive-answer-keys.ts --fix      # 修正 EXEC_MISMATCH 的 answerIndex
 *   npx dotenv -e .env.local -- tsx scripts/audit-adaptive-answer-keys.ts --subject 12   # 只查某個學科 id
 *   npx dotenv -e .env.local -- tsx scripts/audit-adaptive-answer-keys.ts --set item-for-loop-step-005=1 --subject 12
 *       # 手動指定某題正解索引（0 起算）；必須搭配 --subject，避免不同學科同名 id 被一起改
 *   npx dotenv -e .env.local -- tsx scripts/audit-adaptive-answer-keys.ts --subject 12 --set-option "item-integrated-002:1=name[3]='x'"
 *       # 改寫某題某個選項的文字（修 MULTI_CORRECT 用）；同樣必須搭配 --subject
 *
 * --fix 只修「實際執行結果唯一對到某選項」的題目；多個正解、解析衝突需人工判斷（解析本身也可能是錯的）。
 * 改完選項記得重跑一次（不帶參數）確認歸零。
 * 註：直接用 pg client，避開 @/libs/DB 的 top-level await（比照 scripts/list-quizzes.ts）
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from 'pg';

import { needsCodeSnippet } from '../src/lib/codeBlock';
import {
  buildAssertionProgram,
  extractCppSnippet,
  findExplanationKeyConflict,
  matchOutputToOption,
  parseAssertionOutput,
  parseStateAssertion,
  repairInlineCodePrompt,
  type StateAssertion,
  wrapCppProgram,
} from '../src/libs/adaptive/answerKeyCheck';

type Item = {
  id: string;
  knowledgeId: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
};

type ExecResult =
  | { kind: 'ok'; stdout: string }
  | { kind: 'compile_error'; message: string }
  | { kind: 'runtime_error'; message: string };

function parseArgs(argv: string[]) {
  const fix = argv.includes('--fix');
  const subjectIdx = argv.indexOf('--subject');
  const subjectId = subjectIdx !== -1 ? Number(argv[subjectIdx + 1]) : null;
  const sets = new Map<string, number>();
  const optionEdits = new Map<string, { index: number; text: string }[]>();
  argv.forEach((arg, i) => {
    if (arg === '--set') {
      const [itemId, idx] = (argv[i + 1] ?? '').split('=');
      if (!itemId || idx === undefined || !/^[0-3]$/.test(idx)) {
        throw new Error(`--set 格式錯誤：${argv[i + 1]}（應為 itemId=0~3）`);
      }
      sets.set(itemId, Number(idx));
    }
    if (arg === '--set-option') {
      // itemId:索引=新文字（新文字可含 = 與 '）
      const m = /^([^:]+):([0-3])=(.+)$/.exec(argv[i + 1] ?? '');
      if (!m) {
        throw new Error(`--set-option 格式錯誤：${argv[i + 1]}（應為 itemId:0~3=新選項文字）`);
      }
      const edits = optionEdits.get(m[1]!) ?? [];
      edits.push({ index: Number(m[2]), text: m[3]! });
      optionEdits.set(m[1]!, edits);
    }
  });
  if ((sets.size > 0 || optionEdits.size > 0) && subjectId === null) {
    throw new Error('--set／--set-option 必須搭配 --subject <id>');
  }
  return { fix, subjectId, sets, optionEdits };
}

function runCpp(program: string, workDir: string): ExecResult {
  const src = join(workDir, 'main.cpp');
  const bin = join(workDir, 'main');
  writeFileSync(src, program);

  const compile = spawnSync('g++', ['-std=c++17', '-O0', '-w', src, '-o', bin], { encoding: 'utf8', timeout: 20000 });
  if (compile.status !== 0) {
    const stderr = compile.stderr || compile.error?.message || '';
    const firstError = stderr.split('\n').find(line => line.includes('error')) ?? stderr.split('\n')[0] ?? '';
    return { kind: 'compile_error', message: firstError.replace(src, 'main.cpp') };
  }
  const run = spawnSync(bin, [], { encoding: 'utf8', timeout: 3000, input: '' });
  if (run.status !== 0 || run.error) {
    return { kind: 'runtime_error', message: run.error?.message ?? `exit ${run.status}` };
  }
  return { kind: 'ok', stdout: run.stdout };
}

async function main() {
  const { fix, subjectId, sets, optionEdits } = parseArgs(process.argv.slice(2));

  if (spawnSync('g++', ['--version']).status !== 0) {
    console.error('❌ 找不到 g++，無法做執行驗證');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL 未設定');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  const workDir = mkdtempSync(join(tmpdir(), 'adaptive-audit-'));

  try {
    const { rows } = await client.query<{ id: number; name: string; item_bank: { items: Item[] } }>(
      subjectId === null
        ? 'SELECT id, name, item_bank FROM adaptive_subject ORDER BY id'
        : 'SELECT id, name, item_bank FROM adaptive_subject WHERE id = $1',
      subjectId === null ? [] : [subjectId],
    );

    let execChecked = 0;
    let problems = 0;
    let fixed = 0;

    for (const row of rows) {
      const items = row.item_bank.items;
      let dirty = false;

      for (const item of items) {
        const tag = `[學科 ${row.id}「${row.name}」] ${item.id}`;

        // 手動改寫選項文字
        for (const edit of optionEdits.get(item.id) ?? []) {
          console.log(`✏️  ${tag}：選項 ${edit.index}「${item.options[edit.index]}」→「${edit.text}」（--set-option）`);
          item.options[edit.index] = edit.text;
          dirty = true;
          fixed++;
        }

        // 手動指定正解
        const manual = sets.get(item.id);
        if (manual !== undefined && manual !== item.answerIndex) {
          console.log(`✏️  ${tag}：answerIndex ${item.answerIndex}「${item.options[item.answerIndex]}」→ ${manual}「${item.options[manual]}」（--set）`);
          item.answerIndex = manual;
          dirty = true;
          fixed++;
          continue;
        }

        // 1. 執行驗證
        const snippet = extractCppSnippet(item.prompt);
        const assertions = item.options.map(parseStateAssertion);
        const isStateQuestion = assertions.every(a => a !== null) && !/\bmain\s*\(/.test(snippet ?? '');
        if (snippet && isStateQuestion) {
          // 選項全是「變數＝值」：逐一驗證每個選項是否成立
          execChecked++;
          const result = runCpp(buildAssertionProgram(snippet, assertions as StateAssertion[]), workDir);
          const truths = result.kind === 'ok' ? parseAssertionOutput(result.stdout) : null;
          if (!truths || truths.length !== item.options.length) {
            console.log(`·  SKIP ${tag}：${result.kind === 'ok' ? '輸出無法解析' : result.message}`);
          } else {
            const trueIdx = truths.flatMap((t, i) => (t ? [i] : []));
            const list = trueIdx.map(i => `${i}「${item.options[i]}」`).join('、');
            if (trueIdx.length > 1) {
              problems++;
              console.log(`❌ MULTI_CORRECT ${tag}：實際執行後 ${list} 都成立（答案鍵 ${item.answerIndex}）。請用 --set-option 改寫多出來的正解`);
            } else if (trueIdx.length === 0) {
              problems++;
              console.log(`❌ NO_CORRECT ${tag}：實際執行後沒有任何選項成立（答案鍵 ${item.answerIndex}「${item.options[item.answerIndex]}」）`);
            } else if (trueIdx[0] !== item.answerIndex) {
              problems++;
              console.log(`❌ EXEC_MISMATCH ${tag}：答案鍵 ${item.answerIndex}「${item.options[item.answerIndex]}」，實際成立的是 ${list}`);
              if (fix) {
                item.answerIndex = trueIdx[0]!;
                dirty = true;
                fixed++;
                console.log(`   ✅ 已修正為 ${trueIdx[0]}（請另行確認解析文字是否也要改）`);
              }
            }
          }
        } else if (snippet) {
          execChecked++;
          const result = runCpp(wrapCppProgram(snippet), workDir);
          if (result.kind === 'ok') {
            const actual = matchOutputToOption(result.stdout, item.options);
            if (actual === -1) {
              problems++;
              console.log(`⚠️  NO_OPTION_MATCH ${tag}：實際輸出「${result.stdout.trim()}」不在選項 ${JSON.stringify(item.options)} 中（可能題目本身有誤或含未定義行為，需人工確認）`);
            } else if (actual !== item.answerIndex) {
              problems++;
              console.log(`❌ EXEC_MISMATCH ${tag}：答案鍵 ${item.answerIndex}「${item.options[item.answerIndex]}」，實際輸出 ${actual}「${item.options[actual]}」`);
              if (fix) {
                item.answerIndex = actual;
                dirty = true;
                fixed++;
                console.log(`   ✅ 已修正為 ${actual}（請另行確認解析文字是否也要改）`);
              }
            }
          } else {
            // 片段不完整（例如只有函式定義、依賴題幹敘述的變數）無法編譯屬正常，只記錄不算錯
            console.log(`·  SKIP ${tag}：${result.kind === 'compile_error' ? '無法編譯' : '執行失敗'}（${result.message}）`);
          }
        }

        // 3. 格式：題幹引用程式卻沒附圍欄（學生端看到的是擠成一行的程式碼）
        if (needsCodeSnippet(item.prompt)) {
          problems++;
          console.log(`⚠️  NO_CODE_FENCE ${tag}：題幹引用程式碼但沒有 \`\`\`cpp 圍欄（學生端程式碼會擠成一行）`);
          const repaired = fix ? repairInlineCodePrompt(item.prompt) : null;
          if (repaired) {
            item.prompt = repaired;
            dirty = true;
            fixed++;
            console.log(`   ✅ 已改寫成圍欄程式碼：\n${repaired.split('\n').map(l => `      ${l}`).join('\n')}`);
          }
        }

        // 2. 解析自洽
        const conflict = findExplanationKeyConflict(item);
        if (conflict && conflict.keyIndex === item.answerIndex) {
          problems++;
          console.log(`⚠️  EXPLANATION_CONFLICT ${tag}：解析結論「${item.options[conflict.explanationIndex]}」≠ 答案鍵「${item.options[conflict.keyIndex]}」（需人工判斷哪邊對）`);
        }
      }

      if (dirty) {
        await client.query('UPDATE adaptive_subject SET item_bank = $1, updated_at = now() WHERE id = $2', [
          JSON.stringify({ ...row.item_bank, items }),
          row.id,
        ]);
      }
    }

    console.log(`\n共 ${rows.length} 個學科；執行驗證 ${execChecked} 題；發現問題 ${problems} 筆；已寫回修正 ${fixed} 處${fix || sets.size > 0 || optionEdits.size > 0 ? '' : '（dry-run，未寫入）'}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
