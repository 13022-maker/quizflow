// 簡答題答案匯總（老師成績頁用）
// 以題目分組，列出每位學生的作答內容；無互動，純 Server Component

type AnswerItem = {
  answerId: number;
  studentName: string | null;
  studentEmail: string | null;
  answer: string;
  submittedAtFormatted: string | null;
};

type Group = {
  question: { id: number; body: string };
  answers: AnswerItem[];
};

type Props = {
  groups: Group[];
  labels: {
    empty_placeholder: string; // 學生交白卷的 placeholder
    anonymous: string; // 沒留名沒留 email 時的 fallback
    no_answers: string; // 此題尚無學生作答
  };
};

export function ShortAnswerSummary({ groups, labels }: Props) {
  return (
    <div className="space-y-4">
      {groups.map(({ question, answers }, idx) => (
        <div key={question.id} className="overflow-hidden rounded-lg border">
          {/* 題目標頭 */}
          <div className="border-b bg-muted/50 px-4 py-3">
            <p className="text-sm">
              <span className="mr-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">
                Q
                {idx + 1}
              </span>
              <span className="font-medium">{question.body}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                ·
                {' '}
                {answers.length}
                {' '}
                筆
              </span>
            </p>
          </div>

          {/* 學生答案列表 */}
          {answers.length === 0
            ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {labels.no_answers}
                </p>
              )
            : (
                <ul className="divide-y">
                  {answers.map((a) => {
                    const studentLabel = a.studentName ?? a.studentEmail ?? labels.anonymous;
                    const isEmpty = a.answer.trim().length === 0;
                    return (
                      <li key={a.answerId} className="px-4 py-3">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{studentLabel}</span>
                          {a.submittedAtFormatted && <span>{a.submittedAtFormatted}</span>}
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm">
                          {isEmpty
                            ? (
                                <span className="italic text-muted-foreground">
                                  {labels.empty_placeholder}
                                </span>
                              )
                            : a.answer}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
        </div>
      ))}
    </div>
  );
}
