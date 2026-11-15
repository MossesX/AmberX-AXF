/** Types for axf-molly.mjs (axf-molly@1: the container that runs the orchestrator, gate, lander and Shipped sender; spec framework/spec/AXF-MOLLY.md). */
export const SCHEMA: 'axf-molly@1';
export const VERSION: 1;
export const SERVICE: 'axf-molly';
export const LEASE_FRAME: 'molly-lease@1';
export const DIFF_FRAME: 'molly-shadow-diff@1';
export const BRIDGE_FRAME: 'host-bridge@1';
export const STATUS_FRAME: 'molly-status@1';
export type Side = 'console' | 'axf-molly';
export const SIDES: readonly Side[];
export type Mode = 'shadow' | 'cutover' | 'undo';
export const MODES: readonly Mode[];
export const LEASE_TTL_MIN: number;
export const LEASE_TTL_MAX_MIN: number;
export const TEXT_MAX: number;
export const PORT: number;
export const BRIDGE_SOCKET: string;
export const CADENCE: Readonly<{ tick: number; lander: number; reconcile: number; lease: number; shadowKeep: number }>;

export interface LeaseStep { at: string; mode: Mode; owner: Side; by: string; reason: string }
export interface Lease { $axf: 'molly-lease@1'; rev: number; owner: Side; mode: Mode; since: string; until: string; by: string; reason: string; prev: { owner: Side; mode: Mode } | null; history: LeaseStep[] }
export function initialLease(at?: string, by?: string): Lease;
export function normLease(v: unknown, at?: string): Lease;
export function leaseErrors(v: unknown): string[];
export function leaseFresh(lease: unknown, now?: number | string): boolean;
export function leaseOwner(lease: unknown, now?: number | string): Side;
export function canAct(lease: unknown, side: Side, now?: number | string): boolean;
export function actingWhy(lease: unknown, side: Side, now?: number | string): string;
export function cutover(lease: unknown, o?: { at?: string; by?: string; reason?: string; ttlMin?: number }): { lease: Lease; error: string };
export function renew(lease: unknown, o?: { at?: string; ttlMin?: number }): { lease: Lease; error: string };
export function undo(lease: unknown, o?: { at?: string; by?: string; reason?: string }): { lease: Lease; error: string };

export interface PlanDiff { what: 'launch' | 'wait' | 'queue' | 'running'; id: string; mine: string; theirs: string }
export function diffPlans(mine?: Record<string, unknown>, theirs?: Record<string, unknown>): { same: boolean; diffs: PlanDiff[] };
export interface DiffEntry { $axf: 'molly-shadow-diff@1'; at: string; kind: string; same: boolean; count: number; diffs: PlanDiff[]; mine?: unknown; theirs?: unknown; note?: string }
export function diffEntry(kind: string, o?: { at?: string; diffs?: PlanDiff[]; mine?: unknown; theirs?: unknown; note?: string }): DiffEntry;
export function shadowSummary(entries?: unknown[], o?: { now?: number | string; cleanMin?: number }): { lines: number; differing: number; lastAt: string; lastDiffAt: string; cleanForMin: number; readyForCutover: boolean };

export const SESSION_RE: RegExp;
export const BUILD_RE: RegExp;
export const ACCOUNT_RE: RegExp;
export const WORKTREES_ROOT: string;
export const BRIDGE_COMMANDS: Readonly<Record<string, { args: string[]; touches: string }>>;
export const GIT_SUBCOMMANDS: readonly string[];
export const BRIDGE_NEVER: readonly string[];
export function bridgeCheck(req: unknown): { ok: boolean; error: string; cmd?: string; args?: string[]; spec?: { args: string[]; touches: string } };
export function worktreeFor(build: string, root?: string): string;
export function bridgeRequest(cmd: string, args?: string[], id?: string): { $axf: 'host-bridge@1'; id: string; cmd: string; args: string[] };
export function bridgeReply(id: string, o: { ok: boolean; status?: number; stdout?: string; stderr?: string; error?: string; ms?: number }): { $axf: 'host-bridge@1'; id: string; ok: boolean; status: number; stdout: string; stderr: string; error: string; ms: number };

export const CONSOLE_TARGETS: Readonly<Record<string, string>>;
export const ALERT_LINK: string;
export interface Tool { method: 'GET' | 'POST'; path: string; cli: string[]; args: string[]; mutates: boolean; exclusive: boolean; says: string }
export const TOOLS: Readonly<Record<string, Tool>>;
export const TOOL_FAMILIES: readonly string[];
export function toolFor(name: string): Tool | null;
export function toolNames(family?: string): string[];
export function routeTool(method: string, path: string): { tool: string; params: Record<string, string> } | null;
export function axhubService(o?: { url?: string; reason?: string }): Record<string, unknown>;

export const OLD_MOLLY: Readonly<Record<string, string>>;
export function nameClash(names?: string[], name?: string): { clash: boolean; near: string[] };
export function retirementList(found?: Record<string, string[]>): string[];
export function statusFrame(o?: Record<string, unknown>): Record<string, unknown>;
