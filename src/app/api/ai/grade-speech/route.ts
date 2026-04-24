/**
 * 口說題評分 API
 *
 * POST /api/ai/grade-speech
 * Body: multipart/form-data
 *   - audio:        Blob (學生錄音；建議 webm / mp3，<= 25 MB Whisper 限制)
 *   - prompt:       string (老師設定的題目)
 *   - language:     'zh-TW' | 'zh-CN' | 'en' | 'ja' | 'ko'  (預設 'en')
 *   - referenceText?: string (選填參考答案)
 *
 * Returns:
 *   { audioUrl, transcript, scores: {pronunciation, fluency, content, overall},
 *     feedback, durationSeconds, language }
 *
 * 流程：
 *   1. 上傳音檔到 Vercel Blob（持久化，老師端可回放）
 *   2. 送 OpenAI Whisper 轉逐字稿
 *   3. 送 Anthropic Claude 評分（發音 / 流暢度 / 內容三維）
 *   4. 學生端走匿名作答，所以不檢查 orgId（與既有 /api/ai/tts 一致）
 *
 * 注意：學生公開作答頁不走 Clerk 驗證，無 orgId 可扣 quota；
 *       為避免濫用，限制單次音檔 ≤ 25 MB（Whisper 限制即天然上限），
 *       並在路由層快速拒絕非 audio MIME。
 */

import { Buffer } from 'node:buffer';

import Anthropic from '@anthropic-ai/sdk';
import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

import { gradeSpeechPrompt, whisperLanguageCode } from '@/lib/ai/prompts';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB
const ALLOWED_LANGUAGES = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko'] as const;
type SupportedLang = typeof ALLOWED_LANGUAGES[number];

const anthropic = new Anthropic();

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get('audio');
    const prompt = String(form.get('prompt') ?? '').trim();
    const referenceText = String(form.get('referenceText') ?? '').trim();
    const langRaw = String(form.get('language') ?? 'en');
    const language: SupportedLang = (ALLOWED_LANGUAGES as readonly string[]).includes(langRaw)
      ? (langRaw as SupportedLang)
      : 'en';

    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: '請附上音檔（audio 欄位）' }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json({ error: '請提供題目（prompt 欄位）' }, { status: 400 });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: '音檔超過 25MB 上限' }, { status: 413 });
    }
    if (audio.size < 1024) {
      return NextResponse.json({ error: '音檔過短，請至少錄製 1 秒' }, { status: 400 });
    }

    // ---- 1. 上傳到 Vercel Blob ---------------------------------
    const buffer = Buffer.from(await audio.arrayBuffer());
    const ext = (audio.type.split('/')[1] ?? 'webm').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'webm';
    let audioUrl: string;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const filename = `speech/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const blob = await put(filename, buffer, {
        access: 'public',
        addRandomSuffix: false,
        contentType: audio.type || 'audio/webm',
      });
      audioUrl = blob.url;
    } else {
      // 本機開發無 Blob token：直接回 base64 data URL（瀏覽器仍可播放）
      audioUrl = `data:${audio.type || 'audio/webm'};base64,${buffer.toString('base64')}`;
    }

    // ---- 2. Whisper 轉逐字稿 ------------------------------------
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json(
        { error: '口說評量功能尚未設定（缺少 OPENAI_API_KEY）' },
        { status: 503 },
      );
    }

    const whisperForm = new FormData();
    // 重新包成 File 以保留檔名（Whisper 需要副檔名判斷格式）
    whisperForm.append('file', new File([buffer], `audio.${ext}`, { type: audio.type || 'audio/webm' }));
    whisperForm.append('model', 'whisper-1');
    whisperForm.append('language', whisperLanguageCode(language));
    whisperForm.append('response_format', 'verbose_json');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: whisperForm,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text().catch(() => '');
      return NextResponse.json(
        { error: `語音辨識失敗：${errText.slice(0, 200) || whisperRes.statusText}` },
        { status: 502 },
      );
    }

    const whisperJson = await whisperRes.json() as {
      text?: string;
      duration?: number;
      language?: string;
    };
    const transcript = (whisperJson.text ?? '').trim();
    const durationSeconds = typeof whisperJson.duration === 'number' ? whisperJson.duration : 0;

    // ---- 3. Claude 評分 ---------------------------------------
    if (!process.env.ANTHROPIC_API_KEY) {
      // 沒設 Claude 也不要整個失敗：回 transcript + 預設 fallback 分數
      return NextResponse.json({
        audioUrl,
        transcript,
        durationSeconds,
        language,
        scores: { pronunciation: 0, fluency: 0, content: 0, overall: 0 },
        feedback: '尚未設定 Claude API，僅顯示逐字稿；請聯繫管理員啟用評分。',
        warning: 'ANTHROPIC_API_KEY missing',
      });
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: gradeSpeechPrompt({
          prompt,
          transcript,
          referenceText: referenceText || undefined,
          language,
          durationSeconds,
        }),
      }],
    });

    const raw = (message.content[0] as { type: string; text: string }).text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json(
        { error: 'AI 評分回傳格式錯誤', transcript, audioUrl },
        { status: 502 },
      );
    }

    let parsed: {
      pronunciationScore?: number;
      fluencyScore?: number;
      contentScore?: number;
      overallScore?: number;
      feedback?: string;
    };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return NextResponse.json(
        { error: 'AI 評分 JSON 解析失敗', transcript, audioUrl },
        { status: 502 },
      );
    }

    const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    const pronunciation = clamp(parsed.pronunciationScore);
    const fluency = clamp(parsed.fluencyScore);
    const content = clamp(parsed.contentScore);
    // overall：Claude 算的優先，否則用權重重算
    const overall = parsed.overallScore !== undefined
      ? clamp(parsed.overallScore)
      : Math.round(pronunciation * 0.3 + fluency * 0.3 + content * 0.4);

    return NextResponse.json({
      audioUrl,
      transcript,
      durationSeconds,
      language,
      scores: { pronunciation, fluency, content, overall },
      feedback: (parsed.feedback ?? '').slice(0, 300),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤';
    return NextResponse.json({ error: `口說評量失敗：${msg}` }, { status: 500 });
  }
}
