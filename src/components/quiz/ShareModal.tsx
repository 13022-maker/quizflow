'use client';

/**
 * ShareModal — 測驗分享 Modal
 *
 * 整合：房間碼、QR Code、複製連結、LINE 分享、Google Classroom 分享、到期設定
 */

import { useRef, useState, useTransition } from 'react';
import QRCode from 'react-qr-code';

import { updateQuizSettings } from '@/actions/quizActions';
import { Button } from '@/components/ui/button';

type Props = {
  quizId: number;
  quizTitle: string;
  accessCode: string;
  roomCode: string | null;
  expiresAt: string | null; // ISO string 或 null
  onClose: () => void;
};

export default function ShareModal({
  quizId,
  quizTitle,
  accessCode,
  roomCode,
  expiresAt: initialExpiresAt,
  onClose,
}: Props) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  // 到期時間狀態
  const [expiresAt, setExpiresAt] = useState<string | null>(initialExpiresAt);
  const [expiryPreset, setExpiryPreset] = useState<string>('none');

  const quizUrl = `${window.location.origin}/quiz/${accessCode}`;
  // LINE 內建瀏覽器 block 登入、檔案上傳等功能，分享時加上 ?openExternalBrowser=1
  // LINE 會辨識此官方參數並強制用系統預設瀏覽器（Safari / Chrome）開啟
  const shareUrl = `${quizUrl}?openExternalBrowser=1`;

  // 下載 QR Code 為 PNG
  const handleDownload = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) {
      return;
    }
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const size = 400;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      const a = document.createElement('a');
      const safeTitle = quizTitle.replace(/[\\/:*?"<>|]/g, '_');
      a.download = `QuizFlow_${safeTitle}_QRCode.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
  };

  // 複製連結（含 LINE 外部瀏覽器參數）
  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // 複製房間碼
  const handleCopyCode = () => {
    if (!roomCode) {
      return;
    }
    navigator.clipboard.writeText(roomCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };

  // LINE 分享
  const handleShareLine = () => {
    const text = `加入測驗「${quizTitle}」${roomCode ? `，房間碼：${roomCode}` : ''}，點擊加入：${shareUrl}`;
    const url = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'width=500,height=600');
  };

  // Google Classroom 分享
  const handleShareClassroom = () => {
    const body = `${roomCode ? `房間碼：${roomCode}\n` : ''}點擊加入：${shareUrl}`;
    const url = `https://classroom.google.com/share?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(quizTitle)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'width=600,height=600');
  };

  // 到期設定
  const handleExpiryChange = (preset: string) => {
    setExpiryPreset(preset);
    let newExpiry: Date | null = null;

    if (preset === 'none') {
      newExpiry = null;
    } else if (preset === 'custom') {
      // 自訂模式不直接送出，由 datetime-local input 處理
      return;
    } else {
      const hours = Number(preset);
      newExpiry = new Date(Date.now() + hours * 60 * 60 * 1000);
    }

    setExpiresAt(newExpiry?.toISOString() ?? null);
    startTransition(async () => {
      await updateQuizSettings(quizId, { expiresAt: newExpiry });
    });
  };

  // 自訂日期時間確認
  const handleCustomExpiry = (value: string) => {
    if (!value) {
      return;
    }
    const newExpiry = new Date(value);
    setExpiresAt(newExpiry.toISOString());
    startTransition(async () => {
      await updateQuizSettings(quizId, { expiresAt: newExpiry });
    });
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border bg-card p-6 shadow-lg">
        {/* 關閉按鈕 */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
          aria-label="關閉"
        >
          ✕
        </button>

        <h2 className="mb-1 text-center text-lg font-semibold">分享測驗</h2>
        <p className="mb-4 text-center text-sm text-muted-foreground">{quizTitle}</p>

        {/* ── 房間碼 ── */}
        {roomCode && (
          <div className="mb-4 rounded-lg bg-muted/50 p-4 text-center">
            <p className="mb-1 text-xs font-medium text-muted-foreground">房間碼</p>
            <button
              type="button"
              onClick={handleCopyCode}
              className="text-3xl font-bold tracking-[0.3em] text-foreground transition-colors hover:text-primary"
              title="點擊複製房間碼"
            >
              {roomCode}
            </button>
            <p className="mt-1 text-xs text-muted-foreground">
              {codeCopied ? '已複製！' : '點擊複製'}
            </p>
          </div>
        )}

        {/* ── QR Code ── */}
        <div
          ref={qrRef}
          className="mx-auto mb-3 flex items-center justify-center rounded-lg bg-white p-3"
          style={{ width: 180, height: 180 }}
        >
          <QRCode value={shareUrl} size={156} bgColor="#ffffff" fgColor="#000000" />
        </div>

        {/* 連結 */}
        <p className="mb-4 break-all rounded-md bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
          {quizUrl}
        </p>

        {/* ── 操作按鈕 ── */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={handleCopy} className="text-xs">
            {copied ? '已複製！' : '📋 複製連結'}
          </Button>
          <Button variant="outline" onClick={handleDownload} className="text-xs">
            ⬇️ 下載 QR Code
          </Button>
        </div>

        {/* ── 社群分享 ── */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleShareLine}
            className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            {/* LINE logo SVG */}
            <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 5.81 2 10.46c0 4.17 3.7 7.66 8.69 8.32.34.07.8.22.91.51.1.26.07.66.03.93l-.15.88c-.04.26-.2 1.01.89.55s5.91-3.47 8.07-5.94C22.36 13.54 22 12.03 22 10.46 22 5.81 17.52 2 12 2zm-3.36 11.07H6.73a.46.46 0 0 1-.46-.46V8.54c0-.25.2-.46.46-.46s.46.2.46.46v3.61h1.45c.25 0 .46.2.46.46s-.21.46-.46.46zm1.98-.46a.46.46 0 0 1-.92 0V8.54a.46.46 0 0 1 .92 0v4.07zm4.56 0c0 .2-.13.37-.31.44a.46.46 0 0 1-.52-.12l-2.02-2.74v2.42a.46.46 0 0 1-.92 0V8.54c0-.2.13-.37.31-.44a.46.46 0 0 1 .52.12l2.02 2.74V8.54a.46.46 0 0 1 .92 0v4.07zm2.76-2.65a.46.46 0 0 1 0 .92h-1.45v.81h1.45a.46.46 0 0 1 0 .92h-1.91a.46.46 0 0 1-.46-.46V8.54c0-.25.2-.46.46-.46h1.91a.46.46 0 0 1 0 .92h-1.45v.96h1.45z" />
            </svg>
            LINE 分享
          </button>
          <button
            type="button"
            onClick={handleShareClassroom}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            {/* Google Classroom icon (簡化) */}
            <svg className="size-4" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="4" width="20" height="16" rx="2" fill="#0F9D58" />
              <circle cx="12" cy="11" r="2.5" fill="white" />
              <path d="M8 16.5c0-2.21 1.79-3 4-3s4 .79 4 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Google Classroom
          </button>
        </div>

        {/* ── 到期設定 ── */}
        <div className="rounded-lg border p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">設定有效期限</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[
              { value: 'none', label: '永不到期' },
              { value: '1', label: '1 小時' },
              { value: '24', label: '24 小時' },
              { value: '72', label: '3 天' },
              { value: '168', label: '7 天' },
              { value: 'custom', label: '自訂' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleExpiryChange(opt.value)}
                disabled={isPending}
                className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  expiryPreset === opt.value
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-input bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 自訂日期時間 */}
          {expiryPreset === 'custom' && (
            <input
              type="datetime-local"
              onChange={e => handleCustomExpiry(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}

          {/* 目前到期時間顯示 */}
          {expiresAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              ⏰
              {' '}
              {new Date(expiresAt).toLocaleString('zh-TW')}
              {' '}
              到期
              {new Date(expiresAt) < new Date() && (
                <span className="ml-1 font-medium text-red-600">（已過期）</span>
              )}
            </p>
          )}
          {!expiresAt && expiryPreset === 'none' && (
            <p className="mt-2 text-xs text-muted-foreground">永不到期</p>
          )}
        </div>
      </div>
    </div>
  );
}
