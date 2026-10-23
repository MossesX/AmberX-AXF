// @ts-nocheck: a Node test (node --experimental-strip-types), not part of the console's build
// Plugins menu, the pure part (web/core.ts). Run: node --experimental-strip-types apps/console-web/plugins/plugins-menu/test.mts
import { columnRows, initialPick, installAction, PARAM_TYPES, PARAM_GROUPS, pluginsSubmenu, sortCatalog, FOLDER } from './web/core.ts';

let ok = 0, fail = 0;
const check = (name: string, cond: boolean) => { if (cond) ok++; else { fail++; console.error(`✗ ${name}`); } };

const rows = [
  { folder: 'theme-manager', name: 'Theme manager', enabled: true, model: 'opus', builtAt: '2026-10-18', tab: 'themes' },
  { folder: 'agent-manager', name: 'Agent manager', enabled: false, model: 'fable', builtAt: '2026-10-20', tab: 'agents' },
  { folder: 'alerts-bell', name: 'Alerts bell', enabled: true, model: 'opus', builtAt: '2026-10-21' },
  { folder: FOLDER, name: 'Plugins menu', enabled: true, model: 'opus', builtAt: '2026-10-23', tab: 'plugins-menu' },
];

const m = pluginsSubmenu(rows, { manage: 'nav:plugin-manager' });
const ids = m.items.map((i) => i.id);
check('submenu is called Plugins', m.label === 'Plugins');
check('Install, Settings, Manage, Enable, Disable in order', JSON.stringify(ids.filter((i) => i !== 'plugins.s1')) === JSON.stringify(['plugins.install', 'plugins.settings', 'plugins.manage', 'plugins.enable', 'plugins.disable']));
check('Manage goes where it is told', m.items[2].action === 'nav:plugin-manager');
const en = m.items.find((i) => i.id === 'plugins.enable');
const dis = m.items.find((i) => i.id === 'plugins.disable');
check('Enable lists only the switched-off plugins', en.items.length === 1 && en.items[0].action === 'plugins-menu.enable:agent-manager');
check('Disable lists the switched-on ones, sorted, never itself', JSON.stringify(dis.items.map((i) => i.label)) === JSON.stringify(['Alerts bell', 'Theme manager']));
check('counts in the labels', en.label === 'Enable (1)' && dis.label === 'Disable (2)');
const allOn = pluginsSubmenu(rows.map((r) => ({ ...r, enabled: true })));
check('nothing off → a note, no action', allOn.items.find((i) => i.id === 'plugins.enable').items[0].action === undefined);

check('column: every plugin by name', columnRows(rows, { showOff: true, showBare: true, sort: 'name' }).map((r) => r.folder)[0] === 'agent-manager');
check('column: hide switched-off', !columnRows(rows, { showOff: false, showBare: true, sort: 'name' }).some((r) => !r.enabled));
check('column: hide plugins without settings', !columnRows(rows, { showOff: true, showBare: false, sort: 'name' }).some((r) => r.folder === 'alerts-bell'));
check('column: search', columnRows(rows, { showOff: true, showBare: true, sort: 'name', q: 'THEME' }).length === 1);
check('column: on first', columnRows(rows, { showOff: true, showBare: true, sort: 'enabled' }).at(-1).folder === 'agent-manager');
check('column: newest build first', columnRows(rows, { showOff: true, showBare: true, sort: 'built' })[0].folder === FOLDER);
check('column: by model', columnRows(rows, { showOff: true, showBare: true, sort: 'model' })[0].model === 'fable');

check('open: the asked plugin wins', initialPick(rows, { onOpen: 'first', remember: true, asked: 'alerts-bell' }) === 'alerts-bell');
check('open: the last one when remembered', initialPick(rows, { onOpen: 'last', remember: true, last: 'theme-manager' }) === 'theme-manager');
check('open: first when the last is gone', initialPick(rows, { onOpen: 'last', remember: true, last: 'gone' }) === 'theme-manager');
check('open: itself', initialPick(rows, { onOpen: 'self', remember: true }) === FOLDER);
check('open: nothing', initialPick(rows, { onOpen: 'none', remember: true }) === '');

check('every parameter type has a known group', PARAM_TYPES.every((p) => PARAM_GROUPS[p.group]));
check('parameter ids are unique', new Set(PARAM_TYPES.map((p) => p.id)).size === PARAM_TYPES.length);
check('the built ones are the settings library kinds', PARAM_TYPES.filter((p) => p.built).map((p) => p.id).sort().join() === ['action', 'asset_slot', 'choice', 'color', 'link', 'multi_choice', 'number', 'secret', 'slider', 'text', 'toggle'].sort().join());
check('placeholders for the rest (30+)', PARAM_TYPES.filter((p) => !p.built).length >= 30);

const cat = [
  { folder: 'b', name: 'B', archive: 'z', version: '1.0.0', model: 'opus', publishedAt: '2026-10-01' },
  { folder: 'a', name: 'A', archive: 'axhub', version: '1.0.0', model: 'fable', publishedAt: '2026-10-20' },
];
check('sort by name', sortCatalog(cat, 'name')[0].folder === 'a');
check('sort by newest', sortCatalog(cat, 'newest')[0].folder === 'a');
check('sort by archive', sortCatalog(cat, 'archive')[0].archive === 'axhub');
check('unknown sort = name', sortCatalog(cat, 'x')[0].folder === 'a');

check('install', installAction({ ...cat[0], installed: null }).kind === 'install');
check('update', installAction({ ...cat[0], version: '1.2.0', installed: '1.0.0' }).kind === 'update');
check('installed', installAction({ ...cat[0], installed: '1.0.0' }).kind === 'installed');
check('another model = replace', installAction({ ...cat[0], installed: '1.0.0', otherModel: true }).kind === 'replace');
check('clash blocks', installAction({ ...cat[0], clash: 'twice' }).kind === 'blocked');
check('other kinds are read-only', installAction({ ...cat[0], readOnly: true }).kind === 'readOnly');

console.log(`plugins-menu: ${ok} passed, ${fail} failed`);
if (fail) process.exit(1);
