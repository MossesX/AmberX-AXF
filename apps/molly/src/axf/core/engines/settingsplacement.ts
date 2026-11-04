/*
 * Settings placement engine (settings-placement@1, Nov 3 2026): where a plugin's settings open when its gear, its
 * context-menu "Settings", a search hit or any `settings.open:<tab>` names one of its settings tabs.
 *
 * Brett, Nov 3 2026: "Plugins need to open their settings either in them or in a pop-up dialog as well as existing in
 * the main settings interface. … it needs one more to open in itself. And whenever it can't open within itself, it will
 * open a pane. A pane will slide out. You need to be able to configure the animation for each one too."
 *
 *   inside = in the plugin itself, as a slide-out pane (left / right / top / bottom), a drop-down panel, a tab inside the
 *            plugin, a split view or an inline section (the plugin wraps its UI in <SettingsHost>, react/settingsHost.tsx)
 *   dialog = a pop-up dialog over the page (size and position)
 *   window = its own floating window
 *   main   = the main Settings page (what every settings tab did before)
 *
 * A plugin's settings always stay in the main Settings interface too; this only picks where its own openings land.
 *
 * Fallback: `inside` when the plugin can't host it (not open, no <SettingsHost>, the mode isn't one it supports, or a
 * split / drop-down on a compact screen) opens a slide-out pane: over the plugin when it is open, else over the page.
 *
 * Look: every placement has its own look (animation, speed, easing, edge, size, dim, blur, corner radius, shadow). Every
 * value is a name the stylesheet maps onto theme tokens (`--fx-motion`, `--fx-ease`, `--fx-radius-*`, `--fx-shadow-*`,
 * `--fx-blur`, `--fx-scrim`), never a raw size or colour, and reduced motion turns every animation off.
 *
 * The pick is the setting `axf.settingsPlacement.<owner>` (a JSON string, `SettingsPlacementPick`); with none, the app
 * default `axf.settingsPlacement.default`, else the legacy rule (owner's "Opens in" = dialog → dialog, else main).
 * Pure: the settings library (libs/settings) asks `resolveSettingsOpen` what to do and the React layer renders it.
 * Web only for now; the Kotlin twin is a deferred gap (framework/spec/PORTING.md). Fixture: spec/fixtures/settings-placement.json.
 */

export const SETTINGS_PLACEMENTS = ['inside', 'dialog', 'window', 'main'] as const;
export type SettingsPlacement = (typeof SETTINGS_PLACEMENTS)[number];

export const INSIDE_MODES = ['pane', 'dropdown', 'tab', 'split', 'inline'] as const;
export type InsideMode = (typeof INSIDE_MODES)[number];

export const EDGES = ['left', 'right', 'top', 'bottom'] as const;
export type Edge = (typeof EDGES)[number];

export const ANIMATIONS = ['slide', 'fade', 'scale', 'drop', 'push', 'none'] as const;
export type Animation = (typeof ANIMATIONS)[number];

export const SPEEDS = ['instant', 'fast', 'normal', 'slow', 'slower'] as const;
export type Speed = (typeof SPEEDS)[number];
/** Speed → a multiple of the theme's `--fx-motion` (behaviour theme; 0ms under reduced motion). */
export const SPEED_FACTOR: Record<Speed, number> = { instant: 0, fast: 1, normal: 1.6, slow: 2.5, slower: 4 };

export const EASINGS = ['theme', 'standard', 'decelerate', 'accelerate', 'linear', 'spring'] as const;
export type Easing = (typeof EASINGS)[number];

export const SIZES = ['narrow', 'medium', 'wide', 'half', 'full'] as const;
export type Size = (typeof SIZES)[number];
/** Size → share of the host (the plugin, or the page) along the opening axis. */
export const SIZE_SHARE: Record<Size, number> = { narrow: 0.3, medium: 0.4, wide: 0.55, half: 0.5, full: 1 };

export const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'] as const;
export type Position = (typeof POSITIONS)[number];

export const LEVELS = ['none', 'sm', 'md', 'lg'] as const;
export type Level = (typeof LEVELS)[number];

export interface SettingsLook {
  animation: Animation;
  speed: Speed;
  easing: Easing;
  /** the edge a pane slides from (and the edge a slide / push animation enters from) */
  edge: Edge;
  size: Size;
  /** dialog only: where it sits */
  position: Position;
  /** dim what's behind it (the theme's scrim) */
  dim: boolean;
  /** blur what's behind it (the theme's `--fx-blur`) */
  blur: boolean;
  radius: Level;
  shadow: Level;
}

export interface SettingsPlacementPick {
  $axf?: 'settings-placement@1';
  placement: SettingsPlacement;
  /** inside: how it opens in the plugin */
  mode: InsideMode;
  /** one look per placement / mode, so switching back keeps what was set (`inside:pane`, `dialog`, `window`) */
  looks: Partial<Record<LookKey, Partial<SettingsLook>>>;
}

export type LookKey = `inside:${InsideMode}` | 'dialog' | 'window' | 'fallback';

export const PLACEMENT_LABELS: Record<SettingsPlacement, string> = {
  inside: 'Inside the plugin',
  dialog: 'Pop-up dialog',
  window: 'Floating window',
  main: 'Main settings page',
};
export const MODE_LABELS: Record<InsideMode, string> = {
  pane: 'Slide-out pane',
  dropdown: 'Drop-down panel',
  tab: 'New tab in the plugin',
  split: 'Split view',
  inline: 'Inline section',
};
export const ANIMATION_LABELS: Record<Animation, string> = { slide: 'Slide', fade: 'Fade', scale: 'Scale', drop: 'Drop', push: 'Push', none: 'None' };

/** What each look starts as, per placement / mode (a pane slides from the left, a dialog scales in the centre…). */
export const DEFAULT_LOOKS: Record<LookKey, SettingsLook> = {
  'inside:pane': { animation: 'slide', speed: 'normal', easing: 'theme', edge: 'left', size: 'medium', position: 'center', dim: true, blur: false, radius: 'none', shadow: 'md' },
  'inside:dropdown': { animation: 'drop', speed: 'fast', easing: 'decelerate', edge: 'top', size: 'half', position: 'right', dim: false, blur: false, radius: 'md', shadow: 'lg' },
  'inside:tab': { animation: 'fade', speed: 'fast', easing: 'theme', edge: 'top', size: 'full', position: 'center', dim: false, blur: false, radius: 'none', shadow: 'none' },
  'inside:split': { animation: 'push', speed: 'normal', easing: 'theme', edge: 'right', size: 'medium', position: 'center', dim: false, blur: false, radius: 'none', shadow: 'none' },
  'inside:inline': { animation: 'drop', speed: 'fast', easing: 'theme', edge: 'top', size: 'half', position: 'center', dim: false, blur: false, radius: 'sm', shadow: 'none' },
  dialog: { animation: 'scale', speed: 'normal', easing: 'decelerate', edge: 'top', size: 'medium', position: 'center', dim: true, blur: false, radius: 'lg', shadow: 'lg' },
  window: { animation: 'none', speed: 'normal', easing: 'theme', edge: 'top', size: 'medium', position: 'center', dim: false, blur: false, radius: 'md', shadow: 'md' },
  fallback: { animation: 'slide', speed: 'normal', easing: 'theme', edge: 'right', size: 'medium', position: 'center', dim: true, blur: false, radius: 'none', shadow: 'lg' },
};

/** Settings key holding one owner's pick; `default` holds the pick for plugins nobody set yet. */
export const settingsPlacementKey = (owner: string) => `axf.settingsPlacement.${owner}`;
export const SETTINGS_PLACEMENT_DEFAULT_KEY = 'axf.settingsPlacement.default';

export const DEFAULT_PICK: SettingsPlacementPick = { placement: 'main', mode: 'pane', looks: {} };

const one = <T extends string>(list: readonly T[], x: unknown, fallback: T): T => (typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : fallback);

export const lookKeyOf = (placement: SettingsPlacement, mode: InsideMode): LookKey | null =>
  placement === 'inside' ? `inside:${mode}` : placement === 'dialog' || placement === 'window' ? placement : null;

/** A stored look (partial, possibly stale) → a whole one, on `key`'s defaults. */
export function normalizeLook(x: unknown, key: LookKey): SettingsLook {
  const d = DEFAULT_LOOKS[key];
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  return {
    animation: one(ANIMATIONS, o.animation, d.animation),
    speed: one(SPEEDS, o.speed, d.speed),
    easing: one(EASINGS, o.easing, d.easing),
    edge: one(EDGES, o.edge, d.edge),
    size: one(SIZES, o.size, d.size),
    position: one(POSITIONS, o.position, d.position),
    dim: typeof o.dim === 'boolean' ? o.dim : d.dim,
    blur: typeof o.blur === 'boolean' ? o.blur : d.blur,
    radius: one(LEVELS, o.radius, d.radius),
    shadow: one(LEVELS, o.shadow, d.shadow),
  };
}

/** A stored pick (object or JSON string, possibly stale or hand-written) → a valid pick; unknown values fall back. */
export function normalizePick(x: unknown, fallback: SettingsPlacementPick = DEFAULT_PICK): SettingsPlacementPick {
  let o: unknown = x;
  if (typeof x === 'string') { try { o = JSON.parse(x); } catch { o = SETTINGS_PLACEMENTS.includes(x as SettingsPlacement) ? { placement: x } : null; } }
  if (!o || typeof o !== 'object') return { ...fallback, looks: { ...fallback.looks } };
  const r = o as Record<string, unknown>;
  const looks: SettingsPlacementPick['looks'] = {};
  const src = (r.looks && typeof r.looks === 'object' ? r.looks : {}) as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_LOOKS) as LookKey[]) if (src[k] && typeof src[k] === 'object') looks[k] = normalizeLook(src[k], k);
  return { $axf: 'settings-placement@1', placement: one(SETTINGS_PLACEMENTS, r.placement, fallback.placement), mode: one(INSIDE_MODES, r.mode, fallback.mode), looks };
}

/** The pick to store (compact JSON). */
export const encodePick = (p: SettingsPlacementPick): string => JSON.stringify(normalizePick(p));

/**
 * The pick in force for an owner: its own, else the app default (when someone set one), else the plugin's declared
 * default (plugin@1 `settingsPlacement`), else the legacy rule (its "Opens in" is dialog → a dialog, which is what
 * `settings.open` did before this engine; otherwise the main page).
 */
export function effectivePick(own: unknown, appDefault: unknown, legacyOpens?: string | null, declared?: unknown): SettingsPlacementPick {
  const legacy: SettingsPlacementPick = legacyOpens === 'dialog' ? { placement: 'dialog', mode: 'pane', looks: {} } : DEFAULT_PICK;
  const plugin = declared != null && declared !== '' ? normalizePick(declared, legacy) : legacy;
  const base = appDefault != null && appDefault !== '' ? normalizePick(appDefault, plugin) : plugin;
  return own != null && own !== '' ? normalizePick(own, base) : base;
}

/** What the plugin offers for `inside` (plugin@1 `settingsHost`), and what the screen allows right now. */
export interface HostInfo {
  /** in-plugin modes the mounted host renders (always includes `pane`) */
  modes: readonly InsideMode[];
  /** the host is narrow (phone / compact window): split and drop-down don't fit */
  compact: boolean;
}

export type FallbackReason = 'not-open' | 'no-host' | 'unsupported' | 'compact';

export const FALLBACK_LABELS: Record<FallbackReason, string> = {
  'not-open': 'the plugin isn\'t open, so they slide out over the page',
  'no-host': 'this plugin has no room for them yet, so they slide out over the page',
  unsupported: 'the plugin doesn\'t offer that, so they slide out as a pane over it',
  compact: 'the screen is too narrow for that, so they slide out as a pane over the plugin',
};

/** Where one opening lands. */
export type SettingsRoute =
  | { via: 'main' }
  | { via: 'window'; look: SettingsLook }
  | { via: 'dialog'; look: SettingsLook }
  /** inside the plugin's mounted host */
  | { via: 'host'; mode: InsideMode; look: SettingsLook; fallback?: FallbackReason }
  /** a pane over the page (the plugin can't host it) */
  | { via: 'page-pane'; look: SettingsLook; fallback: FallbackReason };

const MODES_FITTING_COMPACT: readonly InsideMode[] = ['pane', 'tab', 'inline'];

/**
 * Resolve one opening. `host` = the plugin's mounted <SettingsHost> (null: not open); `hostable` = the plugin declares
 * a settings host at all (plugin@1 `settingsHost`); `reducedMotion` turns every animation off.
 */
export function resolveSettingsOpen(pick: SettingsPlacementPick, ctx: { host: HostInfo | null; hostable: boolean; reducedMotion?: boolean }): SettingsRoute {
  const p = normalizePick(pick);
  const motion = (l: SettingsLook): SettingsLook => (ctx.reducedMotion ? { ...l, animation: 'none', speed: 'instant' } : l);
  const lookOf = (k: LookKey) => motion(normalizeLook(p.looks[k], k));
  if (p.placement === 'main') return { via: 'main' };
  if (p.placement === 'window') return { via: 'window', look: lookOf('window') };
  if (p.placement === 'dialog') return { via: 'dialog', look: lookOf('dialog') };
  // inside: the asked mode when it fits, else a pane (over the plugin, or over the page)
  const want = lookOf(`inside:${p.mode}`);
  const asPane = (): SettingsLook => {
    const pane = p.mode === 'pane' ? want : lookOf('inside:pane');
    return { ...pane, animation: pane.animation === 'none' || ctx.reducedMotion ? pane.animation : 'slide' };
  };
  if (!ctx.host) {
    const fb = lookOf('fallback');
    // keep the edge and size the person picked for the pane; the rest is the fallback look
    const pane = normalizeLook(p.looks['inside:pane'], 'inside:pane');
    return { via: 'page-pane', look: motion({ ...fb, edge: p.looks['inside:pane'] ? pane.edge : fb.edge, size: p.looks['inside:pane'] ? pane.size : fb.size }), fallback: ctx.hostable ? 'not-open' : 'no-host' };
  }
  const modes = ctx.host.modes.includes('pane') ? ctx.host.modes : [...ctx.host.modes, 'pane' as const];
  if (!modes.includes(p.mode)) return { via: 'host', mode: 'pane', look: asPane(), fallback: 'unsupported' };
  if (ctx.host.compact && !MODES_FITTING_COMPACT.includes(p.mode)) return { via: 'host', mode: 'pane', look: asPane(), fallback: 'compact' };
  return { via: 'host', mode: p.mode, look: want };
}

/** plugin@1 `settingsHost`: `true` = every in-plugin mode, a list = those (pane is always added), absent / false = none. */
export function hostModes(decl: unknown): InsideMode[] {
  if (decl === true) return [...INSIDE_MODES];
  const list = Array.isArray(decl) ? decl : decl && typeof decl === 'object' && Array.isArray((decl as { modes?: unknown }).modes) ? (decl as { modes: unknown[] }).modes : null;
  if (!list) return [];
  const out = INSIDE_MODES.filter((m) => list.includes(m));
  return out.length && !out.includes('pane') ? ['pane', ...out] : out;
}

/**
 * The look as CSS: custom properties the stylesheet (ui/axf.css, "Settings placement") reads, every one a theme token
 * or a share of the host, plus data attributes for the animation and edge.
 */
export function lookStyle(l: SettingsLook): { vars: Record<string, string>; attrs: Record<string, string> } {
  const ease: Record<Easing, string> = { theme: 'var(--fx-ease)', standard: 'ease', decelerate: 'ease-out', accelerate: 'ease-in', linear: 'linear', spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)' };
  const level = (kind: 'radius' | 'shadow', v: Level) => (v === 'none' ? (kind === 'radius' ? '0' : 'none') : `var(--fx-${kind}-${v})`);
  return {
    vars: {
      '--axf-sp-dur': `calc(var(--fx-motion) * ${SPEED_FACTOR[l.speed]})`,
      '--axf-sp-ease': ease[l.easing],
      '--axf-sp-size': `${Math.round(SIZE_SHARE[l.size] * 100)}%`,
      '--axf-sp-radius': level('radius', l.radius),
      '--axf-sp-shadow': level('shadow', l.shadow),
      '--axf-sp-blur': l.blur ? 'var(--fx-blur)' : '0',
    },
    attrs: { 'data-axf-sp-anim': l.animation, 'data-axf-sp-edge': l.edge, 'data-axf-sp-pos': l.position, 'data-axf-sp-dim': l.dim ? 'on' : 'off' },
  };
}

/** One line on where the settings open, for lists and chips ("Inside the plugin · slide-out pane, left"). */
export function describePick(p: SettingsPlacementPick): string {
  const n = normalizePick(p);
  if (n.placement !== 'inside') return PLACEMENT_LABELS[n.placement];
  const l = normalizeLook(n.looks[`inside:${n.mode}`], `inside:${n.mode}`);
  return `${PLACEMENT_LABELS.inside} · ${MODE_LABELS[n.mode].toLowerCase()}${n.mode === 'pane' ? `, ${l.edge}` : ''}`;
}

/** Choices for pickers. */
export const placementChoices = () => SETTINGS_PLACEMENTS.map((value) => ({ value, label: PLACEMENT_LABELS[value] }));
export const modeChoices = (modes: readonly InsideMode[] = INSIDE_MODES) => modes.map((value) => ({ value, label: MODE_LABELS[value] }));
