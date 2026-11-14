/** Types for land-run.mjs (land-run@1: one serial landing attempt of a built branch onto main). */
export const SCHEMA: 'land-run@1';
export type LandRunOutcome = '' | 'landed' | 'red' | 'clash' | 'cancelled' | 'error';
export type CiState = '' | 'queued' | 'waiting' | 'running' | 'success' | 'failure' | 'cancelled';
export const OUTCOMES: LandRunOutcome[];
export const CI_STATES: CiState[];
export const MAX_FILES: number;
export interface LandRunCheck { ok: boolean | null; failed: string[]; note: string }
export interface LandRunCi { run: string; status: string; conclusion: string; state: CiState }
export interface LandRun {
  id: string; build: string; branch: string; pr: number;
  startedAt: string; endedAt: string;
  base: string; head: string; merged: string;
  regenerated: string[]; unresolved: string[];
  check: LandRunCheck; ci: LandRunCi;
  outcome: LandRunOutcome; fixBuild: string; error: string; note: string;
}
/** The build-pipeline@1 land.landAttempts entry for one attempt. */
export interface LandAttemptEntry { at: string; run: string; base: string; merged: string; outcome: LandRunOutcome; ci: CiState; note: string }
export function sha(v: unknown): string;
/** GitHub Actions (status, conclusion) → CI state; cancelled / skipped / neutral are `cancelled`, never `failure`. */
export function ciState(status: unknown, conclusion: unknown): CiState;
export function newLandRunId(build: string, startedAt?: string): string;
export function emptyLandRun(): LandRun;
export function normLandRun(v: unknown): LandRun | null;
export function outcomeOf(run: unknown): LandRunOutcome;
export function validateLandRun(v: unknown): { ok: boolean; errors: { path: string; message: string }[] };
export function attemptOf(run: unknown): LandAttemptEntry;
export function landRunLine(run: unknown): string;
export function settleLandRun(run: unknown, now?: string): LandRun | null;
