/**
 * behavior-theme@1: how an app behaves, as one swappable asset (type `behavior-theme`), next to the colour theme (what
 * it looks like), the style theme (its shapes and type) and the layout (where things go). Four groups:
 *
 *  - motion       how fast and how things move: speed, easing, reduced motion, how pages and lists come in, and the
 *                 skin animations (swatch wave, skin-switch ripple / sweep, colour-picker fan; speed and intensity)
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
  'motion.swatches': ['wave', 'ripple', 'pop', 'off'],
  'motion.skinSwitch': ['ripple', 'sweep', 'fade', 'off'],
  'motion.picker': ['fan', 'pop', 'off'],
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
  'motion.animSpeed': [25, 400],
  'motion.animIntensity': [0, 100],
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
  motion: { speed: 'theme', easing: 'standard', reduced: 'system', entrance: 'theme', swatches: 'wave', skinSwitch: 'ripple', picker: 'fan', animSpeed: 100, animIntensity: 60 },
  interaction: { hover: 'theme', press: 'theme', focusRing: 'auto', cursor: 'pointer', longPressMs: 550, doubleTapMs: 300, dragThreshold: 10 },
  windows: { dialogOpen: 'asset', backdrop: 'asset', popupOpen: 'asset', drawerOpen: 'asset', snap: false, snapGrid: 8, stack: 'cascade', minimize: 'cursor', closeOnBackdrop: true, closeOnEscape: true },
  feedback: { toastPosition: 'asset', toastMs: 0, sound: 'off', vibration: 'off', confirmDelete: 'risky', busyCursor: true },
};

/** Speed → milliseconds (`theme` = keep the style theme's motion). */
export const MOTION_MS: Record<string, number> = { instant: 0, fast: 90, normal: 160, slow: 260, relaxed: 380 };
/**
 * The skin animations (colour swatches that wave, the skin-switch ripple / sweep, the colour picker that fans out
 * into shades). Each is an on/off-able field of `motion`, so a skin's behaviour theme carries its own set; speed is a
 * percent of normal and intensity how far things move (0 to 100).
 */
export const SKIN_ANIMATIONS = [
  { key: 'swatches', label: 'Colour swatches', attr: 'data-fx-anim-swatches', help: 'Skin cards: the swatch row waves or ripples on hover or tap.' },
  { key: 'skinSwitch', label: 'Skin switch', attr: 'data-fx-anim-skin-switch', help: 'Switching skins: the new colours ripple or sweep across the screen from where you tapped.' },
  { key: 'picker', label: 'Colour picker', attr: 'data-fx-anim-picker', help: 'Colour pickers: the picked swatch pops and fans out into its shades, the colour morphs.' },
] as const;
export type SkinAnimationKey = (typeof SKIN_ANIMATIONS)[number]['key'];

/** The animation tokens (CSS vars) every skin animation reads: duration, easing, intensity, speed and stagger. */
export function skinAnimationVars(b: BehaviorThemeData): Record<string, string> {
  const speed = b.motion.animSpeed > 0 ? b.motion.animSpeed : 100;
  const k = (2.5 * 100) / speed;
  return {
    '--fx-anim-dur': `calc(var(--fx-motion) * ${k.toFixed(3)})`,
    '--fx-anim-sweep-dur': `calc(var(--fx-motion) * ${(k * 1.6).toFixed(3)})`,
    '--fx-anim-stagger': `calc(var(--fx-motion) * ${(k * 0.16).toFixed(3)})`,
    '--fx-anim-ease': MOTION_EASE[b.motion.easing === 'linear' ? 'standard' : b.motion.easing] ?? MOTION_EASE.standard!,
    '--fx-anim-pop-ease': MOTION_EASE.spring!,
    '--fx-anim-intensity': (b.motion.animIntensity / 100).toFixed(2),
  };
}

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
  Object.assign(vars, skinAnimationVars(b));
  const attrs: Record<string, string> = {
    'data-fx-motion': reduced ? 'reduced' : b.motion.speed,
    'data-fx-entrance': reduced ? 'none' : b.motion.entrance,
    'data-fx-hover': b.interaction.hover,
    'data-fx-press': b.interaction.press,
    'data-fx-focus': b.interaction.focusRing,
    'data-fx-cursor': b.interaction.cursor,
  };
  for (const a of SKIN_ANIMATIONS) attrs[a.attr] = reduced || b.motion.animIntensity === 0 ? 'off' : String(b.motion[a.key]);
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

/**
 * Settings → Appearance → Animations: this app's own picks over the skin's (the behaviour theme the skin carries).
 * One settings value under ANIMATION_PREFS_KEY; a field that is missing or `skin` keeps the skin's choice.
 */
export const ANIMATION_PREFS_KEY = 'axf.appearance.animations';
export interface AnimationPrefs { swatches?: string; skinSwitch?: string; picker?: string; speed?: number; intensity?: number }
export const ANIMATION_PREF_KEYS = ['swatches', 'skinSwitch', 'picker', 'speed', 'intensity'] as const;
export type AnimationPrefKey = (typeof ANIMATION_PREF_KEYS)[number];

/** Only valid picks survive; anything else is dropped (= the skin's). */
export function normalizeAnimationPrefs(raw: unknown): AnimationPrefs {
  const out: AnimationPrefs = {};
  if (!isObj(raw)) return out;
  for (const a of SKIN_ANIMATIONS) {
    const v = raw[a.key];
    if (typeof v === 'string' && (BEHAVIOR_ENUMS[`motion.${a.key}`] as readonly string[]).includes(v)) out[a.key] = v;
  }
  const num = (v: unknown, [min, max]: readonly [number, number]) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : undefined);
  const speed = num(raw.speed, BEHAVIOR_RANGES['motion.animSpeed']);
  const intensity = num(raw.intensity, BEHAVIOR_RANGES['motion.animIntensity']);
  if (speed !== undefined) out.speed = speed;
  if (intensity !== undefined) out.intensity = intensity;
  return out;
}

/** One pick changed: `skin` (or null) drops it back to the skin's. Returns null when the value isn't allowed. */
export function setAnimationPref(prefs: unknown, key: string, value: unknown): AnimationPrefs | null {
  if (!(ANIMATION_PREF_KEYS as readonly string[]).includes(key)) return null;
  const cur = normalizeAnimationPrefs(prefs) as Record<string, unknown>;
  if (value === null || value === undefined || value === 'skin') { delete cur[key]; return cur as AnimationPrefs; }
  const v = key === 'speed' || key === 'intensity' ? (typeof value === 'string' && value.trim() !== '' ? Number(value) : value) : value;
  const next = normalizeAnimationPrefs({ ...cur, [key]: v }) as Record<string, unknown>;
  if (!(key in next)) return null;
  return next as AnimationPrefs;
}

/** The behaviour theme with this app's animation picks laid over it. */
export function withAnimationPrefs(raw: unknown, prefs: unknown): BehaviorThemeData {
  const b = normalizeBehavior(raw);
  const p = normalizeAnimationPrefs(prefs);
  const m = b.motion as unknown as Record<string, unknown>;
  for (const a of SKIN_ANIMATIONS) if (p[a.key]) m[a.key] = p[a.key];
  if (p.speed !== undefined) b.motion.animSpeed = p.speed;
  if (p.intensity !== undefined) b.motion.animIntensity = p.intensity;
  return b;
}

export interface AnimationState {
  reduced: boolean;
  speed: number;
  intensity: number;
  animations: { key: SkinAnimationKey; label: string; help: string; value: string; skin: string; own: boolean; on: boolean; options: string[] }[];
  prefs: AnimationPrefs;
}

/** What the Animations section, the API and voice read: each animation's value, the skin's, and whether it plays. */
export function animationState(raw: unknown, prefs: unknown, prefersReduced = false): AnimationState {
  const skin = normalizeBehavior(raw);
  const p = normalizeAnimationPrefs(prefs);
  const eff = withAnimationPrefs(raw, p);
  const reduced = eff.motion.reduced === 'always' || (eff.motion.reduced === 'system' && prefersReduced);
  return {
    reduced,
    speed: eff.motion.animSpeed,
    intensity: eff.motion.animIntensity,
    prefs: p,
    animations: SKIN_ANIMATIONS.map((a) => {
      const value = String(eff.motion[a.key]);
      return { key: a.key, label: a.label, help: a.help, value, skin: String(skin.motion[a.key]), own: !!p[a.key], on: !reduced && eff.motion.animIntensity > 0 && value !== 'off', options: [...BEHAVIOR_ENUMS[`motion.${a.key}`]] };
    }),
  };
}
