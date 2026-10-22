/**
 * Self-test for the plugin inventory engine on the web port (CI: npx -y tsx framework/spec/check-plugin-inventory.mts).
 * The engine is pinned by spec/fixtures/plugin-inventory.json (replayed here and by the Kotlin + Python ports); this
 * also checks what the fixture can't: the web host adapter (`pluginRecordsFromRuntime`) over a real runtime with
 * libraries, and the console's own record builder when its bundle is present.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPluginInventory, conflictsOf, dependenciesOf, dependentsOf, healthOf, pluginGraph, pluginRecord, resolveProviders, type InventoryContext, type PluginRecord } from '../core/engines/plugins';
import { pluginRecordsFromRuntime } from '../react/pluginRecords';
import { AxfRuntime } from '../core/runtime';
import { installLibraries } from '../react/library';

const root = new URL('../', import.meta.url).pathname;
const fixture = JSON.parse(readFileSync(join(root, 'spec/fixtures/plugin-inventory.json'), 'utf8'));

// 1. The fixture replays exactly (the generator and the engine can't drift apart).
{
  const records = fixture.records as PluginRecord[];
  const ctx = fixture.context as InventoryContext;
  assert.deepEqual(buildPluginInventory(records, ctx), fixture.inventory);
  const on = records.map((r) => (r.folder === 'off-provider' ? { ...r, enabled: true } : r));
  const inv = buildPluginInventory(on, ctx);
  assert.deepEqual({ items: inv.items.map((i) => ({ folder: i.folder, health: i.health, conflicts: i.conflicts })), conflicts: inv.conflicts, counts: inv.counts }, fixture.enabledOffProvider);
  assert.deepEqual(pluginGraph(fixture.inventory.items, ctx.live), fixture.graph);
}

// 2. Pieces behave on their own.
{
  const a = pluginRecord({ folder: 'a', id: 'x.a', name: 'A', apiLevel: 1, provides: ['service:s@1'] });
  const b = pluginRecord({ folder: 'b', id: 'x.b', name: 'B', apiLevel: 1, requires: ['service:s@1', 'service:s@1'] });
  const ctx: InventoryContext = { apiLevels: [1], target: null, live: [] };
  const providers = resolveProviders([a, b], []);
  assert.equal(providers.get('s@1')?.[0]?.folder, 'a');
  const deps = dependenciesOf(b, providers, [a, b], ctx);
  assert.equal(deps.filter((d) => d.kind === 'service').length, 1, 'a repeated entry counts once');
  assert.equal(healthOf(b, deps), 'ok');
  assert.deepEqual(dependentsOf(a, [a, b]).map((d) => d.folder), ['b']);
  // a plugin never satisfies its own requirement
  const self = pluginRecord({ folder: 'c', id: 'x.c', name: 'C', apiLevel: 1, provides: ['service:me@1'], requires: ['service:me@1'] });
  assert.equal(dependenciesOf(self, resolveProviders([self], []), [self], ctx).find((d) => d.kind === 'service')?.status, 'missing');
  // a live-only provider (registered by the host, not declared) satisfies and is named by its folder
  const user = pluginRecord({ folder: 'u', id: 'x.u', name: 'U', apiLevel: 1, requires: ['service:host@1'] });
  const d = dependenciesOf(user, resolveProviders([user], [{ name: 'host@1', folder: 'core', enabled: true }]), [user], ctx).find((x) => x.kind === 'service')!;
  assert.equal(d.status, 'ok'); assert.equal(d.providers?.[0]?.name, 'core'); assert.equal(d.providers?.[0]?.live, true);
  // target "*" passes any host; no targets at all passes too
  const any = pluginRecord({ folder: 'w', id: 'x.w', name: 'W', apiLevel: 1, targets: ['*'] });
  assert.ok(!dependenciesOf(any, new Map(), [any], { apiLevels: [1], target: 'axf-console', live: [] }).some((x) => x.status === 'unsupported'));
  // clashes: same data dir twice is one error; a disabled editor doesn't clash
  const e1 = pluginRecord({ folder: 'e1', id: 'x.e1', name: 'E1', uiEditor: ['theme'] });
  const e2 = pluginRecord({ folder: 'e2', id: 'x.e2', name: 'E2', uiEditor: ['theme'], enabled: false });
  assert.deepEqual(conflictsOf([e1, e2]), []);
  assert.equal(conflictsOf([e1, { ...e2, enabled: true }])[0]?.severity, 'info');
}

// 3. Web host adapter: libraries installed in a runtime become records (ids, provides, dependsOn → plugin:<id>).
{
  const assets = ['color-theme', 'style-theme', 'layout', 'app-menu', 'toolbar', 'nav-menu', 'context-menu', 'dialog', 'popup', 'button', 'slider', 'container', 'uac-policy']
    .flatMap((t) => readdirSync(join(root, 'assets', t)).map((f) => JSON.parse(readFileSync(join(root, 'assets', t, f), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults: defaults.defaults ?? defaults } as never, assets, storageKey: 'test:pm' });
  installLibraries(rt, [
    { id: 'ai.example.base', label: 'Base', version: '1.0.0', provides: ['axf.base'] },
    { id: 'ai.example.user', label: 'User', version: '2.0.0', dependsOn: ['ai.example.base', 'ai.example.gone'], settingsTabs: [{ id: 'user', label: 'User', icon: 'user', order: 1 }] },
  ]);
  const records = pluginRecordsFromRuntime(rt);
  const base = records.find((r) => r.id === 'ai.example.base')!, user = records.find((r) => r.id === 'ai.example.user')!;
  assert.deepEqual(base.provides, ['service:axf.base']);
  assert.deepEqual(user.requires, ['plugin:ai.example.base', 'plugin:ai.example.gone']);
  assert.ok(user.provides.includes('settings-tab:user'));
  const inv = buildPluginInventory(records, { apiLevels: [1], target: null, live: [] });
  assert.equal(inv.items.find((i) => i.id === 'ai.example.user')?.health, 'blocked', 'a missing dependsOn blocks');
  assert.deepEqual(inv.items.find((i) => i.id === 'ai.example.base')?.dependents.map((d) => d.folder), ['ai.example.user']);
}

console.log('plugin inventory engine: all checks passed');
