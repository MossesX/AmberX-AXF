// node apps/console-web/src/native/bridgeClient.test.mjs — window.axfNative (native-bridge@1) against a fake shell host
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRIDGE_VERSION, EVENTS, callWithPermissions, requestPermission, LEGACY_METHODS, READY_EVENT, TOOLS, argsFor, bridgeAvailable, createBridge, installBridge, nativeTool, toolOf,
} from './bridgeClient.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** A window with the shell's host: answers like DeviceBridge (async, through the 'axf-native' event). */
function fakeWindow({ answer = (c) => ({ ok: true, data: { echo: c.tool, args: c.args } }), host = true } = {}) {
  const win = new EventTarget();
  win.CustomEvent = CustomEvent;
  win.calls = [];
  if (host) {
    win.axfBridgeHost = {
      call(json) {
        const c = JSON.parse(json);
        win.calls.push(c);
        const a = answer(c);
        if (a === null) return; // never answers
        queueMicrotask(() => win.dispatchEvent(new CustomEvent('axf-native', { detail: { id: c.id, tool: c.tool, ...a } })));
      },
    };
  }
  win.emit = (event, data) => win.dispatchEvent(new CustomEvent('axf-native', { detail: { event, data } }));
  return win;
}

test('the tool list matches BridgeContract.java', () => {
  const java = readFileSync(join(here, '../../../console-droid/app/src/main/java/ai/amberx/consoleapp/BridgeContract.java'), 'utf8');
  const consts = Object.fromEntries([...java.matchAll(/static final String (\w+) = "([^"]+)";/g)].map((m) => [m[1], m[2]]));
  const list = (name) => java.match(new RegExp(`static final List<String> ${name} = Arrays\\.asList\\(([^;]+)\\);`))[1].split(',').map((s) => consts[s.trim()]);
  assert.deepEqual(TOOLS, list('TOOLS'));
  assert.deepEqual(EVENTS, list('EVENTS'));
  assert.equal(consts.VERSION, BRIDGE_VERSION);
  assert.equal(consts.HOST, 'axfBridgeHost');
  // every alias in the Java table means the same tool here
  for (const m of java.matchAll(/alias\((\w+), ([^)]+)\);/g)) {
    for (const n of m[2].split(',').map((s) => JSON.parse(s.trim()))) assert.equal(toolOf(n), consts[m[1]], n);
  }
});

test('toolOf and argsFor', () => {
  assert.equal(toolOf('amberx.open_url'), 'browser.open');
  assert.equal(toolOf(' Recorder_Status '), 'recorder.status');
  assert.equal(toolOf('amberx.notify_cancel'), 'notify.cancel');
  assert.equal(toolOf('amberx.console_wake'), 'console.wake');
  assert.equal(toolOf('nope'), null);
  assert.equal(toolOf(7), null);
  assert.deepEqual(argsFor('mic.on', null), { on: true });
  assert.deepEqual(argsFor('mic.off', { on: true }), { on: false });
});

test('a call answers through the event, with aliases and args', async () => {
  const win = fakeWindow();
  const b = createBridge(win);
  const d = await b.call('amberx.recorder_start', { session_name: 'Build night' });
  assert.deepEqual(d, { echo: 'recorder.start', args: { session_name: 'Build night' } });
  assert.match(win.calls[0].id, /^[A-Za-z0-9_.:-]{1,64}$/);
  assert.equal(b.pendingCount(), 0);
  b.dispose();
});

test('errors carry code and permissions', async () => {
  const win = fakeWindow({ answer: () => ({ ok: false, error: { code: 'permission', message: 'needs mic', permissions: ['mic'] } }) });
  const b = createBridge(win);
  await assert.rejects(b.call('mic.set', { on: true }), (e) => e.code === 'permission' && e.permissions[0] === 'mic');
  await assert.rejects(b.call('bogus'), (e) => e.code === 'unknown_tool');
  assert.equal(win.calls.length, 1); // an unknown tool never reaches the phone
  b.dispose();
});

test('a call with no answer times out, dispose rejects what is left', async () => {
  const win = fakeWindow({ answer: () => null });
  const b = createBridge(win, { timeoutMs: 20 });
  await assert.rejects(b.call('bridge.ping'), (e) => e.code === 'timeout');
  const b2 = createBridge(win, { timeoutMs: 10000 });
  const p = b2.call('bridge.ping');
  b2.dispose();
  await assert.rejects(p, (e) => e.code === 'unavailable');
  b.dispose();
});

test('events reach on(), "*" gets all, off() stops them, a throwing listener breaks nothing', () => {
  const win = fakeWindow();
  const b = createBridge(win);
  const seen = [];
  const off = b.on('recorder', (d) => seen.push(['rec', d.running]));
  b.on('*', (_d, ev) => seen.push(['all', ev]));
  b.on('mic', () => { throw new Error('x'); });
  win.emit('recorder', { running: true });
  win.emit('mic', { on: false });
  off();
  win.emit('recorder', { running: false });
  assert.deepEqual(seen, [['rec', true], ['all', 'recorder'], ['all', 'mic'], ['all', 'recorder']]);
  b.dispose();
});

test('installBridge: only inside the app, fires ready once, merges part 1\'s object both ways', async () => {
  const desktop = fakeWindow({ host: false });
  assert.equal(bridgeAvailable(desktop), false);
  installBridge(desktop);
  assert.equal(desktop.axfNative, undefined);
  await assert.rejects(nativeTool(desktop, 'bridge.ping'), (e) => e.code === 'no_bridge');

  const win = fakeWindow();
  let ready = 0;
  win.addEventListener(READY_EVENT, () => ready++);
  // part 1's object was there first
  const legacyCalls = [];
  win.axfNative = { available: true, call: (m, ...a) => { legacyCalls.push([m, ...a]); return { ok: true, m }; }, state: () => ({ ok: true }), on: () => () => {} };
  const remove = installBridge(win);
  installBridge(win);
  assert.equal(ready, 1);
  assert.equal(win.axfNative.version, BRIDGE_VERSION);
  assert.equal(typeof win.axfNative.state, 'function');
  assert.deepEqual(win.axfNative.call('overlay', 'expand'), { ok: true, m: 'overlay' });
  assert.deepEqual(win.axfNative.call('info'), { ok: true, m: 'info' }); // part 1's sync info() stays
  assert.deepEqual(await win.axfNative.call('bridge.info'), { echo: 'bridge.info', args: {} });
  assert.deepEqual(await win.axfNative.call('info', {}), { echo: 'bridge.info', args: {} }); // with args: the bridge tool

  // part 1 assigns its object after the bridge: still both
  win.axfNative = { available: true, call: () => ({ ok: true, late: true }), state: () => ({}) };
  assert.equal(win.axfNative.version, BRIDGE_VERSION);
  assert.deepEqual(win.axfNative.call('overlayState'), { ok: true, late: true });
  assert.deepEqual(await nativeTool(win, 'amberx.open_url', { url: 'https://console.amberxai.com/' }), { echo: 'browser.open', args: { url: 'https://console.amberxai.com/' } });
  assert.ok(LEGACY_METHODS.includes('overlayState'));
  remove();
  assert.equal(win.axfNative, undefined);
});

test('permissions: asked, answered by the event, then the tool runs again', async () => {
  let micGranted = false;
  const win = fakeWindow({
    answer: (c) => {
      if (c.tool === 'permissions.request') {
        if (c.args.permission === 'mic') setTimeout(() => { micGranted = true; win.emit('permission', { permission: 'mic', granted: true, asked: true }); }, 5);
        return { ok: true, data: { permission: c.args.permission, granted: false, asked: true } };
      }
      if (c.tool === 'mic.set' && !micGranted) return { ok: false, error: { code: 'permission', message: 'needs mic', permissions: ['mic'] } };
      return { ok: true, data: { on: true } };
    },
  });
  const remove = installBridge(win);
  assert.deepEqual(await callWithPermissions(win, 'mic.on'), { on: true });
  assert.deepEqual(win.calls.map((c) => c.tool), ['mic.set', 'permissions.request', 'mic.set']);
  // a prompt nobody answers: false after the wait
  assert.equal(await requestPermission(win, 'notifications', { waitMs: 20 }), false);
  remove();
});

test('permissions: a "no" is the caller\'s error; already granted answers at once', async () => {
  const win = fakeWindow({
    answer: (c) => {
      if (c.tool === 'permissions.request') {
        setTimeout(() => win.emit('permission', { permission: c.args.permission, granted: false, asked: true }), 5);
        return { ok: true, data: { permission: c.args.permission, granted: c.args.permission === 'overlay', asked: c.args.permission !== 'overlay' } };
      }
      return { ok: false, error: { code: 'permission', message: 'needs notifications', permissions: ['notifications'] } };
    },
  });
  const remove = installBridge(win);
  await assert.rejects(callWithPermissions(win, 'notify.show', { title: 'x' }), (e) => e.code === 'permission' && e.permissions[0] === 'notifications');
  assert.equal(await requestPermission(win, 'overlay'), true);
  remove();
  await assert.rejects(requestPermission(win, 'mic'), (e) => e.code === 'no_bridge');
});

test('main.tsx installs the bridge', () => {
  const main = readFileSync(join(here, '../main.tsx'), 'utf8');
  assert.match(main, /installBridge\(window\)/);
});

for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}\n${e?.stack ?? e}`); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
