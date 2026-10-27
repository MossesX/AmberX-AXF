/*
 * ezgrid + ezfilter on Pending builds (toolbar-binding@1, Oct 27 2026):
 *
 *   npx -y tsx framework/spec/check-attached-toolbars.mts
 *
 * Builds a runtime from the console's own assets, registers the pending list as an attach target the way
 * views/Pending.tsx does, renders <AttachedToolbars target="console.pending-list"> to HTML and checks what a person
 * sees: five status tiles (icon, name, corner count, the active one pressed), then the sort chips (active + direction),
 * and that picking an item reaches the list, not the action bus.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AxfRuntime } from '../core/runtime';
import type { ToolbarItemCall } from '../core/engines/toolbar';
import { AxfProvider, AttachedToolbars } from '../react';

// AxfProvider applies tokens in a layout effect: harmless here (no DOM), so keep React's server warning out of the log
const warn = console.error; console.error = (m: unknown, ...a: unknown[]) => { if (!String(m).includes('useLayoutEffect')) warn(m, ...a); };
// framework/react is compiled here without a JSX runtime setting (classic): give it React
(globalThis as { React?: unknown }).React = React;
const app = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'console-web');
const assetsDir = join(app, 'src/assets');
const assets = readdirSync(assetsDir).filter((t) => statSync(join(assetsDir, t)).isDirectory())
  .flatMap((t) => readdirSync(join(assetsDir, t)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(assetsDir, t, f), 'utf8'))));
const manifest = JSON.parse(readFileSync(join(app, 'axf.manifest.json'), 'utf8'));
const rt = new AxfRuntime({ manifest, assets, storageKey: 'check:pending-toolbars' });
let n = 0;
const ok = (c: unknown, what: string) => { assert.ok(c, what); n++; };

ok(rt.loadErrors.length === 0, `console assets load: ${JSON.stringify(rt.loadErrors)}`);
const attached = rt.toolbarsFor('console.pending-list').map((t) => t.id);
ok(attached.join() === 'ezfilter,ezgrid', `ezfilter then ezgrid are attached to the pending list (${attached})`);
ok(rt.asset('toolbar').id !== 'ezgrid' && rt.asset('toolbar').id !== 'ezfilter', 'neither is the app toolbar');

// the pending list as Pending.tsx registers it
const counts: Record<string, number> = { pending: 32, unsafe: 0, broken: 0, failed: 1, complete: 45 };
let sort = 'status', dir: 'asc' | 'desc' = 'asc', filter = 'pending';
const calls: ToolbarItemCall[] = [];
rt.registerAttachTarget('console.pending-list', {
  kind: 'list',
  run: (c) => { calls.push(c); if (c.kind === 'sort') { if (c.value === sort) dir = dir === 'asc' ? 'desc' : 'asc'; else { sort = c.value!; dir = 'desc'; } } if (c.kind === 'filter') filter = filter === c.value ? '' : c.value!; return true; },
  state: (c) => c.kind === 'sort' ? (sort === c.value ? { active: true, dir } : { active: false }) : c.kind === 'filter' ? { active: filter === c.value, count: counts[c.value!] ?? 0 } : undefined,
});

const html = () => renderToStaticMarkup(createElement(AxfProvider, { runtime: rt }, createElement(AttachedToolbars, { target: 'console.pending-list' })));
let out = html();
ok(out.includes('data-axf-toolbar-asset="ezfilter"') && out.indexOf('ezfilter') < out.indexOf('ezgrid'), 'filter tiles render above the sort chips');
for (const [s, label] of [['pending', 'Pending'], ['unsafe', 'Unsafe'], ['broken', 'Broken'], ['failed', 'Failed'], ['complete', 'Complete']]) {
  const tile = out.match(new RegExp(`<button[^>]*data-axf-toolbar-item="${s}"[^>]*>(.*?)</button>`))?.[0] ?? '';
  ok(tile.includes('fx-toolbtn--tile') && tile.includes('fx-icon') && tile.includes(`>${label}<`), `${label} tile: icon + text`);
  ok(tile.includes(`fx-toolbtn__badge${counts[s] ? '' : ' is-zero'}`) && tile.includes(`>${counts[s]}</span>`), `${label} tile: corner badge ${counts[s]}`);
}
ok(/data-axf-toolbar-item="pending"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-axf-toolbar-item="pending"/.test(out), 'the active filter is pressed');
ok(out.includes('Sort by') && out.includes('fx-toolbtn--chip'), 'ezgrid: "Sort by" + chips');
ok(/is-active[^>]*data-axf-toolbar-item="status"/.test(out), 'the active sort is highlighted');

// picking items reaches the list
rt.runToolbarItem('console.pending-list', { toolbar: 'ezgrid', item: 'added', kind: 'sort', action: 'pending.sort:added', value: 'added' });
rt.runToolbarItem('console.pending-list', { toolbar: 'ezfilter', item: 'pending', kind: 'filter', action: 'pending.filter:pending', value: 'pending' });
ok(sort === 'added' && dir === 'desc' && filter === '' && calls.length === 2, 'sort + filter picks went to the list (tap the active filter again = all)');
out = html();
const added = out.match(/<button[^>]*data-axf-toolbar-item="added"[^>]*>(.*?)<\/button>/)?.[0] ?? '';
ok(added.includes('is-active') && (added.match(/<svg/g) ?? []).length === 1 && added.includes('M6 9l6 6 6-6'), 'redraw: Date added active, with its down arrow (labels only: no item icon)');

// a plugin can't slip an unbound toolbar in
const bare = { $axf: 'asset@1', type: 'toolbar', id: 'plugin-bar', name: 'Plugin bar', version: '1.0.0', data: { variant: 'icons', align: 'start', showSearch: false, groups: [] } };
ok(!rt.registry.registerPluginAsset(bare, 'ai.amberx.axf.console.x').ok, 'a plugin toolbar without owner + attach is refused');
ok(rt.registry.registerPluginAsset({ ...bare, data: { ...bare.data, owner: { kind: 'plugin', plugin: 'ai.amberx.axf.console.x' }, attach: { target: 'console.pending-list', kind: 'list', at: 'bottom' } } }, 'ai.amberx.axf.console.x').ok, 'a bound plugin toolbar registers');
ok(rt.pluginToolbars('ai.amberx.axf.console.x').length === 1 && rt.toolbarsFor('console.pending-list', 'top').length === 2, 'it belongs to its plugin and sits at the bottom side');

console.log(`pending toolbars: ${n} checks ok`);
