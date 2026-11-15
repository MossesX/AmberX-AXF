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

/** What talk mode does with a final utterance (Nov 7 2026, build gizmo-voice-fix). */
export type HeardVerdict = 'send' | 'interrupt' | 'ignore';
export interface HeardInput {
  /** the final text heard */
  text: string;
  /** talk mode is on and waiting for Brett (not paused, not thinking) */
  listening: boolean;
  /** Gizmo is talking right now (the listener stays open so Brett can cut in) */
  talking: boolean;
  /** by the clock or the words: Gizmo (or AmberX) is still talking or just stopped, or it sounds like what he said */
  echo: boolean;
  /** by the words only: it sounds like something Gizmo or AmberX just said */
  ownWords: boolean;
  /** "Stop talking when I talk over Gizmo" is on */
  interruptOn: boolean;
  /** it is a stop word (claude-session `isInterrupt`) */
  stopWord: boolean;
}
/**
 * Gizmo never answers himself: while he talks only a stop word that isn't his own words coming back stops him, and
 * nothing said over him is sent; once he is quiet, an echo (his reply heard late, or a mis-heard copy) is dropped and
 * anything else is the next message. Pure.
 */
export function judgeHeard(i: HeardInput): HeardVerdict {
  const t = (i.text ?? '').trim();
  if (!t) return 'ignore';
  if (i.talking) return i.interruptOn && i.stopWord && !i.ownWords ? 'interrupt' : 'ignore';
  if (!i.listening || i.echo || i.ownWords) return 'ignore';
  return 'send';
}
