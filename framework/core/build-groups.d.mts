/** Types for build-groups.mjs: the step-groups@1 grouping engine (framework/spec/BUILD-GROUPS.md). */
import type { BuildGroup } from './build-pipeline.d.mts';

export const SCHEMA: 'step-groups@1';
export const DEFAULT_SPLIT_MINUTES: 30;
export const SPLIT_SETTING: 'splitOverMin';
export const DEFAULT_STEP_MINUTES: 10;
export interface PlanStep { id?: string; estimate?: string | number; files?: string[]; dependsOn?: string[]; done?: boolean; skip?: boolean; group?: string }
export interface PlanOptions { splitOverMin?: number; stepMinutes?: number }
export interface PlanEdge { from: string; to: string; why: string }
export interface GroupPlan {
  $axf: 'step-groups@1';
  split: boolean; minutes: number; threshold: number; open: number;
  groups: BuildGroup[]; mergeOrder: string[]; edges: PlanEdge[];
  reason: string; error: string;
}
export function estimateMinutes(e: unknown): number | null;
export function buildMinutes(build: { steps?: PlanStep[] } | null | undefined, stepMinutes?: number): number;
export function planGroups(build: { steps?: PlanStep[] } | null | undefined, options?: PlanOptions): GroupPlan;
export function withGroups<T extends { steps?: PlanStep[]; groups?: unknown }>(build: T, plan: GroupPlan | null | undefined): T & { groups?: BuildGroup[] };
