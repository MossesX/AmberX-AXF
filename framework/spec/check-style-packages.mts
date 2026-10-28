/**
 * style-package@1 check (enterprise-branding s19–s20): the core and CLI validators agree, every starter package
 * names controls that ship and covers every member type, the 25 packages are distinct, and the runtime applies a
 * package through every path (swap, the action with next / prev / random, swapAll with explicit slots winning,
 * a design package's extras) while skipping members an app doesn't ship.
 *
 *   npx -y tsx framework/spec/check-style-packages.mts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateAsset } from '../core/validate';
import { AxfRuntime } from '../core/runtime';
import { STYLE_PACKAGE_MEMBERS, stylePackageErrors, stylePackageSlots, stepPackage } from '../core/engines/stylepackage';

const root = new URL('../', import.meta.url).pathname;
let n = 0; const failures: string[] = [];
const ok = (c: unknown, what: string) => { if (c) n += 1; else failures.push(what); };
const eq = (a: unknown, b: unknown, what: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

const read = (t: string) => existsSync(join(root, 'assets', t)) ? readdirSync(join(root, 'assets', t)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(root, 'assets', t, f), 'utf8'))) : [];
const cli = await import('../cli/build-engine.mjs') as { validateAsset: (raw: unknown) => { ok: boolean; errors: string[] } };

// spec + engine
eq(STYLE_PACKAGE_MEMBERS, ['button', 'container', 'slider', 'dialog', 'popup', 'tab-group', 'gauge', 'meter'], 'members from the spec');
const env = (data: unknown) => ({ $axf: 'asset@1', type: 'style-package', id: 'x-pack', name: 'X', version: '1.0.0', data });
const cases: [string, unknown, boolean][] = [
  ['minimal', { slots: { button: 'rounded-solid' } }, true],
  ['all members + tone', { slots: Object.fromEntries(STYLE_PACKAGE_MEMBERS.map((m) => [m, 'abc'])), tone: 'crisp' }, true],
  ['no slots', {}, false],
  ['empty slots', { slots: {} }, false],
  ['not a member', { slots: { 'color-theme': 'fresh-light' } }, false],
  ['bad id', { slots: { button: 'Bad Id' } }, false],
  ['slots array', { slots: ['button'] }, false],
  ['bad tone', { slots: { button: 'abc' }, tone: 'Two Words' }, false],
];
for (const [name, data, good] of cases) {
  const core = validateAsset(env(data)); const c = cli.validateAsset(env(data));
  ok(core.ok === good, `core ${name}: ${good ? 'valid' : 'invalid'} (${core.errors?.join('; ')})`);
  ok(c.ok === good, `cli ${name}: ${good ? 'valid' : 'invalid'} (${c.errors?.join('; ')})`);
  eq(stylePackageErrors(data).length === 0, good, `engine ${name}`);
}
eq(stylePackageSlots({ slots: { meter: 'm-1', button: 'b-1', nope: 'x' } as never }), { button: 'b-1', meter: 'm-1' }, 'slots: members only, spec order');
eq(stepPackage(['a', 'b', 'c'], 'c', 'next'), 'a', 'next wraps');
eq(stepPackage(['a', 'b', 'c'], 'a', 'prev'), 'c', 'prev wraps');
eq(stepPackage(['a', 'b', 'c'], undefined, 'next'), 'a', 'next with none active');
eq(stepPackage(['a', 'b'], 'a', 'random', () => 0.99), 'b', 'random never repeats');
eq(stepPackage([], 'a', 'next'), undefined, 'no packages');

// starters
const packages = read('style-package');
ok(packages.length >= 25, `≥ 25 style packages (${packages.length})`);
const signatures = new Set<string>();
for (const p of packages) {
  ok(validateAsset(p).ok && cli.validateAsset(p).ok, `${p.id}: valid on both validators`);
  for (const m of STYLE_PACKAGE_MEMBERS) ok(typeof p.data.slots[m] === 'string', `${p.id}: sets ${m}`);
  for (const [t, id] of Object.entries(p.data.slots as Record<string, string>)) ok(existsSync(join(root, 'assets', t, `${id}.json`)), `${p.id}: ${t}/${id} ships`);
  const sig = STYLE_PACKAGE_MEMBERS.map((m) => { const f = join(root, 'assets', m, `${p.data.slots[m]}.json`); return existsSync(f) ? JSON.stringify(JSON.parse(readFileSync(f, 'utf8')).data) : ''; }).join('|');
  ok(!signatures.has(sig), `${p.id}: a distinct set of controls`); signatures.add(sig);
  ok(typeof p.data.tone === 'string', `${p.id}: has a tone`);
}

// runtime
{
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => read(t));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:style-packages' });
  const p0 = packages.find((p) => p.id === 'dense-ops')!;
  ok(rt.swap('style-package' as never, 'dense-ops'), 'swap to a style package');
  for (const m of STYLE_PACKAGE_MEMBERS) eq((rt.state.active as Record<string, string>)[m], p0.data.slots[m], `swap applies ${m}`);
  eq((rt.state.active as Record<string, string>)['style-package'], 'dense-ops', 'active package recorded');
  // explicit slots win over the package's members
  rt.swapAll({ 'style-package': 'glass-air', button: 'rounded-solid' } as never);
  eq((rt.state.active as Record<string, string>).button, 'rounded-solid', 'explicit button wins in swapAll');
  eq((rt.state.active as Record<string, string>).container, 'glass-air', 'members fill the rest');
  // action: next / prev / named
  const ids = rt.registry.list('style-package' as never).map((a) => a.id);
  rt.dispatch('style.package:next');
  eq((rt.state.active as Record<string, string>)['style-package'], ids[(ids.indexOf('glass-air') + 1) % ids.length], 'style.package:next');
  rt.dispatch('style.package:prev');
  eq((rt.state.active as Record<string, string>)['style-package'], 'glass-air', 'style.package:prev');
  rt.dispatch('style.package:boardroom');
  eq((rt.state.active as Record<string, string>).dialog, 'boardroom', 'style.package:<id>');
  // a design package's extras may name a style package
  rt.registry.register({ $axf: 'asset@1', type: 'design-package', id: 'with-pack', name: 'With pack', version: '1.0.0', data: { 'style-theme': 'enterprise', 'color-theme': 'porcelain', layout: 'enterprise-shell', 'behavior-theme': 'standard', extras: { slots: { 'style-package': 'terminal', slider: 'classic-round' } } } } as never);
  ok(rt.applyDesignPackage('with-pack'), 'design package with a style package applies');
  eq((rt.state.active as Record<string, string>).button, 'terminal', 'its style package members apply');
  eq((rt.state.active as Record<string, string>).slider, 'classic-round', 'its own extras slot wins');
  eq((rt.state.active as Record<string, string>)['color-theme'], 'porcelain', 'and its themes');
  // a member the app doesn't ship is skipped, never a broken look
  rt.registry.register({ $axf: 'asset@1', type: 'style-package', id: 'half-pack', name: 'Half', version: '1.0.0', data: { slots: { button: 'pill-gradient', container: 'not-shipped' } } } as never);
  const before = (rt.state.active as Record<string, string>).container;
  rt.swap('style-package' as never, 'half-pack');
  eq((rt.state.active as Record<string, string>).button, 'pill-gradient', 'shipped member applies');
  eq((rt.state.active as Record<string, string>).container, before, 'missing member keeps the current one');
  // rolls never pick a package (spec roll: false)
  ok(rt.rollSlotIncluded('style-package' as never) === false, 'style packages are not rolled');
}

// design-package library (s23): every theme and extras slot a package names ships, and applying one with a style
// package brings that package's controls
{
  const dps = read('design-package');
  ok(dps.length >= 25, `≥ 25 design packages (${dps.length})`);
  for (const d of dps) {
    for (const t of ['style-theme', 'color-theme', 'layout', 'behavior-theme']) ok(existsSync(join(root, 'assets', t, `${d.data[t]}.json`)), `${d.id}: ${t}/${d.data[t]} ships`);
    for (const [t, id] of Object.entries((d.data.extras?.slots ?? {}) as Record<string, string>)) ok(existsSync(join(root, 'assets', t, `${id}.json`)), `${d.id}: extras ${t}/${id} ships`);
  }
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => read(t));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:dp-lib' });
  ok(rt.applyDesignPackage('gizmox-console'), 'gizmox-console applies');
  const act = rt.state.active as Record<string, string>;
  eq([act['style-theme'], act['color-theme'], act.layout, act['behavior-theme']], ['terminal-pro', 'obsidian', 'console-pro', 'gizmo'], 'its four themes');
  eq([act.button, act.dialog, act['tab-group'], act.toolbar, act['nav-menu']], ['gizmo-console', 'gizmo-console', 'gizmo-console', 'developer-ops', 'gizmo-console'], 'its style package + chrome');
}

// interfaces (interface-roller s6–s10): a scoped interface brings its style package's controls too
{
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => read(t));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:ifx' });
  for (const [iid, sp] of [['gizmox-night', 'gizmo-console'], ['amberx-signature', 'amber-signature']]) {
    const r = rt.resolveInterface(iid);
    ok(r && r.missing.length === 0, `${iid}: resolves with nothing missing (${r?.missing.join(', ')})`);
    eq([r?.active.button, r?.active.dialog, r?.active['tab-group']], [sp, sp, sp], `${iid}: its style package's controls`);
    const view = rt.scoped(`t-${iid}`, iid);
    eq((view?.state.active as Record<string, string> | undefined)?.button, sp, `${iid}: the scoped view sees them`);
    ok(view?.getState() === view?.getState(), `${iid}: scoped state is a stable snapshot`);
  }
  eq((rt.state.active as Record<string, string>).button, defaults.button, 'the app itself is untouched');
}

if (failures.length) { for (const f of failures) console.error(`✗ ${f}`); console.error(`check-style-packages: ${failures.length} of ${n + failures.length} checks failed`); process.exit(1); }
console.log(`check-style-packages: ${n} checks passed`);
