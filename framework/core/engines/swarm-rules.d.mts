// Types for swarm-rules.mjs (the agent swarm's data contracts; shared by the console plugin, the CLI, the runner and the checks).
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Model = 'haiku' | 'sonnet' | 'opus' | 'fable';
export type AgentStatus = 'on-duty' | 'off-duty' | 'injured' | 'medical-leave' | 'probation' | 'fired' | 'custom' | 'suspended' | 'quit';
export type ChatKind = 'assign' | 'lease' | 'report' | 'handoff' | 'merge' | 'status' | 'discipline' | 'pay' | 'banter' | 'brett';
export type RunKind = 'build' | 'job';
export type RunStatus = 'running' | 'done' | 'failed' | 'blocked' | 'killed' | 'error';
export type ReportStatus = 'done' | 'failed' | 'blocked';
export type LeaseKind = 'files' | 'area' | 'all';
export interface FieldError { field: string; code: 'missing' | 'invalid'; message: string }
export interface Avatar { face: string; hair: number; gear: string; hue: number }
export interface Agent {
  $axf: 'agent@1'; id: string; name: string; role: string; skill: string; jobsOnly: boolean; specialty: string; keywords: string[]; paths: string[];
  models: Model[]; tools: string[]; maxTurns: number; tokenBudget: number; salary: number; hiredAt: string; avatar: Avatar; catchphrase: string; bio: string;
}
export interface Skill { id: string; title: string; schema: string; body: string; lines: number; chars: number }
export interface Roster { $axf: 'swarm-roster@1'; tune: { scale: number; basis: string }; fallback: string; agents: Agent[] }
export interface ChatSettings { vibe: number; chattiness: number; cussing: number; drama: number; preset: string; overrides: Record<string, Partial<Record<'vibe' | 'chattiness' | 'cussing' | 'drama', number>>>; banterBudget: number; saved: { name: string; vibe: number; chattiness: number; cussing: number; drama: number }[] }
export interface Message { id: string; at: string; from: string; kind: ChatKind; text: string; jobId: string; vibe: number | null; toned: boolean }
export interface AgentState {
  status: AgentStatus; note: string; until: string; custom: { name: string; works: boolean }; salary: number | null;
  topups: { at: string; usd: number }[]; pay: { at: string; kind: 'raise' | 'dock'; from: number; to: number; note: string }[]; bonuses: { at: string; jobId: string; usd: number }[];
  brokeSaid: string; failStreak: number; history: { at: string; from: string; to: string; note: string; by: string }[]; identity: Record<string, string>; card: string;
}
export interface SwarmState {
  $axf: 'swarm-state@1'; updatedAt: string; rules: { rageQuitAfter: number }; agents: Record<string, AgentState>; chat: { enabled: boolean; agents: Record<string, boolean> };
  chatSettings: ChatSettings; messages: Message[]; banterSpend: { at: string; usd: number }[]; notices: { at: string; agent: string; text: string }[];
  cards: { default: string; designs: any[] }; hired: Agent[]; hiredSkills: Record<string, { id: string; title: string; body: string }>;
}
export interface Budget { tokens: number; maxTurns: number }
export interface Job {
  $axf: 'swarm-job@1'; id: string; buildId: string; stepId: string; text: string; estimate: string; agent: string; skill: string; tier: Model; model: Model; match: number;
  leases: string[]; leaseKind: LeaseKind; shared: string[]; budget: Budget; checks: string[]; wave: number; after: string[]; fixes?: string;
}
export interface Report { $axf: 'swarm-report@1'; status: ReportStatus; summary: string; files: string[]; checks: { name: string; ok: boolean }[]; notes: string; handoff: string; question: string }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface Run {
  $axf: 'swarm-run@1'; kind: RunKind; jobId: string; buildId: string; stepId: string; jobType?: string; agent: string; model: Model; startedAt: string; endedAt: string; status: RunStatus; reason: string;
  report: Report | null; usage: Usage | null; budgetTokens: number; budget: Budget; turns: number; reportedCost: number | null;
  cwd?: string; branch?: string; worktree?: string; session?: string; tmux?: string; log?: string; briefFile?: string; reportPath?: string; reportFile?: string; group?: string;
  lease?: { ok: boolean; outside: string[]; shared: string[]; files: string[] }; inputs?: Record<string, string>; briefTokens?: number; queued?: { position: number; id: string } | null;
}
export const TAGS: { agent: 'agent@1'; skill: 'agent-skill@1'; roster: 'swarm-roster@1'; state: 'swarm-state@1'; job: 'swarm-job@1'; run: 'swarm-run@1'; report: 'swarm-report@1'; runs: 'swarm-runs@1' };
export const STATUSES: Record<AgentStatus, { label: string; works: boolean | 'small'; tone: string; about: string }>;
export const PICKABLE: AgentStatus[];
export const CHAT_KINDS: ChatKind[];
export const WORK_KINDS: ChatKind[];
export const BOSS: { id: string; name: string };
export const BRETT: string;
export const VIBE: { min: number; max: number; chill: number; amber: number };
export const SLIDERS: string[];
export const PRESETS: Record<string, { label: string; vibe: number; chattiness: number; cussing: number; drama: number }>;
export const DEFAULT_PRESET: string;
export const VIBE_COLORS: string[];
export const AVATAR_FACES: string[];
export const AVATAR_GEAR: string[];
export const AVATAR_TOKENS: string[];
export const IDENTITY_FIELDS: string[];
export const CARD_KEYS: string[];
export const SHARED_FILES: string[];
export const RUN_KINDS: RunKind[];
export const RUN_STATUSES: RunStatus[];
export const REPORT_STATUSES: ReportStatus[];
export const LEASE_KINDS: LeaseKind[];
export const SWARM: Record<string, any>;
export function isAgentId(v: unknown): boolean;
export function isCardId(v: unknown): boolean;
export function isTimestamp(v: unknown): boolean;
export function rejection(errors: FieldError[]): string;
export function normAgent(a: unknown): Agent;
export function agentErrors(a: unknown, p?: string): FieldError[];
export function parseSkill(md: string): Skill;
export function normSkill(s: unknown): Skill;
export function skillErrors(s: unknown, p?: string): FieldError[];
export function normRoster(r: unknown): Roster;
export function rosterErrors(roster: unknown, skills?: Record<string, Skill>): FieldError[];
export function normAgentState(s: unknown): AgentState;
export function normChat(c: unknown): { enabled: boolean; agents: Record<string, boolean> };
export function normMessage(m: unknown, i?: number): Message;
export function normChatSettings(o: unknown): ChatSettings;
export function normCardDesign(d: unknown): any;
export function normCards(c: unknown): { default: string; designs: any[] };
export function normState(s: unknown, roster?: Roster | null): SwarmState;
export function stateErrors(s: unknown): FieldError[];
export function normJob(j: unknown): Job;
export function jobErrors(j: unknown, p?: string): FieldError[];
export function normReport(r: unknown): Report;
export function reportErrors(r: unknown, p?: string): FieldError[];
export function parseReport(text: string): Report | null;
export function emptyUsage(): Usage;
export function budgetTokens(u: Usage | null | undefined): number;
export function normRun(r: unknown): Run;
export function runErrors(r: unknown, p?: string): FieldError[];
export function swarmErrors(tag: string, value: unknown, ctx?: any): FieldError[];
export function normSwarm(tag: string, value: unknown, ctx?: any): any;
export function jsonSchemas(): Record<string, any>;
