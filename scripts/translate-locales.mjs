// 以 zh.json 為 source of truth，呼叫 Claude API 批次翻譯到目標語系並輸出 src/locales/<locale>.json
// 用法：ANTHROPIC_API_KEY=sk-... node scripts/translate-locales.mjs ja ko
// 特別處理：保留 {placeholder}、ICU plural、HTML tag、品牌名（QuizFlow / Paddle / Clerk）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

const LOCALE_NAMES = {
  ja: '日本語',
  ko: '한국어',
  en: 'English',
  'zh-CN': '简体中文',
};

const TEACHING_HINTS = {
  ja: '台湾の教育用語を日本の学校教育現場の自然な用語に置き換えてください（例：高中→高校、國中→中学校、國小→小学校、老師→先生、學生→生徒、測驗→テスト/クイズ、題目→問題、作答→回答）。',
  ko: '대만 교육 용어를 한국 학교 교육 현장에서 자연스러운 용어로 변환하세요（예: 高中→고등학교, 國中→중학교, 國小→초등학교, 老師→선생님, 學生→학생, 測驗→퀴즈/시험, 題目→문제, 作答→답변）。',
  en: 'Use teacher-friendly American English. Keep grade-level terms (e.g., 高中 → high school, 國中 → middle school, 國小 → elementary school).',
  'zh-CN': '将台湾繁体教育用语转为大陆常用说法（如：檔案→文件、軟體→软件、資訊→信息、網路→网络），保留简体中文标点。',
};

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/translate-locales.mjs <locale> [locale...]');
  console.error('Supported locales:', Object.keys(LOCALE_NAMES).join(', '));
  process.exit(1);
}
for (const t of targets) {
  if (!LOCALE_NAMES[t]) {
    console.error(`Unsupported locale: ${t}`);
    process.exit(1);
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required');
  process.exit(1);
}

const client = new Anthropic();
const MODEL = 'claude-sonnet-4-20250514';

const zhPath = path.resolve(process.cwd(), 'src/locales/zh.json');
const zhJson = JSON.parse(readFileSync(zhPath, 'utf8'));

function buildPrompt(locale, nsName, nsContent) {
  return `你是專業的軟體 UI / UX 本地化譯者。請將以下 JSON 翻譯為 ${LOCALE_NAMES[locale]}。

嚴格規則：
1. 只輸出翻譯後的 JSON，不加任何 markdown 代碼框、說明、前後綴文字。
2. 鍵名（key）完全保留，不翻譯。
3. 值中的 {變數} 或 {count, plural, ...} 等 ICU 佔位符原樣保留。
4. HTML tag（如 <strong>、<br/>）原樣保留。
5. 品牌名不翻譯：QuizFlow、Paddle、Clerk、Claude、Google、LINE、Classroom、Stripe、ECPay。
6. 產品術語對齊：AI 出題 / AI 題庫 / 測驗 / 題目 / 作答 / 老師 / 學生 / 訂閱 / 方案。
7. ${TEACHING_HINTS[locale]}
8. 語氣保持與原文一致（行銷頁面熱情、Dashboard 專業、錯誤訊息直白）。
9. 數字、貨幣符號、英數單位原樣保留。

來源 namespace："${nsName}"
來源 JSON：
${JSON.stringify(nsContent, null, 2)}

請直接輸出翻譯後的 JSON：`;
}

async function translateNamespace(locale, nsName, nsContent) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: buildPrompt(locale, nsName, nsContent) }],
  });
  const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error(`[${locale}] namespace "${nsName}" JSON parse failed:`, err.message);
    console.error('raw:', text);
    throw err;
  }
}

function verifyShape(zh, out, pathPrefix = '') {
  for (const [k, v] of Object.entries(zh)) {
    const p = pathPrefix ? `${pathPrefix}.${k}` : k;
    if (!(k in out)) {
      throw new Error(`Missing key: ${p}`);
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      if (typeof out[k] !== 'object' || out[k] === null) {
        throw new Error(`Expected object at: ${p}`);
      }
      verifyShape(v, out[k], p);
    }
  }
}

async function translateLocale(locale) {
  console.log(`\n=== Translating → ${locale} (${LOCALE_NAMES[locale]}) ===`);
  const result = {};
  const entries = Object.entries(zhJson);
  for (let i = 0; i < entries.length; i++) {
    const [nsName, nsContent] = entries[i];
    process.stdout.write(`  [${i + 1}/${entries.length}] ${nsName} ... `);
    const translated = await translateNamespace(locale, nsName, nsContent);
    result[nsName] = translated;
    console.log('ok');
  }

  verifyShape(zhJson, result);

  const outPath = path.resolve(process.cwd(), `src/locales/${locale}.json`);
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`✔ wrote ${outPath}`);
}

for (const locale of targets) {
  await translateLocale(locale);
}

console.log('\nAll done.');
