/**
 * TTS（文字轉語音）API — Gemini 2.5 Flash Preview TTS
 *
 * POST /api/ai/tts
 * Body: { text, voice?, speed? }
 * Returns: { url: string } （Vercel Blob 上的 WAV 檔 URL）
 *
 * 語音選項：Zephyr（預設，中性偏女）/ Kore（女）/ Puck（男）/ Charon（低沉男）
 * 語速：slow / normal / fast（透過 prompt 控制）
 */

import { Buffer } from 'node:buffer';

import { auth } from '@clerk/nextjs/server';
import { GoogleGenAI } from '@google/genai';
import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

// Gemini TTS 可用語音
const VOICES: Record<string, string> = {
  zephyr: 'Zephyr', // 中性偏女（預設）
  kore: 'Kore', // 女聲
  puck: 'Puck', // 男聲
  charon: 'Charon', // 低沉男聲
};

// 語速 prompt 前綴
const SPEED_PROMPTS: Record<string, string> = {
  slow: '請用緩慢、清晰的速度念出以下內容，每個字之間稍微停頓：\n\n',
  normal: '請用正常語速念出以下內容：\n\n',
  fast: '請用略快的語速流暢念出以下內容：\n\n',
};

// PCM → WAV（加 44-byte header）
function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const body = await req.json();
    const text: string = body.text?.trim();
    const voiceKey: string = body.voice ?? 'zephyr';
    const speed: string = body.speed ?? 'normal';

    if (!text) {
      return NextResponse.json({ error: '請提供要轉語音的文字' }, { status: 400 });
    }
    if (text.length > 5000) {
      return NextResponse.json({ error: '文字超過 5000 字上限' }, { status: 400 });
    }

    const voiceName = VOICES[voiceKey] ?? VOICES.zephyr;
    const speedPrompt = SPEED_PROMPTS[speed] ?? SPEED_PROMPTS.normal;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [
        {
          role: 'user',
          parts: [{ text: `${speedPrompt}${text}` }],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    // 取出 base64 PCM 音檔
    const audioPart = response.candidates?.[0]?.content?.parts?.[0];
    if (!audioPart || !('inlineData' in audioPart) || !audioPart.inlineData?.data) {
      return NextResponse.json({ error: 'TTS 生成失敗，無音檔回傳' }, { status: 500 });
    }

    const pcm = Buffer.from(audioPart.inlineData.data, 'base64');
    const wav = pcmToWav(pcm);

    // 上傳到 Vercel Blob
    const filename = `tts/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`;
    const blob = await put(filename, wav, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'audio/wav',
    });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error('[TTS] 失敗', err);
    const msg = err instanceof Error ? err.message : '語音生成失敗';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
