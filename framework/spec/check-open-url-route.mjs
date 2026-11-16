#!/usr/bin/env node
/**
 * open-url-route@1 conformance: the route order a page asked for by Amber takes to Brett's screen, shared by the console's
 * wake path, axHub's relay and the AmberX app.
 *   node framework/spec/check-open-url-route.mjs           check
 *   node framework/spec/check-open-url-route.mjs --write   regenerate fixtures/open-url-route.json's expected outputs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../core/open-url-route.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/open-url-route.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CONSOLE = 'https://console.amberxai.com/?axf-cmd=c-1';
const phoneOff = { paired: true, inFront: false, overlay: false, overlayReady: false, notifications: true, fullScreenIntent: true, locked: false };
const IN = {
  // Brett, Nov 16 2026: Chrome in front with the console in it, AmberX in the background without Display over other apps.
  // The console client had gone stale, so nothing could take the command in place; Android dropped the start; a notification went out.
  brettCase: { url: CONSOLE, console: { connected: true, visible: null, origin: 'https://console.amberxai.com', ageMs: 120_000 }, phone: phoneOff, foreground: 'browser' },
  // the same moment with a live console tab on screen: the tab takes it, no phone needed
  consoleOnScreen: { url: CONSOLE, console: { connected: true, visible: true, origin: 'https://console.amberxai.com', ageMs: 3_000 }, phone: phoneOff, foreground: 'browser' },
  // a live tab whose visibility is unknown, but the phone says the browser is in front: counts as on screen
  consoleVisibilityUnknown: { url: CONSOLE, console: { connected: true, visible: null, origin: 'https://console.amberxai.com', ageMs: 3_000 }, phone: phoneOff, foreground: 'browser' },
  // a live tab behind another app: it is not "opened" until something brings it forward
  consoleBehind: { url: CONSOLE, console: { connected: true, visible: false, origin: 'https://console.amberxai.com', ageMs: 3_000 }, phone: { ...phoneOff, overlay: true }, foreground: 'other' },
  // Display over other apps granted (the #454 prompt) and the toolbar up: the overlay opens it full screen
  overlayReady: { url: CONSOLE, phone: { ...phoneOff, overlay: true, overlayReady: true }, foreground: 'other' },
  // Display over other apps granted, toolbar hidden: the exemption lets AmberX start the browser from the background
  overlayGrantedToolbarOff: { url: CONSOLE, phone: { ...phoneOff, overlay: true }, foreground: 'browser' },
  // AmberX itself in front: a direct start is allowed with no exemption
  amberxInFront: { url: CONSOLE, phone: { ...phoneOff, inFront: true }, foreground: 'amberx' },
  // the phone is locked: the full-screen notice opens the page as the screen wakes
  locked: { url: CONSOLE, phone: { ...phoneOff, locked: true }, foreground: 'unknown' },
  // locked but AmberX may not use full-screen notices: a plain notification
  lockedNoFullScreen: { url: CONSOLE, phone: { ...phoneOff, locked: true, fullScreenIntent: false } },
  // notifications off and nothing else possible: no route at all
  nothing: { url: CONSOLE, phone: { ...phoneOff, notifications: false } },
  // no phone paired and no console: nothing
  noPhone: { url: CONSOLE },
  // the caller asks for the browser (AXPP where: "browser"): console tab and overlay are skipped
  whereBrowser: { url: CONSOLE, where: 'browser', console: { connected: true, visible: true, ageMs: 1_000 }, phone: { ...phoneOff, overlay: true, overlayReady: true } },
  // the caller asks for the console tab only, and none is on screen: none, never the phone
  whereConsoleOnly: { url: CONSOLE, where: 'console', console: { connected: false }, phone: { ...phoneOff, overlay: true, overlayReady: true } },
  // the caller asks for the overlay: the console tab is skipped, the overlay first; with it not ready the rest follows
  whereOverlay: { url: CONSOLE, where: 'overlay', console: { connected: true, visible: true, ageMs: 1_000 }, phone: { ...phoneOff, overlay: true } },
  // a connected console on another of Brett's sites cannot take a page for this one
  otherOrigin: { url: 'https://axhub.amberxai.com/approvals', console: { connected: true, visible: true, origin: 'https://console.amberxai.com', ageMs: 1_000 }, phone: phoneOff, foreground: 'browser' },
  // refused addresses plan nothing
  httpUrl: { url: 'http://console.amberxai.com/', phone: phoneOff },
  otherHost: { url: 'https://www.hostinger.com/', phone: phoneOff },
  lookalikeHost: { url: 'https://amberxai.com.evil.example/', phone: phoneOff },
  userInfo: { url: 'https://brett@console.amberxai.com/', phone: phoneOff },
  port: { url: 'https://console.amberxai.com:8443/', phone: phoneOff },
  intentScheme: { url: 'intent://console.amberxai.com/#Intent;end', phone: phoneOff },
  empty: { phone: phoneOff },
  // a wider allowlist (axHub's open_url setting) lets another site through
  allowlisted: { url: 'https://www.hostinger.com/', hosts: ['amberxai.com', 'hostinger.com'], phone: { ...phoneOff, overlay: true } },
  junk: 'not a request',
};
const ATTEMPTS = {
  // the overlay was tried and failed (window gone), the exemption start worked
  overlayFailedDirectOk: { req: IN.overlayReady, attempts: [{ route: 'overlay', ok: false, reason: 'overlay-not-ready' }, { route: 'direct', ok: true }] },
  // every route the plan allowed failed
  allFailed: { req: IN.brettCase, attempts: [{ route: 'notification', ok: false }] },
  // the host stopped after the first success
  consoleOk: { req: IN.consoleOnScreen, attempts: [{ route: 'console-tab', ok: true }] },
  // the console tab did not answer in time, the notification went out
  consoleSilentThenNotified: { req: IN.consoleOnScreen, attempts: [{ route: 'console-tab', ok: false, reason: 'console-stale' }, { route: 'notification', ok: true }] },
  // a refused URL settles to none whatever the host claims
  refused: { req: IN.otherHost, attempts: [{ route: 'direct', ok: true }] },
  // nothing tried yet
  untried: { req: IN.overlayReady, attempts: [] },
};
const PHONE_ANSWERS = {
  overlayOpened: { url: CONSOLE, verb: 'open', browser: 'overlay', opened: true, notified: false, overlay: true, where: 'overlay' },
  overlayNotReady: { url: CONSOLE, verb: 'open', opened: false, notified: false, overlay: false, where: 'overlay' },
  browserStarted: { url: CONSOLE, opened: true, notified: true, overlay: true, where: 'browser' },
  heldBack: { url: CONSOLE, opened: false, notified: true, overlay: false, where: 'browser' },
  nothingPossible: { url: CONSOLE, opened: false, notified: false, overlay: false, where: 'browser' },
  held: { held: true },
  junk: null,
};
const run = () => ({
  plan: Object.fromEntries(Object.entries(IN).map(([k, r]) => [k, R.plan(r)])),
  decide: Object.fromEntries(Object.entries(IN).map(([k, r]) => [k, R.decide(r)])),
  next: Object.fromEntries(Object.entries(IN).map(([k, r]) => [k, R.ROUTES.map((route) => R.next(R.plan(r), route))])),
  settle: Object.fromEntries(Object.entries(ATTEMPTS).map(([k, a]) => [k, R.settle(R.plan(a.req), a.attempts)])),
  message: Object.fromEntries(Object.entries(ATTEMPTS).map(([k, a]) => [k, R.message(R.settle(R.plan(a.req), a.attempts))])),
  fromPhoneAnswer: Object.fromEntries(Object.entries(PHONE_ANSWERS).map(([k, a]) => [k, R.fromPhoneAnswer(a, CONSOLE)])),
  normRequest: { junk: R.normRequest(IN.junk), brettCase: R.normRequest(IN.brettCase), hosts: R.normHosts(['.AmberXai.com.', '', 'amberxai.com', 'Hostinger.COM']) },
  allowedUrl: Object.fromEntries(Object.entries(IN).filter(([, r]) => typeof r === 'object' && r).map(([k, r]) => [k, R.allowedUrl(r.url, r.hosts)])),
  validate: { ok: R.validateRequest(IN.brettCase).errors.map((e) => e.field), bad: R.validateRequest({ url: 'http://x', where: 'nowhere', browser: 'lynx', foreground: 'moon' }).errors.map((e) => e.field), result: R.validateResult({ route: 'notification', opened: true, reason: 'tap-to-open' }).errors.map((e) => e.field) },
});
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: R.SCHEMA, note: 'Generated by framework/spec/check-open-url-route.mjs --write; every port (the console server, axHub\'s relay, the AmberX app) replays `in` and must answer `out`.', in: { requests: IN, attempts: ATTEMPTS, phoneAnswers: PHONE_ANSWERS }, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, { requests: IN, attempts: ATTEMPTS, phoneAnswers: PHONE_ANSWERS }), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

const routesOf = (k) => actual.plan[k].routes.filter((r) => r.try).map((r) => r.route);
const skips = (k) => Object.fromEntries(actual.plan[k].routes.filter((r) => !r.try).map((r) => [r.route, r.reason]));
t('the route order is fixed: console tab, overlay, direct start, full-screen notice, notification', () => assert.deepEqual(R.ROUTES, ['console-tab', 'overlay', 'direct', 'full-screen-intent', 'notification']));
t("Brett's case: a stale console, no overlay permission, unlocked phone → only the notification is left, and that is not opened", () => {
  assert.deepEqual(routesOf('brettCase'), ['notification']);
  assert.deepEqual(skips('brettCase'), { 'console-tab': 'console-stale', overlay: 'overlay-off', direct: 'background-start-blocked', 'full-screen-intent': 'phone-unlocked' });
  assert.deepEqual(actual.decide.brettCase, { route: 'notification', reason: '' });
  const r = R.settle(actual.plan.brettCase, [{ route: 'notification', ok: true }]);
  assert.equal(r.opened, false); assert.equal(r.notified, true); assert.equal(r.reason, 'tap-to-open');
});
t('a console tab on screen takes it first; one with unknown visibility counts when the phone says the browser is in front', () => {
  assert.equal(actual.decide.consoleOnScreen.route, 'console-tab');
  assert.equal(actual.decide.consoleVisibilityUnknown.route, 'console-tab');
  assert.equal(skips('consoleBehind')['console-tab'], 'console-behind'); assert.equal(actual.decide.consoleBehind.route, 'direct');
  assert.equal(skips('otherOrigin')['console-tab'], 'console-other-origin'); assert.equal(skips('noPhone')['console-tab'], 'no-console');
});
t('Display over other apps: toolbar up → overlay; toolbar down → the exemption still allows a direct start', () => {
  assert.equal(actual.decide.overlayReady.route, 'overlay'); assert.deepEqual(routesOf('overlayReady'), ['overlay', 'direct', 'notification']);
  assert.equal(actual.decide.overlayGrantedToolbarOff.route, 'direct'); assert.equal(skips('overlayGrantedToolbarOff').overlay, 'overlay-not-ready');
  assert.equal(actual.decide.amberxInFront.route, 'direct');
});
t('a locked phone opens through the full-screen notice; without that permission it is a plain notification', () => {
  assert.equal(actual.decide.locked.route, 'full-screen-intent'); assert.equal(R.OPENS['full-screen-intent'], true);
  assert.equal(actual.decide.lockedNoFullScreen.route, 'notification'); assert.equal(skips('lockedNoFullScreen')['full-screen-intent'], 'no-full-screen-intent');
});
t('nothing possible: none with the headline reason; no phone and no console: none', () => {
  assert.deepEqual(actual.decide.nothing, { route: 'none', reason: 'nothing-left' }); assert.deepEqual(routesOf('nothing'), []);
  assert.deepEqual(actual.decide.noPhone, { route: 'none', reason: 'nothing-left' }); assert.equal(skips('noPhone').direct, 'no-phone');
});
t('where narrows the list: browser skips the console tab and the overlay, console never reaches the phone, overlay skips the console tab', () => {
  assert.deepEqual(routesOf('whereBrowser'), ['direct', 'notification']); assert.equal(skips('whereBrowser')['console-tab'], 'asked-elsewhere'); assert.equal(skips('whereBrowser').overlay, 'asked-elsewhere');
  assert.deepEqual(routesOf('whereConsoleOnly'), []); assert.equal(skips('whereConsoleOnly').overlay, 'console-only'); assert.equal(skips('whereConsoleOnly')['console-tab'], 'no-console');
  assert.deepEqual(routesOf('whereOverlay'), ['direct', 'notification']); assert.equal(skips('whereOverlay')['console-tab'], 'asked-elsewhere'); assert.equal(skips('whereOverlay').overlay, 'overlay-not-ready');
});
t('refused addresses: http, another host, a look-alike host, user info, a port, intent:, empty → url-refused and no routes', () => {
  for (const k of ['httpUrl', 'otherHost', 'lookalikeHost', 'userInfo', 'port', 'intentScheme', 'empty', 'junk']) { assert.equal(actual.plan[k].ok, false, k); assert.equal(actual.plan[k].reason, 'url-refused', k); assert.deepEqual(routesOf(k), [], k); assert.deepEqual(actual.decide[k], { route: 'none', reason: 'url-refused' }, k); }
  assert.equal(actual.allowedUrl.otherHost.detail, 'AmberX only opens Brett\'s own sites (amberxai.com), not "www.hostinger.com"');
  assert.equal(actual.allowedUrl.allowlisted.ok, true); assert.equal(actual.decide.allowlisted.route, 'direct');
  assert.deepEqual(actual.normRequest.hosts, ['amberxai.com', 'hostinger.com']);
});
t('the URL is normalised and the plan carries it', () => { assert.equal(R.plan({ url: 'https://Console.AmberXai.com/?axf-cmd=c-1', phone: phoneOff }).url, CONSOLE); assert.equal(actual.plan.brettCase.url, CONSOLE); });
t('next walks the plan: after a failed route the next one allowed, none at the end', () => {
  assert.deepEqual(actual.next.overlayReady, ['overlay', 'direct', 'notification', 'notification', 'none']);
  assert.deepEqual(actual.next.brettCase, ['notification', 'notification', 'notification', 'notification', 'none']);
  assert.equal(R.next(actual.plan.overlayReady, 'nope'), 'overlay', 'an unknown route starts from the top');
});
t('settle: the first success decides, failures and skips are listed, a refused URL never settles as opened', () => {
  const s = actual.settle;
  assert.equal(s.overlayFailedDirectOk.route, 'direct'); assert.equal(s.overlayFailedDirectOk.opened, true); assert.equal(s.overlayFailedDirectOk.reason, 'direct-start');
  assert.deepEqual(s.overlayFailedDirectOk.tried.map((x) => `${x.route}:${x.outcome}`), ['console-tab:skipped', 'overlay:failed', 'direct:ok']);
  assert.deepEqual({ route: s.allFailed.route, opened: s.allFailed.opened, reason: s.allFailed.reason }, { route: 'none', opened: false, reason: 'attempt-failed' });
  assert.equal(s.consoleOk.route, 'console-tab'); assert.equal(s.consoleOk.tried.length, 1);
  assert.equal(s.consoleSilentThenNotified.route, 'notification'); assert.equal(s.consoleSilentThenNotified.opened, false); assert.equal(s.consoleSilentThenNotified.tried[0].reason, 'console-stale');
  assert.deepEqual({ route: s.refused.route, opened: s.refused.opened, reason: s.refused.reason }, { route: 'none', opened: false, reason: 'url-refused' });
  assert.equal(s.untried.route, 'none'); assert.equal(s.untried.reason, 'nothing-left'); assert.equal(s.untried.tried.find((x) => x.route === 'overlay').outcome, 'not-tried');
  for (const r of Object.values(s)) assert.ok(R.validateResult(r).ok, r.route);
});
t("the phone's AXPP answer reads as the same result", () => {
  const f = actual.fromPhoneAnswer;
  assert.deepEqual([f.overlayOpened.route, f.overlayOpened.opened], ['overlay', true]);
  assert.deepEqual([f.overlayNotReady.route, f.overlayNotReady.reason], ['none', 'overlay-not-ready']);
  assert.deepEqual([f.browserStarted.route, f.browserStarted.opened, f.browserStarted.notified], ['direct', true, false]);
  assert.deepEqual([f.heldBack.route, f.heldBack.opened, f.heldBack.notified, f.heldBack.tried[0].reason], ['notification', false, true, 'background-start-blocked']);
  assert.deepEqual([f.nothingPossible.route, f.nothingPossible.reason], ['none', 'notifications-off']);
  assert.deepEqual([f.held.route, f.held.reason], ['none', 'attempt-failed']);
  assert.deepEqual([f.junk.route, f.junk.url], ['none', CONSOLE]);
  for (const r of Object.values(f)) assert.ok(R.validateResult(r).ok, r.route);
});
t('messages are plain words', () => {
  assert.equal(actual.message.overlayFailedDirectOk, 'AmberX started the browser on the page');
  assert.match(actual.message.allFailed, /^The page did not open: /); assert.match(actual.message.allFailed, /Display over other apps is off/);
  assert.equal(actual.message.consoleSilentThenNotified, "Android held the browser back: AmberX's notification opens the page with one tap");
});
t('validation names the bad fields; a notification can never be "opened"', () => { assert.deepEqual(actual.validate.ok, []); assert.deepEqual(actual.validate.bad, ['url', 'where', 'browser', 'foreground']); assert.deepEqual(actual.validate.result, ['opened']); });
t('every reason code has words, every route a success reason, and the registry lists them all', () => {
  for (const r of R.ROUTES) assert.ok(R.REASONS[R.successReason(r)], r);
  for (const [k, v] of Object.entries(R.REASONS)) assert.ok(typeof v === 'string' && v.length > 10, k);
  assert.deepEqual(Object.keys(R.REGISTRY), ['schema', 'request', 'plan', 'result', 'version', 'routes', 'opens', 'where', 'browsers', 'foregrounds', 'defaultHosts', 'maxUrl', 'consoleStaleMs', 'reasons']);
});
t('schemas/open-url-route.json + schemas/json/open-url-*.schema.json are current (run axf schemas)', () => { assert.ok(same(JSON.parse(rd('framework/schemas/open-url-route.json')), R.REGISTRY)); for (const [name, s] of Object.entries(R.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name); });
t('PORTING.md indexes the contract and records the deferred twins', () => { const p = rd('framework/spec/PORTING.md'); assert.match(p, /\| Open-url route \(`open-url-route@1`/); assert.match(p, /## Deferred: open-url route@1/); });
console.log(`check-open-url-route: ${n} checks passed`);
