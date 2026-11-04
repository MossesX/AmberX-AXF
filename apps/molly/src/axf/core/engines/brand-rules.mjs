/**
 * Brand asset rules (plain JS so the TypeScript engines, the build engine's validator and the generators share ONE
 * copy): the four brand asset types of enterprise-branding phase 1.
 *
 *   logo-mark      a brand mark as safe vector data (paths only; no script, no links, no raster)
 *   animated-logo  a logo-mark + a motion preset (reduced motion = the still frame)
 *   icon-pack      a named set of glyphs on one grid; the framework glyph set is the fallback
 *   branding       the package: brand name, which marks and pack to use, where decorations go, palette hooks;
 *                  an open slot registry so new decoration places never need a kernel change
 *
 * Everything here is pure data in → errors / normalized data out. Colours are tokens, never literals (a hex is allowed
 * only inside a mark's own palette, which the engine maps to tokens when a theme is active).
 */

export const BRAND_TYPES = ['logo-mark', 'animated-logo', 'icon-pack', 'branding'];

/** Colour words a mark or glyph may use: theme tokens plus `currentColor` and the mark's own palette slots. */
export const MARK_COLORS = ['currentColor', 'none', 'text', 'muted', 'bg', 'surface', 'accent', 'accentText', 'success', 'warning', 'danger', 'info', 'brand1', 'brand2', 'brand3'];
export const MARK_FORMS = ['mark', 'wordmark', 'lockup'];
export const MARK_LIMITS = { paths: 64, pathChars: 4000, totalChars: 24000, textChars: 48, palette: 3, viewBoxMax: 4096 };
/** Path data: SVG path commands, numbers, separators only (so a mark can never carry script, urls or external refs). */
export const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9 ,.\-+eE\n\r\t]+$/;
export const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const ANIMATION_PRESETS = ['spin', 'pulse', 'draw', 'orbit', 'float', 'shimmer', 'wink', 'none'];
export const ANIMATION_LIMITS = { durationMs: [300, 20000], delayMs: [0, 10000] };

export const ICON_STYLES = ['outline', 'filled', 'duotone', 'sharp', 'rounded'];
export const ICON_LIMITS = { grid: [16, 48], stroke: [0.5, 4], glyphs: 600, pathChars: 2000, nameChars: 48 };
export const GLYPH_NAME = /^[a-z][a-z0-9-]*$/;

/** Decoration places a branding package may style; an open list (apps and plugins may register more through `registerBrandSlot`). */
export const BRAND_SLOTS = ['banner', 'window', 'floating-window', 'dialog', 'container', 'tab-group', 'toolbar', 'nav-menu', 'app-menu', 'context-menu', 'splash', 'favicon', 'empty-state'];
export const BRAND_SLOT_MODES = ['none', 'mark', 'wordmark', 'lockup', 'animated', 'accent-edge', 'watermark'];
export const BRAND_DEFAULT_MODES = { banner: 'lockup', window: 'mark', 'floating-window': 'mark', dialog: 'mark', container: 'none', 'tab-group': 'none', toolbar: 'none', 'nav-menu': 'none', 'app-menu': 'none', 'context-menu': 'none', splash: 'animated', favicon: 'mark', 'empty-state': 'watermark' };
export const BRAND_LIMITS = { nameChars: 60, taglineChars: 120, extraSlots: 64 };

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, lo, hi, d) => { const n = typeof v === 'number' && Number.isFinite(v) ? v : d; return Math.min(hi, Math.max(lo, n)); };
const colorOk = (c) => typeof c === 'string' && (MARK_COLORS.includes(c) || HEX.test(c));

/* ---------------- logo-mark ---------------- */

export function normalizeMark(raw) {
  const o = isObj(raw) ? raw : {};
  const vb = parseViewBox(o.viewBox) ?? [0, 0, 24, 24];
  const paths = (Array.isArray(o.paths) ? o.paths : []).slice(0, MARK_LIMITS.paths).map((p) => {
    const q = isObj(p) ? p : {};
    return { d: str(q.d, MARK_LIMITS.pathChars), fill: colorOk(q.fill) ? q.fill : 'currentColor', stroke: colorOk(q.stroke) ? q.stroke : 'none', strokeWidth: num(q.strokeWidth, 0, 16, 0), opacity: num(q.opacity, 0, 1, 1), round: q.round === true };
  }).filter((p) => p.d);
  const pal = isObj(o.palette) ? o.palette : {};
  const palette = {};
  for (const k of ['brand1', 'brand2', 'brand3']) if (HEX.test(pal[k] ?? '')) palette[k] = pal[k];
  const text = isObj(o.text) ? { value: str(o.text.value, MARK_LIMITS.textChars), weight: num(o.text.weight, 100, 900, 600), tracking: num(o.text.tracking, -0.1, 0.5, 0), font: ['ui', 'display', 'mono'].includes(o.text.font) ? o.text.font : 'display', fill: colorOk(o.text.fill) ? o.text.fill : 'text' } : null;
  return {
    form: MARK_FORMS.includes(o.form) ? o.form : 'mark',
    brand: str(o.brand, BRAND_LIMITS.nameChars),
    viewBox: vb,
    paths,
    text,
    palette,
    safeArea: num(o.safeArea, 0, 1, 0.25),
    minSize: num(o.minSize, 8, 512, 16),
    tags: Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === 'string').slice(0, 12) : [],
  };
}

export function parseViewBox(v) {
  if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) return v.map((n) => Math.max(-MARK_LIMITS.viewBoxMax, Math.min(MARK_LIMITS.viewBoxMax, n)));
  if (typeof v === 'string') { const p = v.trim().split(/[\s,]+/).map(Number); if (p.length === 4 && p.every(Number.isFinite)) return parseViewBox(p); }
  return null;
}

export function markErrors(raw) {
  const e = [];
  if (!isObj(raw)) return ['data must be an object'];
  if (raw.form !== undefined && !MARK_FORMS.includes(raw.form)) e.push(`data.form must be one of: ${MARK_FORMS.join(', ')}`);
  if (raw.viewBox !== undefined && !parseViewBox(raw.viewBox)) e.push('data.viewBox must be four numbers');
  if (!Array.isArray(raw.paths)) e.push('data.paths must be an array');
  else {
    if (raw.paths.length > MARK_LIMITS.paths) e.push(`data.paths: at most ${MARK_LIMITS.paths} paths`);
    let total = 0;
    raw.paths.forEach((p, i) => {
      if (!isObj(p) || typeof p.d !== 'string' || !p.d.trim()) { e.push(`data.paths[${i}].d is required`); return; }
      if (p.d.length > MARK_LIMITS.pathChars) e.push(`data.paths[${i}].d: at most ${MARK_LIMITS.pathChars} characters`);
      if (!PATH_DATA.test(p.d)) e.push(`data.paths[${i}].d: path commands and numbers only`);
      total += p.d.length;
      for (const k of ['fill', 'stroke']) if (p[k] !== undefined && !colorOk(p[k])) e.push(`data.paths[${i}].${k}: a colour token (${MARK_COLORS.join(', ')}) or #hex`);
    });
    if (total > MARK_LIMITS.totalChars) e.push(`data.paths: at most ${MARK_LIMITS.totalChars} characters of path data in all`);
  }
  const form = raw.form ?? 'mark';
  if ((form === 'wordmark' || form === 'lockup') && !(isObj(raw.text) && typeof raw.text.value === 'string' && raw.text.value.trim())) e.push(`data.text.value is required for a ${form}`);
  if (form === 'mark' && Array.isArray(raw.paths) && raw.paths.length === 0) e.push('a mark needs at least one path');
  if (raw.palette !== undefined) {
    if (!isObj(raw.palette)) e.push('data.palette must be an object');
    else for (const [k, v] of Object.entries(raw.palette)) { if (!['brand1', 'brand2', 'brand3'].includes(k)) e.push(`data.palette.${k}: only brand1, brand2, brand3`); else if (!HEX.test(v)) e.push(`data.palette.${k}: #hex`); }
  }
  return e;
}

/* ---------------- animated-logo ---------------- */

export function normalizeAnimatedLogo(raw) {
  const o = isObj(raw) ? raw : {};
  return {
    mark: str(o.mark, 120),
    preset: ANIMATION_PRESETS.includes(o.preset) ? o.preset : 'pulse',
    durationMs: num(o.durationMs, ANIMATION_LIMITS.durationMs[0], ANIMATION_LIMITS.durationMs[1], 2400),
    delayMs: num(o.delayMs, ANIMATION_LIMITS.delayMs[0], ANIMATION_LIMITS.delayMs[1], 0),
    loop: o.loop === false ? false : o.loop === 'hover' ? 'hover' : true,
    still: o.still === 'last' ? 'last' : 'first',
    intensity: num(o.intensity, 0.1, 1, 0.6),
    tags: Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === 'string').slice(0, 12) : [],
  };
}

export function animatedLogoErrors(raw) {
  const e = [];
  if (!isObj(raw)) return ['data must be an object'];
  if (typeof raw.mark !== 'string' || !raw.mark.trim()) e.push('data.mark (a logo-mark id) is required');
  if (raw.preset !== undefined && !ANIMATION_PRESETS.includes(raw.preset)) e.push(`data.preset must be one of: ${ANIMATION_PRESETS.join(', ')}`);
  const [lo, hi] = ANIMATION_LIMITS.durationMs;
  if (raw.durationMs !== undefined && (typeof raw.durationMs !== 'number' || raw.durationMs < lo || raw.durationMs > hi)) e.push(`data.durationMs must be ${lo}–${hi}`);
  if (raw.loop !== undefined && ![true, false, 'hover'].includes(raw.loop)) e.push('data.loop must be true, false or "hover"');
  return e;
}

/* ---------------- icon-pack ---------------- */

export function normalizeIconPack(raw) {
  const o = isObj(raw) ? raw : {};
  const glyphs = {};
  if (isObj(o.glyphs)) {
    for (const [name, g] of Object.entries(o.glyphs).slice(0, ICON_LIMITS.glyphs)) {
      if (!GLYPH_NAME.test(name) || name.length > ICON_LIMITS.nameChars) continue;
      const q = isObj(g) ? g : typeof g === 'string' ? { d: g } : {};
      const d = str(q.d, ICON_LIMITS.pathChars);
      if (!d || !PATH_DATA.test(d)) continue;
      glyphs[name] = { d, fill: q.fill === true, secondary: typeof q.secondary === 'string' && PATH_DATA.test(q.secondary) ? q.secondary.slice(0, ICON_LIMITS.pathChars) : '' };
    }
  }
  return {
    style: ICON_STYLES.includes(o.style) ? o.style : 'outline',
    grid: num(o.grid, ICON_LIMITS.grid[0], ICON_LIMITS.grid[1], 24),
    stroke: num(o.stroke, ICON_LIMITS.stroke[0], ICON_LIMITS.stroke[1], 1.75),
    linecap: ['round', 'square', 'butt'].includes(o.linecap) ? o.linecap : 'round',
    fallback: o.fallback === 'none' ? 'none' : 'framework',
    glyphs,
    tags: Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === 'string').slice(0, 12) : [],
  };
}

export function iconPackErrors(raw) {
  const e = [];
  if (!isObj(raw)) return ['data must be an object'];
  if (raw.style !== undefined && !ICON_STYLES.includes(raw.style)) e.push(`data.style must be one of: ${ICON_STYLES.join(', ')}`);
  if (raw.grid !== undefined && (typeof raw.grid !== 'number' || raw.grid < ICON_LIMITS.grid[0] || raw.grid > ICON_LIMITS.grid[1])) e.push(`data.grid must be ${ICON_LIMITS.grid[0]}–${ICON_LIMITS.grid[1]}`);
  if (!isObj(raw.glyphs)) e.push('data.glyphs must be an object of name → path');
  else {
    const names = Object.keys(raw.glyphs);
    if (names.length === 0) e.push('data.glyphs: at least one glyph');
    if (names.length > ICON_LIMITS.glyphs) e.push(`data.glyphs: at most ${ICON_LIMITS.glyphs} glyphs`);
    for (const name of names) {
      if (!GLYPH_NAME.test(name) || name.length > ICON_LIMITS.nameChars) e.push(`data.glyphs.${name}: names are lowercase words with dashes`);
      const g = raw.glyphs[name];
      const d = typeof g === 'string' ? g : isObj(g) ? g.d : undefined;
      if (typeof d !== 'string' || !d.trim()) e.push(`data.glyphs.${name}.d is required`);
      else if (!PATH_DATA.test(d)) e.push(`data.glyphs.${name}.d: path commands and numbers only`);
      else if (d.length > ICON_LIMITS.pathChars) e.push(`data.glyphs.${name}.d: at most ${ICON_LIMITS.pathChars} characters`);
    }
  }
  return e;
}

/* ---------------- branding ---------------- */

// One registry per process even when this module is loaded twice (a .ts import and a direct .mjs import resolve to
// two instances under some loaders): the set lives on globalThis under a private key.
const SLOTS_KEY = Symbol.for('axf.brand.extraSlots');
const extraSlots = globalThis[SLOTS_KEY] ?? (globalThis[SLOTS_KEY] = new Set());
/** Apps and plugins register more decoration places (e.g. a plugin's own panel); unknown slots are refused by the validator. */
export function registerBrandSlot(slot) { if (typeof slot === 'string' && GLYPH_NAME.test(slot) && !BRAND_SLOTS.includes(slot) && extraSlots.size < BRAND_LIMITS.extraSlots) extraSlots.add(slot); }
export function brandSlots() { return [...BRAND_SLOTS, ...extraSlots]; }

export function normalizeBranding(raw) {
  const o = isObj(raw) ? raw : {};
  const marks = isObj(o.marks) ? o.marks : {};
  const dec = isObj(o.decorations) ? o.decorations : {};
  const decorations = {};
  for (const s of brandSlots()) decorations[s] = BRAND_SLOT_MODES.includes(dec[s]) ? dec[s] : (BRAND_DEFAULT_MODES[s] ?? 'none');
  const pal = isObj(o.palette) ? o.palette : {};
  const palette = {};
  for (const k of ['brand1', 'brand2', 'brand3']) if (HEX.test(pal[k] ?? '')) palette[k] = pal[k];
  return {
    brand: { name: str(isObj(o.brand) ? o.brand.name : o.brand, BRAND_LIMITS.nameChars), tagline: str(isObj(o.brand) ? o.brand.tagline : '', BRAND_LIMITS.taglineChars) },
    marks: { mark: str(marks.mark, 120), wordmark: str(marks.wordmark, 120), lockup: str(marks.lockup, 120), animated: str(marks.animated, 120) },
    iconPack: str(o.iconPack, 120),
    decorations,
    palette,
    accentFromBrand: o.accentFromBrand === true,
    tags: Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === 'string').slice(0, 12) : [],
  };
}

export function brandingErrors(raw) {
  const e = [];
  if (!isObj(raw)) return ['data must be an object'];
  const name = isObj(raw.brand) ? raw.brand.name : raw.brand;
  if (typeof name !== 'string' || !name.trim()) e.push('data.brand.name is required');
  if (!isObj(raw.marks) || typeof raw.marks.mark !== 'string' || !raw.marks.mark.trim()) e.push('data.marks.mark (a logo-mark id) is required');
  if (raw.decorations !== undefined) {
    if (!isObj(raw.decorations)) e.push('data.decorations must be an object');
    else for (const [s, m] of Object.entries(raw.decorations)) {
      if (!brandSlots().includes(s)) e.push(`data.decorations.${s}: not a brand slot (${brandSlots().join(', ')})`);
      else if (!BRAND_SLOT_MODES.includes(m)) e.push(`data.decorations.${s}: must be one of ${BRAND_SLOT_MODES.join(', ')}`);
    }
  }
  if (raw.palette !== undefined) {
    if (!isObj(raw.palette)) e.push('data.palette must be an object');
    else for (const [k, v] of Object.entries(raw.palette)) { if (!['brand1', 'brand2', 'brand3'].includes(k)) e.push(`data.palette.${k}: only brand1, brand2, brand3`); else if (!HEX.test(v)) e.push(`data.palette.${k}: #hex`); }
  }
  return e;
}

/** Errors for any brand type, or null when `type` isn't one (so validators can call it blind). */
export function brandAssetErrors(type, data) {
  switch (type) {
    case 'logo-mark': return markErrors(data);
    case 'animated-logo': return animatedLogoErrors(data);
    case 'icon-pack': return iconPackErrors(data);
    case 'branding': return brandingErrors(data);
    default: return null;
  }
}
