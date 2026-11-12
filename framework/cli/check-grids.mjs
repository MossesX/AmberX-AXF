#!/usr/bin/env node
/**
 * check-grids — every grid, table and log is on the expandable-row framework (grid-row@1, Brett, Nov 11 2026: "expandable
 * rows with all the information, with hooks to other stuff that's related. Commands, stuff I can do with it. All the grids
 * and logs need that information."). Reference: framework/libs/datagrid/rowkinds.ts.
 *
 * In every web UI (apps' plugins and own code, framework libs and React; baked `src/axf` copies, node_modules, dist,
 * vendor and tests skipped) it fails on:
 *   - a `<DataGrid` without `rowKind=` or `rowRef=` (its rows say no kind, so no fields / Related / commands);
 *   - a `<table` or `role="log"` in a file that never draws the expanded row (`DetailTableRow`, `RowDetail`,
 *     `RowExpander`, or a DataGrid);
 *   - a row kind used (`rowKind="x"`, `rowRef … kind: 'x'`, `<RowExpander|RowDetail|DetailTableRow rowRef={{ kind: 'x'`)
 *     that nobody registers (`registerRowKind({ kind: 'x' … aliases })` or `extendRowKind('x'`) with `commands`.
 * Files that truly can't (a markdown renderer's table, a settings form laid out as a table…) are frozen in
 * framework/cli/check-grids.baseline.json with the reason: their counts may only go down (`--update-baseline` rewrites
 * the counts after a fix, keeping the reasons).
 *
 *   node framework/cli/check-grids.mjs [--json] [--list] [--update-baseline]
 * --list prints the inventory (every grid / table / log per file and whether it is on the framework). Exit 1 on findings.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = join(ROOT, 'framework/cli/check-grids.baseline.json');
const args = process.argv.slice(2);
const json = args.includes('--json');
const list = args.includes('--list');
const update = args.includes('--update-baseline');

const APPS = (() => { try { return readdirSync(join(ROOT, 'apps')); } catch { return []; } })();
const ROOTS = [join(ROOT, 'framework/libs'), join(ROOT, 'framework/react'), ...APPS.flatMap((a) => [join(ROOT, 'apps', a, 'plugins'), join(ROOT, 'apps', a, 'src')])];
/** Where the framework itself draws grids (the DataGrid and its expanded row). */
const SKIP_FILES = new Set(['framework/libs/datagrid/index.tsx', 'framework/libs/datagrid/rowdetail.tsx']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'vendor', 'axf', '__tests__', 'test', 'tests'].includes(name) || name.startsWith('.')) {
      // `axf` is skipped only as the baked framework copy (apps/<app>/src/axf)
      if (name !== 'axf' || /[\\/]src$/.test(dir)) continue;
    }
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = [...new Set(ROOTS.flatMap((r) => walk(r)))].map((p) => ({ path: relative(ROOT, p).split('\\').join('/'), text: readFileSync(p, 'utf8') })).filter((f) => !SKIP_FILES.has(f.path));

/* ---------- registered kinds (with commands) */
const registered = new Map(); // kind → { file, commands }
for (const f of files) {
  const t = f.text;
  for (const m of t.matchAll(/registerRowKind\(\s*\{\s*kind:\s*['"]([\w-]+)['"]/g)) {
    const from = m.index ?? 0;
    const next = t.indexOf('registerRowKind(', from + 10);
    const body = t.slice(from, next > 0 ? next : from + 6000);
    const commands = /\bcommands:\s*[[\w]/.test(body);
    const al = /aliases:\s*\[([^\]]*)\]/.exec(body.slice(0, 600));
    for (const k of [m[1], ...(al ? [...al[1].matchAll(/['"]([\w-]+)['"]/g)].map((x) => x[1]) : [])]) {
      const prev = registered.get(k);
      registered.set(k, { file: f.path, commands: commands || !!prev?.commands });
    }
  }
  for (const m of t.matchAll(/extendRowKind\(\s*['"]([\w-]+)['"]\s*,\s*\{[^]*?commands:\s*\[/g)) {
    const prev = registered.get(m[1]);
    registered.set(m[1], { file: prev?.file ?? f.path, commands: true });
  }
}

/* ---------- per file: grids, tables, logs, kinds used */
const ADOPT = /\b(DetailTableRow|RowDetail|RowExpander)\b/;
const inventory = [];
const findings = [];
for (const f of files) {
  const t = f.text;
  const lineOf = (i) => t.slice(0, i).split('\n').length;
  const grids = [...t.matchAll(/<DataGrid\b/g)].map((m) => {
    const from = m.index ?? 0;
    const next = t.indexOf('<DataGrid', from + 5);
    const win = t.slice(from, next > 0 ? Math.min(next, from + 4000) : from + 4000);
    return { line: lineOf(from), kinded: /\browKind=|\browRef=/.test(win) };
  });
  const tables = [...t.matchAll(/<table\b/g)].map((m) => lineOf(m.index ?? 0));
  const logs = [...t.matchAll(/role=["']log["']/g)].map((m) => lineOf(m.index ?? 0));
  const adopted = ADOPT.test(t) || grids.some((g) => g.kinded);
  const used = new Set();
  for (const m of t.matchAll(/rowKind=["']([\w-]+)["']/g)) used.add(m[1]);
  for (const m of t.matchAll(/rowKind=\{?["']([\w-]+)["']/g)) used.add(m[1]);
  for (const m of t.matchAll(/(?:rowRef=\{[^\n]{0,160}?|kind=)kind:\s*['"]([\w-]+)['"]/g)) used.add(m[1]);
  for (const m of t.matchAll(/rowRef=\{[^\n]{0,200}?kind:\s*['"]([\w-]+)['"](?:[^\n]{0,80}?:\s*['"]([\w-]+)['"])?/g)) { used.add(m[1]); if (m[2]) used.add(m[2]); }
  for (const m of t.matchAll(/\b(?:RowExpander|RowDetail|DetailTableRow|RowToggle) rowRef=\{\{\s*kind:\s*['"]([\w-]+)['"]/g)) used.add(m[1]);
  // a MeterTable-style prop handing the kind to a DataGrid inside (kind="employee")
  if (/rowKind=\{kind\}/.test(t)) for (const m of t.matchAll(/\bkind=["']([\w-]+)["']/g)) used.add(m[1]);
  const bad = {
    grids: grids.filter((g) => !g.kinded).map((g) => g.line),
    tables: adopted ? [] : tables,
    logs: adopted ? [] : logs,
    kinds: [...used].filter((k) => !registered.get(k)?.commands),
  };
  if (grids.length || tables.length || logs.length || used.size) inventory.push({ file: f.path, grids: grids.length, tables: tables.length, logs: logs.length, kinds: [...used], adopted, bad });
  const count = bad.grids.length + bad.tables.length + bad.logs.length + bad.kinds.length;
  if (count) findings.push({ file: f.path, ...bad });
}

/* ---------- baseline (ratchet) */
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { files: {} };
const over = [];
for (const x of findings) {
  const b = base.files?.[x.file];
  const n = { grids: x.grids.length, tables: x.tables.length, logs: x.logs.length, kinds: x.kinds.length };
  const allowed = b ? { grids: b.grids ?? 0, tables: b.tables ?? 0, logs: b.logs ?? 0, kinds: b.kinds ?? 0 } : { grids: 0, tables: 0, logs: 0, kinds: 0 };
  const worse = Object.keys(n).filter((k) => n[k] > allowed[k]);
  if (worse.length) over.push({ ...x, worse });
}
if (update) {
  const files = {};
  for (const x of findings) {
    const prev = base.files?.[x.file];
    files[x.file] = { grids: x.grids.length, tables: x.tables.length, logs: x.logs.length, kinds: x.kinds.length, why: prev?.why ?? 'TODO: say why this one cannot use the expandable-row framework' };
    for (const k of ['grids', 'tables', 'logs', 'kinds']) if (!files[x.file][k]) delete files[x.file][k];
  }
  writeFileSync(BASELINE, `${JSON.stringify({ $axf: 'check-grids-baseline@1', note: 'Grids, tables and logs that cannot use the expandable-row framework (grid-row@1) yet, with why. Counts may only go down.', files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`);
  console.log(`check-grids: baseline written (${findings.length} file(s)).`);
  process.exit(0);
}
const noWhy = Object.entries(base.files ?? {}).filter(([, v]) => !v.why || /^TODO/.test(v.why)).map(([k]) => k);

if (json) { console.log(JSON.stringify({ ok: !over.length && !noWhy.length, over, noWhy, inventory, kinds: Object.fromEntries(registered) }, null, 2)); process.exit(over.length || noWhy.length ? 1 : 0); }
if (list) {
  for (const i of inventory) {
    const on = i.adopted && !i.bad.grids.length && !i.bad.tables.length && !i.bad.logs.length && !i.bad.kinds.length;
    const frozen = !on && base.files?.[i.file] ? ' (baseline)' : '';
    console.log(`${on ? '✓' : '✗'} ${i.file}: ${[i.grids && `${i.grids} grid(s)`, i.tables && `${i.tables} table(s)`, i.logs && `${i.logs} log(s)`].filter(Boolean).join(', ') || 'rows'}${i.kinds.length ? ` · kinds ${i.kinds.join(', ')}` : ''}${frozen}`);
  }
  console.log(`\n${registered.size} row kinds registered: ${[...registered.entries()].map(([k, v]) => `${k}${v.commands ? '' : ' (no commands)'}`).join(', ')}`);
}
if (over.length || noWhy.length) {
  for (const x of over) {
    console.error(`✗ ${x.file}`);
    if (x.worse.includes('grids')) console.error(`  DataGrid without rowKind / rowRef at line ${x.grids.join(', ')}: say what its rows are (grid-row@1)`);
    if (x.worse.includes('tables')) console.error(`  <table> at line ${x.tables.join(', ')} with no expanded row: use DataGrid, or DetailTableRow + RowToggle`);
    if (x.worse.includes('logs')) console.error(`  role="log" at line ${x.logs.join(', ')} with no expanded row: use RowExpander / RowDetail per entry`);
    if (x.worse.includes('kinds')) console.error(`  row kind(s) ${x.kinds.join(', ')} not registered with commands: registerRowKind({ kind, commands: [...] })`);
  }
  for (const f of noWhy) console.error(`✗ ${f}: baseline entry has no reason (framework/cli/check-grids.baseline.json "why")`);
  console.error(`\ncheck-grids: ${over.length + noWhy.length} problem(s). Reference: framework/libs/datagrid/rowkinds.ts`);
  process.exit(1);
}
console.log(`✓ check-grids — ${inventory.length} file(s) with grids / tables / logs, ${registered.size} row kinds, ${Object.keys(base.files ?? {}).length} frozen in the baseline`);
