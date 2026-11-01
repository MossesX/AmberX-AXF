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
 * - **Sounds like, not only equals (Nov 1 2026):** the recognizer rarely hears AmberX word for word. "Note saved to
 *   Inbox." came back as "no save ten bucks", "no safety inbox", "note save ten bucks" (125 notes saved by the loop on
 *   Nov 1). `soundsLike` compares the letters (pairs of letters, Dice), so a mis-heard copy is still an echo.
 * - **Unprompted input waits longer:** a sentence heard with no wake phrase (always armed) within `ARMED_TAIL_MS` after
 *   AmberX stops talking is its own voice still in the room (some mis-hearings share no letters with the reply).
 * - **Loop guard:** the same sentence said `LOOP_COUNT` times within `LOOP_MS` is not said again, even as a change,
 *   unless it answers a question: a loop the filters miss still goes quiet after two.
 */

export const REPEAT_MS = 30_000;
export const ECHO_MS = 15_000;
export const ECHO_TAIL_MS = 800;
/** A mis-heard copy of a sentence AmberX said: letter-pair similarity at or above this is an echo. */
export const ECHO_LIKE = 0.4;
export const ARMED_TAIL_MS = 4_000;
/** Saves from unprompted sentences: this many within `SAVE_LOOP_MS` = a loop; unprompted saves pause for `SAVE_PAUSE_MS`. */
export const SAVE_LOOP_COUNT = 3;
export const SAVE_LOOP_MS = 60_000;
export const SAVE_PAUSE_MS = 120_000;
export const LOOP_MS = 60_000;
export const LOOP_COUNT = 2;

export interface SpeechGate {
  /** when unprompted sentences saved something (newest last), and until when unprompted saves are paused */
  armedSaves?: number[];
  armedPausedUntil?: number;
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
export type Decision = { speak: true } | { speak: false; why: 'empty' | 'repeat' | 'blank' | 'loop' };

/** Should this be said out loud now? `asked` = a question to the person, `change` = it reports something that really
 * just changed (a save): both may repeat a sentence; neither is ever an empty state. */
export function shouldSpeak(g: SpeechGate, text: string, now: number, opts: SayOpts = {}): Decision {
  const n = norm(text);
  if (!n) return { speak: false, why: 'blank' };
  if (isEmptyState(text)) return { speak: false, why: 'empty' };
  if (!opts.asked && !opts.change && g.recent.some((r) => r.text === n && now - r.at < REPEAT_MS)) return { speak: false, why: 'repeat' };
  if (!opts.asked && g.recent.filter((r) => r.text === n && now - r.at < LOOP_MS).length >= LOOP_COUNT) return { speak: false, why: 'loop' };
  return { speak: true };
}

/** It starts talking now. */
export function markSpeaking(g: SpeechGate, text: string, now: number): void {
  g.recent = [{ text: norm(text), at: now }, ...g.recent.filter((r) => now - r.at < Math.max(REPEAT_MS, ECHO_MS, LOOP_MS))].slice(0, 20);
  g.speakingUntil = Math.max(g.speakingUntil, now + speechMs(text));
}

/** It finished talking (the `spoken` event, or the estimate ran out). */
export function markDone(g: SpeechGate, now: number): void {
  g.speakingUntil = now;
  g.endedAt = now;
}

const pairs = (s: string): string[] => { const c = s.replace(/[^a-z0-9]/g, ''); const out: string[] = []; for (let i = 0; i < c.length - 1; i++) out.push(c.slice(i, i + 2)); return out; };

/** How alike two sentences sound on paper: Dice over letter pairs (spaces and punctuation ignored), 0…1. */
export function soundsLike(a: string, b: string): number {
  const x = pairs(norm(a)), y = pairs(norm(b));
  if (!x.length || !y.length) return 0;
  const left = new Map<string, number>();
  for (const p of x) left.set(p, (left.get(p) ?? 0) + 1);
  let both = 0;
  for (const p of y) { const n = left.get(p) ?? 0; if (n > 0) { both += 1; left.set(p, n - 1); } }
  return (2 * both) / (x.length + y.length);
}

/** Is what the mic heard AmberX itself? (while talking, just after, or a copy — exact or mis-heard — of a recent sentence) */
export function isEcho(g: SpeechGate, heard: string, now: number, opts: { armed?: boolean } = {}): boolean {
  if (now < g.speakingUntil || now - g.endedAt < (opts.armed ? ARMED_TAIL_MS : ECHO_TAIL_MS)) return true;
  const h = norm(heard);
  if (h.length < 4) return false;
  return g.recent.some((r) => now - r.at < ECHO_MS && (r.text === h || r.text.includes(h) && h.length >= 0.6 * r.text.length || h.includes(r.text) || soundsLike(r.text, h) >= ECHO_LIKE));
}

/** May an unprompted sentence (always armed, no wake phrase) save a note now? False while a save loop is paused. */
export const armedSaveAllowed = (g: SpeechGate, now: number): boolean => now >= (g.armedPausedUntil ?? -Infinity);

/** An unprompted sentence saved something: returns true when that makes a loop (and pauses unprompted saves). */
export function noteArmedSave(g: SpeechGate, now: number): boolean {
  g.armedSaves = [...(g.armedSaves ?? []).filter((t) => now - t < SAVE_LOOP_MS), now];
  if (g.armedSaves.length < SAVE_LOOP_COUNT) return false;
  g.armedPausedUntil = now + SAVE_PAUSE_MS;
  g.armedSaves = [];
  return true;
}
