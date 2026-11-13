#!/usr/bin/env node
/**
 * Icon map plugin tests (node apps/console-web/plugins/icon-map/test.mjs): the plugin's own slots are in the map built
 * from the files, every command the manifest declares exists, the pack-word rule the page and the server share, the
 * voice intents (console-control-voice.mjs) and the framework CLI the server part runs. The routes themselves are
 * tested by test.py (FastAPI TestClient against a scratch data folder).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const { buildMap, readPacks, main } = await import(join(ROOT, 'framework/cli/icon-map.mjs'));
const { voiceIntent } = await import(join(ROOT, 'framework/core/engines/console-control-voice.mjs'));
const { normalizeIconsBlock, SLOT_ID } = await import(join(ROOT, 'framework/core/engines/icon-map-rules.mjs'));

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}\n  ${e.stack}`); process.exitCode = 1; } };
const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));

await test('plugin.json: icons block validates, lifecycle + help + commands present', () => {
  assert.equal(normalizeIconsBlock(manifest.icons).errors.length, 0);
  assert.ok(manifest.lifecycle?.dataDir && manifest.help && manifest.commands?.items?.length >= 10);
});

const map = buildMap();
await test('the plugin is in the map it serves (its page, nav, menu, settings, buttons)', () => {
  const mine = map.slots.filter((s) => s.owner === 'icon-map');
  assert.ok(mine.length >= 8, `only ${mine.length} slots`);
  for (const surf of ['view', 'nav', 'menu', 'settings', 'button', 'tab']) assert.ok(mine.some((s) => s.surface === surf), `no ${surf} slot`);
  assert.ok(mine.every((s) => SLOT_ID.test(s.id)));
  assert.equal(map.roles['icon-map']?.glyph, 'grid', 'the role the manifest declares is in the map');
  assert.ok(mine.some((s) => s.role === 'icon-map'), 'the pin gives the grid glyph its declared role');
});

await test('every declared route / action matches the server and the web code', () => {
  const py = readFileSync(join(HERE, 'server/__init__.py'), 'utf8');
  const web = readFileSync(join(HERE, 'web/index.tsx'), 'utf8');
  for (const it of manifest.commands.items) {
    if (it.route) { const [m, p] = it.route.split(' '); assert.ok(py.includes(`@router.${m.toLowerCase()}("${p}")`), `route ${it.route} not in server`); }
    if (it.action) assert.ok(web.includes(`'${it.action}'`), `action ${it.action} not registered`);
  }
});

await test('packs: at least the shipped ones, each with themable / covers / licence fields', () => {
  const packs = readPacks();
  assert.ok(packs.length >= 3);
  for (const p of packs) { assert.equal(typeof p.themable, 'boolean'); assert.ok(Array.isArray(p.covers)); assert.ok(p.license && 'name' in p.license); }
});

await test('voice: pack and slot intents (the same rules the Python twin replays from the fixture)', () => {
  assert.deepEqual(voiceIntent('switch to the duotone icon pack'), { verb: 'press', address: 'function:icon-map.pack.use', value: 'duotone' });
  assert.deepEqual(voiceIntent('Amber, use the filled icons please'), { verb: 'press', address: 'function:icon-map.pack.use', value: 'filled' });
  assert.deepEqual(voiceIntent('set the icon pack to amberx outline'), { verb: 'press', address: 'function:icon-map.pack.use', value: 'amberx outline' });
  assert.deepEqual(voiceIntent('back to the default icon pack'), { verb: 'press', address: 'function:icon-map.pack.clear' });
  assert.deepEqual(voiceIntent('reset the icons'), { verb: 'press', address: 'function:icon-map.pack.clear' });
  assert.deepEqual(voiceIntent('change the save icon to check circle'), { verb: 'press', address: 'function:icon-map.slot.set', value: 'save:check-circle' });
  assert.equal(voiceIntent('open the icon map').verb, 'open', 'opening the page stays a screen intent');
  assert.equal(voiceIntent('switch to the pipeline tab').verb, 'open', 'other switch-to phrases are untouched');
});

await test('framework CLI: list / show / resolve / roles answer as JSON (what the server part runs)', async () => {
  const logs = [];
  const orig = console.log; console.log = (s) => logs.push(String(s));
  try {
    assert.equal(await main(['list', '--owner', 'icon-map', '--surface', 'view', '--json']), 0);
    const rows = JSON.parse(logs.join('\n')); logs.length = 0;
    assert.ok(rows.length >= 1 && rows[0].id.startsWith('console-web/icon-map/view/'));
    assert.equal(await main(['show', rows[0].id, '--json']), 0); JSON.parse(logs.join('\n')); logs.length = 0;
    assert.equal(await main(['resolve', 'save', '--json']), 0);
    assert.deepEqual(JSON.parse(logs.join('\n')), { glyph: 'save', via: 'framework' }); logs.length = 0;
    assert.equal(await main(['resolve', 'nope', '--role', 'approve', '--json']), 0);
    assert.equal(JSON.parse(logs.join('\n')).glyph, 'check-circle'); logs.length = 0;
    assert.equal(await main(['show', 'no/such/slot/here']), 1);
  } finally { console.log = orig; }
});

console.log(process.exitCode ? `icon-map tests: failures (${n} passed)` : `icon-map tests: ${n} passed`);
