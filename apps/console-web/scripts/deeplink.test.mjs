// Deep links into the console: node apps/console-web/scripts/deeplink.test.mjs
// `#/<view>[/<sub>]`, `?axf-target=<address>` and `?axf-open=<address|action>` land on the screen they name, also when
// that screen belongs to a plugin whose web part registers later (the pending-target queue), and an unknown target
// shows a notice instead of silently staying on Home. Pure: the resolver core (src/control/deepLink-core.mjs) with a
// fake console (views that register late, the actions it knows, a clock).
import assert from 'node:assert/strict';
import { parseDeepLink, planDeepLink, createPendingTargets, DEEP_LINK_PARAMS } from '../src/control/deepLink-core.mjs';

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const BASE = 'https://console.example';

await t('#/plan-studio and #/plan-studio-2 name their view', () => {
  for (const v of ['plan-studio', 'plan-studio-2']) {
    const l = parseDeepLink(`${BASE}/#/${v}`);
    assert.equal(l.address, `view:${v}`); assert.equal(l.view, v); assert.equal(l.source, 'hash');
    assert.equal(l.rest, `${BASE}/`, 'the hash is taken off the address bar');
  }
});

await t('?axf-target=view:plan-studio (plain and encoded) names the view', () => {
  for (const q of ['view:plan-studio', encodeURIComponent('view:plan-studio')]) {
    const l = parseDeepLink(`${BASE}/?axf-target=${q}&keep=1`);
    assert.equal(l.address, 'view:plan-studio'); assert.equal(l.view, 'plan-studio'); assert.equal(l.source, 'target');
    assert.equal(l.rest, `${BASE}/?keep=1`);
  }
});

await t('plugin sub-targets: #/plan-studio-2/plan:<id>, view:plan-studio-2/plan:<id>, a bare plan id', () => {
  const a = parseDeepLink(`${BASE}/#/plan-studio-2/plan:launch-day-gc4e`);
  assert.equal(a.address, 'view:plan-studio-2/plan:launch-day-gc4e'); assert.equal(a.view, 'plan-studio-2');
  const b = parseDeepLink(`${BASE}/?axf-target=view:plan-studio-2/plan:launch-day-gc4e`);
  assert.equal(b.address, a.address);
  const known = new Set(['plan-studio-2.open']);
  const plan = planDeepLink(a, { hasAction: (id) => known.has(id), isControlKind: (k) => ['view', 'tab', 'subtab', 'row', 'grid', 'button', 'setting', 'panel'].includes(k) });
  assert.deepEqual(plan, { view: 'plan-studio-2', action: 'plan-studio-2.open:launch-day-gc4e' }, 'a kind the control contract has not got is the view\'s own open action');
  const bare = planDeepLink(parseDeepLink(`${BASE}/#/plan-studio-2/launch-day-gc4e`), { hasAction: (id) => known.has(id), isControlKind: () => true });
  assert.deepEqual(bare, { view: 'plan-studio-2', action: 'plan-studio-2.open:launch-day-gc4e' });
});

await t('settings sub-targets: #/settings/plugins and view:settings/tab:settings.tabs=plugins', () => {
  const a = parseDeepLink(`${BASE}/#/settings/plugins`);
  assert.equal(a.address, 'view:settings/tab:settings.tabs=plugins');
  const b = parseDeepLink(`${BASE}/?axf-target=view:settings/tab:settings.tabs=plugins`);
  assert.equal(b.address, a.address);
  assert.equal(parseDeepLink(`${BASE}/#/settings/plugins/plan-studio-2`).address, 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=plan-studio-2');
  assert.equal(parseDeepLink(`${BASE}/#/plan-studio-2/grid:plan-studio-2.tree/row:x`).address, 'view:plan-studio-2/grid:plan-studio-2.tree/row:x');
  const plan = planDeepLink(b, { hasAction: () => false, isControlKind: () => true });
  assert.deepEqual(plan, { view: 'settings', address: 'view:settings/tab:settings.tabs=plugins' });
});

await t('?axf-open= keeps working (an address or an action)', () => {
  assert.equal(parseDeepLink(`${BASE}/?axf-open=view:pending`).address, 'view:pending');
  const act = parseDeepLink(`${BASE}/?axf-open=plan-studio-2.focus:deploy`);
  assert.equal(act.action, 'plan-studio-2.focus:deploy'); assert.equal(act.address, undefined);
  assert.deepEqual(DEEP_LINK_PARAMS, ['axf-target', 'axf-open']);
});

await t('nothing to follow: no link, #, #/, an in-page #anchor', () => {
  for (const h of [`${BASE}/`, `${BASE}/#`, `${BASE}/#/`, `${BASE}/#top`, `${BASE}/?q=1`]) assert.equal(parseDeepLink(h), null, h);
  assert.equal(parseDeepLink('not a url'), null);
});

await t('a broken address is a notice, not Home', () => {
  const l = parseDeepLink(`${BASE}/?axf-target=Not%20An%20Address`);
  assert.ok(l && l.error, 'carries an error'); assert.match(l.error, /Not An Address/);
});

await t('a plugin sub-target its view cannot open is a notice', () => {
  const p = planDeepLink(parseDeepLink(`${BASE}/#/home/plan:x`), { hasAction: () => false, isControlKind: (k) => k !== 'plan' });
  assert.equal(p.view, 'home'); assert.match(p.error, /cannot open "plan:x"/);
});

await t('pending targets: wait for a late plugin view, then open it once', async () => {
  const views = new Set(['home']);
  const opened = [], notices = [];
  const q = createPendingTargets({ isReady: (v) => views.has(v), open: (p) => opened.push(p), notice: (m) => notices.push(m), timeoutMs: 400, pollMs: 10 });
  q.push({ view: 'plan-studio-2', action: 'plan-studio-2.open:x' }, 'view:plan-studio-2/plan:x');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(opened.length, 0, 'not before the view registered');
  views.add('plan-studio-2'); q.poke();
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(opened, [{ view: 'plan-studio-2', action: 'plan-studio-2.open:x' }]);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(opened.length, 1, 'once'); assert.deepEqual(notices, []);
  assert.equal(q.size(), 0);
});

await t('pending targets: a view that never registers ends in a notice', async () => {
  const notices = [];
  const q = createPendingTargets({ isReady: () => false, open: () => assert.fail('must not open'), notice: (m) => notices.push(m), timeoutMs: 60, pollMs: 10 });
  q.push({ view: 'nope' }, '#/nope');
  await new Promise((r) => setTimeout(r, 140));
  assert.equal(notices.length, 1); assert.match(notices[0], /#\/nope/);
  assert.equal(q.size(), 0);
});

await t('a newer link replaces a waiting one (hashchange while a plugin loads)', async () => {
  const views = new Set();
  const opened = [];
  const q = createPendingTargets({ isReady: (v) => views.has(v), open: (p) => opened.push(p.view), notice: () => {}, timeoutMs: 400, pollMs: 10 });
  q.push({ view: 'a' }, '#/a'); q.push({ view: 'b' }, '#/b');
  views.add('a'); views.add('b'); q.poke();
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(opened, ['b']);
});

console.log(`deeplink: ${n} checks passed`);
