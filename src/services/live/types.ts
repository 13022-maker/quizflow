// Live Mode 型別定義：前後端共用，避免到處 import Drizzle row 型別

export type LiveGameStatus = 'waiting' | 'playing' | 'showing_result' | 'finished';

// 玩法：classic = 全班同時作答、越快越高分；team_buzzer = 小組搶答
export type LiveGameMode = 'classic' | 'team_buzzer';

export type LiveBuzzResult = 'queued' | 'answering' | 'correct' | 'wrong' | 'timeout';

export type LiveQuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'listening';

export type LiveQuestionOption = { id: string; text: string };

// 老師主控台看到的當前題目（含正解，因為老師端才會 render）
export type LiveQuestionForHost = {
  id: number;
  type: LiveQuestionType;
  body: string;
  imageUrl: string | null;
  audioUrl: string | null; // 聽力題音檔網址
  audioDurationSec: number | null; // 聽力題音檔秒數（Live Mode 計時用）
  options: LiveQuestionOption[];
  correctAnswers: string[];
};

// 學生看到的當前題目（不含正解，避免偷看）
export type LiveQuestionForPlayer = {
  id: number;
  type: LiveQuestionType;
  body: string;
  imageUrl: string | null;
  audioUrl: string | null; // 聽力題音檔網址
  audioDurationSec: number | null; // 聽力題音檔秒數（判斷「音檔播完才顯示選項」用）
  options: LiveQuestionOption[];
};

export type LivePlayerSummary = {
  id: number;
  nickname: string;
  score: number;
  correctCount: number;
  disconnected: boolean; // 新增：(NOW() - last_seen_at) > 15s
};

// 單題答題統計
export type LiveAnswerStat = {
  optionId: string;
  count: number;
};

// ── 小組搶答（team_buzzer）專用 ─────────────────────────────────────────

export type LiveTeamSummary = {
  id: number;
  name: string; // 「第 1 組」
  orderIndex: number;
  score: number;
  members: { id: number; nickname: string; disconnected: boolean }[];
};

// 一筆搶答紀錄（學生端版本：不含所選答案，避免揭曉前洩漏線索）
export type LiveBuzzEntry = {
  id: number;
  order: number; // 1-based 搶答名次（依 server 收到時間）
  teamId: number;
  teamName: string;
  playerId: number;
  nickname: string;
  result: LiveBuzzResult;
  buzzedAt: string; // ISO（server 時鐘）
  answerGrantedAt: string | null;
  answerDeadlineAt: string | null; // answerGrantedAt + 15 秒
};

export type LiveBuzzEntryForHost = LiveBuzzEntry & {
  selectedOptionId: string | string[] | null;
};

export type LiveBuzzerPlayerStat = {
  playerId: number;
  nickname: string;
  teamId: number | null;
  buzzWonCount: number; // 取得作答權次數
  buzzCorrectCount: number; // 答對次數
};

type LiveBuzzerCommonView = {
  serverNow: string; // server（DB）時鐘，client 用來校正本機時間差
  readingMs: number; // 看題倒數
  answerMs: number; // 作答時限
  teams: LiveTeamSummary[]; // 依組號排序
};

export type LiveBuzzerHostView = LiveBuzzerCommonView & {
  buzzes: LiveBuzzEntryForHost[]; // 當前題，依搶答名次排序
  unassignedCount: number; // 尚未分組的玩家數（大廳階段 = 全部）
  playerStats: LiveBuzzerPlayerStat[];
};

export type LiveBuzzerPlayerView = LiveBuzzerCommonView & {
  myTeam: { id: number; name: string; score: number } | null;
  buzzes: LiveBuzzEntry[];
  myStats: { buzzWonCount: number; buzzCorrectCount: number };
};

export type LiveHostState = {
  game: {
    id: number;
    quizId: number;
    title: string;
    gamePin: string;
    status: LiveGameStatus;
    gameMode: LiveGameMode;
    teamCount: number | null;
    currentQuestionIndex: number;
    questionStartedAt: string | null; // ISO string，client 端 parseable
    questionDuration: number;
    totalQuestions: number;
  };
  players: LivePlayerSummary[];
  currentQuestion: LiveQuestionForHost | null;
  answerStats: LiveAnswerStat[]; // showing_result 階段才有意義
  answeredCount: number; // 當題已答人數
  buzzer?: LiveBuzzerHostView; // 只有 team_buzzer 才有（classic 回應不含此 key）
};

export type LivePlayerState = {
  game: {
    id: number;
    title: string;
    status: LiveGameStatus;
    gameMode: LiveGameMode;
    currentQuestionIndex: number;
    questionStartedAt: string | null;
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
  buzzer?: LiveBuzzerPlayerView; // 只有 team_buzzer 才有（classic 回應不含此 key）
};
