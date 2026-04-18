/**
 * TTS（文字轉語音）API — OpenAI TTS
 *
 * POST /api/ai/tts
 * Body: { text, voice?, speed? }
 * Returns: { url: string }（Vercel Blob 上的 MP3 檔 URL）
 *
 * 使用 OpenAI tts-1 模型，語音自然接近真人。
 * 需要環境變數 OPENAI_API_KEY。
 */

import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const VOICES: Record<string, string> = {
  'zh-tw-female': 'nova',
  'zh-tw-male': 'onyx',
  'zh-cn-female': 'shimmer',
  'zh-cn-male': 'echo',
  'en-female': 'nova',
  'en-male': 'onyx',
  'nova': 'nova',
  'onyx': 'onyx',
  'shimmer': 'shimmer',
  'echo': 'echo',
  'alloy': 'alloy',
  'fable': 'fable',
  // 相容舊 UI 的語言代碼
  'zh-tw': 'nova',
  'zh-cn': 'shimmer',
  'en': 'nova',
};

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TTS 功能尚未設定，請聯繫管理員' }, { status: 503 });
    }

    const body = await req.json();
    const text: string = body.text?.trim();
    const voiceKey: string = (body.voice ?? 'zh-tw-female').toLowerCase();
    const speed: string = body.speed ?? 'normal';

    if (!text) {
      return NextResponse.json({ error: '請提供要轉語音的文字' }, { status: 400 });
    }
    if (text.length > 4096) {
      return NextResponse.json({ error: '文字超過 4096 字上限' }, { status: 400 });
    }

    const voice = VOICES[voiceKey] ?? 'nova';
    const ttsSpeed = speed === 'slow' ? 0.85 : 1.0;

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice,
        speed: ttsSpeed,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[TTS] OpenAI 錯誤', response.status, err);
      return NextResponse.json({ error: '語音生成失敗，請稍後再試' }, { status: 502 });
    }

    const mp3Buffer = Buffer.from(await response.arrayBuffer());

    const filename = `tts/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`;
    const blob = await put(filename, mp3Buffer, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'audio/mpeg',
    });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error('[TTS] 失敗', err);
    const msg = err instanceof Error ? err.message : '語音生成失敗';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
