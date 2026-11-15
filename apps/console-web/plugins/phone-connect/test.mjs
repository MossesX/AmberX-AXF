#!/usr/bin/env node
/** phone-connect migrate.mjs: dry run writes nothing, apply moves the three pieces, a second run is all `done`. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as M from './migrate.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const NOW = '2026-11-15T15:00:00Z';
const root = mkdtempSync(join(tmpdir(), 'phone-connect-migrate-'));
const old = join(root, M.OLD_DATA_DIR); mkdirSync(join(old, 'sessions'), { recursive: true });
writeFileSync(join(old, 'transcribe.json'), '{"model":"small","on":true}\n');
writeFileSync(join(old, 'sessions', 'index.json'), '{"items":[]}\n');
mkdirSync(join(root, 'apps/console-web/plugins/console-commands/server'), { recursive: true });
writeFileSync(join(root, 'apps/console-web/plugins/console-commands/server/wake.py'), 'TOOL = "amberx.open_url"\n');
const record = { deviceId: 'amberx-3f9a1c2b4d5e6f70', name: 'Google Pixel 8', app: 'amberx-droid', capabilities: ['recorder@1', 'open-url@1'], state: { 'recorder@1': { running: false, parts: 3 } }, lastSeenAt: '2026-11-15T14:58:40Z' };

t('with no device record the plan copies the data, writes the aliases and says where to put the record; nothing is written', () => {
  const p = M.plan({ root, now: NOW });
  assert.deepEqual(p.rows.map((r) => [r.step, r.status]), [['aliases', 'do'], ['data', 'do'], ['device', 'skip']]);
  assert.match(p.rows[2].detail, /amberx-device\.json/); assert.equal(p.ok, true); assert.equal(p.writes.length, 2);
  assert.ok(!existsSync(join(root, M.DATA_DIR))); assert.match(p.rows[0].detail, /wake\.py/);
  assert.match(M.report(p), /dry run/);
});
writeFileSync(join(old, 'device.json'), JSON.stringify(record));
t('apply: aliases.json, recorder/ with every byte, the pointer, devices.json with the migrated phone still paired', () => {
  const p = M.apply(M.plan({ root, owner: 'brett', now: NOW }));
  assert.equal(p.error, undefined); assert.equal(p.applied.length, 3);
  const aliases = JSON.parse(readFileSync(join(root, M.DATA_DIR, 'aliases.json'), 'utf8'));
  assert.equal(aliases.$axf, M.ALIASES_FRAME); assert.deepEqual(aliases.aliases.map((a) => a.from), ['amberx.open_url', 'amberx.recorder_start', 'amberx.recorder_stop', 'amberx.recorder_status']); assert.deepEqual(aliases.callers, [{ file: 'apps/console-web/plugins/console-commands/server/wake.py', uses: ['amberx.open_url'], to: ['phone.open_url'] }]);
  assert.equal(readFileSync(join(root, M.DATA_DIR, 'recorder/transcribe.json'), 'utf8'), '{"model":"small","on":true}\n'); assert.ok(existsSync(join(root, M.DATA_DIR, 'recorder/sessions/index.json')));
  assert.ok(existsSync(join(old, M.POINTER))); assert.ok(existsSync(join(old, 'transcribe.json')), 'the old folder is left for the output-recorder uninstall');
  const devices = JSON.parse(readFileSync(join(root, M.DATA_DIR, 'devices.json'), 'utf8'));
  assert.equal(devices.$axf, M.DEVICES_FRAME); assert.equal(devices.devices.length, 1); const d = devices.devices[0];
  assert.equal(d.deviceId, 'amberx-3f9a1c2b4d5e6f70'); assert.equal(d.app, 'phone-connect-droid'); assert.equal(d.state, 'paired'); assert.equal(d.owner, 'brett'); assert.deepEqual(d.migratedFrom, { deviceId: 'amberx-3f9a1c2b4d5e6f70', app: 'amberx-droid', at: NOW });
  assert.match(M.report(p), /applied/);
});
t('a second run is all done and writes nothing', () => {
  const p = M.plan({ root, owner: 'brett', now: '2026-11-15T15:05:00Z' });
  assert.deepEqual(p.rows.map((r) => r.status), ['done', 'done', 'done']); assert.deepEqual(p.writes, []);
  assert.deepEqual(M.apply(p).applied, []);
});
t('a bad device record fails the plan and apply refuses to write', () => {
  writeFileSync(join(old, 'device.json'), JSON.stringify({ deviceId: 'x!', name: 'bad' }));
  const p = M.plan({ root, now: NOW });
  assert.equal(p.rows[2].status, 'fail'); assert.equal(p.ok, false); assert.match(M.apply(p).error, /nothing was written/);
});
t('mergeDevice replaces by id and keeps the others', () => {
  const other = { deviceId: 'phone-0123456789abcdef', app: 'phone-connect-droid' };
  const m = M.mergeDevice({ $axf: M.DEVICES_FRAME, devices: [other, { deviceId: 'amberx-3f9a1c2b4d5e6f70', app: 'amberx-droid' }] }, { deviceId: 'amberx-3f9a1c2b4d5e6f70', app: 'phone-connect-droid', updatedAt: NOW });
  assert.deepEqual(m.devices.map((d) => [d.deviceId, d.app]), [['phone-0123456789abcdef', 'phone-connect-droid'], ['amberx-3f9a1c2b4d5e6f70', 'phone-connect-droid']]); assert.equal(m.at, NOW);
});
rmSync(root, { recursive: true, force: true });
console.log(`phone-connect test: ${n} checks passed`);
