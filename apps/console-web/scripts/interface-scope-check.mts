/**
 * Renders a tiny tree with two <InterfaceScope>s through react-dom/server against the baked framework and checks
 * that each subtree reads its own interface while the app keeps its own (no leak either way).
 *   cd apps/console-web && npx tsx scripts/interface-scope-check.mts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { AxfRuntime } from '../src/axf/core/runtime';
import { AxfProvider, useAsset, useRuntime } from '../src/axf/react/AxfProvider';
import { InterfaceScope, useScopeId } from '../src/axf/react/components/InterfaceScope';

const assetsDir = new URL('../../../framework/assets/', import.meta.url).pathname;
const assets = readdirSync(assetsDir).flatMap((t) => readdirSync(assetsDir + t).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(readFileSync(assetsDir + t + '/' + x, 'utf8'))));
const defaults = JSON.parse(readFileSync(new URL('../../../framework/defaults.json', import.meta.url), 'utf8'));
const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:scope' });

function Probe({ label }: { label: string }) {
  const r = useRuntime();
  const style = useAsset('style-theme');
  return h('span', { 'data-probe': label, 'data-style': style.id, 'data-scope': useScopeId(), 'data-iface': r.getState().active['interface'] ?? '' });
}
const html = renderToString(h(AxfProvider, { runtime: rt },
  h(Probe, { label: 'app' }),
  h(InterfaceScope, { id: 'tab-amber', interface: 'amber' }, h(Probe, { label: 'amber' })),
  h(InterfaceScope, { id: 'tab-fresh', interface: 'fresh' }, h(Probe, { label: 'fresh' })),
  h(InterfaceScope, { id: 'bad', interface: 'nope' }, h(Probe, { label: 'unscoped' })),
));
const probe = (label: string) => { const m = html.match(new RegExp(`<span data-probe="${label}" data-style="([^"]*)" data-scope="([^"]*)" data-iface="([^"]*)"`)); assert.ok(m, `probe ${label}`); return { style: m![1], scope: m![2], iface: m![3] }; };
assert.deepEqual(probe('app'), { style: defaults['style-theme'], scope: '', iface: 'fresh' });
assert.deepEqual(probe('amber'), { style: 'glass-orbit', scope: 'tab-amber', iface: 'amber' });
assert.deepEqual(probe('fresh'), { style: 'fresh', scope: 'tab-fresh', iface: 'fresh' });
assert.deepEqual(probe('unscoped'), { style: defaults['style-theme'], scope: '', iface: 'fresh' });
assert.ok(html.includes('data-fx-scope="tab-amber"') && html.includes('data-fx-interface="amber"'), 'scope root attributes');
assert.ok(html.includes('<style>[data-fx-scope=&quot;tab-amber&quot;] { --fx-'), 'scope css rooted under the scope');
assert.equal(rt.getState().active['style-theme'], defaults['style-theme'], 'the app itself is untouched');
console.log('interface-scope-check: 7 checks passed');
