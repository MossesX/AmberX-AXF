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
}
export const VOICE_FRAME: 'console-control-voice@1';
/** The words the skin lock phrases search for: the setting's label. */
export const HUB_SKIN_SETTING: string;
export const HUB_SKIN_OVERRIDE_SETTING: string;
export function cleanPhrase(text: unknown): string;
export function voiceIntent(text: unknown): VoiceIntent | null;
export function intentAddress(intent: VoiceIntent, hit?: string | null): string;
export function intentCommand(intent: VoiceIntent, hit?: string | null): Record<string, unknown> & { verb: ConsoleControlVerb };
export function voiceReply(intent: VoiceIntent, answer: Record<string, any> | null | undefined, label?: string): string;
