export interface EnrichedQuiz {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  createdAt: Date;
  responseCount: number;
}

export interface DashboardData {
  recentQuizzes: EnrichedQuiz[];
  totalQuizCount: number;
  publishedCount: number;
  totalResponses: number;
  avgScorePercent: number | null;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已發佈',
  closed: '已關閉',
};

export function relativeDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 週前`;
  if (days < 365) return `${Math.floor(days / 30)} 個月前`;
  return `${Math.floor(days / 365)} 年前`;
}
