import type { Contributor } from './contributors';
import type { RubricScores } from './scoring';

export type ReviewGameStatus =
  | 'lobby'
  | 'team_forming'
  | 'reviewing'
  | 'creating'
  | 'voting'
  | 'results'
  | 'ended';

// 學生端看到的範例答案：ref 標準分是老師的答案卷，刻意 strip 掉不給學生看；
// isAiAnswer 相反，是這個功能要學生「看到」才能達成教學目的的旗標，直接原樣傳遞
export type ReviewSampleForClient = {
  id: number;
  content: string;
  orderIndex: number;
  isAiAnswer: boolean;
};

export type ReviewTeamMember = { id: number; nickname: string };

export type ReviewTeamSummary = {
  id: number;
  teamName: string;
  memberCount: number;
  members: ReviewTeamMember[];
  score: number;
};

// 老師結算後（results 階段）每組的明細，用來畫「分數 vs 標準分」對照
export type ReviewTeamResultDetail = {
  teamId: number;
  members: ReviewTeamMember[];
  samples: {
    sampleId: number;
    sampleContent: string;
    teamAvg: RubricScores;
    ref: RubricScores;
    accuracyScore: number;
  }[];
  accuracyScore: number; // 逐則加總（= review_team.accuracy_score）
  speedBonus: number;
  voteBonus: number;
  submission: string | null;
  leaderId: number | null; // 最終送出時的隊長
  autoSubmitted: boolean; // true = 老師推進階段時系統代送，非隊長主動按送出
  contributors: Contributor[]; // 共創階段誰有動手，依草稿字數呈現
  votesReceived: number;
};

export type ReviewHostState = {
  game: {
    id: number;
    status: ReviewGameStatus;
    gamePin: string;
    title: string;
    teamSize: number; // 題組模板預設的小組人數，lobby 開分組前可臨時覆蓋，不影響模板本身
    phaseStartedAt: string | null;
    phaseDurationSec: number | null;
  };
  teams: (ReviewTeamSummary & {
    scoredSampleCount: number; // 至少 1 人評過分的範例答案數
    memberReadyCount: number; // 全部範例答案都評完分的成員數
    hasSubmission: boolean;
    leaderId: number | null; // 目前當選（或預設）的隊長
    autoSubmitted: boolean; // true = 該組是系統逾時代送，不是隊長主動送出
    contributors: Contributor[]; // 共創階段誰有動手，依草稿字數呈現
    votesReceived: number;
  })[];
  totalSamples: number;
  joinedPlayerCount: number; // lobby 階段顯示已加入人數
  // 只有 status === 'results' 才會有值
  resultsDetail: ReviewTeamResultDetail[] | null;
};

export type ReviewTeamState = {
  game: {
    id: number;
    status: ReviewGameStatus;
    phaseStartedAt: string | null;
    phaseDurationSec: number | null;
  };
  topicPrompt: string; // 給小組的延伸創作指示，creating 階段顯示用
  me: { id: number; nickname: string; teamId: number | null; teamName: string | null };
  teammates: { id: number; nickname: string }[];
  samples: ReviewSampleForClient[];
  myScores: Record<number, RubricScores & { comment: string | null }>; // key: sampleId
  teammateScores: Record<
    number,
    (RubricScores & { comment: string | null; playerId: number; nickname: string })[]
  >; // key: sampleId，不含自己
  leaderId: number | null; // 目前組內當選（或預設）的隊長 playerId
  myDraft: string; // 自己的獨立草稿內容
  teammateDrafts: { playerId: number; nickname: string; content: string; updatedAt: string }[]; // 不含自己
  myLeaderVote: number | null; // 我目前投給誰（null = 還沒投）
  submission: { content: string; updatedAt: string; submittedAt: string | null; autoSubmitted: boolean } | null;
  hasVoted: boolean;
  // voting 階段才有值；匿名（不含 teamName），避免人情票
  votingCandidates: { teamId: number; content: string }[] | null;
  finalTeamRank: { rank: number; score: number } | null; // results 階段才有值
};
