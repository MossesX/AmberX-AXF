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

/* ---------------------------------------------------------------- brains (build rebuild-gizmo-from-scratch, Nov 2026) */
/** Who answers a chat: Claude (the Claude plan) or Brett's Ollama on the VPS (amberx-llama). The console assistant's
 * GET /brains (brains@1) is the source; this list is what the switcher shows while that answer is on its way or the
 * console is unreachable. Mirrors apps/console-web/plugins/ai-assistant/server/brains.py. */
export type BrainFamily = 'claude' | 'local';
export interface Brain { id: string; family: BrainFamily; label: string; short: string; model: string; description: string; ready?: boolean; why?: string }
export const LOCAL_PROFILE = 'amberx-llama';
export const BRAINS: Brain[] = [
  { id: 'claude-opus', family: 'claude', label: 'Claude Opus', short: 'Opus', model: 'claude-opus-5-5', description: 'Claude on the Claude plan: tools, connectors, the crew.' },
  { id: 'claude-fable', family: 'claude', label: 'Claude Fable', short: 'Fable', model: 'claude-fable-5-1', description: "Claude's most capable model, for the hard ones." },
  { id: 'local-24b', family: 'local', label: 'Mistral Small 24B (local)', short: 'Mistral 24B', model: 'mistral-small:24b', description: 'Your Ollama on the VPS (amberx-llama). Private, free, slower.' },
  { id: 'local-7b', family: 'local', label: 'Mistral 7B (local)', short: 'Mistral 7B', model: 'mistral:7b', description: 'Your Ollama, the small fast model.' },
];
export const DEFAULT_BRAIN = 'claude-opus';
export const LOCAL_DEFAULT = 'local-24b';

/** Which brain a chat's settings amount to (same rule as the server's brain_of). Pure. */
export function brainOf(settings: { profileId?: string; model?: string } | undefined, list: Brain[] = BRAINS): string {
  const model = settings?.model ?? '';
  if (settings?.profileId === LOCAL_PROFILE) return list.find((b) => b.family === 'local' && b.model === model)?.id ?? LOCAL_DEFAULT;
  return list.find((b) => b.family === 'claude' && b.model === model)?.id ?? DEFAULT_BRAIN;
}
/** The brain for new chats from the saved setting (the old `companion.model` = opus | fable still counts). Pure. */
export function savedBrain(brain: string, legacyModel: string): string {
  if (BRAINS.some((b) => b.id === brain)) return brain;
  return legacyModel === 'fable' ? 'claude-fable' : DEFAULT_BRAIN;
}
/** Flipping the Claude / Ollama switch: back to the last brain used in that family, else its default. Pure. */
export function brainForFamily(family: BrainFamily, lastUsed: Partial<Record<BrainFamily, string>>): string {
  const last = lastUsed[family];
  if (last && BRAINS.some((b) => b.id === last && b.family === family)) return last;
  return family === 'local' ? LOCAL_DEFAULT : DEFAULT_BRAIN;
}
export const familyOf = (id: string): BrainFamily => (BRAINS.find((b) => b.id === id)?.family ?? 'claude');

/** `?gizmo=` deep link: new | talk | <conversation id>, with `&brain=<id>` and `&q=<first message>`. Pure. */
export interface GizmoLink { open: 'new' | 'talk' | 'chat' | ''; id: string; brain: string; q: string }
export function parseGizmoLink(search: string): GizmoLink {
  const p = new URLSearchParams(search);
  const g = (p.get('gizmo') ?? '').trim();
  const brain = BRAINS.some((b) => b.id === p.get('brain')) ? String(p.get('brain')) : '';
  const q = (p.get('q') ?? '').slice(0, 4000);
  if (!p.has('gizmo')) return { open: '', id: '', brain: '', q: '' };
  if (g === '' || g === 'open' || g === '1') return { open: 'chat', id: '', brain, q };
  if (g === 'new' || g === 'talk') return { open: g, id: '', brain, q };
  return { open: 'chat', id: /^[\w-]{1,80}$/.test(g) ? g : '', brain, q };
}
