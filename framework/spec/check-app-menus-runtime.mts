/**
 * app-menus@1 in the runtime (core/runtime.ts slotAllowed / slotOk; build every-app-gets-own-locked-default): an app
 * whose manifest names default-<app>-nav / default-<app>-appmenu starts on them, never takes a shared or another app's
 * menu (saved pick, swap, next), and swaps freely between menus built for it. An app not on app-menus@1 is unchanged.
 *   npx -y tsx framework/spec/check-app-menus-runtime.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AxfRuntime } from '../core/runtime';

const root = new URL('../', import.meta.url).pathname;
const read = (t: string) => readdirSync(join(root, 'assets', t)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(root, 'assets', t, f), 'utf8')));
const shared = readdirSync(join(root, 'assets')).flatMap((t) => read(t));
const base = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const nav = shared.find((a) => a.type === 'nav-menu' && a.id === 'sidebar-list');
const appm = shared.find((a) => a.type === 'app-menu' && a.id === 'standard-desktop');
const own = (type: string, id: string, src: { data: unknown }, app = 'probe') => ({ ...src, id, name: id, data: { ...(src.data as object), builtFor: `app:${app}` } });
const assets = [...shared, own('nav-menu', 'default-probe-nav', nav), own('nav-menu', 'probe-rail', nav), own('app-menu', 'default-probe-appmenu', appm), own('nav-menu', 'default-other-nav', nav, 'other')];
const defaults = { ...base, 'nav-menu': 'default-probe-nav', 'app-menu': 'default-probe-appmenu' };
const g = globalThis as unknown as { localStorage?: Storage };
const store = new Map<string, string>();
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 } as Storage;
const make = (key: string, d = defaults) => new AxfRuntime({ manifest: { app: { id: 'probe', name: 'Probe' }, defaults: d } as never, assets, storageKey: key });
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };

const rt = make('test:app-menus');
ok(rt.menuApp() === 'probe', 'the app is read from its default-<app>-nav');
ok(rt.getState().active['nav-menu'] === 'default-probe-nav', 'starts on its own default nav');
ok(rt.getState().active['app-menu'] === 'default-probe-appmenu', 'starts on its own default app menu');
ok(!rt.slotOk('nav-menu', 'sidebar-list'), 'a shared nav menu is refused');
ok(!rt.slotOk('nav-menu', 'default-other-nav'), "another app's nav menu is refused");
ok(rt.slotOk('toolbar', rt.getState().active.toolbar), 'other types are untouched');
ok(rt.swap('nav-menu', 'sidebar-list') === false && rt.getState().active['nav-menu'] === 'default-probe-nav', 'swapping to a shared menu fails and keeps the default');
ok(rt.swap('nav-menu', 'probe-rail') && rt.getState().active['nav-menu'] === 'probe-rail', 'swapping to a menu built for the app works');
ok(rt.swap('nav-menu', 'next') && rt.getState().active['nav-menu'] === 'default-probe-nav', 'next cycles only through its own menus');

// a pick saved before the app had its own menus (a shared id) falls back to the default
store.set('test:app-menus-old', JSON.stringify({ active: { 'nav-menu': 'sidebar-list', 'app-menu': 'standard-desktop' }, defaults }));
const old = make('test:app-menus-old');
ok(old.getState().active['nav-menu'] === 'default-probe-nav' && old.getState().active['app-menu'] === 'default-probe-appmenu', 'a saved shared pick migrates to the default');

// an app not on app-menus@1 keeps any menu
const plain = make('test:app-menus-plain', base);
ok(plain.menuApp() === null && plain.slotOk('nav-menu', 'sidebar-list'), 'an app without its own menus keeps shared ones');
console.log(`✓ app-menus runtime: ${n} checks`);
