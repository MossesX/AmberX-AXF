/*
 * Look tokens (look@1, Brett Oct 26 2026). Pure: no DOM, no runtime.
 *
 * One open registry of look, design, behaviour and tone tokens, each with a level (Simple / Basic / Pro / Advanced),
 * a category, and where it applies (`app` = the whole page, `banner` = every live banner). A stored set of values
 * holds only the tokens someone changed; everything else is inherited from the active theme, so a value is an
 * override on top of the theme, never a copy of it. Reset = an empty set.
 *
 * Values compile to CSS that layers on the inherited theme without copying it: the theme's own values are captured
 * on an ancestor (`base` selector: `--<p>-space: var(--fx-space)` …) and the scope re-declares the theme variables from
 * them (`--fx-space: calc(var(--<p>-space) * k)`), so a theme swap moves everything along. Compact at 0 leaves no space
 * at all. Behaviour tokens (`pref`) compile to nothing: a host reads them as the fallback under its own choices
 * (Banner settings: a banner's own tab wins, then Apply to all, then the default).
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export type LookLevel = 'simple' | 'basic' | 'pro' | 'advanced';
export type LookScope = 'app' | 'banner';
export type LookValue = number | string | boolean;
export type LookValues = Record<string, LookValue>;
export type LookKind = 'slider' | 'choice' | 'switch';

export interface LookToken {
  id: string;
  label: string;
  category: string;
  level: LookLevel;
  kind: LookKind;
  /** where it applies */
  scopes: LookScope[];
  /** value the theme gives (shown while unchanged; storing it is the same as not storing it) */
  inherit: LookValue;
  min?: number;
  max?: number;
  step?: number;
  /** shown after a slider value */
  unit?: string;
  options?: { value: string; label: string }[];
  hint?: string;
  /** behaviour token: no CSS; the host reads it as a fallback for this preference */
  pref?: string;
}

export const LOOK_LEVELS: readonly LookLevel[] = ['simple', 'basic', 'pro', 'advanced'];
export const LOOK_LEVEL_LABEL: Record<LookLevel, string> = { simple: 'Simple', basic: 'Basic', pro: 'Pro', advanced: 'Advanced' };
export const LOOK_LEVEL_HINT: Record<LookLevel, string> = {
  simple: 'A few big choices.',
  basic: 'The everyday look and behaviour.',
  pro: 'Fine control over spacing, text, borders, colour and motion.',
  advanced: 'Every token there is.',
};
export const lookLevelRank = (l: LookLevel): number => LOOK_LEVELS.indexOf(l);

export interface LookCategory { id: string; label: string; icon: string }
/** Open list: a token naming a category not here gets one by its id. */
export const LOOK_CATEGORIES: LookCategory[] = [
  { id: 'size', label: 'Size and spacing', icon: 'maximize' },
  { id: 'text', label: 'Text', icon: 'type' },
  { id: 'shape', label: 'Shape and borders', icon: 'square' },
  { id: 'tone', label: 'Colour and tone', icon: 'palette' },
  { id: 'surface', label: 'Surface and depth', icon: 'layers' },
  { id: 'icons', label: 'Icons', icon: 'star' },
  { id: 'motion', label: 'Motion', icon: 'zap' },
  { id: 'behaviour', label: 'Behaviour', icon: 'settings' },
];

const COLOR_TOKENS = ['accent', 'info', 'success', 'warning', 'danger', 'text', 'muted', 'surface', 'surface2', 'surface3', 'bg', 'border'];
const colorOpts = (first: string) => [{ value: '', label: first }, ...COLOR_TOKENS.map((c) => ({ value: c, label: c[0]!.toUpperCase() + c.slice(1).replace(/(\d)/, ' $1') }))];
const BOTH: LookScope[] = ['app', 'banner'];
const BANNER: LookScope[] = ['banner'];

/** The registry. Add tokens here (open list); ids are stable keys in stored values. */
export const LOOK_TOKENS: LookToken[] = [
  // size and spacing
  { id: 'compact', label: 'Compact', category: 'size', level: 'simple', kind: 'slider', scopes: BOTH, inherit: 100, min: 0, max: 150, step: 5, unit: '%', hint: 'All the room between and around things. 0 = no space at all; 100 = the theme.' },
  { id: 'rowHeight', label: 'Row height', category: 'size', level: 'basic', kind: 'slider', scopes: BOTH, inherit: 100, min: 50, max: 160, step: 5, unit: '%', hint: 'Height of buttons, fields and rows.' },
  { id: 'cardPad', label: 'Padding inside cards', category: 'size', level: 'pro', kind: 'slider', scopes: BOTH, inherit: 100, min: 0, max: 250, step: 5, unit: '%' },
  { id: 'gap', label: 'Space between banners', category: 'size', level: 'pro', kind: 'slider', scopes: BANNER, inherit: 100, min: 0, max: 300, step: 10, unit: '%' },
  { id: 'maxRows', label: 'Maximum height', category: 'size', level: 'pro', kind: 'choice', scopes: BANNER, inherit: '0', pref: 'maxRows', options: [{ value: '0', label: 'Their own' }, ...[4, 6, 8, 12, 18].map((n) => ({ value: String(n), label: `${n} rows (scrolls past that)` }))] },
  { id: 'density', label: 'Density', category: 'size', level: 'basic', kind: 'choice', scopes: BANNER, inherit: 'regular', pref: 'density', options: [{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }, { value: 'roomy', label: 'Roomy' }] },
  // text
  { id: 'textSize', label: 'Text size', category: 'text', level: 'simple', kind: 'slider', scopes: BOTH, inherit: 100, min: 60, max: 160, step: 5, unit: '%' },
  { id: 'textWeight', label: 'Text weight', category: 'text', level: 'basic', kind: 'choice', scopes: BOTH, inherit: '', options: [{ value: '', label: 'The theme’s' }, { value: '300', label: 'Light' }, { value: '400', label: 'Regular' }, { value: '500', label: 'Medium' }, { value: '600', label: 'Semibold' }, { value: '700', label: 'Bold' }] },
  { id: 'lineHeight', label: 'Line height', category: 'text', level: 'pro', kind: 'slider', scopes: BOTH, inherit: 0, min: 0, max: 200, step: 5, unit: '%', hint: '0 = the theme’s; anything else is at least 100%.' },
  { id: 'letterSpacing', label: 'Letter spacing', category: 'text', level: 'pro', kind: 'slider', scopes: BOTH, inherit: 0, min: -5, max: 10, step: 1, unit: '/100 em' },
  { id: 'textCase', label: 'Letter case', category: 'text', level: 'advanced', kind: 'choice', scopes: BOTH, inherit: '', options: [{ value: '', label: 'As written' }, { value: 'uppercase', label: 'UPPERCASE' }, { value: 'lowercase', label: 'lowercase' }, { value: 'capitalize', label: 'Capitalized' }] },
  { id: 'fontFamily', label: 'Font', category: 'text', level: 'advanced', kind: 'choice', scopes: BOTH, inherit: '', options: [{ value: '', label: 'The theme’s' }, { value: 'display', label: 'The theme’s display font' }, { value: 'mono', label: 'The theme’s monospace font' }, { value: 'system', label: 'System' }, { value: 'serif', label: 'Serif' }] },
  { id: 'italic', label: 'Italic', category: 'text', level: 'advanced', kind: 'switch', scopes: BOTH, inherit: false },
  // shape and borders
  { id: 'corners', label: 'Corner roundness', category: 'shape', level: 'basic', kind: 'slider', scopes: BOTH, inherit: 100, min: 0, max: 300, step: 10, unit: '%' },
  { id: 'borderWidth', label: 'Border width', category: 'shape', level: 'pro', kind: 'slider', scopes: BOTH, inherit: 100, min: 0, max: 400, step: 25, unit: '%' },
  { id: 'borderStyle', label: 'Border style', category: 'shape', level: 'advanced', kind: 'choice', scopes: BANNER, inherit: '', options: [{ value: '', label: 'Their own' }, { value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'none', label: 'None' }] },
  // colour and tone
  { id: 'tone', label: 'Colour', category: 'tone', level: 'simple', kind: 'choice', scopes: BANNER, inherit: 'own', pref: 'tone', options: [{ value: 'own', label: 'Their own colour' }, { value: 'accent', label: 'Accent' }, { value: 'info', label: 'Info (blue)' }, { value: 'success', label: 'Success (green)' }, { value: 'warning', label: 'Warning (amber)' }, { value: 'danger', label: 'Danger (red)' }, { value: 'neutral', label: 'Neutral (grey)' }] },
  { id: 'accent', label: 'Accent colour', category: 'tone', level: 'pro', kind: 'choice', scopes: BOTH, inherit: '', options: colorOpts('The theme’s accent') },
  { id: 'textColour', label: 'Text colour', category: 'tone', level: 'advanced', kind: 'choice', scopes: BANNER, inherit: '', options: colorOpts('Their own') },
  { id: 'background', label: 'Background', category: 'tone', level: 'advanced', kind: 'choice', scopes: BANNER, inherit: '', options: colorOpts('Their own') },
  { id: 'borderColour', label: 'Border colour', category: 'tone', level: 'advanced', kind: 'choice', scopes: BANNER, inherit: '', options: colorOpts('Their own') },
  // surface and depth
  { id: 'opacity', label: 'Opacity', category: 'surface', level: 'basic', kind: 'slider', scopes: BANNER, inherit: 100, min: 30, max: 100, step: 5, unit: '%' },
  { id: 'shadow', label: 'Shadow', category: 'surface', level: 'pro', kind: 'choice', scopes: BOTH, inherit: '', options: [{ value: '', label: 'The theme’s' }, { value: 'none', label: 'None' }, { value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }] },
  { id: 'glass', label: 'Glass blur', category: 'surface', level: 'advanced', kind: 'slider', scopes: BOTH, inherit: 100, min: 0, max: 300, step: 10, unit: '%' },
  // icons
  { id: 'icon', label: 'Show icons', category: 'icons', level: 'simple', kind: 'switch', scopes: BANNER, inherit: true, pref: 'icon' },
  { id: 'iconSize', label: 'Icon size', category: 'icons', level: 'pro', kind: 'slider', scopes: BOTH, inherit: 100, min: 50, max: 200, step: 10, unit: '%' },
  { id: 'workIcon', label: 'Icon while working', category: 'icons', level: 'pro', kind: 'choice', scopes: BANNER, inherit: '', pref: 'workIcon', options: [{ value: '', label: 'Their own' }, ...['refresh', 'zap', 'hammer', 'sparkles', 'rocket', 'branch', 'upload', 'download', 'clock', 'cloud', 'terminal', 'star', 'sun', 'shuffle'].map((i) => ({ value: i, label: i[0]!.toUpperCase() + i.slice(1) }))] },
  { id: 'workAnim', label: 'Working animation', category: 'icons', level: 'pro', kind: 'choice', scopes: BANNER, inherit: '', pref: 'workAnim', options: [{ value: '', label: 'Their own' }, { value: 'spin', label: 'Spin' }, { value: 'pulse', label: 'Pulse' }, { value: 'bounce', label: 'Bounce' }, { value: 'blink', label: 'Blink' }, { value: 'off', label: 'Still' }] },
  // motion
  { id: 'animations', label: 'Animations', category: 'motion', level: 'basic', kind: 'switch', scopes: BOTH, inherit: true },
  { id: 'motionSpeed', label: 'Animation speed', category: 'motion', level: 'pro', kind: 'slider', scopes: BOTH, inherit: 100, min: 25, max: 300, step: 25, unit: '%' },
  { id: 'entrance', label: 'How they appear', category: 'motion', level: 'advanced', kind: 'choice', scopes: BANNER, inherit: '', options: [{ value: '', label: 'Their own' }, { value: 'fade', label: 'Fade in' }, { value: 'slide', label: 'Slide down' }, { value: 'pop', label: 'Pop' }] },
  // behaviour
  { id: 'launch', label: 'When they appear', category: 'behaviour', level: 'basic', kind: 'choice', scopes: BANNER, inherit: 'expanded', pref: 'launch', options: [{ value: 'expanded', label: 'Open, with their list' }, { value: 'minimized', label: 'Minimized to one line' }] },
  { id: 'autoHide', label: 'Hide themselves', category: 'behaviour', level: 'basic', kind: 'choice', scopes: BANNER, inherit: '0', pref: 'autoHide', options: [0, 10, 30, 60, 300, 900].map((s) => ({ value: String(s), label: s === 0 ? 'Never' : s < 60 ? `After ${s} s with nothing new` : `After ${s / 60} min with nothing new` })) },
  { id: 'hideInHost', label: 'Hide them inside a host app (Patches)', category: 'behaviour', level: 'advanced', kind: 'switch', scopes: BANNER, inherit: false, pref: 'hideInHost' },
];

const BY_ID = new Map(LOOK_TOKENS.map((t) => [t.id, t]));
export const lookToken = (id: string): LookToken | undefined => BY_ID.get(id);
export const lookCategory = (id: string): LookCategory => LOOK_CATEGORIES.find((c) => c.id === id) ?? { id, label: id[0]!.toUpperCase() + id.slice(1), icon: 'settings' };

/** Tokens shown at a level (that level and every level below it), for a scope. */
export function lookTokensAt(level: LookLevel, scope: LookScope): LookToken[] {
  const r = lookLevelRank(level);
  return LOOK_TOKENS.filter((t) => t.scopes.includes(scope) && lookLevelRank(t.level) <= r);
}

/** One value checked against its token (wrong type, out of range or unknown option = undefined). */
export function normalizeLookValue(id: string, v: unknown): LookValue | undefined {
  const t = BY_ID.get(id);
  if (!t) return undefined;
  if (t.kind === 'switch') return typeof v === 'boolean' ? v : undefined;
  if (t.kind === 'slider') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    return Math.min(t.max ?? v, Math.max(t.min ?? v, v));
  }
  return typeof v === 'string' && (t.options ?? []).some((o) => o.value === v) ? v : undefined;
}

/** Stored values → only known tokens, checked, and only the ones that differ from what the theme gives. */
export function normalizeLook(raw: unknown): LookValues {
  const out: LookValues = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = normalizeLookValue(k, v);
    if (n !== undefined && n !== BY_ID.get(k)!.inherit) out[k] = n;
  }
  return out;
}

/** Set (or, with null / the inherited value, clear) one token. Returns the new value set; the input is not changed. */
export function setLookValue(values: LookValues, id: string, v: LookValue | null): LookValues {
  const next = { ...normalizeLook(values) };
  const n = v === null ? undefined : normalizeLookValue(id, v);
  if (n === undefined || n === BY_ID.get(id)?.inherit) delete next[id]; else next[id] = n;
  return next;
}

/** The value a control shows: the stored one, else what the theme gives. */
export const lookValue = (values: LookValues, id: string): LookValue => (id in values ? values[id]! : BY_ID.get(id)?.inherit ?? '');

/** How many tokens are changed, overall or in a category. */
export function lookChanged(values: LookValues, category?: string): number {
  return Object.keys(normalizeLook(values)).filter((k) => !category || BY_ID.get(k)?.category === category).length;
}

/** Behaviour fallbacks for a host: { prefKey: value } from the `pref` tokens that are set. */
export function lookPrefs(values: LookValues): Record<string, LookValue> {
  const out: Record<string, LookValue> = {};
  for (const [k, v] of Object.entries(normalizeLook(values))) { const p = BY_ID.get(k)?.pref; if (p) out[p] = v; }
  return out;
}

/* ---------------- CSS ---------------- */

/** Theme variables a scope re-declares from the captured base (the base selector captures each one). */
const BASE_VARS = ['space', 'card-pad', 'tab-py', 'tab-px', 'row-h', 'font-size', 'radius-sm', 'radius-md', 'radius-lg', 'border-w', 'blur', 'motion'];
const pct = (v: LookValue) => Number(v) / 100;
/** Lowest line height a look can set (%): below it lines of text overlap. */
export const LINE_HEIGHT_MIN = 100;
/** Widest letter spacing a look can set (/100 em): past it words fall apart. */
export const LETTER_SPACING_MAX = 10;
const n4 = (x: number) => String(Math.round(x * 10000) / 10000);

/**
 * Values → CSS text. `scope` is the selector whose look changes, `base` an ancestor where the theme's own values are
 * captured, `p` a short prefix for the captured variables (one per layer, so layers stack: the app layer on `body`,
 * the banner layer inside it). Empty values = empty CSS. Theme tokens only; no literal colours or sizes.
 */
export function lookCss(raw: unknown, opts: { scope: string; base: string; p: string; for: LookScope }): string {
  const v = normalizeLook(raw);
  const on = Object.keys(v).filter((k) => BY_ID.get(k)!.scopes.includes(opts.for) && !BY_ID.get(k)!.pref);
  if (!on.length) return '';
  const { scope: S, base: B, p } = opts;
  const b = (name: string) => `var(--${p}-${name})`;
  const decl: string[] = [];
  const kids: string[] = [];
  const rules: string[] = [];
  for (const k of on) {
    const x = v[k]!;
    switch (k) {
      case 'compact': {
        const f = pct(x);
        for (const n of ['space', 'card-pad', 'tab-py', 'tab-px']) decl.push(`--fx-${n}:calc(${b(n)} * ${n4(f)})`);
        if (!('rowHeight' in v)) decl.push(`--fx-row-h:max(1.2em, calc(${b('row-h')} * ${n4(f)}))`);
        break;
      }
      case 'rowHeight': decl.push(`--fx-row-h:max(1.2em, calc(${b('row-h')} * ${n4(pct(x) * ('compact' in v ? pct(v.compact!) : 1))}))`); break;
      case 'cardPad': decl.push(`--fx-card-pad:calc(${b('card-pad')} * ${n4(pct(x) * ('compact' in v ? pct(v.compact!) : 1))})`); break;
      case 'gap': kids.push(`margin-bottom:calc(var(--fx-space) * ${n4(pct(x))}) !important`); break;
      case 'textSize': decl.push(`--fx-font-size:calc(${b('font-size')} * ${n4(pct(x))})`, `font-size:calc(${b('font-size')} * ${n4(pct(x))})`); break;
      case 'textWeight': decl.push(`font-weight:${Number(x)}`); break;
      // 0 = the theme's; anything else never below LINE_HEIGHT_MIN %, so lines can't run into each other
      case 'lineHeight': if (Number(x) > 0) decl.push(`line-height:${n4(Math.max(LINE_HEIGHT_MIN, Number(x)) / 100)}`); break;
      case 'letterSpacing': { const ls = Math.min(LETTER_SPACING_MAX, Number(x)) / 100; decl.push(`letter-spacing:${n4(ls)}em`, `--fx-tracking:${n4(ls)}em`); break; }
      case 'textCase': decl.push(`text-transform:${x}`); break;
      case 'fontFamily': decl.push(`font-family:${x === 'display' ? 'var(--fx-font-display)' : x === 'mono' ? 'var(--fx-font-mono)' : x === 'system' ? 'system-ui, sans-serif' : 'serif'}`); break;
      case 'italic': if (x === true) decl.push('font-style:italic'); break;
      case 'corners': for (const n of ['radius-sm', 'radius-md', 'radius-lg']) decl.push(`--fx-${n}:calc(${b(n)} * ${n4(pct(x))})`); break;
      case 'borderWidth': decl.push(`--fx-border-w:calc(${b('border-w')} * ${n4(pct(x))})`); break;
      case 'borderStyle': kids.push(`border-style:${x} !important`); break;
      case 'accent': decl.push(`--fx-accent:var(--fx-${x})`); break;
      case 'textColour': kids.push(`color:var(--fx-${x}) !important`); break;
      case 'background': kids.push(`background:var(--fx-${x}) !important`); break;
      case 'borderColour': kids.push(`border-color:var(--fx-${x}) !important`); break;
      case 'opacity': decl.push(`opacity:${n4(pct(x))}`); break;
      case 'shadow':
        if (opts.for === 'banner') kids.push(`box-shadow:${x === 'none' ? 'none' : `var(--fx-shadow-${x})`} !important`);
        else for (const n of ['sm', 'md', 'lg']) decl.push(`--fx-shadow-${n}:${x === 'none' ? 'none' : `var(--${p}-shadow-${x})`}`);
        break;
      case 'glass': decl.push(`--fx-blur:calc(${b('blur')} * ${n4(pct(x))})`); if (opts.for === 'banner') kids.push(`backdrop-filter:blur(var(--fx-blur))`); break;
      case 'iconSize': rules.push(`${S} .fx-icon{transform:scale(${n4(pct(x))})}`); break;
      case 'animations': if (x === false) rules.push(`${S},${S} *{animation:none !important;transition:none !important}`); break;
      case 'motionSpeed': decl.push(`--fx-motion:calc(${b('motion')} / ${n4(pct(x))})`); break;
      case 'entrance': rules.push(`${S}{animation:axf-look-${x} var(--fx-motion) ease-out both}`); break;
    }
  }
  const capture = BASE_VARS.map((n) => `--${p}-${n}:var(--fx-${n})`).concat(['sm', 'md', 'lg'].map((n) => `--${p}-shadow-${n}:var(--fx-shadow-${n})`));
  const out = [`${B}{${capture.join(';')}}`];
  if (decl.length) out.push(`${S}{${decl.join(';')}}`);
  if (kids.length) out.push(`${S} > *{${kids.join(';')}}`);
  out.push(...rules);
  if (on.includes('entrance')) {
    out.push('@keyframes axf-look-fade{from{opacity:0}to{opacity:1}}');
    out.push('@keyframes axf-look-slide{from{opacity:0;transform:translateY(calc(var(--fx-space) * -2))}to{opacity:1;transform:none}}');
    out.push('@keyframes axf-look-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}');
  }
  return out.join('\n');
}
