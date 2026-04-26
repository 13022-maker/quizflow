import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// This file defines the structure of your database tables using the Drizzle ORM.

// To modify the database schema:
// 1. Update this file with your desired changes.
// 2. Generate a new migration by running: `npm run db:generate`

// The generated migration file will reflect your schema changes.
// The migration is automatically applied during the next database interaction,
// so there's no need to run it manually or restart the Next.js server.

// Need a database for production? Check out https://www.prisma.io/?via=saasboilerplatesrc
// Tested and compatible with Next.js Boilerplate
// @deprecated boilerplate 遺留的 Stripe 訂閱表，QuizFlow 已遷移至 Paddle（subscription + paddle_customer）。
//             無程式碼引用，留著 schema 僅為避免產生 DROP TABLE migration（production 仍有歷史 row）。
//             待 publisher 重評時（2026-10-25）一併處理。
export const organizationSchema = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionPriceId: text('stripe_subscription_price_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),
    stripeSubscriptionCurrentPeriodEnd: bigint(
      'stripe_subscription_current_period_end',
      { mode: 'number' },
    ),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      stripeCustomerIdIdx: uniqueIndex('stripe_customer_id_idx').on(
        table.stripeCustomerId,
      ),
    };
  },
);

// ---------- QuizFlow enums ----------

export const questionTypeEnum = pgEnum('question_type', [
  'single_choice', // 單選題
  'multiple_choice', // 多選題
  'true_false', // 是非題
  'short_answer', // 簡答題
  'ranking', // 排序題（拖拉排序）
  'listening', // 聽力題（播放音檔 + 選擇題）
]);

export const quizStatusEnum = pgEnum('quiz_status', [
  'draft', // 草稿
  'published', // 已發佈（學生可作答）
  'closed', // 已關閉
]);

// ---------- quizzes ----------

export const quizSchema = pgTable(
  'quiz',
  {
    id: serial('id').primaryKey(),
    ownerId: text('owner_id').notNull(), // Clerk user ID
    title: text('title').notNull(),
    description: text('description'),
    accessCode: text('access_code').unique(), // 8 碼隨機英數字，學生連結用（防猜測）
    status: quizStatusEnum('status').default('draft').notNull(),
    shuffleQuestions: boolean('shuffle_questions').default(false).notNull(),
    shuffleOptions: boolean('shuffle_options').default(false).notNull(),
    allowedAttempts: integer('allowed_attempts'), // null = 無限制
    showAnswers: boolean('show_answers').default(true).notNull(),
    timeLimitSeconds: integer('time_limit_seconds'), // null = 無限制
    preventLeave: boolean('prevent_leave').default(false).notNull(), // 考試防作弊：攔截離開頁面
    roomCode: text('room_code').unique(), // 6 碼大寫英數房間碼（學生用來快速加入）
    scoringMode: text('scoring_mode').default('highest').notNull(), // highest / latest / first / decay
    attemptDecayRate: real('attempt_decay_rate').default(0.9).notNull(), // decay 模式衰減率
    expiresAt: timestamp('expires_at', { mode: 'date' }), // 到期時間（null = 永不到期）
    quizMode: text('quiz_mode').default('standard').notNull(), // standard / vocab（單字記憶模式）
    // 題庫市集
    isMarketplace: boolean('is_marketplace').default(false).notNull(),
    category: text('category'),
    gradeLevel: text('grade_level'),
    tags: jsonb('tags').$type<string[]>(),
    copyCount: integer('copy_count').default(0).notNull(),
    // 自參照:fork 來源 quiz id（社群化 Phase 1 commit 1 補 FK + ON DELETE SET NULL）
    originalQuizId: integer('original_quiz_id').references(
      (): AnyPgColumn => quizSchema.id,
      { onDelete: 'set null' },
    ),
    // 書商專區（Phase 2）：標註此測驗屬於哪家出版商 + 書本章節元資料，供 marketplace 認證徽章 / 搜尋使用
    publisherId: integer('publisher_id'), // FK → publisher.id（nullable：一般老師測驗無 publisher）
    isbn: text('isbn'),
    chapter: text('chapter'), // 例：「第三課 光合作用」
    bookTitle: text('book_title'),
    // ---------- 社群化 Phase 1（commit 1）----------
    visibility: text('visibility').$type<'private' | 'unlisted' | 'public'>().default('private').notNull(), // private / unlisted / public（CHECK 約束於 table builder 第二參數;commit 2 加 $type narrow 給 caller）
    slug: text('slug'), // 全域唯一（僅當非 NULL，partial unique index），供 public quiz 友善 URL
    publishedAt: timestamp('published_at', { mode: 'date' }), // 首次發佈時間（visibility 從 private 切換時填入）
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      // visibility 限定三態（用 text + CHECK，避免 PG enum 加新值要 ALTER TYPE 的痛）
      visibilityCheck: check(
        'quiz_visibility_check',
        sql`${table.visibility} IN ('private', 'unlisted', 'public')`,
      ),
      // slug 全域唯一但 NULL 不參與（partial unique index）
      slugUniqueIdx: uniqueIndex('quiz_slug_unique_idx')
        .on(table.slug)
        .where(sql`${table.slug} IS NOT NULL`),
    };
  },
);

// ---------- publishers（書商 / 教材出版商） ----------
// 用於 marketplace 品牌認證與批次出題綁定
// verifiedStatus 由管理員（VIP_EMAILS）人工審核，認證後可在 marketplace / 學生頁顯示徽章
// 註：org_id 欄位歷史命名（原綁 Clerk Organization），remove-org 後僅當作識別字串保留，
//     2026-10-25 重評是否改名 owner_id（與其他表一致）

export const publisherSchema = pgTable('publisher', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().unique(), // 識別字串（歷史命名，已脫離 Clerk Org）
  displayName: text('display_name').notNull(), // 例：南一書局 / 翰林出版
  slug: text('slug').notNull().unique(), // URL-safe，例：nani / hanlin
  logoUrl: text('logo_url'),
  bio: text('bio'),
  websiteUrl: text('website_url'),
  verifiedStatus: text('verified_status').default('pending').notNull(), // pending / verified / rejected
  verifiedAt: timestamp('verified_at', { mode: 'date' }),
  contactEmail: text('contact_email'),
  taxId: text('tax_id'), // 統一編號
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------- questions ----------
// options 存成 JSONB：[{ id: string, text: string }]
// correctAnswers 存成 JSONB：string[]（option id 的陣列）
// 簡答題時 correctAnswers 為 null

export const questionSchema = pgTable('question', {
  id: serial('id').primaryKey(),
  quizId: integer('quiz_id')
    .notNull()
    .references(() => quizSchema.id, { onDelete: 'cascade' }),
  type: questionTypeEnum('type').notNull(),
  body: text('body').notNull(), // 題目文字
  imageUrl: text('image_url'), // 題目圖片網址
  audioUrl: text('audio_url'), // 聽力題音檔網址（Vercel Blob）
  audioTranscript: text('audio_transcript'), // 音檔逐字稿（老師可選填，供 AI 出題 / 輔助）
  options: jsonb('options').$type<{ id: string; text: string }[]>(),
  correctAnswers: jsonb('correct_answers').$type<string[]>(),
  points: integer('points').default(1).notNull(),
  position: integer('position').notNull(), // 排列順序
  aiHint: text('ai_hint'), // AI 助教解題提示（≤57 字，國中程度），首次查詢時 lazy 生成並快取
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------- responses ----------
// 一個 response = 一位學生對整份測驗的一次作答

export const responseSchema = pgTable('response', {
  id: serial('id').primaryKey(),
  quizId: integer('quiz_id')
    .notNull()
    .references(() => quizSchema.id, { onDelete: 'cascade' }),
  studentName: text('student_name'), // 學生自填，可為空
  studentEmail: text('student_email'), // 學生自填，可為空
  score: integer('score'), // 計算後寫入（null = 含簡答題，未完整批改）
  totalPoints: integer('total_points'), // 滿分（不含簡答題）
  leaveCount: integer('leave_count').default(0).notNull(), // 考試防作弊：學生離開頁面次數
  submittedAt: timestamp('submitted_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------- answers ----------
// 一個 answer = 一題的作答內容

export const answerSchema = pgTable('answer', {
  id: serial('id').primaryKey(),
  responseId: integer('response_id')
    .notNull()
    .references(() => responseSchema.id, { onDelete: 'cascade' }),
  questionId: integer('question_id')
    .notNull()
    .references(() => questionSchema.id, { onDelete: 'cascade' }),
  answer: jsonb('answer').$type<string | string[]>().notNull(), // 字串或選項 id 陣列
  isCorrect: boolean('is_correct'), // null = 簡答題待批改
});

// ---------- quiz_attempts ----------
// 每次作答的詳細記錄（支援多次作答計分）

export const quizAttemptSchema = pgTable('quiz_attempt', {
  id: serial('id').primaryKey(),
  quizId: integer('quiz_id')
    .notNull()
    .references(() => quizSchema.id, { onDelete: 'cascade' }),
  studentEmail: text('student_email').notNull(), // 學生 email（QuizFlow 學生不登入）
  attemptNumber: integer('attempt_number').notNull(), // 第幾次作答（1-indexed）
  rawScore: real('raw_score').notNull(), // 原始分數（0–100）
  weightedScore: real('weighted_score').notNull(), // 加權後分數（decay 模式用）
  timeSpentSecs: integer('time_spent_secs'), // 作答耗時（秒）
  responseId: integer('response_id')
    .references(() => responseSchema.id, { onDelete: 'set null' }), // 連結到既有 response 表
  submittedAt: timestamp('submitted_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------- quiz_final_scores ----------
// 學生在某份測驗的最終成績（由 scoring 模式決定取哪一次）

export const quizFinalScoreSchema = pgTable('quiz_final_score', {
  id: serial('id').primaryKey(),
  quizId: integer('quiz_id')
    .notNull()
    .references(() => quizSchema.id, { onDelete: 'cascade' }),
  studentEmail: text('student_email').notNull(), // 學生 email
  finalScore: real('final_score').notNull(), // 最終分數
  totalAttempts: integer('total_attempts').default(1).notNull(),
  winningAttemptId: integer('winning_attempt_id')
    .references(() => quizAttemptSchema.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ---------- user_streak ----------
// 老師個人「每日活動連勝」紀錄（以 Clerk userId 為 key）
// 活動定義：成功建立一份測驗即視為當日活動一次，同一天多次不重複計算

export const userStreakSchema = pgTable('user_streak', {
  id: serial('id').primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(), // Clerk user ID
  currentStreak: integer('current_streak').default(0).notNull(), // 目前連勝天數
  longestStreak: integer('longest_streak').default(0).notNull(), // 歷史最長連勝
  lastActivityAt: timestamp('last_activity_at', { mode: 'date' }), // 最後一次活動時間
  freezesLeft: integer('freezes_left').default(0).notNull(), // 剩餘補簽次數
  frozenUntil: timestamp('frozen_until', { mode: 'date' }), // 最近一次使用補簽的時間
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------- user_trial ----------
// 新註冊老師自動獲得 30 天 Pro 試用（首次查詢 lazy init 建立此紀錄）
// ends_at 獨立儲存方便未來支援延長試用 / 客製化天數
// 若有付費訂閱（subscription 表 status = active/trialing/past_due），試用紀錄會被忽略

export const userTrialSchema = pgTable('user_trial', {
  id: serial('id').primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  startedAt: timestamp('started_at', { mode: 'date' }).defaultNow().notNull(),
  endsAt: timestamp('ends_at', { mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------- ai_usage ----------
// 記錄每個用戶每月的 AI 出題次數（用於 Free Plan quota 限制）

export const aiUsageSchema = pgTable('ai_usage', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull(), // Clerk user ID
  yearMonth: text('year_month').notNull(), // 格式：'2026-04'
  count: integer('count').default(0).notNull(), // 當月已使用次數
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ---------- paddle_customers ----------
// Clerk 用戶與 Paddle 客戶的對映關係

export const paddleCustomerSchema = pgTable('paddle_customer', {
  id: serial('id').primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(), // Clerk user ID
  paddleCustomerId: text('paddle_customer_id').notNull().unique(), // Paddle 客戶 ID
  email: text('email').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------- subscriptions ----------
// Paddle 訂閱記錄（由 webhook 寫入/更新）

export const subscriptionSchema = pgTable('subscription', {
  id: serial('id').primaryKey(),
  clerkUserId: text('clerk_user_id').notNull(), // Clerk user ID
  paddleSubscriptionId: text('paddle_subscription_id').unique(), // Paddle 訂閱 ID
  paddleCustomerId: text('paddle_customer_id').notNull(), // Paddle 客戶 ID
  plan: text('plan').default('free').notNull(), // free / pro / team
  billingCycle: text('billing_cycle'), // monthly / yearly
  status: text('status').default('inactive').notNull(), // active / inactive / canceled / past_due
  currentPeriodStart: timestamp('current_period_start', { mode: 'date' }),
  currentPeriodEnd: timestamp('current_period_end', { mode: 'date' }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------- todo (原有範例，保留供參考) ----------

// ---------- vocabulary_set ----------

export const vocabSetSchema = pgTable('vocabulary_set', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  accessCode: text('access_code').unique(),
  status: text('status').default('draft').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------- vocabulary_card ----------

export const vocabCardSchema = pgTable('vocabulary_card', {
  id: serial('id').primaryKey(),
  setId: integer('set_id').notNull().references(() => vocabSetSchema.id, { onDelete: 'cascade' }),
  front: text('front').notNull(),
  back: text('back').notNull(),
  phonetic: text('phonetic'),
  example: text('example'),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

// ---------- Live Mode（直播競賽模式） ----------
// 老師即時帶學生作答（Kahoot 風格）：gamePin 加入 → 同步推題 → 計分排行

export const liveGameStatusEnum = pgEnum('live_game_status', [
  'waiting', // 等待玩家加入
  'playing', // 題目進行中
  'showing_result', // 顯示單題結果
  'finished', // 全部結束
]);

export const liveGameSchema = pgTable('live_game', {
  id: serial('id').primaryKey(),
  quizId: integer('quiz_id')
    .notNull()
    .references(() => quizSchema.id, { onDelete: 'cascade' }),
  hostUserId: text('host_user_id').notNull(), // Clerk userId，多租戶隔離
  title: text('title').notNull(),
  gamePin: text('game_pin').notNull().unique(), // 6 碼大寫英數
  status: liveGameStatusEnum('status').default('waiting').notNull(),
  currentQuestionIndex: integer('current_question_index').default(-1).notNull(), // -1 = 尚未開始
  questionStartedAt: timestamp('question_started_at', { mode: 'date' }),
  questionDuration: integer('question_duration').default(20).notNull(), // 秒
  // 下一次自動推進的時間戳（NULL = 不自動推進，例如 waiting / finished）
  nextTransitionAt: timestamp('next_transition_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { mode: 'date' }),
});

export const livePlayerSchema = pgTable(
  'live_player',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => liveGameSchema.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    playerToken: text('player_token').notNull(), // server 產生，學生存 localStorage 作身分憑證
    score: integer('score').default(0).notNull(),
    correctCount: integer('correct_count').default(0).notNull(),
    joinedAt: timestamp('joined_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      // 同場不可重複暱稱
      gameNicknameIdx: uniqueIndex('live_player_game_nickname_idx').on(
        table.gameId,
        table.nickname,
      ),
      // playerToken 唯一
      playerTokenIdx: uniqueIndex('live_player_token_idx').on(table.playerToken),
    };
  },
);

export const liveAnswerSchema = pgTable(
  'live_answer',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => liveGameSchema.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => livePlayerSchema.id, { onDelete: 'cascade' }),
    questionId: integer('question_id')
      .notNull()
      .references(() => questionSchema.id, { onDelete: 'cascade' }),
    selectedOptionId: jsonb('selected_option_id').$type<string | string[]>(), // 單選 string / 複選 string[]
    isCorrect: boolean('is_correct').default(false).notNull(),
    responseTimeMs: integer('response_time_ms').default(0).notNull(),
    score: integer('score').default(0).notNull(),
    answeredAt: timestamp('answered_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      // 同一玩家同題不可重複作答
      playerQuestionIdx: uniqueIndex('live_answer_player_question_idx').on(
        table.playerId,
        table.questionId,
      ),
    };
  },
);

export const todoSchema = pgTable('todo', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});
