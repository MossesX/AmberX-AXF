/** Types for plan-shipped.mjs: a plan@1 taking a shipped-manifest@1. */
import type { Manifest } from '@console/axf/core/shipped-manifest.mjs';
import type { Plan } from './plan-core.mjs';

export interface ShippedProblem { at: string; id: string; rev: number; source: string; by: string; errors: { field: string; message: string }[]; reason: string }
export interface Actual { usd: number; estimated: boolean; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; minutes: number; estimateMinutes: number; runs: number; models: string[]; accounts: string[] }
export interface ShippedSummary {
  id: string; rev: number; build: string; pr: number; landedCommit: string; landedAt: string; shippedAt: string; models: string[]; accounts: string[]; files: number;
  tests: { pass: number; fail: number; total: number }; steps: { done: number; total: number; estimateMin: number; actualMin: number }; costUsd: number; open: number; report: string; verbatim: boolean;
}
export function planIdFor(manifest: unknown): string;
export function isLanded(manifest: unknown): boolean;
export function applyManifest(plan: Plan | null | undefined, manifest: Manifest, opts?: { now?: string }): { plan: Plan; changed: boolean; stale: boolean };
export function flagManifest(plan: Plan | null | undefined, raw: unknown, errors: { field: string; message: string }[], opts?: { now?: string; source?: string; by?: string }): Plan;
export function shippedSummary(plan: Plan | null | undefined): ShippedSummary | null;
export function checkPlanAgainstManifest(plan: Plan, manifest: Manifest): string[];
