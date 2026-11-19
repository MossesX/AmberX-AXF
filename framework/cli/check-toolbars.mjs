#!/usr/bin/env node
/**
 * check-toolbars — every toolbar is a framework toolbar (Brett, Nov 3 2026, build toolbar-tap-confirm): "Every toolbar
 * uses tap-to-confirm on touch (framework toolbar); single click on desktop." The behaviour itself lives in the
 * framework (framework/react/tapConfirm.ts, installed by <AxfProvider>) and reaches any element with role="toolbar",
 * so this check makes sure every toolbar says it is one:
 *
 *   1. an element whose class names a toolbar (`…toolbar`, `…-tools`, `…__tools`) carries role="toolbar"
 *      (or `data-axf-not-toolbar="<why>"` when it only looks like one);
 *   2. every role="toolbar" has a stable settings id: `data-axf-toolbar`, `data-axf-toolbar-asset` or an aria-label
 *      (its own settings and its tap-to-confirm override are stored under that id);
 *   3. a toolbar that turns tap-to-confirm off in code (`data-axf-tap-confirm="off"`) records why in
 *      `data-axf-tap-confirm-reason="…"`; switching it off for a person is a setting, never code.
 *
 *   4. every plugin page toolbar asset (`apps/<app>/plugins/<folder>/assets/toolbar/*.json`) is page-scoped
 *      (`scope: view:<id>` or `plugin:<id>`, never the app frame) and every button is bound to an action ref
 *      (`command:`, `handler:`, `control:` or `action:`); page-toolbar@1, build rebuild-every-toolbar-page-specific;
 *   5. a plugin that draws a handwritten role="toolbar" ships a page-scoped toolbar asset for its page. The plugins
 *      still without one are held in the ratchet framework/spec/toolbar-page-baseline.json, which only comes down
 *      (`--write-baseline` after rebuilding one; a plugin that now has an asset but is still listed is a finding too).
 *
 *   node framework/cli/check-toolbars.mjs [--json] [--write-baseline] [root…]   (default: every app's src + plugins, framework react/libs/templates)
 * Exit 1 on any finding. Vendored code, baked framework copies (`src/axf`) and tests are skipped.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { parseActionRef, parseToolbarScope } from '../core/engines/toolbar-rules.mjs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const roots = args.filter((a) => !a.startsWith('--')).map((a) => resolve(ROOT, a));
const APPS = (() => { try { return readdirSync(join(ROOT, 'apps')); } catch { return []; } })();
const ROOTS = roots.length ? roots : [
  join(ROOT, 'framework/libs'), join(ROOT, 'framework/react'), join(ROOT, 'framework/templates'), join(ROOT, 'framework/library-templates'),
  join(ROOT, 'framework/boilerplates'), ...APPS.flatMap((a) => [join(ROOT, 'apps', a, 'plugins'), join(ROOT, 'apps', a, 'src')]),
];

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

/** Every JSX opening tag of an element (lowercase tag) with its line; attributes may hold {…} with `>` inside. */
export function openingTags(src) {
  const out = [];
  const re = /<([a-z][a-z0-9]*)\b/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { if (depth || c !== '`') quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ tag: m[1], text: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** The literal part of a className (string, or the static text of a template / expression). */
const classOf = (tag) => {
  const m = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
};
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}=(?:"([^"]*)"|\\{([^}]*)\\})`).exec(tag);
  return m ? (m[1] ?? m[2] ?? '') : null;
};
/** A class token that names a toolbar: ends in `toolbar`, or is `tools` / `…-tools` / `…__tools`. Parts of one aren't. */
export const TOOLBAR_CLASS = /(?:^|[\s"'`{}$])(?:[\w$-]*(?:toolbar)|(?:[\w$-]*[_-])?tools)(?=$|[\s"'`{}])/;

export function checkSource(src) {
  const findings = [];
  for (const t of openingTags(src)) {
    const role = attr(t.text, 'role');
    const cls = classOf(t.text);
    const isBar = role === 'toolbar' || role === "'toolbar'";
    if (!isBar && TOOLBAR_CLASS.test(cls) && attr(t.text, 'data-axf-not-toolbar') === null && !/\brole=/.test(t.text)) {
      findings.push({ line: t.line, rule: 'role', message: `"${cls.trim().slice(0, 60)}" looks like a toolbar: add role="toolbar" and an aria-label (or data-axf-not-toolbar="<why>")` });
      continue;
    }
    if (!isBar) continue;
    if (attr(t.text, 'data-axf-toolbar') === null && attr(t.text, 'data-axf-toolbar-asset') === null && attr(t.text, 'aria-label') === null) {
      findings.push({ line: t.line, rule: 'id', message: 'role="toolbar" without an id: add aria-label (or data-axf-toolbar) so its settings have a home' });
    }
    if (attr(t.text, 'data-axf-tap-confirm') === 'off' && !(attr(t.text, 'data-axf-tap-confirm-reason') ?? '').trim()) {
      findings.push({ line: t.line, rule: 'reason', message: 'tap-to-confirm switched off in code without data-axf-tap-confirm-reason="<why>"' });
    }
  }
  return findings;
}

/* ---------------- page toolbar assets (rules 4 and 5) ---------------- */

const BASELINE = join(ROOT, 'framework/spec/toolbar-page-baseline.json');
const pluginDirs = () => APPS.flatMap((a) => {
  const base = join(ROOT, 'apps', a, 'plugins');
  try { return readdirSync(base).filter((n) => !n.startsWith('_') && !n.startsWith('.')).map((n) => ({ app: a, folder: n, dir: join(base, n) })).filter((p) => statSync(p.dir).isDirectory()); } catch { return []; }
});

/** Rule 4: one asset file → its findings (page scope, every button bound). */
export function checkPageToolbarAsset(text) {
  const out = [];
  let a; try { a = JSON.parse(text); } catch (e) { return [{ line: 1, rule: 'asset', message: `not JSON: ${e.message}` }]; }
  if (a?.type !== 'toolbar') return [{ line: 1, rule: 'asset', message: `type "${a?.type}" is not toolbar` }];
  const scope = parseToolbarScope(a.data?.scope);
  if (!scope || scope.kind === 'app') out.push({ line: 1, rule: 'page-scope', message: 'a plugin toolbar asset is page-scoped: scope "view:<id>" or "plugin:<id>"' });
  for (const g of a.data?.groups ?? []) for (const it of g.items ?? []) {
    if (!g.provider && !parseActionRef(it.action)) out.push({ line: 1, rule: 'unbound', message: `button ${g.id}/${it.id} is not bound to an action ref (command:, handler:, control: or action:)` });
  }
  return out;
}

/** Rule 5: the plugins drawing a handwritten toolbar with no page-scoped asset (a placeholder default-<plugin>-toolbar,
 * toolbar-owner@1, does not count: it carries only the Settings button). */
export function pluginsWithoutPageToolbar() {
  const missing = [];
  for (const p of pluginDirs()) {
    const assets = join(p.dir, 'assets', 'toolbar');
    const has = existsSync(assets) && readdirSync(assets).some((f) => { if (!f.endsWith('.json')) return false; try { const j = JSON.parse(readFileSync(join(assets, f), 'utf8')); if ((j.tags ?? []).includes('placeholder')) return false; const sc = parseToolbarScope(j.data?.scope); return !!sc && sc.kind !== 'app'; } catch { return false; } });
    if (has) continue;
    const draws = walk(p.dir).some((f) => /role="toolbar"/.test(readFileSync(f, 'utf8')));
    if (draws) missing.push(`${p.app}/${p.folder}`);
  }
  return missing.sort();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const all = [];
  let files = 0;
  for (const r of ROOTS) for (const f of walk(r)) {
    files++;
    for (const x of checkSource(readFileSync(f, 'utf8'))) all.push({ file: relative(ROOT, f), ...x });
  }
  if (!roots.length) {
    for (const p of pluginDirs()) {
      const d = join(p.dir, 'assets', 'toolbar');
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) { files++; for (const x of checkPageToolbarAsset(readFileSync(join(d, f), 'utf8'))) all.push({ file: relative(ROOT, join(d, f)), ...x }); }
    }
    const missing = pluginsWithoutPageToolbar();
    if (args.includes('--write-baseline')) writeFileSync(BASELINE, `${JSON.stringify({ $comment: 'Plugins that draw a handwritten toolbar and ship no page-scoped toolbar asset yet (framework/cli/check-toolbars.mjs rule 5). Only comes down: rebuild one, then --write-baseline.', plugins: missing }, null, 2)}\n`);
    let base = [];
    try { base = JSON.parse(readFileSync(BASELINE, 'utf8')).plugins ?? []; } catch { /* no baseline: every one is a finding */ }
    for (const m of missing) if (!base.includes(m)) all.push({ file: `apps/${m.replace('/', '/plugins/')}`, line: 0, rule: 'no-page-asset', message: 'draws a toolbar but ships no page-scoped toolbar asset (assets/toolbar/*.json with scope view:/plugin:)' });
    for (const b of base) if (!missing.includes(b)) all.push({ file: relative(ROOT, BASELINE), line: 0, rule: 'baseline', message: `${b} has a page toolbar asset now: take it out of the baseline (--write-baseline)` });
  }
  if (json) console.log(JSON.stringify({ files, findings: all }, null, 2));
  else {
    for (const x of all) console.log(`${x.file}:${x.line}  [${x.rule}] ${x.message}`);
    console.log(all.length ? `✗ ${all.length} toolbar finding(s) in ${files} file(s)` : `✓ every toolbar is a framework toolbar — ${files} file(s) checked`);
  }
  process.exit(all.length ? 1 : 0);
}
