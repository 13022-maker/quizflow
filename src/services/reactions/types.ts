// 課堂 Emoji 回饋共用型別
// 完全 ephemeral：無 DB schema、不存歷史、頻道關閉即消失

export const REACTION_EMOJIS = [
  { id: 'got_it', emoji: '😊', label: '懂了' },
  { id: 'foggy', emoji: '🤔', label: '有點模糊' },
  { id: 'question', emoji: '🙋', label: '有問題' },
  { id: 'too_fast', emoji: '⏸', label: '太快了' },
  { id: 'too_slow', emoji: '⏩', label: '太慢了' },
] as const;

export type ReactionEmojiId = typeof REACTION_EMOJIS[number]['id'];

export type ReactionEvent = {
  emoji: ReactionEmojiId;
  ts: number; // epoch ms
};

// Ably channel naming
export function reactionChannelName(pin: string): string {
  return `reactions:${pin.toUpperCase()}`;
}

// 6 碼 PIN 生成（A-Z + 0-9，省略易混淆字 0/O/1/I）
const PIN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateReactionPin(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += PIN_CHARS[Math.floor(Math.random() * PIN_CHARS.length)];
  }
  return code;
}
