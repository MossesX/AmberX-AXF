// @ts-nocheck: a Node test (node --experimental-strip-types), not part of the console's build
/**
 * Self-test for the context menu designer's pure model (chunks, styles, compile, tree editing).
 *   node --experimental-strip-types apps/console-web/plugins/context-menu-designer/test.mts
 */
import {
  asChunk, chunkStyle, colorCss, colorOk, compile, designErrors, findChunk, freeId, insertAt, moveAt, normalizeDesign,
  removeAt, styleSheet, toAsset, updateAt, usedBy, designFromMenu, entriesFromMenu, countItems, type Design,
} from './web/core.ts';
import { buildCatalog, defaultFilter, filterChanges, filterRows, groupRows, normalizeFilter, owners, sourceOf } from './web/actions.ts';

let ok = 0;
function check(cond: unknown, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  ok++;
  console.log(`  ✓ ${msg}`);
}

const d = (x: Record<string, unknown>): Design => normalizeDesign(x);
const edit = d({ id: 'edit', name: 'Edit', kind: 'chunk', items: [
  { kind: 'separator', id: 's0' },
  { kind: 'item', id: 'a', label: 'Copy', icon: 'copy', action: 'edit.copy' },
  { kind: 'item', id: 'b', label: 'Paste', action: 'edit.paste' },
  { kind: 'separator', id: 's1' },
] });
const loud = d({ id: 'loud', name: 'Loud', kind: 'chunk', inherit: false, style: { color: 'token:danger', weight: 'bold' }, items: [
  { kind: 'item', id: 'x', label: 'Delete' }, { kind: 'chunk', id: 'c', chunk: 'edit' },
] });
const main = d({ id: 'main', name: 'Main', kind: 'menu', style: { color: 'token:accent', hoverBackground: '#112233', size: 120 }, items: [
  { kind: 'item', id: 'top', label: 'Top' },
  { kind: 'chunk', id: 'c1', chunk: 'Edit' },
  { kind: 'separator', id: 's' },
  { kind: 'chunk', id: 'c2', chunk: 'loud' },
  { kind: 'chunk', id: 'c3', chunk: 'nope' },
] });
const all = [edit, loud, main];

check(edit.inherit === true && loud.inherit === false && main.inherit === false, 'chunks inherit by default; menus never');
check(colorOk('token:accent') && colorOk('#a1B2c3') && colorOk('') && !colorOk('red') && !colorOk('token:nope') && !colorOk('#fff'), 'colours: theme tokens or #rrggbb only');
check(colorCss('token:accent') === 'var(--fx-accent)' && colorCss('#A1B2C3') === '#a1b2c3' && colorCss('bad') === '', 'colour CSS');
check(findChunk('EDIT', all)?.id === 'edit' && findChunk('loud', all)?.id === 'loud' && !findChunk('main', all), 'chunks found by id or name; menus are not chunks');

const c = compile(main, all);
const labels = c.items.map((i) => (i.separator ? '|' : i.label)).join(',');
check(labels === 'Top,|,Copy,Paste,|,Delete,|,Copy,Paste', `chunks expand in place with tidy separators (${labels})`);
check(c.errors.some((e) => e.includes('"nope"')), 'missing chunk reported');
check(c.uses.sort().join() === 'edit,loud', 'uses lists nested chunks');
check(new Set(c.items.map((i) => i.id)).size === c.items.length && c.items.every((i) => i.id.startsWith('ctxd-main-')), 'compiled ids unique and prefixed');
const copy1 = c.items[2], del = c.items[5], copy2 = c.items[7];
check(c.styles[copy1.id].color === 'token:accent' && c.styles[copy1.id].size === 120, 'inheriting chunk takes the menu style');
check(c.styles[del.id].color === 'token:danger' && c.styles[del.id].weight === 'bold' && c.styles[del.id].size === 120 && c.styles[del.id].hoverBackground === '#112233', 'own-style chunk: own fields over the menu, blanks from the menu');
check(c.styles[copy2.id].color === 'token:danger', 'chunk inside an own-style chunk inherits that chunk');
check(chunkStyle(loud, main.style).color === 'token:danger' && chunkStyle(edit, main.style) === main.style, 'chunkStyle');

const loop = d({ id: 'loop', name: 'Loop', kind: 'chunk', items: [{ kind: 'item', id: 'i', label: 'I' }, { kind: 'chunk', id: 'self', chunk: 'loop' }] });
const cl = compile(loop, [loop]);
check(cl.items.length === 1 && cl.errors.some((e) => e.includes('inserts itself')), 'a chunk inserting itself is skipped and reported');

const css = styleSheet(c.styles, '.fx-ctx');
check(css.includes(`.fx-ctx .fx-menu__li[data-axf-item="${copy1.id}"] > .fx-menu__item { color: var(--fx-accent); font-size: calc(var(--fx-font-size) * 1.2); }`), 'stylesheet: base rule');
check(css.includes(':hover:not(:disabled) { background: #112233; }') && css.includes('font-weight: bold'), 'stylesheet: hover + weight');
check(styleSheet(compile(edit, [edit]).styles, '.x') === '', 'no style = no rules');

const asset = toAsset(main, all, { 'axf-plan-feature': [{ id: 'k' }], default: [{ id: 'old' }] });
check(asset.type === 'context-menu' && asset.id === 'ctxd-main' && Array.isArray((asset.data.targets as Record<string, unknown>)['axf-plan-feature']), 'asset keeps the base targets');
check(((asset.data.targets as Record<string, { id: string }[]>).default)[0].id === c.items[0].id, 'asset default = compiled items');

check(designErrors(d({ id: 'x2', name: 'edit', kind: 'chunk' }), all).some((e) => e.includes('already called')), 'duplicate chunk names refused');
check(designErrors(d({ id: 'x3', name: 'Edit', kind: 'menu' }), all).length === 0, 'a menu may share a chunk name');
check(freeId('Edit', ['edit']) === 'edit-2' && freeId('My Menu!', []) === 'my-menu', 'freeId');
const ch = asChunk(main, 'Main bits', all);
check(ch.kind === 'chunk' && ch.id === 'main-bits' && ch.inherit && ch.items.length === main.items.length, 'save as chunk');
check(usedBy('edit', all).map((x) => x.id).sort().join() === 'loud,main', 'usedBy finds direct and nested users');

let items = main.items;
items = insertAt(items, [0], { kind: 'item', id: 'n1', label: 'Inner' });
check(items[0].kind === 'item' && items[0].items?.[0].id === 'n1', 'insert inside an item');
items = updateAt(items, [0, 0], { label: 'Inner 2' } as never);
check(items[0].kind === 'item' && items[0].items?.[0].kind === 'item' && (items[0].items[0] as { label: string }).label === 'Inner 2', 'update a nested entry');
items = moveAt(items, [1], -1);
check(items[0].id === 'c1' && items[1].id === 'top', 'move');
items = removeAt(items, [1, 0]);
check(items[1].kind === 'item' && !(items[1].items?.length), 'remove nested');

const n = normalizeDesign({ id: 'BAD ID', name: 'Bad <x>', kind: 'menu', style: { color: 'javascript:1', size: 999 }, items: [{ id: 'a' }, { id: 'a' }] });
check(n.id === 'bad-x' && n.style.color === '' && n.style.size === 200 && n.items[1].id !== 'a', 'normalize cleans ids, colours, sizes and duplicate entry ids');

// ---- the action catalog (Actions window + Filter dialog)
const plugins = new Set(['ai.amberx.axf.console.todo-manager']);
check(sourceOf('axf.framework', plugins) === 'framework' && sourceOf('ai.amberx.axf.settings', plugins) === 'framework', 'framework actions + framework libraries are Framework');
check(sourceOf('ai.amberx.axf.console.todo-manager', plugins) === 'plugins', 'a console plugin is Plugins');
check(sourceOf(undefined, plugins) === 'application' && sourceOf('ai.amberx.axf.console.menu', plugins) === 'application', 'app code + the app’s own libraries are Application');
const cat = buildCatalog({
  actions: [
    { id: 'nav', meta: { label: 'Navigate', params: true, module: 'axf.framework' } },
    { id: 'dialog', meta: { label: 'Open dialog', params: true, module: 'axf.framework' } },
    { id: 'swap', meta: { label: 'Swap asset', params: true, module: 'axf.framework' } },
    { id: 'settings.open', meta: { label: 'Open settings', params: true, module: 'ai.amberx.axf.settings' } },
    { id: 'edit.copy', meta: { label: 'Copy', stub: true, module: 'axf.framework' } },
    { id: 'todo.open', meta: { label: 'Open todos', module: 'ai.amberx.axf.console.todo-manager', requires: 'todo.use' } },
    { id: 'console.search', meta: { label: 'Search everything' } },
  ],
  libraries: [{ id: 'ai.amberx.axf.console.todo-manager', label: 'Todo manager', views: ['todo'], dialogs: ['todo.new'] }, { id: 'ai.amberx.axf.settings', label: 'Settings', settingsTabs: ['appearance'] }],
  pluginIds: [...plugins],
  views: [{ id: 'todo', label: 'Todos' }, { id: 'home', label: 'Home' }],
  dialogs: [{ id: 'todo.new', label: 'New todo' }],
  settingsTabs: [{ id: 'appearance', label: 'Appearance' }],
  swapTypes: ['color-theme'],
});
const spec = (s: string) => cat.find((r) => r.spec === s);
check(spec('nav:')?.params && spec('nav:todo')?.source === 'plugins' && spec('nav:home')?.source === 'application', 'nav expands per page, owned by the page’s library');
check(spec('dialog:todo.new')?.ownerLabel === 'Todo manager' && spec('settings.open:appearance')?.source === 'framework', 'dialogs + settings tabs expand');
check(spec('swap:color-theme:next') && spec('swap:color-theme:previous'), 'swap next / previous per type');
const def = defaultFilter();
check(!filterRows(cat, def, '').some((r) => r.stub), 'stand-ins hidden by default');
check(filterRows(cat, { ...def, stubs: true }, '').some((r) => r.spec === 'edit.copy'), 'stand-ins shown when asked');
check(filterRows(cat, { ...def, sources: ['plugins'] }, '').every((r) => r.source === 'plugins'), 'source filter');
check(filterRows(cat, { ...def, owners: [''] }, '').every((r) => r.owner === ''), 'owner filter');
check(filterRows(cat, { ...def, expanded: false, params: false }, '').every((r) => !r.expanded && !r.params), 'expanded + params filters');
check(filterRows(cat, def, 'open todos').map((r) => r.spec).join() === 'todo.open', 'search matches every word');
check(!filterRows(cat, { ...def, allowedOnly: true }, '', () => false).some((r) => r.spec === 'todo.open'), 'only what my role can run');
check(groupRows(filterRows(cat, def, ''))[0]?.source === 'plugins', 'grouped by source, plugins first');
check(owners(cat).some((o) => o.owner === '' && o.label === 'This app'), 'owners list names the app');
check(normalizeFilter('{"sources":["plugins","nope"],"sort":"zzz","stubs":true}').sources.join() === 'plugins' && normalizeFilter('bad').sort === 'source', 'stored filter normalized');
check(filterChanges(def) === 0 && filterChanges({ ...def, stubs: true, owners: ['x'] }) === 2, 'filter changes counted');

// ---- loading the app's menus
const src = { asset: 'amber', name: 'Amber', target: 'default', variant: 'glass', contributions: true,
  items: [{ id: 'plugins', label: 'Plugins', icon: 'package', provider: 'amber.plugins' }, { id: 's', separator: true }, { id: 'copy', label: 'Copy', action: 'edit.copy', items: [{ id: 'x', label: 'Inner' }] }],
  contributed: [{ id: 'term', label: 'Open terminal', action: 'terminal.open' }] };
const loaded = designFromMenu(src, all, true);
check(loaded.kind === 'menu' && loaded.name === 'Amber' && loaded.base === 'amber' && loaded.variant === 'glass', 'load an app menu as a new design');
check(loaded.items.length === 5 && loaded.items[4].kind === 'item' && (loaded.items[4] as { action?: string }).action === 'terminal.open' && !loaded.contributions, 'with plugin items: copied in, contributions off');
check((loaded.items[0] as { provider?: string }).provider === 'amber.plugins' && compile(loaded, [loaded]).items[0].provider === 'amber.plugins', 'live lists survive load + compile');
check(designFromMenu(src, all, false).items.length === 3 && designFromMenu(src, all, false).contributions, 'without plugin items');
check(designFromMenu(src, [...all, loaded], true).name === 'Amber 2', 'loaded name kept free');
check(countItems(src.items) === 3 && entriesFromMenu([{ id: 'a' }, { id: 'a' }]).map((e) => e.id).join() !== 'a,a', 'count + unique ids');
check(toAsset(loaded, [loaded]).data.contributions === false, 'asset carries contributions: false');
console.log(`\n${ok} checks passed`);
