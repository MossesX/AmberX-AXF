// Types for session-archive-core.mjs (session-archive@1).
export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number; thinking: number }
export interface SessionSystem { host: string; container: string; app: string; appVersion: string; entrypoint: string; surface: string; device: string; via: string; os: string; cwd: string; repo: string; branch: string; url?: string }
export interface SessionPrompt {
  i: number; at: string; kind: string; text: string; model: string; tokens: Tokens; costUsd: number; costEstimated: boolean; costNote?: string;
  seconds: number; tools: Record<string, number>; commands: number; files: string[]; changeIds: string[]; features: string[]; output: string;
}
export interface SessionTotals { prompts: number; turns: number; input: number; output: number; cacheRead: number; cacheWrite: number; thinking: number; costUsd: number; costEstimated: boolean; toolCalls: number; commands: number; filesTouched: number; reportedUsd?: number }
export interface SessionRecord {
  $axf: 'session-archive@1'; id: string; source: string; sessionId: string; project: string; title: string; startedAt: string; endedAt: string; minutes: number;
  system: SessionSystem; user: string; models: string[]; prompts: SessionPrompt[]; totals: SessionTotals; files: string[]; changeIds: string[]; features: string[];
  subagents: number; costSource: string; notes: string[]; ingestedAt?: string;
}
export interface SessionSummary { id: string; source: string; project: string; title: string; startedAt: string; endedAt: string; minutes: number; system: SessionSystem; user: string; models: string[]; totals: SessionTotals; changeIds: string[]; features: string[]; files: number; firstPrompt: string; costSource: string; subagents: number }
export interface Group { sessions: number; prompts: number; costUsd: number }
export interface Aggregate { totals: { sessions: number; prompts: number; costUsd: number; estimatedUsd: number; input: number; output: number }; groups: Record<'project' | 'source' | 'surface' | 'app' | 'model' | 'day', Record<string, Group>> }
export interface CostBuild { build: string; title: string; changes: string[]; sessions: string[]; prompts: number; costUsd: number; costEstimatedUsd: number; estimateUsd: number | null; overUsd: number | null; fromLog: number }
export interface CostChange { change: string; title: string; build: string; sessions: string[]; prompts: number; costUsd: number; costEstimatedUsd: number; estimateUsd: number | null; estimateMinutes: number | null; tokens: Omit<Tokens, 'thinking'>; first: string; last: string; source: 'sessions' | 'build-log' }
export interface CostRecordResult { builds: CostBuild[]; changes: CostChange[]; totals: { sessions: number; fromLogUsd: number; costUsd: number; estimatedUsd: number; linkedUsd: number } }
export const SOURCES: string[];
export const LIMITS: Record<string, number>;
export const CHAT_HEURISTIC: { charsPerToken: number; overheadTokens: number; model: string };
export const PROJECT_RULES: { project: string; test: RegExp }[];
export function redact(text: unknown, n?: number): string;
export function promptText(content: unknown): string;
export function surfaceOf(entrypoint: string, hints?: Record<string, string | undefined>): { surface: string; app: string; device: string };
export function projectOf(...hints: unknown[]): string;
export function parseTranscript(text: string, ctx?: Record<string, unknown>): SessionRecord;
export function totalsOf(rec: SessionRecord, reported?: number | null): SessionTotals;
export function fromChat(chat: Record<string, unknown>, ctx?: Record<string, unknown>): SessionRecord;
export function matchFeatures(prompt: SessionPrompt, catalog?: unknown[], changeRefs?: Record<string, string>): string[];
export function attachFeatures(rec: SessionRecord, catalog: unknown[], changeRefs: Record<string, string>): SessionRecord;
export function costRecord(sessions: SessionRecord[], changes?: Record<string, unknown>): CostRecordResult;
export function summary(rec: SessionRecord): SessionSummary;
export function filterSessions(list: SessionSummary[], f?: Record<string, unknown>): SessionSummary[];
export function aggregate(list: SessionSummary[]): Aggregate;
