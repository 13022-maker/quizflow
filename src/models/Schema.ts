import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
]);

export const quizStatusEnum = pgEnum('quiz_status', [
  'draft', // 草稿
  'published', // 已發佈（學生可作答）
  'closed', // 已關閉
]);

// ---------- quizzes ----------

export const quizSchema = pgTable('quiz', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull(), // Clerk user/org ID
  title: text('title').notNull(),
  description: text('description'),
  accessCode: text('access_code').unique(), // 8 碼隨機英數字，學生連結用（防猜測）
  status: quizStatusEnum('status').default('draft').notNull(),
  shuffleQuestions: boolean('shuffle_questions').default(false).notNull(),
  shuffleOptions: boolean('shuffle_options').default(false).notNull(),
  allowedAttempts: integer('allowed_attempts'), // null = 無限制
  showAnswers: boolean('show_answers').default(true).notNull(),
  timeLimitSeconds: integer('time_limit_seconds'), // null = 無限制
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
  options: jsonb('options').$type<{ id: string; text: string }[]>(),
  correctAnswers: jsonb('correct_answers').$type<string[]>(),
  points: integer('points').default(1).notNull(),
  position: integer('position').notNull(), // 排列順序
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

// ---------- ai_usage ----------
// 記錄每個 org 每月的 AI 出題次數（用於 Free Plan quota 限制）

export const aiUsageSchema = pgTable('ai_usage', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull(), // Clerk org ID
  yearMonth: text('year_month').notNull(), // 格式：'2026-04'
  count: integer('count').default(0).notNull(), // 當月已使用次數
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ---------- todo (原有範例，保留供參考) ----------

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
