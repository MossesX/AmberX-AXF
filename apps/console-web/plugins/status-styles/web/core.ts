/**
 * Status styles: the pure part (no React, no DOM). A status → a style, and a style → CSS.
 *
 * Nothing here decides a status. The pages that show one mark it `data-status="<id>"` (the status the VPS sent), and
 * the stylesheet built here finds that mark: the innermost row around it gets the row preset, the mark itself gets the
 * badge preset. A preset holds picks only (effect, colour token, speed, strength, still look), so every colour, size
 * and duration in the CSS is a theme token and the result follows whatever skin is on.
 *
 * Shipped data: assets/status-style/library.json (presets, status-style-library@1) and default.json (status-styles@1).
 */
import libraryAsset from '../assets/status-style/library.json' with { type: 'json' };
import defaultAsset from '../assets/status-style/default.json' with { type: 'json' };

export type Target = 'row' | 'text';
export interface Preset {
  id: string; name: string; target: Target; effect: string; tone: string;
  /** percent of the effect's normal speed */
  speed: number;
  /** how far the effect goes, 0 to 100 */
  strength: number;
  direction: string;
  /** still look: background tint (percent), edge bar, bold, italic, dim (percent) */
  tint: number; edge: boolean; bold: boolean; italic: boolean; dim: number;
  /** true for Brett's own presets */
  own?: boolean;
}
export interface StatusStyle { label: string; group: string; preset: string; badgePreset: string; animated: boolean; custom?: boolean }
export interface Config { enabled: boolean; rows: boolean; badges: boolean; statuses: Record<string, StatusStyle> }
export type SavedStatus = Partial<Pick<StatusStyle, 'label' | 'preset' | 'badgePreset' | 'animated'>>;
export interface SavedConfig { enabled?: boolean; rows?: boolean; badges?: boolean; statuses?: Record<string, SavedStatus> }

const LIB = libraryAsset.data;
export const TARGETS = LIB.targets as Target[];
export const EFFECTS: string[] = LIB.effects;
export const TEXT_EFFECTS: string[] = LIB.textEffects;
export const TONES: string[] = LIB.tones;
export const DIRECTIONS: string[] = LIB.directions;
export const LIMITS = LIB.limits;
export const OWN_GROUP = 'Your statuses';
export const PLAIN = 'plain';

export const EFFECT_LABEL: Record<string, string> = {
  none: 'None (still)', blink: 'Blink', pulse: 'Pulse', sweep: 'Fade sweep', shimmer: 'Shimmer', fill: 'Fill up', stripes: 'Moving stripes',
  glow: 'Inner glow', ring: 'Glow ring', edge: 'Pulsing edge bar', flash: 'Double flash', heartbeat: 'Heartbeat', shake: 'Shake', bob: 'Bob', underline: 'Underline',
};
export const TONE_LABEL: Record<string, string> = { accent: 'Accent', success: 'Green (success)', warning: 'Amber (warning)', danger: 'Red (danger)', info: 'Blue (info)', muted: 'Muted', text: 'Text colour' };
export const DIRECTION_LABEL: Record<string, string> = { normal: 'Forwards', reverse: 'Backwards', alternate: 'Back and forth' };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const STATUS_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
export const isStatusId = (v: unknown): v is string => typeof v === 'string' && STATUS_RE.test(v);

const clamp = (v: unknown, range: number[], fallback: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(range[1] ?? x, Math.max(range[0] ?? x, Math.round(x))) : fallback; };
const oneOf = (v: unknown, list: string[], fallback: string) => (typeof v === 'string' && list.includes(v) ? v : fallback);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

/** "My slow blink!" → "my-slow-blink" (the id a status or an own preset is saved under). */
export function slug(v: string, max = 40): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
}

/** Any value → a preset that is safe to draw, or null when it has no usable id. */
export function cleanPreset(raw: unknown): Preset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isId(r.id)) return null;
  const target = oneOf(r.target, TARGETS, 'row') as Target;
  const effect = oneOf(r.effect, target === 'text' ? TEXT_EFFECTS : EFFECTS, 'none');
  return {
    id: r.id, name: text(r.name, 60) || r.id, target, effect, tone: oneOf(r.tone, TONES, 'accent'),
    speed: clamp(r.speed, LIMITS.speed, 100), strength: clamp(r.strength, LIMITS.strength, 60), direction: oneOf(r.direction, DIRECTIONS, 'normal'),
    tint: clamp(r.tint, LIMITS.tint, 0), edge: r.edge === true, bold: r.bold === true, italic: r.italic === true, dim: clamp(r.dim, LIMITS.dim, 0),
  };
}

export const BUILT_IN: Preset[] = (LIB.presets as unknown[]).map(cleanPreset).filter((p): p is Preset => !!p);
const BUILT_IN_IDS = new Set(BUILT_IN.map((p) => p.id));
export const isBuiltIn = (id: string) => BUILT_IN_IDS.has(id);

/** The built-in presets followed by Brett's own (an own preset never replaces a built-in one). */
export function allPresets(own: unknown): Preset[] {
  const mine = (Array.isArray(own) ? own : []).map(cleanPreset).filter((p): p is Preset => !!p && !isBuiltIn(p.id)).slice(0, LIMITS.presets);
  const seen = new Set<string>();
  return [...BUILT_IN, ...mine.filter((p) => !seen.has(p.id) && !!seen.add(p.id)).map((p) => ({ ...p, own: true }))];
}

export const DEFAULTS = defaultAsset.data as Config;

/** The shipped defaults with Brett's saved changes laid over them. Unknown statuses he added are kept. */
export function resolveConfig(saved: unknown): Config {
  const s = (saved && typeof saved === 'object' ? saved : {}) as SavedConfig;
  const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const statuses: Record<string, StatusStyle> = {};
  for (const [id, d] of Object.entries(DEFAULTS.statuses)) statuses[id] = { ...d };
  const mine = s.statuses && typeof s.statuses === 'object' ? s.statuses : {};
  let added = 0;
  for (const [id, raw] of Object.entries(mine)) {
    if (!isStatusId(id) || !raw || typeof raw !== 'object') continue;
    const base = statuses[id];
    if (!base && (added += 1) > LIMITS.statuses) continue;
    const cur: StatusStyle = base ?? { label: text(raw.label, 40) || id, group: OWN_GROUP, preset: PLAIN, badgePreset: PLAIN, animated: false, custom: true };
    statuses[id] = {
      ...cur,
      preset: isId(raw.preset) ? raw.preset : cur.preset,
      badgePreset: isId(raw.badgePreset) ? raw.badgePreset : cur.badgePreset,
      animated: flag(raw.animated, cur.animated),
    };
  }
  return { enabled: flag(s.enabled, DEFAULTS.enabled), rows: flag(s.rows, DEFAULTS.rows), badges: flag(s.badges, DEFAULTS.badges), statuses };
}

/** What to save: only what differs from the shipped defaults (so a later default reaches every untouched status). */
export function savedFrom(cfg: Config): SavedConfig {
  const out: SavedConfig = {};
  for (const k of ['enabled', 'rows', 'badges'] as const) if (cfg[k] !== DEFAULTS[k]) out[k] = cfg[k];
  const statuses: Record<string, SavedStatus> = {};
  for (const [id, st] of Object.entries(cfg.statuses)) {
    const d = DEFAULTS.statuses[id];
    if (!d) { statuses[id] = { label: st.label, preset: st.preset, badgePreset: st.badgePreset, animated: st.animated }; continue; }
    const diff: SavedStatus = {};
    if (st.preset !== d.preset) diff.preset = st.preset;
    if (st.badgePreset !== d.badgePreset) diff.badgePreset = st.badgePreset;
    if (st.animated !== d.animated) diff.animated = st.animated;
    if (Object.keys(diff).length) statuses[id] = diff;
  }
  if (Object.keys(statuses).length) out.statuses = statuses;
  return out;
}

/** Statuses in the order the settings list shows them, one entry per group. */
export function statusGroups(cfg: Config): { group: string; items: { id: string; style: StatusStyle }[] }[] {
  const groups = new Map<string, { id: string; style: StatusStyle }[]>();
  for (const [id, style] of Object.entries(cfg.statuses)) { if (!groups.has(style.group)) groups.set(style.group, []); groups.get(style.group)!.push({ id, style }); }
  return [...groups].map(([group, items]) => ({ group, items }));
}

/** Statuses whose badge moves right now (what a badge pack reads to pick its animated or its still picture). */
export function animatedStatuses(cfg: Config): string[] {
  return cfg.enabled && cfg.badges ? Object.entries(cfg.statuses).filter(([, s]) => s.animated).map(([id]) => id) : [];
}

/* ---------------------------------------------------------------- CSS */

/** Anything that counts as a row: grid rows, tappable rows, table rows, list and tree lines, or an explicit mark. */
export const ROW = ':is([data-status-row], [data-axf-row], [data-fx-row], tr, li, [role="treeitem"], [role="listitem"])';
/** The innermost row around a status mark (a row whose own nested row carries a status is left to that row). */
export const rowSelector = (status: string) => `${ROW}:has([data-status="${status}"]):not(:has(${ROW} [data-status]))`;
export const badgeSelector = (status: string) => `[data-status="${status}"]`;
export const previewSelector = (preset: string) => `[data-axp-status-styles-preview="${preset}"]`;

const n = (v: number) => String(Math.round(v * 100) / 100);
const SPACE = (k: number) => `calc(var(--fx-space) * ${n(k)})`;
const LINE = (k: number) => `calc(var(--fx-border-w) * ${n(k)})`;

type Frames = Record<string, string[]>;
interface Drawn { still: string[]; moving: string[]; frames: Frames; duration: number; timing: string }

/** One preset as declarations: the still look, what is added while it moves, its keyframes and normal duration. */
export function draw(p: Preset): Drawn {
  const c = `var(--fx-${p.tone})`;
  const s = p.strength / 100;
  const mix = (pct: number) => `color-mix(in srgb, ${c} ${n(Math.max(0, Math.min(100, pct)))}%, transparent)`;
  const text = p.target === 'text';
  const still: string[] = [];
  const shadows: string[] = [];
  if (p.tint > 0) shadows.push(`inset 0 0 0 100vmax ${mix(p.tint)}`);
  if (p.edge) shadows.push(`inset ${LINE(3)} 0 0 ${c}`);
  if (shadows.length) still.push(`box-shadow: ${shadows.join(', ')}`);
  if (p.bold) still.push('font-weight: bolder');
  if (p.italic) still.push('font-style: italic');
  const rest = 1 - p.dim / 100;
  if (p.dim > 0) still.push(`opacity: ${n(rest)}`);

  const shadow = (...own: string[]) => `box-shadow: ${[...own, ...shadows].join(', ')}`;
  const fill = (pct: number) => `inset 0 0 0 100vmax ${mix(pct)}`;
  const ink = (pct: number) => `color: color-mix(in srgb, ${c} ${n(pct)}%, currentColor)`;
  const moving: string[] = [];
  let frames: Frames = {};
  let duration = 2.5;
  let timing = 'ease-in-out';
  const beat = (at: (k: number) => string, peaks: [string, number][], rests: string) => { frames = { [rests]: [at(0)] }; for (const [pct, k] of peaks) frames[pct] = [at(k)]; };

  switch (p.effect) {
    case 'blink':
      frames = text ? { '50%': [`color: color-mix(in srgb, currentColor ${n(100 - 80 * s)}%, transparent)`] } : { '0%, 100%': [`opacity: ${n(rest)}`], '50%': [`opacity: ${n(rest * (1 - 0.75 * s))}`] };
      break;
    case 'pulse':
      frames = text ? { '50%': [ink(100 * s)] } : { '0%, 100%': [shadow(fill(0))], '50%': [shadow(fill(40 * s))] };
      duration = 3;
      break;
    case 'glow':
      frames = text
        ? { '0%, 100%': [`text-shadow: 0 0 ${SPACE(1)} ${mix(0)}`], '50%': [`text-shadow: 0 0 ${SPACE(1)} ${mix(100 * s)}`] }
        : { '0%, 100%': [shadow(`inset 0 0 ${SPACE(2)} ${mix(0)}`)], '50%': [shadow(`inset 0 0 ${SPACE(2)} ${mix(90 * s)}`)] };
      duration = 3;
      break;
    case 'ring':
      frames = { '0%': [shadow(`0 0 0 0 ${mix(85 * s)}`)], '70%, 100%': [shadow(`0 0 0 ${SPACE(0.75)} ${mix(0)}`)] };
      timing = 'ease-out';
      break;
    case 'edge':
      frames = { '0%, 100%': [shadow(`inset ${LINE(4)} 0 0 ${mix(15)}`)], '50%': [shadow(`inset ${LINE(4)} 0 0 ${mix(100 * s)}`)] };
      break;
    case 'flash':
      beat(text ? (k) => ink(100 * s * k) : (k) => shadow(fill(45 * s * k)), [['10%', 1], ['20%', 0], ['30%', 1]], '0%, 40%, 100%');
      duration = 4;
      break;
    case 'heartbeat':
      beat(text ? (k) => ink(100 * s * k) : (k) => shadow(fill(40 * s * k)), [['8%', 1], ['16%', 0.15], ['24%', 0.7]], '0%, 40%, 100%');
      duration = 3;
      break;
    case 'sweep':
      moving.push(`background-image: linear-gradient(90deg, transparent, ${mix(55 * s)}, transparent)`, 'background-size: 60% 100%', 'background-repeat: no-repeat');
      frames = { '0%': ['background-position: -150% 0'], '100%': ['background-position: 250% 0'] };
      duration = 5;
      break;
    case 'shimmer':
      moving.push(`background-image: linear-gradient(110deg, transparent 40%, ${mix(60 * s)} 50%, transparent 60%)`, 'background-size: 200% 100%', 'background-repeat: no-repeat');
      frames = { '0%': ['background-position: 120% 0'], '100%': ['background-position: -20% 0'] };
      duration = 3;
      break;
    case 'fill':
      moving.push(`background-image: linear-gradient(90deg, ${mix(35 * s)}, ${mix(35 * s)})`, 'background-repeat: no-repeat');
      frames = { '0%': ['background-size: 0% 100%'], '85%, 100%': ['background-size: 100% 100%'] };
      duration = 6;
      break;
    case 'stripes':
      moving.push(`background-image: repeating-linear-gradient(135deg, ${mix(30 * s)} 0, ${mix(30 * s)} ${SPACE(1)}, transparent ${SPACE(1)}, transparent ${SPACE(2)})`, `background-size: ${SPACE(2.8284)} 100%`);
      frames = { '0%': ['background-position: 0 0'], '100%': [`background-position: ${SPACE(2.8284)} 0`] };
      duration = 1.5; timing = 'linear';
      break;
    case 'shake': {
      const a = SPACE(0.6 * s);
      frames = { '0%, 84%, 100%': ['transform: translateX(0)'], '87%, 93%': [`transform: translateX(calc(${a} * -1))`], '90%, 96%': [`transform: translateX(${a})`] };
      duration = 6;
      break;
    }
    case 'bob':
      frames = { '0%, 100%': ['transform: translateY(0)'], '50%': [`transform: translateY(calc(${SPACE(0.4 * s)} * -1))`] };
      break;
    case 'underline':
      moving.push('text-decoration-line: underline', `text-decoration-thickness: ${LINE(2)}`, `text-underline-offset: ${LINE(3)}`);
      frames = { '0%, 100%': [`text-decoration-color: ${mix(0)}`], '50%': [`text-decoration-color: ${mix(100 * s)}`] };
      duration = 3;
      break;
    default:
  }
  return { still, moving, frames, duration, timing };
}

const rule = (selector: string, decls: string[]) => (decls.length ? `${selector} { ${decls.join('; ')}; }` : '');

/**
 * One preset on one selector. `name` is the keyframes name. With `play` off only the still look is written (a resting
 * badge). Motion sits inside `prefers-reduced-motion: no-preference` and is switched off again under the framework's
 * own reduced-motion mark; a moving preset then keeps a soft still tint of its colour so the status still reads.
 */
export function presetCss(p: Preset, selector: string, name: string, play = true): string {
  const d = draw(p);
  const out = [rule(selector, d.still)];
  const moves = play && Object.keys(d.frames).length > 0;
  if (!moves) return out.filter(Boolean).join('\n');
  const direction = p.direction === 'normal' ? '' : ` ${p.direction}`;
  const dur = `calc(var(--fx-anim-sweep-dur) * ${n((d.duration * 100) / p.speed)})`;
  const keyframes = `@keyframes ${name} { ${Object.entries(d.frames).map(([at, decls]) => `${at} { ${decls.join('; ')}; }`).join(' ')} }`;
  out.push(`@media (prefers-reduced-motion: no-preference) {\n${rule(selector, [...d.moving, `animation: ${name} ${dur} ${d.timing} infinite${direction}`])}\n${keyframes}\n}`);
  const off = d.moving.filter((x) => x.startsWith('background-image:') || x.startsWith('text-decoration-line:')).map((x) => `${x.split(':')[0]}: none`);
  out.push(rule(`[data-fx-motion='reduced'] ${selector}`, ['animation: none', ...off]));
  if (p.target === 'row' && !d.still.some((x) => x.startsWith('box-shadow:'))) {
    const tint = `box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--fx-${p.tone}) 10%, transparent)`;
    out.push(`@media (prefers-reduced-motion: reduce) {\n${rule(selector, [tint])}\n}`, rule(`[data-fx-motion='reduced'] ${selector}`, [tint]));
  }
  return out.filter(Boolean).join('\n');
}

const PREFIX = 'axp-status-styles';

/** The whole stylesheet for a config: one block per styled status, plus the badge-pack switch (animated or still). */
export function buildCss(cfg: Config, presets: Preset[]): string {
  if (!cfg.enabled) return '';
  const byId = new Map(presets.map((p) => [p.id, p]));
  const out: string[] = [`/* status-styles@1: generated from the status → style map; every value is a theme token */`];
  for (const [id, st] of Object.entries(cfg.statuses)) {
    if (!isStatusId(id)) continue;
    const row = cfg.rows ? byId.get(st.preset) : undefined;
    if (row) out.push(presetCss(row, rowSelector(id), `${PREFIX}-row-${id}`));
    const badge = cfg.badges ? byId.get(st.badgePreset) : undefined;
    if (badge) out.push(presetCss(badge, badgeSelector(id), `${PREFIX}-badge-${id}`, st.animated));
  }
  if (cfg.badges) {
    const moving = animatedStatuses(cfg).map((id) => `[data-status="${id}"]`);
    out.push(':where([data-status]) { border-radius: var(--fx-radius-md); }', '[data-status] [data-badge-animated] { display: none; }');
    if (moving.length) {
      const is = `:is(${moving.join(', ')})`;
      out.push(`@media (prefers-reduced-motion: no-preference) {\n${is} [data-badge-animated] { display: revert; }\n${is} [data-badge-static] { display: none; }\n}`);
      out.push(`[data-fx-motion='reduced'] ${is} [data-badge-animated] { display: none; }`, `[data-fx-motion='reduced'] ${is} [data-badge-static] { display: revert; }`);
    }
  }
  return out.filter(Boolean).join('\n');
}

/** Every preset on its own preview mark, for the library and the preset maker (plays whatever the config says). */
export function previewCss(presets: Preset[]): string {
  return presets.map((p) => presetCss(p, previewSelector(p.id), `${PREFIX}-preview-${p.id}`)).filter(Boolean).join('\n');
}
