#!/usr/bin/env node
/**
 * check-pickers — every drop-down is the framework's (picker@1, spec/PICKER.md; build picker-dialog-plugin-replaces-all,
 * Nov 14 2026). Brett: "I want a plugin that replaces all drop down select boxes with a themable dialogue that matches
 * the theme; skins have to touch them; they must conform to the token system".
 *
 * Findings:
 *   - a raw `<select>` in web UI code (apps' src and plugins, framework react / libs / templates): use `SelectField`
 *     (labelled), `Select` (bare) or `PickerField` (groups, icons, multiple), so the picker swap draws it;
 *   - a hand-made value list: `role="listbox"` outside the framework's own components (menus, search suggestions and
 *     the picker itself live there);
 *   - a literal colour or size in the picker's styles (`.fx-picker*` rules in framework/ui/axf.css): every value comes
 *     from the --fx-picker-* tokens.
 *
 * Ratchet (framework/spec/picker-baseline.json): files listed there may keep up to their recorded count of findings;
 * counts only go down, a file not listed must be clean. CSS findings are never baselined.
 *
 *   node framework/cli/check-pickers.mjs [--json] [--write-baseline] [root…]
 * Exit 1 on any finding over the baseline. Vendored code, baked framework copies (`src/axf`) and tests are skipped.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BASELINE_FILE = join(ROOT, 'framework/spec/picker-baseline.json');
const args = process.argv.slice(2);
const json = args.includes('--json');
const writeBaseline = args.includes('--write-baseline');
const roots = args.filter((a) => !a.startsWith('--')).map((a) => resolve(ROOT, a));

const APPS = (() => { try { return readdirSync(join(ROOT, 'apps')); } catch { return []; } })();
const ROOTS = roots.length ? roots : [
  join(ROOT, 'framework/libs'), join(ROOT, 'framework/react'), join(ROOT, 'framework/templates'), join(ROOT, 'framework/library-templates'),
  ...APPS.flatMap((a) => [join(ROOT, 'apps', a, 'plugins'), join(ROOT, 'apps', a, 'src')]),
];
/** Where the framework's drop-downs, menus and search are defined: their selects and listboxes ARE the controls. */
const DEFINES = ['framework/react/components', 'framework/react/windows'];

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n === 'vendor' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (/[\\/]src[\\/]axf$/.test(p)) continue;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|jsx)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/** Findings in one JSX file. */
export function scanSource(src, rel) {
  const out = [];
  const defining = DEFINES.some((d) => rel.startsWith(d + '/'));
  if (defining) return out;
  for (const m of src.matchAll(/<select\b/g)) out.push({ line: lineOf(src, m.index), kind: 'select', message: 'raw <select>: use SelectField, Select or PickerField (node framework/cli/picker-migrate.mjs --write <file>)' });
  for (const m of src.matchAll(/role=["']listbox["']/g)) out.push({ line: lineOf(src, m.index), kind: 'listbox', message: 'hand-made listbox: use PickerField (or a framework menu if it runs actions)' });
  return out;
}

const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b\d+(?:\.\d+)?(?:px|rem|pt)\b/i;

/** Literal colours / sizes inside `.fx-picker*` rules of a stylesheet. */
export function scanPickerCss(css) {
  const out = [];
  const lines = css.split('\n');
  let inPicker = false;
  let depth = 0;
  lines.forEach((l, i) => {
    const code = l.replace(/\/\*.*?\*\//g, '');
    if (!depth && /\.fx-picker/.test(code) && code.includes('{')) inPicker = true;
    else if (!depth && /\.fx-picker/.test(code) && !code.includes('{')) inPicker = true; // selector list continues
    if (inPicker && LITERAL.test(code.replace(/^[^{]*\{/, ''))) out.push({ line: i + 1, kind: 'css', message: `literal value in a picker rule: ${code.trim().slice(0, 120)} — use a --fx-picker-* token` });
    depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
    if (depth <= 0) { depth = 0; if (code.includes('}')) inPicker = false; }
  });
  return out;
}

function loadBaseline() {
  try { return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')); } catch { return { $axf: 'picker-baseline@1', files: {} }; }
}

export function overBaseline(perFile, baseline) {
  const over = [];
  for (const [file, list] of Object.entries(perFile)) {
    const allowed = baseline.files?.[file] ?? 0;
    if (list.length > allowed) over.push({ file, count: list.length, allowed, findings: list });
  }
  return over;
}

const perFile = {};
for (const root of ROOTS) for (const f of walk(root)) {
  const rel = relative(ROOT, f).split('\\').join('/');
  const found = scanSource(readFileSync(f, 'utf8'), rel);
  if (found.length) perFile[rel] = found;
}
const cssFindings = scanPickerCss(readFileSync(join(ROOT, 'framework/ui/axf.css'), 'utf8'));

if (writeBaseline) {
  const files = Object.fromEntries(Object.entries(perFile).sort(([a], [b]) => a.localeCompare(b)).map(([f, l]) => [f, l.length]));
  writeFileSync(BASELINE_FILE, JSON.stringify({ $axf: 'picker-baseline@1', note: 'Hand-made drop-downs left over when check-pickers.mjs landed (Nov 14 2026; picker@1): per file, how many raw <select> / role=listbox findings it may still have. Counts only go down; a file not listed must be clean. Move one with node framework/cli/picker-migrate.mjs --write <file>, then regenerate: node framework/cli/check-pickers.mjs --write-baseline', files }, null, 2) + '\n');
}
const baseline = loadBaseline();
const over = overBaseline(perFile, baseline);
const held = Object.values(perFile).reduce((n, l) => n + l.length, 0);
const ok = !over.length && !cssFindings.length;

if (json) console.log(JSON.stringify({ ok, over, css: cssFindings, held }, null, 2));
else {
  for (const o of over) {
    console.log(`✗ ${o.file}: ${o.count} hand-made drop-down(s), baseline ${o.allowed}`);
    for (const f of o.findings) console.log(`    ${o.file}:${f.line}  ${f.message}`);
  }
  for (const f of cssFindings) console.log(`✗ framework/ui/axf.css:${f.line}  ${f.message}`);
  console.log(ok ? `✓ pickers — every drop-down is the framework's (${held} finding(s) held at the baseline in framework/spec/picker-baseline.json)` : `✗ pickers — ${over.length + cssFindings.length} problem(s)`);
}
process.exit(ok ? 0 : 1);
