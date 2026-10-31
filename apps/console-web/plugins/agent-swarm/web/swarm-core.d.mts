// Types for swarm-core.mjs (loose on purpose: ui.tsx narrows them to its own types).
/* eslint-disable @typescript-eslint/no-explicit-any */
export const MODEL_TIERS: string[];
export const MODEL_LABEL: Record<string, string>;
export const SHARED_FILES: string[];
export function planJobs(builds: any, roster: any, opts?: any): { jobs: any[]; waves: string[][]; warnings: string[] };
export function prices(file: any): Record<string, any>;
export function costOf(u: any, model: string, table: any): number;
export function runCost(r: any, table: any): number;
export function budgetUsd(job: any, table: any): number;
export function meter(runs: any[], table: any): any;
export function fmtUsd(v: number): string;
export function fmtTokens(v: number): string;
export function minutesOf(e: unknown): number | null;
export const STATUSES: Record<string, { label: string; works: boolean | 'small'; tone: string; about: string }>;
export function agentStats(runs: any[], agentId: string, table: any, feedSize?: number): any;
export function avatarColors(av: any): { hair: string; shirt: string };
export const AVATAR_TOKENS: string[];
