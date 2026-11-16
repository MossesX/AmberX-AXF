/**
 * Icon rules (plain JS so the TypeScript engines, the build engine's validator, the console server and the CLI share
 * ONE copy): the data contracts of icon-map@1 and the extended icon-pack@1 (spec/ICON-MAP.md).
 *
 *   icon-map   the spot registry: `<app>:<area>/<slot>` → { kind, glyph, dynamic, size, tint, tags, label, help }
 *   icon-pack  a glyph set: per-name entries (`glyphs`), per-spot entries (`spots`), one source per glyph (path | svg |
 *              png | font | ref), `extends` (inherit@1), source + licence per pack and per glyph, a generator seed
 *
 * Everything here is pure data in → errors / normalized data out. Sizes are size tokens and tints are colour tokens,
 * never literal pixels or colours. The base icon-pack fields (style, grid, stroke, linecap, fallback) keep the rules of
 * brand-rules.mjs; this file adds the glyph sources, the spots and the pack metadata on top.
 */
import { GLYPH_NAME, ICON_LIMITS, ICON_STYLES, MARK_COLORS, PATH_DATA } from './brand-rules.mjs';

export const ICON_MAP_TYPE = 'icon-map';
export const ICON_PACK_TYPE = 'icon-pack';
export const ICON_MAP_CONTRACT = 'icon-map@1';
export const ICON_PACK_CONTRACT = 'icon-pack@1';

/** Spot kinds: a glyph in a control, a badge (glyph + tone, pill or dot), an app icon (a mark on a tile). */
export const SPOT_KINDS = ['icon', 'badge', 'app-icon'];
/** `<app>:<area>/<slot>` (cli/icon-map.mjs SPOT_ID is the same pattern). */
export const SPOT_ID = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*$/;
/** Named size tokens a spot may ask for; any `--fx-size-*` / `--fx-type-*` / `--fx-dens-*` token name is accepted too. */
export const SPOT_SIZES = ['icon', 'icon-button', 'badge', 'app-icon', 'inline'];
export const SIZE_TOKEN = /^--fx-(?:size|type|dens)-[a-z0-9-]+$/;
/** Colour tokens a spot may be tinted with (theme tokens, never literals). */
export const TINT_TOKENS = MARK_COLORS.filter((c) => c !== 'none');
/** Where one glyph draws from. */
export const GLYPH_SOURCES = ['path', 'svg', 'png', 'font', 'ref'];
export const PACK_SOURCE_KINDS = ['builtin', 'upload', 'url', 'library', 'generated', 'mixed'];
/** Generator styles (core/engines/icon-gen.ts). */
export const GEN_STYLES = ['line', 'solid', 'duotone', 'rounded', 'geometric', 'pixel'];
export const APP_ICON_SHAPES = ['circle', 'squircle', 'rounded', 'square'];
/** `pack:<pack id>/<glyph name>` (another pack's glyph) or `name:<glyph name>` (this pack's, or the framework's). */
export const GLYPH_REF = /^(?:pack:[a-z0-9][a-z0-9-]{1,47}\/[a-z][a-z0-9-]*|name:[a-z][a-z0-9-]*)$/;
export const PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
export const LICENSE_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
export const PACK_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

export const ICON_MAP_LIMITS = { spots: 4000, tags: 12, tagChars: 32, labelChars: 80, helpChars: 300, files: 8, appChars: 48, extendsDepth: 4 };
export const ICON_PACK_LIMITS = {
  glyphs: ICON_LIMITS.glyphs, spots: 4000, pathChars: ICON_LIMITS.pathChars, svgChars: 8000, pngChars: 64 * 1024, fontChars: 64,
  extendsDepth: 4, tags: 12, licenseChars: 120, urlChars: 400, seedChars: 64, padding: [0, 0.4],
};

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, lo, hi, d) => { const n = typeof v === 'number' && Number.isFinite(v) ? v : d; return Math.min(hi, Math.max(lo, n)); };
const tags = (v, max = 12, chars = 32) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, chars)).slice(0, max) : []);
const HTTPS = /^https:\/\/[^\s"'<>]{1,400}$/;

/* ---------------------------------------------------------------- spots */

/** `{ app, area, slot }` of a spot id, or null. */
export function parseSpotId(id) {
  if (typeof id !== 'string' || !SPOT_ID.test(id)) return null;
  const [app, rest] = id.split(':');
  const [area, slot] = rest.split('/');
  return { app, area, slot };
}

export function spotSizeOk(v) { return typeof v === 'string' && (SPOT_SIZES.includes(v) || SIZE_TOKEN.test(v)); }
export function spotTintOk(v) { return typeof v === 'string' && TINT_TOKENS.includes(v); }

/** One spot entry with every field present and in range (unknown fields dropped). */
export function normalizeSpot(id, raw) {
  const o = isObj(raw) ? raw : typeof raw === 'string' ? { glyph: raw } : {};
  const kind = SPOT_KINDS.includes(o.kind) ? o.kind : 'icon';
  const glyph = GLYPH_NAME.test(str(o.glyph, ICON_LIMITS.nameChars)) ? str(o.glyph, ICON_LIMITS.nameChars) : '';
  return {
    id,
    kind,
    glyph,
    dynamic: o.dynamic === true || (!glyph && o.dynamic !== false),
    size: spotSizeOk(o.size) ? o.size : kind === 'icon' ? 'icon' : kind,
    tint: spotTintOk(o.tint) ? o.tint : 'text',
    tags: tags(o.tags, ICON_MAP_LIMITS.tags, ICON_MAP_LIMITS.tagChars),
    label: str(o.label, ICON_MAP_LIMITS.labelChars),
    help: str(o.help, ICON_MAP_LIMITS.helpChars),
    files: tags(o.files, ICON_MAP_LIMITS.files, 200),
  };
}

/** The data of an icon-map asset, normalized: spots keyed by id (bad ids dropped), registry order kept. */
export function normalizeIconMap(raw) {
  const o = isObj(raw) ? raw : {};
  const spots = {};
  const src = isObj(o.spots) ? Object.entries(o.spots) : Array.isArray(o.spots) ? o.spots.map((s) => [isObj(s) ? s.id : '', s]) : [];
  for (const [id, s] of src.slice(0, ICON_MAP_LIMITS.spots)) if (SPOT_ID.test(id ?? '')) spots[id] = normalizeSpot(id, s);
  return {
    app: /^[a-z][a-z0-9-]*$/.test(str(o.app, ICON_MAP_LIMITS.appChars)) ? str(o.app, ICON_MAP_LIMITS.appChars) : 'all',
    spots,
    extends: PACK_ID.test(str(o.extends, 48)) ? str(o.extends, 48) : '',
    generatedAt: str(o.generatedAt, 40),
  };
}

export function iconMapErrors(raw) {
  const e = [];
  if (!isObj(raw)) return ['data must be an object'];
  if (raw.app !== undefined && (typeof raw.app !== 'string' || !/^[a-z][a-z0-9-]*$/.test(raw.app))) e.push('data.app must be an app id (lowercase, digits, dashes) or "all"');
  if (raw.extends !== undefined && (typeof raw.extends !== 'string' || !PACK_ID.test(raw.extends))) e.push('data.extends must be an icon-map asset id');
  if (!isObj(raw.spots) && !Array.isArray(raw.spots)) { e.push('data.spots must be an object of spot id → spot'); return e; }
  const entries = isObj(raw.spots) ? Object.entries(raw.spots) : raw.spots.map((s) => [isObj(s) ? s.id : s, s]);
  if (entries.length > ICON_MAP_LIMITS.spots) e.push(`data.spots: at most ${ICON_MAP_LIMITS.spots} spots`);
  const seen = new Set();
  for (const [id, s] of entries) {
    if (typeof id !== 'string' || !SPOT_ID.test(id)) { e.push(`data.spots.${String(id)}: a spot id is <app>:<area>/<slot> (lowercase, digits, dashes, dots)`); continue; }
    if (seen.has(id)) e.push(`data.spots.${id}: listed twice`);
    seen.add(id);
    if (!isObj(s) && typeof s !== 'string') { e.push(`data.spots.${id}: must be an object (or a glyph name)`); continue; }
    if (!isObj(s)) continue;
    if (s.kind !== undefined && !SPOT_KINDS.includes(s.kind)) e.push(`data.spots.${id}.kind must be one of ${SPOT_KINDS.join(', ')}`);
    if (s.glyph !== undefined && s.glyph !== '' && (typeof s.glyph !== 'string' || !GLYPH_NAME.test(s.glyph))) e.push(`data.spots.${id}.glyph must be a glyph name (lowercase words with dashes)`);
    if (!s.glyph && s.dynamic === false) e.push(`data.spots.${id}: a spot with no glyph is dynamic`);
    if (s.size !== undefined && !spotSizeOk(s.size)) e.push(`data.spots.${id}.size must be ${SPOT_SIZES.join(' | ')} or a --fx-size-* token name`);
    if (s.tint !== undefined && !spotTintOk(s.tint)) e.push(`data.spots.${id}.tint must be a colour token (${TINT_TOKENS.join(', ')})`);
    if (s.tags !== undefined && (!Array.isArray(s.tags) || s.tags.some((t) => typeof t !== 'string'))) e.push(`data.spots.${id}.tags must be a list of words`);
  }
  return e;
}

/* ---------------------------------------------------------------- glyphs */

/** The source kind a raw glyph entry draws from, or '' when it has none. A string is path data. */
export function glyphSourceOf(raw) {
  if (typeof raw === 'string') return raw.trim() ? 'path' : '';
  if (!isObj(raw)) return '';
  if (typeof raw.d === 'string' && raw.d.trim()) return 'path';
  if (typeof raw.svg === 'string' && raw.svg.trim()) return 'svg';
  if (typeof raw.png === 'string' && raw.png.trim()) return 'png';
  if (isObj(raw.font)) return 'font';
  if (typeof raw.ref === 'string' && raw.ref.trim()) return 'ref';
  return '';
}

function normalizeSource(raw) {
  if (!isObj(raw)) return null;
  const kind = PACK_SOURCE_KINDS.includes(raw.kind) ? raw.kind : '';
  if (!kind) return null;
  const out = { kind };
  if (HTTPS.test(str(raw.url, ICON_PACK_LIMITS.urlChars))) out.url = str(raw.url, ICON_PACK_LIMITS.urlChars);
  if (str(raw.library, 64)) out.library = str(raw.library, 64);
  if (str(raw.importedAt, 40)) out.importedAt = str(raw.importedAt, 40);
  return out;
}

function normalizeLicense(raw) {
  if (typeof raw === 'string') return LICENSE_ID.test(raw) ? { id: raw } : null;
  if (!isObj(raw) || !LICENSE_ID.test(str(raw.id, 64))) return null;
  const out = { id: str(raw.id, 64) };
  if (str(raw.holder, ICON_PACK_LIMITS.licenseChars)) out.holder = str(raw.holder, ICON_PACK_LIMITS.licenseChars);
  if (HTTPS.test(str(raw.url, ICON_PACK_LIMITS.urlChars))) out.url = str(raw.url, ICON_PACK_LIMITS.urlChars);
  return out;
}

/**
 * One glyph entry: `{ kind, d, secondary, fill, svg, png, font, ref, source, license, tags }`. The base shape
 * `{ d, fill, secondary }` (brand-rules Glyph) is kept so `glyphFor` / `glyphSvg` keep drawing path glyphs. Null when
 * the entry has no usable source (the validator reports why).
 */
export function normalizeGlyph(raw) {
  const kind = glyphSourceOf(raw);
  if (!kind) return null;
  const o = typeof raw === 'string' ? { d: raw } : raw;
  const g = { kind, d: '', secondary: '', fill: o.fill === true, svg: '', png: '', font: null, ref: '', source: normalizeSource(o.source), license: normalizeLicense(o.license), tags: tags(o.tags) };
  if (kind === 'path') {
    const d = str(o.d, ICON_PACK_LIMITS.pathChars);
    if (!PATH_DATA.test(d)) return null;
    g.d = d;
    g.secondary = typeof o.secondary === 'string' && PATH_DATA.test(o.secondary) ? o.secondary.slice(0, ICON_PACK_LIMITS.pathChars) : '';
  } else if (kind === 'svg') g.svg = str(o.svg, ICON_PACK_LIMITS.svgChars);
  else if (kind === 'png') { const p = str(o.png, ICON_PACK_LIMITS.pngChars + 32); if (!PNG_DATA_URI.test(p) || p.length > ICON_PACK_LIMITS.pngChars) return null; g.png = p; }
  else if (kind === 'font') { const family = str(o.font.family, ICON_PACK_LIMITS.fontChars); const ch = str(o.font.char, 8); if (!family || !ch) return null; g.font = { family, char: ch }; }
  else if (kind === 'ref') { const r = str(o.ref, 160); if (!GLYPH_REF.test(r)) return null; g.ref = r; }
  return g;
}

/** Why a raw glyph entry is refused (at `where`), as messages; empty when it is fine. */
export function glyphErrors(raw, where) {
  const e = [];
  if (typeof raw !== 'string' && !isObj(raw)) return [`${where}: must be a path string or a glyph object`];
  const kind = glyphSourceOf(raw);
  if (!kind) return [`${where}: needs one of d (path), svg, png, font or ref`];
  const o = typeof raw === 'string' ? { d: raw } : raw;
  const sources = ['d', 'svg', 'png', 'font', 'ref'].filter((k) => o[k] !== undefined && o[k] !== '' && o[k] !== null);
  if (sources.length > 1) e.push(`${where}: one source only (has ${sources.join(', ')})`);
  if (kind === 'path') {
    if (!PATH_DATA.test(o.d)) e.push(`${where}.d: path commands and numbers only`);
    else if (o.d.length > ICON_PACK_LIMITS.pathChars) e.push(`${where}.d: at most ${ICON_PACK_LIMITS.pathChars} characters`);
    if (o.secondary !== undefined && o.secondary !== '' && (typeof o.secondary !== 'string' || !PATH_DATA.test(o.secondary))) e.push(`${where}.secondary: path commands and numbers only`);
  }
  if (kind === 'svg' && o.svg.length > ICON_PACK_LIMITS.svgChars) e.push(`${where}.svg: at most ${ICON_PACK_LIMITS.svgChars} characters (run it through the import engine)`);
  if (kind === 'svg' && /<script|on[a-z]+\s*=|javascript:|<foreignObject|xlink:href\s*=\s*["']?(?!#)|href\s*=\s*["']?https?:/i.test(o.svg)) e.push(`${where}.svg: scripts, event handlers and external references are refused (sanitise with core/engines/icon-import.ts)`);
  if (kind === 'png') { if (!PNG_DATA_URI.test(o.png)) e.push(`${where}.png: a data:image/png;base64 URI`); else if (o.png.length > ICON_PACK_LIMITS.pngChars) e.push(`${where}.png: at most ${ICON_PACK_LIMITS.pngChars} characters`); }
  if (kind === 'font' && (!str(o.font.family, 64) || !str(o.font.char, 8))) e.push(`${where}.font: needs family and char`);
  if (kind === 'ref' && !GLYPH_REF.test(o.ref)) e.push(`${where}.ref: pack:<pack id>/<glyph name> or name:<glyph name>`);
  if (o.source !== undefined && (!isObj(o.source) || !PACK_SOURCE_KINDS.includes(o.source.kind))) e.push(`${where}.source.kind must be one of ${PACK_SOURCE_KINDS.join(', ')}`);
  if (o.license !== undefined && !normalizeLicense(o.license)) e.push(`${where}.license: { id: SPDX id or "proprietary", holder?, url? }`);
  return e;
}

/* ---------------------------------------------------------------- packs */

/** The data of an icon-pack asset with every extended field normalized; base fields follow brand-rules. */
export function normalizeIconPackFull(raw) {
  const o = isObj(raw) ? raw : {};
  const glyphs = {};
  if (isObj(o.glyphs)) for (const [name, g] of Object.entries(o.glyphs).slice(0, ICON_PACK_LIMITS.glyphs)) {
    if (!GLYPH_NAME.test(name) || name.length > ICON_LIMITS.nameChars) continue;
    const n = normalizeGlyph(g);
    if (n) glyphs[name] = n;
  }
  const spots = {};
  if (isObj(o.spots)) for (const [id, g] of Object.entries(o.spots).slice(0, ICON_PACK_LIMITS.spots)) {
    if (!SPOT_ID.test(id)) continue;
    if (typeof g === 'string' && GLYPH_NAME.test(g)) { spots[id] = g; continue; }
    const n = normalizeGlyph(g);
    if (n) spots[id] = n;
  }
  const seed = isObj(o.seed) && str(o.seed.seed, ICON_PACK_LIMITS.seedChars) ? { seed: str(o.seed.seed, ICON_PACK_LIMITS.seedChars), style: GEN_STYLES.includes(o.seed.style) ? o.seed.style : 'line', grammar: str(o.seed.grammar, 24) || 'icon-gen@1' } : null;
  const ai = isObj(o.appIcon) ? o.appIcon : {};
  return {
    style: ICON_STYLES.includes(o.style) ? o.style : 'outline',
    grid: num(o.grid, ICON_LIMITS.grid[0], ICON_LIMITS.grid[1], 24),
    stroke: num(o.stroke, ICON_LIMITS.stroke[0], ICON_LIMITS.stroke[1], 1.75),
    linecap: ['round', 'square', 'butt'].includes(o.linecap) ? o.linecap : 'round',
    fallback: o.fallback === 'none' ? 'none' : 'framework',
    glyphs,
    spots,
    extends: PACK_ID.test(str(o.extends, 48)) ? str(o.extends, 48) : '',
    source: normalizeSource(o.source),
    license: normalizeLicense(o.license),
    seed,
    appIcon: { shape: APP_ICON_SHAPES.includes(ai.shape) ? ai.shape : 'squircle', bg: TINT_TOKENS.includes(ai.bg) ? ai.bg : 'accent', fg: TINT_TOKENS.includes(ai.fg) ? ai.fg : 'accentText', padding: num(ai.padding, ICON_PACK_LIMITS.padding[0], ICON_PACK_LIMITS.padding[1], 0.2) },
    tags: tags(o.tags),
  };
}

/** Errors of the extended icon-pack fields (the base fields are checked by brand-rules iconPackErrors). */
export function iconPackExtendedErrors(raw) {
  const e = [];
  if (!isObj(raw)) return [];
  if (raw.linecap !== undefined && !['round', 'square', 'butt'].includes(raw.linecap)) e.push('data.linecap must be round, square or butt');
  if (raw.fallback !== undefined && !['framework', 'none'].includes(raw.fallback)) e.push('data.fallback must be framework or none');
  if (isObj(raw.glyphs)) for (const [name, g] of Object.entries(raw.glyphs)) if (GLYPH_NAME.test(name)) e.push(...glyphErrors(g, `data.glyphs.${name}`));
  if (raw.spots !== undefined) {
    if (!isObj(raw.spots)) e.push('data.spots must be an object of spot id → glyph (or a glyph name)');
    else {
      if (Object.keys(raw.spots).length > ICON_PACK_LIMITS.spots) e.push(`data.spots: at most ${ICON_PACK_LIMITS.spots} entries`);
      for (const [id, g] of Object.entries(raw.spots)) {
        if (!SPOT_ID.test(id)) { e.push(`data.spots.${id}: a spot id is <app>:<area>/<slot>`); continue; }
        if (typeof g === 'string' && GLYPH_NAME.test(g)) { if (!isObj(raw.glyphs) || !(g in raw.glyphs)) e.push(`data.spots.${id}: names glyph "${g}" which data.glyphs lacks`); continue; }
        e.push(...glyphErrors(g, `data.spots.${id}`));
      }
    }
  }
  if (raw.extends !== undefined && (typeof raw.extends !== 'string' || !PACK_ID.test(raw.extends))) e.push('data.extends must be an icon-pack asset id');
  if (raw.source !== undefined && !normalizeSource(raw.source)) e.push(`data.source.kind must be one of ${PACK_SOURCE_KINDS.join(', ')}`);
  if (raw.license !== undefined && !normalizeLicense(raw.license)) e.push('data.license: { id: SPDX id or "proprietary", holder?, url? }');
  if (raw.seed !== undefined) {
    if (!isObj(raw.seed) || typeof raw.seed.seed !== 'string' || !raw.seed.seed.trim()) e.push('data.seed needs seed (text)');
    else if (raw.seed.style !== undefined && !GEN_STYLES.includes(raw.seed.style)) e.push(`data.seed.style must be one of ${GEN_STYLES.join(', ')}`);
  }
  if (raw.appIcon !== undefined) {
    if (!isObj(raw.appIcon)) e.push('data.appIcon must be an object');
    else {
      if (raw.appIcon.shape !== undefined && !APP_ICON_SHAPES.includes(raw.appIcon.shape)) e.push(`data.appIcon.shape must be one of ${APP_ICON_SHAPES.join(', ')}`);
      for (const k of ['bg', 'fg']) if (raw.appIcon[k] !== undefined && !TINT_TOKENS.includes(raw.appIcon[k])) e.push(`data.appIcon.${k} must be a colour token`);
      if (raw.appIcon.padding !== undefined && (typeof raw.appIcon.padding !== 'number' || raw.appIcon.padding < 0 || raw.appIcon.padding > ICON_PACK_LIMITS.padding[1])) e.push(`data.appIcon.padding must be 0–${ICON_PACK_LIMITS.padding[1]}`);
    }
  }
  return e;
}

/** Errors for either icon type, or null when `type` is neither (so validators can call it blind). */
export function iconAssetErrors(type, data) {
  if (type === ICON_MAP_TYPE) return iconMapErrors(data);
  if (type === ICON_PACK_TYPE) return iconPackExtendedErrors(data);
  return null;
}

/* ---------------------------------------------------------------- JSON Schema */

const glyphSchema = () => ({
  oneOf: [
    { type: 'string', description: 'path data' },
    {
      type: 'object',
      description: 'one of d | svg | png | font | ref',
      properties: {
        d: { type: 'string', maxLength: ICON_PACK_LIMITS.pathChars }, secondary: { type: 'string' }, fill: { type: 'boolean' },
        svg: { type: 'string', maxLength: ICON_PACK_LIMITS.svgChars }, png: { type: 'string', pattern: '^data:image/png;base64,' },
        font: { type: 'object', required: ['family', 'char'], properties: { family: { type: 'string' }, char: { type: 'string' } } },
        ref: { type: 'string', pattern: GLYPH_REF.source },
        source: { $ref: '#/$defs/source' }, license: { $ref: '#/$defs/license' }, tags: { type: 'array', items: { type: 'string' } },
      },
    },
  ],
});

/** JSON Schema properties (+ $defs) for editors, from the same constants. */
export function iconSchemaProperties(type) {
  const $defs = {
    source: { type: 'object', required: ['kind'], properties: { kind: { enum: PACK_SOURCE_KINDS }, url: { type: 'string' }, library: { type: 'string' }, importedAt: { type: 'string' } } },
    license: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: LICENSE_ID.source }, holder: { type: 'string' }, url: { type: 'string' } } },
  };
  if (type === ICON_MAP_TYPE) {
    return {
      $defs,
      properties: {
        app: { type: 'string' },
        extends: { type: 'string', pattern: PACK_ID.source },
        generatedAt: { type: 'string' },
        spots: {
          type: 'object',
          propertyNames: { pattern: SPOT_ID.source },
          additionalProperties: {
            type: 'object',
            properties: { kind: { enum: SPOT_KINDS }, glyph: { type: 'string' }, dynamic: { type: 'boolean' }, size: { type: 'string' }, tint: { enum: TINT_TOKENS }, tags: { type: 'array', items: { type: 'string' } }, label: { type: 'string', maxLength: ICON_MAP_LIMITS.labelChars }, help: { type: 'string', maxLength: ICON_MAP_LIMITS.helpChars }, files: { type: 'array', items: { type: 'string' } } },
          },
        },
      },
    };
  }
  if (type === ICON_PACK_TYPE) {
    return {
      $defs: { ...$defs, glyph: glyphSchema() },
      properties: {
        style: { enum: ICON_STYLES }, grid: { type: 'number', minimum: ICON_LIMITS.grid[0], maximum: ICON_LIMITS.grid[1] }, stroke: { type: 'number', minimum: ICON_LIMITS.stroke[0], maximum: ICON_LIMITS.stroke[1] },
        linecap: { enum: ['round', 'square', 'butt'] }, fallback: { enum: ['framework', 'none'] },
        glyphs: { type: 'object', propertyNames: { pattern: GLYPH_NAME.source }, additionalProperties: { $ref: '#/$defs/glyph' } },
        spots: { type: 'object', propertyNames: { pattern: SPOT_ID.source }, additionalProperties: { oneOf: [{ type: 'string', pattern: GLYPH_NAME.source }, { $ref: '#/$defs/glyph' }] } },
        extends: { type: 'string', pattern: PACK_ID.source },
        source: { $ref: '#/$defs/source' }, license: { $ref: '#/$defs/license' },
        seed: { type: 'object', required: ['seed'], properties: { seed: { type: 'string' }, style: { enum: GEN_STYLES }, grammar: { type: 'string' } } },
        appIcon: { type: 'object', properties: { shape: { enum: APP_ICON_SHAPES }, bg: { enum: TINT_TOKENS }, fg: { enum: TINT_TOKENS }, padding: { type: 'number', minimum: 0, maximum: ICON_PACK_LIMITS.padding[1] } } },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
  }
  return { $defs: {}, properties: {} };
}
