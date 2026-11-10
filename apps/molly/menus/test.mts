/**
 * Molly's menus, context menus, deep links and flagship skin (build molly-flagship-skin s12). No browser: the assets,
 * the sources that register actions, and the pure parts of src/molly/links.ts.
 *
 *   npx -y tsx apps/molly/menus/test.mts
 *
 * 1. App menu: a short top level (5 to 7 entries per menu, separators not counted), every row explains itself (hint),
 *    menu-item@2 has nothing to say about any row.
 * 2. Every action a Molly menu or context menu runs is registered by Molly, its plugins or the framework (no dead rows).
 * 3. Context menus: a target per surface (page, app card, nav entry, menu bar), only Molly's own rows (no stub edit
 *    rows), the start page marks its cards, and the skins / design packages never replace Molly's menus.
 * 4. Deep links: #/menu, #/skin, #/item-settings, #/set (only offered values), #/do (only menu actions).
 * 5. The flagship skins: day and night exist, name assets that exist, and Molly defaults to the flagship look.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { menuItemV2Errors } from '../../../framework/core/engines/menu-item-rules.mjs';
import { parseMollyLink, menuActions } from '../src/molly/links.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOLLY = resolve(HERE, '..');
const ROOT = resolve(MOLLY, '../..');
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };

type Item = { id: string; label?: string; action?: string; hint?: string; items?: Item[]; separator?: boolean; setting?: string };
const appMenu = json(join(MOLLY, 'src/assets/app-menu/molly.json'));
const ctxMenu = json(join(MOLLY, 'src/assets/context-menu/molly.json'));
const manifest = json(join(MOLLY, 'axf.manifest.json'));

/* 1. app menu */
const walk = (items: Item[], p: string, f: (i: Item, p: string) => void) => items.forEach((i, n) => { f(i, `${p}[${n}]`); if (i.items) walk(i.items, `${p}[${n}].items`, f); });
for (const m of appMenu.data.menus as { id: string; items: Item[] }[]) {
  const top = m.items.filter((i) => !i.separator).length;
  check(top >= 5 && top <= 7, `menu ${m.id}: ${top} top-level entries (5 to 7 keeps it short)`);
  walk(m.items, m.id, (i, p) => {
    for (const e of menuItemV2Errors(i, p)) check(false, `menu-item@2: ${e}`);
    if (!i.separator) check(!!i.hint, `${p} (${i.label}) has a hint`);
  });
}
check(appMenu.data.surface === 'glass', 'the menu bar is on the glass surface');

/* 2. every action is registered somewhere */
const sources: string[] = [];
const scan = (dir: string) => { if (!existsSync(dir)) return; for (const e of readdirSync(dir, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === 'assets') continue; const p = join(dir, e.name); if (e.isDirectory()) scan(p); else if (/\.(ts|tsx|mjs)$/.test(e.name)) sources.push(readFileSync(p, 'utf8')); } };
scan(join(MOLLY, 'src'));
scan(join(MOLLY, 'plugins'));
const text = sources.join('\n');
const registered = (id: string) => new RegExp(`(register|\\bon)\\(\\s*['"\`]${id.replace(/[.]/g, '\\.')}['"\`]`).test(text) || new RegExp(`${id.replace(/[.]/g, '\\.')}['"]\\s*:\\s*\\{\\s*label`).test(text);
const BUILTIN = new Set(['nav', 'setting.set', 'setting.toggle', 'menu.item.settings']);
const HELP = new Set(['help.mode', 'help.intro', 'help.intros.reset']);
for (const a of menuActions()) {
  const id = a.split(':')[0]!;
  check(BUILTIN.has(id) || HELP.has(id) || registered(id), `action ${a} is registered (Molly, a plugin or the framework)`);
}

/* 3. context menus */
const targets = ctxMenu.data.targets as Record<string, Item[]>;
for (const t of ['default', 'molly-app', 'nav-item', 'app-menu']) check(Array.isArray(targets[t]) && targets[t]!.length > 0, `context menu has a ${t} menu`);
const stubs = /^(edit\.(cut|copy|paste|undo|redo|delete)|view\.shortcuts|assets\.random|swap:)/;
for (const [t, items] of Object.entries(targets)) walk(items, `context-menu/${t}`, (i, p) => {
  if (i.action) check(!stubs.test(i.action), `${p} is not a stub row (${i.action})`);
  for (const e of menuItemV2Errors(i, p)) check(false, `menu-item@2: ${e}`);
  if (!i.separator) check(!!i.hint, `${p} (${i.label}) has a hint`);
});
check(manifest.defaults['context-menu'] === 'molly', "Molly's context menu is its default");
check(/ctx="molly-app"\s+ctxPayload=\{a\.id\}/.test(readFileSync(join(MOLLY, 'src/views/Home.tsx'), 'utf8')), 'start-page cards are the molly-app target');
for (const f of ['skin/molly-flagship', 'skin/molly-flagship-night', 'design-package/molly-flagship', 'design-package/molly-flagship-night']) {
  const d = json(join(ROOT, 'framework/assets', `${f}.json`)).data;
  const slots = { ...(d.assets ?? {}), ...(d.extras?.slots ?? {}) };
  for (const s of ['app-menu', 'context-menu', 'nav-menu', 'toolbar']) check(!(s in slots), `${f} leaves Molly's ${s} alone`);
}

/* 4. deep links */
check(JSON.stringify(parseMollyLink('#/menu/molly/appearance')) === JSON.stringify({ kind: 'menu', path: ['molly', 'appearance'] }), '#/menu/<menu>/<sub-menu>');
check(parseMollyLink('#/skin')?.kind === 'skin', '#/skin');
check(JSON.stringify(parseMollyLink('#/item-settings/app-menu/molly/apps')) === JSON.stringify({ kind: 'item-settings', path: 'app-menu/molly/apps' }), '#/item-settings/<path>');
check(JSON.stringify(parseMollyLink('#/set/density/roomy')) === JSON.stringify({ kind: 'set', key: 'molly.look.density', value: 'roomy' }), '#/set/<choice>/<value>');
check(parseMollyLink('#/set/density/huge') === null, '#/set refuses a value the choice does not offer');
check(parseMollyLink('#/set/nope/x') === null, '#/set refuses an unknown choice');
check(parseMollyLink('#/do/molly.reload')?.kind === 'do', '#/do runs a menu action');
check(parseMollyLink('#/do/molly.own-tab:console')?.kind === 'do', '#/do fills a context row payload');
check(parseMollyLink('#/do/assets.reset') === null && parseMollyLink('#/do/skin.restore') === null, '#/do refuses an action no Molly menu offers');
check(parseMollyLink('#/console/builds') === null, 'an app link (#/<app>/<route>) is not a menu link');

/* 5. flagship skins */
for (const f of ['skin/molly-flagship', 'skin/molly-flagship-night']) {
  const d = json(join(ROOT, 'framework/assets', `${f}.json`)).data;
  for (const [type, id] of [['color-theme', d.colorTheme], ['style-theme', d.styleTheme], ['layout', d.layoutTheme], ...Object.entries(d.assets)] as [string, string][]) {
    check(existsSync(join(ROOT, 'framework/assets', type, `${id}.json`)), `${f}: ${type} ${id} exists`);
  }
}
check(json(join(ROOT, 'framework/assets/color-theme/molly-flagship-day.json')).data.scheme === 'light' && json(join(ROOT, 'framework/assets/color-theme/molly-flagship-night.json')).data.scheme === 'dark', 'flagship day is light, night is dark');
check(manifest.defaults['design-package'] === 'molly-flagship' && manifest.defaults['color-theme'] === 'molly-flagship-day', 'Molly defaults to the flagship look');

console.log(`molly menus: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
