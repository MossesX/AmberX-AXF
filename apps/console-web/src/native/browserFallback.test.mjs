// node apps/console-web/src/native/browserFallback.test.mjs — the console outside the Android console app
import assert from 'node:assert/strict';
import { NATIVE_ACTIONS } from './nativeRules.mjs';
import { APP_ONLY, browserCapabilities, browserPlan, sameOrigin, wrapperEnv } from './browserFallback.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const O = 'https://console.example';

t('either native host means the app; none means a browser', () => {
  assert.deepEqual(wrapperEnv({}), { wrapper: false, hosts: [], mode: 'browser' });
  assert.equal(wrapperEnv({ axfNativeHost: {} }).mode, 'app');
  assert.equal(wrapperEnv({ axfBridgeHost: {} }).mode, 'app');
  assert.deepEqual(wrapperEnv({ axfNativeHost: {}, axfBridgeHost: {} }).hosts, ['axfNativeHost', 'axfBridgeHost']);
  assert.equal(wrapperEnv(undefined).wrapper, false);
});

t('every native action has a browser answer: a plan or a plain error', () => {
  const sample = { 'native.overlay': ['expand'], 'native.permission': ['mic'], 'native.notify': ['Hi', 'there'], 'native.open': [`${O}/x`],
    'native.wake': [], 'native.recorder': ['start'], 'native.update': ['check'], 'native.state': [] };
  for (const a of NATIVE_ACTIONS) {
    const p = browserPlan(a.id, sample[a.id], O);
    assert.ok('do' in p || 'error' in p, a.id);
  }
});

t('web equivalents', () => {
  assert.deepEqual(browserPlan('native.notify', ['Build', 'done: 3'], O), { do: 'notify', title: 'Build', text: 'done: 3' });
  assert.deepEqual(browserPlan('native.open', [`${O}/plugins`], O), { do: 'open', url: `${O}/plugins`, target: '_self' });
  assert.deepEqual(browserPlan('native.open', ['https://elsewhere.example/'], O), { do: 'open', url: 'https://elsewhere.example/', target: '_blank' });
  assert.equal(browserPlan('native.open', [`${O}/x|browser`], O).target, '_blank');
  assert.deepEqual(browserPlan('native.permission', ['notifications'], O), { do: 'permission', name: 'notifications' });
  assert.deepEqual(browserPlan('native.wake', [], O), { do: 'focus' });
  assert.deepEqual(browserPlan('native.update', ['reload'], O), { do: 'update', verb: 'reload' });
});

t('app-only features say so; bad arguments fail like in the app', () => {
  assert.match(browserPlan('native.overlay', ['expand'], O).error, new RegExp(APP_ONLY));
  assert.match(browserPlan('native.recorder', ['start'], O).error, new RegExp(APP_ONLY));
  assert.match(browserPlan('native.permission', ['overlay'], O).error, new RegExp(APP_ONLY));
  assert.match(browserPlan('native.notify', [], O).error, /native\.notify/);
  assert.match(browserPlan('native.overlay', ['fly'], O).error, /native\.overlay takes/);
});

t('same origin and capabilities', () => {
  assert.equal(sameOrigin('/a', O), true);
  assert.equal(sameOrigin('https://x.example', O), false);
  assert.equal(sameOrigin('::', ''), false);
  assert.deepEqual(browserCapabilities({}), { notifications: 'unsupported', mic: false, standalone: false });
  assert.equal(browserCapabilities({ Notification: { permission: 'granted' } }).notifications, 'granted');
});

console.log(`browserFallback: ${n} checks passed`);
