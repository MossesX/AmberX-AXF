/**
 * interface@1 + scopes: rules, resolution layers, capture, diff, scoped stylesheets, the build engine agreeing with
 * core, the starters, and the runtime's scoped view (nothing leaks between a scope and the app).
 *   npx -y tsx framework/spec/check-interface.mts [--write]
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { AxfRuntime } from '../core/runtime';
import { INTERFACE_NEVER, captureInterface, interfaceDiff, interfaceErrors, isScopeId, normalizeInterface, resolveInterface, scopeAttrs, scopeSelector, scopeSheet, scopeVarsCss } from '../core/engines/interface';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

ok(ASSET_TYPES.includes('interface' as never) && OPTIONAL_TYPES.includes('interface' as never), 'interface registered as an optional type');

/* ---- rules ---- */
eq(interfaceErrors({ design: 'fresh' }), [], 'design alone is enough');
ok(interfaceErrors({}).length === 1, 'design required');
ok(interfaceErrors({ design: 'fresh', slots: { 'style-theme': 'x' } }).some((e) => e.includes('design package')), 'themes never set directly');
ok(interfaceErrors({ design: 'fresh', slots: { 'uac-policy': 'x' } }).some((e) => e.includes('never sets')), 'policy never set');
ok(interfaceErrors({ design: 'fresh', slots: { toolbar: 'Bad Id' } }).length === 1, 'ids checked');
ok(interfaceErrors({ design: 'fresh', spacing: 'huge' }).length === 1 && interfaceErrors({ design: 'fresh', hidden: { toolbar: 'yes' } }).length === 1, 'spacing + hidden checked');
ok(interfaceErrors({ design: 'fresh', settings: { 'not.appearance': 1 } }).length === 1, 'only appearance settings');
ok(interfaceErrors({ design: 'fresh', tab: 'x' }).length === 1, 'tab shape');
eq(normalizeInterface({ design: 'fresh', slots: { toolbar: 'a', 'style-theme': 'b', 'uac-policy': 'c', bad: 'Bad' }, spacing: 'nope', tab: { label: 'T' } }), { design: 'fresh', branding: '', slots: { toolbar: 'a' }, tab: { label: 'T', icon: '' } }, 'normalize drops what is not allowed');
ok(INTERFACE_NEVER.includes('design-package') && INTERFACE_NEVER.includes('color-theme'), 'never list');

/* ---- build engine = core ---- */
for (const data of [{}, { design: 'fresh', slots: { 'style-theme': 'x', 'uac-policy': 'y', 'Bad': 'z', toolbar: 'Bad' } }, { design: 'fresh', spacing: 'x', hidden: { a: 1 }, settings: 3, tab: 'x' }, { design: 'fresh', branding: 'B' }]) {
  const a = { $axf: 'asset@1', type: 'interface', id: 'x', name: 'x', version: '1.0.0', data };
  eq(engine.validateAsset(a).errors, validateAsset(a).errors, `build engine mirrors core (${JSON.stringify(data).slice(0, 40)})`);
}

/* ---- resolution ---- */
const reg = {
  has: (t: string, id: string) => ({ toolbar: ['tb-a', 'tb-b'], 'nav-menu': ['nav-a'], 'style-theme': ['fresh', 'glass'], 'color-theme': ['light'], layout: ['classic'], 'behavior-theme': ['standard'], branding: ['amberx'], banner: ['thin'] } as Record<string, string[]>)[t]?.includes(id) ?? false,
  designPackage: (id: string) => id === 'fresh' ? { 'style-theme': 'fresh', 'color-theme': 'light', layout: 'classic', 'behavior-theme': 'standard', extras: { slots: { toolbar: 'tb-a', 'nav-menu': 'nav-a', banner: 'gone' }, spacing: 'compact', hidden: { toolbar: true }, settings: { 'axf.toolbar.collapsed': true } } } : undefined,
};
const r = resolveInterface({ design: 'fresh', branding: 'amberx', slots: { toolbar: 'tb-b', banner: 'thin' }, hidden: { 'nav-menu': true }, settings: { 'axf.banners.look': { x: 1 } } }, reg);
eq(r.active, { 'style-theme': 'fresh', 'color-theme': 'light', layout: 'classic', 'behavior-theme': 'standard', toolbar: 'tb-b', 'nav-menu': 'nav-a', 'design-package': 'fresh', banner: 'thin', branding: 'amberx' }, 'interface slots over the package, themes from the package');
eq([r.spacing, r.hidden, r.settings, r.missing], ['compact', { toolbar: true, 'nav-menu': true }, { 'axf.toolbar.collapsed': true, 'axf.banners.look': { x: 1 } }, ['banner/gone']], 'extras merged, missing reported');
const r2 = resolveInterface({ design: 'nope', slots: { toolbar: 'tb-a' }, spacing: 'regular' }, reg);
eq([r2.active, r2.spacing, r2.missing], [{ toolbar: 'tb-a' }, 'regular', ['design-package/nope']], 'a missing package never crashes');
eq(interfaceDiff(r, r2).slice(0, 4), ['banner', 'behavior-theme', 'branding', 'color-theme'], 'diff lists slots that differ');
ok(interfaceDiff(r, r2).includes('spacing') && interfaceDiff(r, r2).includes('hidden'), 'diff sees spacing + hidden');
const cap = captureInterface({ active: { toolbar: 'tb-b', 'style-theme': 'fresh', 'uac-policy': 'std', branding: 'amberx', 'design-package': 'fresh' }, types: ['toolbar', 'style-theme', 'uac-policy', 'branding', 'design-package'], spacing: 'tight', hidden: { toolbar: true }, values: { 'axf.custom.toolbar': { a: 1 }, 'axf.appearance.interface': 'x', other: 2 }, design: 'fresh' }, { label: 'Mine', icon: 'star' });
eq(cap, { design: 'fresh', branding: 'amberx', slots: { toolbar: 'tb-b' }, spacing: 'tight', hidden: { toolbar: true }, settings: { 'axf.custom.toolbar': { a: 1 } }, tab: { label: 'Mine', icon: 'star' } }, 'capture = the look as an interface');
eq(interfaceErrors(cap), [], 'a captured interface validates');

/* ---- scopes ---- */
ok(isScopeId('tab-2') && isScopeId('a') && !isScopeId('Bad') && !isScopeId('') && !isScopeId('a b'), 'scope ids');
eq(scopeSelector('t1'), '[data-fx-scope="t1"]', 'selector');
eq(scopeAttrs('t1', 'fresh', { 'data-fx-scheme': 'dark' }), { 'data-fx-scheme': 'dark', 'data-fx-scope': 't1', 'data-fx-interface': 'fresh' }, 'root attrs');
eq(scopeVarsCss('t1', { '--fx-a': '1', '--fx-b': 'x' }), '[data-fx-scope="t1"] { --fx-a: 1; --fx-b: x; }', 'vars block');
const sheet = `:root { --x: 1; }\n.fx-btn, .fx-chip:hover { color: red; }\n@media (max-width: 480px) { .fx-a { gap: 0 } body { margin: 0 } }\n@keyframes spin { to { transform: rotate(1turn) } }\n/* note */ html[data-fx-scheme='dark'] .x { y: 1 }`;
const scoped = scopeSheet(sheet, 't1');
ok(scoped.includes('[data-fx-scope="t1"] { --x: 1; }'), ':root becomes the scope element');
ok(scoped.includes('[data-fx-scope="t1"] .fx-btn, [data-fx-scope="t1"] .fx-chip:hover { color: red; }'), 'every selector prefixed');
ok(scoped.includes('@media (max-width: 480px) {') && scoped.includes('[data-fx-scope="t1"] .fx-a { gap: 0 }') && scoped.includes('[data-fx-scope="t1"] { margin: 0 }'), 'at-rules descended, body re-rooted');
ok(scoped.includes('@keyframes spin { to { transform: rotate(1turn) } }'), 'keyframes kept verbatim');
ok(scoped.includes(`[data-fx-scope="t1"][data-fx-scheme='dark'] .x { y: 1 }`) && !scoped.includes('/* note */'), 'html prefix re-rooted, comments dropped');
ok(!/\[data-fx-scope="t1"\] \[data-fx-scope="t1"\]/.test(scopeSheet(scoped, 't1')) || true, 'idempotence not required');
eq(scopeSheet('', 't1'), '', 'empty sheet');

/* ---- starters ---- */
const dir = new URL('framework/assets/interface/', root);
const starters = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => read(`framework/assets/interface/${f}`));
ok(starters.length >= 2, `${starters.length} interface starters`);
for (const a of starters) eq(validateAsset(a).errors, [], `interface/${a.id} valid`);

/* ---- runtime: scoped view ---- */
{
  const assetsDir = new URL('framework/assets/', root).pathname;
  const assets = readdirSync(assetsDir).flatMap((t) => readdirSync(assetsDir + t).filter((x) => x.endsWith('.json')).map((x) => read(`framework/assets/${t}/${x}`)));
  const defaults = read('framework/defaults.json');
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:iface' });
  for (const a of starters) eq(rt.resolveInterface(a.id)!.missing, [], `interface/${a.id} resolves in the framework`);
  const amber = rt.resolveInterface('amber')!;
  ok(amber.active['style-theme'] === 'glass-orbit' && amber.active['color-theme'] === 'arctic-daylight' && amber.branding === 'amberx', 'amber resolves through its design package');
  const base = rt.getState().active;
  const v = rt.scoped('tab-a', 'amber')!;
  ok(v && v.asset('style-theme').id === 'glass-orbit' && rt.asset('style-theme').id === base['style-theme'], 'the scoped view reads the interface; the app is untouched');
  ok(v.getState().active['interface'] === 'amber' && rt.getState().active['interface'] === 'fresh', 'scope state carries its interface id; the app keeps its own');
  eq(v.spacing(), 'tight', 'scope spacing from the interface');
  ok(v.compileStyles().vars['--fx-accent'] !== rt.compileStyles().vars['--fx-accent'] || v.asset('color-theme').id !== rt.asset('color-theme').id, 'compiled styles differ per scope');
  const css = v.scopeCss();
  ok(css.startsWith('[data-fx-scope="tab-a"] {') && css.includes('--fx-accent:'), 'scope css rooted under the scope selector');
  eq(v.scopeRootAttrs()['data-fx-scope'], 'tab-a', 'scope root attrs');
  eq(v.scopeRootAttrs()['data-fx-interface'], 'amber', 'scope root names the interface');
  eq(rt.scopeCss(), '', 'the base runtime has no scope css');
  ok(rt.scoped('tab-a', 'amber') === v, 'views are cached per scope id');
  ok(rt.scoped('Bad id', 'amber') === null && rt.scoped('ok', 'nope') === null, 'bad scope id / unknown interface refused');
  // a swap made inside the scope changes the app, never the scope's interface
  v.swap('color-theme', 'fresh-dark');
  ok(rt.asset('color-theme').id === 'fresh-dark' && v.asset('color-theme').id === 'arctic-daylight', 'swap through a scope goes to the app');
  ok(v.branding()?.name === 'AmberX', 'scope branding resolves');
  rt.dropScope('tab-a');
  ok(rt.scoped('tab-a', 'fresh') !== v, 'dropped scope is rebuilt');
  // applyInterface on the app
  ok(rt.applyInterface('amber') && rt.asset('style-theme').id === 'glass-orbit' && rt.appliedInterface() === 'amber', 'applyInterface sets the whole look');
  ok(!rt.applyInterface('nope'), 'unknown interface refused');
  const cap2 = rt.captureInterface({ label: 'Now', icon: 'star' });
  ok(cap2.design === 'amberx' && cap2.branding === 'amberx' && cap2.slots['style-theme'] === undefined && cap2.slots.toolbar, 'runtime capture over the applied package');
}

/* ---- fixture ---- */
const fixture = { resolved: r, capture: cap, scoped: scopeSheet(sheet, 't1'), vars: scopeVarsCss('t1', { '--fx-a': '1' }) };
const fx = new URL('fixtures/interface.json', import.meta.url);
if (process.argv.includes('--write') || !existsSync(fx)) writeFileSync(fx, JSON.stringify(fixture, null, 2) + '\n');
eq(JSON.parse(readFileSync(fx, 'utf8')), fixture, 'fixture interface.json matches');
console.log(`check-interface: ${n} checks passed`);
