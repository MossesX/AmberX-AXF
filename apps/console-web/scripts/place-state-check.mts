/**
 * Console place checks (build fix-refreshing-console-jumps-back): the store that keeps the screen, tabs, selection and
 * scroll over a reload (src/place/placeState.ts), putting the view and tabs back on load with a deep link winning
 * (`restorePlace`), the save right before a pushed reload (src/place/keepPlace.ts), the pull-down rules
 * (src/place/pullRefresh.ts) and the leftover scroll locks cleared on load (src/place/scrollGuard.ts).
 * No browser: storage, the app shell and the document are small fakes. The browser run is scripts/place-refresh.e2e.mjs.
 *
 *   npx -y tsx apps/console-web/scripts/place-state-check.mts
 */
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  PLACE_KEY, PLACE_MAX_ENTRIES, PLACE_MAX_SELECTION, createPlaceStore, isDeepLink, readPlace, restorePlace, rowAddress, tabAddress, viewAddress, viewIdOf,
  type PlaceHost, type PlaceStorage, type PlaceStore,
} from '../src/place/placeState.ts';
import { writeLivePlace } from '../src/place/keepPlace.ts';
import { PULL_SAVE_DISTANCE, isPull, pullReachesRoot } from '../src/place/pullRefresh.ts';
import { clearScrollLocks } from '../src/place/scrollGuard.ts';

let n = 0;
const t = async (name: string, f: () => void | Promise<void>) => { await f(); n++; console.log(`ok ${n} ${name}`); };

/** sessionStorage as a map, counting writes. */
function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const storage: PlaceStorage & { writes: number; raw(): string | null } = {
    writes: 0,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { storage.writes++; data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
    raw: () => data.get(PLACE_KEY) ?? null,
  };
  return storage;
}

/** A store with a long debounce: nothing is written unless the test flushes (or the test is about the debounce). */
const storeOn = (storage: PlaceStorage | null, delay = 60_000): PlaceStore => createPlaceStore({ storage, delay, now: () => 1000 });

/** The app shell as `restorePlace` sees it: a view, tab rows that render when the test says so, and what was asked of it. */
function fakeHost(startView = 'home') {
  let view = startView;
  const rows: Record<string, { value: string; tabs: string[] }> = {};
  const viewSubs = new Set<() => void>(), rowSubs = new Set<() => void>();
  const shown: string[] = [], switched: string[] = [];
  const host: PlaceHost = {
    view: () => view,
    show: (v) => { shown.push(v); view = v; },
    onView: (fn) => { viewSubs.add(fn); return () => { viewSubs.delete(fn); }; },
    rows: () => Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.value])),
    setTab: (row, value) => {
      const r = rows[row];
      if (!r || !r.tabs.includes(value)) return false;
      r.value = value; switched.push(`${row}=${value}`);
      return true;
    },
    onRows: (fn) => { rowSubs.add(fn); return () => { rowSubs.delete(fn); }; },
  };
  return {
    host, shown, switched,
    /** A tab row renders (or its tabs change). */
    render(row: string, value: string, tabs: string[]) { rows[row] = { value, tabs }; for (const fn of [...rowSubs]) fn(); },
    /** The person (or a link handler) opens another view. */
    go(v: string) { view = v; for (const k of Object.keys(rows)) delete rows[k]; for (const fn of [...viewSubs]) fn(); },
    /** The person picks a tab. */
    pick(row: string, value: string) { rows[row]!.value = value; for (const fn of [...rowSubs]) fn(); },
    subs: () => viewSubs.size + rowSubs.size,
  };
}

/** One tick past the `setTimeout(0)` the follow-up records on. */
const tick = () => sleep(5);

/* ---------------- addresses ---------------- */

await t('addresses: view, row and tab addresses are console-control@1', () => {
  assert.equal(viewAddress('builds'), 'view:builds');
  assert.equal(viewAddress('view:builds'), 'view:builds');
  assert.equal(viewAddress(''), null);
  assert.equal(viewAddress(null), null);
  assert.equal(viewIdOf('view:builds/tab:builds.tabs'), 'builds');
  assert.equal(viewIdOf('tab:builds.tabs'), null);
  assert.equal(viewIdOf('not an address'), null);
  assert.equal(viewIdOf(null), null);
  assert.equal(rowAddress('row:b1'), 'row:b1');
  assert.equal(viewIdOf(`view:x/grid:g/${rowAddress('b1')}`), 'x', 'a bare id becomes a usable address part');
  assert.equal(tabAddress('view:builds/tab:builds.tabs', 'queue'), 'view:builds/tab:builds.tabs=queue');
  assert.equal(tabAddress('view:a/tab:t', 'a/b%'), 'view:a/tab:t=a%2Fb%25');
});

/* ---------------- save ---------------- */

await t('save: view, tabs, selection and scroll are filed under the view and written on flush', () => {
  const storage = fakeStorage();
  const s = storeOn(storage);
  assert.equal(s.view(), null);
  s.setView('builds');
  s.setTab('tab:builds.tabs', 'queue');
  s.setSelection('grid:queue', ['b7', 'row:b9']);
  s.setScroll('scroll:main', 640.4);
  s.setScroll('scroll:log', 12, 30);
  assert.equal(storage.writes, 0, 'nothing is written before the debounce or a flush');
  s.flush();
  assert.equal(storage.writes, 1);
  const saved = JSON.parse(storage.raw()!);
  assert.equal(saved.v, 1);
  assert.equal(saved.at, 1000);
  assert.equal(saved.view, 'view:builds');
  assert.deepEqual(saved.tabs, { 'view:builds/tab:builds.tabs': 'queue' });
  assert.deepEqual(saved.selection, { 'view:builds/grid:queue': [rowAddress('b7'), 'row:b9'] });
  assert.deepEqual(saved.scroll, { 'view:builds/scroll:main': { top: 640, left: 0 }, 'view:builds/scroll:log': { top: 12, left: 30 } });
  s.flush();
  assert.equal(storage.writes, 1, 'a flush with nothing new writes nothing');
});

await t('save: a full address is kept as given, whatever the current view is', () => {
  const s = storeOn(fakeStorage());
  s.setView('home');
  s.setTab('view:tracker/tab:tracker.tabs', 'apps');
  assert.equal(s.tab('view:tracker/tab:tracker.tabs'), 'apps');
  assert.equal(s.tab('tab:tracker.tabs'), null, 'not filed under the current view');
  assert.deepEqual(Object.keys(s.get().tabs), ['view:tracker/tab:tracker.tabs']);
});

await t('save: the debounce writes by itself, once for a burst of changes', async () => {
  const storage = fakeStorage();
  const s = createPlaceStore({ storage, delay: 10 });
  s.setView('builds');
  s.setTab('tab:builds.tabs', 'queue');
  s.setScroll('scroll:main', 300);
  assert.equal(storage.writes, 0);
  await sleep(40);
  assert.equal(storage.writes, 1);
  assert.equal(JSON.parse(storage.raw()!).scroll['view:builds/scroll:main'].top, 300);
});

await t('save: each view keeps its own scroll, and a container back at the start is no longer listed', () => {
  const s = storeOn(fakeStorage());
  s.setView('builds'); s.setScroll('scroll:main', 500);
  s.setView('tracker'); s.setScroll('scroll:main', 90);
  assert.deepEqual(s.scroll(), { top: 90, left: 0 });
  assert.deepEqual(s.scroll('view:builds/scroll:main'), { top: 500, left: 0 });
  s.setScroll('scroll:main', 0);
  assert.equal(s.scroll(), null);
  assert.deepEqual(Object.keys(s.get().scroll), ['view:builds/scroll:main']);
  s.setScroll('scroll:main', -20); s.setScroll('scroll:main', Number.NaN);
  assert.equal(s.scroll(), null, 'a negative or broken offset is the start');
});

await t('save: forgetting a tab or a selection removes its entry', () => {
  const s = storeOn(fakeStorage());
  s.setView('builds');
  s.setTab('tab:builds.tabs', 'queue'); s.setSelection('grid:queue', 'b1');
  assert.deepEqual(s.selection('grid:queue'), [rowAddress('b1')]);
  s.setTab('tab:builds.tabs', null); s.setSelection('grid:queue', []);
  assert.equal(s.tab('tab:builds.tabs'), null);
  assert.deepEqual(s.selection('grid:queue'), []);
  assert.deepEqual(s.get().tabs, {}); assert.deepEqual(s.get().selection, {});
  s.setSelection('grid:queue', 'b1'); s.setSelection('grid:queue', null);
  assert.deepEqual(s.get().selection, {});
});

await t('save: subscribers hear every change, and none when nothing changed', () => {
  const s = storeOn(fakeStorage());
  let calls = 0;
  const off = s.subscribe(() => { calls++; });
  s.setView('builds'); s.setView('view:builds');
  s.setTab('tab:a', 'x'); s.setTab('tab:a', 'x');
  s.setSelection('grid:g', ['r1']); s.setSelection('grid:g', ['r1']);
  s.setScroll('scroll:main', 10); s.setScroll('scroll:main', 10.2);
  assert.equal(calls, 4);
  off();
  s.setView('tracker');
  assert.equal(calls, 4);
});

await t('save: get() hands out a copy', () => {
  const s = storeOn(fakeStorage());
  s.setView('builds'); s.setTab('tab:a', 'x');
  const copy = s.get();
  copy.view = 'view:other'; copy.tabs['view:builds/tab:a'] = 'y';
  assert.equal(s.view(), 'view:builds');
  assert.equal(s.tab('tab:a'), 'x');
  const sel = s.selection('grid:none'); sel.push('row:z');
  assert.deepEqual(s.selection('grid:none'), []);
});

await t('save: the maps are capped, the least recently changed go first', () => {
  const s = storeOn(fakeStorage());
  s.setView('builds');
  for (let i = 0; i < PLACE_MAX_ENTRIES + 5; i++) s.setTab(`tab:t${i}`, 'a');
  s.setTab('tab:t5', 'b'); // changed again: now the newest
  s.setTab('tab:extra', 'a');
  const keys = Object.keys(s.get().tabs);
  assert.equal(keys.length, PLACE_MAX_ENTRIES);
  assert.equal(s.tab('tab:t0'), null);
  assert.equal(s.tab('tab:t6'), null, 'the oldest left');
  assert.equal(s.tab('tab:t5'), 'b', 'the one changed again stayed');
  assert.equal(s.tab('tab:extra'), 'a');
  s.setSelection('grid:big', Array.from({ length: PLACE_MAX_SELECTION + 50 }, (_, i) => `r${i}`));
  assert.equal(s.selection('grid:big').length, PLACE_MAX_SELECTION);
});

await t('save: storage that is missing, blocked or full never throws; the place lasts for the page', () => {
  const none = storeOn(null);
  none.setView('builds'); none.setScroll('scroll:main', 40); none.flush();
  assert.deepEqual(none.scroll(), { top: 40, left: 0 });
  const blocked = storeOn({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } });
  blocked.setView('builds'); blocked.setTab('tab:a', 'x'); blocked.flush();
  assert.equal(blocked.tab('tab:a'), 'x');
  blocked.clear();
  assert.equal(blocked.view(), null);
});

/* ---------------- restore (the store after a reload) ---------------- */

await t('restore: a new page reads back exactly what the last one saved', () => {
  const storage = fakeStorage();
  const before = storeOn(storage);
  before.setView('builds');
  before.setTab('tab:builds.tabs', 'queue');
  before.setTab('view:builds/tab:builds.tabs=queue/subtab:queue.filter', 'running');
  before.setSelection('grid:queue', 'b7');
  before.setScroll('scroll:main', 640);
  before.setScroll('scroll:log', 0, 25);
  before.flush();
  const after = storeOn(storage); // the reload: a fresh module on the same sessionStorage
  assert.deepEqual(after.get(), before.get());
  assert.equal(after.view(), 'view:builds');
  assert.equal(after.tab('tab:builds.tabs'), 'queue');
  assert.deepEqual(after.selection('grid:queue'), [rowAddress('b7')]);
  assert.deepEqual(after.scroll(), { top: 640, left: 0 });
  assert.deepEqual(after.scroll('scroll:log'), { top: 0, left: 25 });
});

await t('restore: a change that was never flushed is not there after the reload', () => {
  const storage = fakeStorage();
  const before = storeOn(storage);
  before.setView('builds'); before.flush();
  before.setScroll('scroll:main', 900); // the page went before the debounce: pagehide / savePlaceNow exist for this
  assert.equal(storeOn(storage).scroll(), null);
  before.flush();
  assert.deepEqual(storeOn(storage).scroll(), { top: 900, left: 0 });
});

await t('restore: malformed or foreign stored values are dropped, never thrown', () => {
  const empty = { v: 1, at: 0, view: null, tabs: {}, selection: {}, scroll: {} };
  for (const raw of [null, undefined, '', 'not json', '[]', '42', '{"v":2,"view":"view:builds"}', 7, []]) assert.deepEqual(readPlace(raw), empty, String(raw));
  const p = readPlace(JSON.stringify({
    v: 1, at: 'yesterday', view: 'builds',
    tabs: { 'view:a/tab:t': 'x', 'view:a/tab:u': 3, 'view:a/tab:w': null },
    selection: { 'view:a/grid:g': ['row:1', '', 5, 'row:2'], 'view:a/grid:h': 'row:1', 'view:a/grid:i': [] },
    scroll: { 'view:a/scroll:main': { top: '10', left: 4.6 }, 'view:a/scroll:x': { top: -5 }, 'view:a/scroll:y': 12, 'view:a/scroll:z': { top: 33.4 } },
  }));
  assert.equal(p.at, 0);
  assert.equal(p.view, null, 'a view that is not an address is not a place');
  assert.deepEqual(p.tabs, { 'view:a/tab:t': 'x' });
  assert.deepEqual(p.selection, { 'view:a/grid:g': ['row:1', 'row:2'] });
  assert.deepEqual(p.scroll, { 'view:a/scroll:main': { top: 0, left: 5 }, 'view:a/scroll:z': { top: 33, left: 0 } });
  const s = storeOn(fakeStorage({ [PLACE_KEY]: '{"v":1,"view":' }));
  assert.equal(s.view(), null, 'a store on a broken value starts empty');
});

await t('restore: clear forgets everything, here and in storage', () => {
  const storage = fakeStorage();
  const s = storeOn(storage);
  s.setView('builds'); s.setScroll('scroll:main', 50); s.flush();
  s.setTab('tab:a', 'x'); // waiting for its debounce
  s.clear();
  assert.equal(storage.raw(), null);
  assert.equal(s.view(), null);
  s.flush();
  assert.equal(storage.raw(), null, 'the change that was waiting is not written after a clear');
  assert.equal(storeOn(storage).view(), null);
});

await t('restore: two console tabs keep their own place (one store per storage)', () => {
  const a = fakeStorage(), b = fakeStorage();
  const sa = storeOn(a), sb = storeOn(b);
  sa.setView('builds'); sa.flush();
  sb.setView('tracker'); sb.flush();
  assert.equal(storeOn(a).view(), 'view:builds');
  assert.equal(storeOn(b).view(), 'view:tracker');
});

/* ---------------- deep links ---------------- */

await t('deep link: a hash route, ?axf-open= and ?axf-ref= name a place of their own; nothing else does', () => {
  for (const href of ['https://c.example/#/approvals/42', 'https://c.example/?axf-open=builds', 'https://c.example/?x=1&axf-ref=abc', '/#/x', '?axf-open=settings']) assert.equal(isDeepLink(href), true, href);
  for (const href of ['https://c.example/', 'https://c.example/#', 'https://c.example/?axf-open=', 'https://c.example/?axf-refresh=mabc12', 'https://c.example/?axf-embed=axhub', '', null, undefined]) assert.equal(isDeepLink(href), false, String(href));
});

/** A store that already holds a place, as a reload finds it. */
function savedPlace(): PlaceStore {
  const storage = fakeStorage();
  const s = storeOn(storage);
  s.setView('builds');
  s.setTab('tab:builds.tabs', 'queue');
  s.setTab('view:tracker/tab:tracker.tabs', 'apps');
  s.setScroll('scroll:main', 640);
  s.flush();
  return storeOn(storage);
}

await t('restore on load: the saved view is opened at once, before anything renders', () => {
  const store = savedPlace(), shell = fakeHost('home');
  const r = restorePlace(store, shell.host, { href: 'https://c.example/' });
  assert.deepEqual(shell.shown, ['builds']);
  assert.equal(r.view, 'builds');
  assert.equal(r.deepLink, false);
  assert.deepEqual(r.pending(), { 'view:builds/tab:builds.tabs': 'queue' }, 'only the tabs of the view that was put back wait');
});

await t('restore on load: the one-time hard refresh value in the address is not a deep link', () => {
  const store = savedPlace(), shell = fakeHost('home');
  const r = restorePlace(store, shell.host, { href: 'https://c.example/?axf-refresh=mabc12' });
  assert.equal(r.view, 'builds');
  assert.equal(r.deepLink, false);
});

await t('restore on load: nothing saved leaves the start view alone', () => {
  const shell = fakeHost('home');
  const r = restorePlace(storeOn(fakeStorage()), shell.host, { href: 'https://c.example/' });
  assert.deepEqual(shell.shown, []);
  assert.equal(r.view, null);
  assert.deepEqual(r.pending(), {});
});

await t('restore on load: already on the saved view opens nothing, its tabs still come back', () => {
  const store = savedPlace(), shell = fakeHost('builds');
  const r = restorePlace(store, shell.host, { href: 'https://c.example/' });
  assert.deepEqual(shell.shown, []);
  assert.equal(r.view, 'builds');
  assert.deepEqual(Object.keys(r.pending()), ['view:builds/tab:builds.tabs']);
});

await t('restore on load: a view the shell will not open here is left alone, with no tabs waiting', () => {
  const store = savedPlace(), shell = fakeHost('home');
  shell.host.show = () => { /* taken by the host: not opened */ };
  const r = restorePlace(store, shell.host, { href: 'https://c.example/' });
  assert.equal(r.view, null);
  assert.deepEqual(r.pending(), {});
});

await t('restore on load: a saved tab is switched when its row renders, and a row already there before install returns', async () => {
  const store = savedPlace(), shell = fakeHost('home');
  const r = restorePlace(store, shell.host, { href: 'https://c.example/' });
  shell.render('view:builds/tab:builds.tabs', 'board', ['board', 'queue']); // rendered with the first paint
  const off = r.install();
  assert.deepEqual(shell.switched, ['view:builds/tab:builds.tabs=queue'], 'switched inside install (a layout effect: before the paint)');
  assert.deepEqual(r.pending(), {});
  await tick();
  assert.equal(store.tab('view:builds/tab:builds.tabs'), 'queue');
  assert.equal(store.view(), 'view:builds');
  off();
  assert.equal(shell.subs(), 0, 'uninstall lets go of the shell');
});

await t('restore on load: a row that renders late, or whose tab arrives late, keeps waiting and never loses the saved tab', async () => {
  const store = savedPlace(), shell = fakeHost('home');
  const r = restorePlace(store, shell.host, { href: 'https://c.example/' });
  const off = r.install();
  await tick();
  assert.deepEqual(shell.switched, []);
  assert.equal(store.tab('view:builds/tab:builds.tabs'), 'queue');
  shell.render('view:builds/tab:builds.tabs', 'board', ['board']); // the row is there, its Queue tab still loading
  await tick();
  assert.deepEqual(Object.keys(r.pending()), ['view:builds/tab:builds.tabs']);
  assert.equal(store.tab('view:builds/tab:builds.tabs'), 'queue', 'the default tab on screen does not replace the saved one while it waits');
  shell.render('view:builds/tab:builds.tabs', 'board', ['board', 'queue']);
  assert.deepEqual(shell.switched, ['view:builds/tab:builds.tabs=queue']);
  assert.deepEqual(r.pending(), {});
  off();
});

await t('restore on load: a row already on its saved tab is not switched again', () => {
  const store = savedPlace(), shell = fakeHost('home');
  const r = restorePlace(store, shell.host, { href: 'https://c.example/' });
  shell.render('view:builds/tab:builds.tabs', 'queue', ['board', 'queue']);
  const off = r.install();
  assert.deepEqual(shell.switched, []);
  assert.deepEqual(r.pending(), {});
  off();
});

await t('restore on load: a tab that never arrives is given up on, and the tab on screen becomes the place', async () => {
  const store = savedPlace(), shell = fakeHost('home');
  const r = restorePlace(store, shell.host, { href: 'https://c.example/', tabWait: 20 });
  const off = r.install();
  shell.render('view:builds/tab:builds.tabs', 'board', ['board']);
  await sleep(50);
  assert.deepEqual(r.pending(), {});
  shell.render('view:builds/tab:builds.tabs', 'board', ['board', 'queue']);
  await tick();
  assert.deepEqual(shell.switched, [], 'nothing moves a tab after the wait is over');
  assert.equal(store.tab('view:builds/tab:builds.tabs'), 'board');
  off();
});

await t('restore on load: leaving the restored view drops its waiting tabs', async () => {
  const store = savedPlace(), shell = fakeHost('home');
  const r = restorePlace(store, shell.host, { href: 'https://c.example/' });
  const off = r.install();
  shell.go('tracker');
  assert.deepEqual(r.pending(), {});
  assert.equal(store.view(), 'view:tracker', 'the view is saved the moment it changes');
  shell.go('builds');
  shell.render('view:builds/tab:builds.tabs', 'board', ['board', 'queue']);
  await tick();
  assert.deepEqual(shell.switched, [], 'coming back later starts where the row starts');
  off();
});

await t('follow: the open view and the tab the person picks become the saved place', async () => {
  const storage = fakeStorage();
  const store = storeOn(storage), shell = fakeHost('home');
  const off = restorePlace(store, shell.host, { href: 'https://c.example/' }).install();
  await tick();
  assert.equal(store.view(), 'view:home');
  shell.go('tracker');
  shell.render('view:tracker/tab:tracker.tabs', 'foundations', ['foundations', 'apps']);
  shell.render('tab:chrome.tabs', 'one', ['one', 'two']); // a row outside any view (chrome, a dialog)
  await tick();
  assert.equal(store.tab('view:tracker/tab:tracker.tabs'), 'foundations');
  shell.pick('view:tracker/tab:tracker.tabs', 'apps');
  await tick();
  store.flush();
  const next = storeOn(storage);
  assert.equal(next.view(), 'view:tracker');
  assert.equal(next.tab('view:tracker/tab:tracker.tabs'), 'apps');
  assert.deepEqual(Object.keys(next.get().tabs), ['view:tracker/tab:tracker.tabs'], 'a row that belongs to no view is not part of the place');
  off();
});

await t('deep link: the link wins; the saved place is left alone and nothing saved is put back', async () => {
  for (const href of ['https://c.example/#/approvals/42', 'https://c.example/?axf-open=tracker', 'https://c.example/?axf-ref=abc']) {
    const store = savedPlace(), shell = fakeHost('home');
    const r = restorePlace(store, shell.host, { href });
    assert.deepEqual(shell.shown, [], href);
    assert.equal(r.view, null, href);
    assert.equal(r.deepLink, true, href);
    assert.deepEqual(r.pending(), {}, href);
    assert.equal(store.view(), 'view:builds', `${href}: reading the link changes nothing saved`);
    const off = r.install();
    shell.render('view:builds/tab:builds.tabs', 'board', ['board', 'queue']);
    await tick();
    assert.deepEqual(shell.switched, [], `${href}: no saved tab is switched under a link`);
    off();
  }
});

await t('deep link: where the link lands becomes the saved place, so the next plain reload stays there', async () => {
  const storage = fakeStorage();
  const seed = storeOn(storage);
  seed.setView('builds'); seed.setTab('tab:builds.tabs', 'queue'); seed.flush();

  const store = storeOn(storage), shell = fakeHost('home');
  const off = restorePlace(store, shell.host, { href: 'https://c.example/?axf-open=tracker' }).install();
  shell.go('tracker'); // the link's own handler opens its target
  shell.render('view:tracker/tab:tracker.tabs', 'apps', ['foundations', 'apps']);
  await tick();
  store.flush();
  off();

  const reloaded = storeOn(storage), shell2 = fakeHost('home');
  const r = restorePlace(reloaded, shell2.host, { href: 'https://c.example/' }); // the handler took the link off the address
  assert.deepEqual(shell2.shown, ['tracker']);
  assert.equal(r.view, 'tracker');
  assert.deepEqual(r.pending(), { 'view:tracker/tab:tracker.tabs': 'apps' });
  assert.equal(reloaded.tab('view:builds/tab:builds.tabs'), 'queue', 'the other view keeps its tab for when it is opened again');
});

/* ---------------- suspend (a restore is putting scroll back) ---------------- */

await t('suspend: releases once, and nested holds release separately', () => {
  const s = storeOn(fakeStorage());
  s.setView('builds'); s.setScroll('scroll:main', 640);
  const a = s.suspend(), b = s.suspend();
  s.captureScroll(); // no document here, and suspended: the saved offset stays
  assert.deepEqual(s.scroll(), { top: 640, left: 0 });
  a(); a(); b();
  s.setScroll('scroll:main', 10);
  assert.deepEqual(s.scroll(), { top: 10, left: 0 }, 'explicit saves are never held back');
  assert.equal(typeof s.install(), 'function', 'install without a page is a no-op');
});

/* ---------------- the save right before a pushed reload ---------------- */

await t('pushed refresh: the live view, the tab rows of a view and the focused row are written at once', () => {
  const storage = fakeStorage();
  const s = storeOn(storage);
  s.setView('home');
  writeLivePlace(s, {
    view: 'builds',
    tabs: { 'view:builds/tab:builds.tabs': 'queue', 'tab:chrome.tabs': 'two', 'dialog:settings/tab:settings.tabs': 'plugins' },
    focusedRow: 'view:builds/grid:queue/row:b7',
  });
  s.flush();
  const next = storeOn(storage);
  assert.equal(next.view(), 'view:builds');
  assert.deepEqual(next.get().tabs, { 'view:builds/tab:builds.tabs': 'queue' }, 'rows outside a view are not saved');
  assert.deepEqual(next.selection('view:builds/grid:queue'), ['row:b7']);
});

await t('pushed refresh: nothing focused, or a focus outside a view, leaves the saved selection alone', () => {
  const s = storeOn(fakeStorage());
  s.setView('builds'); s.setSelection('grid:queue', 'b7');
  writeLivePlace(s, { view: 'builds' });
  writeLivePlace(s, { view: 'builds', focusedRow: null });
  writeLivePlace(s, { view: 'builds', focusedRow: 'dialog:x/grid:g/row:1' });
  writeLivePlace(s, { view: 'builds', focusedRow: 'view:builds/not an address' });
  assert.deepEqual(s.selection('grid:queue'), ['row:b7']);
  writeLivePlace(s, { view: '', tabs: {} });
  assert.equal(s.view(), 'view:builds', 'no live view keeps the saved one');
});

/* ---------------- pull-down ---------------- */

await t('pull-down: a drag is a pull once it goes down past the distance, more down than sideways', () => {
  assert.equal(isPull(0, PULL_SAVE_DISTANCE + 1), true);
  assert.equal(isPull(0, PULL_SAVE_DISTANCE), false);
  assert.equal(isPull(0, -40), false, 'up is a scroll');
  assert.equal(isPull(60, 40), false, 'sideways is a swipe');
  assert.equal(isPull(-60, 40), false);
  assert.equal(isPull(-20, 40), true);
  assert.equal(isPull(0, 30, 50), false);
});

await t('pull-down: it can refresh the page only when every scroller under the finger is at its top', () => {
  assert.equal(pullReachesRoot([]), true);
  assert.equal(pullReachesRoot([{ scrollTop: 0, scrolls: true }, { scrollTop: 0, scrolls: false }]), true);
  assert.equal(pullReachesRoot([{ scrollTop: 300, scrolls: false }]), true, 'an element that does not scroll never holds a pull');
  assert.equal(pullReachesRoot([{ scrollTop: 0, scrolls: true }, { scrollTop: 12, scrolls: true }]), false, 'a pane scrolled down scrolls up first');
});

/* ---------------- leftover scroll locks ---------------- */

/** An element as far as `clearScrollLocks` reads it. */
function fakeEl(style: Record<string, string> = {}, extra: { inert?: boolean; classes?: string[]; dataset?: Record<string, string> } = {}) {
  const props = new Map(Object.entries(style));
  const attrs = new Set(extra.inert ? ['inert'] : []);
  const classes = new Set(extra.classes ?? []);
  const styleObj = {
    getPropertyValue: (p: string) => props.get(p) ?? '',
    removeProperty: (p: string) => { props.delete(p); return ''; },
    get position() { return props.get('position') ?? ''; },
  };
  return {
    style: styleObj, props, attrs, classes,
    dataset: { ...(extra.dataset ?? {}) } as Record<string, string>,
    hasAttribute: (a: string) => attrs.has(a),
    removeAttribute: (a: string) => { attrs.delete(a); },
    classList: { contains: (c: string) => classes.has(c), remove: (c: string) => { classes.delete(c); } },
  };
}
function fakeDoc(parts: { html?: ReturnType<typeof fakeEl>; body?: ReturnType<typeof fakeEl>; root?: ReturnType<typeof fakeEl> | null; strip?: boolean }) {
  const html = parts.html ?? fakeEl(), body = parts.body ?? fakeEl(), root = parts.root === undefined ? fakeEl() : parts.root;
  const doc = { documentElement: html, body, getElementById: (id: string) => (id === 'root' ? root : null), querySelector: (sel: string) => (sel === '.fx-banner-strip' && parts.strip ? {} : null) };
  return { doc: doc as unknown as Document, html, body, root };
}

await t('scroll guard: a clean page is left as it is', () => {
  const { doc } = fakeDoc({});
  assert.deepEqual(clearScrollLocks(doc), []);
  assert.deepEqual(clearScrollLocks(fakeDoc({ root: null }).doc), [], 'a page with no #root yet');
});

await t('scroll guard: leftover overflow, pointer, touch and fixed-body locks, inert roots and the drag class are cleared', () => {
  const html = fakeEl({ overflow: 'hidden', 'overscroll-behavior': 'none' });
  const body = fakeEl({ 'overflow-y': 'hidden', 'pointer-events': 'none', position: 'fixed', top: '-640px', width: '100%', color: 'red' }, { classes: ['axf-dnd-dragging', 'keep'] });
  const root = fakeEl({ 'touch-action': 'none' }, { inert: true });
  const { doc } = fakeDoc({ html, body, root });
  const cleared = clearScrollLocks(doc);
  assert.deepEqual(cleared.sort(), ['#root inert', '#root touch-action', 'body drag class', 'body overflow-y', 'body pointer-events', 'body position', 'html overflow', 'html overscroll-behavior'].sort());
  assert.deepEqual([...html.props.keys()], []);
  assert.deepEqual([...body.props.keys()], ['color'], 'only locks are removed');
  assert.deepEqual([...root.props.keys()], []);
  assert.equal(root.attrs.has('inert'), false);
  assert.deepEqual([...body.classes], ['keep']);
  assert.deepEqual(clearScrollLocks(doc), [], 'a second run finds nothing');
});

await t('scroll guard: the banner-strip flag goes only when no strip is on screen', () => {
  const stale = fakeDoc({ html: fakeEl({}, { dataset: { axfStrip: '1' } }) });
  assert.deepEqual(clearScrollLocks(stale.doc), ['html strip flag']);
  assert.equal('axfStrip' in stale.html.dataset, false);
  const live = fakeDoc({ html: fakeEl({}, { dataset: { axfStrip: '1' } }), strip: true });
  assert.deepEqual(clearScrollLocks(live.doc), []);
  assert.equal(live.html.dataset.axfStrip, '1');
});

console.log(`place-state-check: ${n} checks passed`);
