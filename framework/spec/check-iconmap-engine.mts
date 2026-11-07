/**
 * iconmap.ts check (the registry-facing half of icon-map@1): the chain a place in an app gets from settings picks,
 * slot overrides, pack picks and shipped maps; pack lookup over icon-pack assets; the manager's index; the asset
 * envelope; and the runtime's own path (iconFor through a real AxfRuntime: scope, cache per state revision, the
 * icons.* actions, appearance keys carried by the hub look).
 *
 *   npx -y tsx framework/spec/check-iconmap-engine.mts
 */
import assert from 'node:assert/strict';
import { ICON_MAP_KEY, ICON_PACK_KEY, ICON_SLOTS_KEY, iconChain, iconMapAsset, iconMapIndex, packLookup, resolveIconIn } from '../core/engines/iconmap';
import { isAppearanceSetting } from '../core/engines/designpackage';
import { AxfRuntime } from '../core/runtime';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** A runtime over the framework's starter assets (the same construction as check-alerts.mts). */
function makeRuntime(appId = 'test-app') {
  const assets = ['color-theme', 'style-theme', 'layout', 'app-menu', 'toolbar', 'nav-menu', 'context-menu', 'dialog', 'popup', 'button', 'slider', 'container', 'uac-policy']
    .flatMap((t) => readdirSync(join(root, 'assets', t)).map((f) => JSON.parse(readFileSync(join(root, 'assets', t, f), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  return new AxfRuntime({ manifest: { app: { id: appId, name: 'Test' }, defaults: defaults.defaults ?? defaults } as never, assets, storageKey: `test:icons:${appId}` });
}

let n = 0;
const t = (name: string, fn: () => void) => { n++; try { fn(); } catch (e) { console.error(`✗ ${name}: ${(e as Error).message}`); process.exitCode = 1; } };

/* ---------------- a fake registry + settings */

const pack = (id: string, names: string[]) => ({ id, data: { style: 'outline', grid: 24, glyphs: Object.fromEntries(names.map((g) => [g, 'M0 0'])) } });
const assets: Record<string, { id: string; data: unknown }[]> = {
  'icon-pack': [pack('lucide-1', ['home', 'floppy-disk', 'settings', 'house']), pack('tabler-1', ['home', 'device-floppy', 'settings', 'trash'])],
  'icon-map': [
    { id: 'framework', data: { scope: { app: '' }, slots: {} } },
    { id: 'console-root', data: { scope: { app: 'console-web' }, pack: 'lucide-1', slots: { save: 'floppy-disk' } } },
    { id: 'other-root', data: { scope: { app: 'other-app' }, pack: 'tabler-1', slots: { save: 'pack:tabler-1/trash' } } },
    { id: 'console-builds', data: { scope: { app: 'console-web', ui: 'builds' }, extends: 'console-root', slots: { save: 'pack:tabler-1/device-floppy' } } },
    { id: 'plugin-x', data: { scope: { app: 'console-web', plugin: 'x' }, pack: 'tabler-1', slots: {} } },
  ],
};
const registry = { get: (type: string, id: string) => assets[type]?.find((a) => a.id === id), list: (type: string) => assets[type] ?? [] };
const settingsOf = (o: Record<string, unknown>) => ({ get: (k: string) => o[k] });

t('chain: shipped maps by scope, app root filtered to this app, framework root last', () => {
  const chain = iconChain({ app: 'console-web', ui: 'builds', plugin: 'x' }, registry, settingsOf({}));
  assert.deepEqual(chain.map((c) => c.id), ['plugin-x', 'console-builds', 'console-root', 'framework']);
  const root = iconChain({ app: 'console-web' }, registry, settingsOf({}));
  assert.deepEqual(root.map((c) => c.id), ['console-root', 'framework']); // other-root is another app's
});
t('chain: settings slot overrides, map pick and pack pick sit above shipped maps, per scope', () => {
  const s = settingsOf({ [ICON_SLOTS_KEY('ui:builds')]: { save: 'none' }, [ICON_MAP_KEY('app')]: 'other-root', [ICON_PACK_KEY('plugin:x')]: 'lucide-1' });
  const chain = iconChain({ app: 'console-web', ui: 'builds', plugin: 'x' }, registry, s);
  assert.deepEqual(chain.map((c) => c.id), ['pack:plugin:x', 'plugin-x', 'settings:ui:builds', 'console-builds', 'other-root', 'console-root', 'framework']);
  assert.equal(resolveIconIn('save', { app: 'console-web', ui: 'builds', plugin: 'x' }, registry, s).via, 'none');
  assert.deepEqual(resolveIconIn('home', { app: 'console-web', plugin: 'x' }, registry, s), { glyph: 'home', pack: 'lucide-1', via: 'pack', from: 'pack:plugin:x' });
});
t('resolveIconIn: child slot beats parent, pack per scope, branding and framework fallbacks', () => {
  assert.deepEqual(resolveIconIn('save', { app: 'console-web', ui: 'builds' }, registry, settingsOf({})), { glyph: 'device-floppy', pack: 'tabler-1', via: 'slot', from: 'console-builds' });
  assert.deepEqual(resolveIconIn('save', { app: 'console-web' }, registry, settingsOf({})), { glyph: 'floppy-disk', pack: 'lucide-1', via: 'pack', from: 'console-root' });
  assert.deepEqual(resolveIconIn('rocket', { app: 'console-web' }, registry, settingsOf({})), { glyph: 'rocket', pack: '', via: 'framework', from: '' });
  assert.deepEqual(resolveIconIn('trash', { app: 'nothing' }, registry, settingsOf({}), 'tabler-1'), { glyph: 'trash', pack: 'tabler-1', via: 'branding', from: '' });
});
t('packLookup reads icon-pack assets, unknown packs are empty', () => {
  const l = packLookup(registry, 'lucide-1');
  assert.equal(l.hasGlyph!('lucide-1', 'house'), true); assert.equal(l.hasGlyph!('lucide-1', 'trash'), false); assert.equal(l.hasGlyph!('nope', 'home'), false); assert.equal(l.brandingPack, 'lucide-1');
});
t('iconMapIndex groups maps by app with kind, scope key and counts', () => {
  const idx = iconMapIndex(registry);
  assert.deepEqual(idx.map((g) => g.app), ['(any app)', 'console-web', 'other-app']);
  const c = idx.find((g) => g.app === 'console-web')!;
  assert.deepEqual(c.maps.map((m) => [m.id, m.kind, m.scopeKey, m.slots, m.pack]), [['console-builds', 'ui', 'ui:builds', 1, ''], ['console-root', 'app', 'app', 1, 'lucide-1'], ['plugin-x', 'plugin', 'plugin:x', 0, 'tabler-1']]);
});
t('iconMapAsset makes a valid asset@1 envelope', () => {
  const a = iconMapAsset('console-random', 'Random', { scope: { app: 'console-web' }, slots: { save: 'pack:tabler-1/trash' }, tags: ['random'] });
  assert.equal(a.$axf, 'asset@1'); assert.equal(a.type, 'icon-map'); assert.deepEqual(a.tags, ['random']); assert.match(a.description, /1 slot/);
});
t('axf.icons.* keys are appearance settings (the hub look carries them)', () => {
  makeRuntime('prefix-app'); // a runtime with the prefix list as shipped (designpackage.ts PREFIXES carries axf.icons.)
  assert.equal(isAppearanceSetting(ICON_SLOTS_KEY('app')), true); assert.equal(isAppearanceSetting(ICON_MAP_KEY('ui:x')), true); assert.equal(isAppearanceSetting(ICON_PACK_KEY('plugin:p')), true);
});
t('runtime: iconFor resolves through scopes, notes what was shown, actions change settings', () => {
  const rt = makeRuntime();
  for (const a of assets['icon-pack']) rt.registry.register({ $axf: 'asset@1', type: 'icon-pack', id: a.id, name: a.id, version: '1.0.0', data: a.data }, 'app');
  rt.registry.register({ $axf: 'asset@1', type: 'icon-map', id: 'root-map', name: 'Root', version: '1.0.0', data: { scope: { app: rt.manifest.app.id }, pack: 'lucide-1', slots: { save: 'floppy-disk' } } }, 'app');
  assert.deepEqual(rt.iconFor('save'), { glyph: 'floppy-disk', pack: 'lucide-1', via: 'pack', from: 'root-map' });
  assert.equal(rt.iconFor('rocket', { ui: 'home' }).via, 'framework');
  assert.deepEqual(rt.iconsUsed('app'), ['save']); assert.deepEqual(rt.iconsUsed('ui:home'), ['rocket']); assert.deepEqual(rt.iconsUsed(), ['rocket', 'save']);
  assert.ok(rt.dispatch('icons.set:ui.home:rocket:pack/tabler-1/trash')); // the spec form: dots for the scope, slashes for the pack ref
  assert.deepEqual(rt.iconFor('rocket', { ui: 'home' }), { glyph: 'trash', pack: 'tabler-1', via: 'slot', from: 'settings:ui:home' });
  assert.equal(rt.setIconSlot('ui:home', 'rocket', 'Not A Ref'), false);
  assert.ok(rt.setIconPack('plugin:p', 'tabler-1')); assert.equal(rt.setIconPack('plugin:p', 'nope'), false);
  assert.deepEqual(rt.iconFor('home', { plugin: 'p' }), { glyph: 'home', pack: 'tabler-1', via: 'pack', from: 'pack:plugin:p' });
  const g = rt.generateIcons('app', 'tabler-1')!;
  assert.ok(g.covered.includes('save')); assert.equal(rt.iconFor('save').pack, 'tabler-1');
  const r = rt.randomizeIcons('app', 'seed-1')!;
  assert.deepEqual(r, rt.randomizeIcons('app', 'seed-1')); // seeded
  assert.ok(rt.resetIcons('app')); assert.deepEqual(rt.iconFor('save'), { glyph: 'floppy-disk', pack: 'lucide-1', via: 'pack', from: 'root-map' });
  assert.ok(rt.iconMaps().some((g2) => g2.maps.some((m) => m.id === 'root-map')));
  assert.equal(rt.iconPackData('lucide-1') !== null, true); assert.equal(rt.iconPackData(''), null);
});

if (!process.exitCode) console.log(`✓ iconmap engine + runtime: ${n} checks (chain, settings layers, resolution, lookup, index, envelope, appearance keys, runtime actions)`);
