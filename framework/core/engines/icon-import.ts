/**
 * Icon import (icon-import@1, spec/ICON-MAP.md): the one path every icon takes into a pack, whether it was dropped as a
 * file, pasted as text, fetched from a URL or picked from an open library. Pure, no DOM: the SVG is walked with a small
 * tokenizer, never parsed by a browser, so the same input gives the same output in Node, the console server and a port.
 *
 *   sanitizeSvg(text)              strip scripts, event handlers, external references, foreign objects, styles with
 *                                  url() / @import, unknown elements; keep the drawing elements and safe attributes
 *   normalizeSvg(text, grid)       sanitize + fit the viewBox to a square grid (24 by default) with a wrapping group, so
 *                                  every imported glyph lands on the pack's grid; fills and strokes become currentColor
 *   importSvg(text, meta)          a PackGlyph (`kind: svg`, or `kind: path` when the SVG is paths only) + report
 *   importPng(dataUri, meta)       a PackGlyph (`kind: png`) after the size cap and header checks
 *   importGlyph(input, meta)       picks by content: SVG text, a PNG data URI, or path data
 *
 * Fixture: spec/fixtures/icon-import.json. Kotlin twin deferred (PORTING.md).
 */
import { PATH_DATA } from './brand-rules.mjs';
import { ICON_PACK_LIMITS, normalizeGlyph, PNG_DATA_URI, type GlyphLicense, type GlyphSourceMeta, type PackGlyph } from './icon-rules.mjs';

export const ICON_IMPORT_CONTRACT = 'icon-import@1';
export const IMPORT_GRID = 24;
export const IMPORT_SVG_MAX_INPUT = 256 * 1024;

/** Drawing elements an imported SVG may keep. */
export const SAFE_ELEMENTS = ['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'clipPath', 'mask', 'use', 'title', 'desc', 'symbol'];
/** Attributes kept on those elements (presentation attributes that draw; colours are rewritten to currentColor). */
export const SAFE_ATTRIBUTES = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'transform', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'clip-path', 'clip-rule', 'mask', 'id', 'viewBox', 'href', 'xlink:href', 'vector-effect', 'paint-order'];
/** What a sanitizer pass removed, so the designer can say "2 scripts and a link were dropped". */
export interface ImportReport {
  removedElements: string[];
  removedAttributes: string[];
  colorsMapped: number;
  viewBox: [number, number, number, number] | null;
  scaled: boolean;
  /** why the input was refused, when it was */
  refused?: string;
}

const esc = (s: string) => s.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (v: number) => { const s = (Math.round(v * 1000) / 1000).toString(); return s === '-0' ? '0' : s; };

/* ---------------------------------------------------------------- tokenizer */

interface Tag { kind: 'open' | 'close' | 'self' | 'text'; name: string; attrs: Record<string, string>; text: string }

/** A forgiving SVG tokenizer: comments, CDATA, doctypes and processing instructions are dropped; tags and text kept. */
export function tokenizeSvg(text: string): Tag[] {
  const src = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const out: Tag[] = [];
  const re = /<\/?([A-Za-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[4] !== undefined) { const t = m[4]; if (t.trim()) out.push({ kind: 'text', name: '', attrs: {}, text: t }); continue; }
    const close = m[0].startsWith('</');
    const attrs: Record<string, string> = {};
    const ar = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[2] ?? ''))) attrs[a[1]] = (a[2] ?? a[3] ?? a[4] ?? '').trim();
    out.push({ kind: close ? 'close' : m[3] ? 'self' : 'open', name: m[1], attrs, text: '' });
  }
  return out;
}

/* ---------------------------------------------------------------- sanitize */

const DANGEROUS_ELEMENTS = /^(script|foreignObject|iframe|object|embed|video|audio|image|animate|animateTransform|animateMotion|set|style|font|font-face|cursor|filter|feImage|handler|listener)$/i;
/** Wrappers that go while their children stay (a link around a shape, a conditional group). */
const UNWRAP_ELEMENTS = /^(a|switch)$/i;
const COLOR_ATTRS = new Set(['fill', 'stroke']);
const KEEP_COLOR = new Set(['none', 'currentColor', 'inherit', 'transparent']);

/** True when an attribute value could reach outside the glyph (a URL, a script, a data URI). */
export function unsafeValue(v: string): boolean {
  const s = v.trim().toLowerCase();
  return /javascript:|data:|url\(|@import|expression\(|^https?:|^\/\//.test(s) || (s.startsWith('#') === false && /^[a-z]+:/.test(s) && !s.startsWith('#'));
}

/**
 * Keep only drawing elements and safe attributes. `href` / `xlink:href` must be an in-document `#id`; every other value
 * with a URL, a script or a data URI goes; `fill` / `stroke` colours (hex, rgb(), named) become `currentColor`
 * (`none` stays), so the glyph follows the theme. Returns the inner elements (no outer <svg>) and the report.
 */
export function sanitizeSvg(text: string): { inner: string; viewBox: [number, number, number, number] | null; width: number; height: number; report: ImportReport } {
  const report: ImportReport = { removedElements: [], removedAttributes: [], colorsMapped: 0, viewBox: null, scaled: false };
  if (typeof text !== 'string' || text.length > IMPORT_SVG_MAX_INPUT) { report.refused = `SVG text is missing or over ${IMPORT_SVG_MAX_INPUT} characters`; return { inner: '', viewBox: null, width: 0, height: 0, report }; }
  const tokens = tokenizeSvg(text);
  let viewBox: [number, number, number, number] | null = null, width = 0, height = 0;
  let depthSkip = 0, skipName = '';
  const out: string[] = [];
  const stack: string[] = [];
  for (const t of tokens) {
    if (depthSkip) {
      // inside a dropped element: skip everything until its close
      if (t.kind === 'open' && t.name === skipName) depthSkip++;
      if (t.kind === 'close' && t.name === skipName) depthSkip--;
      continue;
    }
    if (t.kind === 'text') { if (stack[stack.length - 1] === 'title' || stack[stack.length - 1] === 'desc') out.push(esc(t.text.trim())); continue; }
    const name = t.name;
    if (t.kind === 'close') {
      if (stack.length && stack[stack.length - 1] === `~${name}`) { stack.pop(); continue; } // an unwrapped wrapper closes silently
      if (stack.length && stack[stack.length - 1] === name) { stack.pop(); if (name !== 'svg') out.push(`</${name}>`); }
      continue;
    }
    if (name === 'svg') {
      if (stack.includes('svg')) { report.removedElements.push('svg'); if (t.kind === 'open') { depthSkip = 1; skipName = name; } continue; }
      const vb = (t.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
      if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) viewBox = [vb[0], vb[1], vb[2], vb[3]];
      width = parseFloat(t.attrs.width ?? '') || 0; height = parseFloat(t.attrs.height ?? '') || 0;
      if (t.kind === 'open') stack.push('svg');
      continue;
    }
    if (UNWRAP_ELEMENTS.test(name)) { report.removedElements.push(name); if (t.kind === 'open') stack.push(`~${name}`); continue; }
    if (DANGEROUS_ELEMENTS.test(name) || !SAFE_ELEMENTS.includes(name)) {
      report.removedElements.push(name);
      if (t.kind === 'open') { depthSkip = 1; skipName = name; }
      continue;
    }
    const attrs: string[] = [];
    for (const [k, v] of Object.entries(t.attrs)) {
      const key = k === 'xlink:href' ? 'href' : k;
      if (/^on/i.test(key) || !SAFE_ATTRIBUTES.includes(key) || key === 'viewBox') { report.removedAttributes.push(`${name}@${k}`); continue; }
      if (key === 'href') { if (!/^#[A-Za-z_][\w.:-]*$/.test(v)) { report.removedAttributes.push(`${name}@${k}`); continue; } attrs.push(`href="${esc(v)}"`); continue; }
      if (unsafeValue(v) && !COLOR_ATTRS.has(key)) { report.removedAttributes.push(`${name}@${k}`); continue; }
      if (COLOR_ATTRS.has(key)) {
        const val = v.trim();
        if (KEEP_COLOR.has(val)) { attrs.push(`${key}="${val === 'inherit' ? 'currentColor' : val}"`); continue; }
        // a gradient or pattern fill is a literal colour by another name: it becomes currentColor like any hex
        if (/^url\(/i.test(val)) { attrs.push(`${key}="currentColor"`); report.colorsMapped++; continue; }
        attrs.push(`${key}="currentColor"`); report.colorsMapped++; continue;
      }
      if (key === 'd' && !PATH_DATA.test(v)) { report.removedAttributes.push(`${name}@d`); continue; }
      if (v.length > ICON_PACK_LIMITS.svgChars) { report.removedAttributes.push(`${name}@${k}`); continue; }
      attrs.push(`${key}="${esc(v)}"`);
    }
    const open = `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
    if (t.kind === 'self') out.push(`${open}/>`); else { out.push(`${open}>`); stack.push(name); }
  }
  // close anything left open (a truncated paste)
  while (stack.length) { const n = stack.pop(); if (n && n !== 'svg' && !n.startsWith('~')) out.push(`</${n}>`); }
  report.viewBox = viewBox;
  return { inner: out.join(''), viewBox, width, height, report };
}

/* ---------------------------------------------------------------- normalize */

/**
 * Sanitize and fit the drawing to a `grid` × `grid` box: a wrapping <g transform> scales the source viewBox (or the
 * width / height, or the drawing's own 24 grid when nothing says) to the grid and centres it. Elements that were only
 * `<path>`s with no transform and a matching viewBox come back as plain path data too (`paths`), so a clean import
 * can be stored as a path glyph (smaller, restylable by the pack's stroke).
 */
export function normalizeSvg(text: string, grid = IMPORT_GRID): { inner: string; paths: string; report: ImportReport } {
  const s = sanitizeSvg(text);
  if (s.report.refused) return { inner: '', paths: '', report: s.report };
  if (!s.inner.trim()) { s.report.refused = 'nothing drawable was left after sanitising'; return { inner: '', paths: '', report: s.report }; }
  const vb = s.viewBox ?? (s.width > 0 && s.height > 0 ? [0, 0, s.width, s.height] as [number, number, number, number] : [0, 0, grid, grid] as [number, number, number, number]);
  const scale = grid / Math.max(vb[2], vb[3]);
  const dx = -vb[0] * scale + (grid - vb[2] * scale) / 2;
  const dy = -vb[1] * scale + (grid - vb[3] * scale) / 2;
  const identity = Math.abs(scale - 1) < 1e-9 && Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9;
  s.report.scaled = !identity;
  const inner = identity ? s.inner : `<g transform="translate(${r2(dx)} ${r2(dy)}) scale(${r2(scale)})">${s.inner}</g>`;
  // paths only, untransformed, on the grid already → plain path data
  const onlyPaths = /^(?:<path [^>]*\/>)+$/.test(s.inner) && identity && !/transform=/.test(s.inner);
  const paths = onlyPaths ? [...s.inner.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]).join('') : '';
  return { inner: inner.length > ICON_PACK_LIMITS.svgChars ? '' : inner, paths: PATH_DATA.test(paths) && paths.length <= ICON_PACK_LIMITS.pathChars ? paths : '', report: inner.length > ICON_PACK_LIMITS.svgChars ? { ...s.report, refused: `the glyph is over ${ICON_PACK_LIMITS.svgChars} characters after normalising (simplify it first)` } : s.report };
}

/* ---------------------------------------------------------------- imports */

export interface ImportMeta {
  source?: Partial<GlyphSourceMeta> & { kind: GlyphSourceMeta['kind'] };
  license?: GlyphLicense | string;
  tags?: string[];
  grid?: number;
  /** keep inline SVG even when the drawing is paths only */
  keepSvg?: boolean;
}

export interface ImportResult { glyph: PackGlyph | null; report: ImportReport }

const metaOf = (meta: ImportMeta) => ({ source: meta.source ? { kind: meta.source.kind, ...(meta.source.url ? { url: meta.source.url } : {}), ...(meta.source.library ? { library: meta.source.library } : {}), ...(meta.source.importedAt ? { importedAt: meta.source.importedAt } : {}) } : undefined, license: meta.license, tags: meta.tags });

/** SVG text → a pack glyph: path data when the drawing was clean paths on the grid, else sanitised inner SVG. */
export function importSvg(text: string, meta: ImportMeta = {}): ImportResult {
  const n = normalizeSvg(text, meta.grid ?? IMPORT_GRID);
  if (n.report.refused) return { glyph: null, report: n.report };
  const glyph = normalizeGlyph(n.paths && !meta.keepSvg ? { d: n.paths, ...metaOf(meta) } : { svg: n.inner, ...metaOf(meta) });
  return { glyph, report: glyph ? n.report : { ...n.report, refused: 'the glyph did not pass the pack rules' } };
}

/** PNG signature in base64 (`\x89PNG\r\n\x1a\n` → `iVBORw0KGgo`). */
const PNG_B64_HEAD = 'iVBORw0KGgo';

/** A PNG data URI → a pack glyph after the header and size checks (`ICON_PACK_LIMITS.pngChars`). */
export function importPng(dataUri: string, meta: ImportMeta = {}): ImportResult {
  const report: ImportReport = { removedElements: [], removedAttributes: [], colorsMapped: 0, viewBox: null, scaled: false };
  const v = (dataUri ?? '').trim();
  if (!PNG_DATA_URI.test(v)) return { glyph: null, report: { ...report, refused: 'not a data:image/png;base64 URI' } };
  if (!v.slice('data:image/png;base64,'.length).startsWith(PNG_B64_HEAD)) return { glyph: null, report: { ...report, refused: 'the data is not a PNG (bad signature)' } };
  if (v.length > ICON_PACK_LIMITS.pngChars) return { glyph: null, report: { ...report, refused: `PNG over the cap (${ICON_PACK_LIMITS.pngChars} characters ≈ ${Math.round((ICON_PACK_LIMITS.pngChars * 3) / 4 / 1024)} KB); shrink it first` } };
  const glyph = normalizeGlyph({ png: v, ...metaOf(meta) });
  return { glyph, report: glyph ? report : { ...report, refused: 'the glyph did not pass the pack rules' } };
}

/** Bytes of a PNG data URI (for the designer's size line). */
export function pngBytes(dataUri: string): number {
  const b = (dataUri ?? '').split(',')[1] ?? '';
  return Math.floor((b.length * 3) / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0);
}

/** Pick the importer by content: SVG text, a PNG data URI, or bare path data. */
export function importGlyph(input: string, meta: ImportMeta = {}): ImportResult {
  const v = (input ?? '').trim();
  if (v.startsWith('data:image/png')) return importPng(v, meta);
  if (/<svg[\s>]/i.test(v) || /^<(path|g|circle|rect|polygon|polyline|line|ellipse)\b/i.test(v)) return importSvg(/<svg[\s>]/i.test(v) ? v : `<svg viewBox="0 0 ${meta.grid ?? IMPORT_GRID} ${meta.grid ?? IMPORT_GRID}">${v}</svg>`, meta);
  if (PATH_DATA.test(v) && v.length <= ICON_PACK_LIMITS.pathChars) {
    const glyph = normalizeGlyph({ d: v, ...metaOf(meta) });
    return { glyph, report: { removedElements: [], removedAttributes: [], colorsMapped: 0, viewBox: null, scaled: false, ...(glyph ? {} : { refused: 'path data refused' }) } };
  }
  return { glyph: null, report: { removedElements: [], removedAttributes: [], colorsMapped: 0, viewBox: null, scaled: false, refused: 'not SVG, PNG or path data' } };
}
