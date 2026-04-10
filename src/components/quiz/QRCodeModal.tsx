'use client';

import { useRef, useState } from 'react';
import QRCode from 'react-qr-code';

import { Button } from '@/components/ui/button';

type Props = {
  quizTitle: string;
  accessCode: string;
  onClose: () => void;
};

export default function QRCodeModal({ quizTitle, accessCode, onClose }: Props) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const quizUrl = `${window.location.origin}/quiz/${accessCode}`;

  // 下載 QR Code 為 PNG
  const handleDownload = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) {
      return;
    }

    // 將 SVG 序列化後畫到 Canvas，再匯出 PNG
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const size = 400;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    // 背景填白
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      const a = document.createElement('a');
      // 清理標題中的特殊字元，避免檔名問題
      const safeTitle = quizTitle.replace(/[\\/:*?"<>|]/g, '_');
      a.download = `QuizFlow_${safeTitle}_QRCode.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
  };

  // 複製連結到剪貼板
  const handleCopy = () => {
    navigator.clipboard.writeText(quizUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    // 遮罩層
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        // 點遮罩關閉
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-sm rounded-xl border bg-card p-6 shadow-lg">
        {/* 關閉按鈕 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
          aria-label="關閉"
        >
          ✕
        </button>

        {/* 標題 */}
        <h2 className="mb-1 text-center text-lg font-semibold">QR Code</h2>
        <p className="mb-4 text-center text-sm text-muted-foreground">{quizTitle}</p>

        {/* QR Code */}
        <div
          ref={qrRef}
          className="mx-auto mb-4 flex items-center justify-center rounded-lg bg-white p-4"
          style={{ width: 220, height: 220 }}
        >
          <QRCode
            value={quizUrl}
            size={188}
            bgColor="#ffffff"
            fgColor="#000000"
          />
        </div>

        {/* 完整網址 */}
        <p className="mb-4 break-all rounded-md bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
          {quizUrl}
        </p>

        {/* 操作按鈕 */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleCopy}
          >
            {copied ? '已複製！' : '複製連結'}
          </Button>
          <Button
            className="flex-1"
            onClick={handleDownload}
          >
            下載 PNG
          </Button>
        </div>
      </div>
    </div>
  );
}
