#!/usr/bin/env node
/**
 * check-tab-actions — every tab is reachable by agents, voice, MCP and links (build tabs-api-control, Brett Nov 8 2026:
 * "CI check: any tab without an action fails").
 *
 * The behaviour lives in the framework (tab-control@1: framework/react/tabControl.ts, core/engines/tab-control.mjs):
 * every mounted `TabGroup` registers its row, so its tabs get `tab.<row>.<tab>` actions and open by path
 * (`tab.open:<screen>/<tab>`, console_open "screen/tab", `?axf-open=`). This check makes sure nothing slips past it:
 *
 *   1. the framework wiring is there: TabGroup calls useTabControl, Container and the settings sections call
 *      useSectionControl, AxfProvider installs tab control;
 *   2. every `<TabGroup` carries an `id` (its row id is part of each tab's action id);
 *   3. a hand-drawn tab row (role="tablist", role="tab" or data-axf-tab-group on a plain element) is in a file that
 *      registers it with `useTabControl(` (or `registerTabTarget(`); otherwise its tabs have no action.
 *
 *   node framework/cli/check-tab-actions.mjs [--json] [root…]   (default: every app's src + plugins, framework react/libs/templates)
 * Exit 1 on any finding. Vendored code, baked framework copies (`src/axf`) and tests are skipped.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n === 'vendor' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (/[\\/]src[\\/]axf$/.test(p)) continue; // baked framework copies are checked at their source
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|jsx)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/** The JSX opening tag starting at `at` (attributes may hold {…} with `>` and strings inside). */
function openingTag(src, at) {
  let depth = 0, quote = '';
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

/** Findings for one file's source (`rel` = its repo path). */
export function checkTabSource(src, rel) {
  const out = [];
  if (/framework\/react\/components\/TabGroup\.tsx$/.test(rel)) return out; // the row itself (checked by the wiring step)
  // 2. every framework <TabGroup has an id (a file's own local TabGroup — Expenses' vendored dock — is a different control)
  const frameworkRow = !/import\s+TabGroup\s+from\s+['"]\.{1,2}\//.test(src);
  if (frameworkRow) for (const m of src.matchAll(/<TabGroup(<[^<>]*>)?(?=[\s/>])/g)) {
    const tag = openingTag(src, m.index + m[0].length - 1);
    if (!/(^|\s)id=/.test(tag) && !/\{\.\.\./.test(tag)) out.push({ file: rel, line: lineOf(src, m.index), message: '<TabGroup> without an id: its tabs get no tab.<row>.<tab> action', fix: 'give it a stable id="<plugin>.<row>"' });
  }
  // 3. hand-drawn rows register themselves
  const registers = /\buseTabControl\(|\bregisterTabTarget\(/.test(src);
  if (!registers) {
    const re = /role="tablist"|role="tab"|data-axf-tab-group=/g;
    const seen = new Set();
    for (const m of src.matchAll(re)) {
      // the Help / context-menu code only *reads* tab rows (selectors in strings), it draws none
      const before = src.slice(Math.max(0, m.index - 2), m.index);
      if (/['"`[(]$/.test(before.trim().slice(-1))) continue;
      const line = lineOf(src, m.index);
      if (seen.has(line)) continue;
      seen.add(line);
      out.push({ file: rel, line, message: `hand-drawn tab row (${m[0]}) with no action: agents, voice and MCP can't switch its tabs`, fix: 'use <TabGroup id=…> or call useTabControl({ id, label, value, tabs, onSelect }) for the row' });
    }
  }
  return out;
}

/** 1. The framework wiring that gives every TabGroup / section its action. */
export function checkWiring(root = ROOT) {
  const out = [];
  const need = [
    ['framework/react/components/TabGroup.tsx', /\buseTabControl\(/, 'TabGroup must register its row (useTabControl)'],
    ['framework/react/components/Controls.tsx', /\buseSectionControl\(/, 'Container must register titled sections (useSectionControl)'],
    ['framework/libs/settings/index.tsx', /\buseSectionControl\(/, 'settings sections must register (useSectionControl)'],
    ['framework/react/AxfProvider.tsx', /\binstallTabControl\(/, 'AxfProvider must install tab control (tab.open, per-tab actions, ?axf-open=)'],
  ];
  for (const [file, re, message] of need) {
    let src = '';
    try { src = readFileSync(join(root, file), 'utf8'); } catch { out.push({ file, line: 1, message: `${file} is missing`, fix: message }); continue; }
    if (!re.test(src)) out.push({ file, line: 1, message, fix: 'see framework/react/tabControl.ts' });
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const roots = args.filter((a) => !a.startsWith('--')).map((a) => resolve(ROOT, a));
  const APPS = (() => { try { return readdirSync(join(ROOT, 'apps')); } catch { return []; } })();
  const ROOTS = roots.length ? roots : [
    join(ROOT, 'framework/libs'), join(ROOT, 'framework/react'), join(ROOT, 'framework/templates'), join(ROOT, 'framework/library-templates'),
    join(ROOT, 'framework/boilerplates'), ...APPS.flatMap((a) => [join(ROOT, 'apps', a, 'plugins'), join(ROOT, 'apps', a, 'src')]),
  ];
  const findings = [...(roots.length ? [] : checkWiring())];
  let files = 0;
  for (const r of ROOTS) for (const f of walk(r)) { files++; findings.push(...checkTabSource(readFileSync(f, 'utf8'), relative(ROOT, f).split('\\').join('/'))); }
  if (json) console.log(JSON.stringify({ files, findings }, null, 2));
  else if (!findings.length) console.log(`check-tab-actions: ${files} files, every tab row has an action (tab-control@1)`);
  else {
    for (const f of findings) console.log(`${f.file}:${f.line}  ${f.message}\n    → ${f.fix}`);
    console.log(`\ncheck-tab-actions: ${findings.length} tab row(s) without an action`);
  }
  process.exit(findings.length ? 1 : 0);
}
