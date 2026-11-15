#!/usr/bin/env node
/**
 * check-dropdowns — no new drop-down bars (Brett, Nov 13 2026: "I don't want drop-down bars anymore. They are gonna be
 * animated. It's gonna be a row with a name and a little arrow; when you press that arrow it expands a subgrid; you got
 * to press it again to apply it and close it").
 *
 * The framework's pick-one control is the expander picker (expander-picker@1: <ExpanderPicker> / <SelectField>). A raw
 * native `<select>` in any web UI (framework React views and libraries, templates, every app's src and plugins) is a
 * finding, except the ones already there when the rule came in: those are held per file at the count recorded in
 * framework/spec/dropdowns-baseline.json and migrated over time. A file may only go down: a new file with a <select>, or
 * one more in a listed file, fails. When a migration lowers a count, `--update` writes the lower baseline (it never raises one).
 *
 *   node framework/cli/check-dropdowns.mjs [--json] [--update]
 * Exit 1 on any finding. Built output (dist/, node_modules/) and vendored code are skipped.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = join(ROOT, 'framework/spec/dropdowns-baseline.json');
const args = process.argv.slice(2);
const json = args.includes('--json');
const update = args.includes('--update');

const APPS = (() => { try { return readdirSync(join(ROOT, 'apps')); } catch { return []; } })();
const ROOTS = [
  'framework/react', 'framework/libs', 'framework/templates', 'framework/library-templates', 'framework/boilerplates',
  ...APPS.flatMap((a) => [`apps/${a}/src`, `apps/${a}/plugins`]),
].map((r) => join(ROOT, r)).filter((r) => existsSync(r));
const SKIP = new Set(['node_modules', 'dist', 'build', 'vendor', '.vite', 'coverage']);
const EXT = /\.(tsx|jsx|html|vue|svelte)$/;
/** a native select element as written in JSX / HTML (not the word in a comment like "no <select> here": needs an attribute or >) */
const RAW = /<select(?=[\s>])/g;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
  }
  return out;
}

/** count raw selects outside comments (block and line comments are blanked first) */
export function countRawSelects(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');
  return (code.match(RAW) ?? []).length;
}

const counts = {};
for (const r of ROOTS) for (const f of walk(r, [])) {
  const n = countRawSelects(readFileSync(f, 'utf8'));
  if (n) counts[relative(ROOT, f)] = n;
}
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).files ?? {} : {};
const findings = [];
const lower = [];
for (const [f, n] of Object.entries(counts)) {
  const held = baseline[f] ?? 0;
  if (n > held) findings.push({ file: f, count: n, held, message: held ? `${n} raw <select> (baseline ${held}): use <ExpanderPicker> / <SelectField>` : `${n} raw <select>: use <ExpanderPicker> / <SelectField> (framework/react/components/ExpanderPicker.tsx)` });
}
for (const [f, held] of Object.entries(baseline)) if ((counts[f] ?? 0) < held) lower.push({ file: f, count: counts[f] ?? 0, held });
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (update) {
  const next = {};
  for (const [f, held] of Object.entries(baseline)) { const n = Math.min(held, counts[f] ?? 0); if (n) next[f] = n; }
  // first run only: an empty baseline records what is there; afterwards --update only ever lowers
  if (!existsSync(BASELINE)) Object.assign(next, counts);
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, JSON.stringify({
    $comment: 'Raw native <select> elements held per file by framework/cli/check-dropdowns.mjs until they move to <ExpanderPicker> / <SelectField> (expander-picker@1). Counts only go down: run the check with --update after a migration.',
    total: Object.values(sorted).reduce((a, b) => a + b, 0),
    files: sorted,
  }, null, 2) + '\n');
}

if (json) console.log(JSON.stringify({ ok: !findings.length, total, findings, lower }, null, 2));
else {
  for (const x of findings) console.log(`✗ ${x.file}: ${x.message}`);
  if (lower.length && !update) console.log(`  ${lower.length} file(s) below their baseline: run with --update to lock the progress in`);
  console.log(findings.length ? `✗ dropdowns: ${findings.length} file(s) with new raw <select>` : `✓ dropdowns — no new raw <select> (${total} held at the baseline in framework/spec/dropdowns-baseline.json)`);
}
process.exit(findings.length ? 1 : 0);
