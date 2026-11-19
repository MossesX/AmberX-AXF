/**
 * Dictation rules, pure (no DOM, no runtime, no network): when a dictation ends, how the stop phrase is cut out, and how
 * the text becomes a draft note (title, list, kind, checkboxes, tasks) for the review card. Tested by
 * `apps/amberx-droid/test.mjs`.
 */
import { extractCheckboxes, titleFrom, type Intent, type ItemKind, type NewItem, type Priority } from '../../notes/web/core';

export const DEFAULT_STOP = ['stop note', 'end note', 'thats it'];
export const DEFAULT_START = ['take a note', 'start dictation', 'start a note', 'dictate'];
export const MAX_MINUTES = 30;
export const MAX_CHARS = 20_000;
/** Empty turns in a row that end a dictation. */
export const EMPTY_TURNS = 2;

/** Lower case, letters/digits only (same as voice/notes). */
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Phrases from a settings value: comma or new-line separated, normalised, no repeats. */
export function phrases(raw: unknown, fallback: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of (typeof raw === 'string' ? raw : '').split(/[,\n]+/)) { const t = norm(p).slice(0, 60); if (t && !out.includes(t)) out.push(t); }
  return out.length ? out : [...fallback];
}

export function clampMinutes(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_MINUTES, Math.max(0.5, n)) : 5;
}

/**
 * Cuts the first stop phrase (whole words, case and punctuation ignored) and everything after it out of `text`,
 * keeping the original words before it as they were. "Buy milk. That's it, thanks" → "Buy milk."
 */
export function cutStop(text: string, stops: readonly string[]): { text: string; stopped: boolean } {
  // every normalised sub-word with the offset of the original token it came from
  const words: { w: string; at: number }[] = [];
  for (const m of text.matchAll(/\S+/g)) for (const w of norm(m[0]).split(' ').filter(Boolean)) words.push({ w, at: m.index! });
  let cut = -1;
  for (const stop of stops) {
    const sw = norm(stop).split(' ').filter(Boolean);
    if (!sw.length) continue;
    for (let i = 0; i + sw.length <= words.length; i++) {
      if (sw.every((w, j) => words[i + j]!.w === w)) { if (cut < 0 || words[i]!.at < cut) cut = words[i]!.at; break; }
    }
  }
  if (cut < 0) return { text: text.trim(), stopped: false };
  return { text: text.slice(0, cut).replace(/[\s,;:-]+$/, '').trim(), stopped: true };
}

export interface Session { parts: string[]; empties: number; startedAt: number }
export type EndReason = 'stop' | 'silence' | 'max' | 'full';
export const newSession = (now: number): Session => ({ parts: [], empties: 0, startedAt: now });

/** One listening turn heard `heard`: what's kept, and whether (and why) the dictation ends. */
export function turn(s: Session, heard: string, cfg: { stops: readonly string[]; maxMinutes: number }, now: number): { session: Session; end: EndReason | null } {
  const raw = heard.trim();
  if (!raw) {
    const next = { ...s, empties: s.empties + 1 };
    return { session: next, end: next.empties >= EMPTY_TURNS ? 'silence' : now - s.startedAt >= cfg.maxMinutes * 60_000 ? 'max' : null };
  }
  const c = cutStop(raw, cfg.stops);
  const next: Session = { ...s, empties: 0, parts: c.text ? [...s.parts, c.text] : s.parts };
  if (c.stopped) return { session: next, end: 'stop' };
  if (joinParts(next.parts).length >= MAX_CHARS) return { session: next, end: 'full' };
  if (now - s.startedAt >= cfg.maxMinutes * 60_000) return { session: next, end: 'max' };
  return { session: next, end: null };
}

/** The turns as one text: a capital to start each turn, a full stop between turns that had none. */
export function joinParts(parts: readonly string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => p[0]!.toUpperCase() + p.slice(1))
    .map((p, i, all) => (i < all.length - 1 && !/[.!?:;,]$/.test(p) ? `${p}.` : p)).join(' ').slice(0, MAX_CHARS);
}

export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

export interface DraftTask { content: string; due?: string; priority?: Priority }
export interface Draft {
  title: string;
  text: string;
  kind: ItemKind;
  /** list id, '' = not picked yet (the UI falls back to Inbox) */
  list: string;
  /** why that list (shown under the picker) */
  listWhy: string;
  checklist: { text: string; done: boolean }[];
  tasks: DraftTask[];
}

type Resolve = (spoken: string) => string | null;

/**
 * Local draft: "- [ ]" lines become checkboxes, sentences the notes parser reads as a todo/task become tasks
 * (and leave the text), a sentence naming a list ("note in work: …", "… to the errands list") suggests the list.
 * `preferred` (a list passed to dictation.start) always wins.
 */
export function draftFromText(text: string, parse: (s: string) => Intent | null, resolve: Resolve, preferred = ''): Draft {
  const { rest, boxes } = extractCheckboxes(text);
  const keep: string[] = [];
  const tasks: DraftTask[] = [];
  let suggested = '';
  let kindHint: ItemKind | null = null;
  const all = sentences(rest);
  for (const s of all) {
    const i = parse(s.replace(/[.!?]+$/, ''));
    if (i?.action === 'add' && (i.kind === 'todo' || i.kind === 'task')) {
      tasks.push({ content: i.title || i.text || s, ...(i.due ? { due: i.due } : {}), ...(i.priority ? { priority: i.priority } : {}) });
      if (!kindHint) kindHint = i.kind;
      if (!suggested && i.list) suggested = resolve(i.list) ?? '';
      continue;
    }
    if (i?.action === 'add' && i.kind === 'note' && i.list && !suggested) { suggested = resolve(i.list) ?? ''; keep.push(i.text ?? s); continue; }
    keep.push(s);
  }
  // one spoken todo and nothing else = the item itself is that todo
  const onlyTask = !keep.length && !boxes.length && tasks.length === 1;
  const body = keep.join(' ');
  const list = preferred || suggested;
  return {
    title: onlyTask ? tasks[0]!.content : titleFrom(body || tasks[0]?.content || ''),
    text: onlyTask ? '' : body,
    kind: onlyTask ? kindHint ?? 'todo' : 'note',
    list,
    listWhy: preferred ? 'Picked when the dictation started.' : suggested ? 'Named in what you said.' : '',
    checklist: boxes,
    tasks: onlyTask ? [] : tasks,
  };
}

/** A draft from an AI intent (already validated by the AI client), with the local draft's text kept when it has none. */
export function draftFromIntent(intent: Intent, text: string, resolve: Resolve, preferred = ''): Draft {
  const body = intent.text ?? text;
  const { rest, boxes } = extractCheckboxes(body);
  const suggested = intent.list ? (resolve(intent.sublist ? `${intent.list} ${intent.sublist}` : intent.list) ?? resolve(intent.list) ?? '') : '';
  const list = preferred || suggested;
  return {
    title: intent.title || titleFrom(rest || body),
    text: rest,
    kind: intent.kind ?? 'note',
    list,
    listWhy: preferred ? 'Picked when the dictation started.' : suggested ? 'Suggested by the AI.' : '',
    checklist: boxes,
    tasks: (intent.tasks ?? []).map((t) => ({ content: t.content, ...(t.due ? { due: t.due } : {}), ...(t.priority ? { priority: t.priority } : {}) })),
  };
}

/** What Save writes: the item, then one task per extracted task, all in the draft's list (or `fallback`). */
export function draftToItems(d: Draft, ctx: { fallback: string; transcript: string; by?: string; device?: string }): NewItem[] {
  const list = d.list || ctx.fallback;
  const base = { list, source: 'voice' as const, transcript: ctx.transcript, by: ctx.by ?? '', device: ctx.device ?? '' };
  const out: NewItem[] = [];
  const title = d.title.trim() || titleFrom(d.text) || (d.tasks[0]?.content ?? '');
  if (title || d.text.trim() || d.checklist.length) {
    out.push({ ...base, kind: d.kind, title: title || 'Dictation', text: d.text.trim(), checklist: d.checklist.filter((c) => c.text.trim()).map((c, i) => ({ id: `c${i + 1}`, text: c.text.trim(), done: c.done })) });
  }
  for (const t of d.tasks) if (t.content.trim()) out.push({ ...base, kind: 'task', title: t.content.trim(), due: t.due ?? '', priority: t.priority ?? 0, transcript: '' });
  return out;
}
