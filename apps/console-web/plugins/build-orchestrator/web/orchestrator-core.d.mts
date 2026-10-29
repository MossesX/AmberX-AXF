// Types for orchestrator-core.mjs (loose on purpose: ui.tsx narrows them to its own Build/Step types).
/* eslint-disable @typescript-eslint/no-explicit-any */
export const SCHEMA: string;
export const MODELS: ('Fable' | 'Opus')[];
export const STATUSES: string[];
export const STATUS_LABEL: Record<string, string>;
export const SORTS: string[];
export const SORT_LABEL: Record<string, string>;
export const DEFAULT_RULES: { sameSession: boolean; subAgents: boolean; approveModelSwitch: boolean; maxStepMinutes: number };
export const MODEL_GUIDE: Record<string, string>;
export const UNCATEGORISED: string;
export interface Group { label: string; steps: any[]; done: number; skipped: number; minutesLeft: number }
export interface Phase { index: number; model: 'Fable' | 'Opus'; label: string; name: string; from: string; gate: boolean; approved: boolean; done: boolean; minutesLeft: number; steps: any[]; groups: Group[] }
export function categories(builds: any[]): { name: string; count: number }[];
export function estimateMinutes(e: unknown): number | null;
export function formatMinutes(min: number | null | undefined): string;
export function emptyState(): any;
export function normalizeState(s: unknown): any;
export function phases(build: any): Phase[];
export function nextUp(build: any, rules?: any): { phase: Phase | null; step: any | null; needsApproval: boolean; done: boolean };
export function progress(build: any): { total: number; done: number; skipped: number; minutesLeft: number; byModel: Record<string, number>; switches: number };
export function splitCheck(build: any, rules?: any): { needsSplit: boolean; reasons: string[] };
export function derivedStatus(build: any, rules?: any): string;
export function counts(builds: any[]): Record<string, number>;
export function sortBuilds(list: any[], sort?: string, dir?: 'asc' | 'desc', rules?: any): any[];
export function brief(build: any, rules?: any): string;
export function apply(state: any, change: any): { state: any; build?: any; log: string[] };
