/**
 * Every floating window is resizable (window-resize-fix, Nov 3 2026, Brett: "All floating windows need to be
 * resizable"). Renders FloatingWindowsHost through react-dom/server against the baked framework with a standard, a
 * frameless (the Terminal's frame) and a maximized window and checks: each non-maximized window has its grips layer with
 * all 8 handles, on the window's rect, in the same layer as the window (so dialogs, menus and toasts stay above every
 * window however often one is focused); a maximized window has none. Also checks the stylesheet keeps the handles
 * touch-ready, and that settings.open:<tab> opens a plugin's tab in a dialog when its "Opens in" is dialog.
 *   cd apps/console-web && npx tsx scripts/window-handles-check.mts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { AxfRuntime } from '../src/axf/core/runtime';
import { RESIZE_EDGES } from '../src/axf/core/engines/windows';
import { AxfProvider } from '../src/axf/react/AxfProvider';
import { FloatingWindowsHost } from '../src/axf/react/windows/WindowHost';
import { library as settingsLibrary } from '../src/axf/libs/settings';

const assetsDir = new URL('../../../framework/assets/', import.meta.url).pathname;
const assets = readdirSync(assetsDir).flatMap((t) => readdirSync(assetsDir + t).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(readFileSync(assetsDir + t + '/' + x, 'utf8'))));
const defaults = JSON.parse(readFileSync(new URL('../../../framework/defaults.json', import.meta.url), 'utf8'));
const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:window-handles' });
let checks = 0;
const error = console.error; console.error = (...a: unknown[]) => { if (!String(a[0]).includes('useLayoutEffect does nothing on the server')) error(...a); };
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };

const wm = rt.windows;
const tab = (id: string) => [{ id, title: id, kind: 'placeholder', payload: '' }];
const std = wm.openFloating(tab('std'), 'Standard', 'floating', 400, 300, 10, 20);
const bare = wm.openFloating(tab('bare'), 'Terminal', 'floating', 500, 320, 40, 60, { frame: 'frameless', minWidth: 320, minHeight: 200 });
const big = wm.openFloating(tab('big'), 'Maximized', 'floating', 300, 200, 0, 0);
wm.toggleMaximize(big);
for (let i = 0; i < 20; i++) wm.focus(i % 2 ? std : bare); // z climbs; the layer must not

const html = renderToString(h(AxfProvider, { runtime: rt }, h(FloatingWindowsHost)));
const grips = (id: string) => { const m = html.match(new RegExp(`<div class="fx-window__grips[^"]*" style="([^"]*)" data-fx-window-grips="${id}">(.*?)</div></div>`)); return m ? { style: m[1]!, body: m[2]! } : null; };
const winStyle = (id: string) => html.match(new RegExp(`<div class="fx-window [^"]*" style="([^"]*)"[^>]*data-fx-window="${id}"`))?.[1] ?? '';
for (const [id, label] of [[std, 'standard'], [bare, 'frameless']] as const) {
  const g = grips(id);
  ok(g, `${label} window has a grips layer`);
  for (const e of RESIZE_EDGES) ok(g!.body.includes(`fx-window__edge fx-window__edge--${e}"`), `${label} window has the ${e} handle`);
  const w = wm.state.windows.find((x) => x.id === id)!;
  ok(g!.style.includes(`left:${w.x}px`) && g!.style.includes(`top:${w.y}px`) && g!.style.includes(`width:${w.width}px`) && g!.style.includes(`height:${w.height}px`), `${label} grips sit on the window's rect`);
  ok(/z-index:60(;|$)/.test(g!.style) && /z-index:60(;|$)/.test(winStyle(id)), `${label} window and grips stay in the window layer (z ${w.z})`);
}
ok(!grips(big) && html.includes(`data-fx-window="${big}"`), 'a maximized window has no handles');

// move grip (terminal-drag-chain-tree): a frameless window always has something to drag it by; a standard one has its title bar
const win = (id: string) => html.match(new RegExp(`<div class="fx-window [^"]*"[^>]*data-fx-window="${id}">(.*?)<div class="fx-window__body"`))?.[1] ?? '';
ok(win(bare).includes('fx-window__grip fx-window__grip--float'), 'a frameless window with no grip of its own gets the host grip');
ok(!win(std).includes('fx-window__grip'), 'a standard window has no extra grip (its title bar drags)');
// the stylesheet: handles take touch, straddle the border and get a finger-sized band on coarse pointers
const css = readFileSync(new URL('../src/axf/ui/axf.css', import.meta.url), 'utf8');
ok(/\.fx-window__edge \{[^}]*touch-action: none/.test(css), 'handles set touch-action: none');
ok(/@media \(pointer: coarse\) \{ \.fx-window__edge \{ --fx-win-handle: var\(--fx-row-h\)/.test(css), 'touch band is a row height');
ok(/\.fx-window__grips > \.fx-window__edge \{ pointer-events: auto/.test(css), 'grips layer passes pointers only to its handles');
ok(/\.fx-window__grips > \.fx-window__edge--se::after/.test(css), 'every frame shows a corner grip');
ok(/@media \(pointer: coarse\) \{ \.fx-window__grip \{ min-width: max\(var\(--fx-row-h\), calc\(var\(--fx-space\) \* 5\.5\)\)/.test(css), 'the move grip is a 44 px target on touch screens (tokens)');
ok(/\.fx-window__grip \{[^}]*touch-action: none[^}]*position: sticky; left: 0/.test(css), 'the grip takes touch and stays put while a full tab strip scrolls');
const backdrop = Number(css.match(/\.fx-backdrop \{[^}]*z-index: (\d+)/)?.[1]);
ok(backdrop > 60, `dialog backdrop (${backdrop}) is above the window layer`);

// settings.open:<tab> follows the owning plugin's "Opens in": dialog = that tab in a dialog, main = the settings page
settingsLibrary.register?.(rt);
rt.settings.addTab({ id: 'probe-tab', label: 'Probe', icon: 'settings', order: 1, module: 'probe.plugin' });
rt.setPlacement('probe.plugin', { kind: 'dialog', id: 'probe.dialog' }, 'dialog', 'Probe');
// settings-placement@1 (Nov 3 / Nov 4 2026): the opening lands on a settings surface (a pop-up dialog drawn by
// SettingsPageSurfaces with its look and animation), not on the dialog host
const { openSurfaces, closeSettingsSurface, dropSettingsSurface } = await import('../src/axf/react/settingsHost');
rt.dispatch('settings.open:probe-tab');
const opened = openSurfaces().find((s) => s.owner === 'probe.plugin' && s.tab === 'probe-tab');
ok(!!opened && opened.route.via === 'dialog', `placement dialog opens the tab in a pop-up dialog (${opened?.route.via})`);
closeSettingsSurface(); if (opened) dropSettingsSurface(opened.key);
rt.settings.set('axf.placement.probe.plugin', 'main');
rt.dispatch('settings.open:probe-tab');
ok(!rt.getState().dialog && !openSurfaces().length && rt.getState().view === 'settings', 'placement main opens the settings page');
// the "Opens in" choice says it also decides where the plugin's settings open, and names the plugin
const { installLibraries } = await import('../src/axf/react/library');
installLibraries(rt, [{ id: 'probe.term', label: 'Probe Terminal', opens: 'window', dialogs: { 'probe.term.open': { title: 'Open a tab', render: () => null } }, settingsTabs: [{ id: 'probe-term', label: 'Probe Terminal' }] } as never]);
const desc = rt.settings.groupsIn('probe-term').find((g) => g.id === 'probe.term.placement')?.description ?? '';
ok(/^Where Probe Terminal \(Open a tab\) opens, and where these settings open/.test(desc), `"Opens in" wording: ${desc.slice(0, 80)}`);
console.log(`window-handles-check: ${checks} checks passed`);
