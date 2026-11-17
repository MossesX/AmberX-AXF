#!/usr/bin/env node
/*
 * settings-sections CI check (Brett, Nov 16 2026: "Why don't these settings interfaces have collapsible sections?").
 * Every settings interface groups its fields into collapsible sections (react/components/SettingsSections.tsx,
 * engine core/engines/settingsui.ts). Fails when:
 *   1. a framework renderer stops wiring them (the settings page, chrome settings, banner settings);
 *   2. a settings asset turns them off (`sections: "flat"`) without an entry in FLAT_OK below;
 *   3. a hand-built settings UI (a *settings*.tsx file, or the file of a component a plugin draws as a settings panel)
 *      shows two or more headed blocks with no collapsible section (SettingsSection, FlatSection, <details>). Raw <h3>/<h4>
 *      count everywhere; a framework <Section> counts only outside settings panels (inside one it folds by itself).
 *      Ratchet: framework/spec/settings-sections-baseline.json only comes down (--write-baseline after a real fix).
 * Panels and groups a plugin registers (settingsPanels / settings) are sections already: the settings page draws each
 * one through FlatSection.
 *   node framework/cli/check-settings-sections.mjs [--json] [--write-baseline]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = join(ROOT, 'framework/spec/settings-sections-baseline.json');
const args = new Set(process.argv.slice(2));
/** settings asset id → why it may stay flat (none today). */
const FLAT_OK = {};

const WIRING = [
  ['framework/libs/settings/index.tsx', ['useSettingsSection(', '<SectionsBar', '<SectionsScope force>', '<SectionsScope prefix=', "'settings.sections'"]],
  ['framework/react/components/ChromeContext.tsx', ['<SettingsSection', '<SectionsBar', '<SectionsScope']],
  ['framework/react/components/BannerSettings.tsx', ['<SettingsSection', '<SectionsBar']],
  ['framework/react/components/SettingsSections.tsx', ['SETTINGS_SECTIONS_KEY', 'aria-expanded', 'role="toolbar"']],
  ['framework/react/components/Forms.tsx', ['<SettingsSection', 'useSectionsScope()']],
  ['framework/core/engines/settingsui.ts', ["sections: 'collapsible'"]],
];
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'axf']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).split('\\').join('/');

const findings = [];
// 1. wiring
for (const [file, marks] of WIRING) {
  const p = join(ROOT, file);
  if (!existsSync(p)) { findings.push({ kind: 'wiring', file, why: 'file missing' }); continue; }
  const src = readFileSync(p, 'utf8');
  for (const m of marks) if (!src.includes(m)) findings.push({ kind: 'wiring', file, why: `no ${m}` });
}
// 2. settings assets
const assetDirs = [join(ROOT, 'framework/assets/settings'), ...readdirSync(join(ROOT, 'apps')).flatMap((a) => ['src/assets/settings', 'src/assets-overrides/settings'].map((d) => join(ROOT, 'apps', a, d)))];
for (const d of [join(ROOT, 'apps/console-web/plugins'), join(ROOT, 'framework/libs')]) {
  if (!existsSync(d)) continue;
  for (const p of readdirSync(d)) assetDirs.push(join(d, p, 'assets/settings'));
}
let assets = 0;
for (const d of assetDirs) {
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) {
    assets++;
    let a; try { a = JSON.parse(readFileSync(join(d, f), 'utf8')); } catch { continue; }
    const data = a?.data ?? {};
    if (data.sections === 'flat' && !FLAT_OK[a.id]) findings.push({ kind: 'asset', file: rel(join(d, f)), why: 'sections: "flat" (settings interfaces keep collapsible sections; add a reason to FLAT_OK if it truly must stay flat)' });
  }
}
// 3. hand-built settings UIs
const roots = ['apps/console-web/plugins', 'apps/console-web/src', 'framework/react', 'framework/libs', ...readdirSync(join(ROOT, 'apps')).filter((a) => a !== 'console-web').map((a) => `apps/${a}/src`)];
const HEAD = /<Section[\s>]|<h3[\s>]/g;
const RAW_HEAD = /<h3[\s>]|<h4[\s>]/g;
const FOLD = /SettingsSection|FlatSection|<details[\s>]|SectionsScope/;
// a settings UI file = a *settings*.tsx file, or the file that defines a component a plugin draws as a settings panel
// (`settingsPanels: [{ …, render: () => <Name … /> }]`)
const panelFiles = new Set();
for (const r of roots) {
  const files = walk(join(ROOT, r)).filter((p) => /\.tsx$/.test(p));
  const names = new Set();
  for (const p of files) {
    const src = readFileSync(p, 'utf8');
    const at = src.indexOf('settingsPanels');
    if (at < 0) continue;
    for (const m of src.slice(at, at + 6000).matchAll(/render:\s*\([^)]*\)\s*=>\s*<([A-Z]\w*)/g)) if (!/^(PluginLifecyclePanel)$/.test(m[1])) names.add(m[1]);
  }
  for (const p of files) {
    const src = readFileSync(p, 'utf8');
    for (const n of names) if (new RegExp(`function ${n}\\b|const ${n}\\s*=`).test(src)) panelFiles.add(p);
  }
}
const hand = [];
for (const r of roots) {
  for (const p of walk(join(ROOT, r))) {
    if (!/\.tsx$/.test(p) || /SettingsSections\.tsx$/.test(p)) continue;
    if (!/settings[^/]*\.tsx$/i.test(p) && !panelFiles.has(p)) continue;
    const src = readFileSync(p, 'utf8');
    // a framework <Section> inside a settings panel folds by itself (Forms.tsx → SettingsSection); raw headings never do
    const heads = (src.match(panelFiles.has(p) ? RAW_HEAD : HEAD) ?? []).length;
    if (heads >= 2 && !FOLD.test(src)) hand.push({ file: rel(p), heads });
  }
}
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { files: [] };
if (args.has('--write-baseline')) {
  writeFileSync(BASELINE, JSON.stringify({ note: 'settings-sections ratchet (check-settings-sections.mjs): hand-built settings UIs without collapsible sections; only comes down', files: hand.map((h) => h.file).sort() }, null, 2) + '\n');
  console.log(`baseline written: ${hand.length} file(s)`);
}
const allowed = new Set(args.has('--write-baseline') ? hand.map((h) => h.file) : base.files);
for (const h of hand) if (!allowed.has(h.file)) findings.push({ kind: 'hand-built', file: h.file, why: `${h.heads} headed blocks and no collapsible section (use SettingsSection from @axf/react)` });

if (args.has('--json')) console.log(JSON.stringify({ ok: !findings.length, assets, handBuilt: hand.length, baseline: base.files.length, findings }, null, 2));
else {
  for (const f of findings) console.log(`✗ ${f.kind}: ${f.file}: ${f.why}`);
  console.log(findings.length ? `settings-sections: ${findings.length} finding(s)` : `settings-sections: ok (${assets} settings assets, ${hand.length} hand-built UI(s) in the baseline, renderers wired)`);
}
process.exit(findings.length ? 1 : 0);
