// Types for swarm-chat.mjs (the agent swarm's group chat contract; shared by the console plugin, the CLI and the checks).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ChatKind, FieldError, Message, Roster, SwarmState } from './swarm-rules.mjs';
export { BOSS, BRETT, CHAT_KINDS, WORK_KINDS } from './swarm-rules.mjs';
export interface Line { from: string; kind: ChatKind; text: string; jobId?: string; at?: string }
export type Names = Record<string, string> | Map<string, string> | Roster | ((id: string) => string | undefined);
export const SPEAKERS: { boss: ChatKind[]; agent: ChatKind[]; brett: ChatKind[] };
export const JOB_KINDS: ChatKind[];
export const BANTER_MAX_CHARS: number;
export const BANTER_PROMPT_LINE_CHARS: number;
export const BANTER_BATCH_MAX: number;
export const BANTER_RECENT: number;
export function messageErrors(m: unknown, agents?: string[], p?: string): FieldError[];
export function chatOn(state: SwarmState, from: string): boolean;
export function post(state: SwarmState, msgs: Line[], at: string, filter?: (m: Line) => Line | null): number;
export function namer(names?: Names): (id: string) => string;
export function fileList(l: string[]): string;
export function assignLine(job: any, names?: Names): Line;
export function leaseLines(plan: { jobs: any[] }, names?: Names, overlap?: (a: string[], b: string[]) => boolean): Line[];
export function reportLines(run: any): Line[];
export function mergeLines(res: { branch: string; merged: string[]; conflicts: { job: string; files: string[]; fixer: string }[]; refused: { job: string; outside: string[]; shared: string[] }[] }, names?: Names, fixer?: string): Line[];
export function statusLine(agentId: string, label: string, note?: string, names?: Names): Line;
export function payLine(kind: 'raise' | 'dock' | 'topup' | 'bonus', agentId: string, v: Record<string, any>, names?: Names): Line;
export function brokeLine(agentId: string, p: { spent: number; salary: number; topups: number; payday: string }): Line;
export function disciplineLines(moment: 'suspend' | 'suspension-over' | 'back-from-leave' | 'rehire' | 'quit', agentId: string, v?: Record<string, any>, names?: Names): Line[];
export function hiredLine(agentName: string, jobName: string): Line;
export function newCardsLine(designName?: string): Line;
export function waitingLine(agentName: string, q: { position: number; used: number; cap: number }): Line;
export function assignJobLine(jobName: string, agentName: string, model: string, budgetTokens: number, cap: number, jobTypeId: string): Line;
export function unassignedLine(jobName: string, why: string, jobTypeId: string): Line;
export const BANTER: Record<string, string[]>;
export const BANTER_MOMENTS: string[];
export function banterLine(moment: string, seed: string, vars?: Record<string, string>): string;
export function reactors(state: SwarmState, roster: Roster, subject: string, n: number, seed: string): Roster['agents'];
export function banterPrompt(roster: Roster, recent: Message[] | Line[], n?: number): string;
export function parseBanter(text: string, roster: Roster): Line[];
