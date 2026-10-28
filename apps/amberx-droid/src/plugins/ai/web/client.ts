/**
 * AmberX AI client: the one seam other AmberX plugins (notes, tasks, voice, dictation, web) use to reach the AI.
 * The keys and the provider switch live on AmberX's own server (`apps/amberx-droid/server`, same origin, behind the
 * axHub wall); this page only ever sends text and gets data back.
 *
 * CONTRACT (other plugins rely on these names; keep them):
 *   aiReady()                      → true when the server says a provider answers
 *   useAiStatus()                  → React hook with the status below
 *   parseNote(transcript, ctx)     → a validated Intent (notes core) or null; never throws
 *   summarize(text)                → { title, summary, tags } or null; never throws
 *   ask(question, notes)           → answer text or null; never throws
 *
 * Server routes (JSON, same origin): GET /api/ai/status · POST /api/ai/parse · POST /api/ai/summarize · POST /api/ai/ask
 * (plus the config routes the AI plugin's settings use).
 */
import { useSyncExternalStore } from 'react';
import { validateIntent, type Intent } from '../../notes/web/core';

export interface AiStatus {
  /** checked at least once */
  known: boolean;
  ok: boolean;
  /** provider label in use, e.g. "Claude (plan)", "Claude API", "OpenAI" */
  provider: string;
  model: string;
  /** why not ok, in plain words */
  reason: string;
  checkedAt: string;
}

let status: AiStatus = { known: false, ok: false, provider: '', model: '', reason: 'Not checked yet.', checkedAt: '' };
const subs = new Set<() => void>();
export function setAiStatus(s: Partial<AiStatus>) { status = { ...status, ...s, known: true }; subs.forEach((f) => f()); }
export const aiStatus = () => status;
export const aiReady = () => status.ok;
export const useAiStatus = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => status);

const TIMEOUT_MS = 30_000;
async function post<T>(path: string, body: unknown): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) { if (r.status >= 500 || r.status === 503) setAiStatus({ ok: false, reason: `The AI server answered ${r.status}.` }); return null; }
    return (await r.json()) as T;
  } catch (e) {
    setAiStatus({ ok: false, reason: `The AI server can't be reached (${(e as Error).message}).` });
    return null;
  } finally { clearTimeout(t); }
}

export async function checkAi(): Promise<AiStatus> {
  try {
    const r = await fetch('/api/ai/status', { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    if (!r.ok) setAiStatus({ ok: false, reason: r.status === 404 ? 'This AmberX has no AI server.' : `The AI server answered ${r.status}.`, checkedAt: new Date().toISOString() });
    else { const j = (await r.json()) as Partial<AiStatus>; setAiStatus({ ok: !!j.ok, provider: j.provider ?? '', model: j.model ?? '', reason: j.reason ?? '', checkedAt: new Date().toISOString() }); }
  } catch (e) { setAiStatus({ ok: false, reason: `The AI server can't be reached (${(e as Error).message}).`, checkedAt: new Date().toISOString() }); }
  return status;
}

export interface ParseContext {
  /** every list as its path ("Work › Bugs"), so the AI can pick the right one */
  lists: string[];
  /** today, local (YYYY-MM-DD), for "tomorrow", "friday" */
  today: string;
}

/** Transcript → intent through the AI. The answer is validated here again: AI output is never trusted. */
export async function parseNote(transcript: string, ctx: ParseContext): Promise<Intent | null> {
  if (!transcript.trim()) return null;
  const r = await post<{ intent?: unknown }>('/api/ai/parse', { transcript: transcript.slice(0, 20_000), lists: ctx.lists.slice(0, 500), today: ctx.today });
  if (!r?.intent) return null;
  const v = validateIntent(r.intent);
  return v.ok ? v.intent : null;
}

export async function summarize(text: string): Promise<{ title: string; summary: string; tags: string[] } | null> {
  if (!text.trim()) return null;
  const r = await post<{ title?: unknown; summary?: unknown; tags?: unknown }>('/api/ai/summarize', { text: text.slice(0, 20_000) });
  if (!r || typeof r.summary !== 'string') return null;
  return { title: typeof r.title === 'string' ? r.title.slice(0, 160) : '', summary: r.summary.slice(0, 2000), tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string').slice(0, 10) : [] };
}

export async function ask(question: string, notes: { title: string; text: string; list: string }[]): Promise<string | null> {
  if (!question.trim()) return null;
  const r = await post<{ answer?: unknown }>('/api/ai/ask', { question: question.slice(0, 2000), notes: notes.slice(0, 200).map((n) => ({ title: n.title.slice(0, 160), text: n.text.slice(0, 2000), list: n.list.slice(0, 200) })) });
  return r && typeof r.answer === 'string' ? r.answer : null;
}
