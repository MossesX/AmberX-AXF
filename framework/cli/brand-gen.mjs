#!/usr/bin/env node
/**
 * Brand generator CLI over core/engines/brandgen.mjs (enterprise-branding s12):
 *   node framework/cli/brand-gen.mjs marks     --count 250 --brand AmberX --out <dir> [--seed 1] [--prefix gen]
 *   node framework/cli/brand-gen.mjs animated  --count 250 --marks <dir of logo-mark assets> --out <dir>
 *   node framework/cli/brand-gen.mjs icons     --count 100 --base framework/assets/icon-pack/amberx-outline.json --out <dir>
 *   node framework/cli/brand-gen.mjs preview   --mark <asset.json> [--height 64]      (prints the SVG)
 *   node framework/cli/brand-gen.mjs check     <dir>…                                  (every asset validates)
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMark } from '../core/engines/brand-rules.mjs';
import { assetErrors, generateAnimated, generateIconPack, generateMark } from '../core/engines/brandgen.mjs';
export * from '../core/engines/brandgen.mjs';

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
  if (cmd === 'check') {
    let n = 0, bad = 0;
    for (const dir of args.filter((a) => !a.startsWith('--'))) for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) { n++; const errs = assetErrors(JSON.parse(readFileSync(join(dir, f), 'utf8'))); if (errs.length) { bad++; console.error(`✗ ${f}: ${errs.join('; ')}`); } }
    console.log(bad ? `✗ ${bad} of ${n} brand assets fail` : `✓ ${n} brand assets valid`);
    return bad ? 1 : 0;
  }
  console.log('usage: brand-gen.mjs marks|animated|icons|preview|check …');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c));
