/** `covers` as a request takes it: "all", short entries comma separated ("vps,vps.run,scope:tokens.theme"), or a list of entries. */
export type PassCoversWord = string | (string | { service: string; tool?: string; scope?: string })[];
export interface PassVoiceIntent {
  tool: 'axhub.pass_grant' | 'axhub.pass_update' | 'axhub.pass_revoke' | 'axhub.pass_status';
  arguments: { id?: string; covers?: PassCoversWord; minutes?: number; include_irreversible?: boolean; quiet_notice?: boolean; reason?: string | { title: string; description: string } };
  /** The call is about the pass that is on: the caller fills `id`. */
  needsId?: boolean;
}
export interface PassVoiceRest { method: 'GET' | 'POST'; path: string; body?: Record<string, unknown> }
export const PASS_VOICE_FRAME: string;
export const VOICE_MAX_MINUTES: number;
export function cleanPassPhrase(text: unknown): string;
export function voiceMinutes(text: unknown): number | null;
export function voiceCovers(words: unknown): 'all' | string[] | null;
export function passVoiceIntent(text: unknown): PassVoiceIntent | null;
export function coversText(covers: unknown): string;
export function passVoiceRest(intent: PassVoiceIntent | null | undefined, id?: string): PassVoiceRest | null;
export function passVoiceCli(intent: PassVoiceIntent | null | undefined, id?: string): string[] | null;
export function passVoiceReply(intent: PassVoiceIntent | null | undefined, answer: unknown): string;
export function activePassId(passes: unknown): string;
