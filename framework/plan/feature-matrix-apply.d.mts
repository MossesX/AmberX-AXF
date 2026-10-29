// Types for feature-matrix-apply.mjs (the feature-matrix@1 Apply engine).
import type { Matrix } from './feature-matrix-core.mjs';
export type Target = 'build' | 'pending' | 'queue' | 'change' | 'feature';
export interface ChangeLine { target: Target; id: string; path: string; from: unknown; to: unknown }
export interface Projection<T> { target: T; changes: ChangeLine[] }
export interface Targets { build?: any; pending?: any; queue?: any; change?: any; feature?: any }
export interface Report { matrix: string; version: number; keptMinutes: number; skippedMinutes: number; targets: Target[]; perTarget: Partial<Record<Target, number>>; changes: ChangeLine[]; summary: string; at: string }
export function projectBuild(build: any, matrix: Matrix, now?: string): Projection<any>;
export function projectPending(item: any, matrix: Matrix, now?: string): Projection<any>;
export function projectQueueRecord(record: any, matrix: Matrix, now?: string, id?: string): Projection<any>;
export function projectChange(entry: any, matrix: Matrix, now?: string): Projection<any>;
export function projectFeature(feature: any, matrix: Matrix): Projection<any>;
export function applyAll(matrix: Matrix, targets: Targets, now?: string): { targets: Targets; report: Report };
