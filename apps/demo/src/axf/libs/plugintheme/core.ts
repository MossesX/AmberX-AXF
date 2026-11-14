/*
 * Plugin theme override (web, Oct 28 2026; refactor-all s72–s75, Opus). Pure: no DOM, no React.
 *
 * Every plugin UI can carry its own theme override on top of the app's theme (the axHub appearance document, the
 * active colour / style / behaviour themes and the app-wide look@1 sliders stay the base). The override holds only
 * the tokens someone changed; everything else is inherited, so a theme swap still moves every token that isn't
 * overridden.
 *
 *   setting  axf.plugin.<pluginId>.look = { on: boolean, tokens: { "--fx-<token>": "<css value>" } }
 *
 * Scope: every plugin UI root carries `data-axf-plugin="<pluginId>"` (views, dialogs, window / tab-group tabs, its
 * settings tab, settings page mode). `pluginThemeCss` compiles every override that is on into one stylesheet:
 * `[data-axf-plugin="<id>"]{--fx-…:…}`, so the variables cascade into that plugin's UI only.
 *
 * Not a contract: Brett skipped the Fable plugin-theme@1 contract / scoped engine / fixture steps. This shape is kept
 * small and documented (_claude/memory/docs/plugin-theme-override.md) so a later Fable contract can adopt it as is.
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { colorThemeVars, styleThemeVars, type ColorThemeData, type StyleThemeData } from '../../core';

export const LIBRARY_ID = 'ai.amberx.axf.plugintheme';
/** The setting holding one plugin's override. */
export const PLUGIN_LOOK_KEY = (pluginId: string) => `axf.plugin.${pluginId}.look`;
/** Counter that is 1 while a plugin's override is on (check marks in menus). */
export const PLUGIN_LOOK_COUNTER = (pluginId: string) => `plugin-theme.on:${pluginId}`;
/** Attribute every plugin UI root carries. */
export const PLUGIN_ATTR = 'data-axf-plugin';
/** Attribute of the override editor itself: it always draws with the app's theme, so a bad override can be undone. */
export const EDITOR_ATTR = 'data-axf-plugin-editor';
/** Prefix of the variables that capture the app's own values (for the editor's escape hatch). */
const BASE_PREFIX = 'axfpt-base';
/** Largest stored value (characters) and largest number of tokens a stored override keeps. */
export const VALUE_MAX = 160;

export type PluginThemeGroup = 'layout' | 'colour' | 'style' | 'animation';
export type PluginThemeKind = 'length' | 'number' | 'time' | 'colour' | 'choice';

export interface PluginThemeToken {
  /** the CSS variable, e.g. --fx-space */
  name: string;
  label: string;
  group: PluginThemeGroup;
  kind: PluginThemeKind;
  min?: number;
  max?: number;
  step?: number;
  /** unit stored after a number (px, ms, em; '' = unitless) */
  unit?: string;
  /** choices (kind `choice`; a colour token also offers the theme's own colours) */
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface PluginLook {
  on: boolean;
  tokens: Record<string, string>;
}

export const PLUGIN_THEME_GROUPS: { id: PluginThemeGroup; label: string; icon: string; hint: string }[] = [
  { id: 'layout', label: 'Layout', icon: 'layout', hint: 'Spacing, padding and row heights.' },
  { id: 'colour', label: 'Colour', icon: 'palette', hint: 'Every colour of the colour theme.' },
  { id: 'style', label: 'Style', icon: 'type', hint: 'Fonts, text, corners, borders, shadows, blur and transparency.' },
  { id: 'animation', label: 'Animation', icon: 'zap', hint: 'How long and how things move.' },
];

const COLOURS: [string, string][] = [
  ['bg', 'Page background'], ['surface', 'Surface'], ['surface2', 'Surface 2'], ['surface3', 'Surface 3'], ['text', 'Text'], ['muted', 'Muted text'],
  ['border', 'Border'], ['accent', 'Accent'], ['accent-text', 'Text on accent'], ['accent-soft', 'Soft accent'], ['danger', 'Danger'], ['success', 'Success'],
  ['warning', 'Warning'], ['info', 'Info'], ['focus', 'Focus ring'], ['shadow', 'Shadow colour'],
];
/** A colour token may point at another theme colour (`var(--fx-accent)`), so it follows a colour-theme swap. */
export const COLOUR_REFS = COLOURS.map(([id, label]) => ({ value: `var(--fx-${id})`, label: `Theme: ${label}` }));
const ref = (name: string) => `var(${name})`;
const len = (name: string, label: string, group: PluginThemeGroup, min: number, max: number, step = 1, hint?: string): PluginThemeToken =>
  ({ name, label, group, kind: 'length', min, max, step, unit: 'px', ...(hint ? { hint } : {}) });
const opacity = (n: string, label: string): PluginThemeToken => ({ name: `--fx-opacity-${n}`, label, group: 'style', kind: 'number', min: 0, max: 1, step: 0.01, unit: '' });

/** The registry (open list: add tokens here; names are stable keys in stored overrides). */
export const PLUGIN_THEME_TOKENS: PluginThemeToken[] = [
  // layout
  len('--fx-space', 'Space unit', 'layout', 0, 32, 0.5, 'The base spacing unit. Card padding and tab padding are separate tokens.'),
  len('--fx-card-pad', 'Card padding', 'layout', 0, 64),
  len('--fx-tab-py', 'Tab padding (vertical)', 'layout', 0, 24),
  len('--fx-tab-px', 'Tab padding (horizontal)', 'layout', 0, 48),
  len('--fx-row-h', 'Row height', 'layout', 16, 72, 1, 'Height of buttons, fields and rows.'),
  // colour
  ...COLOURS.map(([id, label]): PluginThemeToken => ({ name: `--fx-${id}`, label, group: 'colour', kind: 'colour', options: COLOUR_REFS.filter((o) => o.value !== ref(`--fx-${id}`)) })),
  // style
  { name: '--fx-font', label: 'Font', group: 'style', kind: 'choice', options: [{ value: ref('--fx-font-display'), label: 'The theme’s display font' }, { value: ref('--fx-font-mono'), label: 'The theme’s monospace font' }, { value: 'system-ui, sans-serif', label: 'System' }, { value: 'Georgia, serif', label: 'Serif' }, { value: 'ui-rounded, system-ui, sans-serif', label: 'Rounded' }] },
  { name: '--fx-font-display', label: 'Display font', group: 'style', kind: 'choice', options: [{ value: ref('--fx-font'), label: 'The theme’s body font' }, { value: ref('--fx-font-mono'), label: 'The theme’s monospace font' }, { value: 'system-ui, sans-serif', label: 'System' }, { value: 'Georgia, serif', label: 'Serif' }] },
  { name: '--fx-font-mono', label: 'Monospace font', group: 'style', kind: 'choice', options: [{ value: 'ui-monospace, SFMono-Regular, Menlo, monospace', label: 'System monospace' }, { value: '"JetBrains Mono", ui-monospace, monospace', label: 'JetBrains Mono' }, { value: '"Fira Code", ui-monospace, monospace', label: 'Fira Code' }] },
  len('--fx-font-size', 'Text size', 'style', 9, 28, 0.5),
  { name: '--fx-heading-weight', label: 'Heading weight', group: 'style', kind: 'number', min: 300, max: 900, step: 100, unit: '' },
  { name: '--fx-tracking', label: 'Heading letter spacing', group: 'style', kind: 'number', min: -0.05, max: 0.2, step: 0.005, unit: 'em' },
  len('--fx-radius-sm', 'Corner radius (small)', 'style', 0, 32),
  len('--fx-radius-md', 'Corner radius (medium)', 'style', 0, 40),
  len('--fx-radius-lg', 'Corner radius (large)', 'style', 0, 48),
  len('--fx-border-w', 'Border width', 'style', 0, 6, 0.5),
  ...(['sm', 'md', 'lg'] as const).map((s): PluginThemeToken => ({ name: `--fx-shadow-${s}`, label: `Shadow (${s === 'sm' ? 'small' : s === 'md' ? 'medium' : 'large'})`, group: 'style', kind: 'choice',
    options: [{ value: 'none', label: 'None' }, ...(['sm', 'md', 'lg'] as const).filter((o) => o !== s).map((o) => ({ value: ref(`--fx-shadow-${o}`), label: `The theme’s ${o === 'sm' ? 'small' : o === 'md' ? 'medium' : 'large'} shadow` }))] })),
  len('--fx-blur', 'Glass blur', 'style', 0, 40),
  opacity('disabled', 'Disabled opacity'), opacity('muted', 'Muted opacity'), opacity('hover', 'Hover tint'), opacity('tint', 'Tint strength'), opacity('scrim', 'Scrim (behind dialogs)'), opacity('glass', 'Glass opacity'),
  // animation
  { name: '--fx-motion', label: 'Animation duration', group: 'animation', kind: 'time', min: 0, max: 1200, step: 10, unit: 'ms', hint: '0 = no animation.' },
  { name: '--fx-ease', label: 'Easing', group: 'animation', kind: 'choice', options: [{ value: 'cubic-bezier(0.2, 0, 0, 1)', label: 'Standard' }, { value: 'cubic-bezier(0.3, 0, 0, 1.2)', label: 'Emphasized' }, { value: 'linear', label: 'Linear' }, { value: 'cubic-bezier(0.34, 1.56, 0.64, 1)', label: 'Spring' }, { value: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)', label: 'Bounce' }] },
];

const BY_NAME = new Map(PLUGIN_THEME_TOKENS.map((t) => [t.name, t]));
export const pluginThemeToken = (name: string): PluginThemeToken | undefined => BY_NAME.get(name);
export const tokensIn = (group: PluginThemeGroup): PluginThemeToken[] => PLUGIN_THEME_TOKENS.filter((t) => t.group === group);

/** Plugin ids that may name a scope (they go into an attribute selector). */
export const validPluginId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id);

/* ---------------- values ---------------- */

const SAFE = /^[A-Za-z0-9 #%().,_\-+*/"'"]+$/;
const COLOUR_LITERAL = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%/+-]+\)|color-mix\([A-Za-z0-9 #%().,_\-]+\)|transparent)$/;
const VAR_REF = /^var\(--fx-[a-z0-9-]+\)$/;

/** A number + unit → the stored string (clamped and snapped to the token's range). */
export function numberValue(t: PluginThemeToken, n: number): string {
  const lo = t.min ?? n;
  const hi = t.max ?? n;
  const step = t.step ?? 1;
  const snapped = Math.round(Math.min(hi, Math.max(lo, n)) / step) * step;
  const clean = Math.round(snapped * 10000) / 10000;
  return `${clean}${t.unit ?? ''}`;
}

/** The number in a stored numeric value ("12px" → 12), or null. */
export function numberOf(v: string | undefined): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(-?\d+(?:\.\d+)?)(px|ms|em|s)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 's' ? n * 1000 : n;
}

/** One value checked against its token: undefined = dropped (unknown token, unsafe text, out of the token's kind). */
export function normalizeTokenValue(name: string, v: unknown): string | undefined {
  const t = BY_NAME.get(name);
  if (!t || typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s || s.length > VALUE_MAX || !SAFE.test(s) || /url\(|expression|@|\\|;|[{}<>]/i.test(s)) return undefined;
  switch (t.kind) {
    case 'length': case 'number': case 'time': {
      if (VAR_REF.test(s) || s.startsWith('calc(')) return s;
      const n = numberOf(s);
      return n === null ? undefined : numberValue(t, n);
    }
    case 'colour':
      return VAR_REF.test(s) && s !== ref(name) ? s : COLOUR_LITERAL.test(s) ? s : undefined;
    default:
      return s; // a choice may also hold a free value from the JSON view (still checked as safe text above)
  }
}

/** Stored value → a checked override (unknown tokens and bad values dropped). Never throws. */
export function normalizePluginLook(raw: unknown): PluginLook {
  const out: PluginLook = { on: false, tokens: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  out.on = o.on === true;
  if (o.tokens && typeof o.tokens === 'object' && !Array.isArray(o.tokens)) {
    for (const [k, v] of Object.entries(o.tokens as Record<string, unknown>)) {
      const n = normalizeTokenValue(k, v);
      if (n !== undefined) out.tokens[k] = n;
    }
  }
  return out;
}

/** What to store: null when there is nothing to keep (off and no tokens), so a reset leaves no setting behind. */
export function storedLook(look: PluginLook): PluginLook | null {
  const n = normalizePluginLook(look);
  return !n.on && !Object.keys(n.tokens).length ? null : n;
}

/** Set (or, with null, reset) one token. Returns a new override. */
export function setToken(look: PluginLook, name: string, v: string | null): PluginLook {
  const next = { on: look.on, tokens: { ...look.tokens } };
  const n = v === null ? undefined : normalizeTokenValue(name, v);
  if (n === undefined) delete next.tokens[name]; else next.tokens[name] = n;
  return next;
}

/** Reset every token of a group (or all with no group). */
export function resetTokens(look: PluginLook, group?: PluginThemeGroup): PluginLook {
  if (!group) return { on: look.on, tokens: {} };
  const tokens = { ...look.tokens };
  for (const t of tokensIn(group)) delete tokens[t.name];
  return { on: look.on, tokens };
}

/** Merge tokens in (copy from another plugin or a theme); `replace` drops what was there first. Bad values are dropped. */
export function mergeTokens(look: PluginLook, tokens: Record<string, unknown>, replace = false): PluginLook {
  let next: PluginLook = replace ? { on: look.on, tokens: {} } : { on: look.on, tokens: { ...look.tokens } };
  for (const [k, v] of Object.entries(tokens)) if (typeof v === 'string') next = setToken(next, k, v);
  return next;
}

/** How many tokens are overridden, overall or in a group. */
export function changedCount(look: PluginLook, group?: PluginThemeGroup): number {
  return Object.keys(look.tokens).filter((k) => !group || BY_NAME.get(k)?.group === group).length;
}

/** Tri-state of a group in the token tree: every token overridden, some, or none. */
export function groupState(look: PluginLook, group: PluginThemeGroup): 'all' | 'some' | 'none' {
  const n = changedCount(look, group);
  return n === 0 ? 'none' : n === tokensIn(group).length ? 'all' : 'some';
}

/** Tokens matching a search (label, name or group), in registry order. Empty query = all. */
export function searchTokens(query: string, group?: PluginThemeGroup): PluginThemeToken[] {
  const q = query.trim().toLowerCase();
  return PLUGIN_THEME_TOKENS.filter((t) => (!group || t.group === group) && (!q || `${t.label} ${t.name} ${t.group}`.toLowerCase().includes(q)));
}

/* ---------------- JSON view ---------------- */

/** The override as editable JSON text (the stored shape). */
export const lookJson = (look: PluginLook): string => JSON.stringify({ on: look.on, tokens: look.tokens }, null, 2);

/** Parse the JSON view: a checked override, the tokens that were dropped, or an error. Accepts `{ tokens }` or a bare token map. */
export function parseLookJson(text: string): { look?: PluginLook; dropped: string[]; error?: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { dropped: [], error: `Not JSON: ${(e as Error).message}` }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { dropped: [], error: 'Expected an object: { "on": true, "tokens": { "--fx-…": "…" } }' };
  const o = raw as Record<string, unknown>;
  const wrapped = 'tokens' in o || 'on' in o;
  const tokens = (wrapped ? o.tokens : o) as Record<string, unknown> | undefined;
  const look = normalizePluginLook({ on: wrapped ? o.on : true, tokens });
  const dropped = Object.keys(tokens && typeof tokens === 'object' ? tokens : {}).filter((k) => !(k in look.tokens));
  return { look, dropped };
}

/* ---------------- copy from a theme asset ---------------- */

/** The tokens a colour theme and / or a style theme compile to, limited to the tokens an override can hold. */
export function tokensFromThemes(color?: ColorThemeData | null, style?: StyleThemeData | null): Record<string, string> {
  const vars = { ...(color ? colorThemeVars(color) : {}), ...(style ? styleThemeVars(style) : {}) };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) { const n = normalizeTokenValue(k, v); if (n !== undefined) out[k] = n; }
  return out;
}

/* ---------------- CSS ---------------- */

const attrSel = (id: string) => `[${PLUGIN_ATTR}="${id}"]`;
const baseVar = (name: string) => `--${BASE_PREFIX}-${name.replace(/^--fx-/, '')}`;

/**
 * Every override that is on → one stylesheet. Each plugin's tokens are re-declared on its UI roots; text colour and
 * font follow on the root when those tokens changed (inherited properties, so a `display: contents` root still works).
 * The editor (EDITOR_ATTR) always gets the app's own values back (captured on body), so an unreadable override can be
 * reset. Empty = no overrides on.
 */
export function pluginThemeCss(looks: Record<string, unknown>, opts: { locked?: boolean } = {}): string {
  if (opts.locked) return '';
  const rules: string[] = [];
  const used = new Set<string>();
  for (const [id, raw] of Object.entries(looks)) {
    if (!validPluginId(id)) continue;
    const look = normalizePluginLook(raw);
    const names = Object.keys(look.tokens);
    if (!look.on || !names.length) continue;
    const decl = names.map((n) => `${n}:${look.tokens[n]}`);
    if ('--fx-text' in look.tokens) decl.push(`color:${ref('--fx-text')}`);
    if ('--fx-font' in look.tokens) decl.push(`font-family:${ref('--fx-font')}`);
    if ('--fx-font-size' in look.tokens) decl.push(`font-size:${ref('--fx-font-size')}`);
    rules.push(`${attrSel(id)}{${decl.join(';')}}`);
    names.forEach((n) => used.add(n));
  }
  if (!rules.length) return '';
  const list = [...used].sort();
  // the editor's escape hatch: the app's own values, captured where no plugin override applies
  const capture = `body{${list.map((n) => `${baseVar(n)}:${ref(n)}`).join(';')}}`;
  const editor = `[${EDITOR_ATTR}]{${list.map((n) => `${n}:${ref(baseVar(n))}`).join(';')};color:${ref('--fx-text')};font-family:${ref('--fx-font')};font-size:${ref('--fx-font-size')}}`;
  // a preview inside the editor carries the plugin's attribute again, so it shows the override (its own declarations win)
  return [capture, ...rules, editor].join('\n');
}
