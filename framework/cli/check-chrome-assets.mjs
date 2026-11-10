#!/usr/bin/env node
/**
 * check-chrome-assets — every tab group, toolbar, banner and navigation menu is an asset with an asset settings
 * interface reachable by right-click (Brett, Nov 4 2026, build tab-group-assets: "all tab groups are supposed to be
 * assets. With a settings interface, that's also an asset." Addendum 1: "navigation menus, toolbars, banners, are all
 * asset types, and they all have a settings interface, which is an asset, and we can get to their settings by
 * right-clicking all of them.").
 *
 * What it refuses in app, plugin, library and template code (framework/react is the one place that may draw them):
 *   tab-row    a hand-made tab row: role="tablist", role="tab", or a `fx-tabs` / `fx-tab` class on an element that is
 *              not the framework TabGroup (or a strip that still carries data-axf-tab-group + data-fx-ctx-target="tab-group")
 *              → use <TabGroup id="…" label="…" value onChange tabs=[…] /> from the framework
 *   tab-seg    a <Segmented> used as a tab row (its label / className says tabs or sections) → <TabGroup>
 *   nav        a <nav> element with no settings id: add data-axf-nav="<id>" (it gets the chrome context menu) or
 *              data-axf-not-nav="<why>" when it is a breadcrumb / pager, not a navigation menu
 *   banner     an element whose class names a banner (`…banner`) with no context target: a banner is drawn by the
 *              framework's Banner / banner frame (data-fx-ctx-target="banner" | "axf-banner"), or says
 *              data-axf-not-banner="<why>"
 *   toolbar    check-toolbars.mjs's findings (role="toolbar" + a settings id), so one check covers all four kinds
 *
 * Ratchet (framework/spec/chrome-baseline.json): files listed there may keep up to their recorded count of findings
 * (what was left over when the rule landed); a count may only go down, and a file not listed must be clean.
 *
 *   node framework/cli/check-chrome-assets.mjs [--json] [--write-baseline] [root…]
 * Exit 1 on any finding over the baseline. Vendored code, baked framework copies (`src/axf`) and tests are skipped.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSource as checkToolbars, openingTags } from './check-toolbars.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BASELINE_FILE = join(ROOT, 'framework/spec/chrome-baseline.json');
const args = process.argv.slice(2);
const json = args.includes('--json');
const writeBaseline = args.includes('--write-baseline');
const roots = args.filter((a) => !a.startsWith('--')).map((a) => resolve(ROOT, a));
const APPS = (() => { try { return readdirSync(join(ROOT, 'apps')); } catch { return []; } })();
export const ROOTS = roots.length ? roots : [
  join(ROOT, 'framework/libs'), join(ROOT, 'framework/react'), join(ROOT, 'framework/templates'), join(ROOT, 'framework/library-templates'),
  join(ROOT, 'framework/boilerplates'), ...APPS.flatMap((a) => [join(ROOT, 'apps', a, 'plugins'), join(ROOT, 'apps', a, 'src')]),
];
/** The framework files that draw the chrome itself (they are the implementation, not users of it). */
const FRAMEWORK_OWN = ['framework/react/components/TabGroup.tsx', 'framework/react/components/Chrome.tsx', 'framework/react/components/NavTree.tsx', 'framework/react/components/Banner.tsx', 'framework/react/components/BannerStrip.tsx', 'framework/react/components/BannerSettings.tsx', 'framework/react/components/Controls.tsx', 'framework/react/windows/WindowHost.tsx', 'framework/react/windows/DockHost.tsx', 'framework/react/windows/MainTabs.tsx'];

export function walk(dir, out = []) {
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

const classOf = (tag) => { const m = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/.exec(tag); return m ? (m[1] ?? m[2] ?? m[3] ?? '') : ''; };
const attr = (tag, name) => { const m = new RegExp(`\\s${name}=(?:"([^"]*)"|\\{([^}]*)\\})`).exec(tag); return m ? (m[1] ?? m[2] ?? '') : null; };
const has = (tag, name) => new RegExp(`\\s${name}(?:=|\\s|>|$)`).test(tag);
/** A class token that is a tab row / tab: `fx-tabs`, `fx-tab` (not `fx-tab__x`, not `fx-tabgroup`, not `fx-tabframe`). */
const TAB_CLASS = /(?:^|[\s"'`{}$])fx-tabs?(?=$|[\s"'`{}]|--)/;
/** A class token that names a banner: ends in `banner` (`fx-banner`, `axp-push-banner`), not a part of one (`banner__row`). */
const BANNER_CLASS = /(?:^|[\s"'`{}$])[\w$-]*banner(?=$|[\s"'`{}])/;
/** Every JSX opening tag of a component (capitalized) with its line (attributes may hold {…}). */
function componentTags(src, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 0, quote = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { if (depth || c !== '`') quote = c; continue; }
      if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) break;
    }
    out.push({ text: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** Findings for one source file: { line, rule, message }. `own` = a framework file that draws the chrome itself. */
export function checkSource(src, { own = false } = {}) {
  const findings = [];
  if (!own) {
    for (const t of openingTags(src)) {
      const role = attr(t.text, 'role');
      const cls = classOf(t.text);
      // the row is what matters (a role="tab" always sits in one): a tablist, or an element styled as the framework's tab row
      const isTabRow = role === 'tablist' || (role !== 'tab' && TAB_CLASS.test(cls));
      if (isTabRow) {
        const strip = has(t.text, 'data-axf-tab-group') && attr(t.text, 'data-fx-ctx-target') === 'tab-group';
        if (!strip) findings.push({ line: t.line, rule: 'tab-row', message: `hand-made tab row (${role ? `role="${role}"` : cls.trim().slice(0, 40)}): use <TabGroup id="…" label="…" value onChange tabs=[…] /> (tab-group@1; its settings are the tab-group asset's), or a strip carrying data-axf-tab-group="<id>" + data-fx-ctx-target="tab-group"` });
        continue;
      }
      if (t.tag === 'nav' && attr(t.text, 'data-axf-nav') === null && attr(t.text, 'data-axf-not-nav') === null) {
        findings.push({ line: t.line, rule: 'nav', message: '<nav> without a settings id: a navigation menu is the framework NavMenu / NavTree (nav-menu asset), or add data-axf-nav="<id>" so it gets the chrome context menu, or data-axf-not-nav="<why>" (breadcrumb, pager)' });
        continue;
      }
      if (BANNER_CLASS.test(cls) && !['banner', 'axf-banner'].includes(attr(t.text, 'data-fx-ctx-target') ?? '') && attr(t.text, 'data-axf-not-banner') === null) {
        findings.push({ line: t.line, rule: 'banner', message: `"${cls.trim().slice(0, 50)}" looks like a banner: banners are drawn by the framework's banner frame (BannerDef in the library, data-fx-ctx-target="banner" | "axf-banner") or say data-axf-not-banner="<why>"` });
      }
    }
    for (const t of componentTags(src, 'Segmented')) {
      const label = `${attr(t.text, 'label') ?? ''} ${attr(t.text, 'className') ?? ''}`.toLowerCase();
      if (/\btabs?\b|sections?\b/.test(label)) findings.push({ line: t.line, rule: 'tab-seg', message: `<Segmented> used as a tab row (${(attr(t.text, 'label') ?? '').slice(0, 40)}): use <TabGroup> (a Segmented is an option picker, a tab row switches what is shown)` });
    }
  }
  for (const x of checkToolbars(src)) findings.push({ ...x, rule: 'toolbar' });
  return findings;
}

export function readBaseline() {
  try { return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')); } catch { return { $axf: 'chrome-baseline@1', files: {} }; }
}

/** Every finding in every root, grouped per file. */
export function scan(rootsToScan = ROOTS) {
  const perFile = new Map();
  let files = 0;
  for (const r of rootsToScan) for (const f of walk(r)) {
    files++;
    const rel = relative(ROOT, f);
    const found = checkSource(readFileSync(f, 'utf8'), { own: FRAMEWORK_OWN.includes(rel) });
    if (found.length) perFile.set(rel, found);
  }
  return { files, perFile };
}

/** What is over the baseline: new files with findings, and files whose count grew. */
export function overBaseline(perFile, baseline) {
  const over = [];
  for (const [file, found] of perFile) {
    const allowed = baseline.files?.[file] ?? 0;
    if (found.length > allowed) over.push({ file, found, allowed });
  }
  return over;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { files, perFile } = scan();
  if (writeBaseline) {
    const out = { $axf: 'chrome-baseline@1', note: 'Hard-coded chrome left over when check-chrome-assets.mjs landed (Nov 4 2026): per file, how many findings it may still have. Counts only go down; a file not listed must be clean. Regenerate only after a real migration: node framework/cli/check-chrome-assets.mjs --write-baseline', files: Object.fromEntries([...perFile.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([f, x]) => [f, x.length])) };
    writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 2) + '\n');
    console.log(`baseline written: ${perFile.size} file(s), ${[...perFile.values()].reduce((n, x) => n + x.length, 0)} finding(s) left over`);
    process.exit(0);
  }
  const baseline = readBaseline();
  const over = overBaseline(perFile, baseline);
  const total = [...perFile.values()].reduce((n, x) => n + x.length, 0);
  const stale = Object.entries(baseline.files ?? {}).filter(([f, n]) => (perFile.get(f)?.length ?? 0) < n);
  if (json) console.log(JSON.stringify({ files, findings: Object.fromEntries(perFile), over, stale: Object.fromEntries(stale) }, null, 2));
  else {
    for (const o of over) for (const x of o.found) console.log(`${o.file}:${x.line}  [${x.rule}] ${x.message}`);
    for (const o of over) console.log(`✗ ${o.file}: ${o.found.length} finding(s), baseline allows ${o.allowed}`);
    if (stale.length) console.log(`• ${stale.length} baseline count(s) can come down (run --write-baseline after a migration): ${stale.map(([f, n]) => `${f} ${perFile.get(f)?.length ?? 0}/${n}`).join(', ')}`);
    console.log(over.length ? `✗ ${over.length} file(s) over the chrome baseline (${total} finding(s) in ${files} file(s))` : `✓ every tab group, toolbar, banner and nav is framework chrome or within the baseline — ${files} file(s), ${total} left over in ${perFile.size} file(s)`);
  }
  process.exit(over.length ? 1 : 0);
}
