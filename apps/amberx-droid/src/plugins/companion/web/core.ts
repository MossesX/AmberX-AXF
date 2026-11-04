/** Companion: the pure rules (no network, no React), checked by apps/amberx-droid/test.mjs. */
import type { Conversation } from '../../../axf/core';

export const MIRROR = { project: 'amberx-axf', folder: 'companion', table: 'chats' } as const;
export interface ChatCopy { $axf: 'companion-chat@1'; id: string; title: string; pinned: boolean; createdAt: number; updatedAt: number; messages: { role: string; text: string; at: number; model?: string }[] }

const MAX_MESSAGES = 200;
const MAX_TEXT = 4000;
/** The copy kept on the hub for a conversation (text only, capped). Pure. */
export function chatCopy(c: Conversation): ChatCopy {
  return {
    $axf: 'companion-chat@1', id: c.id, title: c.title, pinned: c.pinned, createdAt: c.createdAt, updatedAt: c.updatedAt,
    messages: c.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.meta?.step).slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, text: m.content.slice(0, MAX_TEXT), at: m.createdAt, ...(m.meta?.model ? { model: m.meta.model } : {}) })),
  };
}
