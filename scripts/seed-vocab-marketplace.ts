/**
 * 一次性 seed：用 Claude API 生成 9 組單字卡並上架題庫市集
 *
 * 用法：
 *   npx dotenv -e .env.local -- tsx scripts/seed-vocab-marketplace.ts
 *
 * 可選參數：
 *   --owner-id <clerk_user_id>  指定 ownerId（預設 prpispace VIP）
 *   --only <1..9>               只跑指定那組（重試用）
 *
 * 注意：直接寫入 production Neon。啟動後有 5 秒延遲可 Ctrl+C 中止。
 */

import process from 'node:process';

import Anthropic from '@anthropic-ai/sdk';
import { drizzle } from 'drizzle-orm/node-postgres';
import { nanoid } from 'nanoid';
import { Pool } from 'pg';

import { vocabCardSchema, vocabSetSchema } from '../src/models/Schema';

// ---------- 9 組設定 ----------
type SetType = 'english' | 'chinese';

type SetMeta = {
  index: number; // 1..9
  title: string;
  category: '英語' | '國文';
  gradeLevel: '國中一年級' | '國中三年級' | '高中一年級' | '高中三年級' | '大學';
  type: SetType;
  difficulty: '基礎' | '中階' | '進階';
  topicHint: string; // 給 Claude 的主題描述
  exampleSeed: string; // 範例詞（提示 LLM 風格與難度）
};

const SETS: SetMeta[] = [
  {
    index: 1,
    title: '國中會考基礎 1200 字（精選 30）',
    category: '英語',
    gradeLevel: '國中一年級',
    type: 'english',
    difficulty: '基礎',
    topicHint: '國中會考基礎 1200 字（教育部國中小英語常用 2000 字的低階子集）',
    exampleSeed: 'apple, family, school, friend, happy',
  },
  {
    index: 2,
    title: '國中會考衝刺核心字（精選 30）',
    category: '英語',
    gradeLevel: '國中三年級',
    type: 'english',
    difficulty: '進階',
    topicHint: '國中會考 1200-2000 字進階段，會考閱讀題常考',
    exampleSeed: 'environment, technology, communicate, support, develop',
  },
  {
    index: 3,
    title: '國中會考常考成語 30 則',
    category: '國文',
    gradeLevel: '國中三年級',
    type: 'chinese',
    difficulty: '中階',
    topicHint: '國中會考國文常考成語，配合白話釋義與典故',
    exampleSeed: '守株待兔、畫蛇添足、亡羊補牢、井底之蛙、刻舟求劍',
  },
  {
    index: 4,
    title: '學測 4500 字精選 30',
    category: '英語',
    gradeLevel: '高中一年級',
    type: 'english',
    difficulty: '基礎',
    topicHint: '大考中心高中英文 4500 字（Level 3-4），學測常考',
    exampleSeed: 'influence, achieve, distribute, organize, atmosphere',
  },
  {
    index: 5,
    title: '學測 7000 字進階 30',
    category: '英語',
    gradeLevel: '高中三年級',
    type: 'english',
    difficulty: '進階',
    topicHint: '大考中心高中英文 7000 字 Level 5-6，學測指考進階段',
    exampleSeed: 'sophisticated, controversy, perceive, comprehensive, ambiguous',
  },
  {
    index: 6,
    title: '學測常考成語典故 30 則',
    category: '國文',
    gradeLevel: '高中三年級',
    type: 'chinese',
    difficulty: '進階',
    topicHint: '高中學測國文常考成語，配合白話釋義與典故出處（史記、世說新語等）',
    exampleSeed: '三顧茅廬、韋編三絕、退避三舍、四面楚歌、臥薪嘗膽',
  },
  {
    index: 7,
    title: '全民英檢中高級 GEPT 30',
    category: '英語',
    gradeLevel: '大學',
    type: 'english',
    difficulty: '基礎',
    topicHint: 'GEPT 中高級（CEFR B2）核心字彙，大學生常用',
    exampleSeed: 'comprehensive, perspective, fundamental, distinguish, accumulate',
  },
  {
    index: 8,
    title: 'TOEIC 商英 + 學術 GRE 30',
    category: '英語',
    gradeLevel: '大學',
    type: 'english',
    difficulty: '進階',
    topicHint: 'TOEIC 商業情境 + GRE 學術詞彙，職場與留學雙用',
    exampleSeed: 'leverage, ubiquitous, corroborate, mitigate, paradigm',
  },
  {
    index: 9,
    title: '大一國文古文虛詞 30 則',
    category: '國文',
    gradeLevel: '大學',
    type: 'chinese',
    difficulty: '進階',
    topicHint: '大一國文古文虛詞與文言常用語法字',
    exampleSeed: '焉、之、其、所以、以',
  },
];

// ---------- prompt 生成 ----------
function buildPrompt(meta: SetMeta): string {
  if (meta.type === 'english') {
    return `你是台灣資深英文教師，擅長依教育部課綱選詞與設計學習素材。請為「${meta.title}」產出 30 張單字卡。

主題：${meta.topicHint}
難度：${meta.difficulty}
範例詞風格：${meta.exampleSeed}（這只是風格參考，請勿複製）

每張卡必須是 JSON 物件，欄位如下：
{
  "front": "中文意思（簡短，≤8 字）",
  "back": "英文 word（單一單字，小寫，無空格）",
  "phonetic": "KK 音標（含中括號 [ ]，例如 [ˈæpl]）",
  "example": "英文例句（10-18 字，含該單字）+ 全形空白 + 中文翻譯（含全形括號）"
}

範例：
{"front":"影響","back":"influence","phonetic":"[ˈɪnflʊəns]","example":"His speech had a great influence on me. （他的演講對我影響很大。）"}

要求：
- 30 張卡都不重複
- 詞性多樣（n. v. adj. adv. 各佔合理比例）
- 例句必須**包含該單字本身**（含同詞性變化也可）、貼近台灣學生情境
- 例句中文翻譯必須流暢自然
- 輸出格式：頂層 JSON array，**禁止用 markdown 包裝、禁止任何註解或前後說明**

僅輸出 JSON array，無其他內容。`;
  }

  // 國文（成語/虛詞）
  return `你是台灣資深國文教師，熟悉學測與會考常考題型。請為「${meta.title}」產出 30 張詞語卡。

主題：${meta.topicHint}
難度：${meta.difficulty}
範例詞風格：${meta.exampleSeed}（這只是風格參考，請勿複製）

每張卡必須是 JSON 物件，欄位如下：
{
  "front": "詞語/成語/虛詞（≤6 字）",
  "back": "白話釋義（15-30 字，準確流暢）",
  "phonetic": "注音符號（每字加聲調，例如 ㄕㄡˇ ㄓㄨ ㄉㄞˋ ㄊㄨˋ）",
  "example": "出處原文片段或例句（含該詞），全形句號結尾"
}

範例：
{"front":"守株待兔","back":"比喻拘泥於舊有經驗，不知變通的愚昧行為","phonetic":"ㄕㄡˇ ㄓㄨ ㄉㄞˋ ㄊㄨˋ","example":"出自《韓非子·五蠹》：「兔走觸株，折頸而死，因釋其耒而守株，冀復得兔。」"}

要求：
- 30 則都不重複
- 釋義必須準確（不可望文生義誤解古意）
- 注音符號正確（含聲調符號 ˊˇˋ˙）
- 出處或例句須真實，不可編造
- 輸出格式：頂層 JSON array，**禁止用 markdown 包裝、禁止任何註解或前後說明**

僅輸出 JSON array，無其他內容。`;
}

// ---------- 呼叫 Claude ----------
type Card = {
  front: string;
  back: string;
  phonetic: string;
  example: string;
};

const anthropic = new Anthropic();

async function generateCards(meta: SetMeta): Promise<Card[]> {
  const prompt = buildPrompt(meta);
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  // 容錯：Claude 偶爾會用 ```json ... ``` 包，剝掉
  const cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`回應格式錯誤，找不到 JSON array：\n${text.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) {
    throw new Error('回應非 array');
  }

  // 基本欄位檢查
  const valid = parsed.filter((c: any) =>
    typeof c.front === 'string' && c.front.length > 0
    && typeof c.back === 'string' && c.back.length > 0
    && typeof c.phonetic === 'string'
    && typeof c.example === 'string',
  );

  if (valid.length < 25) {
    throw new Error(`有效卡片不足（${valid.length}/30）：\n${text.slice(0, 300)}`);
  }

  return valid.slice(0, 30);
}

// ---------- 主流程 ----------
async function main() {
  // env 檢查
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL 未設定');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY 未設定');
    process.exit(1);
  }

  // 參數
  const args = process.argv.slice(2);
  const ownerIdArg = args[args.indexOf('--owner-id') + 1];
  const onlyArg = args.indexOf('--only') >= 0 ? Number.parseInt(args[args.indexOf('--only') + 1] ?? '', 10) : null;

  const ownerId = (args.includes('--owner-id') && ownerIdArg) ? ownerIdArg : 'user_3C9FZwiUnMJYsBJ7T05aqmFku58';
  const targetSets = onlyArg ? SETS.filter(s => s.index === onlyArg) : SETS;

  console.log('⚠️  即將寫入 production Neon');
  console.log(`   ownerId: ${ownerId}`);
  console.log(`   要產生：${targetSets.length} 組（${targetSets.map(s => `#${s.index}`).join(', ')}）`);
  console.log('   5 秒後開始，Ctrl+C 中止...\n');
  await new Promise(r => setTimeout(r, 5000));

  // 連 DB
  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool, { schema: { vocabSetSchema, vocabCardSchema } });

  // 統計
  const succeeded: Array<{ index: number; setId: number; title: string }> = [];
  const failed: Array<{ index: number; title: string; error: string }> = [];

  for (const meta of targetSets) {
    console.log(`\n[${meta.index}/${SETS.length}] 生成「${meta.title}」...`);
    try {
      // 1. Claude 生成
      const t0 = Date.now();
      const cards = await generateCards(meta);
      console.log(`   ✓ Claude 回傳 ${cards.length} 張卡 (${Date.now() - t0}ms)`);

      // 2. INSERT vocabSet
      const [inserted] = await db.insert(vocabSetSchema).values({
        ownerId,
        title: meta.title,
        accessCode: nanoid(8),
        status: 'published',
        visibility: 'public',
        category: meta.category,
        gradeLevel: meta.gradeLevel,
      }).returning();

      if (!inserted) {
        throw new Error('vocab_set insert 失敗（無回傳）');
      }

      const setId = inserted.id;

      // 3. INSERT 30 cards
      await db.insert(vocabCardSchema).values(
        cards.map((c, i) => ({
          setId,
          front: c.front,
          back: c.back,
          phonetic: c.phonetic || null,
          example: c.example || null,
          position: i,
        })),
      );

      console.log(`   ✅ 寫入完成 setId=${setId}（${cards.length} 張卡）`);
      succeeded.push({ index: meta.index, setId, title: meta.title });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ❌ 失敗：${msg}`);
      failed.push({ index: meta.index, title: meta.title, error: msg });
    }
  }

  // 收尾
  await pool.end();

  console.log('\n========== 總結 ==========');
  console.log(`✅ 成功：${succeeded.length} 組`);
  succeeded.forEach((s) => {
    console.log(`   #${s.index} setId=${s.setId} ${s.title}`);
  });
  if (failed.length > 0) {
    console.log(`\n❌ 失敗：${failed.length} 組`);
    failed.forEach((f) => {
      console.log(`   #${f.index} ${f.title} — ${f.error}`);
    });
    console.log(`\n重跑指定組：npx dotenv -e .env.local -- tsx scripts/seed-vocab-marketplace.ts --only ${failed[0]?.index}`);
  }
  console.log(`\n總卡數：${succeeded.length * 30}\n`);
}

main().catch((err) => {
  console.error('\n💥 未捕捉錯誤：', err);
  process.exit(1);
});
