#!/usr/bin/env node
/**
 * Brand generator CLI over core/engines/brandgen.mjs (enterprise-branding s12):
 *   node framework/cli/brand-gen.mjs marks     --count 250 --brand AmberX --out <dir> [--seed 1] [--prefix gen]
 *   node framework/cli/brand-gen.mjs animated  --count 250 --marks <dir of logo-mark assets> --out <dir>
 *   node framework/cli/brand-gen.mjs icons     --count 100 --base framework/assets/icon-pack/amberx-outline.json --out <dir>
 *   node framework/cli/brand-gen.mjs preview   --mark <asset.json> [--height 64]      (prints the SVG)
 *   node framework/cli/brand-gen.mjs check     <dir>…                                  (every asset validates)
 *   node framework/cli/brand-gen.mjs library   [--check]   (enterprise-branding s24–s25: the brand library below)
 *
 * The brand library (`framework/brand-library/`, brand-library@1) is generated, not hand-made, and is not a set of
 * starters: apps don't bake it; the Brand library plugin browses it and an app takes in what it applies. Layout:
 * `logo-mark/` 125 AmberX + 125 GizmoX marks (mark / lockup / wordmark), `animated-logo/` 125 + 125 animations of
 * those marks, `icon-pack/` 100 packs restyling the AmberX outline glyphs, and `index.json` (counts, bytes, every
 * item's id/name/brand/form, and the size budget). Deterministic from LIBRARY below: `--check` regenerates in memory
 * and fails on drift, an invalid asset or a blown budget (CI).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMark } from '../core/engines/brand-rules.mjs';
import { assetErrors, contrast, generateAnimated, generateIconPack, generateMark } from '../core/engines/brandgen.mjs';
export * from '../core/engines/brandgen.mjs';


/* ---------------- the brand library (s24–s25) ---------------- */

export const LIBRARY = {
  dir: 'framework/brand-library',
  brands: [{ brand: 'AmberX', slug: 'amberx', seed: 1, marks: 125, animated: 125 }, { brand: 'GizmoX', slug: 'gizmox', seed: 1001, marks: 125, animated: 125 }],
  icons: { count: 100, seed: 1, base: 'framework/assets/icon-pack/amberx-outline.json' },
  budget: { perAssetBytes: 4096, totalBytes: 2_000_000 },
};

/** Every library asset, in a stable order. */
export function buildLibrary(repo) {
  const out = [];
  for (const b of LIBRARY.brands) {
    // quality gate (DESIGN-LANGUAGE.md): a mark needs a motif on its shape (2+ paths), and brand-coloured text has to
    // read on light and dark surfaces (≥ 3:1 on both) or it is drawn in the text colour; weak seeds are skipped.
    const marks = [];
    for (let seed = b.seed; marks.length < b.marks; seed++) {
      const m = generateMark(seed, { brand: b.brand, id: `${b.slug}-logo-${String(marks.length + 1).padStart(3, '0')}` });
      const d = m.data;
      if (d.form !== 'wordmark' && (d.paths?.length ?? 0) < 2) continue;
      if (d.text?.fill === 'brand1' && Math.min(contrast(d.palette.brand1, '#ffffff'), contrast(d.palette.brand1, '#14161d')) < 3) d.text.fill = 'text';
      marks.push(m);
    }
    for (const m of marks) m.tags = [...new Set([...(m.tags ?? []), b.slug, 'brand-library'])];
    out.push(...marks);
    const animatable = marks.filter((m) => normalizeMark(m.data).form !== 'wordmark').map((m) => m.id);
    for (let i = 0; i < b.animated; i++) {
      const a = generateAnimated(b.seed + i, animatable, { id: `${b.slug}-anim-${String(i + 1).padStart(3, '0')}` });
      a.tags = [...new Set([...(a.tags ?? []), b.slug, 'brand-library'])];
      out.push(a);
    }
  }
  const base = JSON.parse(readFileSync(join(repo, LIBRARY.icons.base), 'utf8'));
  for (let i = 0; i < LIBRARY.icons.count; i++) {
    const p = generateIconPack(LIBRARY.icons.seed + i, base, { id: `pack-${String(i + 1).padStart(3, '0')}` });
    p.tags = [...new Set([...(p.tags ?? []), 'brand-library'])];
    out.push(p);
  }
  return out;
}

/** The index: counts, bytes, budget and one row per item (what the Brand library plugin lists without opening files). */
export function libraryIndex(assets) {
  const text = (a) => JSON.stringify(a, null, 2) + '\n';
  const counts = {}; let total = 0;
  const items = assets.map((a) => {
    const bytes = Buffer.byteLength(text(a)); total += bytes;
    counts[a.type] = (counts[a.type] ?? 0) + 1;
    const brand = (a.tags ?? []).includes('gizmox') ? 'GizmoX' : (a.tags ?? []).includes('amberx') ? 'AmberX' : undefined;
    return { type: a.type, id: a.id, name: a.name, ...(brand ? { brand } : {}), ...(a.type === 'logo-mark' ? { form: normalizeMark(a.data).form } : {}), ...(a.type === 'animated-logo' ? { mark: a.data.mark, preset: a.data.preset } : {}), bytes };
  });
  return { $axf: 'brand-library@1', generatedBy: 'node framework/cli/brand-gen.mjs library', counts, totalBytes: total, budget: LIBRARY.budget, items };
}

function library(repo, check) {
  const assets = buildLibrary(repo);
  const problems = [];
  for (const a of assets) { const e = assetErrors(a); if (e.length) problems.push(`${a.id}: ${e.join('; ')}`); }
  const ids = new Set(); for (const a of assets) { const k = `${a.type}/${a.id}`; if (ids.has(k)) problems.push(`duplicate ${k}`); ids.add(k); }
  const index = libraryIndex(assets);
  for (const it of index.items) if (it.bytes > LIBRARY.budget.perAssetBytes) problems.push(`${it.type}/${it.id}: ${it.bytes} B over the ${LIBRARY.budget.perAssetBytes} B budget`);
  if (index.totalBytes > LIBRARY.budget.totalBytes) problems.push(`library ${index.totalBytes} B over the ${LIBRARY.budget.totalBytes} B budget`);
  const root = join(repo, LIBRARY.dir);
  const files = [...assets.map((a) => [join(root, a.type, `${a.id}.json`), JSON.stringify(a, null, 2) + '\n']), [join(root, 'index.json'), JSON.stringify(index, null, 2) + '\n']];
  if (check) {
    for (const [f, t] of files) { let cur = null; try { cur = readFileSync(f, 'utf8'); } catch { /* missing */ } if (cur !== t) problems.push(`drift: ${f.slice(repo.length + 1)}`); }
    for (const t of Object.keys(index.counts)) for (const f of readdirSync(join(root, t))) if (!ids.has(`${t}/${f.replace(/\.json$/, '')}`)) problems.push(`stray file ${t}/${f}`);
  } else {
    for (const [f, t] of files) { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, t); }
  }
  for (const p of problems.slice(0, 20)) console.error(`✗ ${p}`);
  console.log(problems.length ? `✗ brand library: ${problems.length} problem(s)` : `✓ brand library ${check ? 'in sync' : 'written'}: ${JSON.stringify(index.counts)}, ${(index.totalBytes / 1024).toFixed(0)} KB`);
  return problems.length ? 1 : 0;
}

/* ---------------- CLI ---------------- */

function arg(args, name, d) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; }
function writeAll(out, assets) {
  mkdirSync(out, { recursive: true });
  let bad = 0;
  for (const a of assets) {
    const errs = assetErrors(a);
    if (errs.length) { bad++; console.error(`✗ ${a.id}: ${errs.join('; ')}`); continue; }
    writeFileSync(join(out, `${a.id}.json`), JSON.stringify(a, null, 2) + '\n');
  }
  console.log(`${assets.length - bad} written to ${out}${bad ? `, ${bad} refused` : ''}`);
  return bad ? 1 : 0;
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...args] = argv;
  const count = Number(arg(args, 'count', 10));
  const seed0 = Number(arg(args, 'seed', 1));
  const out = resolve(arg(args, 'out', 'out/brand'));
  const prefix = arg(args, 'prefix', 'gen');
  if (cmd === 'marks') {
    const brand = arg(args, 'brand', 'AmberX');
    const form = arg(args, 'form');
    const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return writeAll(out, Array.from({ length: count }, (_, i) => generateMark(seed0 + i, { brand, form, id: `${prefix}-${slug}-${form ?? 'mark'}-${String(seed0 + i).padStart(3, '0')}` })));
  }
  if (cmd === 'animated') {
    const dir = resolve(arg(args, 'marks', 'framework/assets/logo-mark'));
    const ids = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).filter((a) => a.type === 'logo-mark' && normalizeMark(a.data).form !== 'wordmark').map((a) => a.id);
    if (!ids.length) { console.error('no logo-mark assets in ' + dir); return 2; }
    return writeAll(out, Array.from({ length: count }, (_, i) => generateAnimated(seed0 + i, ids, { id: `${prefix}-anim-${String(seed0 + i).padStart(3, '0')}` })));
  }
  if (cmd === 'icons') {
    const base = JSON.parse(readFileSync(resolve(arg(args, 'base', 'framework/assets/icon-pack/amberx-outline.json')), 'utf8'));
    return writeAll(out, Array.from({ length: count }, (_, i) => generateIconPack(seed0 + i, base, { id: `${prefix}-pack-${String(seed0 + i).padStart(3, '0')}` })));
  }
  if (cmd === 'preview') {
    const { markSvg } = await import('../core/engines/brand.ts').catch(() => ({ markSvg: null }));
    const a = JSON.parse(readFileSync(resolve(arg(args, 'mark')), 'utf8'));
    if (!markSvg) { console.log(JSON.stringify(normalizeMark(a.data), null, 2)); return 0; }
    console.log(markSvg(a.data, { height: Number(arg(args, 'height', 64)) }));
    return 0;
  }
  if (cmd === 'library') return library(resolve(fileURLToPath(new URL('../..', import.meta.url))), args.includes('--check'));
  if (cmd === 'check') {
    let n = 0, bad = 0;
    for (const dir of args.filter((a) => !a.startsWith('--'))) for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) { n++; const errs = assetErrors(JSON.parse(readFileSync(join(dir, f), 'utf8'))); if (errs.length) { bad++; console.error(`✗ ${f}: ${errs.join('; ')}`); } }
    console.log(bad ? `✗ ${bad} of ${n} brand assets fail` : `✓ ${n} brand assets valid`);
    return bad ? 1 : 0;
  }
  console.log('usage: brand-gen.mjs marks|animated|icons|preview|check|library …');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c));
