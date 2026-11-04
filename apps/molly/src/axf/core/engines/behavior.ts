/**
 * behavior-theme@1: how an app behaves, as one swappable asset (type `behavior-theme`), next to the colour theme (what
 * it looks like), the style theme (its shapes and type) and the layout (where things go). Four groups:
 *
 *  - motion       how fast and how things move: speed, easing, reduced motion, how pages and lists come in
 *  - interaction  how controls answer: hover, press, focus ring, long-press and double-tap times, drag start, cursor
 *  - windows      how dialogs, pop-ups, drawers and floating windows open, close, snap, stack and minimize
 *  - feedback     how the app tells you things: toasts, sounds, vibration, confirm before delete, busy cursor
 *
 * Pure: `normalizeBehavior` fills every field (missing or bad values fall back to the defaults, never a crash),
 * `behaviorErrors` is what the validators report, `behaviorStyle` compiles it into root CSS vars + data attributes the
 * stylesheet reads (theme tokens only, nothing hard-coded; `theme` / `asset` values keep what the style theme or the
 * dialog / pop-up asset already does, so the default theme changes nothing), and the runtime hands the plain values to code that needs
 * them (long-press timers, toasts, confirm prompts, sounds). Every enum is an open list in BEHAVIOR_ENUMS.
 */
import type { BehaviorThemeData } from '../types';
import type { StyleOutput } from './components';

export const BEHAVIOR_TYPE = 'behavior-theme';

/** Allowed values per field (group.field). Shared with the build engine's validator and the JSON schema. */
export const BEHAVIOR_ENUMS = {
  'motion.speed': ['theme', 'instant', 'fast', 'normal', 'slow', 'relaxed'],
  'motion.easing': ['standard', 'emphasized', 'linear', 'spring', 'bounce'],
  'motion.reduced': ['system', 'always', 'never'],
  'motion.entrance': ['theme', 'none', 'fade', 'rise', 'scale'],
  'interaction.hover': ['theme', 'none', 'tint', 'lift', 'glow', 'underline'],
  'interaction.press': ['theme', 'none', 'shrink', 'darken', 'ripple'],
  'interaction.focusRing': ['auto', 'always', 'never'],
  'interaction.cursor': ['auto', 'pointer'],
  'windows.dialogOpen': ['asset', 'none', 'fade', 'scale', 'slide-up', 'slide-down'],
  'windows.backdrop': ['asset', 'dim', 'blur', 'none'],
  'windows.popupOpen': ['asset', 'none', 'fade', 'scale', 'slide'],
  'windows.drawerOpen': ['asset', 'slide', 'fade', 'none'],
  'windows.stack': ['cascade', 'center', 'remember'],
  'windows.minimize': ['cursor', 'dock', 'none'],
  'feedback.toastPosition': ['asset', 'top', 'bottom', 'top-right', 'bottom-right', 'top-left', 'bottom-left'],
  'feedback.sound': ['off', 'subtle', 'full'],
  'feedback.vibration': ['off', 'light', 'strong'],
  'feedback.confirmDelete': ['always', 'risky', 'never'],
} as const satisfies Record<string, readonly string[]>;

/** Number fields: [min, max]. */
export const BEHAVIOR_RANGES = {
  'interaction.longPressMs': [250, 1500],
  'interaction.doubleTapMs': [150, 700],
  'interaction.dragThreshold': [0, 24],
  'windows.snapGrid': [0, 48],
  'feedback.toastMs': [0, 20000],
} as const satisfies Record<string, readonly [number, number]>;

/** Boolean fields. */
export const BEHAVIOR_SWITCHES = ['windows.snap', 'windows.closeOnBackdrop', 'windows.closeOnEscape', 'feedback.busyCursor'] as const;

export const BEHAVIOR_GROUPS = ['motion', 'interaction', 'windows', 'feedback'] as const;

/** The framework's behaviour when an app has no behaviour theme (the same as before the type existed). */
export const DEFAULT_BEHAVIOR: BehaviorThemeData = {
  motion: { speed: 'theme', easing: 'standard', reduced: 'system', entrance: 'theme' },
  interaction: { hover: 'theme', press: 'theme', focusRing: 'auto', cursor: 'pointer', longPressMs: 550, doubleTapMs: 300, dragThreshold: 10 },
  windows: { dialogOpen: 'asset', backdrop: 'asset', popupOpen: 'asset', drawerOpen: 'asset', snap: false, snapGrid: 8, stack: 'cascade', minimize: 'cursor', closeOnBackdrop: true, closeOnEscape: true },
  feedback: { toastPosition: 'asset', toastMs: 0, sound: 'off', vibration: 'off', confirmDelete: 'risky', busyCursor: true },
};

/** Speed → milliseconds (`theme` = keep the style theme's motion). */
export const MOTION_MS: Record<string, number> = { instant: 0, fast: 90, normal: 160, slow: 260, relaxed: 380 };
/** Easing → CSS timing function. */
export const MOTION_EASE: Record<string, string> = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(0.3, 0, 0, 1.2)',
  linear: 'linear',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const groupOf = (raw: unknown, g: string): Record<string, unknown> => (isObj(raw) && isObj(raw[g]) ? (raw[g] as Record<string, unknown>) : {});

/** Every field filled in; anything missing or malformed takes the default. */
export function normalizeBehavior(raw: unknown): BehaviorThemeData {
  const out = JSON.parse(JSON.stringify(DEFAULT_BEHAVIOR)) as BehaviorThemeData;
  const o = out as unknown as Record<string, Record<string, unknown>>;
  for (const [path, allowed] of Object.entries(BEHAVIOR_ENUMS)) {
    const [g, f] = path.split('.') as [string, string];
    const v = groupOf(raw, g)[f];
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) o[g]![f] = v;
  }
  for (const [path, [min, max]] of Object.entries(BEHAVIOR_RANGES)) {
    const [g, f] = path.split('.') as [string, string];
    const v = groupOf(raw, g)[f];
    if (typeof v === 'number' && Number.isFinite(v)) o[g]![f] = Math.round(Math.min(max, Math.max(min, v)));
  }
  for (const path of BEHAVIOR_SWITCHES) {
    const [g, f] = path.split('.') as [string, string];
    const v = groupOf(raw, g)[f];
    if (typeof v === 'boolean') o[g]![f] = v;
  }
  return out;
}

/** What validators report for a behaviour theme's data. Missing fields are fine (defaults); wrong ones are not. */
export function behaviorErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['data must be an object'];
  const errors: string[] = [];
  for (const g of BEHAVIOR_GROUPS) if (g in raw && !isObj(raw[g])) errors.push(`data.${g} must be an object`);
  for (const [path, allowed] of Object.entries(BEHAVIOR_ENUMS)) {
    const [g, f] = path.split('.') as [string, string];
    const grp = groupOf(raw, g);
    if (f in grp && !(allowed as readonly string[]).includes(grp[f] as string)) errors.push(`data.${path} must be one of ${allowed.join(', ')}`);
  }
  for (const [path, [min, max]] of Object.entries(BEHAVIOR_RANGES)) {
    const [g, f] = path.split('.') as [string, string];
    const grp = groupOf(raw, g);
    if (f in grp && (typeof grp[f] !== 'number' || !Number.isFinite(grp[f]) || (grp[f] as number) < min || (grp[f] as number) > max)) errors.push(`data.${path} must be a number from ${min} to ${max}`);
  }
  for (const path of BEHAVIOR_SWITCHES) {
    const [g, f] = path.split('.') as [string, string];
    const grp = groupOf(raw, g);
    if (f in grp && typeof grp[f] !== 'boolean') errors.push(`data.${path} must be true or false`);
  }
  return errors;
}

/**
 * Root CSS vars + data attributes for the active behaviour theme. `--fx-motion` is only set when the speed isn't
 * `theme` (the style theme's own motion stays). `prefersReduced` is the system's reduced-motion setting (the runtime
 * passes it; pure callers pass false).
 */
export function behaviorStyle(raw: unknown, prefersReduced = false): StyleOutput {
  const b = normalizeBehavior(raw);
  const reduced = b.motion.reduced === 'always' || (b.motion.reduced === 'system' && prefersReduced);
  const vars: Record<string, string> = {
    '--fx-ease': MOTION_EASE[b.motion.easing] ?? MOTION_EASE.standard!,
    '--fx-longpress-ms': `${b.interaction.longPressMs}ms`,
    '--fx-doubletap-ms': `${b.interaction.doubleTapMs}ms`,
    '--fx-snap-grid': `${b.windows.snapGrid}px`,
  };
  if (reduced) vars['--fx-motion'] = '0ms';
  else if (b.motion.speed !== 'theme') vars['--fx-motion'] = `${MOTION_MS[b.motion.speed] ?? 160}ms`;
  const attrs: Record<string, string> = {
    'data-fx-motion': reduced ? 'reduced' : b.motion.speed,
    'data-fx-entrance': reduced ? 'none' : b.motion.entrance,
    'data-fx-hover': b.interaction.hover,
    'data-fx-press': b.interaction.press,
    'data-fx-focus': b.interaction.focusRing,
    'data-fx-cursor': b.interaction.cursor,
  };
  // "asset" = follow the dialog / pop-up asset (their own attributes stay); anything else overrides them
  const w = b.windows;
  if (reduced) attrs['data-fx-dialog-anim'] = 'none';
  else if (w.dialogOpen !== 'asset') attrs['data-fx-dialog-anim'] = w.dialogOpen === 'slide-up' ? 'slide' : w.dialogOpen;
  if (w.backdrop !== 'asset') attrs['data-fx-backdrop'] = w.backdrop;
  if (reduced) attrs['data-fx-popup-open'] = 'none';
  else if (w.popupOpen !== 'asset') attrs['data-fx-popup-open'] = w.popupOpen;
  if (reduced) attrs['data-fx-drawer-open'] = 'none';
  else if (w.drawerOpen !== 'asset') attrs['data-fx-drawer-open'] = w.drawerOpen;
  const pos = b.feedback.toastPosition;
  if (pos !== 'asset') attrs['data-fx-toast-pos'] = pos === 'top' ? 'top-center' : pos === 'bottom' ? 'bottom-center' : pos;
  return { vars, attrs };
}

/** Should deleting this ask first? `risky` = only when it can't be undone. */
export function confirmBeforeDelete(raw: unknown, undoable = false): boolean {
  const mode = normalizeBehavior(raw).feedback.confirmDelete;
  return mode === 'always' || (mode === 'risky' && !undoable);
}

/** Vibration pattern (ms) for a feedback event, or none. */
export function vibrationPattern(raw: unknown, kind: 'tap' | 'success' | 'warning' | 'error' = 'tap'): number[] {
  const v = normalizeBehavior(raw).feedback.vibration;
  if (v === 'off') return [];
  const base = v === 'strong' ? 30 : 12;
  return kind === 'tap' ? [base] : kind === 'success' ? [base, 40, base] : [base * 2, 60, base * 2, 60, base * 2];
}
