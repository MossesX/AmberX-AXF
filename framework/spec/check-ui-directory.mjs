#!/usr/bin/env node
/**
 * ui-directory@1 conformance (Brett, Nov 14 2026: "a data set of every single UI page and settings interface, that
 * scales and grows on its own dynamically"). Pure core replayed against its fixture + the schema snapshots.
 *   node framework/spec/check-ui-directory.mjs            check
 *   node framework/spec/check-ui-directory.mjs --write    regenerate fixtures/ui-directory.json's expected outputs
 *
 *   1. fixture replay: row normalisation and validation (field names), ids, token families, status, reach, the data
 *      set (hash, counts, dedupe, orphan parents), add / remove / change diffs, history merge, filter / search / tree /
 *      settings-of / registration-gap projections
 *   2. the registry snapshot (schemas/ui-directory.json) and JSON Schemas (schemas/json/ui-directory*.schema.json)
 *      match the module (run `node framework/cli/axf.mjs schemas`)
 *   3. invariants a port can rely on: the hash is order-independent and ignores firstSeen, an app row is never
 *      unlinked and never has a deep link, a removed row is gone from the next build, a live row always has a reach
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../core/ui-directory.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/ui-directory.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOW = '2026-11-14T04:00:00Z';
const LATER = '2026-11-15T04:00:00Z';

// ------------------------------------------------------------------ inputs (the fixture's `in`); expected outputs are generated with --write and replayed
const IN = {
  rows: {
    app: { id: 'console-web:app:axf-console', name: 'GizmoX AI Studio', kind: 'app', app: 'console-web', source: 'manifest', file: 'apps/console-web/axf.manifest.json', keywords: ['console-web', 'web'] },
    screen: { id: 'console-web:screen:builds', name: 'Builds', kind: 'screen', app: 'console-web', address: 'view:builds', source: 'shell', file: 'apps/console-web/src/App.tsx', icon: 'play', keywords: ['builds', 'Builds', 'Build'], tokens: ['dens', 'color', 'type', 'component'] },
    tabRow: { id: 'console-web:tab:builds.tabs', name: 'Builds tabs', kind: 'tab', app: 'console-web', parent: 'console-web:screen:builds', address: 'view:builds/tab:builds.tabs', source: 'inventory', level: 0, detail: '2 tab(s)' },
    tab: { id: 'console-web:tab:builds.tabs:pipeline', name: 'Pipeline', kind: 'tab', app: 'console-web', parent: 'console-web:tab:builds.tabs', address: 'view:builds/tab:builds.tabs=pipeline', deepLink: { tool: 'console_open', target: 'builds Pipeline' }, source: 'inventory', level: 1, keywords: ['pipeline'] },
    dynamicTab: { id: 'console-web:tab:crew.*', name: 'Crew tabs', kind: 'tab', app: 'console-web', parent: 'console-web:screen:builds', dynamic: true, plugin: 'crew-live', source: 'plugin', level: 0 },
    settingsScreen: { id: 'console-web:screen:settings', name: 'Settings', kind: 'screen', app: 'console-web', address: 'view:settings', source: 'framework' },
    pluginsTab: { id: 'console-web:settings-tab:plugins', name: 'Plugins', kind: 'settings-tab', app: 'console-web', parent: 'console-web:screen:settings', address: 'view:settings/tab:settings.tabs=plugins', source: 'inventory', level: 0 },
    settingsTab: { id: 'console-web:settings-tab:crew-live', name: 'Crew', kind: 'settings-tab', app: 'console-web', parent: 'console-web:settings-tab:plugins', plugin: 'crew-live', address: 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=crew-live', source: 'plugin', level: 1, keywords: ['crew-live', 'settings'] },
    panel: { id: 'console-web:settings-panel:crew-live.lifecycle', name: 'Install & uninstall', kind: 'settings-panel', app: 'console-web', parent: 'console-web:settings-tab:crew-live', plugin: 'crew-live', deepLink: { tool: 'console_settings', target: 'crew-live' }, source: 'plugin' },
    plugin: { id: 'console-web:plugin:crew-live', name: 'Crew', kind: 'plugin', app: 'console-web', plugin: 'crew-live', address: 'plugin:ai.amberx.axf.console.crew-live', deepLink: { tool: 'console_open', target: 'crew-live' }, settings: 'console-web:settings-tab:crew-live', tokens: ['color', 'dens'], source: 'manifest' },
    pluginScreen: { id: 'console-web:screen:crew-live', name: 'Crew', kind: 'screen', app: 'console-web', plugin: 'crew-live', address: 'view:crew-live', source: 'plugin', tokens: ['color', 'dens'] },
    dialog: { id: 'console-web:dialog:crew-live.stop', name: 'Stop an agent', kind: 'dialog', app: 'console-web', plugin: 'crew-live', parent: 'console-web:screen:crew-live', deepLink: { tool: 'console_dialog', target: 'crew-live.stop' }, source: 'plugin' },
    offPlugin: { id: 'console-web:plugin:parked', name: 'Parked', kind: 'plugin', app: 'console-web', plugin: 'parked', address: 'plugin:x.parked', enabled: false, source: 'manifest' },
    unlinked: { id: 'console-web:banner:parked', name: 'Parked banner', kind: 'banner', app: 'console-web', plugin: 'parked', source: 'manifest' },
    otherApp: { id: 'axhub-web:screen:passes', name: 'Passes', kind: 'screen', app: 'axhub-web', address: 'view:passes', source: 'shell', keywords: ['pass', 'veto'] },
    loose: { id: 'Molly:Screen:Home', name: '  Home  ', kind: 'screen', app: 'MOLLY', address: 'view:home', source: 'shell', tokens: ['color', 'bogus'], keywords: ['a', 'a', '', 'b'], status: 'Live', firstSeen: 'nope' },
    orphan: { id: 'console-web:tab:nowhere', name: 'Nowhere', kind: 'tab', app: 'console-web', parent: 'console-web:screen:gone', address: 'view:gone/tab:x', source: 'inventory' },
    badKind: { id: 'console-web:thing:x', name: 'X', kind: 'thing', app: 'console-web', source: 'shell' },
    badId: { id: 'Console Web:screen:x', name: 'X', kind: 'screen', app: 'console-web', address: 'view:x', source: 'shell' },
    mismatch: { id: 'demo:screen:x', name: 'X', kind: 'screen', app: 'console-web', address: 'view:x', source: 'shell' },
    nameless: { id: 'console-web:screen:y', kind: 'screen', app: 'console-web', address: 'view:y', source: 'shell' },
    appWithLink: { $axf: 'ui-directory-row@1', id: 'demo:app:axf-demo', name: 'Demo', kind: 'app', app: 'demo', status: 'live', source: 'manifest', deepLink: { tool: 'console_open', target: 'home' } },
    liveNoLink: { $axf: 'ui-directory-row@1', id: 'demo:screen:z', name: 'Z', kind: 'screen', app: 'demo', status: 'live', source: 'shell' },
    selfParent: { $axf: 'ui-directory-row@1', id: 'demo:screen:w', name: 'W', kind: 'screen', app: 'demo', status: 'unlinked', source: 'shell', parent: 'demo:screen:w' },
    notObject: 'nope',
  },
  tokens: ['--fx-type-sm', '--fx-dens-2', '--fx-size-md', '--fx-space-3', '--fx-radius-lg', '--fx-border-w', '--fx-font-ui', '--fx-motion-fast', '--fx-ease-out', '--fx-shadow-2', '--fx-blur-sm', '--fx-opacity-muted', '--fx-accent', '--fx-surface-2', '--fx-muted', '--fx-text', '--fx-danger', '--fx-bg', '--fx-btn-pad', '--fx-win-frame', 'color: red', '--fx-'],
  css: '.a{color:var(--fx-text);padding:var(--fx-dens-2) var(--fx-space-3);border-radius:var(--fx-radius-md);border:var(--fx-border-w) solid var(--fx-accent);font:var(--fx-type-sm)/1 var(--fx-font-ui);box-shadow:var(--fx-shadow-1)}',
  declared: ['view:crew-live', 'dialog:crew-live.stop', 'settings-tab:crew-live', 'dialog:crew-live.help'],
  provided: ['view:crew-live', 'dialog:crew-live.stop', 'settings-tab:crew-live', 'settings-tab:old', 'service:axf.crew@1', 'banner:top'],
};

const VALID = ['app', 'screen', 'tabRow', 'tab', 'dynamicTab', 'settingsScreen', 'pluginsTab', 'settingsTab', 'panel', 'plugin', 'pluginScreen', 'dialog', 'offPlugin', 'unlinked', 'otherApp', 'loose', 'orphan'];
const ALL = Object.values(IN.rows);
const first = D.buildDirectory(ALL, { generatedAt: NOW });
// the next scan: the dialog is gone, the tab row got a tab, the plugin screen's tokens moved, a new app appears
const nextRows = [...[...VALID, 'appWithLink'].filter((k) => k !== 'dialog' && k !== 'pluginScreen').map((k) => IN.rows[k]), { ...IN.rows.pluginScreen, tokens: ['color', 'dens', 'radius'] }, { id: 'console-web:tab:builds.tabs:queue', name: 'Queue', kind: 'tab', app: 'console-web', parent: 'console-web:tab:builds.tabs', address: 'view:builds/tab:builds.tabs=queue', source: 'inventory', level: 1 }, { id: 'walkthrough-studio:app:walkthrough-studio', name: 'Walkthrough Studio', kind: 'app', app: 'walkthrough-studio', source: 'manifest' }];
const second = D.buildDirectory(nextRows, { generatedAt: LATER, previous: first });

const OUT = {
  norm: Object.fromEntries(Object.entries(IN.rows).map(([k, r]) => [k, D.normRow(r, { now: NOW })])),
  validate: Object.fromEntries(Object.entries(IN.rows).map(([k, r]) => { const v = D.validateRow(D.normRow(r, { now: NOW })); return [k, { ok: v.ok, errors: v.errors.map((e) => `${e.field}:${e.code}`) }]; })),
  validateRaw: Object.fromEntries(['appWithLink', 'liveNoLink', 'selfParent', 'notObject', 'badKind', 'nameless'].map((k) => { const v = D.validateRow(IN.rows[k]); return [k, { ok: v.ok, errors: v.errors.map((e) => `${e.field}:${e.code}`) }]; })),
  ids: { plain: D.rowId('console-web', 'screen', 'Builds'), nested: D.rowId('Console-Web', 'tab', 'builds.tabs', 'Pipeline'), slash: D.rowId('molly', 'screen', 'expenses/ledger'), messy: D.rowId('demo', 'dialog', ' Ask  Options! ') },
  families: { each: Object.fromEntries(IN.tokens.map((x) => [x, D.tokenFamily(x)])), css: D.familiesOf(IN.css), none: D.familiesOf('color: red') },
  status: { live: D.statusOf({ address: 'view:x' }), link: D.statusOf({ deepLink: { tool: 'console_open', target: 'x' } }), unlinked: D.statusOf({}), dynamic: D.statusOf({ dynamic: true, address: 'view:x' }), off: D.statusOf({ enabled: false, dynamic: true, address: 'view:x' }) },
  reach: Object.fromEntries(['app', 'screen', 'tab', 'settingsTab', 'panel', 'dialog', 'plugin', 'unlinked', 'dynamicTab'].map((k) => [k, D.reachOf(D.normRow(IN.rows[k]))])),
  first: { total: first.total, dropped: first.dropped, hash: first.hash, counts: first.counts, ids: first.rows.map((r) => r.id), orphanParent: first.rows.find((r) => r.id === 'console-web:tab:nowhere').parent, firstSeen: [...new Set(first.rows.map((r) => r.firstSeen))], validate: D.validateDirectory(first) },
  second: { total: second.total, hash: second.hash, diff: D.diffDirectories(first, second), firstSeen: Object.fromEntries(second.rows.map((r) => [r.id, r.firstSeen])), validate: D.validateDirectory(second) },
  filter: {
    plugin: D.filterRows(first.rows, { plugin: 'crew-live' }).map((r) => r.id),
    kinds: D.filterRows(first.rows, { kinds: ['settings-tab', 'settings-panel'] }).map((r) => r.id),
    family: D.filterRows(first.rows, { family: 'dens' }).map((r) => r.id),
    status: D.filterRows(first.rows, { status: 'off' }).map((r) => r.id),
    words: D.filterRows(first.rows, { q: 'crew install' }).map((r) => r.id),
    app: D.filterRows(first.rows, { app: 'axhub-web' }).map((r) => r.id),
  },
  search: { crew: D.search(first.rows, 'crew'), pipeline: D.search(first.rows, 'pipe', { limit: 2 }), settings: D.search(first.rows, 'settings', { kinds: ['settings-tab'] }), none: D.search(first.rows, ''), miss: D.search(first.rows, 'zzz') },
  tree: (function strip(nodes) { return nodes.map((x) => ({ id: x.id, kind: x.kind, children: strip(x.children) })); })(D.tree(first.rows)),
  settingsOf: { dialog: D.settingsOf(first.rows, 'console-web:dialog:crew-live.stop')?.id ?? null, plugin: D.settingsOf(first.rows, 'console-web:plugin:crew-live')?.id ?? null, shell: D.settingsOf(first.rows, 'console-web:screen:builds'), missing: D.settingsOf(first.rows, 'nope') },
  gaps: D.registrationGaps(IN.declared, IN.provided),
  tone: D.STATUS_TONE, kindLabel: D.KIND_LABEL,
};

if (WRITE) {
  writeFileSync(FIX, `${JSON.stringify({ $about: 'ui-directory@1 conformance: inputs (in) and the outputs framework/core/ui-directory.mjs produces for them (out). Regenerate with check-ui-directory.mjs --write only on purpose.', in: IN, out: OUT }, null, 1)}\n`);
  console.log(`wrote ${FIX}`);
}
const fx = JSON.parse(readFileSync(FIX, 'utf8'));

// 1. fixture replay
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'the fixture inputs moved: run --write on purpose'));
for (const k of Object.keys(OUT)) t(`fixture replay: ${k}`, () => assert.ok(same(fx.out[k], OUT[k]), `${k} differs from the fixture: ${JSON.stringify(OUT[k]).slice(0, 300)}`));

// 2. snapshots
t('schemas/ui-directory.json matches REGISTRY (run axf schemas)', () => assert.ok(same(JSON.parse(rd('framework/schemas/ui-directory.json')), D.REGISTRY)));
for (const [name, schema] of Object.entries(D.jsonSchemas())) t(`schemas/json/${name} is current (run axf schemas)`, () => assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), schema)));

// 3. invariants
t('every valid fixture row validates; every bad one names its field', () => {
  for (const k of VALID) assert.ok(OUT.validate[k].ok, `${k}: ${OUT.validate[k].errors}`);
  assert.deepEqual(OUT.validateRaw.appWithLink.errors, ['deepLink:invalid']);
  assert.deepEqual(OUT.validateRaw.liveNoLink.errors, ['status:mismatch']);
  assert.deepEqual(OUT.validateRaw.selfParent.errors, ['parent:invalid']);
  assert.deepEqual(OUT.validateRaw.badKind.errors, ['$axf:missing', 'status:missing', 'kind:enum']);
  assert.deepEqual(OUT.validateRaw.nameless.errors, ['$axf:missing', 'name:missing', 'status:missing']);
  assert.equal(OUT.validateRaw.notObject.ok, false);
});
t('an app row is never unlinked and never has a deep link; loose input is cleaned', () => {
  assert.equal(OUT.norm.app.status, 'live'); assert.equal(OUT.norm.app.deepLink, null);
  assert.equal(OUT.norm.loose.id, 'molly:screen:home', 'ids are lower-cased on the way in');
  assert.equal(OUT.norm.loose.name, 'Home'); assert.equal(OUT.norm.loose.app, 'molly'); assert.deepEqual(OUT.norm.loose.tokens, ['color']); assert.deepEqual(OUT.norm.loose.keywords, ['a', 'b']); assert.equal(OUT.norm.loose.status, 'live'); assert.equal(OUT.norm.loose.firstSeen, NOW);
  assert.ok(OUT.validate.loose.ok, 'cleaned loose input validates');
});
t('status: off beats dynamic beats unlinked beats live; a live row always has a reach, an unlinked one none', () => {
  assert.deepEqual(OUT.status, { live: 'live', link: 'live', unlinked: 'unlinked', dynamic: 'dynamic', off: 'off' });
  for (const r of first.rows) if (r.status === 'live' && r.kind !== 'app') assert.ok(D.reachOf(r), r.id);
  assert.equal(OUT.reach.unlinked, null); assert.equal(OUT.reach.app, null); assert.equal(OUT.reach.dynamicTab, null);
  assert.equal(OUT.reach.settingsTab.mcp.tool, 'console_settings');
  assert.deepEqual(OUT.reach.dialog, { mcp: { tool: 'console_dialog', target: 'crew-live.stop' }, rest: { method: 'POST', path: '/api/plugins/console-commands/dialog', body: { id: 'crew-live.stop' } }, cli: 'axf console-commands dialog --id crew-live.stop', voice: 'open Stop an agent' }, 'a dialog has no console-control address: it is reached through the console commands API');
  assert.equal(OUT.reach.screen.cli, 'axf console do open view:builds'); assert.equal(OUT.reach.screen.rest.body.verb, 'open');
});
t('token families: every --fx-* token has exactly one family, unknown segments are component tokens', () => {
  for (const [tok, fam] of Object.entries(OUT.families.each)) assert.ok(tok.startsWith('--fx-') && tok.length > 5 ? D.TOKEN_FAMILIES.includes(fam) : fam === '', tok);
  assert.equal(OUT.families.each['--fx-btn-pad'], 'component'); assert.equal(OUT.families.each['--fx-ease-out'], 'motion'); assert.deepEqual(OUT.families.none, []);
  assert.deepEqual(OUT.families.css, ['color', 'type', 'dens', 'space', 'radius', 'border', 'font', 'shadow']);
});
t('the data set: invalid rows dropped, duplicates deduped, orphan parents cleared, hash order-independent and firstSeen-blind', () => {
  // appWithLink is cleaned (an app's deep link is removed) and kept; the other seven bad rows are dropped
  assert.equal(first.dropped, ALL.length - VALID.length - 1, `dropped ${first.dropped}`);
  assert.equal(first.total, VALID.length + 1); assert.equal(OUT.first.orphanParent, '');
  assert.ok(OUT.validateRaw.appWithLink.ok === false && OUT.validate.appWithLink.ok === true, 'raw it is rejected, normalised it is fine');
  assert.deepEqual(OUT.first.firstSeen, [NOW]); assert.ok(OUT.first.validate.ok, JSON.stringify(OUT.first.validate.errors));
  const shuffled = D.buildDirectory([...ALL].reverse(), { generatedAt: NOW });
  assert.equal(shuffled.hash, first.hash);
  const dup = D.buildDirectory([...ALL, IN.rows.screen, { ...IN.rows.screen, name: 'Other' }], { generatedAt: NOW });
  assert.equal(dup.total, first.total, 'the first row with an id wins');
  const relabel = D.buildDirectory(ALL, { generatedAt: LATER, previous: first });
  assert.equal(relabel.hash, first.hash, 'firstSeen carried over does not change the hash');
  assert.ok(/^[0-9a-f]{16}$/.test(first.hash));
});
t('auto add / remove: a removed UI is gone, a new one is added, a changed one is listed, firstSeen is kept', () => {
  assert.deepEqual(OUT.second.diff.removed, ['console-web:dialog:crew-live.stop']);
  assert.deepEqual(OUT.second.diff.added.sort(), ['console-web:tab:builds.tabs:queue', 'walkthrough-studio:app:walkthrough-studio']);
  assert.deepEqual(OUT.second.diff.changed, ['console-web:screen:crew-live']);
  assert.equal(OUT.second.firstSeen['console-web:screen:builds'], NOW); assert.equal(OUT.second.firstSeen['walkthrough-studio:app:walkthrough-studio'], LATER);
  assert.notEqual(second.hash, first.hash); assert.ok(OUT.second.validate.ok);
  assert.deepEqual(D.diffDirectories(first, first), { added: [], removed: [], changed: [] });
});
t('projections: filter is AND, search ranks names first, the tree nests app → plugin → screen → children, settings resolve through the plugin', () => {
  assert.deepEqual([...OUT.filter.plugin].sort(), ['console-web:dialog:crew-live.stop', 'console-web:plugin:crew-live', 'console-web:screen:crew-live', 'console-web:settings-panel:crew-live.lifecycle', 'console-web:settings-tab:crew-live', 'console-web:tab:crew.*']);
  assert.deepEqual(OUT.filter.status, ['console-web:plugin:parked']); assert.deepEqual(OUT.filter.words, ['console-web:settings-panel:crew-live.lifecycle']);
  assert.equal(OUT.search.crew[0].name, 'Crew'); assert.equal(OUT.search.pipeline.length, 1); assert.deepEqual(OUT.search.none, []); assert.deepEqual(OUT.search.miss, []);
  assert.ok(OUT.search.settings.every((h) => h.kind === 'settings-tab'));
  const console_ = OUT.tree.find((a) => a.id === 'console-web:app:axf-console');
  const crew = console_.children.find((g) => g.id === 'console-web:plugin:crew-live');
  const screen = crew.children.find((c) => c.id === 'console-web:screen:crew-live');
  assert.ok(screen.children.some((c) => c.id === 'console-web:dialog:crew-live.stop'), 'the dialog nests under its screen');
  const shell = console_.children.find((g) => g.id === 'console-web:group:shell');
  const builds = shell.children.find((c) => c.id === 'console-web:screen:builds');
  assert.ok(builds.children.find((c) => c.id === 'console-web:tab:builds.tabs')?.children.some((c) => c.id === 'console-web:tab:builds.tabs:pipeline'), 'tab rows nest their tabs');
  assert.ok(OUT.tree.some((a) => a.id === 'axhub-web:app'), 'an app with no app row still groups its rows');
  assert.equal(OUT.settingsOf.dialog, 'console-web:settings-tab:crew-live'); assert.equal(OUT.settingsOf.plugin, 'console-web:settings-tab:crew-live'); assert.equal(OUT.settingsOf.shell, null); assert.equal(OUT.settingsOf.missing, null);
  assert.deepEqual(OUT.gaps, { unregistered: ['dialog:crew-live.help'], phantom: ['settings-tab:old'] });
});
t('ids: lower-cased, spaces folded, slashes escaped, edges trimmed', () => assert.deepEqual(OUT.ids, { plain: 'console-web:screen:builds', nested: 'console-web:tab:builds.tabs:pipeline', slash: 'molly:screen:expenses%2fledger', messy: 'demo:dialog:ask-options' }));

console.log(`✓ ui-directory@1: ${n} checks (${Object.keys(IN.rows).length} fixture rows)`);
