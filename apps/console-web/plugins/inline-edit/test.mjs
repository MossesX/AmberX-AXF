#!/usr/bin/env node
/**
 * Inline edit — self-test (no browser, no server): the engine over the s2 store and the s1 resolver, single-item reset,
 * the overrides list (search, filters, tree, roots, tabs), the deep links (console-commands resolve), and API parity:
 * every command reached through REST (the server's route table), MCP (plugin-commands tools), the CLI (`axf inline-edit
 * <command> <words>`) and voice (voice.json intents + their AmberX twins) lands on the same engine operation with the same
 * input. The REST routes themselves are tested in test.py, the right-click → edit → reset UI in test-ui.mjs.
 *
 *   node apps/console-web/plugins/inline-edit/test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const TMP = mkdtempSync(join(tmpdir(), 'inline-edit-test-'));
process.env.AXF_APPEARANCE_FILE = join(TMP, 'appearance.json');
process.env.AXF_INLINE_EDIT_DATA_DIR = join(TMP, 'data');

const { runOp, OP_NAMES, coerceValue, filterItems, treeOf, parseOnOff } = await import('./engine.mjs');
const { createOverridesStore, mapSettings, resolveElementTokens } = await import('../../framework/index.mjs');
const { consoleCatalogFrom, runConsoleCommand } = await import('../../../../framework/core/engines/console-commands.mjs');
const { registry } = await import('../../../../framework/cli/plugin-commands.mjs');
const { pluginCommandTools, pluginRouteRequest, commandToolName } = await import('../../../../framework/core/engines/plugin-commands.mjs');
const { positionalInput } = await import('../plugin-commands/commands.mjs');

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log(`  ✓ ${name}`); };
const op = (o, input = {}, by = 'test') => { const r = runOp({ op: o, input, by, user: 'brett' }); return r; };
const data = (o, input, by) => { const r = op(o, input, by); assert.equal(r.ok, true, `${o}: ${r.message}`); return r.data; };
const P = 'nav-menu:app/section:system/item:settings';

/* ------------------------------------------------------------------ store + resolver (s1, s2) through the engine */

t('store: set / get / one reset removes exactly one record', () => {
  const s = createOverridesStore({ settings: mapSettings(), by: 'brett' });
  s.set({ path: P, token: 'textColor', value: 'accent', axHubValue: 'theme' });
  s.set({ path: P, token: 'fontSize', value: 120, axHubValue: 100 });
  s.set({ path: 'nav-menu:app', scope: 'parent', token: 'textColor', value: 'muted', axHubValue: 'theme' });
  assert.equal(s.list().length, 3);
  assert.equal(s.unset(P, 'textColor'), true);
  assert.deepEqual(s.list().map((r) => r.id).sort(), [`${P}|item|fontSize`, 'nav-menu:app|parent|textColor'].sort());
  assert.equal(s.unset(P, 'textColor'), false, 'a second reset finds nothing');
});

t('resolver: inherited axHub value, the parent override reaching the child, the item beating it', () => {
  const spec = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/customize.json'), 'utf8'));
  const recs = [
    { id: 'a', path: 'nav-menu:app', scope: 'parent', token: 'textColor', value: 'muted' },
    { id: 'b', path: P, scope: 'item', token: 'fontSize', value: 130 },
  ];
  const r = resolveElementTokens(P, { spec, overrides: recs });
  const leaf = r.chain.at(-1).tokens;
  const tc = leaf.find((x) => x.token === 'textColor');
  assert.equal(tc.value, 'muted'); assert.equal(tc.axHubValue, 'theme'); assert.equal(tc.overriddenAt, 'nav-menu:app');
  assert.equal(leaf.find((x) => x.token === 'fontSize').value, 130);
  const r2 = resolveElementTokens(P, { spec, overrides: [...recs, { id: 'c', path: P, scope: 'item', token: 'textColor', value: 'danger' }] });
  assert.equal(r2.chain.at(-1).tokens.find((x) => x.token === 'textColor').value, 'danger', 'item beats parent');
});

t('engine: values are checked against the token (scale range, theme colours, on/off)', () => {
  assert.equal(coerceValue('fontSize', '120'), 120);
  assert.throws(() => coerceValue('fontSize', 500));
  assert.equal(coerceValue('textColor', 'accent'), 'accent');
  assert.throws(() => coerceValue('textColor', 'hotpink'));
  assert.equal(coerceValue('italic', 'on'), true);
  assert.deepEqual(['on', 'OFF', 'flip', 'status', 'x'].map(parseOnOff), ['on', 'off', 'toggle', 'status', null]);
});

/* ------------------------------------------------------------------ master switch */

t('mode: off by default; on / toggle / status; who and when', () => {
  assert.equal(data('mode.get').on, false);
  const on = data('mode.set', { state: 'on' }, 'claude');
  assert.equal(on.on, true); assert.equal(on.by, 'claude'); assert.ok(on.at);
  assert.equal(data('mode.set', { state: 'toggle' }).on, false);
  assert.equal(data('mode.set', { state: 'status' }).on, false);
  assert.equal(op('mode.set', { state: 'sideways' }).code, 'validation');
});

/* ------------------------------------------------------------------ dialog: tokens, set, unset, state */

t('tokens: the chain root → element, each token with its axHub value and source, the override note', () => {
  const d = data('tokens.get', { path: P });
  assert.deepEqual(d.chain.map((x) => x.path), ['nav-menu:app', 'nav-menu:app/section:system', P]);
  const row = d.chain.at(-1).tokens.find((x) => x.token === 'background');
  assert.equal(row.axHubValue, 'theme'); assert.equal(row.source.layer, 'theme'); assert.equal(row.overridden, false);
  assert.match(d.note, /overrides what this element inherits from axHub/);
  assert.equal(op('tokens.get', { path: 'nope' }).code, 'validation');
});

t('set at item and parent scope, unset only that one; the token must belong to the element', () => {
  const rec = data('token.set', { path: P, token: 'textColor', value: 'accent', reason: 'stand out' }, 'brett').record;
  assert.equal(rec.axHubValue, 'theme'); assert.equal(rec.by, 'brett');
  data('token.set', { path: 'nav-menu:app/section:system', token: 'textColor', value: 'muted', scope: 'parent' });
  assert.equal(op('token.set', { path: P, token: 'location', value: 'pinned-top' }).code, 'validation', 'an item has no location token');
  const row = data('tokens.get', { path: P }).chain.at(-1).tokens.find((x) => x.token === 'textColor');
  assert.equal(row.value, 'accent'); assert.equal(row.source.scope, 'item');
  data('token.unset', { path: P, token: 'textColor' });
  const after = data('tokens.get', { path: P }).chain.at(-1).tokens.find((x) => x.token === 'textColor');
  assert.equal(after.value, 'muted', 'the parent override shows through again'); assert.equal(after.overriddenAt, 'nav-menu:app/section:system');
  assert.equal(op('token.unset', { path: P, token: 'textColor' }).code, 'not_found');
});

t('dialog state: path, scope, view per user', () => {
  assert.deepEqual(data('element.set', { path: P, view: 'classic', scope: 'parent' }), { path: P, scope: 'parent', view: 'classic' });
  assert.equal(data('element.get').view, 'classic');
  assert.equal(op('element.set', { view: 'cards' }).code, 'validation');
  assert.equal(runOp({ op: 'element.get', user: 'someone-else' }).data.view, 'tree', 'another user keeps their own');
});

/* ------------------------------------------------------------------ overrides list */

t('list: search, filters, roots, tree; tabs with their own roots; single-item reset', () => {
  data('token.set', { path: 'toolbar:app/group:edit/item:undo', token: 'background', value: 'danger', app: 'axhub-web' }, 'claude');
  data('token.set', { path: 'toolbar:app', token: 'radius', value: 'lg', scope: 'parent' }, 'brett');
  let l = data('overrides.list', { root: '', q: '', filter: {} });
  assert.equal(l.total, 3);
  assert.equal(data('overrides.list', { q: 'undo' }).shown, 1);
  assert.equal(data('overrides.list', { filter: { by: 'claude' } }).shown, 1);
  assert.equal(data('overrides.list', { filter: { app: 'axhub-web' } }).shown, 1);
  assert.equal(data('overrides.list', { filter: JSON.stringify({ kind: 'toolbar', scope: 'parent' }) }).shown, 1);
  assert.equal(data('overrides.list', { filter: { tokenKind: 'color' } }).shown, 2);
  assert.equal(data('overrides.list', { root: 'toolbar:app' }).shown, 2);
  assert.ok(l.roots.some((r) => r.path === 'toolbar:app/group:edit' && r.count === 1));
  assert.deepEqual(treeOf(l.items).map((x) => x.path).sort(), ['nav-menu:app', 'toolbar:app']);
  // tabs: a root per tab, kept per user; selecting a root moves the tab's root
  const tab = data('overrides.tab.add', { root: 'toolbar:app' }).tab;
  l = data('overrides.list', {});
  assert.equal(l.tab, tab.id); assert.equal(l.root, 'toolbar:app'); assert.equal(l.shown, 2);
  data('overrides.state', { root: 'toolbar:app/group:edit' });
  assert.equal(data('overrides.list', {}).tabs.find((x) => x.id === tab.id).root, 'toolbar:app/group:edit');
  data('overrides.state', { tab: 'all' });
  assert.equal(data('overrides.list', {}).shown, 3);
  assert.equal(data('overrides.tab.remove', { id: tab.id }).tabs.length, 1);
  // reset one item: only it goes
  const id = 'toolbar:app/group:edit/item:undo|item|background';
  assert.match(data('overrides.reset', { id }).now, /inherits theme from axHub again/);
  l = data('overrides.list', {});
  assert.equal(l.total, 2); assert.ok(!l.items.some((r) => r.id === id));
  assert.equal(op('overrides.reset', { id }).code, 'not_found');
  assert.equal(op('overrides.reset', { id: 'garbage' }).code, 'validation');
});

t('filterItems: dates are inclusive by day', () => {
  const items = [{ path: 'toolbar:app', at: '2026-11-10T22:00:00Z', app: 'any' }];
  assert.equal(filterItems(items, { filter: { since: '2026-11-10', until: '2026-11-10' } }).length, 1);
  assert.equal(filterItems(items, { filter: { since: '2026-11-11' } }).length, 0);
});

/* ------------------------------------------------------------------ deep links */

const catalog = consoleCatalogFrom([
  { kind: 'view', label: 'Inline edit overrides', focus: { kind: 'view', view: 'inline-edit-overrides' } },
  { kind: 'dialog', label: 'Edit element', focus: { kind: 'dialog', id: 'inline-edit-element' } },
  { kind: 'settings-tab', label: 'Inline edit settings', parent: 'plugins', focus: { kind: 'setting', tab: 'inline-edit' } },
  { kind: 'view', label: 'Home', focus: { kind: 'view', view: 'home' } },
], [{ id: 'inline-edit.element', meta: { label: 'Edit an element\'s tokens', params: true, effect: 'navigate' } }]);
const clients = [{ id: 'c1', app: 'console-web', lastUsed: Date.now(), front: true, catalog }];
const open = (target, path) => runConsoleCommand({ op: 'act', target, path, action: 'open' }, { clients, grants: ['*'] });

t('deep link: settings/inline-edit opens Settings → Plugins → Inline edit', () => {
  const r = open('console.settings', 'settings/inline-edit');
  assert.equal(r.ok, true); assert.equal(r.deliver.message.target, 'inline-edit');
});
t('deep link: console_open inline-edit/element?path=…&scope=&view= opens the dialog with that argument', () => {
  const r = open('console.screens', `inline-edit/element?path=${encodeURIComponent(P)}&scope=parent&view=grid`);
  assert.equal(r.ok, true); assert.equal(r.deliver.message.kind, 'dialog'); assert.equal(r.deliver.message.target, 'inline-edit-element');
  const a = new URLSearchParams(r.deliver.message.arg);
  assert.equal(a.get('path'), P); assert.equal(a.get('view'), 'grid'); assert.equal(a.get('scope'), 'parent');
  const d = open('console.dialogs', `inline-edit/element?path=${encodeURIComponent(P)}`);
  assert.equal(d.deliver.message.target, 'inline-edit-element');
});
t('deep link: console_open inline-edit/overrides?root=&q=&filter=&tab= opens the page with its argument', () => {
  const r = open('console.screens', 'inline-edit/overrides?root=toolbar%3Aapp&q=undo&tab=all');
  assert.equal(r.ok, true); assert.equal(r.deliver.message.kind, 'screen'); assert.equal(r.deliver.message.target, 'inline-edit-overrides');
  assert.equal(new URLSearchParams(r.deliver.message.arg).get('root'), 'toolbar:app');
});
t('deep link: a screen name never guesses a dialog', () => {
  assert.equal(open('console.screens', 'element').ok, false);
});

/* ------------------------------------------------------------------ parity: REST = MCP = CLI = voice */

const plugin = registry({ folders: ['inline-edit'], apps: ['console-web'] }).plugins[0];
const cmd = (id) => plugin.commands.find((c) => c.id === id);
const serverSrc = readFileSync(join(HERE, 'server/__init__.py'), 'utf8');
/** The server's route table: "<METHOD> <path>" → engine op (what every REST call runs). */
const ROUTES = Object.fromEntries(serverSrc.split('\n@router.').slice(1).map((chunk) => { const m = /^(get|put|post|delete)\("([^"]+)"\)[\s\S]*?_answer\(request, "([a-z.]+)"/.exec(chunk); return m ? [`${m[1].toUpperCase()} ${m[2]}`, m[3]] : null; }).filter(Boolean));

t('REST: every route runs an engine operation, every operation has a route', () => {
  assert.equal(Object.keys(ROUTES).length, 12, JSON.stringify(ROUTES));
  assert.deepEqual([...new Set(Object.values(ROUTES))].sort(), [...OP_NAMES].sort());
});

const tools = new Set(pluginCommandTools({ plugins: [plugin] }).map((x) => x.name));
const opOf = (c, input) => { const rq = pluginRouteRequest('inline-edit', c, input); return { op: ROUTES[`${rq.method} ${rq.path.replace('/api/plugins/inline-edit', '')}`], input: rq.body ?? rq.query }; };
const voice = JSON.parse(readFileSync(join(HERE, 'voice.json'), 'utf8'));
const amberx = readFileSync(join(ROOT, 'apps/amberx-droid/src/plugins/commands/web/lib-developer.ts'), 'utf8');

/** One case: the same request through the four surfaces. */
const cases = [
  { id: 'mode', cli: ['mode', 'on'], input: { state: 'on' }, voice: 'inline-mode', slots: { state: 'on' } },
  { id: 'mode-status', cli: ['mode', 'status'], input: {}, voice: 'inline-status' },
  { id: 'tokens', cli: ['tokens', P], input: { path: P }, voice: 'inline-tokens', slots: { text: P } },
  { id: 'set', cli: ['set', P, 'textColor', 'accent'], input: { path: P, token: 'textColor', value: 'accent' }, voice: 'inline-set', slots: { text: P, token: 'textColor', value: 'accent' } },
  { id: 'unset', cli: ['unset', P, 'textColor'], input: { path: P, token: 'textColor' }, voice: 'inline-unset', slots: { text: P, token: 'textColor' } },
  { id: 'element-set', cli: ['element-set', '--view', 'grid'], input: { view: 'grid' }, voice: 'inline-view', slots: { view: 'grid' } },
  { id: 'overrides-list', cli: ['overrides', 'list'], input: {}, voice: 'inline-list' },
  { id: 'overrides-state', cli: ['overrides-state', '--q', 'radius'], input: { q: 'radius' }, voice: 'inline-search', slots: { text: 'radius' } },
  { id: 'tab-add', cli: ['tab-add', 'toolbar:app'], input: { root: 'toolbar:app' }, voice: 'inline-tab', slots: { text: 'toolbar:app' } },
  { id: 'overrides-reset', cli: ['overrides', 'reset', 'toolbar:app|parent|radius'], input: { id: 'toolbar:app|parent|radius' }, voice: 'inline-reset', slots: { text: 'toolbar:app|parent|radius' } },
];
/** What `axf inline-edit <words>` sends (commands.mjs main: two words may name a command, the rest fill its fields). */
function cliInput(words) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < words.length; i++) { if (words[i].startsWith('--')) { flags[words[i].slice(2)] = words[++i]; } else pos.push(words[i]); }
  const two = pos[1] !== undefined && plugin.commands.some((c) => c.id === `${pos[0]}-${pos[1]}`);
  const c = cmd(two ? `${pos[0]}-${pos[1]}` : pos[0]);
  return { c, input: positionalInput(c, pos.slice(two ? 2 : 1), flags) };
}
const fill = (tpl, slots = {}) => JSON.parse(JSON.stringify(tpl).replace(/\{(\w+)\}/g, (_, k) => slots[k] ?? ''));

for (const k of cases) {
  t(`parity ${k.id}: REST, MCP, CLI and voice run ${opOf(cmd(k.id), k.input).op} with the same input`, () => {
    const c = cmd(k.id);
    assert.ok(c, `command ${k.id}`);
    const rest = opOf(c, k.input);
    assert.ok(rest.op, `${k.id} reaches an engine op`);
    // MCP: the plugin-commands tool exists and posts the same command (control@1 plugins.commands → the same route)
    assert.ok(tools.has(commandToolName('inline-edit', k.id)), `MCP tool ${commandToolName('inline-edit', k.id)}`);
    // CLI
    const cli = cliInput(k.cli);
    assert.equal(cli.c.id, k.id, `axf inline-edit ${k.cli.join(' ')} → ${k.id}`);
    assert.deepEqual(opOf(cli.c, cli.input), rest);
    // voice: the intent names the command, fills the same input, and AmberX has its twin
    const v = voice.intents.find((x) => x.id === k.voice);
    assert.equal(v.command, k.id);
    assert.deepEqual(opOf(cmd(v.command), fill(v.input, k.slots)), rest);
    assert.ok(amberx.includes(`'${k.voice}'`), `AmberX voice command ${k.voice}`);
    // and the answer is the same whichever surface asked
    const a = runOp({ op: rest.op, input: rest.input, by: 'parity', user: 'parity' });
    const b = runOp({ op: rest.op, input: opOf(cli.c, cli.input).input, by: 'parity', user: 'parity' });
    if (!['token.set', 'token.unset', 'overrides.reset', 'overrides.tab.add', 'mode.set'].includes(rest.op)) assert.deepEqual(a, b);
    else assert.equal(a.ok === true || ['not_found'].includes(a.code), true, `${rest.op}: ${a.message}`);
  });
}

t('voice: every intent names a real command and has its AmberX twin', () => {
  for (const v of voice.intents) {
    assert.ok(cmd(v.command), `${v.id} → ${v.command}`);
    assert.ok(amberx.includes(`'${v.id}'`), `AmberX ${v.id}`);
  }
});

console.log(`✓ inline edit — ${n} checks`);
