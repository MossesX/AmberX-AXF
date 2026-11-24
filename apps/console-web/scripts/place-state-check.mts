/**
 * Console place checks (build fix-refreshing-console-jumps-back): save / read round trip, age and frame checks,
 * deep-link precedence, merging, the voice phrases and the CLI mapping for `axf console place`.
 *
 *   npx -y tsx apps/console-web/scripts/place-state-check.mts
 */
import assert from 'node:assert/strict';
import {
  belongsToView, clearPlace, emptyPlace, hasDeepLink, mergePlace, parsePlace, placeToRestore, readPlace, writePlace,
  PLACE_FRAME, PLACE_MAX_AGE_MS, PLACE_STORAGE_KEY, type ConsolePlace,
} from '../src/place/placeCore.ts';
import { voiceIntent, voiceReply, PLACE_RESTORE_ADDRESS } from '../../../framework/core/engines/console-control-voice.mjs';
import { toRequest } from '../../../framework/cli/console-control.mjs';

let n = 0;
const check = (name: string, fn: () => void) => { fn(); n++; console.log(`ok  ${name}`); };

// an in-memory sessionStorage
const mem = new Map<string, string>();
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(), key: (i: number) => Array.from(mem.keys())[i] ?? null, get length() { return mem.size; },
} as Storage;

const place: ConsolePlace = {
  $axf: PLACE_FRAME, at: new Date().toISOString(), by: 'change', view: 'view:build-orchestrator',
  tabs: { 'view:build-orchestrator/tab:bo.tabs': 'queue', 'view:build-orchestrator/tab:bo.tabs/subtab:bo.queue': 'running' },
  selection: { 'view:build-orchestrator/grid:builds': 'fix-refreshing-console-jumps-back' },
  scroll: { 'scroll:main': 1840, 'scroll:log': 320 },
};

check('save → read round trip', () => {
  writePlace(place);
  assert.ok(mem.has(PLACE_STORAGE_KEY));
  assert.deepEqual(readPlace(), place);
  clearPlace();
  assert.equal(readPlace(), null);
});

check('malformed, foreign or stale places are ignored', () => {
  assert.equal(parsePlace(null), null);
  assert.equal(parsePlace('{not json'), null);
  assert.equal(parsePlace(JSON.stringify({ ...place, $axf: 'other@1' })), null);
  assert.equal(parsePlace(JSON.stringify({ ...place, view: 'home' })), null);
  const old = new Date(Date.now() - PLACE_MAX_AGE_MS - 1000).toISOString();
  assert.equal(parsePlace(JSON.stringify({ ...place, at: old })), null);
  // bad entries are dropped, good ones kept
  const p = parsePlace(JSON.stringify({ ...place, scroll: { 'scroll:main': 10, 'scroll:x': -4, 'scroll:y': 'far' }, tabs: { 'tab:a': 'b', 'tab:c': 7 } }))!;
  assert.deepEqual(p.scroll, { 'scroll:main': 10 });
  assert.deepEqual(p.tabs, { 'tab:a': 'b' });
});

check('deep links win over the saved place', () => {
  const base = 'https://console.example/';
  assert.equal(hasDeepLink(base), false);
  assert.deepEqual(placeToRestore(place, base), place);
  for (const q of ['?axf-open=view:plan', '?axf-cmd=search&q=x', '?axf-ref=abc']) {
    assert.equal(hasDeepLink(base + q), true, q);
    assert.equal(placeToRestore(place, base + q), null, q);
  }
  // a hard refresh's cache buster is not a deep link
  assert.deepEqual(placeToRestore(place, `${base}?axf-refresh=lx9`), place);
  // a view this console doesn't have is not restored when the list is known
  assert.equal(placeToRestore(place, base, ['home', 'plan']), null);
  assert.deepEqual(placeToRestore(place, base, ['home', 'build-orchestrator']), place);
  assert.equal(placeToRestore(null, base), null);
});

check('merge: same view keeps scroll and selection, a new view starts fresh, tabs accumulate', () => {
  const at = new Date().toISOString();
  const same = mergePlace(place, { at, by: 'change', view: place.view, tabs: { 'tab:other': 'x' }, selection: {}, scroll: { 'scroll:main': 10 } });
  assert.equal(same.scroll['scroll:main'], 10);
  assert.equal(same.scroll['scroll:log'], 320);
  assert.equal(same.selection['view:build-orchestrator/grid:builds'], 'fix-refreshing-console-jumps-back');
  assert.equal(same.tabs['tab:other'], 'x');
  const moved = mergePlace(place, { at, by: 'change', view: 'view:plan', tabs: {}, selection: {}, scroll: { 'scroll:main': 0 } });
  assert.deepEqual(moved.scroll, { 'scroll:main': 0 });
  assert.deepEqual(moved.selection, {});
  assert.equal(moved.tabs['view:build-orchestrator/tab:bo.tabs'], 'queue');
  assert.deepEqual(emptyPlace('plan').view, 'view:plan');
});

check('only the saved view\'s rows are reapplied', () => {
  assert.equal(belongsToView('view:build-orchestrator/tab:bo.tabs', 'view:build-orchestrator'), true);
  assert.equal(belongsToView('view:plan/tab:plan.tabs', 'view:build-orchestrator'), false);
  assert.equal(belongsToView('scroll:main', 'view:plan'), true);
});

check('voice: "put me back" presses console.place.restore', () => {
  for (const p of ['put me back', 'Amber, take me back to where I was please', 'restore my place', 'go back to where I left off', 'where was I']) {
    assert.deepEqual(voiceIntent(p), { verb: 'press', address: PLACE_RESTORE_ADDRESS }, p);
  }
  assert.equal(voiceReply({ verb: 'press', address: PLACE_RESTORE_ADDRESS }, { ok: true, address: PLACE_RESTORE_ADDRESS }), 'Back where you were.');
  // the screen rules still answer their own phrases
  assert.equal(voiceIntent('go to plan studio')?.verb, 'open');
});

check('CLI: axf console place get | restore is the REST call', () => {
  assert.deepEqual(toRequest(['place']), { method: 'GET', path: '/state?address=panel%3Aconsole-place' });
  assert.deepEqual(toRequest(['place', 'get']), { method: 'GET', path: '/state?address=panel%3Aconsole-place' });
  assert.deepEqual(toRequest(['place', 'restore']), { method: 'POST', path: '/do', body: { verb: 'press', address: PLACE_RESTORE_ADDRESS, by: 'cli' } });
  assert.throws(() => toRequest(['place', 'wipe']), /usage/);
});

console.log(`\n${n} place checks passed`);
