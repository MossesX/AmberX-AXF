// Types for job-type-rules.mjs (job-type@1; shared by the TS engines, the build engine, the agent-job router and the console).
export type JobModel = 'haiku' | 'sonnet' | 'opus' | 'fable';
export type JobTriggerKind = 'on-demand' | 'schedule' | 'event';
export interface JobInput { id: string; label: string; required: boolean; default: string; about: string }
export interface JobTypeData {
  specialty: string;
  model: JobModel;
  budget: { tokens: number; maxTurns: number; usd: number };
  trigger: { kind: JobTriggerKind; every: string; at: string; event: string };
  readOnly: boolean;
  tools: string[];
  inputs: JobInput[];
  brief: string;
  command: string;
  outputs: { report: string; uiReviewGroup: string; uiReviewApp: string };
}
export const JOB_TYPE: 'job-type';
export const JOB_ENUMS: { model: readonly JobModel[]; trigger: readonly JobTriggerKind[] };
export const JOB_BUILTINS: readonly string[];
export const JOB_LIMITS: { brief: number; inputs: number; tools: number; tokensMin: number; tokensMax: number; turnsMax: number; usdMax: number };
export const JOB_DEFAULTS: JobTypeData;
export function placeholders(tpl: string): string[];
export function jobTypeErrors(type: string, raw: unknown): string[];
export function normalizeJobType(raw: unknown): JobTypeData;
export function renderTemplate(tpl: string, vars?: Record<string, unknown>): string;
export function timeWords(at: string | number | Date, timeZone?: string): { date: string; when: string; stamp: string };
export function jobInputs(data: JobTypeData, given?: Record<string, string>): { values: Record<string, string>; missing: string[] };
export function renderJobBrief(data: JobTypeData, values: Record<string, string>, ctx: { at: string; agent?: string; agentName?: string; jobType?: string; jobName?: string; runId?: string; timeZone?: string }): { text: string; report: string; group: string };
export function nextRun(trigger: JobTypeData['trigger'] | undefined, lastAt: string, now: string): string;
export function isDue(trigger: JobTypeData['trigger'] | undefined, lastAt: string, now: string): boolean;
export function jobTypeSchemaProperties(): Record<string, unknown>;
