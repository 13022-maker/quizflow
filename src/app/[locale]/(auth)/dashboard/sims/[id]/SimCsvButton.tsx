'use client';

/** 下載 CSV（UTF-8 BOM，Excel 直接開；欄位格式與離線版 dashboard.html 相同，可再匯回離線版） */
import { type BoardStudent, buildSimCsv } from '../simBoardData';

export function SimCsvButton({ students, title }: { students: BoardStudent[]; title: string }) {
  function download() {
    const blob = new Blob([buildSimCsv(students)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}_成績.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={students.length === 0}
      className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
    >
      ↓ 下載 CSV
    </button>
  );
}
