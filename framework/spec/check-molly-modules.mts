/**
 * Molly modules (apps/molly/src/molly/native.tsx + Modules.tsx, build convert-every-app-into-a-molly-module): every app
 * Molly holds is a module. A Molly plugin can provide an app's module in-process (Expenses); a module can be switched
 * off and pointed at another address through Molly's settings; every call into a module is fenced, so a module that
 * throws is marked failed and the rest of Molly keeps going; the `molly.modules.*` actions read and change all of it;
 * the Expenses module's entry parser. Runs the real code against a small runtime stand-in.
 *   npx -y tsx framework/spec/check-molly-modules.mts
 */
import assert from 'node:assert/strict';

// the browser bits native.tsx reads at load
const g = globalThis as unknown as Record<string, unknown>;
g.location ??= { origin: 'https://molly.test', hash: '', href: 'https://molly.test/' };
g.document ??= { querySelector: () => null, createElement: () => ({ dataset: {} }), head: { appendChild: () => undefined } };

const { MOLLY_APPS, MOLLY_PAGES, pageLink } = await import('../../apps/molly/src/molly/apps');
const native = await import('../../apps/molly/src/molly/native');
const { registerModuleActions, moduleLine, MODULES_VIEW } = await import('../../apps/molly/src/molly/Modules');
const { parseEntry, expensesModule } = await import('../../apps/molly/plugins/expenses/web/module');

let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- a runtime stand-in: settings, actions, navigation, warnings ----
const values = new Map<string, unknown>();
const watchers = new Map<string, Set<() => void>>();
const actions = new Map<string, (args: string[], ctx: { payload?: string }) => unknown>();
const warnings: string[] = [];
const toasts: string[] = [];
let view = 'home';
const rt = {
  settings: {
    get: (k: string) => values.get(k),
    set: (k: string, v: unknown) => { values.set(k, v); watchers.get(k)?.forEach((f) => f()); },
    onChange: (k: string, f: () => void) => { if (!watchers.has(k)) watchers.set(k, new Set()); watchers.get(k)!.add(f); return () => watchers.get(k)!.delete(f); },
  },
  actions: { register: (id: string, fn: (args: string[], ctx: { payload?: string }) => unknown) => { actions.set(id, fn); } },
  terminal: { warn: (_s: string, m: string) => { warnings.push(m); } },
  toast: (m: string) => { toasts.push(m); },
  navigate: (v: string) => { view = v; },
  getState: () => ({ view }),
  dispatch: (spec: string) => { const [id, ...args] = spec.split(':'); return actions.get(id!)?.(args, {}); },
} as unknown as Parameters<typeof native.loadNative>[0];
const run = (spec: string) => (rt as unknown as { dispatch(s: string): unknown }).dispatch(spec);
const status = (id: string) => native.moduleStatuses().find((m) => m.id === id)!;

native.attachModuleSettings(rt as unknown as Parameters<typeof native.attachModuleSettings>[0]);
registerModuleActions(rt);

// ---- manifests: every app is a module with an address and a sign-in ----
eq(MOLLY_APPS.map((a) => a.id).sort(), ['amberx', 'axhub', 'console', 'expenses'], 'four apps');
ok(MOLLY_APPS.every((a) => a.url.startsWith('https://') && !!a.auth), 'every module names its own address and how it signs in');
ok(MOLLY_PAGES.includes(MODULES_VIEW), 'modules is one of Molly\'s pages');
eq(pageLink('#/modules'), { view: 'modules', app: '' }, '#/modules deep link');
eq(native.moduleSettingKeys('expenses'), { enabled: 'molly.modules.expenses.enabled', surface: 'molly.modules.expenses.surface' }, 'module setting keys');
for (const id of ['amberx', 'axhub', 'console']) eq(status(id).source, 'server', `${id}: module from its own server`);
eq(status('expenses').source, 'none', 'expenses: no module until its plugin provides one');
eq(status('expenses').state, 'not-native', 'expenses opens on its own without its module');
ok(!native.isNative('expenses'), 'not native yet');

// ---- an in-process module (the Expenses plugin's) ----
const drop = native.provideModule('expenses', 'expenses', expensesModule);
ok(native.isNative('expenses'), 'provided: expenses mounts in Molly');
eq(status('expenses').source, 'plugin', 'source: a Molly plugin');
native.loadNative(rt, MOLLY_APPS.find((a) => a.id === 'expenses')!);
eq(status('expenses').state, 'ready', 'an in-process module is ready at once');
eq(status('expenses').screens.map((s) => s.id), ['home', 'add'], 'its screens');
ok('expenses/add' in native.nativeViews(), 'its screens are Molly views (expenses/add)');
eq(native.openNative(rt, 'expenses', { kind: 'screen', id: 'add' }), true, 'opening a screen');
eq(view, 'expenses/add', '... navigates to <app>/<screen>');

// ---- switched off / on through the actions ----
run('molly.modules.disable:expenses');
eq(values.get('molly.modules.expenses.enabled'), false, 'disable writes the setting');
ok(!native.isNative('expenses'), 'switched off: not mounted');
eq(status('expenses').state, 'off', 'state off');
ok(!('expenses/add' in native.nativeViews()), 'its views leave Molly');
run('molly.modules.enable:expenses');
ok(native.isNative('expenses') && status('expenses').state === 'ready', 'switched on: loads again');
eq(moduleLine(status('expenses')), 'Expenses: running, 2 screens', 'one line for toasts and voice');
const listed = run('molly.modules.list') as { id: string }[];
eq(listed.map((m) => m.id).sort(), ['amberx', 'axhub', 'console', 'expenses'], 'molly.modules.list reads every module');
eq((run('molly.modules.status:expenses') as { state: string }).state, 'ready', 'molly.modules.status:<app>');
run('molly.modules.status:nope');
ok(toasts.some((t) => t.includes('doesn\'t hold an app "nope"')), 'an unknown module is said, not thrown');

// ---- module address ----
run('molly.modules.surface:console:http://evil.example/x.js');
eq(values.get('molly.modules.console.surface'), undefined, 'a plain-http address is refused');
run('molly.modules.surface:console:https://dev.example/console-surface.js');
eq(status('console').surface, 'https://dev.example/console-surface.js', 'the address setting wins');
ok(status('console').surfaceOverridden, '... and is shown as changed');
run('molly.modules.surface:console:default');
eq(status('console').surface, 'https://console.amberxai.com/surface/console-surface.js', 'default puts it back');
native.unloadNative('console');

// ---- isolation: a module that throws stops on its own ----
const crashing: typeof expensesModule = {
  ...expensesModule,
  screens: () => { throw new Error('boom in screens'); },
  run: () => { throw new Error('boom in run'); },
};
const undo = native.provideModule('test', 'axhub', crashing);
native.loadNative(rt, MOLLY_APPS.find((a) => a.id === 'axhub')!);
let views: Record<string, unknown> = {};
assert.doesNotThrow(() => { views = native.nativeViews(); }, 'Molly\'s views survive a module that throws');
checks++;
ok(!Object.keys(views).some((k) => k.startsWith('axhub/')), 'the broken module brings no views');
ok('expenses/add' in views, 'the other modules keep theirs');
await tick();
eq(status('axhub').state, 'failed', 'the broken module is marked failed');
eq(status('axhub').error, 'boom in screens', '... with what broke');
ok(warnings.some((w) => w.includes('axHub stopped in Molly: boom in screens')), 'Molly says which module stopped');
eq(native.openNative(rt, 'axhub', { kind: 'action', id: 'x' }), false, 'a failed module runs nothing');
undo();
eq(status('axhub').source, 'server', 'removing the plugin\'s module puts the server one back');

// a server module that cannot load fails on its own
values.set('molly.modules.amberx.surface', 'https://localhost/does-not-exist.js');
native.reloadNative(rt, 'amberx');
for (let i = 0; i < 50 && status('amberx').state === 'loading'; i++) await new Promise((r) => setTimeout(r, 20));
eq(status('amberx').state, 'failed', 'a module that cannot be imported is marked failed');
eq(status('expenses').state, 'ready', '... and the others keep running');
values.delete('molly.modules.amberx.surface');
native.unloadNative('amberx');

// ---- the Expenses module ----
eq(parseEntry('12.50:Coffee:Food:Visa'), { amount: 12.5, merchant: 'Coffee', category: 'Food', account: 'Visa' }, 'amount:merchant:category:account');
eq(parseEntry('$8:Bus'), { amount: 8, merchant: 'Bus' }, 'a $ is allowed, the rest optional');
eq(parseEntry('abc:Coffee'), null, 'a non-number amount');
eq(parseEntry('5'), null, 'no merchant');
eq(parseEntry('-3:Refund'), null, 'a negative amount (income is a kind, not a sign)');
eq(expensesModule.searchEntries().length, 4, 'the Expenses module lists its screens and read actions for Molly\'s one menu');
drop();
eq(status('expenses').source, 'none', 'uninstalling the plugin: expenses opens on its own again');

console.log(`check-molly-modules: ${checks} checks passed (modules: in-process, on/off, address, isolation, actions, Expenses)`);
process.exit(0);
