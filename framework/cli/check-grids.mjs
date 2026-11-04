#!/usr/bin/env node
/**
 * Every grid is a lib-datagrid DataGrid (Brett, Nov 4 2026: "Every grid needs to be able to hide columns. If you
 * right-click on the column, you can select which ones to hide. And every grid, framework wide.").
 *
 * A hand-made table with a column header row (`<thead>`, or MUI's `<TableHead>`) can't hide columns, so it fails here.
 * Tables that were already there when the rule came in are held to a ratchet baseline, framework/spec/grids-baseline.json
 * (per file, a count that may only shrink); a new file or a higher count fails. Key / value tables (`<th>` per row, no
 * header row) aren't grids and aren't counted. A table that draws content someone else wrote (a Markdown renderer)
 * carries `axf-grid-exempt: <reason>` on its line or one of the three above.
 *
 *   node framework/cli/check-grids.mjs                     # check (CI)
 *   node framework/cli/check-grids.mjs --list              # every counted table, file:line
 *   node framework/cli/check-grids.mjs --update-baseline   # after converting tables: write the smaller counts
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = join(ROOT, 'framework/spec/grids-baseline.json');
const SCAN = ['apps', 'framework'];
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '.next', 'out', '.git', 'android', '.shots-harness']);
const HEADER = /<thead\b|<TableHead\b/g;
const EXEMPT = /axf-grid-exempt:\s*\S/;

const args = process.argv.slice(2);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      // baked framework copies (apps/<app>/src/axf) are checked where they come from
      if (name === 'axf' && p.endsWith(join('src', 'axf'))) continue;
      yield* files(p);
    } else if (/\.(tsx|jsx)$/.test(name)) yield p;
  }
}

/** { file: [line, …] } of counted header tables. */
export function scan(root = ROOT) {
  const out = {};
  for (const top of SCAN) {
    const base = join(root, top);
    if (!existsSync(base)) continue;
    for (const f of files(base)) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        const n = (l.match(HEADER) ?? []).length;
        if (!n || lines.slice(Math.max(0, i - 3), i + 1).some((x) => EXEMPT.test(x))) return;
        const rel = relative(root, f).split('\\').join('/');
        (out[rel] ??= []).push(...Array(n).fill(i + 1));
      });
    }
  }
  return out;
}

const found = scan();
const counts = Object.fromEntries(Object.entries(found).map(([f, ls]) => [f, ls.length]).sort(([a], [b]) => a.localeCompare(b)));
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (args.includes('--list')) {
  for (const [f, ls] of Object.entries(found)) for (const l of ls) console.log(`${f}:${l}`);
  console.log(`${total} hand-made header table(s) in ${Object.keys(counts).length} file(s)`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { files: {} };
const was = base.files ?? {};

if (args.includes('--update-baseline')) {
  const seed = !existsSync(BASELINE); // the first run records what was there
  const next = {};
  for (const [f, n] of Object.entries(counts)) {
    if (!seed && (!(f in was) || n > was[f])) { console.error(`✗ ${f}: ${n} table(s), baseline ${was[f] ?? 0}. The baseline only shrinks: convert them to DataGrid.`); process.exitCode = 1; }
    next[f] = seed ? n : Math.min(n, was[f]);
  }
  if (process.exitCode) process.exit(1);
  const wasTotal = Object.values(was).reduce((a, b) => a + b, 0);
  const note = 'Hand-made tables with a header row left when grid-column-hiding came in (Nov 4 2026). Counts may only shrink: convert to DataGrid, then check-grids.mjs --update-baseline.';
  writeFileSync(BASELINE, `${JSON.stringify({ $axf: 'grids-baseline@1', note, total, files: next }, null, 2)}\n`);
  console.log(`grids baseline: ${wasTotal} → ${total}`);
  process.exit(0);
}

let bad = 0;
for (const [f, n] of Object.entries(counts)) {
  const allowed = was[f] ?? 0;
  if (n > allowed) {
    bad++;
    console.error(`✗ ${f}:${found[f][0]}: ${n} hand-made table(s) with a header row (baseline ${allowed}). Use DataGrid from libs/datagrid (rows={…} for a flat table) so its columns hide from the header's right-click menu; a table of someone else's content (Markdown) gets "axf-grid-exempt: <reason>".`);
  }
}
const shrunk = Object.entries(was).filter(([f, n]) => (counts[f] ?? 0) < n);
if (bad) process.exit(1);
console.log(`✓ grids: ${total} hand-made header table(s) left, all in the baseline (${Object.keys(counts).length} files)`);
if (shrunk.length) console.log(`  ${shrunk.length} file(s) went down: run node framework/cli/check-grids.mjs --update-baseline to lock it in`);
