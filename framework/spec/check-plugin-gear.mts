/**
 * PluginSettingsGear + PluginScreenHeader in a DOM (jsdom; plugin-settings@1, build settings-interface-gear-every-plugin):
 *   the header is the framework page header with a labelled tools strip · one gear, a framework IconButton, labelled
 *   "<Plugin> settings", carrying data-axf-target and the sub-tab address · pressing it runs console control's `open` on
 *   view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=<tab> (the API's command), which opens the plugin's
 *   sub-tab · the gear is reachable as a button target (list, state, press) · without the sub-tab it falls back to
 *   settings.open:<tab> · a bad tab id draws nothing · in a host's settings page the header is not drawn · the files
 *   carry no literal colour or size (check-theme) · the plugin template uses the header · exports.
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-plugin-gear.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const W = dom.window as unknown as Record<string, unknown> & Window;
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'matchMedia', 'StorageEvent'] as const) {
  const v = W[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
const mm = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
(W as unknown as { matchMedia: unknown }).matchMedia = mm;
g.matchMedia = mm;
g.IS_REACT_ACT_ENVIRONMENT = true;
const quiet = console.error;
console.error = (...a: unknown[]) => { if (!/not wrapped in act/.test(String(a[0]))) quiet(...a); };
(W.Element as unknown as { prototype: Element }).prototype.scrollIntoView = function () {};

const React = await import('react');
g.React = React;
const { createElement: h, act } = React;
const { createRoot } = await import('react-dom/client');
const { AxfRuntime } = await import('../core/runtime.ts');
const { AxfProvider } = await import('../react/AxfProvider.tsx');
const { ControlScope, controlRegistry } = await import('../react/controlTargets.ts');
const { PluginSettingsGear, pluginSettingsGearAddress, pluginSettingsGearId, pluginSettingsGearLabel } = await import('../react/components/PluginSettingsGear.tsx');
const { PluginScreenHeader } = await import('../react/components/PluginScreenHeader.tsx');
const P = await import('../core/plugin-settings.mjs');
const index = await import('../react/index.ts');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const doc = W.document as Document;
const $ = (sel: string) => doc.querySelector<HTMLElement>(sel);
const click = (el: Element) => el.dispatchEvent(new (W.MouseEvent as typeof MouseEvent)('click', { bubbles: true, cancelable: true }));

const root = new URL('../', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const manifest = { app: { id: 'test', name: 'Test' }, defaults, startView: 'voice-notes' } as never;
const TAB = 'voice-notes';
const ADDRESS = P.settingsAddress(TAB);

/** A runtime with the settings tabs a console has: Plugins and the plugin's sub-tab, and the settings library's open action. */
function makeRuntime(embed: Record<string, unknown> | null, withTab = true) {
  const rt = new AxfRuntime({ manifest, assets, storageKey: `axf-test:gear:${Math.random()}`, embed: embed as never });
  const opened: string[] = [];
  rt.actions.register('settings.open', ([tab]) => { opened.push(String(tab)); rt.navigate('settings'); }, { label: 'Open a settings tab' });
  rt.actions.register('app.settings', () => { rt.navigate('settings'); }, { label: 'Settings' });
  rt.settings.addTab({ id: 'plugins', label: 'Plugins', icon: 'package', order: 50, module: 'test' });
  if (withTab) rt.settings.addTab({ id: TAB, label: 'Voice notes', icon: 'mic', order: 60, parent: 'plugins', module: 'test' });
  return { rt, opened };
}
async function mount(rt: InstanceType<typeof AxfRuntime>, node: React.ReactNode) {
  const el = doc.getElementById('root')!;
  el.innerHTML = '';
  const r = createRoot(el);
  await act(async () => { r.render(h(AxfProvider, { runtime: rt } as never, node)); });
  await act(async () => { await sleep(120); });
  return r;
}

/* ---- 1. unit: ids, addresses, labels ---- */
check(pluginSettingsGearId(TAB) === 'plugin-settings-gear-voice-notes', 'gear id is plugin-settings-gear-<tab>');
check(pluginSettingsGearAddress(TAB) === 'button:plugin-settings-gear-voice-notes', 'gear address is button:plugin-settings-gear-<tab>');
check(pluginSettingsGearLabel('Voice notes', TAB) === 'Voice notes settings' && pluginSettingsGearLabel(undefined, TAB) === 'voice-notes settings', 'label is "<Plugin> settings", the tab id when no name');
check(ADDRESS === 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=voice-notes', 'the sub-tab address the gear opens');
const fixture = JSON.parse(readFileSync(join(root, 'spec/fixtures/plugin-settings.json'), 'utf8'));
// the fixture's examples use fictional folders (sample-notes): the same address with that tab id
check(fixture.out.address['sample-notes']?.address === ADDRESS.replace(`=${TAB}`, '=sample-notes'), 'the fixture carries the same address');

/* ---- 2. the header in a plugin view ---- */
{
  const { rt, opened } = makeRuntime(null);
  const r = await mount(rt, h(ControlScope, { address: 'view:voice-notes' },
    h(PluginScreenHeader, { tab: TAB, title: 'Voice notes', lede: '3 saved', actions: h('button', { type: 'button', className: 'fx-btn', 'data-axf-target': 'button:fetch', onClick() {} }, 'Fetch now') },
      h('p', { className: 'fx-muted axp-test-extra' }, 'extra line'))));
  const header = $('header.fx-pagehead');
  check(!!header && header.getAttribute('data-axf-plugin-header') === TAB, 'a framework page header, marked with the plugin tab');
  check(header?.querySelector('h1')?.textContent === 'Voice notes' && header?.querySelector('.fx-eyebrow')?.textContent === 'Plugin' && header?.querySelector('.fx-muted')?.textContent === '3 saved', 'eyebrow, title and lede');
  check(header?.querySelector('.axp-test-extra')?.textContent === 'extra line' && header?.querySelector('.axp-test-extra')?.parentElement === header?.firstElementChild, 'children go in the title block');
  const tools = header?.querySelector<HTMLElement>('.fx-pagehead__tools');
  check(tools?.getAttribute('role') === 'toolbar' && tools?.getAttribute('aria-label') === 'Voice notes tools' && tools?.getAttribute('data-axf-toolbar') === `plugin-header.${TAB}`, 'tools strip: role=toolbar, aria-label, settings id');
  const gears = doc.querySelectorAll('.fx-plugin-gear');
  check(gears.length === 1, `one gear on the screen (${gears.length})`);
  const gear = tools?.querySelector<HTMLButtonElement>(`#${pluginSettingsGearId(TAB)}`);
  check(!!gear && gear.tagName === 'BUTTON' && gear.classList.contains('fx-iconbtn') && gear.classList.contains('fx-plugin-gear'), 'the gear is a framework IconButton');
  check(gear?.getAttribute('aria-label') === 'Voice notes settings' && gear?.getAttribute('title') === 'Voice notes settings', 'aria-label and tooltip "Voice notes settings"');
  check(gear?.getAttribute('data-axf-target') === pluginSettingsGearAddress(TAB) && gear?.getAttribute('data-axf-opens') === ADDRESS && gear?.getAttribute('data-axf-plugin-settings') === TAB, 'data-axf-target, the address it opens, the tab');
  check(gear?.querySelector('svg') !== null, 'draws the settings icon');
  check(tools?.lastElementChild === gear && tools?.firstElementChild?.textContent === 'Fetch now', 'the screen\'s own actions come first, the gear last');
  check(!gear?.getAttribute('style') && !tools?.getAttribute('style') && !header?.getAttribute('style'), 'no inline styles: every size and colour is a token in axf.css');

  // console control knows the gear and the sub-tab
  const reg = controlRegistry(rt);
  const GEAR = `view:voice-notes/${pluginSettingsGearAddress(TAB)}`;
  const list = await reg.run({ verb: 'list' });
  const targets = (list as { targets?: { address: string; kind: string; label: string; parent?: string }[] }).targets ?? [];
  const mine = targets.find((t) => t.address === GEAR);
  check(!!mine && mine.kind === 'button' && mine.label === 'Voice notes settings' && mine.parent === 'view:voice-notes', `the gear is listed under its view as a button (${JSON.stringify(mine)})`);
  check(targets.some((t) => t.address === ADDRESS && t.kind === 'subtab'), 'the sub-tab it opens is listed too');
  const state = await reg.run({ verb: 'state', address: GEAR });
  check(state.ok === true && (state as { state?: { disabled?: boolean; onScreen?: boolean } }).state?.disabled === false && (state as { state?: { onScreen?: boolean } }).state?.onScreen === true, `state: enabled, on screen (${JSON.stringify(state)})`);
  const sub = await reg.run({ verb: 'state', address: ADDRESS });
  check(sub.ok === true && (sub as { state?: { kind?: string } }).state?.kind === 'subtab', 'the sub-tab address resolves to a subtab');

  // a finger presses it → console control opens the sub-tab: Settings → Plugins first, then the plugin's tab
  await act(async () => { click(gear!); await sleep(150); });
  check(opened.join(',') === `plugins,${TAB}`, `settings.open: Plugins, then ${TAB} (${opened.join(',')})`);
  check(rt.getState().view === 'settings', 'the app is on Settings');

  // the API presses it the same way
  rt.navigate('voice-notes');
  await act(async () => { await sleep(80); });
  const pressed = await reg.run({ verb: 'press', address: GEAR });
  await act(async () => { await sleep(150); });
  check(pressed.ok === true && (pressed as { pressed?: string }).pressed === GEAR && opened.join(',') === `plugins,${TAB},plugins,${TAB}` && rt.getState().view === 'settings', `press through console control opens the sub-tab too (${JSON.stringify(pressed)})`);
  await act(async () => { r.unmount(); });
}

/* ---- 2b. the gear alone reports what it opened ---- */
{
  const { rt, opened } = makeRuntime(null);
  let got: { address: string; ok: boolean } | null = null;
  const r = await mount(rt, h(PluginSettingsGear, { tab: TAB, plugin: 'Voice notes', onOpened: (x) => { got = x; } }));
  const gear = $(`#${pluginSettingsGearId(TAB)}`);
  await act(async () => { click(gear!); await sleep(150); });
  await sleep(200);
  check(got !== null && (got as unknown as { ok: boolean }).ok === true && (got as unknown as { address: string }).address === ADDRESS, `onOpened: console control opened the sub-tab address (${JSON.stringify(got)})`);
  check(opened.join(',') === `plugins,${TAB}`, 'no second open through the fallback when console control succeeded');
  await act(async () => { r.unmount(); });
}

/* ---- 3. without the sub-tab registered: the fallback action ---- */
{
  const { rt, opened } = makeRuntime(null, false);
  let got: { ok: boolean } | null = null;
  const r = await mount(rt, h(PluginSettingsGear, { tab: TAB, plugin: 'Voice notes', onOpened: (x) => { got = x; } }));
  const gear = $(`#${pluginSettingsGearId(TAB)}`);
  await act(async () => { click(gear!); await sleep(150); });
  check(got !== null && (got as unknown as { ok: boolean }).ok === false && opened.length === 1 && opened[0] === TAB, 'no sub-tab yet: falls back to settings.open:<tab>');
  await act(async () => { r.unmount(); });
}

/* ---- 4. a bad tab id draws nothing; no gear when asked ---- */
{
  const { rt } = makeRuntime(null);
  const r = await mount(rt, h('div', null, h(PluginSettingsGear, { tab: 'Voice Notes' }), h(PluginScreenHeader, { tab: TAB, title: 'Quiet', gear: false })));
  check(!$('.fx-plugin-gear'), 'a tab id that is no id draws no gear; gear=false draws none');
  check($('header.fx-pagehead .fx-pagehead__tools')?.getAttribute('role') === 'toolbar', 'the tools strip is still a toolbar');
  await act(async () => { r.unmount(); });
}

/* ---- 5. inside a host's settings page the header is not drawn ---- */
{
  const { rt } = makeRuntime({ host: 'host', hidden: ['banner'], page: 'settings' });
  const r = await mount(rt, h(PluginScreenHeader, { tab: TAB, title: 'Voice notes' }));
  check(!$('header.fx-pagehead'), 'embed@1 page mode: no header, no gear (the host shows the plugin\'s settings)');
  await act(async () => { r.unmount(); });
}

/* ---- 6. static: tokens only, exports, template ---- */
{
  const files = ['react/components/PluginSettingsGear.tsx', 'react/components/PluginScreenHeader.tsx'].map((f) => join(root, f));
  let themeOk = true, out = '';
  try { out = execFileSync('node', [join(root, 'cli/check-theme.mjs'), ...files], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { themeOk = false; out = String((e as { stdout?: string }).stdout ?? e); }
  check(themeOk, `check-theme passes on the components: ${out.trim().split('\n').slice(-3).join(' | ')}`);
  const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  check(!/style=\{/.test(src) && !/#[0-9a-fA-F]{3,8}\b/.test(src) && !/\d+px/.test(src), 'no inline style, literal colour or px in the components');
  const css = readFileSync(join(root, 'ui/axf.css'), 'utf8');
  check(/\.fx-pagehead__tools \{[^}]*var\(--fx-dens-gap-md\)/.test(css), 'axf.css lays the tools strip out with the density gap token');
  check(typeof index.PluginSettingsGear === 'function' && typeof index.PluginScreenHeader === 'function' && index.pluginSettingsGearAddress(TAB) === pluginSettingsGearAddress(TAB), 'exported from the framework React index');
  const tpl = readFileSync(join(root, '../apps/console-web/plugins/_template/web/index.tsx'), 'utf8');
  check(/<PluginScreenHeader tab="example" title="Example"/.test(tpl) && !/<header className="fx-pagehead"/.test(tpl), 'the plugin template renders the header slot, not a hand-made header');
  const tplManifest = JSON.parse(readFileSync(join(root, '../apps/console-web/plugins/_template/plugin.json'), 'utf8'));
  check(P.checkSettings(tplManifest, { folder: 'apps/console-web/plugins/_template' }).length === 0 && tplManifest.settings.gear === true, 'the template manifest declares plugin-settings@1 with the gear');
}

console.log(`${fail ? '✗' : '✓'} plugin gear: ${ok} ok, ${fail} failed`);
if (fail) process.exit(1);
