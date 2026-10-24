/**
 * Customize engine — extra editable tokens for every customizable asset type (asset-customize@1).
 *
 * Data-driven from schemas/customize.json (the token list + which elements each type styles) and
 * schemas/icon-sets.json (100 icon sets). Values are saved per slot in setting `axf.custom.<type>`:
 *   { all: boolean (default true), shared: {token: value}, byId: {assetId: {token: value}} }
 * `all` = one set of values for every asset of the type (Settings shows the first asset editable and the
 * rest greyed out); off = each asset keeps its own. The values of the slot's active asset compile to one
 * CSS sheet (`customizeCss`). Every value maps to theme tokens (colour-theme colours, multiples of the style
 * theme's sizes, `--fx-motion`, `--fx-opacity-*`), so swapping a theme still restyles everything.
 *
 * Pure. Android twin deferred (spec/PORTING.md).
 */
import spec from '../../schemas/customize.json';
import iconSpec from '../../schemas/icon-sets.json';

export type CustomValue = string | number | boolean;
export type CustomValues = Record<string, CustomValue>;
export type CustomTokenKind = 'scale' | 'choice' | 'toggle' | 'color' | 'iconset';

export interface CustomTokenSpec {
  key: string;
  label: string;
  group: string;
  kind: CustomTokenKind;
  default: CustomValue;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Only these asset types get the token (absent = every customizable type). */
  types?: string[];
}

export interface CustomTarget {
  /** Selector(s) of the element the type draws (comma list). */
  root: string;
  /** Its items (hover / click / item padding); absent = the root reacts itself. */
  item?: string;
}

export interface IconSet {
  id: string;
  label: string;
  stroke: number;
  cap: 'round' | 'square' | 'butt';
  join: 'round' | 'miter' | 'bevel';
  fill: 'none' | 'tint' | 'accent' | 'solid';
  frame: 'none' | 'circle' | 'rounded' | 'square';
  frameFill: 'none' | 'tint' | 'accent';
  frameRing: boolean;
  scale: number;
  dash: 'none' | 'dash' | 'dot';
  rotate: number;
}

export interface CustomSlot {
  all: boolean;
  shared: CustomValues;
  byId: Record<string, CustomValues>;
}

export const CUSTOM_TOKENS = spec.tokens as CustomTokenSpec[];
export const CUSTOM_TARGETS = spec.targets as Record<string, CustomTarget>;
export const ICON_SETS = iconSpec.sets as IconSet[];
export const ICON_SET_DEFAULT = iconSpec.default;
export const CUSTOM_KEY = (type: string) => `axf.custom.${type}`;
export const CUSTOM_GROUPS = [...new Set(CUSTOM_TOKENS.map((t) => t.group))];

const tokenByKey = new Map(CUSTOM_TOKENS.map((t) => [t.key, t]));
const iconById = new Map(ICON_SETS.map((s) => [s.id, s]));

/** Types that get the extra tokens, in schema order. */
export function customizableTypes(): string[] {
  return Object.keys(CUSTOM_TARGETS);
}

export function customizable(type: string): boolean {
  return type in CUSTOM_TARGETS;
}

/** The tokens a type gets (a token with `types` only for those). */
export function customTokensFor(type: string): CustomTokenSpec[] {
  if (!customizable(type)) return [];
  return CUSTOM_TOKENS.filter((t) => !t.types || t.types.includes(type));
}

export function iconSet(id: unknown): IconSet | undefined {
  return typeof id === 'string' ? iconById.get(id) : undefined;
}

/** One value checked against its token: wrong kind / unknown option = undefined (dropped). Scales clamp and snap. */
export function normalizeCustomValue(key: string, v: unknown): CustomValue | undefined {
  const t = tokenByKey.get(key);
  if (!t) return undefined;
  switch (t.kind) {
    case 'toggle':
      return typeof v === 'boolean' ? v : undefined;
    case 'scale': {
      const n = Number(v);
      if (typeof v === 'boolean' || v === '' || v == null || !Number.isFinite(n)) return undefined;
      const step = t.step ?? 1;
      const lo = t.min ?? 0;
      const hi = t.max ?? 100;
      return Math.min(hi, Math.max(lo, Math.round(n / step) * step));
    }
    case 'iconset':
      return iconById.has(String(v)) && typeof v === 'string' ? v : undefined;
    default:
      return typeof v === 'string' && (t.options ?? []).includes(v) ? v : undefined;
  }
}

/** Known tokens only, each valid, defaults left out (a default is "use the theme"). Tokens the type doesn't get are dropped when `type` is given. */
export function normalizeCustomValues(raw: unknown, type?: string): CustomValues {
  const out: CustomValues = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const allowed = type ? new Set(customTokensFor(type).map((t) => t.key)) : null;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (allowed && !allowed.has(k)) continue;
    const n = normalizeCustomValue(k, v);
    if (n !== undefined && n !== tokenByKey.get(k)!.default) out[k] = n;
  }
  return out;
}

/** A saved slot setting, cleaned: `all` defaults to true; ids are plain strings. */
export function normalizeCustomSlot(raw: unknown, type?: string): CustomSlot {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const byId: Record<string, CustomValues> = {};
  if (r.byId && typeof r.byId === 'object' && !Array.isArray(r.byId)) {
    for (const [id, v] of Object.entries(r.byId as Record<string, unknown>)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(id)) continue;
      const vals = normalizeCustomValues(v, type);
      if (Object.keys(vals).length) byId[id] = vals;
    }
  }
  return { all: r.all !== false, shared: normalizeCustomValues(r.shared, type), byId };
}

/** The values that apply to asset `id` of the slot. */
export function effectiveCustom(slot: CustomSlot, id: string | undefined): CustomValues {
  return slot.all ? slot.shared : (id ? slot.byId[id] ?? {} : {});
}

/** Is asset `id` editable in Settings? With "apply to all" only the first asset is; otherwise every one. */
export function customEditable(slot: CustomSlot, ids: string[], id: string): boolean {
  return !slot.all || ids[0] === id;
}

/** Turning "apply to all" off copies the shared values to every asset (nothing visibly changes); on keeps the first asset's values for all. */
export function setApplyAll(slot: CustomSlot, ids: string[], all: boolean): CustomSlot {
  if (all === slot.all) return slot;
  if (!all) return { all: false, shared: slot.shared, byId: Object.fromEntries(ids.map((id) => [id, { ...slot.shared }])) };
  return { all: true, shared: { ...(ids[0] ? slot.byId[ids[0]] ?? {} : slot.shared) }, byId: slot.byId };
}

/** One token changed for asset `id` (or the shared set while `all`). `null` = back to the theme. */
export function setCustomToken(slot: CustomSlot, id: string, key: string, v: CustomValue | null, type?: string): CustomSlot {
  const cur = slot.all ? { ...slot.shared } : { ...(slot.byId[id] ?? {}) };
  if (v === null) delete cur[key];
  else cur[key] = v;
  const vals = normalizeCustomValues(cur, type);
  return slot.all ? { ...slot, shared: vals } : { ...slot, byId: { ...slot.byId, [id]: vals } };
}

/* ---------------- CSS ---------------- */

const SPACE: Record<string, number> = { none: 0, xs: 0.25, sm: 0.5, md: 1, lg: 1.5, xl: 2 };
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const color = (tok: string) => (tok === 'transparent' ? 'transparent' : `var(--fx-${kebab(tok)})`);
const space = (k: string) => `calc(var(--fx-space) * ${SPACE[k] ?? 1})`;
const tint = (c: string, op = 'tint') => `color-mix(in srgb, ${c} calc(var(--fx-opacity-${op}) * 100%), transparent)`;
const FONT: Record<string, string> = {
  display: 'var(--fx-font-display)',
  mono: 'var(--fx-font-mono)',
  serif: 'ui-serif, Georgia, serif',
  rounded: 'ui-rounded, var(--fx-font)',
  system: 'system-ui, sans-serif',
};
const SPACING_LETTER: Record<string, string> = { tight: '-0.02em', wide: '0.04em', wider: '0.1em' };
const LINE: Record<string, string> = { tight: '1.15', relaxed: '1.6', loose: '1.9' };
const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', spread: 'space-between' };
const RADIUS: Record<string, string> = { none: '0', sm: 'var(--fx-radius-sm)', md: 'var(--fx-radius-md)', lg: 'var(--fx-radius-lg)', pill: '999px' };
const SHADOW: Record<string, string> = { none: 'none', sm: 'var(--fx-shadow-sm)', md: 'var(--fx-shadow-md)', lg: 'var(--fx-shadow-lg)' };
const SPEED: Record<string, number> = { fast: 0.5, normal: 1, slow: 2 };
const EASE: Record<string, string> = { linear: 'linear', 'ease-out': 'ease-out', 'ease-in-out': 'ease-in-out', spring: 'cubic-bezier(.34,1.56,.64,1)' };

/** Keyframes the entrance animations use (one copy per sheet). */
export const CUSTOM_KEYFRAMES = [
  '@keyframes axf-cu-fade{from{opacity:0}}',
  '@keyframes axf-cu-slide-down{from{opacity:0;transform:translateY(-12px)}}',
  '@keyframes axf-cu-slide-up{from{opacity:0;transform:translateY(12px)}}',
  '@keyframes axf-cu-slide-start{from{opacity:0;transform:translateX(-16px)}}',
  '@keyframes axf-cu-scale{from{opacity:0;transform:scale(.92)}}',
  '@keyframes axf-cu-bounce{0%{opacity:0;transform:scale(.8)}60%{opacity:1;transform:scale(1.05)}100%{transform:scale(1)}}',
  '@keyframes axf-cu-flip{from{opacity:0;transform:perspective(400px) rotateX(-70deg)}}',
  '@keyframes axf-cu-blur{from{opacity:0;filter:blur(6px)}}',
  '@keyframes axf-cu-pulse{50%{transform:scale(1.06)}}',
  '@keyframes axf-cu-flash{from{background:var(--axf-cu-click)}}',
].join('\n');

const split = (sel: string) => sel.split(',').map((s) => s.trim()).filter(Boolean);
/** Raised specificity so a choice beats the engine's own rules without !important. */
const scoped = (sels: string[], suffix = '') => sels.map((s) => `:root body ${s}${suffix}`).join(', ');
const under = (roots: string[], child: string, suffix = '') => roots.flatMap((r) => split(child).map((c) => `:root body ${r} ${c}${suffix}`)).join(', ');

/** The declarations an icon set puts on `.fx-icon` (stroke, caps, fill, frame, scale, dash, tilt). */
export function iconSetDecls(s: IconSet): string[] {
  const d = [`stroke-width:${s.stroke}`, `stroke-linecap:${s.cap}`, `stroke-linejoin:${s.join}`];
  if (s.fill === 'tint') d.push(`fill:${tint('currentColor')}`);
  else if (s.fill === 'accent') d.push(`fill:${tint('var(--fx-accent)', 'muted')}`);
  else if (s.fill === 'solid') d.push(`fill:${tint('currentColor', 'muted')}`);
  if (s.dash === 'dash') d.push('stroke-dasharray:3 2');
  else if (s.dash === 'dot') d.push('stroke-dasharray:0.5 2.5');
  const tf: string[] = [];
  if (s.scale !== 1) tf.push(`scale(${s.scale})`);
  if (s.rotate) tf.push(`rotate(${s.rotate}deg)`);
  if (tf.length) d.push(`transform:${tf.join(' ')}`);
  if (s.frame !== 'none') {
    d.push('padding:0.2em', 'box-sizing:content-box', `border-radius:${s.frame === 'circle' ? '50%' : s.frame === 'rounded' ? 'var(--fx-radius-sm)' : '0'}`);
    if (s.frameFill === 'tint') d.push(`background:${tint('currentColor')}`);
    else if (s.frameFill === 'accent') d.push('background:var(--fx-accent)', 'color:var(--fx-accent-text)');
    if (s.frameRing || s.frameFill === 'none') d.push('box-shadow:inset 0 0 0 var(--fx-border-w) currentColor');
  }
  return d;
}

/** The CSS one type's values compile to (empty when every value is the theme's). */
export function customizeCss(type: string, values: CustomValues): string {
  const target = CUSTOM_TARGETS[type];
  if (!target) return '';
  const v = normalizeCustomValues(values, type);
  if (!Object.keys(v).length) return '';
  const roots = split(target.root);
  const items = target.item ? split(target.item) : [];
  const root: string[] = [];
  const text: string[] = [];
  const item: string[] = [];
  const hover: string[] = [];
  const active: string[] = [];
  const icon: string[] = [];
  const rules: string[] = [];
  const pressSel = items.length ? (suffix: string) => under(roots, target.item!, suffix) : (suffix: string) => scoped(roots, suffix);

  for (const [k, val] of Object.entries(v)) {
    const s = String(val);
    switch (k) {
      case 'fontSize': text.push(`font-size:calc(var(--fx-font-size) * ${Number(val) / 100})`); break;
      case 'fontWeight': text.push(`font-weight:${s}`); break;
      case 'fontFamily': text.push(`font-family:${FONT[s]}`); break;
      case 'letterSpacing': text.push(`letter-spacing:${SPACING_LETTER[s] ?? 'normal'}`); break;
      case 'textTransform': text.push(`text-transform:${s}`); break;
      case 'italic': text.push(`font-style:${val ? 'italic' : 'normal'}`); break;
      case 'lineHeight': text.push(`line-height:${LINE[s]}`); break;
      case 'textAlign': root.push(`text-align:${s}`); break;
      case 'textColor': text.push(`color:${color(s)}`); break;
      case 'background': root.push(`background:${color(s)}`); break;
      case 'borderColor': root.push(`border-color:${color(s)}`); break;
      case 'opacity': root.push(`opacity:${Number(val) / 100}`); break;
      case 'glass': if (val) root.push(`background:color-mix(in srgb, var(--fx-surface) calc(var(--fx-opacity-glass) * 100%), transparent)`, 'backdrop-filter:blur(calc(var(--fx-space) * 1.5))', '-webkit-backdrop-filter:blur(calc(var(--fx-space) * 1.5))'); break;
      case 'alignment': root.push(`justify-content:${ALIGN[s]}`); break;
      case 'location': root.push('position:sticky', s === 'pinned-top' ? 'top:0' : 'bottom:0', 'z-index:30'); break;
      case 'width': root.push(s === 'full' ? 'width:100%' : 'width:fit-content'); break;
      case 'padding': root.push(`padding:${space(s)}`); break;
      case 'itemPadding': item.push(`padding:calc(${space(s)} * 0.5) ${space(s)}`); break;
      case 'gap': root.push(`gap:${space(s)}`); break;
      case 'radius': root.push(`border-radius:${RADIUS[s]}`); if (items.length) item.push(`border-radius:${RADIUS[s]}`); break;
      case 'borderWidth': root.push(`border-width:calc(var(--fx-border-w) * ${s})`, s === '0' ? 'border-style:none' : 'border-style:solid'); break;
      case 'shadow': root.push(`box-shadow:${SHADOW[s]}`); break;
      case 'iconSet': { const set = iconSet(s); if (set) icon.push(...iconSetDecls(set)); break; }
      case 'iconSize': icon.push(`width:calc(var(--fx-font-size) * ${(Number(val) / 100) * 1.15})`, `height:calc(var(--fx-font-size) * ${(Number(val) / 100) * 1.15})`); break;
      case 'iconColor': icon.push(`color:${color(s)}`); break;
      case 'showIcons': if (val === false) icon.push('display:none'); break;
      case 'animation':
        if (s === 'none') root.push('animation:none');
        else root.push(`animation:axf-cu-${s} calc(var(--fx-motion) * ${2 * (SPEED[String(v.animationSpeed ?? 'normal')] ?? 1)}) ${EASE[String(v.easing)] ?? 'ease'} both`);
        break;
      case 'easing': (items.length ? item : root).push(`transition-timing-function:${EASE[s]}`); break;
      case 'animationSpeed': (items.length ? item : root).push(`transition-duration:calc(var(--fx-motion) * ${SPEED[s] ?? 1})`); break;
      case 'hover':
        switch (s) {
          case 'none': hover.push('background:inherit', 'box-shadow:none', 'transform:none'); break;
          case 'highlight': hover.push(`background:${tint(`var(--axf-cu-hover, var(--fx-text))`, 'hover')}`); break;
          case 'tint': hover.push(`background:${tint('var(--axf-cu-hover, var(--fx-accent))')}`); break;
          case 'lift': hover.push('transform:translateY(-2px)', 'box-shadow:var(--fx-shadow-md)'); break;
          case 'glow': hover.push('box-shadow:0 0 0 calc(var(--fx-border-w) * 2) color-mix(in srgb, var(--axf-cu-hover, var(--fx-accent)) 45%, transparent)'); break;
          case 'underline': hover.push('text-decoration:underline', 'text-underline-offset:0.25em'); break;
          case 'grow': hover.push('transform:scale(1.05)'); break;
          case 'dim': hover.push(`opacity:var(--fx-opacity-muted)`); break;
        }
        break;
      case 'hoverColor': rules.push(`${scoped(roots)}{--axf-cu-hover:${color(s)}}`); hover.push(`color:${color(s)}`); break;
      case 'cursor': (items.length ? item : root).push(`cursor:${s}`); break;
      case 'click':
        switch (s) {
          case 'none': active.push('transform:none', 'filter:none'); break;
          case 'press': active.push('transform:scale(0.96)'); break;
          case 'sink': active.push('transform:translateY(1px)', 'box-shadow:inset 0 2px 4px color-mix(in srgb, var(--fx-shadow, black) 30%, transparent)'); break;
          case 'flash': active.push('animation:axf-cu-flash calc(var(--fx-motion) * 2) ease-out'); break;
          case 'pulse': active.push('animation:axf-cu-pulse calc(var(--fx-motion) * 2) ease-out'); break;
          case 'bounce': active.push('animation:axf-cu-bounce calc(var(--fx-motion) * 2) ease-out'); break;
        }
        break;
      case 'clickColor': rules.push(`${scoped(roots)}{--axf-cu-click:${color(s)}}`); active.push(`background:${tint(color(s))}`); break;
      case 'focusRing': {
        const ring = s === 'thick' ? 'outline:calc(var(--fx-border-w) * 3) solid var(--fx-focus);outline-offset:0'
          : s === 'offset' ? 'outline:calc(var(--fx-border-w) * 2) solid var(--fx-focus);outline-offset:calc(var(--fx-border-w) * 3)'
          : `outline:none;box-shadow:0 0 0 calc(var(--fx-border-w) * 3) ${tint('var(--fx-focus)', 'muted')}`;
        rules.push(`${pressSel(':focus-visible')}{${ring}}`);
        break;
      }
    }
  }
  if (!('clickColor' in v) && active.length) rules.push(`${scoped(roots)}{--axf-cu-click:${tint('var(--fx-accent)')}}`);
  const out: string[] = [];
  if (root.length || text.length) out.push(`${scoped(roots)}{${[...root, ...text].join(';')}}`);
  if (text.length && items.length) out.push(`${under(roots, target.item!)}{${text.join(';')}}`);
  if (item.length) out.push(`${items.length ? under(roots, target.item!) : scoped(roots)}{${item.join(';')}}`);
  if (hover.length) out.push(`${pressSel(':hover')}{${hover.join(';')}}`);
  if (active.length) out.push(`${pressSel(':active')}{${active.join(';')}}`);
  if (icon.length) out.push(`${under(roots, '.fx-icon')}{${icon.join(';')}}`);
  out.push(...rules);
  return out.join('\n');
}

/** One sheet for every customizable type, given each type's values for its active asset. Motion respects reduced-motion. */
export function customizeSheet(perType: Record<string, CustomValues>): string {
  const parts = Object.entries(perType).map(([t, v]) => customizeCss(t, v)).filter(Boolean);
  if (!parts.length) return '';
  return `${CUSTOM_KEYFRAMES}\n${parts.join('\n')}\n@media (prefers-reduced-motion: reduce){${Object.values(CUSTOM_TARGETS).map((t) => scoped(split(t.root))).join(', ')}{animation:none}}`;
}
