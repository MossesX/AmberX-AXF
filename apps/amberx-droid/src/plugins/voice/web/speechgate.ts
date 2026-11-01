/**
 * The speech gate (Oct 31 2026, Brett: AmberX kept saying "nothing in Inbox / no list called notes" over and over).
 * Every spoken reply goes through it. Pure and clock-free (the caller passes `now`), so test.mjs drives it.
 *
 * - **Empty states are never spoken** ("Nothing in Inbox.", "There's no list called notes.", "No steps yet."): they
 *   show in the conversation log and on screen, never out loud.
 * - **Said once per real change:** the same sentence again within `REPEAT_MS` is dropped (a poll, refresh, re-render
 *   or a loop can't repeat it). A question (`asked`) or a fresh change (`change`, e.g. a save) may be repeated.
 * - **No loop with the mic:** while AmberX talks, and for `ECHO_TAIL_MS` after, whatever hands-free hears is ignored,
 *   and so is anything that sounds like what it just said (`ECHO_MS`), so it never answers itself.
 */

export const REPEAT_MS = 30_000;
export const ECHO_MS = 15_000;
export const ECHO_TAIL_MS = 800;

export interface SpeechGate {
  /** what was said, newest first (normalized), with when it was said */
  recent: { text: string; at: number }[];
  /** talking until then (an estimate until the `spoken` event says it ended) */
  speakingUntil: number;
  /** when the last speech ended */
  endedAt: number;
}

export const newGate = (): SpeechGate => ({ recent: [], speakingUntil: 0, endedAt: -Infinity });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** A sentence that only says something is empty or missing. */
const EMPTY = [
  /^nothing\b/, // Nothing in Inbox. / Nothing found. / Nothing in progress.
  /^no \w+( \w+)? (yet|here|saved|found)\b/, // No notes yet. / No steps yet. / No tags yet.
  /^no saved\b/, /^no steps\b/, /^no (notes|tasks|items|inbox|lists?)\b/,
  /^there s no\b/, /^there is no\b/, /^there are no\b/, /^there s nothing\b/,
  /\bis empty\b/, /\bnothing in it\b/, /^heard nothing\b/,
];
export function isEmptyState(text: string): boolean {
  const n = norm(text);
  return !!n && EMPTY.some((r) => r.test(n));
}

/** How long a sentence takes to say (rough: ~14 characters a second, plus a little lead-in). */
export const speechMs = (text: string) => 600 + Math.round(text.length * 70);

export type SayOpts = { asked?: boolean; change?: boolean };
export type Decision = { speak: true } | { speak: false; why: 'empty' | 'repeat' | 'blank' };

/** Should this be said out loud now? `asked` = a question to the person, `change` = it reports something that really
 * just changed (a save): both may repeat a sentence; neither is ever an empty state. */
export function shouldSpeak(g: SpeechGate, text: string, now: number, opts: SayOpts = {}): Decision {
  const n = norm(text);
  if (!n) return { speak: false, why: 'blank' };
  if (isEmptyState(text)) return { speak: false, why: 'empty' };
  if (!opts.asked && !opts.change && g.recent.some((r) => r.text === n && now - r.at < REPEAT_MS)) return { speak: false, why: 'repeat' };
  return { speak: true };
}

/** It starts talking now. */
export function markSpeaking(g: SpeechGate, text: string, now: number): void {
  g.recent = [{ text: norm(text), at: now }, ...g.recent.filter((r) => now - r.at < Math.max(REPEAT_MS, ECHO_MS))].slice(0, 20);
  g.speakingUntil = Math.max(g.speakingUntil, now + speechMs(text));
}

/** It finished talking (the `spoken` event, or the estimate ran out). */
export function markDone(g: SpeechGate, now: number): void {
  g.speakingUntil = now;
  g.endedAt = now;
}

/** Is what the mic heard AmberX itself? (while talking, just after, or a copy of a recent sentence) */
export function isEcho(g: SpeechGate, heard: string, now: number): boolean {
  if (now < g.speakingUntil || now - g.endedAt < ECHO_TAIL_MS) return true;
  const h = norm(heard);
  if (h.length < 4) return false;
  return g.recent.some((r) => now - r.at < ECHO_MS && (r.text === h || r.text.includes(h) && h.length >= 0.6 * r.text.length || h.includes(r.text)));
}
