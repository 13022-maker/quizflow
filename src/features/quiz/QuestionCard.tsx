'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { InferSelectModel } from 'drizzle-orm';
import { useState } from 'react';

import { findCompetency } from '@/lib/curriculum/codes';
import type { questionSchema } from '@/models/Schema';

import { QUESTION_TYPE_LABELS } from './QuestionForm';

type Question = InferSelectModel<typeof questionSchema>;

type Props = {
  question: Question;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  onAudioRegenerated?: (questionId: number, audioUrl: string) => void;
};

export function QuestionCard({ question, index, onEdit, onDelete, isDeleting, onAudioRegenerated }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id });

  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsError, setTtsError] = useState('');
  const [ttsVoice, setTtsVoice] = useState('zh-tw-female');

  const handleRegenerateTts = async () => {
    setTtsLoading(true);
    setTtsError('');
    try {
      const res = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: question.audioTranscript || question.body, voice: ttsVoice }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '語音生成失敗');
      }
      const { url } = await res.json();
      onAudioRegenerated?.(question.id, url);
    } catch (err) {
      setTtsError(err instanceof Error ? err.message : '語音生成失敗');
    } finally {
      setTtsLoading(false);
    }
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-3 rounded-lg border bg-card p-4 transition-shadow ${
        isDragging ? 'opacity-50 shadow-lg' : ''
      }`}
    >
      {/* 拖曳把手 */}
      <button
        {...attributes}
        {...listeners}
        className="mt-0.5 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
        aria-label="拖曳排序"
      >
        <svg viewBox="0 0 20 20" width="16" fill="currentColor">
          <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
        </svg>
      </button>

      {/* 題號 + 內容 */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Q
            {index + 1}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {QUESTION_TYPE_LABELS[question.type]}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {question.points}
            {' '}
            分
          </span>
          {(() => {
            const c = findCompetency(question.competencyCode);
            if (!c) {
              return null;
            }
            return (
              <span
                className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                title={`${c.subject.label} · ${c.strand} · ${c.description}`}
              >
                📘
                {' '}
                {c.code}
              </span>
            );
          })()}
        </div>
        <p className="line-clamp-2 text-sm">{question.body}</p>
        {question.imageUrl && (
          <div className="mt-2 inline-block overflow-hidden rounded">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={question.imageUrl}
              alt="題目圖片"
              className="h-[60px] w-[80px] object-cover"
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = 'none';
                el.parentElement!.innerHTML = '<span class="flex h-[60px] w-[80px] items-center justify-center bg-muted text-xs text-muted-foreground">無圖片</span>';
              }}
            />
          </div>
        )}
        {/* 聽力題：音檔狀態 + 重新生成按鈕 */}
        {question.type === 'listening' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {question.audioUrl
              ? (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <span>🎧</span>
                    音檔已生成
                  </span>
                )
              : (
                  <span className="flex items-center gap-1 text-xs text-amber-600">
                    <span>⚠️</span>
                    尚無音檔
                  </span>
                )}
            <select
              value={ttsVoice}
              onChange={e => setTtsVoice(e.target.value)}
              className="rounded-md border px-1.5 py-1 text-xs text-muted-foreground"
            >
              <option value="zh-tw-female">國語女聲</option>
              <option value="zh-tw-male">國語男聲</option>
              <option value="hak">客語</option>
              <option value="en-female">English</option>
            </select>
            <button
              type="button"
              onClick={handleRegenerateTts}
              disabled={ttsLoading}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {ttsLoading ? '生成中…' : question.audioUrl ? '🔄 重新生成音檔' : '🎙️ 生成音檔'}
            </button>
            {ttsError && <span className="text-xs text-red-500">{ttsError}</span>}
          </div>
        )}

        {question.options && question.options.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {question.options.length}
            {' '}
            個選項
            {question.correctAnswers && question.correctAnswers.length > 0 && (
              <span className="ml-1 text-green-600">
                ·
                {' '}
                {question.correctAnswers.length}
                {' '}
                個正確答案
              </span>
            )}
          </p>
        )}
      </div>

      {/* 操作 */}
      <div className="flex shrink-0 gap-1">
        <button
          onClick={onEdit}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          編輯
        </button>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
        >
          {isDeleting ? '…' : '刪除'}
        </button>
      </div>
    </div>
  );
}
