export type DragVoiceWhere = { at: 'first' | 'last'; host?: string } | { at: 'before' | 'after'; ref: string } | { at: 'side'; side: string; host?: string };
export interface DragVoiceIntent { op: 'move' | 'add' | 'remove'; what: string; kind: string | null; where: DragVoiceWhere | null }
export const DRAG_VOICE_KINDS: Record<string, string | null>;
export const DRAG_VOICE_HOSTS: Record<string, string>;
export function looksLikeDrag(text: string): boolean;
export function dragVoiceThing(phrase: string): { words: string; kind: string | null };
export function dragVoiceWhere(tail: string): DragVoiceWhere | null;
export function dragVoiceIntent(text: string): DragVoiceIntent | null;
export function dragVoiceWords(s: string): string;
export function dragVoiceScore(words: string, item: { id: string; label?: string }): number;
