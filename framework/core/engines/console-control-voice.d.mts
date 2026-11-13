import type { ConsoleControlKind, ConsoleControlScrollDir, ConsoleControlVerb } from './console-control-rules.mjs';

export interface VoiceIntent {
  verb: ConsoleControlVerb;
  address?: string;
  /** resolve the address by searching these words (best hit), narrowed to these kinds */
  find?: { q: string; kinds: ConsoleControlKind[] };
  /** a build's step number: the address becomes `<hit>/step:s<n>` */
  step?: number;
  value?: unknown;
  scroll?: { dir: ConsoleControlScrollDir; amount?: number };
  query?: { q: string };
  options?: { expand?: boolean; select?: boolean };
  /** search inside this address first (a settings tab) */
  within?: string;
  /** read the screen back (state with no address → state.screen) */
  screen?: boolean;
  /** a deciding press (approve, veto, deny, reject, sign off): only Brett's own signed-in session may run it */
  decision?: string;
}
export const VOICE_FRAME: 'console-control-voice@1';
export function cleanPhrase(text: unknown): string;
export function voiceIntent(text: unknown): VoiceIntent | null;
export function intentAddress(intent: VoiceIntent, hit?: string | null): string;
export function intentCommand(intent: VoiceIntent, hit?: string | null): Record<string, unknown> & { verb: ConsoleControlVerb };
export function voiceReply(intent: VoiceIntent, answer: Record<string, any> | null | undefined, label?: string): string;
export function typeIntent(text: unknown): VoiceIntent | null;
export const DECISION_WORDS: string[];
export const PRESS_WORDS: string[];
export function screenLine(screen: Record<string, any> | null | undefined): string;
