/** Types for build-chat.mjs (build-chat@1: a build or a codebase change told as a chat log). */
export const SCHEMA: 'build-chat@1';
export const ROLES: Array<'brett' | 'amber' | 'agent' | 'system'>;
export const SESSION_RULES: { title: string; re: RegExp }[];
export type ChatRole = 'brett' | 'amber' | 'agent' | 'system';
export interface ChatStepIn { text?: string; title?: string; state?: string; done?: boolean; startedAt?: string; finishedAt?: string; doneAt?: string; note?: string; checks?: unknown[] | number; model?: string }
export interface ChatInput {
  origin?: unknown; brief?: string; createdAt?: string; startedAt?: string; finishedAt?: string; agent?: string; model?: string;
  steps?: ChatStepIn[];
  result?: { state?: string; summary?: string; branch?: string; commits?: Array<string | { sha: string; message?: string }>; tests?: Record<string, { before?: string; after?: string; state?: string }> | null; at?: string } | null;
  pr?: string; events?: { at?: string; text: string; kind?: string }[]; closed?: { at: string; by?: string } | null;
}
export interface ChatMessage {
  id: string; role: ChatRole; kind: string; at: string; text: string;
  verbatim?: boolean; source?: string; link?: string;
  rules?: { title: string; text: string }[];
  state?: string; took?: number | null; checks?: number; note?: string; model?: string;
  commits?: { sha: string; message?: string }[]; branch?: string;
  tests?: Record<string, { before?: string; after?: string; state?: string }> | null;
}
export function reflow(text: string): string;
export function splitBrief(text: string): { said: { text: string; at: string; kind: 'said' | 'addendum'; verbatim: boolean }[]; body: string; rules: { title: string; text: string }[] };
export function tookText(ms: number | null | undefined): string;
export function timeline(input?: ChatInput): ChatMessage[];
export function order(list: ChatMessage[]): ChatMessage[];
export function stepCounts(messages: ChatMessage[]): { steps: number; done: number; failed: number; running: number };
