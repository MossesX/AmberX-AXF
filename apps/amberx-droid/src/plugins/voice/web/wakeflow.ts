/**
 * What to do with one wake hit (Nov 1 2026): the voice plugin's `onWake` asks this, so test.mjs drives the same path
 * the app runs. Pure: the caller passes the gate, the handled ids, the clock and the flags.
 *
 * Order: a replayed or stale event is dropped (`listeners.ts`), a page that isn't the device's owner stays silent,
 * AmberX's own voice is dropped (exact, mis-heard, or unprompted within `ARMED_TAIL_MS` of it talking), a waiting
 * question takes the answer, then a wake phrase / always armed decides. A sentence with no wake phrase is `armed`
 * (unprompted): it never goes to the AI notes parser and never gets a spoken "I don't know that one".
 */
import { eventVerdict, type HandledIds } from '../../../listeners';
import { isEcho, type SpeechGate } from './speechgate';
import { afterWake, normalize } from './core';
import { interpretHeard } from './handsfree';

export interface WakeEvent { phrase?: string; text?: string; id?: string; at?: number }

export type WakeAction =
  | { do: 'ignore'; why: 'replayed' | 'stale' | 'not-owner' | 'echo' | 'busy' | 'nothing' }
  | { do: 'answer'; text: string }
  | { do: 'handle'; text: string; armed: boolean }
  | { do: 'listen' };

export function wakeAction(e: WakeEvent, ctx: {
  gate: SpeechGate; handled: HandledIds; now: number; owner: boolean; waiting: boolean; busy: boolean; wake: string[]; alwaysArmed: boolean;
}): WakeAction {
  const v = eventVerdict(e, ctx.handled, ctx.now);
  if (!v.run) return { do: 'ignore', why: v.why };
  if (!ctx.owner) return { do: 'ignore', why: 'not-owner' };
  const phrase = e.phrase ?? '';
  const text = e.text ?? '';
  if (isEcho(ctx.gate, text, ctx.now, { armed: !phrase && !ctx.waiting })) return { do: 'ignore', why: 'echo' };
  if (ctx.waiting) return { do: 'answer', text: afterWake(text, ctx.wake) };
  if (ctx.busy) return { do: 'ignore', why: 'busy' };
  if (phrase) {
    const rest = afterWake(text, ctx.wake);
    return rest ? { do: 'handle', text: rest, armed: false } : { do: 'listen' };
  }
  const h = interpretHeard(text, ctx.wake, ctx.alwaysArmed, normalize);
  if (h.kind === 'command') return { do: 'handle', text: h.text, armed: afterWake(text, ctx.wake) === normalize(text) };
  if (h.kind === 'wake') return { do: 'listen' };
  return { do: 'ignore', why: 'nothing' };
}
