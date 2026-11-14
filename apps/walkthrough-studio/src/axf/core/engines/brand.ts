/**
 * Branding engine (branding@1 + logo-mark@1 + animated-logo@1 + icon-pack@1). Rules live in brand-rules.mjs (shared
 * with the build engine and the generators); this file turns them into what the UI draws:
 *
 *   markSvg(mark, opts)            a safe inline SVG string for a logo-mark (tokens become CSS vars, never literals)
 *   markBox(mark, height)          the width a mark takes at a height (for banner / title-bar layout)
 *   animationFor(anim, reduced)    the CSS animation a brand mark plays (none under reduced motion = the still frame)
 *   glyphFor(pack, name)           the glyph a name resolves to in an icon pack, or null = use the framework icon
 *   glyphSvg(pack, name, size)     inline SVG for a glyph: stroke / fill per style, or its colour layers (fixed-colour art)
 *   logoGlyph(pack, mode)          the glyph a logo pack draws at a mark / watermark brand place (roles app-mark / app-logo)
 *   resolveBranding(b, registry)   which asset each brand place uses, with every id checked against the registry
 *   withLogoPack(resolved, id, p)  the same with the icon pack in force drawing the mark places it covers
 *   brandingVars(b)                root CSS vars: --fx-brand-1/2/3 from the palette, --fx-brand-name
 *
 * Pure; fixture-pinned by spec/fixtures/brand.json (check-brand.mts). The Kotlin twin is deferred (PORTING.md).
 */
import {
  ANIMATION_PRESETS, BRAND_SLOTS, BRAND_SLOT_MODES, BRAND_TYPES, MARK_COLORS, registerBrandSlot, brandSlots, normalizeAnimatedLogo, normalizeBranding, normalizeIconPack, normalizeMark,
  animatedLogoErrors, brandAssetErrors, brandingErrors, iconPackErrors, markErrors, normalizeGlyphLayers, glyphLayerErrors,
  type AnimatedLogoData, type BrandingData, type Glyph, type GlyphLayer, type IconPackData, type MarkData,
} from './brand-rules.mjs';

export { ANIMATION_PRESETS, BRAND_SLOTS, BRAND_SLOT_MODES, BRAND_TYPES, MARK_COLORS, registerBrandSlot, brandSlots, normalizeAnimatedLogo, normalizeBranding, normalizeIconPack, normalizeMark, animatedLogoErrors, brandAssetErrors, brandingErrors, iconPackErrors, markErrors, normalizeGlyphLayers, glyphLayerErrors };
export type { AnimatedLogoData, BrandingData, Glyph, GlyphLayer, IconPackData, MarkData };

/** A colour word → what goes in the SVG attribute (theme tokens become vars; the palette slots are vars the branding sets). */
export function markColor(c: string, palette: Record<string, string> = {}): string {
  if (c === 'currentColor' || c === 'none') return c;
  if (c.startsWith('#')) return c;
  if (c === 'brand1' || c === 'brand2' || c === 'brand3') return `var(--fx-${c.replace('brand', 'brand-')}, ${palette[c] ?? 'currentColor'})`;
  const token = c === 'accentText' ? 'accent-text' : c;
  return MARK_COLORS.includes(c) ? `var(--fx-${token})` : 'currentColor';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

export interface MarkSvgOptions { height?: number; title?: string; className?: string; /** draw the wordmark text (false = paths only) */ text?: boolean }

/** Width:height of the mark's own viewBox (a lockup adds its text to the right). */
export function markAspect(mark: MarkData, withText = true): number {
  const [, , w, h] = mark.viewBox as [number, number, number, number];
  const base = h > 0 ? w / h : 1;
  if (mark.form === 'mark' || !withText || !mark.text?.value) return base;
  // text at ~0.6 em per character of the mark's height, plus a gap of a quarter height
  const chars = mark.text.value.length;
  return mark.form === 'wordmark' && mark.paths.length === 0 ? Math.max(1, chars * 0.6) : base + 0.25 + chars * 0.6;
}

/** Width a mark takes at `height` px. */
export function markBox(mark: MarkData, height: number, withText = true): { width: number; height: number } {
  return { width: Math.round(height * markAspect(mark, withText)), height };
}

/** A safe inline SVG: only path elements and one text node; every colour a token or the mark's own hex. */
export function markSvg(raw: unknown, opts: MarkSvgOptions = {}): string {
  const mark = normalizeMark(raw);
  const [x, y, w, h] = mark.viewBox as [number, number, number, number];
  const withText = opts.text !== false && mark.form !== 'mark' && !!mark.text?.value;
  const aspect = markAspect(mark, withText);
  const height = opts.height ?? h;
  const width = Math.round(height * aspect);
  const totalW = h * aspect;
  const paths = mark.paths.map((p) => `<path d="${esc(p.d)}" fill="${markColor(p.fill, mark.palette)}"${p.stroke !== 'none' ? ` stroke="${markColor(p.stroke, mark.palette)}" stroke-width="${p.strokeWidth}"${p.round ? ' stroke-linecap="round" stroke-linejoin="round"' : ''}` : ''}${p.opacity < 1 ? ` opacity="${p.opacity}"` : ''}/>`).join('');
  let text = '';
  if (withText && mark.text) {
    const t = mark.text;
    const tx = mark.paths.length ? x + w + h * 0.25 : x;
    const font = t.font === 'mono' ? 'var(--fx-font-mono)' : t.font === 'ui' ? 'var(--fx-font)' : 'var(--fx-font-display)';
    text = `<text x="${tx}" y="${y + h * 0.72}" font-family="${font}" font-size="${(h * 0.68).toFixed(2)}" font-weight="${t.weight}" letter-spacing="${(t.tracking * h * 0.68).toFixed(2)}" fill="${markColor(t.fill, mark.palette)}">${esc(t.value)}</text>`;
  }
  const title = opts.title ?? mark.brand;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${totalW} ${h}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}"${opts.className ? ` class="${esc(opts.className)}"` : ''}>${title ? `<title>${esc(title)}</title>` : ''}${paths}${text}</svg>`;
}

/* ---------------- animation ---------------- */

export interface MarkAnimation { name: string; durationMs: number; delayMs: number; iteration: string; vars: Record<string, string>; className: string }

/** The animation a brand mark plays; `reduced` or preset `none` = nothing (the still frame). */
export function animationFor(raw: unknown, reduced = false): MarkAnimation | null {
  const a = normalizeAnimatedLogo(raw);
  if (reduced || a.preset === 'none') return null;
  return {
    name: `fx-brand-${a.preset}`,
    durationMs: a.durationMs,
    delayMs: a.delayMs,
    iteration: a.loop === true ? 'infinite' : '1',
    vars: { '--fx-brand-anim-ms': `${a.durationMs}ms`, '--fx-brand-anim-delay': `${a.delayMs}ms`, '--fx-brand-anim-k': String(a.intensity) },
    className: `fx-brand-anim fx-brand-anim--${a.preset}${a.loop === 'hover' ? ' fx-brand-anim--hover' : ''}`,
  };
}

/* ---------------- icon packs ---------------- */

/** The glyph for a name, or null (= the framework's own icon, when the pack falls back). */
export function glyphFor(raw: unknown, name: string): Glyph | null {
  const pack = normalizeIconPack(raw);
  return pack.glyphs[name] ?? null;
}

/**
 * A glyph path split into its closed sub-paths (filled in a filled pack) and open ones (stroked). Sub-paths start at
 * absolute `M`; a path with a relative `m` after the start can't be split safely, so it is kept whole: closed when
 * every sub-path closes, open otherwise.
 */
export function splitGlyph(d: string): { closed: string; open: string } {
  const src = d.trim();
  if (/[m]/.test(src.slice(1))) return /[zZ]\s*$/.test(src) && !/[^zZ\s]\s*[Mm]/.test(src.replace(/[zZ]\s*[Mm]/g, '')) ? { closed: src, open: '' } : { closed: '', open: src };
  const parts = src.split(/(?=M)/).map((x) => x.trim()).filter(Boolean);
  const closed = parts.filter((x) => /[zZ]$/.test(x));
  const open = parts.filter((x) => !/[zZ]$/.test(x));
  return { closed: closed.join(''), open: open.join('') };
}

/**
 * Inline SVG for one glyph of a pack at `size` px (stroke or fill per the pack's style). A glyph with colour `layers`
 * draws them in order, each filled in its own colour (tokens become vars, hex stays: that is how a `themable: false`
 * pack keeps its colours under every skin); `d` is only the fallback for glyphs without layers.
 */
export function glyphSvg(raw: unknown, name: string, size = 16, title?: string): string | null {
  const pack = normalizeIconPack(raw);
  const g = pack.glyphs[name];
  if (!g) return null;
  const filled = g.fill || pack.style === 'filled';
  const stroked = (d: string) => `<path d="${esc(d)}" fill="none" stroke="currentColor" stroke-width="${pack.stroke}" stroke-linecap="${pack.linecap}" stroke-linejoin="round"/>`;
  let main: string;
  if (g.layers.length) main = g.layers.map((l) => `<path d="${esc(l.d)}" fill="${markColor(l.color)}"${l.opacity < 1 ? ` opacity="${l.opacity}"` : ''}/>`).join('');
  else if (!filled) main = stroked(g.d);
  else if (g.fill) main = `<path d="${esc(g.d)}" fill="currentColor"/>`; // the glyph's author asked for a fill
  else {
    // a filled pack fills closed shapes but keeps open lines stroked (a check mark, ×, +, a search handle), else
    // they would vanish or turn into wedges (enterprise-branding s25)
    const { closed, open } = splitGlyph(g.d);
    main = (closed ? `<path d="${esc(closed)}" fill="currentColor"/>` : '') + (open ? stroked(open) : '');
  }
  const second = g.secondary ? `<path d="${esc(g.secondary)}" fill="currentColor" opacity="var(--fx-opacity-tint, 0.14)"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pack.grid} ${pack.grid}" width="${size}" height="${size}" aria-hidden="${title ? 'false' : 'true'}"${title ? ` role="img" aria-label="${esc(title)}"` : ''}>${second}${main}</svg>`;
}

/* ---------------- logo packs ---------------- */

/** Brand place modes a logo pack may draw: the plain mark form (no text, no motion preset). */
export const LOGO_PACK_MODES = ['mark', 'watermark'];
/** The icon-map roles a logo pack maps its mark to, in the order a place tries them. */
export const LOGO_PACK_ROLES = ['app-mark', 'app-logo'];

/**
 * The glyph a pack gives a brand place in `mode`, or null: only packs that cover `logos` and map `app-mark` (or
 * `app-logo`) to a glyph they have, and only for the mark / watermark modes (a wordmark or lockup needs the mark's text,
 * an animated place its motion preset: those stay logo-marks).
 */
export function logoGlyph(raw: unknown, mode: string): string | null {
  if (!LOGO_PACK_MODES.includes(mode)) return null;
  const pack = normalizeIconPack(raw);
  if (!pack.covers.includes('logos')) return null;
  for (const role of LOGO_PACK_ROLES) { const g = pack.roles[role]; if (g && pack.glyphs[g]) return g; }
  return null;
}

/* ---------------- branding ---------------- */

export interface BrandRegistry { has(type: string, id: string): boolean }
export type BrandPlaceType = 'logo-mark' | 'animated-logo' | 'icon-pack' | '';
/** One brand place: `icon-pack` places carry the glyph the pack draws there (see withLogoPack). */
export interface BrandPlaceRef { mode: string; asset: string; type: BrandPlaceType; glyph?: string }
export interface ResolvedBrand {
  name: string; tagline: string;
  /** asset ids that exist, '' when missing (the UI then shows the brand name as text) */
  mark: string; wordmark: string; lockup: string; animated: string; iconPack: string;
  /** per brand slot: the mode to draw and the asset id it resolves to ('' = nothing) */
  places: Record<string, BrandPlaceRef>;
  missing: string[];
}

const modeType = (mode: string): BrandPlaceType => mode === 'animated' ? 'animated-logo' : mode === 'mark' || mode === 'wordmark' || mode === 'lockup' || mode === 'watermark' ? 'logo-mark' : '';

/**
 * The resolved branding with the icon pack in force laid over it (icon-map@1 s9): every place in a mode the pack covers
 * (`logoGlyph`) becomes an `icon-pack` place drawing that glyph, including places whose logo-mark was missing. Other
 * places, and every other field, are unchanged; a pack that covers no logos returns the input as is.
 */
export function withLogoPack(resolved: ResolvedBrand, packId: string, packRaw: unknown): ResolvedBrand {
  if (!packId || !packRaw) return resolved;
  const places: ResolvedBrand['places'] = {};
  let changed = false;
  for (const [slot, p] of Object.entries(resolved.places)) {
    const glyph = p.mode === 'none' ? null : logoGlyph(packRaw, p.mode);
    if (glyph) { places[slot] = { mode: p.mode, asset: packId, type: 'icon-pack', glyph }; changed = true; } else places[slot] = p;
  }
  return changed ? { ...resolved, places } : resolved;
}

/** Every brand place resolved: a missing wordmark / lockup falls back to the mark, a missing animated mark to the still mark. */
export function resolveBranding(raw: unknown, registry: BrandRegistry): ResolvedBrand {
  const b = normalizeBranding(raw);
  const missing: string[] = [];
  const pick = (type: string, id: string): string => { if (!id) return ''; if (registry.has(type, id)) return id; missing.push(`${type}/${id}`); return ''; };
  const mark = pick('logo-mark', b.marks.mark);
  const wordmark = pick('logo-mark', b.marks.wordmark) || mark;
  const lockup = pick('logo-mark', b.marks.lockup) || wordmark;
  const animated = pick('animated-logo', b.marks.animated);
  const iconPack = pick('icon-pack', b.iconPack);
  const places: ResolvedBrand['places'] = {};
  for (const slot of brandSlots()) {
    const mode = b.decorations[slot] ?? 'none';
    const type = modeType(mode);
    let asset = '';
    if (mode === 'mark' || mode === 'watermark') asset = mark;
    else if (mode === 'wordmark') asset = wordmark;
    else if (mode === 'lockup') asset = lockup;
    else if (mode === 'animated') asset = animated || mark;
    places[slot] = { mode, asset, type: mode === 'animated' && !animated ? (mark ? 'logo-mark' : '') : asset ? type : '' };
  }
  return { name: b.brand.name, tagline: b.brand.tagline, mark, wordmark, lockup, animated, iconPack, places, missing };
}

/** Root vars from the branding package: palette slots and the brand name (for `content:` uses and devtools). */
export function brandingVars(raw: unknown): Record<string, string> {
  const b = normalizeBranding(raw);
  const vars: Record<string, string> = { '--fx-brand-name': `"${b.brand.name.replace(/"/g, '')}"` };
  for (const [k, v] of Object.entries(b.palette)) vars[`--fx-${k.replace('brand', 'brand-')}`] = v;
  if (b.accentFromBrand && b.palette.brand1) vars['--fx-accent'] = b.palette.brand1;
  return vars;
}

/** The decoration a UI piece should draw at `slot` (null = none); an `icon-pack` decoration names its glyph. */
export function decorationFor(resolved: ResolvedBrand, slot: string): { mode: string; asset: string; type: Exclude<BrandPlaceType, ''>; glyph?: string } | null {
  const p = resolved.places[slot];
  return p && p.asset && p.type ? { mode: p.mode, asset: p.asset, type: p.type, ...(p.glyph ? { glyph: p.glyph } : {}) } : null;
}
