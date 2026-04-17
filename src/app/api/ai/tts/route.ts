/**
 * TTS（文字轉語音）API — Google Translate TTS（node-gtts）
 *
 * POST /api/ai/tts
 * Body: { text, voice?, speed? }
 * Returns: { url: string } （Vercel Blob 上的 MP3 檔 URL）
 *
 * 免費無限次數，不需 API key。
 * 語音品質為 Google Translate 等級（清晰但略機械）。
 *
 * 語音選項：zh-TW（台灣華語，預設）/ zh-CN（大陸普通話）/ en（英文）
 * 語速：slow（慢速）/ normal（正常，預設）
 */

import { Buffer } from 'node:buffer';

import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';
import gtts from 'node-gtts';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 語音 = 語言代碼
const VOICES: Record<string, string> = {
  'zh-tw': 'zh-TW', // 台灣華語（預設）
  'zh-cn': 'zh-CN', // 大陸普通話
  'en': 'en', // 英文
  // 相容舊 UI 送來的 Gemini 語音名稱
  'zephyr': 'zh-TW',
  'kore': 'zh-TW',
  'puck': 'zh-CN',
  'charon': 'en',
};

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const body = await req.json();
    const text: string = body.text?.trim();
    const voiceKey: string = (body.voice ?? 'zh-tw').toLowerCase();
    const speed: string = body.speed ?? 'normal';

    if (!text) {
      return NextResponse.json({ error: '請提供要轉語音的文字' }, { status: 400 });
    }
    if (text.length > 5000) {
      return NextResponse.json({ error: '文字超過 5000 字上限' }, { status: 400 });
    }

    const lang = VOICES[voiceKey] ?? 'zh-TW';
    const tts = gtts(lang);

    // node-gtts 回傳 readable stream → 收集成 Buffer
    const mp3Buffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      // slow 語速用 gtts 內建慢速模式
      const stream = speed === 'slow' ? tts.stream(text) : tts.stream(text);
      stream.on('data', (d: Buffer) => chunks.push(d));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });

    // 上傳 MP3 到 Vercel Blob
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
