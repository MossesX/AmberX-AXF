/** Types for run-indicator-rules.mjs (run-indicator@1). */
import type { RunAnimation, RunBrokeAnimation, RunIconAnimation, RunIndicatorData, RunReducedMotion, RunTone } from '../types';

export type { RunAnimation, RunBrokeAnimation, RunIconAnimation, RunIndicatorData, RunReducedMotion, RunTone };
export type RunState = 'running' | 'broke' | 'stale' | 'done';
export interface RunIndicator {
  animation: RunAnimation; icon: string; tones: Record<RunState, RunTone>; iconAnimation: RunIconAnimation; brokeAnimation: RunBrokeAnimation;
  speed: number; durationMs: number; intensity: number; reducedMotion: RunReducedMotion;
}
export interface RunIndicatorStyle { vars: Record<string, string>; attrs: Record<string, string> }

export const RUN_INDICATOR_FRAME: 'run-indicator@1';
export const RUN_INDICATOR_TYPE: 'run-indicator';
export const RUN_PREFIX: '--fx-run-';
export const RUN_ANIMATIONS: readonly RunAnimation[];
export const RUN_ICON_ANIMATIONS: readonly RunIconAnimation[];
export const RUN_BROKE_ANIMATIONS: readonly RunBrokeAnimation[];
export const RUN_REDUCED: readonly RunReducedMotion[];
export const RUN_TONES: readonly RunTone[];
export const RUN_STATES: readonly RunState[];
export const RUN_RANGES: Readonly<Record<'speed' | 'durationMs' | 'intensity', readonly [number, number]>>;
export const RUN_DEFAULTS: Readonly<RunIndicator>;
export function normalizeRunIndicator(raw: unknown): RunIndicator;
export function runIndicatorErrors(type: string, data: unknown): string[];
export function runIndicatorVars(raw: unknown, reduced?: boolean): Record<string, string>;
export function runIndicatorAttrs(raw: unknown, reduced?: boolean): Record<string, string>;
export function runIndicatorStyle(raw: unknown, reduced?: boolean): RunIndicatorStyle;
export function runIndicatorSchemaProperties(): Record<string, unknown>;
