/**
 * The silent wake listener's rules, pure (Oct 29 2026, Brett: "AmberX voice control constantly triggers tone but ActiveX
 * doesn't — make it like ActiveX"). The same rules as the Android side's `WakeRules.java`; both are held to
 * `wake-cases.json` (test.mjs + WakeRulesTest).
 *
 * Hands-free has two modes:
 * - `wake` (default): an offline Vosk listener runs all the time with a grammar of just the wake phrases (low CPU, no
 *   recognizer restarts, so no tone). When it hears one, AmberX starts Google's recognizer for ONE utterance (tones
 *   muted), runs what was said, and goes back to silent Vosk idle. Always armed: Vosk listens to everything and every
 *   sentence it hears is a command.
 * - `classic`: Google's recognizer listens the whole time, as before (restarts every few seconds; the old fallback).
 *
 * Also the trigger phrase list editor's helpers (dense single column, add / remove, factory phrases), like ActiveX's.
 */
import { compact, wakeHit } from './speech';

export type HandsFreeMode = 'wake' | 'classic';
export const HANDS_FREE_MODES: HandsFreeMode[] = ['wake', 'classic'];
export const handsFreeMode = (v: unknown): HandsFreeMode => (v === 'classic' ? 'classic' : 'wake');

/** How easily the wake listener triggers: `low` = only on a whole, loud enough utterance; `high` = on the first partial. */
export type Sensitivity = 'low' | 'normal' | 'high';
export const SENSITIVITIES: Sensitivity[] = ['low', 'normal', 'high'];
export const sensitivity = (v: unknown): Sensitivity => (v === 'low' || v === 'high' ? v : 'normal');

/** The quietest peak input level (0..1) that may trigger, and whether a partial result may. */
const GATE: Record<Sensitivity, { minLevel: number; partial: boolean }> = {
  low: { minLevel: 0.3, partial: false },
  normal: { minLevel: 0.12, partial: true },
  high: { minLevel: 0, partial: true },
};

const VARIANTS: Record<string, string[]> = {
  amberx: ['amberx', 'amber x', 'amber ex', 'amber acts'],
  okay: ['okay', 'ok'],
  ok: ['ok', 'okay'],
};
export const MAX_GRAMMAR = 64;

/**
 * The Vosk grammar for the wake phrases: each phrase spelled the ways a small model hears it ("amberx" isn't a word it
 * knows: "amber x", "amber ex", "amber acts"), then "[unk]" so everything else is heard as unknown. Words the model
 * doesn't know are skipped by Vosk itself.
 */
export function grammar(phrases: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of phrases) {
    const words = p.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) continue;
    let acc: string[] = [''];
    for (const w of words) {
      const vs = VARIANTS[w] ?? [w];
      const next: string[] = [];
      for (const a of acc) for (const v of vs) next.push(a ? `${a} ${v}` : v);
      acc = next;
    }
    for (const a of acc) if (!out.includes(a) && out.length < MAX_GRAMMAR) out.push(a);
  }
  return [...out, '[unk]'];
}

/** What Vosk heard without its "[unk]" markers and extra spaces. */
export const cleanHeard = (text: string): string => text.replace(/\[unk\]/g, ' ').replace(/\s+/g, ' ').trim();

/** The wake phrase this result should trigger, or null (too quiet for the sensitivity, a partial on low, no phrase). */
export function triggerHit(heard: string, partial: boolean, s: Sensitivity, peakLevel: number, phrases: readonly string[]): string | null {
  const g = GATE[sensitivity(s)];
  if (partial && !g.partial) return null;
  if (!(peakLevel >= g.minLevel)) return null;
  const h = cleanHeard(heard);
  return h ? wakeHit(h, phrases) : null;
}

/** dBFS of the microphone → the graph's 0..1 level → the recognizer's RMS dB scale (-2..10) the overlay and page show. */
export function levelOfDbfs(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0;
  return Math.max(0, Math.min(1, (dbfs + 70) / 60));
}
export const recognizerDb = (level: number): number => -2 + 12 * Math.max(0, Math.min(1, level));

/* ---------------------------------------------------------------- the trigger phrase list (settings) */

/** What a fresh install listens for, and what "Factory phrases" puts back. */
export const FACTORY_PHRASES = ['hey amberx', 'okay amberx'];
/** Offered under the list, one tap to add. */
export const SUGGESTED_PHRASES = ['hey amberx', 'okay amberx', 'hi amberx', 'amberx listen', 'yo amberx'];
export const MAX_PHRASES = 20;
export const MAX_PHRASE_LEN = 80;

const tidy = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PHRASE_LEN);

/** Adds one phrase: `error` says why not (empty, too short, already there, list full). */
export function addPhrase(list: readonly string[], raw: string): { list: string[]; error: string | null } {
  const p = tidy(raw);
  if (!p) return { list: [...list], error: 'Type a phrase first.' };
  if (compact(p).length < 4) return { list: [...list], error: 'Too short: background talk would trigger it.' };
  if (list.some((x) => compact(x) === compact(p))) return { list: [...list], error: `“${p}” is already on the list.` };
  if (list.length >= MAX_PHRASES) return { list: [...list], error: `At most ${MAX_PHRASES} phrases.` };
  return { list: [...list, p], error: null };
}

export const removePhrase = (list: readonly string[], phrase: string): string[] => list.filter((x) => x !== phrase);

/** The list as the comma-separated text the wake setting keeps (read back by `phraseList` in core.ts). */
export const phrasesText = (list: readonly string[]): string => list.join(', ');
