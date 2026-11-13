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

/**
 * Default link to label visibility (Brett, Nov 2026, build tap-to-confirm-follows-label-visibility): a toolbar, tab
 * group, navigation menu or application menu that hides its labels (icons only) gets tap-to-confirm, because an icon
 * alone doesn't say what it does; one that shows its labels doesn't. A manual setting always wins, most specific first:
 *   1. the toolbar's own override `axf.toolbar.<id>.tapConfirm` (Settings → Plugins → Toolbars): on / off
 *   2. the chrome instance field `tapConfirm` in `axf.chrome.<type>.<instance>` (its settings dialog): on / off
 *   3. the global mode `axf.toolbars.tapConfirm`: 'on' / true = everywhere, 'off' / false = nowhere
 *   4. otherwise (unset, 'labels', 'auto', 'inherit'): on exactly when the labels are hidden
 */

/** Settings keys. The per-toolbar override lives at `${TAP_KEYS.perToolbar}<toolbar id>.tapConfirm`. */
export const TAP_KEYS = {
  /** global mode: 'labels' (default) | 'on' | 'off'; the older booleans read as on / off */
  enabled: 'axf.toolbars.tapConfirm',
  armMs: 'axf.toolbars.armMs',
  perToolbar: 'axf.toolbar.',
} as const;

export const TAP_ARM_DEFAULT_MS = 3000;
export const TAP_ARM_RANGE: readonly [number, number] = [1000, 10000];

/** Per-toolbar override, chosen in that toolbar's settings. */
export const TAP_OVERRIDES = ['inherit', 'on', 'off'] as const;
export type TapOverride = (typeof TAP_OVERRIDES)[number];

/** The global mode: follow label visibility (default), or force on / off everywhere. */
export const TAP_MODES = ['labels', 'on', 'off'] as const;
export type TapMode = (typeof TAP_MODES)[number];
export const TAP_MODE_LABELS: Record<TapMode, string> = { labels: 'Follow labels', on: 'Always', off: 'Never' };

/** The chrome kinds tap-to-confirm reaches, and the instance field (chrome-settings@1) that overrides it. */
export const TAP_CHROME_TYPES = ['toolbar', 'tab-group', 'nav-menu', 'app-menu'] as const;
export type TapChromeType = (typeof TAP_CHROME_TYPES)[number];
export const TAP_FIELD = 'tapConfirm';
/** The instance field's values: 'auto' follows the global mode / labels. */
export const TAP_FIELD_OPTIONS = ['auto', 'on', 'off'] as const;
export type TapFieldValue = (typeof TAP_FIELD_OPTIONS)[number];

/** Which of the settings decided (shown next to the switch, and readable through the API). */
export type TapSource = 'toolbar' | 'instance' | 'global' | 'labels';

/** How the press that produced a click was made. Only `touch` arms. */
export type TapPointer = 'touch' | 'mouse' | 'pen' | 'keyboard';

export interface TapConfig { enabled: boolean; armMs: number; source?: TapSource }

/** Where a tap landed: the chrome kind + instance (for its settings field) and whether its labels are hidden. */
export interface TapScope { type?: TapChromeType; instance?: string; labelsHidden?: boolean }

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

/** The global mode from its stored value: true / 'on' → on, false / 'off' → off, anything else → follow labels. */
export function tapMode(v: unknown): TapMode {
  if (v === true || v === 'on') return 'on';
  if (v === false || v === 'off') return 'off';
  return 'labels';
}

/** The settings key of a chrome instance's overrides (chrome-settings@1 CHROME_INSTANCE_KEY). */
export const tapInstanceKey = (type: string, instance: string) => `axf.chrome.${type}.${instance}`;

/** A chrome instance's manual tap-to-confirm field ('on' / 'off'), or null when it follows ('auto' / unset). */
export function tapInstanceField(raw: unknown): 'on' | 'off' | null {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>)[TAP_FIELD] : undefined;
  return v === 'on' || v === 'off' ? v : null;
}

/**
 * Global settings, the chrome instance field, one toolbar's override and the scope's label visibility → whether
 * tap-to-confirm is on there, its window, and which of them decided. `scope.labelsHidden` unset counts as shown.
 */
export function tapConfig(get: (key: string) => unknown, toolbarId: string, scope: TapScope = {}): TapConfig {
  const armMs = tapArmMs(get(TAP_KEYS.armMs));
  const raw = toolbarId ? get(`${TAP_KEYS.perToolbar}${toolbarId}.tapConfirm`) : null;
  if (raw === 'on' || raw === 'off') return { enabled: raw === 'on', armMs, source: 'toolbar' };
  if (scope.type && scope.instance) {
    const f = tapInstanceField(get(tapInstanceKey(scope.type, scope.instance)));
    if (f) return { enabled: f === 'on', armMs, source: 'instance' };
  }
  const mode = tapMode(get(TAP_KEYS.enabled));
  if (mode !== 'labels') return { enabled: mode === 'on', armMs, source: 'global' };
  return { enabled: scope.labelsHidden === true, armMs, source: 'labels' };
}

/** Whether a chrome kind's asset data hides its labels (icons only); the renderers mark this as data-axf-labels. */
export function chromeLabelsHidden(type: string, data: Record<string, unknown> | null | undefined): boolean {
  const d = data ?? {};
  if (type === 'toolbar') return (d.variant ?? 'icons') === 'icons';
  if (type === 'tab-group') return d.display === 'icons';
  if (type === 'nav-menu') return d.showLabels === false;
  return false; // the application menu bar always shows its words: it follows labels as "shown" (off) unless set
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
