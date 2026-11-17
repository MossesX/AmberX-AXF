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

/* 1b. one door for every opener (settings-floating@1, build settings-opened-banners-nav-menu; spec SETTINGS-FLOATING.md) */
const { parseSettingsFloatingTarget: parseT, settingsFloatingDialog: dialogOf, sameSettingsDialog: same, viewOpensSettings, CHROME_SETTINGS_DIALOG_ID, BANNER_SETTINGS_DIALOG_ID, SETTINGS_VIEW, SETTINGS_LAST_TAB_KEY, SETTINGS_TAB_EVENT } = engine;
ok(SETTINGS_VIEW === 'settings' && SETTINGS_LAST_TAB_KEY === 'axf.settings.lastTab' && SETTINGS_TAB_EVENT === 'axf:settings-tab', 'the Settings view id, last-tab key and tab event are the engine\'s');
ok(CHROME_SETTINGS_DIALOG_ID === 'axf.chrome.settings' && BANNER_SETTINGS_DIALOG_ID === 'axf.banners.settings', 'chrome and banner settings dialog ids are the engine\'s');
ok(JSON.stringify(parseT([])) === '{"kind":"all"}' && JSON.stringify(parseT(['all'])) === '{"kind":"all"}', 'settings.floating with nothing / all → the whole interface');
ok(JSON.stringify(parseT(['tab', 'appearance'])) === '{"kind":"tab","tab":"appearance"}' && JSON.stringify(parseT(['appearance'])) === '{"kind":"tab","tab":"appearance"}', 'tab:<id> and a bare tab id → that tab');
ok(JSON.stringify(parseT(['chrome', 'toolbar'])) === '{"kind":"chrome","type":"toolbar"}' && JSON.stringify(parseT(['chrome', 'tab-group', 'settings.tabs'])) === '{"kind":"chrome","type":"tab-group","instance":"settings.tabs"}', 'chrome:<type>[:<instance>] → that chrome instance');
ok(JSON.stringify(parseT(['banner'])) === '{"kind":"banner"}' && JSON.stringify(parseT(['banner', 'systems-check'])) === '{"kind":"banner","id":"systems-check"}', 'banner[:<id>] → the banner settings');
ok(parseT(['tab']) === null && parseT(['chrome']) === null && parseT(['not a tab']) === null, 'a target without its id, or words, is no target');
ok(dialogOf({ kind: 'all' }).dialog === SETTINGS_ALL_DIALOG && dialogOf({ kind: 'tab', tab: 'x' }).dialog === SETTINGS_TAB_DIALOG && dialogOf({ kind: 'tab', tab: 'x' }).props.tab === 'x', 'all / tab targets open the PR 628 dialogs');
ok(dialogOf({ kind: 'chrome', type: 'banner', instance: 'app' }).dialog === CHROME_SETTINGS_DIALOG_ID && dialogOf({ kind: 'chrome', type: 'banner', instance: 'app' }).props.instance === 'app', 'a chrome target opens the chrome settings dialog with its instance');
ok(dialogOf({ kind: 'banner', id: 'keys' }).dialog === BANNER_SETTINGS_DIALOG_ID && dialogOf({ kind: 'banner' }).props.id === undefined, 'a banner target opens the banner settings dialog');
ok(same({ id: SETTINGS_TAB_DIALOG, props: { tab: 'x' } }, { kind: 'tab', tab: 'x' }) && !same({ id: SETTINGS_TAB_DIALOG, props: { tab: 'y' } }, { kind: 'tab', tab: 'x' }), 'the same tab dialog is recognised; another tab is not');
ok(same({ id: CHROME_SETTINGS_DIALOG_ID, props: { type: 'toolbar', instance: 'app' } }, { kind: 'chrome', type: 'toolbar', instance: 'app' }) && !same({ id: CHROME_SETTINGS_DIALOG_ID, props: { type: 'toolbar', instance: 'app' } }, { kind: 'chrome', type: 'nav-menu', instance: 'app' }), 'the same chrome dialog is recognised; another kind is not');
ok(!same(null, { kind: 'all' }) && same({ id: SETTINGS_ALL_DIALOG }, { kind: 'all' }), 'no dialog → open; the whole interface up → focus');
ok(viewOpensSettings('settings') && !viewOpensSettings('home'), 'a navigation to the settings view is an opening');
// the react door and every view-navigating caller go through it
const door = readFileSync(join(ROOT, 'framework/react/settingsFloating.ts'), 'utf8');
ok(/export function openSettingsFloating\(rt: AxfRuntime, target: SettingsFloatingTarget\)/.test(door), 'openSettingsFloating(rt, target) exists');
ok(/export function openView\(rt: AxfRuntime, view: string\)/.test(door) && /viewOpensSettings\(view\)\) return openSettingsFloating\(rt, \{ kind: 'all' \}\)/.test(door), 'openView sends the settings view to the floating window');
ok(/sameSettingsDialog\(state\.dialog, target\)\) \{ focusOpenDialog\(\)/.test(door), 'the same dialog already up is focused, never opened twice');
ok(/state\.dialog\?\.id === SETTINGS_ALL_DIALOG\) \{ switchTabInPlace\(rt, tab\)/.test(door), 'a tab asked while the whole interface is up switches inside it');
ok(/rt\.hostTakes\('settings'\)\) \{ rt\.dispatch\(tab \? `settings\.open:\$\{tab\}` : 'app\.settings'\)/.test(door), 'a host that takes settings gets the opening');
ok(/register\(SETTINGS_FLOATING_ACTION, \(args\) => \{\s*const t = parseSettingsFloatingTarget\(args\)/.test(door), 'the settings.floating action parses its target through the engine');
const reactIndex = readFileSync(join(ROOT, 'framework/react/index.ts'), 'utf8');
ok(/export \{ openSettingsFloating, openView, installSettingsFloating, SETTINGS_FLOATING_ACTION/.test(reactIndex), 'framework/react exports the door');
ok(/installSettingsFloating\(rt\);/.test(readFileSync(join(ROOT, 'framework/react/AppShell.tsx'), 'utf8')), 'AppShell installs the settings.floating action');
for (const [file, what] of [['framework/react/components/Chrome.tsx', 'the nav menu item'], ['framework/react/components/NavTree.tsx', 'the nav tree item'], ['framework/react/components/Search.tsx', 'a search hit on a view'], ['framework/react/components/Help.tsx', 'a Help related view link'], ['framework/react/components/PriorityTag.tsx', 'a waiting row route'], ['framework/react/components/BannerStrip.tsx', 'the banner strip follower']] as const) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  ok(/import \{ openView \} from '\.\.\/settingsFloating';/.test(src), `${what} imports openView`);
  ok(!/rt\.navigate\((?:it\.view|view\[0\]|f\.view!|view|r\.route|m\.view)\)/.test(src), `${what} no longer navigates to a view that may be Settings`);
}
ok(/viewOpensSettings\(view\) && this\.actions\.get\('app\.settings'\)\) this\.dispatch\('app\.settings'\)/.test(readFileSync(join(ROOT, 'framework/core/runtime.ts'), 'utf8')), 'the core nav action sends nav:settings to app.settings');
ok(/^export const CHROME_SETTINGS_DIALOG = CHROME_SETTINGS_DIALOG_ID;/m.test(readFileSync(join(ROOT, 'framework/react/components/ChromeContext.tsx'), 'utf8')) && /^export const BANNER_SETTINGS_DIALOG = BANNER_SETTINGS_DIALOG_ID;/m.test(readFileSync(join(ROOT, 'framework/react/components/BannerSettings.tsx'), 'utf8')), 'the chrome and banner dialogs use the engine\'s ids');
for (const app of ['console-web', 'axhub-web', 'amberx-droid', 'molly']) ok(readFileSync(join(ROOT, `apps/${app}/src/axf/react/settingsFloating.ts`), 'utf8') === door, `${app} ships the same door`);

/* 2. library */
const lib = readFileSync(join(ROOT, 'framework/libs/settings/index.tsx'), 'utf8');
ok(/register\('app\.settings', \(\) => openSettings\(/.test(lib), 'app.settings goes through openSettings');
ok(/register\('settings\.open', \(\[tab\]\) => openSettings\(/.test(lib), 'settings.open goes through openSettings');
ok(/const openSettings = \(tab: string \| undefined\) => \{ openSettingsFloating\(rt, tab \? \{ kind: 'tab', tab \} : \{ kind: 'all' \}\); \};/.test(lib), 'the settings library opens through the one door');
ok(!/rt\.navigate\(VIEW\)/.test(lib), 'the settings library no longer navigates to its page itself');
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
