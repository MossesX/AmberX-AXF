#!/usr/bin/env node
/**
 * scale-adopt — moves hard-coded font sizes and spacing onto the scale assets' tokens (typography@1 / density@1,
 * Angel build `ui-all-assets`, Oct 31 2026). Every `font-size`, `gap`, `padding*` and `margin*` value written as a
 * number (em, px, calc(var(--fx-font-size) * n), calc(var(--fx-space) * n), var(--fx-space)) is mapped to the
 * nearest step:
 *
 *   text     --fx-type-scale-{2xs,xs,sm,md,lg,xl,2xl}      em sizes (relative to the parent; 1em is left alone)
 *            --fx-type-root-{2xs … 2xl}                     calc(var(--fx-font-size) * n) and px (from the base size; > 2.3× is an icon, left alone)
 *   spacing  --fx-dens-gap-{2xs,xs,sm,md,lg,xl,2xl,3xl,4xl} (> 3.5 space is layout, left alone; 1px stays a hairline)
 *
 *   node framework/cli/scale-adopt.mjs [paths…] [--dry-run]
 *   (default: framework/ui, framework/react, framework/libs, apps/console-web/src + plugins, apps/amberx-droid/src)
 *
 * Lines with `theme-ok` or `scale-ok` are skipped. Run it again after adding a stylesheet; check-theme.mjs flags
 * whatever is left (rule `scale`).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const paths = args.filter((a) => !a.startsWith('--'));
const DEFAULT_PATHS = ['framework/ui', 'framework/react', 'framework/libs', 'apps/console-web/src', 'apps/console-web/plugins', 'apps/amberx-droid/src'];

/** [upper bound (exclusive), step] — text sizes as a ratio of the parent's size. */
export const TYPE_STEPS = [[0.725, '2xs'], [0.81, 'xs'], [0.89, 'sm'], [0.97, 'md'], [1.03, null], [1.2, 'lg'], [1.6, 'xl'], [2.3, '2xl']];
/** [upper bound (exclusive), step] — spacing as a multiple of --fx-space. */
export const GAP_STEPS = [[0.18, '2xs'], [0.32, 'xs'], [0.45, 'sm'], [0.58, 'md'], [0.85, 'lg'], [1.15, 'xl'], [1.75, '2xl'], [2.6, '3xl'], [3.51, '4xl']];
const stepOf = (table, r) => { for (const [max, s] of table) if (r < max) return s ?? undefined; return undefined; };
export const typeToken = (r) => { const s = stepOf(TYPE_STEPS, r); return s ? `var(--fx-type-scale-${s})` : null; };
/** Sizes written from the base size (calc(var(--fx-font-size) * n), px) stay anchored there: the root-anchored twin. */
export const rootTypeToken = (r) => { const s = stepOf(TYPE_STEPS, r); return s ? `var(--fx-type-root-${s})` : null; };
export const gapToken = (k) => { if (!(k > 0)) return null; const s = stepOf(GAP_STEPS, k); return s ? `var(--fx-dens-gap-${s})` : null; };

const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const ratio = (a, b) => (b ? Number(a) / Number(b) : Number(a));

/** One font-size value → token (or unchanged). */
function fontValue(v) {
  return v
    .replace(new RegExp(String.raw`calc\(\s*var\(--fx-font-size\)\s*\*\s*${NUM}(?:\s*\/\s*${NUM})?\s*\)`, 'g'), (m, a, b) => rootTypeToken(ratio(a, b)) ?? m)
    .replace(new RegExp(String.raw`(?<![\w.-])${NUM}em\b`, 'g'), (m, a) => typeToken(Number(a)) ?? m)
    .replace(new RegExp(String.raw`(?<![\w.-])${NUM}px\b`, 'g'), (m, a) => (Number(a) >= 8 ? rootTypeToken(Number(a) / 14) ?? m : m));
}
/** One spacing value (several terms) → tokens. */
function spaceValue(v) {
  return v
    .replace(new RegExp(String.raw`calc\(\s*var\(--fx-space\)\s*\*\s*${NUM}(?:\s*\/\s*${NUM})?\s*\)`, 'g'), (m, a, b) => gapToken(ratio(a, b)) ?? m)
    .replace(/(?<![(*/+-]\s*)var\(--fx-space\)(?!\s*[*/])/g, (m) => gapToken(1) ?? m)
    .replace(new RegExp(String.raw`(?<![\w.-])${NUM}px\b`, 'g'), (m, a) => (Number(a) >= 2 ? gapToken(Number(a) / 8) ?? m : m));
}

const KEBAB_FONT = /(?<![\w-])(font-size|font)(\s*:\s*)([^;}{'"`\n]+)/g;
const KEBAB_SPACE = /(?<![\w-])((?:row-|column-)?gap|padding(?:-[a-z]+)*|margin(?:-[a-z]+)*)(\s*:\s*)([^;}{'"`\n]+)/g;
const CAMEL_FONT = /(?<![\w-])(fontSize)(\s*:\s*)(['"])([^'"\n]*)\3/g;
const CAMEL_SPACE = /(?<![\w-])((?:row|column)?[gG]ap|padding(?:Top|Bottom|Left|Right|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?|margin(?:Top|Bottom|Left|Right|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?)(\s*:\s*)(['"])([^'"\n]*)\3/g;

export function adoptLine(line) {
  if (/theme-ok|scale-ok/.test(line)) return line;
  return line
    .replace(KEBAB_FONT, (m, p, s, v) => p + s + fontValue(v))
    .replace(KEBAB_SPACE, (m, p, s, v) => p + s + spaceValue(v))
    .replace(CAMEL_FONT, (m, p, s, q, v) => p + s + q + fontValue(v) + q)
    .replace(CAMEL_SPACE, (m, p, s, q, v) => p + s + q + spaceValue(v) + q);
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  if (!statSync(dir).isDirectory()) return [dir];
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'vendor', 'axf'].includes(name) || name.startsWith('.')) continue; // axf/: baked framework copies
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let changed = 0, files = 0;
  for (const base of (paths.length ? paths : DEFAULT_PATHS).map((p) => resolve(ROOT, p))) {
    for (const f of walk(base).filter((f) => /\.(css|tsx?|m?js)$/.test(f) && !/\.d\.m?ts$/.test(f) && !/\/(check-[^/]*|[^/]*\.(test|spec)\.[^/]*)$/.test(f))) {
      const src = readFileSync(f, 'utf8');
      const lines = src.split('\n');
      let n = 0;
      const out = lines.map((l) => { const r = adoptLine(l); if (r !== l) n += 1; return r; });
      if (!n) continue;
      files += 1; changed += n;
      console.log(`${relative(ROOT, f)}: ${n} line(s)`);
      if (!dry) writeFileSync(f, out.join('\n'));
    }
  }
  console.log(`${dry ? '(dry run) ' : ''}${changed} line(s) in ${files} file(s) moved onto the scale tokens`);
}
