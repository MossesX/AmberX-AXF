/*
 * settings-open check (Nov 13 2026, Brett: "I want by default all settings interfaces, whether they're built already
 * or not built, to default to open in a dialogue").
 *
 *   1. Engine: core/engines/settingsopen.ts routes every opening to the floating dialog by default; the person's
 *      "page" pick, `settings.page`, the host taking settings and the Settings page already open keep the page; a
 *      plugin's own "Opens in" = dialog forces the dialog; spoken words parse.
 *   2. Library: `app.settings` and `settings.open` go through the engine (never straight to the page), `settings.page`
 *      and `settings.opensAs` exist, both settings dialogs are glass + wide and carry Open as page, the per-user
 *      option is a setting.
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
import { SETTINGS_ALL_DIALOG, SETTINGS_OPENS_AS_DEFAULT, SETTINGS_TAB_DIALOG, normalizeSettingsOpensAs, parseSettingsOpensAs, settingsOpenRoute } from '../core/engines/settingsopen';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let pass = 0;
const fails: string[] = [];
const ok = (cond: unknown, what: string) => { if (cond) pass++; else fails.push(what); };

/* 1. engine */
ok(SETTINGS_OPENS_AS_DEFAULT === 'dialog', 'the default is the dialog');
const r = (i: Parameters<typeof settingsOpenRoute>[0]) => settingsOpenRoute(i);
ok(r({}).via === 'dialog' && (r({}) as { dialog: string }).dialog === SETTINGS_ALL_DIALOG, 'whole interface → all dialog');
ok(r({ tab: 'appearance' }).via === 'dialog' && (r({ tab: 'appearance' }) as { dialog: string }).dialog === SETTINGS_TAB_DIALOG, 'a tab → tab dialog');
ok(r({ tab: 'x', view: 'home' }).via === 'dialog', 'from any screen → dialog');
ok(r({ tab: 'x', pref: 'page' }).via === 'page', 'pref page → page');
ok(r({ pref: 'main' }).via === 'page', 'older word main → page');
ok(r({ tab: 'x', pref: 'garbage' }).via === 'dialog', 'unknown pref → dialog');
ok(r({ tab: 'x', forcePage: true }).via === 'page', 'settings.page → page');
ok(r({ tab: 'x', hostTakes: true }).via === 'page', 'host takes settings → page (the host routes it)');
ok(r({ tab: 'x', view: 'settings' }).via === 'page', 'already on Settings → switch tab in place');
ok(r({ tab: 'x', pref: 'page', ownerPlacement: 'dialog' }).via === 'dialog', "plugin's Opens in = dialog wins over the page pick");
ok(r({ tab: 'x', ownerPlacement: 'main' }).via === 'dialog', "a plugin's main-area pick for its page does not pull its settings onto the page");
ok(r({ tab: 'x' }).tab === 'x', 'the tab is carried');
ok(normalizeSettingsOpensAs(undefined) === 'dialog' && normalizeSettingsOpensAs('page') === 'page', 'normalize');
for (const [w, v] of [['as a page', 'page'], ['full page', 'page'], ['in a dialog', 'dialog'], ['dialogue', 'dialog'], ['floating', 'dialog'], ['pop up', 'dialog'], ['banana', null]] as const) ok(parseSettingsOpensAs(w) === v, `parse "${w}" → ${v}`);

/* 2. library */
const lib = readFileSync(join(ROOT, 'framework/libs/settings/index.tsx'), 'utf8');
ok(/register\('app\.settings', \(\) => openSettings\(/.test(lib), 'app.settings goes through openSettings');
ok(/register\('settings\.open', \(\[tab\]\) => openSettings\(/.test(lib), 'settings.open goes through openSettings');
ok(/register\('settings\.page'/.test(lib), 'settings.page exists');
ok(/register\('settings\.opensAs'/.test(lib), 'settings.opensAs exists');
ok(/settingsOpenRoute\(/.test(lib), 'the library asks the engine');
ok((lib.match(/rt\.navigate\(VIEW\)/g) ?? []).length === 1, 'the library navigates to the Settings page in one place only (openSettings)');
ok(/\[TAB_DIALOG\]: \{[^\n]*surface: 'glass'[^\n]*size: 'wide'/.test(lib), 'tab dialog is glass + wide');
ok(/\[ALL_DIALOG\]: \{[^\n]*surface: 'glass'[^\n]*size: 'wide'/.test(lib), 'all dialog is glass + wide');
ok((lib.match(/<PopOutButton/g) ?? []).length >= 2, 'both dialogs carry Open as page');
ok(/key: SETTINGS_OPENS_AS_KEY[^\n]*kind: 'choice'[^\n]*scope: 'user'/.test(lib), 'per-user Settings open in option');

/* 3. source guard: nothing opens a settings interface by navigating to the page */
const BAD = /\b(?:navigate|rt\.navigate)\(\s*['"`]settings['"`]\s*\)|dispatch\(\s*['"`]nav:settings['"`]\s*\)/;
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'vendor', 'android', 'fixtures']);
const scanned: string[] = [];
const walk = (dir: string) => {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    const rel = relative(ROOT, p);
    if (/^apps\/[^/]+\/src\/axf(\/|$)/.test(rel)) continue; // baked copies of framework/
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p); continue; }
    if (!/\.(tsx?|mjs|js)$/.test(n) || rel === 'framework/spec/check-settings-open.mts') continue;
    scanned.push(rel);
    const src = readFileSync(p, 'utf8');
    src.split('\n').forEach((line, i) => { if (BAD.test(line) && !/settings-open-ok/.test(line)) fails.push(`${rel}:${i + 1} opens settings by navigating to the page; use rt.dispatch('settings.open:<tab>') (or 'app.settings') so it opens in the dialog`); });
  }
};
for (const d of ['framework/react', 'framework/libs', 'framework/core', 'framework/templates', 'apps']) walk(join(ROOT, d));
ok(scanned.length > 100, `source guard scanned files (${scanned.length})`);

/* 4. dialog host + stylesheet */
const ov = readFileSync(join(ROOT, 'framework/react/components/Overlays.tsx'), 'utf8');
ok(/surface\?: 'glass'/.test(ov) && /data-fx-dialog-surface=\{def\.surface\}/.test(ov), 'dialog host passes surface');
ok(/data-fx-dialog-size=\{def\.size\}/.test(ov), 'dialog host passes size');
const css = readFileSync(join(ROOT, 'framework/ui/axf.css'), 'utf8');
const glass = /\.fx-dialog\[data-fx-dialog-surface='glass'\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
ok(/var\(--fx-opacity-glass\)/.test(glass) && /var\(--fx-blur\)/.test(glass), 'glass reads --fx-opacity-glass + --fx-blur');
ok(!/var\(--[a-z0-9-]+,/.test(glass), 'glass has no var() fallbacks');

if (fails.length) { console.error(`settings-open: ${fails.length} failed\n  ` + fails.join('\n  ')); process.exit(1); }
console.log(`settings-open: ${pass} checks pass (every settings interface opens in a floating dialog by default)`);
