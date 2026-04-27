import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';

import {
  getAvailableExams,
  getAvailableSubjects,
  getTemplateGrade,
  quizTemplates,
  TEMPLATE_GRADE_LEVELS_BY_GRADE,
  TEMPLATE_GRADES,
  type TemplateExam,
  type TemplateGrade,
  type TemplateSubject,
} from '@/data/templates';
import { TemplateCard } from '@/features/templates/TemplateCard';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata = {
  title: '免費測驗範本庫 — QuizFlow（國小、國中、高中、高職分科精選）',
  description:
    '精選 35+ 份分科分學制的免費測驗範本，涵蓋國文、英語、數學、自然、社會，包含國小、國中、高中、高職與大學，所有題目皆附詳解，老師可一鍵複製到自己帳號使用。',
  alternates: { canonical: '/templates' },
};

type FilterParams = {
  subject?: string;
  grade?: string;
  gradeLevel?: string;
  exam?: string;
};

type Props = {
  params: { locale: string };
  searchParams: FilterParams;
};

// 構建保留其他維度的 URL（避免點某維度時清掉其他已選的維度）
function buildHref(params: FilterParams): string {
  const qs = new URLSearchParams();
  if (params.subject) {
    qs.set('subject', params.subject);
  }
  if (params.grade) {
    qs.set('grade', params.grade);
  }
  if (params.gradeLevel) {
    qs.set('gradeLevel', params.gradeLevel);
  }
  if (params.exam) {
    qs.set('exam', params.exam);
  }
  const s = qs.toString();
  return s ? `/templates?${s}` : '/templates';
}

export default function TemplatesIndexPage({ params, searchParams }: Props) {
  unstable_setRequestLocale(params.locale);

  const selectedSubject = searchParams.subject as TemplateSubject | undefined;
  const selectedGrade = searchParams.grade as TemplateGrade | undefined;
  const selectedGradeLevel = searchParams.gradeLevel;
  const selectedExam = searchParams.exam as TemplateExam | undefined;

  const list = quizTemplates.filter((t) => {
    if (selectedSubject && t.subject !== selectedSubject) {
      return false;
    }
    if (selectedGrade && getTemplateGrade(t) !== selectedGrade) {
      return false;
    }
    if (selectedGradeLevel && t.gradeLevel !== selectedGradeLevel) {
      return false;
    }
    if (selectedExam && !t.exam?.includes(selectedExam)) {
      return false;
    }
    return true;
  });

  // 學制選定時要顯示的細年級子選單
  const gradeLevelOptions = selectedGrade
    ? TEMPLATE_GRADE_LEVELS_BY_GRADE[selectedGrade]
    : [];

  // 動態取得實際存在範本的考試類型（避免 chip 沒對應內容）
  const availableExams = getAvailableExams();
  // 動態取得實際存在範本的科目（避免顯示尚未補範本的「地科」「地理」）
  const availableSubjects = getAvailableSubjects();

  // chip 樣式 helper
  const chipClass = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? 'bg-primary text-primary-foreground'
        : 'bg-muted text-muted-foreground hover:bg-muted/80'
    }`;

  return (
    <>
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8">
        <header className="border-b pb-8">
          <p className="text-sm font-medium text-primary">QuizFlow 測驗範本庫</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            免費測驗範本：國小到高職，覆蓋五大科目
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            每份範本皆由老師審核、附詳解與難度標籤。註冊後可一鍵複製到個人帳號，直接分享給學生作答。
          </p>
        </header>

        {/* 科目篩選 */}
        <div className="mt-8">
          <p className="mb-2 text-xs font-medium text-muted-foreground">依科目</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildHref({ grade: selectedGrade, gradeLevel: selectedGradeLevel, exam: selectedExam })}
              className={chipClass(!selectedSubject)}
            >
              全部
            </Link>
            {availableSubjects.map(s => (
              <Link
                key={s}
                href={buildHref({ subject: s, grade: selectedGrade, gradeLevel: selectedGradeLevel, exam: selectedExam })}
                className={chipClass(selectedSubject === s)}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>

        {/* 學制篩選（換學制就清掉細年級，避免年級與學制不一致） */}
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">依學制</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildHref({ subject: selectedSubject, exam: selectedExam })}
              className={chipClass(!selectedGrade)}
            >
              全部
            </Link>
            {TEMPLATE_GRADES.map(g => (
              <Link
                key={g}
                href={buildHref({ subject: selectedSubject, grade: g, exam: selectedExam })}
                className={chipClass(selectedGrade === g)}
              >
                {g}
              </Link>
            ))}
          </div>
        </div>

        {/* 細年級篩選（學制選定時才顯示，cascading） */}
        {selectedGrade && gradeLevelOptions.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{`依年級（${selectedGrade}）`}</p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={buildHref({ subject: selectedSubject, grade: selectedGrade, exam: selectedExam })}
                className={chipClass(!selectedGradeLevel)}
              >
                全部
              </Link>
              {gradeLevelOptions.map(gl => (
                <Link
                  key={gl}
                  href={buildHref({ subject: selectedSubject, grade: selectedGrade, gradeLevel: gl, exam: selectedExam })}
                  className={chipClass(selectedGradeLevel === gl)}
                >
                  {gl}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 考試類型篩選（會考／學測／統測等，獨立維度可與其他維度同時篩） */}
        {availableExams.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">依考試</p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={buildHref({ subject: selectedSubject, grade: selectedGrade, gradeLevel: selectedGradeLevel })}
                className={chipClass(!selectedExam)}
              >
                全部
              </Link>
              {availableExams.map(e => (
                <Link
                  key={e}
                  href={buildHref({ subject: selectedSubject, grade: selectedGrade, gradeLevel: selectedGradeLevel, exam: e })}
                  className={chipClass(selectedExam === e)}
                >
                  {e}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 篩選結果計數 */}
        <p className="mt-6 text-sm text-muted-foreground">
          {`共 ${list.length} 份範本${selectedSubject ? `・${selectedSubject}` : ''}${selectedGradeLevel ? `・${selectedGradeLevel}` : selectedGrade ? `・${selectedGrade}` : ''}${selectedExam ? `・${selectedExam}` : ''}`}
        </p>

        <section className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(t => (
            <TemplateCard key={t.slug} template={t} />
          ))}
        </section>

        {list.length === 0 && (
          <p className="py-20 text-center text-muted-foreground">此條件下暫無範本，請放寬篩選條件。</p>
        )}
      </main>

      <Footer />
    </>
  );
}
