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
import { brandingErrors, normalizeMark } from '../core/engines/brand-rules.mjs';
import { assetErrors, contrast, generateAnimated, generateIconPack, generateMark } from '../core/engines/brandgen.mjs';
export * from '../core/engines/brandgen.mjs';


/* ---------------- the brand library (s24–s25) ---------------- */

export const LIBRARY = {
  dir: 'framework/brand-library',
  brands: [
    { brand: 'AmberX', slug: 'amberx', seed: 1, marks: 125, animated: 125, brandings: 25, tagline: 'One framework, every port.' },
    { brand: 'GizmoX', slug: 'gizmox', seed: 1001, marks: 125, animated: 125, brandings: 25, tagline: 'The AmberX development console.' },
  ],
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
  // icon packs first (brandings name one)
  const base = JSON.parse(readFileSync(join(repo, LIBRARY.icons.base), 'utf8'));
  const packs = Array.from({ length: LIBRARY.icons.count }, (_, i) => {
    const p = generateIconPack(LIBRARY.icons.seed + i, base, { id: `pack-${String(i + 1).padStart(3, '0')}` });
    p.tags = [...new Set([...(p.tags ?? []), 'brand-library'])];
    return p;
  });
  // branding packages (s26): each names a mark, a wordmark, a lockup and an animation of that mark from its brand,
  // an icon pack and the mark's palette, with one of the decoration presets — a complete, swappable rebrand
  for (const b of LIBRARY.brands) {
    const mine = out.filter((a) => (a.tags ?? []).includes(b.slug));
    const byForm = (f) => mine.filter((a) => a.type === 'logo-mark' && normalizeMark(a.data).form === f);
    const marks = byForm('mark'), words = byForm('wordmark'), locks = byForm('lockup');
    const anims = mine.filter((a) => a.type === 'animated-logo');
    for (let i = 0; i < b.brandings; i++) {
      const mark = marks[i % marks.length];
      const anim = anims.find((a) => a.data.mark === mark.id) ?? anims[i % anims.length];
      const preset = DECORATION_PRESETS[i % DECORATION_PRESETS.length];
      out.push({
        $axf: 'asset@1', type: 'branding', id: `${b.slug}-brand-${String(i + 1).padStart(3, '0')}`,
        name: `${b.brand} · ${preset.name} ${i + 1}`, version: '1.0.0',
        description: `${b.brand} branding: ${mark.name}, ${preset.name.toLowerCase()} placement, icon pack ${packs[(i * 4) % packs.length].id}.`,
        author: 'AmberX AXF', tags: [b.slug, 'brand-library', preset.id],
        data: {
          brand: { name: b.brand, tagline: b.tagline },
          marks: { mark: mark.id, wordmark: words[i % words.length].id, lockup: locks[i % locks.length].id, animated: anim.id },
          iconPack: packs[(i * 4) % packs.length].id,
          palette: { ...mark.data.palette },
          accentFromBrand: preset.accent,
          decorations: preset.decorations,
        },
      });
    }
  }
  out.push(...packs);
  return out;
}

/** Where brand marks show, as presets (DESIGN-LANGUAGE.md logo placement rules). */
export const DECORATION_PRESETS = [
  { id: 'classic', name: 'Classic', accent: false, decorations: { banner: 'lockup', window: 'mark', 'floating-window': 'mark', dialog: 'mark', container: 'none', 'tab-group': 'none', toolbar: 'none', splash: 'animated', favicon: 'mark', 'empty-state': 'watermark' } },
  { id: 'quiet', name: 'Quiet', accent: false, decorations: { banner: 'mark', window: 'none', 'floating-window': 'none', dialog: 'none', container: 'none', 'tab-group': 'none', toolbar: 'none', splash: 'mark', favicon: 'mark', 'empty-state': 'none' } },
  { id: 'signature', name: 'Signature', accent: true, decorations: { banner: 'lockup', window: 'accent-edge', 'floating-window': 'accent-edge', dialog: 'accent-edge', container: 'none', 'tab-group': 'accent-edge', toolbar: 'mark', splash: 'animated', favicon: 'mark', 'empty-state': 'watermark' } },
  { id: 'showcase', name: 'Showcase', accent: true, decorations: { banner: 'animated', window: 'mark', 'floating-window': 'mark', dialog: 'wordmark', container: 'watermark', 'tab-group': 'mark', toolbar: 'wordmark', splash: 'animated', favicon: 'mark', 'empty-state': 'animated' } },
  { id: 'wordmark', name: 'Wordmark', accent: false, decorations: { banner: 'wordmark', window: 'none', 'floating-window': 'mark', dialog: 'none', container: 'none', 'tab-group': 'none', toolbar: 'wordmark', splash: 'lockup', favicon: 'mark', 'empty-state': 'watermark' } },
];


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
  for (const a of assets) { const e = a.type === 'branding' ? brandingErrors(a.data) : assetErrors(a); if (e.length) problems.push(`${a.id}: ${e.join('; ')}`); }
  for (const a of assets.filter((x) => x.type === 'branding')) for (const [k, ref] of [...Object.entries(a.data.marks).map(([f, id]) => [f === 'animated' ? 'animated-logo' : 'logo-mark', id]), ['icon-pack', a.data.iconPack]]) if (!assets.some((x) => x.type === k && x.id === ref)) problems.push(`${a.id}: ${k} ${ref} isn't in the library`);
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
