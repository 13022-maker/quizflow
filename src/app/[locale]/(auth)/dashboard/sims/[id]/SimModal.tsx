'use client';

/** 簡易對話框（遮罩點擊／Esc 關閉）；專案尚無 shadcn Dialog，比照 QRCodeModal 的作法 */
import { useEffect } from 'react';

export function SimModal({
  title,
  onClose,
  children,
  maxWidth = 'max-w-2xl',
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-3 py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div role="dialog" aria-modal="true" className={`w-full ${maxWidth} rounded-xl border bg-card p-5 shadow-lg`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="關閉"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
