/**
 * Companion — where Gizmo's brains are. Chats are assistant@1 (framework/core/assistant.ts) on the Dev Console's AI
 * assistant, which runs on the VPS (Claude Code sessions on the Claude plan, live sessions that survive a dropped phone
 * connection). This page reaches it only through AmberX's own server (its console plugin proxy for FOLDER below, behind the
 * axHub wall), which adds the console token: no key or token is ever in the page or the APK.
 */
import { HttpAssistantClient, type Conversation, type ConversationSettings, type ConversationSummary } from '../../../axf/core';
import { pluginFetch } from '../../../console/plugins';
import { BRAINS, type Brain } from './core';

export const FOLDER = 'ai-assistant';
export const COMPANION_ID = 'ai.amberx.amberx.companion';

export const client = new HttpAssistantClient({
  base: `/api/plugins/${FOLDER}`,
  fetch: (url, init) => pluginFetch(FOLDER, url.slice(`/api/plugins/${FOLDER}/`.length), init),
  messages: {
    unauthorized: 'Sign in at the hub as an admin to chat with Gizmo.',
    unavailable: "Gizmo isn't reachable: the console is down, its AI assistant is off, or this AmberX server has no console token.",
  },
});

/** JSON from the assistant's own routes (usage, export) through the same server. */
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `The assistant answered ${r.status}.`);
  return j;
}

export interface Usage { today: { calls: number; input: number; output: number } }
export const usage = () => call<Usage>('usage');

/** A conversation as Markdown / JSON / text (the assistant's export route). */
export async function exportText(id: string, fmt: 'md' | 'json' | 'txt'): Promise<string> {
  const r = await pluginFetch(FOLDER, `conversations/${encodeURIComponent(id)}/export?format=${fmt}`);
  if (!r.ok) throw new Error(`Export failed (${r.status}).`);
  return fmt === 'json' ? JSON.stringify(await r.json(), null, 2) : r.text();
}

export function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Every chat as one JSON file (Settings → Export all chats). */
export async function exportAll(): Promise<{ count: number; text: string }> {
  const items: ConversationSummary[] = [...await client.listConversations(''), ...await client.listConversations('', true)];
  const all: Conversation[] = [];
  for (const c of items) all.push(await client.getConversation(c.id));
  return { count: all.length, text: JSON.stringify({ $axf: 'companion-export@1', exportedAt: new Date().toISOString(), conversations: all }, null, 2) };
}

export function fileToImage(f: File): Promise<{ media_type: string; data: string; name?: string }> {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => { const s = String(rd.result); res({ media_type: f.type || 'image/png', data: s.slice(s.indexOf(',') + 1), name: f.name }); };
    rd.onerror = () => rej(rd.error);
    rd.readAsDataURL(f);
  });
}

/* ---------------------------------------------------------------- brains: Claude or the local Ollama (brains@1) */
export interface BrainsInfo { items: Brain[]; default: string; localDefault: string; local: { url: string; reachable: boolean | null; models: string[]; error: string; profileExists: boolean } }
/** The brains the console assistant offers, with what is ready. Falls back to the built-in list (nothing marked ready). */
export async function brains(): Promise<BrainsInfo> {
  try { return await call<BrainsInfo>('brains'); }
  catch (e) { return { items: BRAINS.map((b) => ({ ...b, ready: undefined, why: (e as Error).message })), default: 'claude-opus', localDefault: 'local-24b', local: { url: '', reachable: null, models: [], error: (e as Error).message, profileExists: false } }; }
}
/** Switch who answers a chat. */
export const setBrain = (id: string, brain: string) => call<{ conversation: Conversation; brain: string }>(`conversations/${encodeURIComponent(id)}/brain`, { method: 'PUT', body: JSON.stringify({ brain }) });
/** A new chat on a brain (the server applies the brain's profile + model). */
export const createOn = (settings: ConversationSettings, brain: string) => call<{ conversation: Conversation }>('conversations', { method: 'POST', body: JSON.stringify({ settings, brain }) }).then((r) => r.conversation);
/** Add (or repoint) the amberx-llama provider profile on the console. */
export const setupLocal = () => call<BrainsInfo>('brains/local', { method: 'POST', body: '{}' });
