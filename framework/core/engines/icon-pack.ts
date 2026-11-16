/**
 * Icon pack engine (icon-pack@1 + icon-scope@1, spec/ICON-MAP.md). Reference implementation; pure, no DOM.
 *
 *   validateIconPack(data)                    every rule of the type (base + extended), as messages
 *   foldIconPack(id, get)                     the pack with its `extends` chain folded in (inherit@1, depth ≤ 4, cycles stop)
 *   iconChain(place)                          the levels of a place, leaf → root, each with its pack and overrides
 *   resolveIcon(spot, name, chain, get)       what one spot draws and which level / layer won
 *   listIconOverrides(look, hub)              every per-spot override with its level
 *   setIconPack / setIconOverride / reset*    pure edits of the two documents (new documents back)
 *   glyphMarkup / appIconMarkup               inline SVG for a resolved glyph (colours as currentColor / tokens only)
 *
 * Fixture: spec/fixtures/icon-pack.json (check: spec/check-icon-pack.mts). Kotlin twin deferred (PORTING.md).
 */
import { normalizeIconPack } from './brand-rules.mjs';
import { splitGlyph } from './brand';
import {
  GLYPH_REF, ICON_PACK_LIMITS, iconLevelEmpty, iconLookEmpty, iconMapErrors, iconPackExtendedErrors, isIconSubScope, normalizeGlyph, normalizeIconHub,
  normalizeIconLevel, normalizeIconLook, normalizeIconPackFull, normalizeOverride, SPOT_ID,
  type IconLevel, type IconLook, type IconOverride, type IconPackFull, type PackGlyph,
} from './icon-rules.mjs';
import { iconPackErrors } from './brand-rules.mjs';

export { iconMapErrors, normalizeIconLook, normalizeIconHub, normalizeIconLevel, normalizeOverride, iconLookEmpty, iconLevelEmpty };
export type { IconLevel, IconLook, IconOverride, IconPackFull, PackGlyph };

export const ICON_PACK_ENGINE = 'icon-pack@1';
/** Levels of the chain, leaf → root. `framework` is the floor every spot stands on. */
export const ICON_LEVELS = ['plugin', 'ui', 'app', 'global', 'brand', 'framework'] as const;
export type IconLevelKind = (typeof ICON_LEVELS)[number];
/** Which layer decided a spot. */
export const ICON_WINS = ['override', 'spot', 'name', 'framework'] as const;
export type IconWin = (typeof ICON_WINS)[number];

export type PackGetter = (id: string) => unknown | null | undefined;

/** A folded pack: the chain's entries merged (child over parent), ready to resolve against. */
export interface FoldedPack extends IconPackFull {
  id: string;
  /** ids folded in, this one first */
  chain: string[];
  /** `extends` ids that were missing, cyclic or past the depth cap */
  broken: string[];
}

/* ---------------------------------------------------------------- validate */

/** Every rule of icon-pack@1: the base rules (brand-rules) and the extended ones (icon-rules), deduped. */
export function validateIconPack(data: unknown): string[] {
  return [...new Set([...iconPackErrors(data), ...iconPackExtendedErrors(data)])];
}

/* ---------------------------------------------------------------- fold */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const dataOf = (a: unknown): unknown => (isObj(a) && isObj(a.data) ? a.data : a);

/**
 * The pack `id` with its `extends` chain folded in: per-name and per-spot entries the child lacks come from the parent
 * (child over parent), base fields (style, grid, stroke …) are the child's. Depth ≤ ICON_PACK_LIMITS.extendsDepth; a
 * missing or cyclic parent is recorded in `broken` and the chain stops there. `get(id)` returns the asset (or its data).
 */
export function foldIconPack(id: string, get: PackGetter): FoldedPack | null {
  const root = get(id);
  if (!root) return null;
  const head = normalizeIconPackFull(dataOf(root));
  const out: FoldedPack = { ...head, id, chain: [id], broken: [], glyphs: { ...head.glyphs }, spots: { ...head.spots } };
  let next = head.extends;
  const seen = new Set([id]);
  while (next) {
    if (seen.has(next)) { out.broken.push(next); break; }
    if (out.chain.length >= ICON_PACK_LIMITS.extendsDepth) { out.broken.push(next); break; }
    const raw = get(next);
    if (!raw) { out.broken.push(next); break; }
    const parent = normalizeIconPackFull(dataOf(raw));
    seen.add(next);
    out.chain.push(next);
    for (const [n, g] of Object.entries(parent.glyphs)) if (!(n in out.glyphs)) out.glyphs[n] = g;
    for (const [s, g] of Object.entries(parent.spots)) if (!(s in out.spots)) out.spots[s] = g;
    if (!out.license && parent.license) out.license = parent.license;
    next = parent.extends;
  }
  out.extends = '';
  return out;
}

/* ---------------------------------------------------------------- chain */

/** Where a spot is drawn: the sub scope (plugin / ui) it sits in and the documents in force. */
export interface IconPlace {
  /** `plugin:<id>` | `ui:<view>` | `app` (default) */
  scopeKey?: string;
  /** the app's look document `icon` block (app-look@1) */
  look?: IconLook | null;
  /** the shared appearance@1 `icon` block */
  hub?: IconLevel | null;
  /** the icon pack a skin puts in force per scope key (`axf.icons.pack.<scopeKey>`; keys `app`, `global`, `plugin:x`, `ui:y`) */
  skinPacks?: Record<string, string>;
  /** the branding package's `iconPack` */
  brandPack?: string;
}

export interface IconChainLevel { scope: string; kind: IconLevelKind; pack: string; overrides: Record<string, IconOverride>; from: 'pick' | 'skin' | 'brand' | 'inherit' }

/**
 * The levels of a place from the leaf to the root: `plugin:<id>` (when the place is in one), `ui:<view>` (when the
 * key names one; a plugin inside a view passes both through `scopeKey` `plugin:<id>` and `view`), `app`, `global`,
 * `brand`. Each level's pack is its own pick, else the skin's pack at that key, else '' (inherit).
 */
export function iconChain(place: IconPlace, view = ''): IconChainLevel[] {
  const look = place.look ?? null;
  const hub = place.hub ?? null;
  const skins = place.skinPacks ?? {};
  const level = (scope: string, kind: IconLevelKind, lv: IconLevel | null | undefined): IconChainLevel => {
    const pick = lv?.pack ?? '';
    const skin = skins[scope] ?? '';
    return { scope, kind, pack: pick || skin, overrides: { ...(lv?.overrides ?? {}) }, from: pick ? 'pick' : skin ? 'skin' : 'inherit' };
  };
  const out: IconChainLevel[] = [];
  const key = place.scopeKey && isIconSubScope(place.scopeKey) ? place.scopeKey : 'app';
  if (key.startsWith('plugin:')) out.push(level(key, 'plugin', look?.scopes[key]));
  const uiKey = key.startsWith('ui:') ? key : view ? `ui:${view}` : '';
  if (uiKey && isIconSubScope(uiKey)) out.push(level(uiKey, 'ui', look?.scopes[uiKey]));
  out.push(level('app', 'app', look));
  out.push(level('global', 'global', hub));
  out.push({ scope: 'brand', kind: 'brand', pack: place.brandPack ?? '', overrides: {}, from: place.brandPack ? 'brand' : 'inherit' });
  return out;
}

/* ---------------------------------------------------------------- resolve */

export interface ResolvedIcon {
  /** the glyph to draw, or null = the framework glyph of `name` */
  glyph: PackGlyph | null;
  /** the pack the glyph came from ('' = framework); folded, so its style / grid / stroke apply */
  pack: string;
  packData: FoldedPack | null;
  /** the level that won: plugin:<id> | ui:<view> | app | global | brand | framework */
  scope: string;
  by: IconWin;
  /** the effective glyph name: the spot's default or run-time name, or the name a `name:` override gave it (with `glyph` null it is the framework glyph to draw) */
  name: string;
}

const FRAMEWORK: Omit<ResolvedIcon, 'name'> = { glyph: null, pack: '', packData: null, scope: 'framework', by: 'framework' };

/** Follow a glyph reference (`name:<glyph>` → in `pack`, else the framework; `pack:<id>/<name>` → that pack), one hop. */
function followRef(ref: string, pack: FoldedPack | null, get: PackGetter, depth: number): { glyph: PackGlyph | null; pack: FoldedPack | null } {
  if (depth > 3 || !GLYPH_REF.test(ref)) return { glyph: null, pack: null };
  if (ref.startsWith('name:')) {
    const n = ref.slice(5);
    const g = pack?.glyphs[n] ?? null;
    return g && g.kind === 'ref' ? followRef(g.ref, pack, get, depth + 1) : { glyph: g, pack: g ? pack : null };
  }
  const [pid, n] = ref.slice(5).split('/');
  const p = foldIconPack(pid, get);
  const g = p?.glyphs[n] ?? null;
  return g && g.kind === 'ref' ? followRef(g.ref, p, get, depth + 1) : { glyph: g, pack: g ? p : null };
}

/**
 * What `spot` draws at a place. `name` = the glyph name to look up (the spot's default glyph, or the run-time name of a
 * dynamic spot; '' when unknown). Walks the chain leaf → root: an override at any level nearer the leaf wins; then the
 * nearest level with a pack: its per-spot entry, its per-name entry; a name the pack lacks falls through to the next
 * level's pack while the pack says `fallback: framework`, and stops at the framework glyph when it says `none`.
 */
export function resolveIcon(spot: string, name: string, chain: IconChainLevel[], get: PackGetter): ResolvedIcon {
  const fold = new Map<string, FoldedPack | null>();
  const packOf = (id: string) => { if (!fold.has(id)) fold.set(id, foldIconPack(id, get)); return fold.get(id) ?? null; };
  const entry = (g: IconOverride | string, pack: FoldedPack | null): { glyph: PackGlyph | null; pack: FoldedPack | null } => {
    if (typeof g === 'string') return GLYPH_REF.test(g) ? followRef(g, pack, get, 0) : followRef(`name:${g}`, pack, get, 0);
    return g.kind === 'ref' ? followRef(g.ref, pack, get, 0) : { glyph: g, pack };
  };
  // the per-name walk from level `start` down: the nearest pack with the name, falling through while allowed
  const byName = (n: string, start: number): ResolvedIcon => {
    for (let i = start; i < chain.length; i++) {
      const lv = chain[i];
      if (!lv.pack) continue;
      const p = packOf(lv.pack);
      if (!p) continue;
      const g = n ? p.glyphs[n] : undefined;
      if (g) { const r = entry(g, p); if (r.glyph) return { glyph: r.glyph, pack: r.pack?.id ?? p.id, packData: r.pack ?? p, scope: lv.scope, by: 'name', name: n }; }
      if (p.fallback === 'none') break;
    }
    return { ...FRAMEWORK, name: n };
  };
  // 1. overrides, nearest level first. A `name:<glyph>` override renames the spot: the name is looked up from that level
  //    down (its own pack first), and the framework glyph of that name is the floor.
  for (const [i, lv] of chain.entries()) {
    const o = spot && lv.overrides[spot];
    if (!o) continue;
    if (typeof o === 'string' && (o.startsWith('name:') || !GLYPH_REF.test(o))) {
      const n = o.startsWith('name:') ? o.slice(5) : o;
      const r = byName(n, i);
      return { ...r, scope: lv.scope, by: 'override' };
    }
    const r = entry(o, lv.pack ? packOf(lv.pack) : null);
    if (r.glyph) return { glyph: r.glyph, pack: r.pack?.id ?? '', packData: r.pack, scope: lv.scope, by: 'override', name };
  }
  // 2. per-spot entries, nearest pack first (a pack that says fallback: none stops the walk)
  for (const lv of chain) {
    if (!lv.pack) continue;
    const p = packOf(lv.pack);
    if (!p) continue;
    const s = spot ? p.spots[spot] : undefined;
    if (s !== undefined) { const r = entry(s, p); if (r.glyph) return { glyph: r.glyph, pack: r.pack?.id ?? p.id, packData: r.pack ?? p, scope: lv.scope, by: 'spot', name }; }
    if (p.fallback === 'none') break;
  }
  // 3. per-name entries, then the framework glyph
  return byName(name, 0);
}

/** The per-name path the Icon component takes (no spot): the same walk with per-name entries only. */
export function resolveIconName(name: string, chain: IconChainLevel[], get: PackGetter): ResolvedIcon {
  return resolveIcon('', name, chain, get);
}

/* ---------------------------------------------------------------- overrides and edits */

export interface IconOverrideRow { scope: string; spot: string; entry: IconOverride }

/** Every per-spot override in force for an app: hub-wide, app, then each sub scope; leaf scopes last. */
export function listIconOverrides(look: IconLook | null | undefined, hub: IconLevel | null | undefined): IconOverrideRow[] {
  const out: IconOverrideRow[] = [];
  for (const [spot, entry] of Object.entries(hub?.overrides ?? {})) out.push({ scope: 'global', spot, entry });
  for (const [spot, entry] of Object.entries(look?.overrides ?? {})) out.push({ scope: 'app', spot, entry });
  for (const [key, lv] of Object.entries(look?.scopes ?? {}).sort(([a], [b]) => a.localeCompare(b))) for (const [spot, entry] of Object.entries(lv.overrides)) out.push({ scope: key, spot, entry });
  return out;
}

const levelAt = (look: IconLook, key: string): IconLevel => (key === 'app' ? { pack: look.pack, overrides: look.overrides } : look.scopes[key] ?? { pack: '', overrides: {} });
const withLevel = (look: IconLook, key: string, lv: IconLevel): IconLook => {
  if (key === 'app') return { ...look, pack: lv.pack, overrides: lv.overrides };
  const scopes = { ...look.scopes };
  if (iconLevelEmpty(lv)) delete scopes[key]; else scopes[key] = lv;
  return { ...look, scopes };
};
const emptyLook = (): IconLook => ({ pack: '', overrides: {}, scopes: {} });

/** Pick the pack at a level of the app's document (`key` = `app` | `ui:<view>` | `plugin:<id>`); '' = inherit. */
export function setIconPack(look: IconLook | null | undefined, key: string, pack: string): IconLook {
  const l = look ?? emptyLook();
  const k = isIconSubScope(key) ? key : 'app';
  const lv = levelAt(l, k);
  return withLevel(l, k, normalizeIconLevel({ ...lv, pack }));
}

/** Set (entry) or remove (null) one spot's override at a level of the app's document. */
export function setIconOverride(look: IconLook | null | undefined, key: string, spot: string, entry: unknown | null): IconLook {
  const l = look ?? emptyLook();
  if (!SPOT_ID.test(spot)) return l;
  const k = isIconSubScope(key) ? key : 'app';
  const lv = levelAt(l, k);
  const overrides = { ...lv.overrides };
  const n = entry === null || entry === undefined ? null : normalizeOverride(entry);
  if (n) overrides[spot] = n; else delete overrides[spot];
  return withLevel(l, k, { pack: lv.pack, overrides });
}

/** Hub-wide: pick the pack ('' clears) and set / remove one spot's override on the appearance@1 block. */
export function setHubIconPack(hub: IconLevel | null | undefined, pack: string): IconLevel { return normalizeIconHub({ ...(hub ?? { pack: '', overrides: {} }), pack }); }
export function setHubIconOverride(hub: IconLevel | null | undefined, spot: string, entry: unknown | null): IconLevel {
  const h = hub ?? { pack: '', overrides: {} };
  if (!SPOT_ID.test(spot)) return h;
  const overrides = { ...h.overrides };
  const n = entry === null || entry === undefined ? null : normalizeOverride(entry);
  if (n) overrides[spot] = n; else delete overrides[spot];
  return { pack: h.pack, overrides };
}

/** Reset one spot at one level (`key` = app | ui:<view> | plugin:<id>); the pack pick stays. */
export function resetIconSpot(look: IconLook | null | undefined, spot: string, key = 'app'): IconLook { return setIconOverride(look, key, spot, null); }
/** Reset one sub scope: its pack pick and overrides go; the app level is untouched. */
export function resetIconScope(look: IconLook | null | undefined, key: string): IconLook {
  const l = look ?? emptyLook();
  if (!isIconSubScope(key)) return l;
  const scopes = { ...l.scopes };
  delete scopes[key];
  return { ...l, scopes };
}
/** Reset the app: the whole `icon` block goes (the app draws what its skins and brand say). */
export function resetIconApp(): IconLook { return emptyLook(); }
/** Reset hub-wide: the shared document's `icon` block goes. */
export function resetIconHub(): IconLevel { return { pack: '', overrides: {} }; }
/** Reset one hub-wide spot. */
export function resetHubIconSpot(hub: IconLevel | null | undefined, spot: string): IconLevel { return setHubIconOverride(hub, spot, null); }

/* ---------------------------------------------------------------- markup */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface GlyphStyle { style: string; grid: number; stroke: number; linecap: 'round' | 'square' | 'butt' }
const DEFAULT_STYLE: GlyphStyle = { style: 'outline', grid: 24, stroke: 1.75, linecap: 'round' };

/** The inner SVG elements of one glyph, drawn in `style` (the pack's); no literal colours, `currentColor` and tokens only. */
export function glyphInner(g: PackGlyph, style: GlyphStyle = DEFAULT_STYLE): string {
  if (g.kind === 'path') {
    const filled = g.fill || style.style === 'filled';
    const stroked = (d: string) => `<path d="${esc(d)}" fill="none" stroke="currentColor" stroke-width="${style.stroke}" stroke-linecap="${style.linecap}" stroke-linejoin="round"/>`;
    let main: string;
    if (!filled) main = stroked(g.d);
    else if (g.fill) main = `<path d="${esc(g.d)}" fill="currentColor"/>`;
    else { const { closed, open } = splitGlyph(g.d); main = (closed ? `<path d="${esc(closed)}" fill="currentColor"/>` : '') + (open ? stroked(open) : ''); }
    const second = g.secondary ? `<path d="${esc(g.secondary)}" fill="currentColor" opacity="var(--fx-opacity-tint, 0.14)"/>` : '';
    return second + main;
  }
  if (g.kind === 'svg') return g.svg; // already sanitised by icon-import (inner elements, viewBox-normalised to the grid)
  if (g.kind === 'png') return `<image href="${esc(g.png)}" x="0" y="0" width="${style.grid}" height="${style.grid}" preserveAspectRatio="xMidYMid meet"/>`;
  if (g.kind === 'font') return `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="${esc(g.font?.family ?? '')}" font-size="${Math.round(style.grid * 0.8)}" fill="currentColor">${esc(g.font?.char ?? '')}</text>`;
  return '';
}

/** Inline SVG for a resolved glyph at `size` px (a number of px, or a CSS size such as `var(--fx-size-icon)`). */
export function glyphMarkup(g: PackGlyph, style: GlyphStyle = DEFAULT_STYLE, size: number | string = 16, title?: string): string {
  const inner = glyphInner(g, style);
  if (!inner) return '';
  const sz = typeof size === 'number' ? String(size) : esc(size);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${style.grid} ${style.grid}" width="${sz}" height="${sz}" aria-hidden="${title ? 'false' : 'true'}"${title ? ` role="img" aria-label="${esc(title)}"` : ''}>${inner}</svg>`;
}

/** An app-icon tile: the pack's `appIcon` shape in the bg token, the glyph in the fg token, padded. */
export function appIconMarkup(g: PackGlyph, pack: Pick<FoldedPack, 'style' | 'grid' | 'stroke' | 'linecap' | 'appIcon'>, size: number | string = 64): string {
  const n = pack.grid;
  const pad = pack.appIcon.padding * n;
  const shapes: Record<string, string> = {
    circle: `<circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}"/>`,
    squircle: `<rect x="0" y="0" width="${n}" height="${n}" rx="${(n * 0.28).toFixed(2)}"/>`,
    rounded: `<rect x="0" y="0" width="${n}" height="${n}" rx="${(n * 0.16).toFixed(2)}"/>`,
    square: `<rect x="0" y="0" width="${n}" height="${n}"/>`,
  };
  const sz = typeof size === 'number' ? String(size) : esc(size);
  const scale = ((n - 2 * pad) / n).toFixed(4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${sz}" height="${sz}" aria-hidden="true"><g fill="var(--fx-${pack.appIcon.bg})">${shapes[pack.appIcon.shape] ?? shapes.squircle}</g><g transform="translate(${pad.toFixed(2)} ${pad.toFixed(2)}) scale(${scale})" style="color:var(--fx-${pack.appIcon.fg})">${glyphInner(g, pack)}</g></svg>`;
}

/** Normalize a raw glyph entry (path string or object) for callers that build entries by hand (the designer, imports). */
export function glyphEntry(raw: unknown): PackGlyph | null { return normalizeGlyph(raw); }

/** The base fields of a pack for `glyphMarkup` (normalized through the brand rules so legacy packs agree). */
export function packStyle(raw: unknown): GlyphStyle {
  const p = normalizeIconPack(dataOf(raw));
  return { style: p.style, grid: p.grid, stroke: p.stroke, linecap: p.linecap };
}
