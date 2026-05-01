// Fork API 純邏輯層
// - 不直接接 DB(DAO 層在 fork-dao.ts)
// - 不直接接 Clerk auth(由 caller 注入 actorId / isPro)
// - 對外曝露三個函數:assertCanFork（業務規則）、buildNewQuizValues（quiz 欄位映射）、buildForkedQuestions（題目欄位映射）

// quiz 表 visibility 三態,與 schema 一致
type Visibility = 'private' | 'unlisted' | 'public';

// question 表 type enum,與 schema 一致
type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'short_answer'
  | 'ranking'
  | 'listening';

// fork 來源 quiz 需要讀取的欄位（DAO 層 select 後傳入）
export type SourceQuiz = {
  id: number;
  ownerId: string;
  title: string;
  description: string | null;
  visibility: Visibility;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  allowedAttempts: number | null;
  showAnswers: boolean;
  timeLimitSeconds: number | null;
  preventLeave: boolean;
  scoringMode: string;
  attemptDecayRate: number;
  quizMode: string;
  category: string | null;
  gradeLevel: string | null;
  tags: string[];
};

// fork 來源 question 需要讀取的欄位
export type SourceQuestion = {
  type: QuestionType;
  body: string;
  imageUrl: string | null;
  audioUrl: string | null;
  audioTranscript: string | null;
  options: { id: string; text: string }[] | null;
  correctAnswers: string[] | null;
  points: number;
  position: number;
  aiHint: string | null;
};

// 業務錯誤代碼;route layer 對應到 HTTP status
export type ForkErrorCode = 'not-found' | 'visibility' | 'self-fork' | 'plan';

export class ForkError extends Error {
  code: ForkErrorCode;

  constructor(code: ForkErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ForkError';
  }
}

/**
 * 業務規則檢查;不通過拋 ForkError。
 * 順序：資源存在 → 方案 → self-fork → visibility（404 在 403 之前,避免洩漏方案資訊）
 */
export function assertCanFork(
  source: SourceQuiz | null,
  actorId: string,
  isPro: boolean,
): asserts source is SourceQuiz {
  if (!source) {
    throw new ForkError('not-found', '找不到此測驗');
  }
  if (!isPro) {
    throw new ForkError('plan', 'Fork 為 Pro 方案功能,請升級');
  }
  if (source.ownerId === actorId) {
    throw new ForkError('self-fork', '無法 fork 自己的測驗');
  }
  if (source.visibility !== 'public' && source.visibility !== 'unlisted') {
    throw new ForkError('visibility', '此測驗未公開,無法複製');
  }
}

/**
 * 6 碼大寫英數隨機房間碼（與 marketplaceActions 既有實作對齊）。
 * unique 衝突由 DAO 層 retry / DB 處理,本函數只負責產碼。
 */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * 建構新 quiz 的 insert values。
 * codes（accessCode / roomCode）由 caller 注入,讓本函數保持純粹（測試時免 mock 隨機產生器）。
 */
export function buildNewQuizValues(
  source: SourceQuiz,
  ownerId: string,
  codes: { accessCode: string; roomCode: string },
) {
  return {
    // 新 owner & 新識別碼
    ownerId,
    title: `${source.title}（副本）`,
    accessCode: codes.accessCode,
    roomCode: codes.roomCode,

    // 直接繼承的教學設定
    description: source.description,
    category: source.category,
    gradeLevel: source.gradeLevel,
    tags: source.tags,
    quizMode: source.quizMode,
    shuffleQuestions: source.shuffleQuestions,
    shuffleOptions: source.shuffleOptions,
    allowedAttempts: source.allowedAttempts,
    showAnswers: source.showAnswers,
    timeLimitSeconds: source.timeLimitSeconds,
    preventLeave: source.preventLeave,
    scoringMode: source.scoringMode,
    attemptDecayRate: source.attemptDecayRate,

    // 強制重置:新 quiz 預設不發佈、不公開、無到期
    status: 'draft' as const,
    visibility: 'private' as const,
    slug: null,
    publishedAt: null,
    expiresAt: null,
    forkCount: 0,

    // lineage
    forkedFromId: source.id,

    // 不繼承書商欄位（防徽章污染：南一書局徽章被一般老師繼承）
    publisherId: null,
    isbn: null,
    chapter: null,
    bookTitle: null,
  };
}

/**
 * 建構新 question 的 insert values。
 * 維持原 position（不重新編號,避免老師看到順序意外變動）;
 * aiHint 直接拷貝（修現況 copyQuizFromMarketplace 漏拷的 bug）。
 */
export function buildForkedQuestions(
  questions: SourceQuestion[],
  newQuizId: number,
) {
  return questions.map(q => ({
    quizId: newQuizId,
    type: q.type,
    body: q.body,
    imageUrl: q.imageUrl,
    audioUrl: q.audioUrl,
    audioTranscript: q.audioTranscript,
    options: q.options,
    correctAnswers: q.correctAnswers,
    points: q.points,
    position: q.position,
    aiHint: q.aiHint,
  }));
}
