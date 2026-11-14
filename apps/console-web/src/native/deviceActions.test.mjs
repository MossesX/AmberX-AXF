// node apps/console-web/src/native/deviceActions.test.mjs — device.* console actions → phone bridge tools (API parity)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEVICE_ACTIONS, DEVICE_ADDRESS, describeDevice, deviceCall } from './deviceActions.mjs';
import { TOOLS } from './bridgeClient.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('every action maps onto bridge tools', () => {
  assert.deepEqual(deviceCall('device.state'), { tool: 'bridge.info', args: {} });
  assert.deepEqual(deviceCall('device.mic', ['off']), { tool: 'mic.set', args: { on: false } });
  assert.deepEqual(deviceCall('device.mic', []), { tool: 'mic.status', args: {} });
  assert.deepEqual(deviceCall('device.permission', ['Mic']), { tool: 'permissions.request', args: { permission: 'mic' } });
  assert.deepEqual(deviceCall('device.permission', ['status']), { tool: 'permissions.status', args: {} });
  // URLs come back together after the colon split
  assert.deepEqual(deviceCall('device.open', ['https', '//console.amberxai.com/?axf-open=settings']), { tool: 'browser.open', args: { url: 'https://console.amberxai.com/?axf-open=settings', where: 'app' } });
  assert.deepEqual(deviceCall('device.open', ['browser', 'https', '//axhub.amberxai.com/']), { tool: 'browser.open', args: { url: 'https://axhub.amberxai.com/', where: 'browser' } });
  assert.deepEqual(deviceCall('device.wake', ['panel', 'phone-app']), { tool: 'console.wake', args: { target: 'panel:phone-app' } });
  assert.deepEqual(deviceCall('device.wake', []), { tool: 'console.wake', args: {} });
  assert.deepEqual(deviceCall('device.notify', ['Build done', 'PR 633', 'green']), { tool: 'notify.show', args: { title: 'Build done', text: 'PR 633:green' } });
  assert.deepEqual(deviceCall('device.notify-cancel', ['n1']), { tool: 'notify.cancel', args: { id: 'n1' } });
  assert.deepEqual(deviceCall('device.notify-cancel', []), { tool: 'notify.status', args: {} });
  assert.deepEqual(deviceCall('device.recorder', ['start', 'Build night']), { tool: 'recorder.start', args: { session_name: 'Build night' } });
  assert.deepEqual(deviceCall('device.recorder', ['stop']), { tool: 'recorder.stop', args: {} });
  assert.deepEqual(deviceCall('device.recorder', []), { tool: 'recorder.status', args: {} });
  // four console slots (s6)
  assert.deepEqual(deviceCall('device.slots', []), { tool: 'slots.status', args: {} });
  assert.deepEqual(deviceCall('device.slots', ['open', 'settings']), { tool: 'slots.open', args: { target: 'settings' } });
  assert.deepEqual(deviceCall('device.slots', ['open', 'panel', 'phone-bridge', '3']), { tool: 'slots.open', args: { target: 'panel:phone-bridge', slot: 3 } });
  assert.deepEqual(deviceCall('device.slots', ['open', 'https', '//axhub.amberxai.com/', '2']), { tool: 'slots.open', args: { url: 'https://axhub.amberxai.com/', slot: 2 } });
  assert.deepEqual(deviceCall('device.slots', ['open']), { tool: 'slots.open', args: {} });
  assert.deepEqual(deviceCall('device.slots', ['focus', '2']), { tool: 'slots.focus', args: { slot: 2 } });
  assert.deepEqual(deviceCall('device.slots', ['close', '4']), { tool: 'slots.close', args: { slot: 4 } });
  for (const bad of [['close', '1'], ['close', '5'], ['focus'], ['split']]) assert.ok('error' in deviceCall('device.slots', bad), bad.join(':'));
  assert.match(describeDevice('slots.open', { count: 3, max: 4, layout: 'grid', focused: 3 }), /3 of 4 console slots open \(grid\), slot 3/);
  assert.deepEqual(deviceCall('device.tool', ['amberx.open_url', '{"url"', '"https://console.amberxai.com/"}']), { tool: 'browser.open', args: { url: 'https://console.amberxai.com/' } });
  assert.deepEqual(deviceCall('device.tool', ['bridge.capabilities']), { tool: 'bridge.capabilities', args: {} });
});

test('bad input answers an error, never a call', () => {
  for (const [id, args] of [
    ['device.mic', ['loud']], ['device.permission', ['camera']], ['device.open', ['http', '//x']], ['device.notify', ['']],
    ['device.recorder', ['pause']], ['device.tool', ['nope']], ['device.tool', ['mic.set', '[1]']], ['device.tool', ['mic.set', '{bad']], ['device.nope', []],
  ]) assert.ok('error' in deviceCall(id, args), `${id}:${args.join(':')}`);
});

test('every tool is reachable from an action', () => {
  const reached = new Set();
  const samples = {
    'device.state': [[]], 'device.mic': [[], ['on']], 'device.permission': [[], ['mic']], 'device.open': [['https', '//console.amberxai.com/']],
    'device.wake': [[]], 'device.notify': [['t']], 'device.notify-cancel': [[], ['n']], 'device.recorder': [[], ['start'], ['stop']],
    'device.tool': [['bridge.ping'], ['bridge.capabilities']],
    'device.slots': [[], ['open', 'settings'], ['close', '2'], ['focus', '1']],
  };
  for (const [id, list] of Object.entries(samples)) for (const a of list) reached.add(deviceCall(id, a).tool);
  assert.deepEqual(TOOLS.filter((t) => !reached.has(t)), []);
});

test('deviceApi.ts registers every action with a literal id (control inventory) and the state address', () => {
  const ts = readFileSync(join(here, 'deviceApi.ts'), 'utf8');
  for (const a of DEVICE_ACTIONS) assert.match(ts, new RegExp(`actions\\.register\\('${a.id.replace('.', '\\.')}'`), a.id);
  assert.equal(DEVICE_ADDRESS, 'panel:phone-bridge');
  const main = readFileSync(join(here, '../main.tsx'), 'utf8');
  assert.match(main, /installDeviceApi\(axf\)/);
});

test('answers read well', () => {
  assert.equal(describeDevice('mic.status', { on: true, reason: 'no_permission' }), 'Phone mic on (no permission)');
  assert.equal(describeDevice('permissions.status', { mic: true, notifications: false, overlay: true }), 'Phone permissions: mic yes, notifications no, overlay yes');
  assert.equal(describeDevice('browser.open', { opened: false, notified: true }), 'Sent a notification to open it');
  assert.equal(describeDevice('x', {}), 'Done on the phone');
});

for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}\n${e?.stack ?? e}`); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
