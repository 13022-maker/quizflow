import type { RubricScores } from './scoring';

export type ReviewGameStatus =
  | 'lobby'
  | 'team_forming'
  | 'reviewing'
  | 'creating'
  | 'voting'
  | 'results'
  | 'ended';

// 學生端看到的範例答案：不含老師標準分
export type ReviewSampleForClient = {
  id: number;
  content: string;
  orderIndex: number;
};

export type ReviewTeamSummary = {
  id: number;
  teamName: string;
  memberCount: number;
  score: number;
};

// 老師結算後（results 階段）每組的明細，用來畫「分數 vs 標準分」對照
export type ReviewTeamResultDetail = {
  teamId: number;
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
  votesReceived: number;
};

export type ReviewHostState = {
  game: {
    id: number;
    status: ReviewGameStatus;
    gamePin: string;
    title: string;
    phaseStartedAt: string | null;
    phaseDurationSec: number | null;
  };
  teams: (ReviewTeamSummary & {
    scoredSampleCount: number; // 至少 1 人評過分的範例答案數
    memberReadyCount: number; // 全部範例答案都評完分的成員數
    hasSubmission: boolean;
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
  submission: { content: string; updatedAt: string } | null;
  hasVoted: boolean;
  // voting 階段才有值；匿名（不含 teamName），避免人情票
  votingCandidates: { teamId: number; content: string }[] | null;
  finalTeamRank: { rank: number; score: number } | null; // results 階段才有值
};
