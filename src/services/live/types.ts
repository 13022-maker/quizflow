// Live Mode 型別定義：前後端共用，避免到處 import Drizzle row 型別

// 對應 phase 狀態機：waiting=idle / playing=active / locked / showing_result=reveal / finished=ended
// 命名沿用 DB enum，內部 transition 統一走 stateMachine.ts
export type LiveGameStatus = 'waiting' | 'playing' | 'locked' | 'showing_result' | 'finished';

export type LiveQuestionType = 'single_choice' | 'multiple_choice' | 'true_false';

export type LiveQuestionOption = { id: string; text: string };

// 老師主控台看到的當前題目（含正解，因為老師端才會 render）
export type LiveQuestionForHost = {
  id: number;
  type: LiveQuestionType;
  body: string;
  imageUrl: string | null;
  options: LiveQuestionOption[];
  correctAnswers: string[];
};

// 學生看到的當前題目（不含正解，避免偷看）
export type LiveQuestionForPlayer = {
  id: number;
  type: LiveQuestionType;
  body: string;
  imageUrl: string | null;
  options: LiveQuestionOption[];
};

export type LivePlayerSummary = {
  id: number;
  nickname: string;
  score: number;
  correctCount: number;
};

// 單題答題統計
export type LiveAnswerStat = {
  optionId: string;
  count: number;
};

// 同步用的時間 + 序號資訊：所有 live state 都帶這個，client 用來去重 / 校時
export type LiveSyncMeta = {
  seq: number; // 全域單調遞增；client 收到較舊的 state 直接丟棄
  serverNow: number; // server 當下 epoch ms；client 與 Date.now() 比對算 skew
  quizVersion: number; // quiz 結構版本，client 偵測落差時 force refresh
};

export type LiveHostState = LiveSyncMeta & {
  game: {
    id: number;
    quizId: number;
    title: string;
    gamePin: string;
    status: LiveGameStatus;
    currentQuestionIndex: number;
    questionStartedAt: string | null; // ISO string，client 端 parseable
    questionEndsAt: string | null; // ISO string；絕對結束時間（含 buffer），權威時間來源
    questionDuration: number;
    totalQuestions: number;
  };
  players: LivePlayerSummary[];
  currentQuestion: LiveQuestionForHost | null;
  answerStats: LiveAnswerStat[]; // showing_result 階段才有意義
  answeredCount: number; // 當題已答人數
};

export type LivePlayerState = LiveSyncMeta & {
  game: {
    id: number;
    title: string;
    status: LiveGameStatus;
    currentQuestionIndex: number;
    questionStartedAt: string | null;
    questionEndsAt: string | null;
    questionDuration: number;
    totalQuestions: number;
  };
  me: {
    id: number;
    nickname: string;
    score: number;
    correctCount: number;
    rank: number; // 當前排名（1-indexed）
  };
  currentQuestion: LiveQuestionForPlayer | null;
  myAnswer: {
    selectedOptionId: string | string[] | null;
    isCorrect: boolean;
    score: number;
  } | null; // 已作答才有
  // showing_result 階段才回正解 + stats
  lastResult: {
    correctAnswers: string[];
    answerStats: LiveAnswerStat[];
  } | null;
  leaderboard: LivePlayerSummary[]; // finished 階段回完整排行
};
