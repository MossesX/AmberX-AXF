export const HUB_FOLDER: string;
export const GROUP_CHAT: { id: string; title: string };
export const MENTION_TERMS: { id: string; re: RegExp; weak?: boolean }[];
export type Mention = { chat: string; id: string; at: string; from: string; fromName: string; kind: string; text: string; jobId?: string; matched: string[]; tone: 'negative' | 'neutral' };
export function mentionHits(text: string): string[];
export function toneOf(text: string): 'negative' | 'neutral';
export function mentions(state: unknown, roster: unknown, opts?: { limit?: number; negativeOnly?: boolean; chat?: string }): Mention[];
export function chatDocs(state: unknown, roster: unknown, at: string, opts?: { messageLimit?: number }): Record<string, unknown>;
