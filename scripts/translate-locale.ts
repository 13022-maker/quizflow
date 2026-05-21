/**
 * 翻譯 locale json — 多語系擴展 Phase 1 起的標準工具
 *
 * 用法：
 *   npx dotenv -e .env.local -- tsx scripts/translate-locale.ts \
 *     --target ja --source zh --reference en
 *
 * 可選 flag：
 *   --force          覆寫已存在的 key（預設只翻譯目標檔缺漏的 key）
 *   --section <name> 只翻譯指定 top-level section（debug 用）
 *
 * 行為：
 *   1. 讀 src/locales/{source}.json、src/locales/{reference}.json
 *   2. 以 top-level key 為單位逐塊送 Claude Opus 4.7
 *      - 帶上 QuizFlow 產品名詞對照表，避免機翻味
 *      - 用 tool use 強制結構化輸出
 *   3. merge 進 src/locales/{target}.json（idempotent，重跑不會破壞既有翻譯）
 *   4. 每塊收集 notes，最後寫進 src/locales/{target}.translation-notes.md
 *   5. retry 1 次；仍失敗則跳過該 section 並印警告（不阻擋整體）
 *   6. 結尾印 schema diff（與 source 比對哪些 key 仍是來源語言疑似漏翻）
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import Anthropic from '@anthropic-ai/sdk';

// ===== 設定 =====
const MODEL = 'claude-opus-4-7'; // spec 指定最高品質模型（Opus 4.7）
const LOCALES_DIR = resolve(process.cwd(), 'src/locales');
const MAX_RETRY = 1;

// QuizFlow 產品名詞對照表 — prompt 帶上避免機翻味
const GLOSSARY = `
產品名詞統一對照（請維持一致）：
- 測驗 / 試卷 → クイズ（或 quiz，主要功能名稱保持一致即可）
- 老師 → 先生 / 教師（依語境）
- 學生 → 生徒（中學以下）/ 学生（大學以上）
- 房間碼 → ルームコード
- 命題框架 → 出題フレームワーク
- 試用 → トライアル / 無料体験
- 訂閱 → サブスクリプション
- 升級 → アップグレード
- Pro / Free / Team / Publisher：方案名稱不翻譯，原樣保留
- AI 出題 → AI問題作成 / AI生成
- 蘇格拉底式提示 → ソクラテス式ヒント
`.trim();

// ===== 命令列參數 =====
function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith('--')) {
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const TARGET = String(args.target || '');
const SOURCE = String(args.source || 'zh');
const REFERENCE = String(args.reference || 'en');
const FORCE = Boolean(args.force);
const ONLY_SECTION = typeof args.section === 'string' ? args.section : null;

if (!TARGET) {
  console.error('❌ 缺 --target <locale>，例如：--target ja');
  process.exit(1);
}

if (TARGET === SOURCE) {
  console.error('❌ --target 不能跟 --source 一樣');
  process.exit(1);
}

// 語系 → 完整名稱（給 prompt 用）
const LOCALE_NAMES: Record<string, string> = {
  'zh': '繁體中文（台灣用語）',
  'en': 'English (American)',
  'ja': '日本語（日本本土用語、敬語適度，UI 文字偏中立 polite form）',
  'ko': '한국어（韓國本土用語）',
  'zh-CN': '简体中文（中国大陆用语）',
};

const targetName = LOCALE_NAMES[TARGET] || TARGET;
const sourceName = LOCALE_NAMES[SOURCE] || SOURCE;
const referenceName = LOCALE_NAMES[REFERENCE] || REFERENCE;

// ===== 讀檔 =====
type LocaleJson = Record<string, Record<string, string>>;

function readJson(name: string): LocaleJson {
  const path = resolve(LOCALES_DIR, `${name}.json`);
  if (!existsSync(path)) {
    console.error(`❌ 檔案不存在：${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(name: string, data: LocaleJson) {
  const path = resolve(LOCALES_DIR, `${name}.json`);
  // 維持與 zh.json / en.json 一致：2-space indent，結尾 newline
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

const source = readJson(SOURCE);
const reference = readJson(REFERENCE);

const targetPath = resolve(LOCALES_DIR, `${TARGET}.json`);
const target: LocaleJson = existsSync(targetPath) ? readJson(TARGET) : {};

// ===== 決定要翻譯哪些 section =====
const sectionsToTranslate: string[] = [];
for (const section of Object.keys(source)) {
  if (ONLY_SECTION && section !== ONLY_SECTION) {
    continue;
  }
  if (FORCE) {
    sectionsToTranslate.push(section);
    continue;
  }
  // 缺整塊、或 key 數對不上 → 加進待翻譯
  if (!target[section]) {
    sectionsToTranslate.push(section);
    continue;
  }
  const srcKeys = Object.keys(source[section] || {});
  const tgtKeys = Object.keys(target[section] || {});
  const missing = srcKeys.filter(k => !tgtKeys.includes(k));
  if (missing.length > 0) {
    sectionsToTranslate.push(section);
  }
}

console.warn(`📋 計畫翻譯 ${sectionsToTranslate.length} / ${Object.keys(source).length} sections`);
if (sectionsToTranslate.length === 0) {
  console.warn('✅ 目標檔已是最新，沒有缺漏 key（用 --force 強制重翻）');
  process.exit(0);
}

// ===== Anthropic client =====
const client = new Anthropic();

// 用 tool use 強制結構化輸出
const TRANSLATION_TOOL: Anthropic.Tool = {
  name: 'submit_translation',
  description: '提交翻譯結果與譯者註記',
  input_schema: {
    type: 'object' as const,
    properties: {
      translations: {
        type: 'object' as const,
        description: '翻譯結果，key 對應原文 key，value 為目標語言譯文',
        additionalProperties: { type: 'string' as const },
      },
      notes: {
        type: 'string' as const,
        description: '本 section 的譯者註記：選詞理由、替代方案、需要 spot-check 的地方',
      },
    },
    required: ['translations', 'notes'],
  },
};

type SectionResult = {
  translations: Record<string, string>;
  notes: string;
};

async function translateSection(
  sectionName: string,
  sourceContent: Record<string, string>,
  referenceContent: Record<string, string> | undefined,
): Promise<SectionResult | null> {
  const userPrompt = `你是 QuizFlow（台灣教師 AI 測驗 SaaS）的本地化專家，目標讀者為日本中學～大學老師。

請把以下 section "${sectionName}" 的所有字串從【${sourceName}】翻譯為【${targetName}】。

${GLOSSARY}

翻譯原則：
1. 用詞自然、符合該語系教育界用法（不要機翻味）
2. 維持每個 key 的字串長度合理（UI 元素如按鈕、nav 不可過長）
3. 占位符（{name}, {count}, %s 等）原樣保留
4. HTML / Markdown 標記（<b>、**xx**）原樣保留
5. 標點符號用目標語言慣用形式
6. 若原文是專有名詞或品牌名（QuizFlow、Pro、Free、AI 等）原樣保留
7. 「請」「我」等對話語氣調整為日文 polite form 但不過度敬語

【來源 ${sourceName}】
${JSON.stringify(sourceContent, null, 2)}

【輔證 ${referenceName}（消歧義用，不要翻譯這個）】
${referenceContent ? JSON.stringify(referenceContent, null, 2) : '(無)'}

請呼叫 submit_translation 工具提交翻譯。translations 物件必須包含原文每一個 key（不能漏）。notes 用繁體中文寫，2-4 句重點即可。`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    tools: [TRANSLATION_TOOL],
    tool_choice: { type: 'tool', name: 'submit_translation' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`未收到 tool_use block（section: ${sectionName}）`);
  }

  const input = toolUse.input as SectionResult;
  if (!input?.translations || typeof input.notes !== 'string') {
    throw new Error(`tool_use input 格式錯誤（section: ${sectionName}）`);
  }

  // 驗 key 完整性
  const srcKeys = Object.keys(sourceContent);
  const tgtKeys = Object.keys(input.translations);
  const missing = srcKeys.filter(k => !tgtKeys.includes(k));
  if (missing.length > 0) {
    throw new Error(
      `翻譯結果缺 ${missing.length} 個 key（section: ${sectionName}）：${missing.join(', ')}`,
    );
  }

  return input;
}

// ===== 主流程 =====
const notesPerSection: Record<string, string> = {};
const failedSections: string[] = [];

async function main() {
  for (const sectionName of sectionsToTranslate) {
    const srcContent = source[sectionName] || {};
    const refContent = reference[sectionName];
    process.stdout.write(`🔤 翻譯 ${sectionName} (${Object.keys(srcContent).length} keys)... `);

    let result: SectionResult | null = null;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        result = await translateSection(sectionName, srcContent, refContent);
        break;
      } catch (err) {
        if (attempt < MAX_RETRY) {
          process.stdout.write(`retry... `);
        } else {
          console.warn(`❌ 失敗：${(err as Error).message}`);
          failedSections.push(sectionName);
        }
      }
    }

    if (!result) {
      continue;
    }

    // merge 進 target（不覆寫已存在的 key，除非 --force）
    if (!target[sectionName]) {
      target[sectionName] = {};
    }
    for (const [key, value] of Object.entries(result.translations)) {
      if (!FORCE && target[sectionName][key]) {
        continue;
      }
      target[sectionName][key] = value;
    }
    notesPerSection[sectionName] = result.notes;

    // 漸進寫檔，避免中途 crash 全沒
    writeJson(TARGET, target);
    console.warn(`✅`);
  }

  // ===== 寫 notes markdown =====
  const notesLines: string[] = [
    `# ${TARGET}.json 翻譯註記`,
    '',
    `**生成時間**：${new Date().toISOString()}`,
    `**模型**：${MODEL}`,
    `**來源**：${SOURCE}.json、輔證 ${REFERENCE}.json`,
    '',
    '---',
    '',
  ];
  for (const [section, notes] of Object.entries(notesPerSection)) {
    notesLines.push(`## ${section}`, '', notes, '');
  }
  const notesPath = resolve(LOCALES_DIR, `${TARGET}.translation-notes.md`);
  writeFileSync(notesPath, notesLines.join('\n'), 'utf-8');

  // ===== Schema diff：印疑似漏翻 =====
  console.warn('\n📊 完成統計：');
  console.warn(`  - 成功：${sectionsToTranslate.length - failedSections.length} sections`);
  if (failedSections.length > 0) {
    console.warn(`  - 失敗：${failedSections.length} sections → ${failedSections.join(', ')}`);
  }

  // 簡單檢查：value 是否含大量原文字符（漢字仍存在於 ja 目標 → 疑似漏翻）
  if (TARGET === 'ja') {
    const suspect: string[] = [];
    for (const [section, keys] of Object.entries(target)) {
      for (const [key, value] of Object.entries(keys)) {
      // 純中文（無假名）+ 純英文都列為疑似
        // 用 Unicode property escapes 偵測平假名/片假名/漢字/純 ASCII
        const hasKana = /\p{Script=Hiragana}|\p{Script=Katakana}/u.test(value);
        const hasCJK = /\p{Script=Han}/u.test(value);
        // eslint-disable-next-line regexp/no-obscure-range
        const onlyAscii = /^[ -~]+$/.test(value);
        if (hasCJK && !hasKana && value.length > 3) {
          suspect.push(`${section}.${key} = "${value}" (純漢字無假名)`);
        } else if (onlyAscii && value.length > 3 && !/^[A-Z]{2,}$/.test(value)) {
          suspect.push(`${section}.${key} = "${value}" (純 ASCII)`);
        }
      }
    }
    if (suspect.length > 0) {
      console.warn(`\n⚠️  疑似漏翻 ${suspect.length} 個 key（請 spot-check）：`);
      suspect.slice(0, 20).forEach(s => console.warn(`  - ${s}`));
      if (suspect.length > 20) {
        console.warn(`  ...還有 ${suspect.length - 20} 個`);
      }
    }
  }

  console.warn(`\n📝 ${TARGET}.json 與 ${TARGET}.translation-notes.md 已寫入 src/locales/`);
}

main().catch((err) => {
  console.error('腳本執行失敗：', err);
  process.exit(1);
});
