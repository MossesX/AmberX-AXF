/**
 * Plugin lazy loader checks (plugin-lazy@1): the pure engine (src/lazyEngine.ts), the shape round trip
 * (src/pluginLoader.tsx dehydrate), and that the plugin-manager server part normalizes configs exactly like the web.
 *
 *   npx -y tsx apps/console-web/scripts/lazy-loader-check.mts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CORE_PLUGINS, evictions, idlePicks, LAZY_DEFAULTS, modeOf, normalizeLazyConfig, startupList, touch, decayed, HALF_LIFE_MS, type UsageStat } from '../src/lazyEngine.ts';

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log(`ok ${n} ${name}`); };
const now = Date.UTC(2026, 10, 3);

t('defaults: 5 preload, 15 cached, banners first, idle on', () => {
  const c = normalizeLazyConfig(undefined);
  assert.deepEqual(c, LAZY_DEFAULTS);
  assert.equal(c.preloadCount, 5); assert.equal(c.cache.size, 15); assert.equal(c.bannersFirst, true); assert.equal(c.idle.on, true);
});

t('normalizer clamps, drops junk, never switches a core plugin off', () => {
  const c = normalizeLazyConfig({ preloadCount: '999', pins: ['ok', 'Bad Name', 'ok', 3], idle: { count: -4 }, cache: { size: 0, offlineMb: 'x' }, modes: { 'plugin-manager': 'off', foo: 'off', bar: 'start', baz: 'sometimes' }, extra: 1 });
  assert.equal(c.preloadCount, 50); assert.deepEqual(c.pins, ['ok']); assert.equal(c.idle.count, 0); assert.equal(c.cache.size, 1); assert.equal(c.cache.offlineMb, 25);
  assert.deepEqual(c.modes, { foo: 'off', bar: 'start' });
  assert.equal(modeOf(c, 'plugin-manager'), CORE_PLUGINS['plugin-manager']);
});

t('frecency: a use halves after the half-life, touch adds one', () => {
  const s: UsageStat = { uses: 1, lastUsed: now, score: 1 };
  assert.ok(Math.abs(decayed(s, now + HALF_LIFE_MS) - 0.5) < 1e-9);
  const s2 = touch(s, now + HALF_LIFE_MS);
  assert.equal(s2.uses, 2); assert.ok(Math.abs(s2.score - 1.5) < 1e-9);
});

const enabled = ['a', 'b', 'c', 'd', 'e', 'f', 'push-banner', 'whats-shipped', 'console-commands', 'systems-check', 'plugin-manager'];
const stats: Record<string, UsageStat> = { a: { uses: 9, lastUsed: now, score: 9 }, b: { uses: 3, lastUsed: now, score: 3 }, c: { uses: 1, lastUsed: now - 30 * HALF_LIFE_MS, score: 50 }, d: { uses: 5, lastUsed: now, score: 5 } };

t('startup: banners first, then core-on-start, pins, load-on-start, most used', () => {
  const cfg = normalizeLazyConfig({ preloadCount: 2, pins: ['f'], modes: { e: 'start' } });
  const l = startupList({ enabled, cfg, banners: ['push-banner', 'whats-shipped', 'systems-check'], stats, now });
  assert.deepEqual(l.map((x) => `${x.folder}:${x.reason}`), ['push-banner:banner', 'whats-shipped:banner', 'systems-check:banner', 'console-commands:core', 'f:pin', 'e:start', 'a:used', 'd:used']);
});

t('startup: off plugins never load, not even as banners; unknown shapes load last to learn', () => {
  const cfg = normalizeLazyConfig({ preloadCount: 0, modes: { 'push-banner': 'off' } });
  const l = startupList({ enabled, cfg, banners: ['push-banner'], stats, now, unknown: ['b', 'push-banner'] });
  assert.deepEqual(l.map((x) => x.folder), ['console-commands', 'systems-check', 'b']);
  assert.equal(l.at(-1)!.reason, 'learn');
});

t('startup: bannersFirst off drops them from the head; dragged order sorts the chosen list', () => {
  const cfg = normalizeLazyConfig({ preloadCount: 1, bannersFirst: false, order: ['a', 'systems-check'] });
  const l = startupList({ enabled, cfg, banners: ['push-banner'], stats, now, unknown: ['f'] });
  assert.deepEqual(l.map((x) => x.folder), ['a', 'systems-check', 'console-commands', 'f']);
});

t('idle picks: next most used, not loaded, on-open only; off when idle is off', () => {
  const cfg = normalizeLazyConfig({ idle: { on: true, count: 2 } });
  assert.deepEqual(idlePicks({ enabled, cfg, loaded: new Set(['a']), stats, now }), ['d', 'b']);
  assert.deepEqual(idlePicks({ enabled, cfg: normalizeLazyConfig({ idle: { on: false } }), loaded: new Set(), stats, now }), []);
});

t('evictions: least recently used on-open plugins beyond the cache size, never kept ones', () => {
  const cfg = normalizeLazyConfig({ cache: { size: 2 }, modes: { e: 'start' } });
  const out = evictions({ installed: ['a', 'b', 'c', 'd', 'e'], cfg, lastUsed: { a: 5, b: 1, c: 3, d: 4, e: 0 }, keep: new Set(['c']) });
  assert.deepEqual(out, ['b']);
  assert.deepEqual(evictions({ installed: ['a', 'b'], cfg, lastUsed: {}, keep: new Set() }), []);
});

t('server part normalizes exactly like the web', () => {
  const cases = [undefined, {}, { preloadCount: 7.6, pins: ['x', 'x', 'Y'], order: ['b', 'a'], idle: { on: false, count: '12' }, cache: { size: 500, offline: false, offlineMb: 0 }, modes: { 'console-terminal': 'off', z: 'open' } }, { preloadCount: true, cache: 'no' }];
  const py = fileURLToPath(new URL('../plugins/plugin-manager/server/lazy.py', import.meta.url));
  const code = `import importlib.util,json,sys\ns=importlib.util.spec_from_file_location('lz',${JSON.stringify(py)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(json.dumps([m.normalize(c) for c in json.loads(sys.stdin.read())]))`;
  const out = JSON.parse(execFileSync('python3', ['-c', code], { input: JSON.stringify(cases.map((c) => c ?? null)) }).toString());
  assert.deepEqual(out, cases.map((c) => normalizeLazyConfig(c)));
});

t('dev: each plugin entry is its own HMR boundary; hashes cover every plugin with a web part', async () => undefined);
{
  const { pluginChunks, pluginHashes } = await import('./plugin-chunks.mjs');
  const p = pluginChunks({ pluginsDir: fileURLToPath(new URL('../plugins', import.meta.url)) });
  p.configResolved({ command: 'serve' });
  const refresh = p.transform('x;\n if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage);\n', '/r/plugins/push-banner/web/index.tsx');
  assert.ok(refresh.code.includes('axf:plugin-hot') && !refresh.code.includes('invalidate('), 'React Refresh invalidate replaced by a plugin swap');
  assert.ok(p.transform('export const plugin = {};', '/r/plugins/push-banner/web/index.tsx?t=1').code.includes('import.meta.hot.accept'), 'entry without components accepts itself');
  assert.equal(p.transform('x', '/r/plugins/push-banner/web/core.ts'), undefined, 'other files untouched');
  const h = pluginHashes(fileURLToPath(new URL('../plugins', import.meta.url)));
  assert.ok(h['plugin-manager'] && !Object.keys(h).some((f) => f.startsWith('_')), 'hashes for real plugins, never templates');
}

console.log(`${n} checks passed`);
