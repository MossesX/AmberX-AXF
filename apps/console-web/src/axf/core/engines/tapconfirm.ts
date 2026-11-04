/**
 * Tap-to-confirm for toolbars (Brett, Nov 3 2026): on touch, the first tap on a toolbar button shows what it does and
 * arms it for a short window (3 s by default); a second tap on the same button inside the window runs it. A tap on a
 * different button re-arms that one instead of running anything. Mouse, trackpad, pen and keyboard stay a normal
 * single click (with the usual hover tooltip). The rule is decided per interaction, so a touchscreen laptop gets the
 * double tap from a finger and a single click from its mouse.
 *
 * Pure: `tapDecide` is the whole state machine; the web host (framework/react/tapConfirm.ts) feeds it the pointer type
 * of the press that produced each click and applies the answer. Settings are plain keys (owned by the Toolbars plugin's
 * settings tab), read through `tapConfig`, so a per-toolbar override is a setting and never code.
 */

/** Settings keys. The per-toolbar override lives at `${TAP_KEYS.perToolbar}<toolbar id>.tapConfirm`. */
export const TAP_KEYS = {
  enabled: 'axf.toolbars.tapConfirm',
  armMs: 'axf.toolbars.armMs',
  perToolbar: 'axf.toolbar.',
} as const;

export const TAP_ARM_DEFAULT_MS = 3000;
export const TAP_ARM_RANGE: readonly [number, number] = [1000, 10000];

/** Per-toolbar override, chosen in that toolbar's settings. */
export const TAP_OVERRIDES = ['inherit', 'on', 'off'] as const;
export type TapOverride = (typeof TAP_OVERRIDES)[number];

/** How the press that produced a click was made. Only `touch` arms. */
export type TapPointer = 'touch' | 'mouse' | 'pen' | 'keyboard';

export interface TapConfig { enabled: boolean; armMs: number }

export interface TapState {
  /** The armed button (toolbar id + button key), or null. */
  target: string | null;
  armedAt: number;
}

export const TAP_IDLE: TapState = { target: null, armedAt: 0 };

export type TapOutcome =
  /** let the click through (mouse/pen/keyboard, behaviour off, or the confirming second tap) */
  | 'run'
  /** swallow the click, arm this button and show its tip */
  | 'arm';

export interface TapDecision { outcome: TapOutcome; state: TapState }

/** The arm window, clamped to TAP_ARM_RANGE; anything that isn't a finite number is the default. */
export function tapArmMs(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return TAP_ARM_DEFAULT_MS;
  return Math.round(Math.min(TAP_ARM_RANGE[1], Math.max(TAP_ARM_RANGE[0], n)));
}

/** Global settings plus one toolbar's override → whether tap-to-confirm is on for that toolbar, and its window. */
export function tapConfig(get: (key: string) => unknown, toolbarId: string): TapConfig {
  const global = get(TAP_KEYS.enabled) !== false; // on unless switched off
  const raw = get(`${TAP_KEYS.perToolbar}${toolbarId}.tapConfirm`);
  const override: TapOverride = (TAP_OVERRIDES as readonly string[]).includes(raw as string) ? (raw as TapOverride) : 'inherit';
  return { enabled: override === 'inherit' ? global : override === 'on', armMs: tapArmMs(get(TAP_KEYS.armMs)) };
}

/**
 * One click on a toolbar button. `target` names the button (stable while the toolbar is on screen), `now` is ms.
 * Touch + on: the first tap arms, a second tap on the same armed button inside `armMs` runs, a tap on another
 * button (or after the window ran out) arms that one. Anything else runs and clears any armed button.
 */
export function tapDecide(state: TapState, ev: { pointer: TapPointer; target: string; now: number }, cfg: TapConfig): TapDecision {
  if (ev.pointer !== 'touch' || !cfg.enabled) return { outcome: 'run', state: TAP_IDLE };
  const live = state.target !== null && ev.now - state.armedAt <= cfg.armMs;
  if (live && state.target === ev.target) return { outcome: 'run', state: TAP_IDLE };
  return { outcome: 'arm', state: { target: ev.target, armedAt: ev.now } };
}

/** Whether an armed state has run out (the host clears the lit button when it has). */
export function tapExpired(state: TapState, now: number, armMs: number): boolean {
  return state.target !== null && now - state.armedAt > armMs;
}

/** `pointerType` from a PointerEvent (or '' for keyboard / synthetic clicks) → TapPointer. */
export function tapPointer(pointerType: string | undefined | null): TapPointer {
  return pointerType === 'touch' ? 'touch' : pointerType === 'pen' ? 'pen' : pointerType === 'mouse' ? 'mouse' : 'keyboard';
}

/** A toolbar's settings id: explicit `data-axf-toolbar`, its asset id, else a slug of its label, else `toolbar`. */
export function toolbarIdOf(attrs: { id?: string | null; asset?: string | null; label?: string | null }): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug(attrs.id || '') || slug(attrs.asset || '') || slug(attrs.label || '') || 'toolbar';
}
