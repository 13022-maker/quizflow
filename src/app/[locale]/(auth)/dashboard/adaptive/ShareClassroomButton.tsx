'use client';

/**
 * 指派到 Google Classroom：開官方 Share to Classroom 端點的新分頁，
 * 老師在該分頁自行登入、選課程、建立公告或作業，QuizFlow 不需串接 Classroom API／OAuth
 *（同套模式見 ShareModal.tsx 的 handleShareClassroom）。
 */
export function ShareClassroomButton({ path, title }: { path: string; title: string }) {
  function share() {
    const shareUrl = `${window.location.origin}${path}`;
    const url = `https://classroom.google.com/share?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(title)}`;
    window.open(url, '_blank', 'width=600,height=600');
  }

  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
    >
      🎓 指派到 Classroom
    </button>
  );
}
