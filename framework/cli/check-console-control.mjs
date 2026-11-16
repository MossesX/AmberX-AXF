#!/usr/bin/env node
/**
 * Console-control coverage (console-control@1, framework/spec/CONSOLE-CONTROL.md): everything Brett can see in the
 * console must have an address, so REST, MCP, the CLI and voice can reach it. Counts what has none and fails when any
 * count rises above the ratchet baseline (framework/spec/console-control-baseline.json), which only ever goes down.
 *
 *   views        a view in the console inventory without an address
 *   nav          a nav entry that names no view address
 *   tabGroups    a TabGroup whose id is not static (no address known before it renders)
 *   settings     a setting in the inventory without an address
 *   plugins      an installed plugin (plugins/<folder>/plugin.json) missing from the inventory
 *   toolbars     a role="toolbar" element without an aria-label (its buttons are addressed by label)
 *   dataGrids    a <DataGrid> without an id (its rows get no grid:<id>/row:<id> address)
 *   rawButtons   a hand-drawn <button> with no data-axf-target (framework Buttons register themselves)
 *
 *   node framework/cli/check-console-control.mjs            check (CI)
 *   node framework/cli/check-console-control.mjs --update   lower the baseline to today's counts (never raises it)
 *   --json                                                    the counts as JSON
 * The inventory must be current too (apps/console-web/scripts/control-inventory.mjs --check).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const APP = join(ROOT, 'apps/console-web');
const INVENTORY = join(APP, 'src/control/inventory.json');
const BASELINE = join(ROOT, 'framework/spec/console-control-baseline.json');
/** Code the console draws: its own source, its plugins' web parts and the framework's React layer and libraries. */
const CODE_DIRS = [join(APP, 'src'), join(APP, 'plugins'), join(ROOT, 'framework/react'), join(ROOT, 'framework/libs')];
const SKIP = new Set(['node_modules', 'dist', 'axf', 'server', '__tests__']);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.tsx$/.test(n) && !/\.(test|spec)\.tsx$/.test(n)) yield p;
  }
}

/** Every JSX opening tag of `name` in a source (multi-line tags included): [{ text, line }]. */
export function openingTags(src, name) {
  const out = [];
  const re = new RegExp(`<${name}(?=[\\s>/])`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + name.length + 1, depth = 0, quote = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ text: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** The counts of things without an address, with where each one is. */
export function coverage() {
  const inv = JSON.parse(readFileSync(INVENTORY, 'utf8'));
  const where = { views: [], nav: [], tabGroups: [], settings: [], plugins: [], toolbars: [], dataGrids: [], rawButtons: [] };
  for (const v of inv.views ?? []) if (!v.address) where.views.push(v.id);
  for (const n of inv.nav ?? []) if (!n.address) where.nav.push(`${n.section} › ${n.label}`);
  for (const g of inv.tabGroups ?? []) if (!g.address) where.tabGroups.push(`${g.file}:${g.line}`);
  for (const s of inv.settings ?? []) if (!s.address) where.settings.push(s.key ?? s.label);
  const known = new Set((inv.plugins ?? []).map((p) => p.folder));
  const pdir = join(APP, 'plugins');
  for (const f of existsSync(pdir) ? readdirSync(pdir) : []) if (!f.startsWith('_') && existsSync(join(pdir, f, 'plugin.json')) && !known.has(f)) where.plugins.push(f); // _template is the scaffold
  for (const dir of CODE_DIRS) {
    for (const file of walk(dir)) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(ROOT, file);
      for (const t of openingTags(src, 'button')) if (!/data-axf-target|data-axf-action|data-axf-settings-nav|\{\.\.\.(?:rest|props|p)\}/.test(t.text)) where.rawButtons.push(`${rel}:${t.line}`);
      for (const t of openingTags(src, 'DataGrid')) if (!/\sid=/.test(t.text)) where.dataGrids.push(`${rel}:${t.line}`);
      for (const tag of ['div', 'nav', 'section', 'header', 'footer', 'span']) {
        for (const t of openingTags(src, tag)) if (/role=["']toolbar["']/.test(t.text) && !/aria-label/.test(t.text)) where.toolbars.push(`${rel}:${t.line}`);
      }
    }
  }
  const counts = Object.fromEntries(Object.entries(where).map(([k, v]) => [k, v.length]));
  return { counts, where };
}

/** Errors for counts above the baseline (a missing key = 0 allowed). */
export function ratchetErrors(counts, baseline) {
  return Object.entries(counts).filter(([k, n]) => n > (baseline[k] ?? 0)).map(([k, n]) => `${k}: ${n} without an address (baseline ${baseline[k] ?? 0})`);
}

function main(argv) {
  const json = argv.includes('--json');
  const update = argv.includes('--update');
  try { execFileSync('node', [join(APP, 'scripts/control-inventory.mjs'), '--check'], { stdio: 'pipe' }); } catch (e) {
    console.error(`✗ the console-control inventory is stale: run node apps/console-web/scripts/control-inventory.mjs\n${String(e.stdout ?? '')}${String(e.stderr ?? '')}`.trim());
    return 1;
  }
  const { counts, where } = coverage();
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { counts: {} };
  if (update) {
    const next = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, base.counts?.[k] === undefined ? n : Math.min(n, base.counts[k])]));
    writeFileSync(BASELINE, JSON.stringify({ $axf: 'console-control-baseline@1', note: 'Things the console shows without a console-control address. Only goes down: node framework/cli/check-console-control.mjs --update', counts: next }, null, 2) + '\n');
    console.log(`baseline: ${JSON.stringify(next)}`);
  }
  const after = update ? JSON.parse(readFileSync(BASELINE, 'utf8')) : base;
  const errors = ratchetErrors(counts, after.counts ?? {});
  if (json) console.log(JSON.stringify({ counts, baseline: after.counts, errors }, null, 2));
  if (errors.length) {
    console.error('✗ console-control coverage went up (something new has no address):');
    for (const e of errors) {
      console.error(`  ${e}`);
      const k = e.split(':')[0];
      for (const w of where[k].slice(0, 12)) console.error(`    ${w}`);
    }
    console.error('  give it an address (data-axf-target, a TabGroup / DataGrid id, a framework Button) — see framework/spec/CONSOLE-CONTROL.md');
    return 1;
  }
  const lower = Object.entries(counts).filter(([k, n]) => n < (after.counts?.[k] ?? 0));
  if (!json) console.log(`✓ console-control coverage — ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}${lower.length ? ` (lower than the baseline: run --update to lock in ${lower.map(([k]) => k).join(', ')})` : ''}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
