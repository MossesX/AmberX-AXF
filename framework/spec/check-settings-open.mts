/*
 * settings-open check (Nov 13 2026, Brett: "I want by default all settings interfaces, whether they're built already
 * or not built, to default to open in a dialogue").
 *
 *   1. Engine: core/engines/settingsopen.ts routes every opening to the floating dialog; only the host taking settings
 *      (embed@1) or the Settings view already up keep it in place.
 *   2. Library: `app.settings` and `settings.open` go through the engine (never straight to the page), both settings
 *      dialogs are glass + wide, saved values of the retired option are dropped on load.
 *   2b. No comeback (Brett, Nov 16 2026: remove the setting that picks where settings screens open, everywhere): no
 *      app, plugin, settings asset, schema, help entry, server, MCP tool, CLI or voice command may offer a choice of
 *      where settings open (page / pane / floating): the retired keys and actions, "Settings open(s) in" / "Open as
 *      page" / "Pops up in" options, `opensIn` / `settingsPlacement` on any asset or manifest.
 *   3. Source guard: no code outside the settings library opens a settings interface by navigating to the Settings
 *      page (`navigate('settings')`, `dispatch('nav:settings')`): openers use `app.settings` / `settings.open[:tab]` so
 *      they land in the dialog, and a new settings interface gets the dialog without doing anything.
 *   4. Dialog host + stylesheet: `surface` / `size` reach the dialog, glass reads only tokens.
 *
 * Run: npx -y tsx framework/spec/check-settings-open.mts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETIRED_SETTINGS_OPEN_KEYS, SETTINGS_ALL_DIALOG, SETTINGS_TAB_DIALOG, dialogSurface, isSettingsDialog, settingsOpenRoute } from '../core/engines/settingsopen';
import * as engine from '../core/engines/settingsopen';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let pass = 0;
const fails: string[] = [];
const ok = (cond: unknown, what: string) => { if (cond) pass++; else fails.push(what); };

/* 1. engine */
const r = (i: Parameters<typeof settingsOpenRoute>[0]) => settingsOpenRoute(i);
ok(r({}).via === 'dialog' && (r({}) as { dialog: string }).dialog === SETTINGS_ALL_DIALOG, 'whole interface → all dialog');
ok(r({ tab: 'appearance' }).via === 'dialog' && (r({ tab: 'appearance' }) as { dialog: string }).dialog === SETTINGS_TAB_DIALOG, 'a tab → tab dialog');
ok(r({ tab: 'x', view: 'home' }).via === 'dialog', 'from any screen → dialog');
// old callers passing the retired inputs still get the dialog
ok(r({ tab: 'x', pref: 'page', forcePage: true, ownerPlacement: 'main' } as never).via === 'dialog', 'a page pick, forcePage or a plugin placement no longer lead to the page');
ok(r({ tab: 'x', hostTakes: true }).via === 'page', 'host takes settings → the host routes it');
ok(r({ tab: 'x', view: 'settings' }).via === 'page', 'already on Settings → switch tab in place');
ok(r({ tab: 'x' }).tab === 'x', 'the tab is carried');
for (const name of ['SETTINGS_OPENS_AS', 'SETTINGS_OPENS_AS_KEY', 'SETTINGS_OPENS_AS_DEFAULT', 'parseSettingsOpensAs', 'normalizeSettingsOpensAs', 'settingsOpensAsOptions']) ok(!(name in engine), `engine no longer exports ${name}`);
ok(RETIRED_SETTINGS_OPEN_KEYS.includes('axf.settings.opensAs'), 'the retired key is listed for migration');

// settings dialogs built already and ones not built yet get the glass surface without asking
for (const id of [SETTINGS_TAB_DIALOG, SETTINGS_ALL_DIALOG, 'axf.chrome.settings', 'window-settings', 'banner-settings', 'my-plugin.settings', 'plugins-menu:settings']) ok(isSettingsDialog(id) && dialogSurface(id, {}) === 'glass', `settings dialog ${id} → glass`);
ok(isSettingsDialog('x.dialog', 'Plugin settings'), 'a title ending in settings counts');
for (const id of ['asset-json', 'terminal', 'axf.settingsless', 'skin.picker']) ok(!isSettingsDialog(id) && dialogSurface(id, {}) === undefined, `${id} is not a settings dialog`);
ok(dialogSurface('asset-json', { surface: 'glass' }) === 'glass', "a dialog's own surface pick wins");

/* 2. library */
const lib = readFileSync(join(ROOT, 'framework/libs/settings/index.tsx'), 'utf8');
ok(/register\('app\.settings', \(\) => openSettings\(/.test(lib), 'app.settings goes through openSettings');
ok(/register\('settings\.open', \(\[tab\]\) => openSettings\(/.test(lib), 'settings.open goes through openSettings');
ok(/RETIRED_SETTINGS_OPEN_KEYS\) if \(k in rt\.settings\.savedValues\(\)\) rt\.settings\.clear\(k\)/.test(lib), 'saved values of the retired option are dropped on load');
ok(/\[TAB_DIALOG\]: \{[^\n]*surface: 'glass'[^\n]*size: 'wide'/.test(lib), 'tab dialog is glass + wide');
ok(/\[ALL_DIALOG\]: \{[^\n]*surface: 'glass'[^\n]*size: 'wide'/.test(lib), 'all dialog is glass + wide');

/* 2b. no comeback: nothing offers a choice of where settings open */
const RETIRED: [RegExp, string][] = [
  [/axf\.settings\.opensAs|SETTINGS_OPENS_AS/, 'the retired axf.settings.opensAs option'],
  [/['"`]settings\.(?:opensas|page)\b|action:settings\.(?:opensas|page)\b|function:settings\.(?:opensas|page)\b/, 'the retired settings.opensas / settings.page action'],
  [/\bsettingsPlacement\b|axf\.settingsPlacement|settings-placement@|['"]opensIn['"]\s*:|\bopensIn\s*[?]?:/, 'a settings placement field (settingsPlacement / opensIn)'],
  [/label:\s*['"`](?:Settings opens? in|Open as page|Pops up in|Settings placement)/i, 'a "where settings open" option'],
  [/"title":\s*"(?:Settings opens? in|Open as page|Pops up in|Settings placement)"/i, 'a help entry for a "where settings open" option'],
  [/data-axf-settings-popout|['"]settings-pop-out['"]/, 'the Open as page button'],
];
const OK_FILES = new Set(['framework/spec/check-settings-open.mts', 'framework/core/engines/settingsopen.ts', 'apps/console-web/scripts/settings-open.e2e.mjs', 'apps/console-web/scripts/window-handles-check.mts']);
const comeback: string[] = [];
const scanRetired = (rel: string, src: string) => {
  if (OK_FILES.has(rel) || /^apps\/[^/]+\/src\/axf\/core\/engines\/settingsopen\.ts$/.test(rel)) return;
  src.split('\n').forEach((line, i) => { for (const [re, what] of RETIRED) if (re.test(line) && !/settings-open-ok/.test(line)) comeback.push(`${rel}:${i + 1} brings back ${what}; every settings interface always opens as a floating popup (Brett, Nov 16 2026)`); });
};

/* 3. source guard: nothing opens a settings interface by navigating to the page */
const BAD = /\b(?:navigate|rt\.navigate)\(\s*['"`]settings['"`]\s*\)|dispatch\(\s*['"`]nav:settings['"`]\s*\)/;
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'vendor', 'android', 'fixtures']);
const SKIP_PATHS = /^apps\/[^/]+\/public\/data(\/|$)/; // synced snapshots of shared data (pending list, build history)
const scanned: string[] = [];
const walk = (dir: string) => {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    const rel = relative(ROOT, p);
    if (/^apps\/[^/]+\/src\/axf(\/|$)/.test(rel) || SKIP_PATHS.test(rel)) continue; // baked copies of framework/, data snapshots
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p); continue; }
    if (/\.(json|py|md|kt|java)$/.test(n) && !/^(apps\/[^/]+\/src\/control\/inventory\.json)$/.test(rel)) { scanRetired(rel, readFileSync(p, 'utf8')); continue; }
    if (!/\.(tsx?|mjs|js|mts)$/.test(n)) continue;
    const src = readFileSync(p, 'utf8');
    scanRetired(rel, src);
    if (n.endsWith('.mts')) continue; // spec checks and scripts may navigate on purpose
    scanned.push(rel);
    // a settings interface as a page of its own (a view `…settings`) instead of a Settings tab or a dialog
    if (rel !== 'framework/libs/settings/index.tsx') for (const m of src.matchAll(/^\s*\[?['"`]?([a-z0-9._-]*settings)['"`]?\]?: \{ title: /gm)) if (/views\s*[:=]/.test(src.slice(Math.max(0, (m.index ?? 0) - 400), m.index)) && !/settings-open-ok/.test(m[0])) fails.push(`${rel}: view "${m[1]}" is a settings page of its own; add the settings as a Settings tab (settingsTabs / settings) or a dialog so they open in the dialog`);
    src.split('\n').forEach((line, i) => { if (BAD.test(line) && !/settings-open-ok/.test(line)) fails.push(`${rel}:${i + 1} opens settings by navigating to the page; use rt.dispatch('settings.open:<tab>') (or 'app.settings') so it opens in the dialog`); });
  }
};
for (const d of ['framework/react', 'framework/libs', 'framework/core', 'framework/templates', 'framework/schemas', 'framework/assets', 'framework/cli', 'framework/spec', 'apps']) walk(join(ROOT, d));
fails.push(...comeback);
ok(!comeback.length, 'no option for where settings open came back');
// the console's control inventory is generated: it must not list the retired actions
const inv = readFileSync(join(ROOT, 'apps/console-web/src/control/inventory.json'), 'utf8');
ok(!/"(?:function|action):settings\.(?:opensas|page)"/.test(inv) && !/axf\.settings\.opensAs/.test(inv), 'control inventory has no retired settings-open target');
ok(scanned.length > 100, `source guard scanned files (${scanned.length})`);

// API, MCP, CLI and voice (console-control@1) open the Settings view the way a click does: through app.settings
const ct = readFileSync(join(ROOT, 'framework/react/controlTargets.ts'), 'utf8');
ok(/id === 'settings' \? rt\.dispatch\('app\.settings'\)/.test(ct), 'console-control view:settings opens through app.settings');
ok(/address: SETTINGS_VIEW_ADDRESS[^\n]*open: \(\) => rt\.dispatch\('app\.settings'\)/.test(ct), 'derived Settings target opens through app.settings');
ok(/const open = \(\) => rt\.dispatch\(`settings\.open:\$\{tab\.id\}`\)/.test(ct), 'settings tab targets open through settings.open');

/* 4. dialog host + stylesheet */
const ov = readFileSync(join(ROOT, 'framework/react/components/Overlays.tsx'), 'utf8');
ok(/surface\?: 'glass'/.test(ov) && /data-fx-dialog-surface=\{dialogSurface\(state\.dialog\.id, def\)\}/.test(ov), 'dialog host gives settings dialogs glass by default');
ok(/data-fx-dialog-size=\{def\.size\}/.test(ov), 'dialog host passes size');
const css = readFileSync(join(ROOT, 'framework/ui/axf.css'), 'utf8');
const glass = /\.fx-dialog\[data-fx-dialog-surface='glass'\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
ok(/var\(--fx-opacity-glass\)/.test(glass) && /var\(--fx-blur\)/.test(glass), 'glass reads --fx-opacity-glass + --fx-blur');
ok(!/var\(--[a-z0-9-]+,/.test(glass), 'glass has no var() fallbacks');

if (fails.length) { console.error(`settings-open: ${fails.length} failed\n  ` + fails.join('\n  ')); process.exit(1); }
console.log(`settings-open: ${pass} checks pass (every settings interface opens in a floating dialog by default)`);
