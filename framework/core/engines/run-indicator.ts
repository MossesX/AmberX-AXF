/**
 * Run indicator engine — run-indicator@1: how a running job shows in every grid (Brett, Nov 17 2026: "Every running job
 * in any grid has a spinning or animated icon, and building rows flash slowly; configure the animation, flash, pulse,
 * colors. When it stops it goes red, a pink background"). The rules live in run-indicator-rules.mjs, shared with the
 * build engine, so both validators and the token compiler are one function; this file is the typed face the runtime,
 * React and the grids use.
 *
 * Compiled tokens (pure, identical on every port): --fx-run-{running,broke,stale,done} (the tone, a theme var),
 * --fx-run-{…}-bg (the tone mixed over the surface at --fx-opacity-tint: broke-bg is the pink background),
 * --fx-run-intensity, --fx-run-flash-min, --fx-run-glow, --fx-run-duration (0ms under reduced motion),
 * --fx-run-icon-duration, --fx-run-ease; attributes data-fx-run-anim / -icon / -icon-anim / -broke-anim / -reduced.
 * A grid row carries data-fx-run-state="running | broke | stale | done" from its build-live@1 state (spec/BUILD-LIVE.md)
 * and axf.css draws it from these tokens only. Fixture: spec/fixtures/run-indicator.json (spec/check-run-indicator.mts).
 * Kotlin twin deferred (spec/PORTING.md).
 */
import type { RunIndicatorData } from '../types';
import { RUN_INDICATOR_TYPE, normalizeRunIndicator, runIndicatorAttrs, runIndicatorErrors, runIndicatorVars, type RunIndicator, type RunIndicatorStyle, type RunState } from './run-indicator-rules.mjs';

export {
  RUN_ANIMATIONS, RUN_BROKE_ANIMATIONS, RUN_DEFAULTS, RUN_ICON_ANIMATIONS, RUN_INDICATOR_FRAME, RUN_INDICATOR_TYPE, RUN_PREFIX, RUN_RANGES, RUN_REDUCED, RUN_STATES, RUN_TONES,
  normalizeRunIndicator, runIndicatorAttrs, runIndicatorErrors, runIndicatorSchemaProperties, runIndicatorVars,
  type RunIndicator, type RunIndicatorStyle, type RunState,
} from './run-indicator-rules.mjs';
export type { RunIndicatorData };

/** The framework's own indicator (what an app without the asset gets): the pulse starter's values. */
export const DEFAULT_RUN_INDICATOR: RunIndicator = normalizeRunIndicator(null);

/** The tokens and attributes the runtime's root compile merges; `reduced` = the system or the behaviour theme asks for reduced motion. */
export function runIndicatorStyle(raw: unknown, reduced = false): RunIndicatorStyle {
  return { vars: runIndicatorVars(raw, reduced), attrs: runIndicatorAttrs(raw, reduced) };
}

/** The attribute a grid row carries for its live state ('' for idle: nothing drawn). */
export function runStateAttr(state: string): Record<string, string> {
  return state === 'running' || state === 'broke' || state === 'stale' || state === 'done' ? { 'data-fx-run-state': state } : {};
}

/** The tone token a state draws with (the var the row's text and icon use). */
export const runToneVar = (state: RunState): string => `var(--fx-run-${state})`;
/** The background token a state draws with. */
export const runBgVar = (state: RunState): string => `var(--fx-run-${state}-bg)`;

/** Validation entry for the asset validator (empty for other types). */
export const runIndicatorAssetErrors = (type: string, data: unknown): string[] => (type === RUN_INDICATOR_TYPE ? runIndicatorErrors(type, data) : []);
