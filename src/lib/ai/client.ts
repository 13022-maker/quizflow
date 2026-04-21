// 共用 Anthropic Claude SDK 單例
// 走 Node.js Runtime（@anthropic-ai/sdk 需要 Node runtime，不能在 Edge 上用）
import Anthropic from '@anthropic-ai/sdk';

export const anthropic = new Anthropic();

export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
