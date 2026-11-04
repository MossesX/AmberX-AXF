/**
 * Reachability check for the console's application menu (CI: `npx -y tsx apps/console-web/scripts/menu-reach.mts`,
 * after the console build so src/axf is the fresh bake).
 *
 * The console hides its toolbar and side navigation by default (manifest `hidden`), so the app menu must reach
 * everything they reach, and every page. This builds the menu the console shows with every plugin enabled — the
 * app-menu asset named in axf.manifest.json + the console's contributions (src/menu.ts) + every plugin's
 * `web/menu.ts` — through the framework's own merge/compile engine, then fails when:
 *   - a nav-menu entry (the console's nav asset, every plugin's nav section, the built-in libraries' nav) has no
 *     menu item opening its view;
 *   - an item of the console's default toolbar has no menu item running its action;
 *   - a page the console registers (src/App.tsx views) can't be opened from the menu;
 *   - a menu item navigates to a page nobody registers;
 *   - a live list is referenced but not registered (it would vanish from the menu), the built-in catch-all lists
 *     (views, nav, toolbar, settings, windows, dialogs, chrome) are missing, or the compile drops anything;
 *   - a plugin with a page, dialog or settings tab contributes no menu entry, or two modules use one item id;
 *   - Search, Alerts or Settings are missing.
 * A live list's static part counts too: its "More…" entry (e.g. Pending builds) is reachable.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileAppMenu, mergeAppMenu, validateMenuItems, type AppMenuContribution, type CompiledMenuItem } from '../src/axf/core/engines/appmenu';
import { STANDARD_ACTIONS } from '../src/axf/core/engines/actions';
import { CONSOLE_MENU_ID, CONSOLE_PROVIDERS, consoleMenuContributions } from '../src/menu';

const app = new URL('../', import.meta.url).pathname;
const readJson = (p: string) => JSON.parse(readFileSync(join(app, p), 'utf8'));
const readText = (p: string) => readFileSync(join(app, p), 'utf8');
const problems: string[] = [];
let checks = 0;
const need = (cond: unknown, msg: string) => { checks++; if (!cond) problems.push(msg); };

const manifest = readJson('axf.manifest.json');
// the console's assets as it registers them: the baked shared set, its own, its overrides (shared-assets.mjs)
const { appAssetsOfType } = await import(new URL('../../../framework/cli/shared-assets.mjs', import.meta.url).href);
const ofType = (type: string) => appAssetsOfType(app, type) as { id: string; data: any }[];
const assetFile = (type: string, id: string) => {
  const a = ofType(type).find((x) => x.id === id);
  if (!a) throw new Error(`the console registers no ${type} asset "${id}"`);
  return a;
};
const menuAsset = assetFile('app-menu', manifest.defaults['app-menu']);
const navAsset = assetFile('nav-menu', manifest.defaults['nav-menu']);
const toolbarAsset = assetFile('toolbar', manifest.defaults.toolbar);
/** Every toolbar the console ships (any can be picked in Settings → Appearance). */
const toolbars = ofType('toolbar');
/** Framework stand-ins the console gives no handler (they only say "no handler yet"): reached through the toolbar live list. */
const consoleActions = readText('src/actions.ts') + readText('src/menuLibrary.tsx');
const stubs = new Set(Object.keys(STANDARD_ACTIONS).filter((a) => !consoleActions.includes(`'${a}'`)));

/** `const NAME = 'value'` in a source file, for resolving `view: VIEW` / `[VIEW]`. */
const constsOf = (src: string) => Object.fromEntries([...src.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
/** View ids in a source file's `nav: { … items: [ … view: X … ] }` lines. */
function navViews(src: string): string[] {
  const c = constsOf(src);
  const out: string[] = [];
  for (const line of src.split('\n').filter((l) => /^\s*nav:\s*\{/.test(l))) {
    for (const m of line.matchAll(/view:\s*(?:'([^']+)'|([A-Z_][A-Z0-9_]*))/g)) { const v = m[1] ?? c[m[2]!]; if (v) out.push(v); }
  }
  return out;
}

/* ---------------- what the console registers ---------------- */

const appSrc = readText('src/App.tsx');
const viewsBlock = appSrc.slice(appSrc.indexOf('const views: ViewMap = {'), appSrc.indexOf('};', appSrc.indexOf('const views: ViewMap = {')));
const consoleViews = [...viewsBlock.matchAll(/^\s+'?([\w-]+)'?:\s*\{\s*title:/gm)].map((m) => m[1]!);
need(consoleViews.length >= 10, `found only ${consoleViews.length} views in src/App.tsx (parser out of date?)`);
consoleViews.push('plugins'); // the old Plugins link (opens Settings → Plugins)

// Built-in libraries' pages (settings, alerts, MCP library used by a plugin): from their nav lines.
const libViews: string[] = [];
for (const lib of ['settings', 'alerts']) {
  const f = join(app, 'src/axf/libs', lib, 'index.tsx');
  if (existsSync(f)) libViews.push(...navViews(readFileSync(f, 'utf8')));
}
libViews.push('settings'); // lib-settings' page (it has no nav line; app.settings opens it)

/* ---------------- plugins: their menu entries, providers, pages ---------------- */

const contributions: AppMenuContribution[] = consoleMenuContributions.map((c) => ({ ...c, module: CONSOLE_MENU_ID }));
const providers = new Set<string>(['views', 'nav', 'toolbar', 'settings', 'windows', 'dialogs', 'chrome', ...Object.values(CONSOLE_PROVIDERS).map((p) => p.id)]);
const moreActions: string[] = Object.values(CONSOLE_PROVIDERS).map((p) => p.moreAction);
const pluginNav: { folder: string; view: string }[] = [];
const pluginDir = join(app, 'plugins');
for (const folder of readdirSync(pluginDir).filter((f) => !f.startsWith('_') && !f.startsWith('.') && existsSync(join(pluginDir, f, 'plugin.json'))).sort()) {
  const indexFile = join(pluginDir, folder, 'web/index.tsx');
  if (!existsSync(indexFile)) continue;
  const src = readFileSync(indexFile, 'utf8');
  const id = JSON.parse(readFileSync(join(pluginDir, folder, 'plugin.json'), 'utf8')).id as string;
  let views = navViews(src);
  // A plugin built on a framework library (`...lib` from createXLibrary) gets the library's nav.
  for (const m of src.matchAll(/from '@console\/axf\/libs\/([\w-]+)'/g)) if (/\.\.\.lib\b/.test(src)) views = views.concat(navViews(readText(`src/axf/libs/${m[1]}/index.tsx`)));
  for (const v of views) pluginNav.push({ folder, view: v });
  const hasUi = views.length > 0 || /\bdialogs:\s*\{/.test(src) || /\bsettingsTabs\b/.test(src);
  const menuFile = join(pluginDir, folder, 'web/menu.ts');
  if (!existsSync(menuFile)) { need(!hasUi, `plugin ${folder} has a page, dialog or settings tab but no web/menu.ts`); continue; }
  const mod = (await import(pathToFileURL(menuFile).href)) as Record<string, unknown>;
  const list = (mod.appMenu ?? []) as Omit<AppMenuContribution, 'module'>[];
  need(src.includes("from './menu'") && /\n\s+appMenu,/.test(src), `plugin ${folder}: web/index.tsx doesn't install appMenu from ./menu`);
  need(list.some((c) => c.items.some((i) => !i.separator)), `plugin ${folder}: web/menu.ts contributes no menu entry`);
  for (const c of list) {
    for (const e of validateMenuItems(c.items, `${folder}:${c.id}`)) problems.push(e);
    contributions.push({ ...c, module: id });
  }
  // Live lists the plugin declares (exported string constants) must be registered in its index.tsx.
  for (const [name, value] of Object.entries(mod)) {
    if (name === 'appMenu' || typeof value !== 'string') continue;
    const used = JSON.stringify(list).includes(`"provider":"${value}"`);
    if (!used) continue;
    need(/appMenuProviders:\s*\{/.test(src) && src.includes(`[${name}]`), `plugin ${folder}: live list "${value}" is used but not registered in appMenuProviders`);
    providers.add(value);
  }
}

/* ---------------- merge + compile like the runtime does ---------------- */

for (const m of menuAsset.data.menus) for (const e of validateMenuItems(m.items, `asset:${m.id}`)) problems.push(e);
const merged = mergeAppMenu(menuAsset.data, contributions);
need(merged.conflicts.length === 0, `item ids used by two modules: ${merged.conflicts.map((c) => `${c.id} (${c.was} / ${c.now})`).join(', ')}`);
const compiled = compileAppMenu(merged, { gate: () => 'allow', counter: () => 0, setting: () => null, hidden: () => false, providers: [...providers] });
for (const n of compiled.notes.filter((x) => !/created submenu/.test(x))) problems.push(`compile: ${n}`);

const actions = new Set<string>(moreActions);
const used = new Set<string>();
let items = 0;
const walk = (list: readonly CompiledMenuItem[], trail: string) => {
  for (const it of list) {
    if (it.separator) continue;
    items++;
    if (it.action) actions.add(it.action);
    if (it.provider) used.add(it.provider);
    if (it.items) walk(it.items, `${trail} › ${it.label}`);
  }
};
for (const m of compiled.menus) walk(m.items, m.label);

/* ---------------- reachability ---------------- */

const ALIASES: Record<string, string[]> = { settings: ['app.settings'], alerts: ['alerts.open'], plugins: ['settings.open:plugins'] };
const reaches = (view: string) => actions.has(`nav:${view}`) || (ALIASES[view] ?? []).some((a) => actions.has(a));

for (const s of navAsset.data.sections) for (const it of s.items) need(reaches(it.view), `nav entry "${it.label}" (view ${it.view}) isn't in the app menu`);
for (const p of pluginNav) need(reaches(p.view), `plugin ${p.folder}'s nav entry (view ${p.view}) isn't in the app menu`);
for (const v of libViews) need(reaches(v), `library page "${v}" isn't in the app menu`);
const stubbed = new Set<string>();
for (const tb of toolbars) for (const g of tb.data.groups) for (const it of g.items) {
  if (stubs.has(it.action) && !actions.has(it.action)) { stubbed.add(it.action); continue; }
  need(actions.has(it.action), `toolbar ${tb.id}: item "${it.label}" (${it.action}) isn't in the app menu`);
}
for (const v of consoleViews) need(reaches(v), `page "${v}" (src/App.tsx) isn't in the app menu`);

const known = new Set([...consoleViews, ...libViews, ...pluginNav.map((p) => p.view)]);
for (const a of actions) if (a.startsWith('nav:')) need(known.has(a.slice(4)), `menu item opens unknown page "${a.slice(4)}"`);
for (const p of ['views', 'nav', 'toolbar', 'settings', 'windows', 'dialogs', 'chrome']) need(used.has(p), `built-in live list "${p}" is missing from the menu`);
for (const p of Object.values(CONSOLE_PROVIDERS)) need(used.has(p.id), `console live list "${p.id}" is registered but not in the menu`);
for (const [what, a] of [['Search', 'console.search'], ['Alerts', 'alerts.open'], ['Settings', 'app.settings']] as const) need(actions.has(a), `${what} (${a}) is missing from the menu`);
for (const t of ['toolbar', 'nav-menu', 'banner']) need(actions.has(`slot.hide:${t}:toggle`), `View menu has no show/hide toggle for ${t}`);
need((manifest.hidden ?? []).includes('toolbar') && (manifest.hidden ?? []).includes('nav-menu'), 'the console manifest should hide toolbar and nav-menu by default');
need(!(manifest.hidden ?? []).includes('app-menu'), 'the console must not hide its app menu by default');
for (const l of ofType('layout')) {
  need(l.data.showMenubar === true, `layout ${l.id} hides the menu bar (the console's menu must show in every layout)`);
  const slot = l.data.slots?.menubar;
  need(!slot || slot === 'app-menu' || (Array.isArray(slot) && slot.includes('app-menu')) || (Array.isArray(slot?.accepts) && slot.accepts.includes('app-menu')), `layout ${l.id}'s menubar slot refuses the app menu`);
}

if (problems.length) {
  console.error(`menu-reach: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
assert.ok(items > 0);
if (stubbed.size) console.log(`menu-reach: framework stand-ins with no console handler, reached through View › Toolbar items: ${[...stubbed].join(', ')}`);
console.log(`menu-reach: ok — ${checks} checks; ${compiled.menus.length} menus, ${items} static items, ${used.size} live lists, ${contributions.length} contributions; ${known.size} pages and items of ${toolbars.length} toolbars reachable`);
