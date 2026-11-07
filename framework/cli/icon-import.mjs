#!/usr/bin/env node
/**
 * Icon import — the framework's icon library (icon-library@1) and the SVG → icon-pack@1 converter (build
 * icon-browser-manager, Brett, Nov 7 2026: "Ship a starter library: download a couple thousand icons (open-licensed
 * sets), stored as assets.").
 *
 *   node framework/cli/icon-import.mjs sets                                  the open-licensed sets this tool knows
 *   node framework/cli/icon-import.mjs fetch [set|all] [--dir <cache>]       download the sets' npm tarballs into a cache
 *   node framework/cli/icon-import.mjs build [set|all] [--dir <cache>]       convert the cached sets into framework/icon-library
 *   node framework/cli/icon-import.mjs convert <svg folder> --id <pack id> [--name …] [--style outline|filled]
 *                                     [--grid 24] [--stroke 2] [--linecap round] [--out <dir>] [--category <c>]
 *                                                                            any folder of SVG files → icon-pack assets (≤ 600 glyphs each)
 *   node framework/cli/icon-import.mjs library [--check] [--json]            what the library holds; --check = every pack is a
 *                                                                            valid icon-pack@1, counts and files agree, size budget kept (CI)
 *
 * The library: framework/icon-library/index.json (icon-library@1: sets → packs, licences, counts, categories),
 * one folder per set with its icon-pack assets (≤ 600 glyphs each, split by category when the set has them, else by
 * name) and an icon-level sidecar index.json (name → pack, category, tags) the Icon Browser searches, and LICENSES.md
 * with every set's licence text. Served by the Icon Browser's server part, never bundled into an app.
 *
 * Conversion keeps icon-pack@1's promise: glyphs are path commands only. Shapes (circle, ellipse, rect incl. rounded,
 * line, polyline, polygon) become paths; a glyph with a transform, a <use>, a mask, a clip path, text or an image is
 * skipped and counted; paths are scaled to the pack's grid when the source grid differs (Phosphor's 256); a path over
 * the 2000-character cap is skipped. Downloaded tarballs are data: nothing in them is ever executed (the Phosphor
 * metadata module is read as text).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_LIMITS, GLYPH_NAME, PATH_DATA, iconPackErrors } from '../core/engines/brand-rules.mjs';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const LIBRARY_DIR = join(REPO, 'framework/icon-library');
export const LIBRARY_CONTRACT = 'icon-library@1';
export const SET_INDEX_CONTRACT = 'icon-library-set@1';
/** The whole library on disk (packs + sidecars + index), so the repo stays light. */
export const BUDGET_BYTES = 9_000_000;
const DEFAULT_CACHE = process.env.AXF_ICON_CACHE || '/tmp/icon-sets';
const MAX_TAGS = 8;

/* ================================================================== the sets */

/** Open-licensed sets. `nodes` = a JSON of name → [[element, attrs]…] (no SVG parsing); `svgs` = a folder of SVG files. */
export const SETS = [
  { id: 'lucide', name: 'Lucide', npm: 'lucide-static', license: 'ISC', licenseUrl: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE', homepage: 'https://lucide.dev', style: 'outline', grid: 24, stroke: 2, linecap: 'round', nodes: 'icon-nodes.json', tags: 'tags.json', licenseFile: 'LICENSE' },
  { id: 'tabler', name: 'Tabler Icons (outline)', npm: '@tabler/icons', license: 'MIT', licenseUrl: 'https://github.com/tabler/tabler-icons/blob/main/LICENSE', homepage: 'https://tabler.io/icons', style: 'outline', grid: 24, stroke: 2, linecap: 'round', nodes: 'tabler-nodes-outline.json', meta: 'icons.json', licenseFile: 'LICENSE' },
  { id: 'feather', name: 'Feather', npm: 'feather-icons', license: 'MIT', licenseUrl: 'https://github.com/feathericons/feather/blob/main/LICENSE', homepage: 'https://feathericons.com', style: 'outline', grid: 24, stroke: 2, linecap: 'round', svgs: 'dist/icons', licenseFile: 'LICENSE' },
  { id: 'heroicons-outline', name: 'Heroicons (outline)', npm: 'heroicons', license: 'MIT', licenseUrl: 'https://github.com/tailwindlabs/heroicons/blob/master/LICENSE', homepage: 'https://heroicons.com', style: 'outline', grid: 24, stroke: 1.5, linecap: 'round', svgs: '24/outline', licenseFile: 'LICENSE' },
  { id: 'heroicons-solid', name: 'Heroicons (solid)', npm: 'heroicons', license: 'MIT', licenseUrl: 'https://github.com/tailwindlabs/heroicons/blob/master/LICENSE', homepage: 'https://heroicons.com', style: 'filled', grid: 24, stroke: 1.75, linecap: 'round', svgs: '24/solid', licenseFile: 'LICENSE' },
  { id: 'phosphor', name: 'Phosphor (regular)', npm: '@phosphor-icons/core', license: 'MIT', licenseUrl: 'https://github.com/phosphor-icons/core/blob/main/LICENSE', homepage: 'https://phosphoricons.com', style: 'filled', grid: 24, sourceGrid: 256, stroke: 1.75, linecap: 'round', svgs: 'assets/regular', metaText: 'dist/index.mjs', licenseFile: 'LICENSE' },
  { id: 'bootstrap', name: 'Bootstrap Icons', npm: 'bootstrap-icons', license: 'MIT', licenseUrl: 'https://github.com/twbs/icons/blob/main/LICENSE', homepage: 'https://icons.getbootstrap.com', style: 'filled', grid: 16, stroke: 1.5, linecap: 'round', svgs: 'icons', licenseFile: 'LICENSE' },
];
const setById = (id) => SETS.find((s) => s.id === id);
const cacheDirOf = (s, cache) => join(cache, s.npm.replace(/^@/, '').replace(/\//g, '_'));

/* ================================================================== numbers + paths */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmt = (n) => { const r = Math.round(n * 1000) / 1000; return String(r).replace(/^(-?)0\./, '$1.'); };
const TOKEN = /[MmZzLlHhVvCcSsQqTtAa]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;
const ARC_SCALE = [true, true, false, false, false, true, true];

/** Scale every coordinate of a path by k (arc rotation and flags untouched); also normalises spacing. */
export function scalePath(d, k = 1) {
  const toks = String(d).match(TOKEN) ?? [];
  const out = []; let cmd = ''; let i = 0;
  for (const t of toks) {
    if (/^[A-Za-z]$/.test(t)) { cmd = t; i = 0; out.push(t); continue; }
    const scale = cmd.toLowerCase() === 'a' ? ARC_SCALE[i % 7] : true;
    const v = num(t) * (scale ? k : 1);
    out.push(cmd.toLowerCase() === 'a' && (i % 7 === 3 || i % 7 === 4) ? String(Math.round(v)) : fmt(v));
    i++;
  }
  return compact(out);
}
function compact(tokens) {
  let s = '';
  for (const t of tokens) {
    if (/^[A-Za-z]$/.test(t)) s += t;
    else if (!s || /[A-Za-z]$/.test(s)) s += t;
    else if (t.startsWith('-') || (t.startsWith('.') && /\.\d*$/.test(s.split(/[ ,A-Za-z]/).pop() ?? ''))) s += t;
    else s += ` ${t}`;
  }
  return s;
}

/** One SVG shape ([element, attrs]) as path data, or null when it can't be (unsupported / transformed). */
export function shapeToPath(el, a) {
  if (a.transform) return null;
  switch (el) {
    case 'path': return a.d ? String(a.d) : null;
    case 'circle': { const cx = num(a.cx), cy = num(a.cy), r = num(a.r); if (!r) return null; return `M${fmt(cx - r)} ${fmt(cy)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0`; }
    case 'ellipse': { const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry); if (!rx || !ry) return null; return `M${fmt(cx - rx)} ${fmt(cy)}a${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(2 * rx)} 0a${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(-2 * rx)} 0`; }
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height); if (!w || !h) return null;
      let rx = a.rx !== undefined ? num(a.rx) : a.ry !== undefined ? num(a.ry) : 0; let ry = a.ry !== undefined ? num(a.ry) : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${fmt(x)} ${fmt(y)}h${fmt(w)}v${fmt(h)}h${fmt(-w)}z`;
      return `M${fmt(x + rx)} ${fmt(y)}h${fmt(w - 2 * rx)}a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(rx)} ${fmt(ry)}v${fmt(h - 2 * ry)}a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(-rx)} ${fmt(ry)}h${fmt(-(w - 2 * rx))}a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(-rx)} ${fmt(-ry)}v${fmt(-(h - 2 * ry))}a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(rx)} ${fmt(-ry)}z`;
    }
    case 'line': return `M${fmt(num(a.x1))} ${fmt(num(a.y1))}L${fmt(num(a.x2))} ${fmt(num(a.y2))}`;
    case 'polyline': case 'polygon': {
      const pts = String(a.points ?? '').trim().split(/[\s,]+/).filter(Boolean).map(num);
      if (pts.length < 4) return null;
      let d = `M${fmt(pts[0])} ${fmt(pts[1])}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += `L${fmt(pts[i])} ${fmt(pts[i + 1])}`;
      return el === 'polygon' ? `${d}z` : d;
    }
    default: return null;
  }
}

const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const UNSUPPORTED = /<(use|mask|clipPath|text|image|pattern|linearGradient|radialGradient|filter|foreignObject|symbol)\b/;

/** Parse an SVG file's text into [[element, attrs]…] (+ viewBox); null when it holds something a glyph can't carry. */
export function parseSvg(text) {
  if (UNSUPPORTED.test(text)) return null;
  if (/<g\b[^>]*\btransform=/.test(text)) return null;
  const vb = /viewBox="([^"]+)"/.exec(text);
  const viewBox = vb ? vb[1].trim().split(/[\s,]+/).map(num) : null;
  const shapes = [];
  const re = /<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = {};
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g; let a;
    while ((a = ar.exec(m[2]))) attrs[a[1]] = a[2];
    shapes.push([m[1], attrs]);
  }
  return { shapes, viewBox };
}

/** Shapes → one glyph { d, fill?, evenodd? } or { skip: reason }. */
export function shapesToGlyph(shapes, { grid, sourceGrid, filled }) {
  const parts = []; let evenodd = false;
  for (const [el, a] of shapes) {
    if (!SHAPES.has(el)) return { skip: `element ${el}` };
    if (a.fill === 'none' && filled && el !== 'path') { /* an outline inside a filled set: keep, it is still a shape */ }
    const d = shapeToPath(el, a);
    if (d === null) return { skip: a.transform ? 'transform' : `shape ${el}` };
    if (String(a['fill-rule'] ?? '').toLowerCase() === 'evenodd') evenodd = true;
    parts.push(d);
  }
  if (!parts.length) return { skip: 'no shapes' };
  const k = sourceGrid && sourceGrid !== grid ? grid / sourceGrid : 1;
  const d = scalePath(parts.join(' '), k);
  if (!PATH_DATA.test(d)) return { skip: 'path data' };
  if (d.length > ICON_LIMITS.pathChars) return { skip: 'too long' };
  const g = { d };
  if (filled) g.fill = true;
  if (filled && evenodd) g.evenodd = true;
  return g;
}

/* ================================================================== reading a set from the cache */

const slug = (s) => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'misc';
const nameOf = (file) => file.replace(/\.svg$/, '').toLowerCase();
const okName = (n) => GLYPH_NAME.test(n) && n.length <= ICON_LIMITS.nameChars;

/** Every icon of a set from its cache folder: { name: { glyph | skip, category, tags } } + meta. */
export function readSet(s, cache = DEFAULT_CACHE) {
  const dir = join(cacheDirOf(s, cache), 'package');
  if (!existsSync(dir)) throw new Error(`${s.id}: not fetched (${dir}); run: icon-import.mjs fetch ${s.id}`);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const filled = s.style === 'filled';
  const icons = {};
  const meta = readMeta(s, dir);
  if (s.nodes) {
    const nodes = JSON.parse(readFileSync(join(dir, s.nodes), 'utf8'));
    for (const [name, list] of Object.entries(nodes)) {
      if (!okName(name)) continue;
      const shapes = (Array.isArray(list) ? list : []).map((n) => [n[0], n[1] ?? {}]);
      icons[name] = { ...shapesToGlyph(shapes, { grid: s.grid, sourceGrid: s.sourceGrid, filled }), ...(meta[name] ?? {}) };
    }
  } else if (s.svgs) {
    const folder = join(dir, s.svgs);
    for (const f of readdirSync(folder).filter((x) => x.endsWith('.svg')).sort()) {
      const name = nameOf(f);
      if (!okName(name)) continue;
      const parsed = parseSvg(readFileSync(join(folder, f), 'utf8'));
      if (!parsed) { icons[name] = { skip: 'unsupported element', ...(meta[name] ?? {}) }; continue; }
      const sourceGrid = s.sourceGrid ?? (parsed.viewBox && parsed.viewBox[2] && parsed.viewBox[2] !== s.grid ? parsed.viewBox[2] : undefined);
      icons[name] = { ...shapesToGlyph(parsed.shapes, { grid: s.grid, sourceGrid, filled }), ...(meta[name] ?? {}) };
    }
  }
  const licenseText = s.licenseFile && existsSync(join(dir, s.licenseFile)) ? readFileSync(join(dir, s.licenseFile), 'utf8') : '';
  return { icons, version: String(pkg.version ?? ''), licenseText };
}

/** Per-icon category + tags, from whatever the set ships (lucide tags.json, tabler icons.json, phosphor's metadata module read as text). */
function readMeta(s, dir) {
  const out = {};
  const tagsOf = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string').map((t) => t.toLowerCase().slice(0, 32)).slice(0, MAX_TAGS) : []);
  if (s.tags && existsSync(join(dir, s.tags))) for (const [name, tags] of Object.entries(JSON.parse(readFileSync(join(dir, s.tags), 'utf8')))) out[name] = { tags: tagsOf(tags) };
  if (s.meta && existsSync(join(dir, s.meta))) for (const [name, m] of Object.entries(JSON.parse(readFileSync(join(dir, s.meta), 'utf8')))) out[name] = { category: typeof m?.category === 'string' ? m.category : '', tags: tagsOf(m?.tags) };
  if (s.metaText && existsSync(join(dir, s.metaText))) {
    // the module is DATA here: never imported. Entries look like { name: "acorn", pascal_name: …, categories: [ "NATURE" ], tags: [ … ] }
    const text = readFileSync(join(dir, s.metaText), 'utf8');
    // category enum: `i.ARROWS = "arrows", i.FINANCE = "finances"` (the first table wins where two versions exist)
    const labels = {}; for (const m of text.matchAll(/\bi\.([A-Z_]+) = "([^"]+)"/g)) if (!(m[1] in labels)) labels[m[1]] = m[2];
    const re = /name:\s*"([a-z0-9-]+)"[\s\S]*?categories:\s*\[([^\]]*)\][\s\S]*?tags:\s*\[([^\]]*)\]/g; let m;
    while ((m = re.exec(text))) {
      const cats = [...m[2].matchAll(/"([^"]+)"|\b[a-zA-Z_$]+\.([A-Z_]+)\b/g)].map((x) => x[1] ?? (labels[x[2]] || x[2])).filter(Boolean);
      const tags = [...m[3].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      out[m[1]] = { category: cats[0] ? cats[0].toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '', tags: tagsOf(tags) };
    }
  }
  return out;
}

/* ================================================================== packs */

/** Split a set's glyphs into packs of ≤ 600: by category when the set has them, else by name ranges. */
export function splitPacks(setId, icons) {
  const names = Object.keys(icons).filter((n) => icons[n].d).sort();
  const byCat = new Map();
  const hasCats = names.some((n) => icons[n].category);
  for (const n of names) { const c = hasCats ? slug(icons[n].category || 'other') : ''; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(n); }
  const packs = [];
  const used = new Set();
  const idFor = (base) => { let id = `${setId}-${base}`.slice(0, 48).replace(/-+$/, ''); let k = 2; while (used.has(id)) id = `${`${setId}-${base}`.slice(0, 45)}-${k++}`; used.add(id); return id; };
  for (const [cat, list] of [...byCat.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const chunks = [];
    for (let i = 0; i < list.length; i += ICON_LIMITS.glyphs) chunks.push(list.slice(i, i + ICON_LIMITS.glyphs));
    chunks.forEach((chunk, i) => {
      const base = cat ? (chunks.length > 1 ? `${cat}-${i + 1}` : cat) : `${chunk[0][0]}-${chunk[chunk.length - 1][0]}${chunks.length > 1 && chunk[0][0] === chunk[chunk.length - 1][0] ? `-${i + 1}` : ''}`;
      packs.push({ id: idFor(base), category: cat ? (icons[chunk[0]].category || 'Other') : '', names: chunk });
    });
  }
  return packs;
}

function packAsset(s, p, icons, version) {
  const glyphs = {};
  for (const n of p.names) { const g = icons[n]; glyphs[n] = g.fill ? { d: g.d, fill: true, ...(g.evenodd ? { evenodd: true } : {}) } : g.d; }
  return {
    $axf: 'asset@1', type: 'icon-pack', id: p.id,
    name: `${s.name}${p.category ? ` · ${p.category}` : ''} (${p.names.length})`,
    version: '1.0.0',
    description: `${s.name} ${version}: ${p.names.length} ${s.style} glyph(s)${p.category ? ` in ${p.category}` : ''} on a ${s.grid} grid, ${s.license} licence (${s.licenseUrl}). Converted by framework/cli/icon-import.mjs; any name the pack lacks falls back to the framework glyph.`,
    author: s.name, tags: ['icon-library', s.id, s.style, ...(p.category ? [slug(p.category)] : [])].slice(0, 12),
    data: { style: s.style, grid: s.grid, stroke: s.stroke, linecap: s.linecap, fallback: 'framework', glyphs },
  };
}

/* ================================================================== commands */

function fetchSets(ids, cache) {
  mkdirSync(cache, { recursive: true });
  for (const id of ids) {
    const s = setById(id); if (!s) throw new Error(`unknown set ${id}`);
    const dir = cacheDirOf(s, cache);
    if (existsSync(join(dir, 'package', 'package.json'))) { console.log(`${s.id}: cached (${dir})`); continue; }
    const meta = JSON.parse(execFileSync('curl', ['-s', '-m', '30', `https://registry.npmjs.org/${s.npm}/latest`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
    const url = meta?.dist?.tarball; if (!url || !/^https:\/\/registry\.npmjs\.org\//.test(url)) throw new Error(`${s.id}: no tarball`);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    execFileSync('curl', ['-s', '-m', '600', '-L', url, '-o', join(dir, 'pkg.tgz')]);
    execFileSync('tar', ['-xzf', join(dir, 'pkg.tgz'), '-C', dir]);
    console.log(`${s.id}: fetched ${s.npm}@${meta.version} (${meta.license}) → ${dir}`);
  }
}

function buildSets(ids, cache) {
  mkdirSync(LIBRARY_DIR, { recursive: true });
  const index = readIndex() ?? { $axf: LIBRARY_CONTRACT, generatedAt: '', budgetBytes: BUDGET_BYTES, totalBytes: 0, sets: [] };
  const licenses = [];
  for (const id of ids) {
    const s = setById(id); if (!s) throw new Error(`unknown set ${id}`);
    const { icons, version, licenseText } = readSet(s, cache);
    const setDir = join(LIBRARY_DIR, s.id);
    rmSync(setDir, { recursive: true, force: true }); mkdirSync(setDir, { recursive: true });
    const packs = splitPacks(s.id, icons);
    const sidecar = { $axf: SET_INDEX_CONTRACT, set: s.id, icons: {} };
    const categories = {};
    const skipped = {};
    for (const p of packs) {
      const asset = packAsset(s, p, icons, version);
      const errs = iconPackErrors(asset.data); if (errs.length) throw new Error(`${p.id}: ${errs.join('; ')}`);
      writeFileSync(join(setDir, `${p.id}.json`), `${JSON.stringify(asset)}\n`);
      for (const n of p.names) { const g = icons[n]; sidecar.icons[n] = { pack: p.id, ...(g.category ? { category: g.category } : {}), ...(g.tags?.length ? { tags: g.tags } : {}) }; if (p.category) categories[p.category] = (categories[p.category] ?? 0) + 1; }
    }
    for (const [n, g] of Object.entries(icons)) if (g.skip) skipped[g.skip] = (skipped[g.skip] ?? 0) + 1;
    writeFileSync(join(setDir, 'index.json'), `${JSON.stringify(sidecar)}\n`);
    const count = Object.keys(sidecar.icons).length;
    const entry = { id: s.id, name: s.name, license: s.license, licenseUrl: s.licenseUrl, homepage: s.homepage, npm: { name: s.npm, version }, style: s.style, grid: s.grid, stroke: s.stroke, linecap: s.linecap, count, skipped, packs: packs.map((p) => ({ id: p.id, file: `${s.id}/${p.id}.json`, count: p.names.length, category: p.category })), categories };
    index.sets = [...index.sets.filter((x) => x.id !== s.id), entry].sort((a, b) => SETS.findIndex((x) => x.id === a.id) - SETS.findIndex((x) => x.id === b.id));
    licenses.push({ s, version, licenseText });
    console.log(`${s.id}: ${count} glyphs in ${packs.length} pack(s)${Object.keys(skipped).length ? `, skipped ${JSON.stringify(skipped)}` : ''}`);
  }
  index.generatedAt = new Date().toISOString();
  index.totalBytes = 0; // filled by writeIndex
  writeIndex(index);
  writeLicenses(index, licenses);
  const total = libraryBytes();
  index.totalBytes = total; writeIndex(index);
  console.log(`library: ${index.sets.reduce((a, s) => a + s.count, 0)} glyphs, ${index.sets.reduce((a, s) => a + s.packs.length, 0)} packs, ${(total / 1e6).toFixed(2)} MB of ${(BUDGET_BYTES / 1e6).toFixed(0)} MB`);
}

function writeLicenses(index, fresh) {
  const file = join(LIBRARY_DIR, 'LICENSES.md');
  const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const sections = new Map();
  for (const m of old.matchAll(/^## ([a-z0-9-]+)\n([\s\S]*?)(?=^## |\s*$(?![\s\S]))/gm)) sections.set(m[1], m[2]);
  for (const { s, version, licenseText } of fresh) sections.set(s.id, `${s.name} ${version} — ${s.license} — ${s.homepage} — npm \`${s.npm}\`\n\n\`\`\`\n${licenseText.trim()}\n\`\`\`\n\n`);
  const body = index.sets.map((e) => `## ${e.id}\n${sections.get(e.id) ?? ''}`).join('');
  writeFileSync(file, `# Icon library licences\n\nEvery set in framework/icon-library, with its licence text as shipped in the package it was converted from (framework/cli/icon-import.mjs). Converted glyphs keep their set's licence.\n\n${body}`);
}

export function readIndex() {
  const f = join(LIBRARY_DIR, 'index.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}
function writeIndex(index) { writeFileSync(join(LIBRARY_DIR, 'index.json'), `${JSON.stringify(index, null, 1)}\n`); }
function libraryBytes() {
  let total = 0;
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) walk(p); else total += st.size; } };
  walk(LIBRARY_DIR);
  return total;
}

/** Check the library: index ↔ files ↔ sidecars agree, every pack is a valid icon-pack@1, budget kept. */
export function checkLibrary() {
  const errors = [];
  const index = readIndex();
  if (!index) return { ok: false, errors: ['framework/icon-library/index.json missing: run icon-import.mjs fetch all && build all'], sets: 0, glyphs: 0, packs: 0, bytes: 0 };
  if (index.$axf !== LIBRARY_CONTRACT) errors.push(`index: $axf must be ${LIBRARY_CONTRACT}`);
  const seen = new Set(); let glyphs = 0; let packs = 0;
  for (const e of index.sets ?? []) {
    if (seen.has(e.id)) errors.push(`set ${e.id} listed twice`); seen.add(e.id);
    const sidecarFile = join(LIBRARY_DIR, e.id, 'index.json');
    if (!existsSync(sidecarFile)) { errors.push(`${e.id}: sidecar index.json missing`); continue; }
    const sidecar = JSON.parse(readFileSync(sidecarFile, 'utf8'));
    if (sidecar.$axf !== SET_INDEX_CONTRACT || sidecar.set !== e.id) errors.push(`${e.id}: sidecar header wrong`);
    let count = 0;
    for (const p of e.packs ?? []) {
      packs++;
      const f = join(LIBRARY_DIR, p.file);
      if (!existsSync(f)) { errors.push(`${p.id}: file ${p.file} missing`); continue; }
      const a = JSON.parse(readFileSync(f, 'utf8'));
      if (a.$axf !== 'asset@1' || a.type !== 'icon-pack' || a.id !== p.id) errors.push(`${p.id}: not an icon-pack asset with that id`);
      const errs = iconPackErrors(a.data); if (errs.length) errors.push(`${p.id}: ${errs.slice(0, 3).join('; ')}`);
      const names = Object.keys(a.data?.glyphs ?? {});
      if (names.length !== p.count) errors.push(`${p.id}: ${names.length} glyphs, index says ${p.count}`);
      if (names.length > ICON_LIMITS.glyphs) errors.push(`${p.id}: over ${ICON_LIMITS.glyphs} glyphs`);
      for (const n of names) { if (sidecar.icons?.[n]?.pack !== p.id) errors.push(`${p.id}: ${n} not in the sidecar (or in another pack)`); }
      count += names.length;
    }
    if (count !== e.count) errors.push(`${e.id}: ${count} glyphs in packs, index says ${e.count}`);
    if (Object.keys(sidecar.icons ?? {}).length !== count) errors.push(`${e.id}: sidecar lists ${Object.keys(sidecar.icons ?? {}).length} icons, packs hold ${count}`);
    if (!e.license || !e.licenseUrl) errors.push(`${e.id}: licence missing`);
    glyphs += count;
  }
  const lic = join(LIBRARY_DIR, 'LICENSES.md');
  if (!existsSync(lic)) errors.push('LICENSES.md missing'); else { const txt = readFileSync(lic, 'utf8'); for (const e of index.sets ?? []) if (!txt.includes(`## ${e.id}\n`)) errors.push(`LICENSES.md: no section for ${e.id}`); }
  const bytes = libraryBytes();
  if (bytes > (index.budgetBytes || BUDGET_BYTES)) errors.push(`library is ${bytes} bytes, over the ${index.budgetBytes || BUDGET_BYTES} budget`);
  return { ok: errors.length === 0, errors: errors.slice(0, 40), sets: (index.sets ?? []).length, glyphs, packs, bytes };
}

/** Any folder of SVGs → icon-pack assets (the sources' import path too). */
export function convertFolder(folder, opts) {
  const style = opts.style === 'filled' ? 'filled' : 'outline';
  const grid = Math.min(ICON_LIMITS.grid[1], Math.max(ICON_LIMITS.grid[0], Number(opts.grid) || 24));
  const icons = {};
  for (const f of readdirSync(folder).filter((x) => x.endsWith('.svg')).sort()) {
    const name = nameOf(f); if (!okName(name)) continue;
    const parsed = parseSvg(readFileSync(join(folder, f), 'utf8'));
    if (!parsed) { icons[name] = { skip: 'unsupported element' }; continue; }
    const sourceGrid = parsed.viewBox && parsed.viewBox[2] && parsed.viewBox[2] !== grid ? parsed.viewBox[2] : undefined;
    icons[name] = shapesToGlyph(parsed.shapes, { grid, sourceGrid, filled: style === 'filled' });
  }
  const s = { id: opts.id, name: opts.name || opts.id, style, grid, stroke: Number(opts.stroke) || (style === 'filled' ? 1.75 : 2), linecap: ['round', 'square', 'butt'].includes(opts.linecap) ? opts.linecap : 'round', license: opts.license || 'unknown', licenseUrl: opts.licenseUrl || '' };
  const packs = splitPacks(s.id, icons).map((p) => ({ ...p, category: opts.category || p.category }));
  const assets = packs.map((p) => packAsset(s, p, icons, opts.version || ''));
  const skipped = {}; for (const g of Object.values(icons)) if (g.skip) skipped[g.skip] = (skipped[g.skip] ?? 0) + 1;
  return { assets, skipped, count: Object.values(icons).filter((g) => g.d).length };
}

/* ================================================================== CLI */

function flag(args, name, d) { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; }

async function main(argv) {
  const json = argv.includes('--json');
  const [cmd = 'library', ...rest] = argv.filter((a) => a !== '--json');
  const cache = flag(rest, 'dir', DEFAULT_CACHE);
  if (cmd === 'sets') { if (json) console.log(JSON.stringify(SETS)); else for (const s of SETS) console.log(`${s.id.padEnd(18)} ${s.name.padEnd(26)} ${s.license.padEnd(4)} ${s.style.padEnd(8)} grid ${String(s.grid).padEnd(3)} npm ${s.npm}`); return; }
  const ids = (x) => (!x || x === 'all' ? SETS.map((s) => s.id) : [x]);
  if (cmd === 'fetch') return fetchSets(ids(rest.find((a) => !a.startsWith('--') && a !== cache)), cache);
  if (cmd === 'build') return buildSets(ids(rest.find((a) => !a.startsWith('--') && a !== cache)), cache);
  if (cmd === 'convert') {
    const folder = rest.find((a) => !a.startsWith('--')); if (!folder || !existsSync(folder)) throw new Error('convert <svg folder> --id <pack id>');
    const id = flag(rest, 'id', ''); if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(id)) throw new Error('--id <pack id> (lowercase, dashes, 2-48)');
    const r = convertFolder(folder, { id, name: flag(rest, 'name'), style: flag(rest, 'style'), grid: flag(rest, 'grid'), stroke: flag(rest, 'stroke'), linecap: flag(rest, 'linecap'), category: flag(rest, 'category'), license: flag(rest, 'license'), licenseUrl: flag(rest, 'license-url') });
    const out = flag(rest, 'out', '');
    if (out) { mkdirSync(out, { recursive: true }); for (const a of r.assets) writeFileSync(join(out, `${a.id}.json`), `${JSON.stringify(a)}\n`); }
    if (json) console.log(JSON.stringify({ ok: true, count: r.count, skipped: r.skipped, packs: r.assets.map((a) => ({ id: a.id, count: Object.keys(a.data.glyphs).length })), out }));
    else console.log(`${r.count} glyph(s) in ${r.assets.length} pack(s)${out ? ` → ${out}` : ''}${Object.keys(r.skipped).length ? `, skipped ${JSON.stringify(r.skipped)}` : ''}`);
    return;
  }
  if (cmd === 'library') {
    const r = checkLibrary();
    if (json) { console.log(JSON.stringify(r)); if (rest.includes('--check') && !r.ok) process.exitCode = 1; return; }
    const index = readIndex();
    if (index) for (const s of index.sets) console.log(`${s.id.padEnd(18)} ${String(s.count).padStart(5)} glyphs  ${String(s.packs.length).padStart(3)} packs  ${s.license.padEnd(4)} ${s.npm.name}@${s.npm.version}`);
    console.log(`${r.sets} sets, ${r.glyphs} glyphs, ${r.packs} packs, ${(r.bytes / 1e6).toFixed(2)} MB (budget ${(BUDGET_BYTES / 1e6).toFixed(0)} MB)`);
    if (rest.includes('--check')) { if (r.ok) console.log('✓ icon library: every pack is a valid icon-pack@1, index, sidecars and licences agree, budget kept'); else { console.error(`✗ icon library:\n${r.errors.map((e) => `  ✗ ${e}`).join('\n')}`); process.exitCode = 1; } }
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}

export const fileHash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
