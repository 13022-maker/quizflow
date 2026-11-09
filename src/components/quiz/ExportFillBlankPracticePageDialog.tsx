'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';

import { Button } from '@/components/ui/button';

type Props = {
  quizId: number;
  quizTitle: string;
  totalQuestions: number;
  onClose: () => void;
};

type ShareHistoryItem = {
  id: number;
  url: string;
  questionRange: string;
  createdAt: string;
};

// 跟 ExportPracticePageDialog（單選/是非題）並列的填空題版本，呼叫
// export-fillblank-practice-page 系列 API，文案跟題型限制不同，不共用同一個元件。
export function ExportFillBlankPracticePageDialog({ quizId, quizTitle, totalQuestions, onClose }: Props) {
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(totalQuestions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [doneMsg, setDoneMsg] = useState('');

  const [shareUrl, setShareUrl] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  const [history, setHistory] = useState<ShareHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);
  const [copiedHistoryId, setCopiedHistoryId] = useState<number | null>(null);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/quizzes/${quizId}/export-fillblank-practice-page/share`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data?.shares)) {
        setHistory(data.shares);
      }
    } catch {
      // 歷史清單載入失敗不影響主要功能，靜默忽略即可
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 Dialog 開啟時載入一次
  }, []);

  const handleCopyHistoryLink = (item: ShareHistoryItem) => {
    navigator.clipboard.writeText(item.url).then(() => {
      setCopiedHistoryId(item.id);
      setTimeout(() => setCopiedHistoryId(null), 2000);
    });
  };

  const validateRange = () => {
    if (start < 1 || end > totalQuestions || start > end) {
      setError(`題號範圍不合法，請輸入 1 ~ ${totalQuestions} 之間的範圍`);
      return false;
    }
    return true;
  };

  const handleExport = async () => {
    setError('');
    setDoneMsg('');
    if (!validateRange()) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/quizzes/${quizId}/export-fillblank-practice-page?start=${start}&end=${end}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? '匯出失敗');
        return;
      }
      const imported = res.headers.get('X-Export-Imported');
      const skipped = res.headers.get('X-Export-Skipped');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fillblank-practice-page.html';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setDoneMsg(
        skipped && Number(skipped) > 0
          ? `✅ 已下載，成功匯入 ${imported} 題（略過 ${skipped} 題不是 AI 填空題的題目）`
          : `✅ 已下載，共 ${imported} 題`,
      );
    } catch {
      setError('匯出失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateShareLink = async () => {
    setShareError('');
    if (!validateRange()) {
      return;
    }
    setShareLoading(true);
    try {
      const res = await fetch(`/api/quizzes/${quizId}/export-fillblank-practice-page/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        setShareError(data?.error ?? '產生分享連結失敗');
        return;
      }
      setShareUrl(data.url);
      fetchHistory();
    } catch {
      setShareError('產生分享連結失敗，請稍後再試');
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  const handleDownloadQrCode = () => {
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
      a.download = `QuizFlow_${safeTitle}_填空練習頁QRCode.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
  };

  const handleShareLine = () => {
    const text = `填空練習頁「${quizTitle}」\n點擊開始：${shareUrl}`;
    window.location.href = `line://msg/text/?${encodeURIComponent(text)}`;
  };

  const handleShareClassroom = () => {
    const body = `點擊開始：${shareUrl}`;
    const url = `https://classroom.google.com/share?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(quizTitle)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'width=600,height=600');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6 pb-5">
          <h2 className="text-lg font-bold">匯出成填空練習頁</h2>
          <button type="button" onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-600">×</button>
        </div>
        <div className="overflow-y-auto p-6 pt-4">
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              產生一份獨立的 HTML 填空練習頁（免登入、不計時）：空格只能打字輸入、不能貼上；學生可以看參考答案，但每看一次會扣該格 3% 分數；每格核對後立即顯示對錯；全部核對過才能按「確認送出」。目前只支援 AI 出題產生的填空題，其他題型會自動略過。
            </p>

            <div className="flex items-center gap-3">
              <label className="flex-1 text-sm font-medium">
                從第幾題
                <input
                  type="number"
                  min={1}
                  max={totalQuestions}
                  value={start}
                  onChange={e => setStart(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
              <span className="mt-5 text-gray-400">～</span>
              <label className="flex-1 text-sm font-medium">
                到第幾題
                <input
                  type="number"
                  min={1}
                  max={totalQuestions}
                  value={end}
                  onChange={e => setEnd(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
            </div>
            <p className="text-xs text-gray-400">
              共
              {' '}
              {totalQuestions}
              {' '}
              題，預設匯出全部
            </p>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {doneMsg && <p className="text-sm text-green-700">{doneMsg}</p>}

            <div className="flex gap-3">
              <Button onClick={handleExport} disabled={loading} className="flex-1">
                {loading ? '匯出中…' : '✏️ 下載填空練習頁'}
              </Button>
              <Button
                onClick={handleGenerateShareLink}
                disabled={shareLoading}
                variant="outline"
                className="flex-1"
              >
                {shareLoading ? '產生中…' : '🔗 產生分享連結'}
              </Button>
            </div>

            {shareError && <p className="text-sm text-red-600">{shareError}</p>}

            {shareUrl && (
              <div className="space-y-3 rounded-xl border bg-gray-50 p-4">
                <div className="flex items-center gap-2">
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-sm text-blue-600 underline"
                  >
                    {shareUrl}
                  </a>
                  <Button onClick={handleCopyLink} variant="outline" className="shrink-0 px-3 py-1 text-xs">
                    {linkCopied ? '已複製' : '複製連結'}
                  </Button>
                </div>

                <div ref={qrRef} className="flex justify-center rounded-lg bg-white p-3">
                  <QRCode value={shareUrl} size={140} bgColor="#ffffff" fgColor="#000000" />
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleDownloadQrCode} variant="outline" className="flex-1 text-xs">
                    下載 QR Code
                  </Button>
                  <Button onClick={handleShareLine} variant="outline" className="flex-1 bg-[#06C755] text-xs text-white hover:bg-[#06C755]/90">
                    LINE 分享
                  </Button>
                  <Button onClick={handleShareClassroom} variant="outline" className="flex-1 text-xs">
                    Google Classroom
                  </Button>
                </div>
              </div>
            )}

            {!historyLoading && history.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500">之前產生過的分享連結</p>
                <ul className="max-h-48 space-y-2 overflow-y-auto">
                  {history.map(item => (
                    <li key={item.id} className="rounded-lg border bg-gray-50 p-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 truncate text-blue-600 underline"
                        >
                          {item.url}
                        </a>
                        <button
                          type="button"
                          onClick={() => handleCopyHistoryLink(item)}
                          className="shrink-0 rounded border px-2 py-1 text-gray-600 hover:bg-gray-100"
                        >
                          {copiedHistoryId === item.id ? '已複製' : '複製'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedHistoryId(expandedHistoryId === item.id ? null : item.id)}
                          className="shrink-0 rounded border px-2 py-1 text-gray-600 hover:bg-gray-100"
                        >
                          QR Code
                        </button>
                      </div>
                      <div className="mt-1 flex items-center gap-3">
                        <p className="flex-1 text-gray-400">
                          第
                          {' '}
                          {item.questionRange}
                          {' '}
                          題．
                          {new Date(item.createdAt).toLocaleString('zh-TW')}
                        </p>
                        {/* 學生在線上分享版按「確認送出」的成績，看這裡（跟選擇題練習頁共用同一個統計頁） */}
                        <Link
                          href={`/dashboard/quizzes/${quizId}/practice-stats?share=${item.id}`}
                          className="shrink-0 text-blue-600 underline"
                        >
                          學生成績
                        </Link>
                      </div>
                      {expandedHistoryId === item.id && (
                        <div className="mt-2 flex justify-center rounded-lg bg-white p-3">
                          <QRCode value={item.url} size={120} bgColor="#ffffff" fgColor="#000000" />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
