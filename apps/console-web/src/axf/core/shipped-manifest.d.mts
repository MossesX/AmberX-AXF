/** Types for shipped-manifest.mjs (shipped-manifest@1: what the orchestrator sends Shipped features when a build lands). */
export const SCHEMA: 'shipped-manifest@1';
export const VERSION: 1;
export type Source = 'orchestrator' | 'backfill' | 'api' | 'manual';
export type TestResult = 'pass' | 'fail' | 'skip' | 'unknown';
export type AreaKind = 'plugin' | 'app' | 'framework' | 'deploy' | 'docs' | 'builds' | 'other';
export type Model = 'Opus' | 'Fable';
export const SOURCES: Source[]; export const TEST_RESULTS: TestResult[]; export const AREA_KINDS: AreaKind[]; export const MODELS: Model[]; export const REPOS: string[];
export const MAX_BRIEF: number; export const MAX_SAID: number;
export interface Said { text: string; verbatim: boolean; at: string; source: string; by: string; addenda: Array<{ text: string; at: string; source: string; verbatim: boolean }> }
export interface Run { session: string; account: string; model: Model | ''; startedAt: string; endedAt: string; exit: number | null; costUsd: number }
export interface Step { id: string; text: string; model: Model; estimate: string; estimateMin: number; startedAt: string; doneAt: string; actualMin: number; done: boolean }
export interface Area { kind: AreaKind; id: string; files: string[] }
export interface Test { name: string; command: string; result: TestResult; detail: string }
export interface ReviewItem { id: string; name: string; status: string; group: string; url: string }
export interface Cost { usd: number; estimated: boolean; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } }
export interface Manifest {
  $axf: 'shipped-manifest@1'; version: 1; id: string; rev: number; source: Source; by: string; shippedAt: string;
  build: { id: string; title: string; profile: string; category: string; priority: string; repo: string };
  said: Said; brief: string; models: Model[]; accounts: string[]; runs: Run[]; steps: Step[];
  branch: string; pr: { repo: string; number: number; url: string }; landedCommit: string; commits: string[]; mergedAt: string; landedAt: string;
  files: string[]; areas: Area[]; tests: Test[]; uiReview: ReviewItem[]; cost: Cost; report: string; open: string[];
}
export interface Ref { id: string; rev: number; at: string; landedCommit: string }
export interface Summary {
  id: string; build: string; title: string; said: string; verbatim: boolean; pr: number; landedCommit: string; landedAt: string; shippedAt: string; models: Model[]; accounts: string[];
  files: number; areas: string[]; tests: { pass: number; fail: number; total: number }; steps: { done: number; total: number; estimateMin: number; actualMin: number }; costUsd: number; open: number; report: string; source: Source;
}
export interface FieldError { field: string; message: string }
export function iso(v: unknown): string;
export function modelName(v: unknown): Model;
export function manifestId(buildId: string): string;
export function estimateMinutes(v: unknown): number;
export function areaOf(path: string): { kind: AreaKind; id: string };
export function areasOf(files: string[]): Area[];
export function normManifest(v: unknown, opts?: { now?: string }): Manifest | null;
export function validateManifest(v: unknown): { ok: boolean; errors: FieldError[] };
export function rejection(errors: FieldError[]): string;
export function normRef(v: unknown): Ref | null;
export function refOf(m: Manifest): Ref | null;
export function isLanded(b: unknown): boolean;
export function manifestFromBuild(build: unknown, found?: Record<string, unknown>, opts?: { now?: string; source?: Source; by?: string; prev?: Manifest | null }): Manifest | null;
export function toLedger(m: unknown): Record<string, any> | null;
export function summaryOf(m: unknown): Summary | null;
export function searchText(m: unknown): string;
export const REGISTRY: Readonly<Record<string, unknown>>;
export function jsonSchemas(): Record<string, Record<string, unknown>>;
