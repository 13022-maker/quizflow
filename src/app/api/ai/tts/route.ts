/**
 * TTS（文字轉語音）API
 *
 * POST /api/ai/tts
 * Body: { text, voice?, speed? }
 * Returns: { url: string }
 *
 * 語音引擎：
 * - 客語（hak）：Google Translate TTS
 * - 其他語言：OpenAI tts-1
 */

import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const OPENAI_VOICES: Record<string, string> = {
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
  'zh-tw': 'nova',
  'zh-cn': 'shimmer',
  'en': 'nova',
};

const HAKKA_VOICES = new Set(['hak', 'hak-tw', 'hakka']);

function isHakkaVoice(voice: string): boolean {
  return HAKKA_VOICES.has(voice.toLowerCase());
}

async function generateGoogleTTS(text: string, lang: string): Promise<Buffer> {
  const encodedText = encodeURIComponent(text);
  // Google Translate TTS 需要用 gtx client，語言碼用 ISO 格式
  const ttsLang = lang === 'hak' ? 'zh-TW' : lang;
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${ttsLang}&client=gtx&q=${encodedText}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://translate.google.com/',
    },
  });

  if (!res.ok) {
    throw new Error(`Google TTS 回應 ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function generateOpenAITTS(text: string, voice: string, speed: number, apiKey: string): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice,
      speed,
      response_format: 'mp3',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI TTS 錯誤 (${res.status}): ${errText.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

export async function POST(req: Request) {
  try {
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

    let mp3Buffer: Buffer;

    if (isHakkaVoice(voiceKey)) {
      // 客語：先嘗試 Google Translate TTS，失敗則 fallback OpenAI
      try {
        if (text.length <= 200) {
          mp3Buffer = await generateGoogleTTS(text, 'hak');
        } else {
          const chunks = splitText(text, 200);
          const buffers = [];
          for (const chunk of chunks) {
            buffers.push(await generateGoogleTTS(chunk, 'hak'));
          }
          mp3Buffer = Buffer.concat(buffers);
        }
      } catch {
        // Google TTS 不支援客語時，用 OpenAI 國語語音作為替代
        const fallbackKey = process.env.OPENAI_API_KEY;
        if (!fallbackKey) {
          return NextResponse.json({ error: '客語 TTS 暫不可用，請手動上傳音檔' }, { status: 503 });
        }
        mp3Buffer = await generateOpenAITTS(text, 'nova', 0.9, fallbackKey);
      }
    } else {
      // 其他語言走 OpenAI TTS
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: 'TTS 功能尚未設定，請聯繫管理員' }, { status: 503 });
      }
      const voice = OPENAI_VOICES[voiceKey] ?? 'nova';
      const ttsSpeed = speed === 'slow' ? 0.85 : 1.0;
      mp3Buffer = await generateOpenAITTS(text, voice, ttsSpeed, apiKey);
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      const base64 = mp3Buffer.toString('base64');
      return NextResponse.json({ url: `data:audio/mpeg;base64,${base64}` });
    }

    const filename = `tts/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`;
    const blob = await put(filename, mp3Buffer, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'audio/mpeg',
    });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '語音生成失敗';
    return NextResponse.json({ error: `TTS 錯誤: ${msg}` }, { status: 500 });
  }
}

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[。！？\n])/);
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxLen && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}
