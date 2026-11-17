#!/usr/bin/env node
// hub-console@1 — every axHub web page as a console screen (Nov 17 2026). Holds framework/core/hub-console.mjs and the
// route table framework/schemas/hub-console.json to the fixture framework/spec/fixtures/hub-console.json: the table is
// valid, every refusal code is exercised, addresses / reaches / hash routes / catalog / missing come out as pinned, the
// counts are deliberate, the JSON Schema agrees with the engine's enums, and the spec and PORTING.md say what they must.
//   node framework/spec/check-hub-console.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hc from '../core/hub-console.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const fx = read('framework/spec/fixtures/hub-console.json');
const table = read(fx.table);
const clone = (v) => JSON.parse(JSON.stringify(v));
const setPath = (obj, path, value) => { const parts = path.split('.'); let cur = obj; for (const p of parts.slice(0, -1)) cur = cur[p]; cur[parts.at(-1)] = value; };

t('the fixture is a hub-console fixture and the table is valid', () => {
  assert.equal(fx.$axf, hc.FIXTURE_FRAME);
  assert.equal(table.$axf, hc.FRAME);
  assert.deepEqual(hc.validateHubConsole(table), { ok: true, errors: [] });
  assert.equal(hc.assertHubConsole(table), table);
});
t('the codes are the fixture\'s, append-only, and every one is exercised by an invalid case', () => {
  assert.deepEqual(hc.CODES, fx.codes);
  const used = new Set(fx.invalid.map((c) => c.code));
  for (const code of hc.CODES) assert.ok(used.has(code), `code ${code} has an invalid case`);
});
t('every invalid case is refused with its code (and the valid table is untouched)', () => {
  for (const c of fx.invalid) {
    const bad = clone(table);
    for (const [path, value] of Object.entries(c.set)) setPath(bad, path, value);
    const r = hc.validateHubConsole(bad);
    assert.ok(!r.ok && r.errors.some((e) => e.code === c.code), `${c.name}: expected ${c.code}, got ${JSON.stringify(r.errors.map((e) => e.code))}`);
    assert.throws(() => hc.assertHubConsole(bad), new RegExp(c.code));
  }
  assert.deepEqual(hc.validateHubConsole(null).ok, false);
  assert.deepEqual(hc.validateHubConsole('x').ok, false);
});
t('the counts are the pinned ones (a table edit is a deliberate fixture edit)', () => {
  assert.deepEqual(hc.countsOf(table), fx.counts);
});
t('addresses', () => {
  for (const c of fx.addresses) {
    const got = c.setting ? hc.settingAddress(table, c.setting) : c.action ? hc.actionAddress(table, c.screen, c.action, c.row ?? null) : c.row ? hc.rowAddress(table, c.screen, c.row) : hc.screenAddress(table, c.screen);
    assert.equal(got, c.address, JSON.stringify(c));
  }
  assert.equal(hc.settingAddress(table, 'axf.nothing'), null);
});
t('reaches on every transport; person actions have no tool, CLI or voice', () => {
  for (const c of fx.reaches) {
    const got = hc.reachesOf(table, c.screen, { row: c.row ?? null, action: c.action ?? null });
    const { screen, row, action, ...expect } = c;
    assert.deepEqual(got, expect, `${screen}${row ? `/${row}` : ''}${action ? `/${action}` : ''}`);
  }
  assert.equal(hc.reachesOf(table, 'nope'), null);
  assert.equal(hc.reachesOf(table, 'approvals', { row: 'not-a-uuid' }), null);
  assert.equal(hc.reachesOf(table, 'approvals', { action: 'nope' }), null);
  for (const r of hc.toolsOf(table)) assert.match(r.tool, hc.TOOL_RE);
  const tools = hc.toolsOf(table).map((x) => x.tool);
  assert.equal(new Set(tools).size, tools.length, 'tool names unique');
});
t('hash routes of the retired axHub web land on their screen', () => {
  for (const c of fx.routes) {
    const got = hc.routeToScreen(table, c.hash);
    if (c.screen === null && c.deferred) assert.deepEqual(got, { screen: null, deferred: c.deferred }, c.hash);
    else if (c.screen === null) assert.equal(got, null, c.hash);
    else assert.deepEqual(got, { screen: c.screen, params: c.params }, c.hash);
  }
  assert.equal(hc.routeToScreen(table, null).screen, table.home);
});
t('the command catalog never lists a person action; confirms are the pinned ones', () => {
  const cat = hc.catalogActions(table);
  const keys = cat.map((c) => `${c.screen}/${c.action}`);
  for (const k of fx.catalog.excludes) assert.ok(!keys.includes(k), `${k} must not be a command`);
  for (const k of fx.catalog.includes) assert.ok(keys.includes(k), `${k} must be a command`);
  assert.deepEqual(cat.filter((c) => c.confirm).map((c) => `${c.screen}/${c.action}`), fx.catalog.confirm);
  assert.deepEqual(hc.personActions(table), fx.catalog.excludes.length ? hc.personActions(table) : []);
  for (const p of fx.catalog.excludes) assert.ok(hc.personActions(table).includes(p), `${p} is personOnly`);
  assert.equal(hc.personActions(table).length, fx.counts.person);
  for (const c of cat) assert.ok(c.tool, `${c.screen}/${c.action} has a tool`);
});
t('what the hub still lacks is explicit', () => {
  assert.deepEqual(hc.hubMissing(table).map(({ screen, action, proposed }) => ({ screen, action, proposed })), fx.missing);
  for (const m of hc.hubMissing(table)) assert.ok(m.why.length >= 10);
});
t('settings have addresses under the Hub sub-tab', () => {
  const settings = hc.settingsOf(table);
  assert.equal(settings.length, fx.counts.settings);
  for (const s of settings) assert.ok(s.address?.startsWith(`${hc.SETTINGS_ROOT}${table.settingsSubtab}/setting:axf.hub.`), s.key);
  assert.ok(settings.some((s) => s.personOnly && s.ownedBy === 'claude-settings'), 'No wait stays owner-only, owned by claude-settings');
});
t('parity: every axHub web route of the fixture is replaced by a screen', () => {
  for (const r of fx.parity.axhubWebRoutes) {
    const sample = r.replace('<id>', r.startsWith('#/handoff') ? '20261117-093000-ab12' : '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0');
    const got = hc.routeToScreen(table, sample);
    assert.ok(got && got.screen, `${r} has a console screen`);
  }
});
t('the JSON Schema agrees with the engine', () => {
  const schema = read('framework/schemas/json/hub-console.schema.json');
  assert.equal(schema.properties.$axf.const, hc.FRAME);
  assert.deepEqual(schema.$defs.who.enum, hc.WHO);
  assert.deepEqual(schema.$defs.effect.enum, hc.EFFECTS);
  assert.deepEqual(schema.$defs.channel.enum, hc.CHANNELS);
  assert.deepEqual(schema.properties.screens.items.$ref && schema.$defs.screen.properties.gate.enum, hc.GATES);
  assert.equal(schema.$defs.tool.pattern, hc.TOOL_RE.source);
  assert.deepEqual(schema.$defs.setting.properties.kind.enum, hc.SETTING_KINDS);
});
t('the spec and PORTING.md say what they must', () => {
  const spec = readFileSync(join(ROOT, 'framework/spec/HUB-CONSOLE.md'), 'utf8');
  for (const s of hc.screensOf(table)) assert.ok(spec.includes(`hub.tabs=${s.id}`), `spec names screen ${s.id}`);
  for (const w of hc.WHO) assert.ok(spec.includes(`\`${w}\``), `spec explains ${w}`);
  assert.ok(spec.includes(hc.HUB_MISSING) && spec.includes('framework/schemas/hub-console.json') && spec.includes('framework/core/hub-console.mjs'));
  const porting = readFileSync(join(ROOT, 'framework/spec/PORTING.md'), 'utf8');
  assert.ok(porting.includes('## Deferred: hub-console@1'), 'PORTING.md records the deferred Kotlin twin');
});

console.log(`hub-console@1: ${n} checks passed`);
