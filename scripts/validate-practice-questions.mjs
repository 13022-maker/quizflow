#!/usr/bin/env node
/**
 * 檢查 public/practice/*.html 裡的 QUESTIONS 資料結構有沒有低級錯誤。
 * 這支腳本只檢查「格式對不對」,不檢查「內容對不對」——內容正確性要對照
 * 官方題本人工核對,程式沒辦法幫你判斷電子電機知識對不對。
 *
 * 用法: node scripts/validate-practice-questions.mjs [檔案路徑...]
 *       不帶參數時預設檢查 public/practice/ 底下所有 .html
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const practiceDir = join(repoRoot, 'public', 'practice');
const AUTO_IMG_EXTS = ['jpg', 'jpeg', 'png', 'svg', 'webp'];

function extractQuestions(html) {
  // 資料區塊寫在「說明註解結尾」跟「var QUESTIONS=[...]; 結束」之間,中間可能還有
  // GROUP、FLIPFLOP_SVG 之類的輔助變數,所以整段一起當作陳述式執行,而不是只抓陣列字面量。
  const commentEnd = '---------------------------------------------------------------------------- */';
  const questionsMarker = 'var QUESTIONS=';
  const bodyStart = html.includes(commentEnd)
    ? html.indexOf(commentEnd) + commentEnd.length
    : html.indexOf(questionsMarker);
  if (bodyStart === -1) {
    return null;
  }

  const qStart = html.indexOf(questionsMarker, bodyStart);
  if (qStart === -1) {
    return null;
  }
  const closeMarker = '\n  ];';
  const close = html.indexOf(closeMarker, qStart);
  if (close === -1) {
    return null;
  }

  const code = html.slice(bodyStart, close + closeMarker.length - 1); // 保留結尾 ]
  // eslint-disable-next-line no-new-func -- 只執行純資料變數宣告(無函式呼叫/無 I/O),用來安全地把內嵌資料轉成物件
  return new Function(`"use strict"; ${code}; return QUESTIONS;`)();
}

function checkImageFile(imagesDir, relPath, errors, context) {
  // relPath 形如 images/xxx.png,只允許指向 practice/images/ 底下的檔案
  const m = /^images\/([^./][^/]*)$/.exec(relPath);
  if (!m) {
    errors.push(`${context}:圖片路徑「${relPath}」格式異常(應為 images/檔名)`);
    return;
  }
  if (!existsSync(join(imagesDir, m[1]))) {
    errors.push(`${context}:圖片檔案不存在 → ${join('images', m[1])}`);
  }
}

function validateFile(filePath) {
  const html = readFileSync(filePath, 'utf8');

  if (!html.includes('var QUESTIONS=')) {
    // 這支腳本只認得「var QUESTIONS=[...]」這種資料格式,不是每個 public/practice 頁面
    // 都長這樣(例如 forms.html 是表單練習,沒有題目陣列)—— 沒有這個標記就當作不適用,跳過。
    return { errors: [], warnings: [], count: 0, skipped: true };
  }

  const questions = extractQuestions(html);
  const errors = [];
  const warnings = [];

  if (!questions) {
    return { errors: ['有 var QUESTIONS= 標記,但解析失敗(格式跟腳本預期的不一樣)'], warnings, count: 0 };
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return { errors: ['QUESTIONS 不是陣列,或是空的'], warnings, count: 0 };
  }

  const imagesDir = join(dirname(filePath), 'images');
  const seenIds = new Set();

  questions.forEach((q, i) => {
    const ctx = `第 ${i + 1} 筆(id=${q?.id ?? '(缺)'})`;

    if (!q?.id || typeof q.id !== 'string') {
      errors.push(`${ctx}:缺少 id`);
    } else if (seenIds.has(q.id)) {
      errors.push(`${ctx}:id 重複`);
    } else {
      seenIds.add(q.id);
    }

    if (!q?.groupLabel) {
      errors.push(`${ctx}:缺少 groupLabel`);
    }
    if (!q?.question || typeof q.question !== 'string') {
      errors.push(`${ctx}:缺少 question 文字`);
    }

    if (!Array.isArray(q?.options) || q.options.length < 2) {
      errors.push(`${ctx}:options 至少要有 2 個選項`);
    } else {
      q.options.forEach((opt, oi) => {
        if (opt && typeof opt === 'object') {
          if (!opt.img) {
            errors.push(`${ctx}:選項 ${oi + 1} 是圖片選項卻缺少 img`);
          } else {
            checkImageFile(imagesDir, opt.img, errors, `${ctx} 選項 ${oi + 1}`);
          }
        } else if (typeof opt !== 'string' || !opt.trim()) {
          errors.push(`${ctx}:選項 ${oi + 1} 是空的`);
        }
      });
      if (
        typeof q?.correctIndex !== 'number'
        || !Number.isInteger(q.correctIndex)
        || q.correctIndex < 0
        || q.correctIndex >= q.options.length
      ) {
        errors.push(`${ctx}:correctIndex(${q?.correctIndex})超出 options 範圍`);
      }
    }

    if (!q?.explanation || !String(q.explanation).trim()) {
      warnings.push(`${ctx}:沒有寫 explanation(詳解),學生答錯了看不到說明`);
    }

    if (q?.image === false) {
      // 明確標記無圖,不檢查
    } else if (q?.image) {
      const m = /<img[^>]*\ssrc="([^"]+)"/.exec(q.image);
      if (m) {
        checkImageFile(imagesDir, m[1], errors, ctx);
      }
      // 內嵌 SVG 字串就不檢查了(沒有外部檔案依賴)
    } else if (q?.id) {
      const found = AUTO_IMG_EXTS.some(ext => existsSync(join(imagesDir, `${q.id}.${ext}`)));
      if (!found) {
        warnings.push(`${ctx}:image 沒填(會自動嘗試載入),但 images/ 資料夾找不到 ${q.id}.{${AUTO_IMG_EXTS.join(',')}} 任何一個檔案 —— 如果這題本來就沒有圖,建議明確寫 image:false`);
      }
    }
  });

  return { errors, warnings, count: questions.length };
}

function main() {
  const args = process.argv.slice(2);
  const targets = args.length > 0
    ? args.map(p => resolve(repoRoot, p))
    : readdirSync(practiceDir)
      .filter(f => f.endsWith('.html'))
      .map(f => join(practiceDir, f));

  let totalErrors = 0;
  for (const filePath of targets) {
    const rel = filePath.replace(`${repoRoot}/`, '');
    const { errors, warnings, count, skipped } = validateFile(filePath);
    if (skipped) {
      console.log(`\n📄 ${rel} —— 跳過(沒有 QUESTIONS 資料,不是這個格式的練習頁)`);
      continue;
    }
    console.log(`\n📄 ${rel}(共 ${count} 題)`);
    if (errors.length === 0 && warnings.length === 0) {
      console.log('  ✅ 沒有發現結構問題');
    }
    for (const e of errors) {
      console.log(`  ❌ ${e}`);
    }
    for (const w of warnings) {
      console.log(`  ⚠️  ${w}`);
    }
    totalErrors += errors.length;
  }

  console.log(`\n${totalErrors === 0 ? '✅ 全部通過' : `❌ 共 ${totalErrors} 個錯誤`}(結構檢查而已,內容正確性仍須人工對照官方題本)`);
  process.exit(totalErrors === 0 ? 0 : 1);
}

main();
