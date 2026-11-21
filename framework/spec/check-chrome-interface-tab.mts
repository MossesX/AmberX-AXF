/**
 * The Interface tab of a chrome Settings… dialog edits the chrome it was opened for (build
 * fix-banner-settings-interface-tab, Nov 17 2026; Brett: "why does the settings interface tab of the banner change just
 * the interface of the settings itself? what's the point of that").
 *
 * Renders the real settings dialog (chromeDialogs['axf.chrome.settings']) in a DOM (jsdom) for each chrome instance,
 * opens its Interface tab and drives every control on it. For each kind:
 *   - the Interface tab has controls for the instance (not the settings window)
 *   - every change writes only that instance's keys: `axf.chrome.<type>.<id>` and `axf.chrome.<type>.<id>.*`
 *   - the settings window's own keys (`axf.chrome.settings.<type>`, `.patch`) and its resolved layout stay unchanged
 *   - the instance renders with the change at once (rt.chromeData / rt.banner() / the tab row's data), no reload
 *
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-chrome-interface-tab.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const W = dom.window as unknown as Record<string, unknown> & Window;
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'StorageEvent'] as const) {
  const v = W[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
const mm = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
(W as unknown as { matchMedia: unknown }).matchMedia = mm;
g.matchMedia = mm;
g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
g.IS_REACT_ACT_ENVIRONMENT = true;
const quiet = console.error;
console.error = (...a: unknown[]) => { if (!/not wrapped in act/.test(String(a[0]))) quiet(...a); };

const React = await import('react');
g.React = React;
const { createElement: h, act } = React;
const { createRoot } = await import('react-dom/client');
const { AxfRuntime } = await import('../core/runtime.ts');
const { AxfProvider } = await import('../react/AxfProvider.tsx');
const { Banner } = await import('../react/components/Banner.tsx');
const { PageToolbar } = await import('../react/components/Toolbar.tsx');
const { Toolbar, NavMenu, MenuBar } = await import('../react/components/Chrome.tsx');
const { TabGroup, tabGroupDataFor } = await import('../react/components/TabGroup.tsx');
const { tapConfigFor } = await import('../core/engines/tapconfirm.ts');
const row = () => h(TabGroup, { id: 'demo.sections', label: 'Demo sections', value: 'a', onChange: () => {}, tabs: [{ value: 'a', label: 'Alpha', icon: 'home' }, { value: 'b', label: 'Beta', icon: 'list' }] }, h('p', null, 'body'));
const views = { home: { title: 'Home', icon: 'home', render: () => h('p', null, 'home') } };
/** The drawn chrome's markup plus the root tokens the runtime compiled: what a look change must move. */
const seenOf = (sel: string) => () => `${[...doc.querySelectorAll(sel)].map((e) => e.outerHTML.slice(0, 600)).join('')}|${doc.documentElement.getAttribute('style') ?? ''}|${[...doc.documentElement.attributes].map((a) => `${a.name}=${a.value}`).join(' ')}`;
const { chromeDialogs, CHROME_SETTINGS_DIALOG, chromeSettingsUi, installChrome } = await import('../react/components/ChromeContext.tsx');
const cs = await import('../core/engines/chrome-settings-rules.mjs');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const doc = W.document as Document;
const click = (el: Element) => el.dispatchEvent(new (W.MouseEvent as typeof MouseEvent)('click', { bubbles: true, cancelable: true }));

const root = new URL('../', import.meta.url).pathname;
const shipped = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
// a page toolbar scoped to a view (page-toolbar@1): its settings instance is the page's settings id (`demo`), not its asset id
const pageTb = shipped.find((a) => a.type === 'toolbar' && a.id === 'data-grid-tools');
const assets = [...shipped, { ...pageTb, id: 'demo-page-tools', name: 'Demo page tools', data: { ...pageTb.data, scope: 'view:demo' } }];
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));

type ChromeType = (typeof cs.CHROME_TYPES)[number];
/** What the instance renders with right now (the data its component draws from). */
type Case = {
  type: ChromeType; instance: string; rendered: (rt: InstanceType<typeof AxfRuntime>) => unknown;
  /** The instance itself, drawn beside the dialog, and what of it shows a look change (its markup + the root tokens). */
  draw?: () => unknown; seen?: () => string;
};
export const CASES: Case[] = [
  { type: 'banner', instance: 'app', rendered: (rt) => rt.banner({ all: true }).data, draw: () => h(Banner), seen: seenOf('.fx-banner') },
  { type: 'toolbar', instance: 'app', rendered: (rt) => rt.chromeData('toolbar'), draw: () => h(Toolbar, { views }), seen: seenOf('[role="toolbar"]') },
  { type: 'tab-group', instance: 'demo.sections', rendered: (rt) => ({ data: tabGroupDataFor(rt, 'demo.sections'), tap: tapConfigFor((k) => rt.settings.get(k), 'tab-group', 'demo.sections'), tapChoice: cs.chromeFieldValue('tab-group', null, rt.settings.get(cs.CHROME_INSTANCE_KEY('tab-group', 'demo.sections')), cs.CHROME_TAP_FIELD) }), draw: row, seen: seenOf('[data-axf-tab-group="demo.sections"]') },
  { type: 'nav-menu', instance: 'app', rendered: (rt) => rt.chromeData('nav-menu'), draw: () => h(NavMenu, { views }), seen: seenOf('[data-fx-ctx-target="nav"], nav') },
  { type: 'app-menu', instance: 'app', rendered: (rt) => rt.chromeData('app-menu'), draw: () => h(MenuBar), seen: seenOf('[role="menubar"]') },
  // the context menu draws only while open: its data (what the open menu reads) and the root tokens must follow
  { type: 'context-menu', instance: 'app', rendered: (rt) => rt.chromeData('context-menu') },
  { type: 'toolbar', instance: 'demo', rendered: (rt) => rt.chromeData('toolbar', 'demo', rt.registry.get('toolbar', 'demo-page-tools')!.data), draw: () => h(PageToolbar, { view: 'demo', label: 'Demo page' }), seen: seenOf('.fx-toolbar-scope') },
];

const settingsWindowKeys = (type: string) => [cs.CHROME_SETTINGS_PICK_KEY(type), cs.CHROME_SETTINGS_PATCH_KEY(type)];
const ownsKey = (type: string, instance: string, key: string) => key === cs.CHROME_INSTANCE_KEY(type, instance) || key.startsWith(`${cs.CHROME_INSTANCE_KEY(type, instance)}.`);

for (const c of CASES) {
  const name = `${c.type}:${c.instance}`;
  doc.body.innerHTML = '<div id="root"></div>';
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, startView: 'home' } as never, assets, storageKey: `test:interface-tab:${name}` });
  installChrome(rt);
  const reactRoot = createRoot(doc.getElementById('root')!);
  await act(async () => { reactRoot.render(h(AxfProvider, { runtime: rt }, h('div', null, c.draw?.() ?? null, chromeDialogs[CHROME_SETTINGS_DIALOG]!.render({ type: c.type, instance: c.instance }) as never))); });
  if (c.seen) check(c.seen().length > 1, `${name}: the ${c.type} itself is drawn`);
  await act(async () => { await sleep(10); });

  const tab = [...doc.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => /Interface/.test(t.textContent ?? ''));
  check(!!tab, `${name}: the dialog has an Interface tab`);
  if (!tab) { reactRoot.unmount(); continue; }
  await act(async () => { click(tab); await sleep(5); });

  const windowBefore = JSON.stringify(chromeSettingsUi(rt, c.type, c.instance));
  const windowKeysBefore = settingsWindowKeys(c.type).map((k) => JSON.stringify(rt.settings.get(k) ?? null));
  const panel = () => doc.querySelector<HTMLElement>(`[data-axf-interface-for="${c.type}:${c.instance}"]`);
  check(!!panel(), `${name}: the Interface tab edits this ${c.type} (data-axf-interface-for="${name}")`);

  // drive every control on the tab: each choice option and each switch, one at a time
  const controls = () => [...(panel()?.querySelectorAll<HTMLElement>('[role="radio"][aria-checked="false"], input[role="switch"]') ?? [])];
  const n = controls().length;
  check(n > 0, `${name}: the Interface tab has controls (${n})`);
  let wrote = 0;
  for (let i = 0; i < n; i++) {
    const el = controls()[i];
    if (!el) break;
    const before = rt.settings.savedValues();
    const shownBefore = JSON.stringify(c.rendered(rt));
    const seenBefore = c.seen?.() ?? '';
    const lookBefore = cs.normalizeInstanceOverride(c.type, rt.settings.get(cs.CHROME_INSTANCE_KEY(c.type, c.instance)));
    await act(async () => { click(el); await sleep(2); });
    const after = rt.settings.savedValues();
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    const stray = changed.filter((k) => !ownsKey(c.type, c.instance, k) && k !== cs.SETTINGS_LEVEL_KEY);
    check(!stray.length, `${name}: control ${i} (${el.closest('[aria-label]')?.getAttribute('aria-label') ?? el.textContent}) writes only this ${c.type}'s keys (stray: ${stray.join(', ')})`);
    if (changed.some((k) => ownsKey(c.type, c.instance, k))) {
      wrote++;
      if (changed.includes(cs.CHROME_INSTANCE_KEY(c.type, c.instance))) check(JSON.stringify(c.rendered(rt)) !== shownBefore, `${name}: control ${i} (${JSON.stringify(rt.settings.get(cs.CHROME_INSTANCE_KEY(c.type, c.instance)))}) shows on the ${c.type} at once`);
      const lookAfter = cs.normalizeInstanceOverride(c.type, rt.settings.get(cs.CHROME_INSTANCE_KEY(c.type, c.instance)));
      const lookChanged = cs.CHROME_FIELDS[c.type].filter((f) => f.group === 'look' && lookBefore[f.key] !== lookAfter[f.key]).map((f) => f.key);
      if (c.seen && lookChanged.length) check(c.seen() !== seenBefore, `${name}: ${lookChanged.join(', ')} restyles the drawn ${c.type} live`);
    }
  }
  // a tab row picks its own asset on the same tab: `….asset`, this row only
  if (c.type === 'tab-group') {
    const sel = panel()?.querySelector<HTMLSelectElement>('select');
    const other = sel ? [...sel.options].map((o) => o.value).find((v) => v !== 'default' && v !== sel.value) : undefined;
    check(!!sel && !!other, `${name}: the Interface tab offers this row's asset`);
    if (sel && other) {
      const before = JSON.stringify(c.rendered(rt));
      await act(async () => {
        Object.getOwnPropertyDescriptor((W.HTMLSelectElement as unknown as { prototype: object }).prototype, 'value')!.set!.call(sel, other);
        sel.dispatchEvent(new (W.Event as typeof Event)('change', { bubbles: true }));
        await sleep(2);
      });
      check(rt.settings.get(cs.CHROME_INSTANCE_ASSET_KEY(c.type, c.instance)) === other, `${name}: the asset pick writes ${cs.CHROME_INSTANCE_ASSET_KEY(c.type, c.instance)}`);
      check(JSON.stringify(c.rendered(rt)) !== before, `${name}: the row redraws with the picked asset`);
    }
  }
  check(wrote > 0, `${name}: the Interface tab changes ${cs.CHROME_INSTANCE_KEY(c.type, c.instance)}`);
  settingsWindowKeys(c.type).forEach((k, i) => check(JSON.stringify(rt.settings.get(k) ?? null) === windowKeysBefore[i], `${name}: the settings window's ${k} is untouched`));
  check(JSON.stringify(chromeSettingsUi(rt, c.type, c.instance)) === windowBefore, `${name}: the settings window looks the same`);
  await act(async () => { reactRoot.unmount(); });
}

/*
 * Grids (component-tokens@1): a data grid has no chrome Settings… dialog; its own look is its token set, edited by the
 * instance tokens panel (family `grid`). Every edit must land in THAT grid's entry of `axf.tokens.instances`, reach that
 * grid's CSS vars at once and leave every other grid, every tab row and the settings window alone.
 */
{
  const { InstanceTokensPanel } = await import('../react/components/ChromeContext.tsx');
  const ct = await import('../core/engines/component-tokens.mjs');
  doc.body.innerHTML = '<div id="root"></div>';
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, startView: 'home' } as never, assets, storageKey: 'test:interface-tab:grid' });
  installChrome(rt);
  rt.settings.set(ct.INSTANCE_TOKENS_KEY, ct.setInstanceToken(undefined, 'grid', 'other.grid', 'headerBg', 'accent') as never);
  const reactRoot = createRoot(doc.getElementById('root')!);
  await act(async () => { reactRoot.render(h(AxfProvider, { runtime: rt }, h(InstanceTokensPanel, { family: 'grid', instance: 'demo.grid' }))); });
  const panel = doc.querySelector<HTMLElement>('[data-axf-instance-tokens="grid.demo.grid"]');
  check(!!panel, 'grid:demo.grid: the token panel is for this grid');
  const input = panel?.querySelector<HTMLInputElement>('input');
  const before = rt.settings.savedValues();
  const otherBefore = JSON.stringify(ct.instanceTokenValues(rt.settings.get(ct.INSTANCE_TOKENS_KEY), 'grid', 'other.grid'));
  if (input) await act(async () => {
    Object.getOwnPropertyDescriptor((W.HTMLInputElement as unknown as { prototype: object }).prototype, 'value')!.set!.call(input, 'surface2');
    input.dispatchEvent(new (W.Event as typeof Event)('input', { bubbles: true }));
    await sleep(2);
  });
  const set = [...(panel?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent?.trim() === 'Set');
  if (set) await act(async () => { click(set); await sleep(2); });
  const after = rt.settings.savedValues();
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  check(changed.length === 1 && changed[0] === ct.INSTANCE_TOKENS_KEY, `grid:demo.grid: Set writes only ${ct.INSTANCE_TOKENS_KEY} (changed: ${changed.join(', ')})`);
  const raw = rt.settings.get(ct.INSTANCE_TOKENS_KEY);
  check(Object.keys(ct.instanceTokenValues(raw, 'grid', 'demo.grid')).length === 1, 'grid:demo.grid: the value is in this grid\'s own token set');
  check(Object.keys(ct.instanceTokenVars(raw, 'grid', 'demo.grid')).length > 0, 'grid:demo.grid: the grid\'s CSS vars carry it at once');
  check(JSON.stringify(ct.instanceTokenValues(raw, 'grid', 'other.grid')) === otherBefore, 'grid:demo.grid: another grid keeps its own values');
  check(Object.keys(ct.instanceTokenValues(raw, 'tabs', 'demo.grid')).length === 0, 'grid:demo.grid: a tab row of the same id is untouched');
  // (the settings windows' keys are covered by `changed`: only the grid token store moved)
  await act(async () => { reactRoot.unmount(); });
}

/*
 * The API (Brett, Nov 8 2026: everything comes with an API): each instance's Interface settings are console-control@1
 * targets `setting:chrome.<type>.<id>.<field>` (+ `.asset`) with the same keys the tab writes; REST, MCP, CLI and voice
 * all run through this registry. `chrome.settings:<type>:<id>:interface` (the targets' open) is the deep link.
 */
{
  const { controlRegistry } = await import('../react/controlTargets.ts');
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, startView: 'home' } as never, assets, storageKey: 'test:interface-tab:api' });
  installChrome(rt);
  const reg = controlRegistry(rt);
  const all = (await reg.run({ verb: 'list' })) as { ok: boolean; targets?: { address: string }[] };
  const addrs = new Set((all.targets ?? []).map((t) => t.address));
  for (const t of cs.CHROME_TYPES.filter((x) => !cs.CHROME_MANY[x])) for (const f of cs.CHROME_FIELDS[t]) check(addrs.has(`setting:chrome.${t}.app.${f.key}`), `api: setting:chrome.${t}.app.${f.key} is a target`);
  check(addrs.has('setting:chrome.banner.app.asset'), 'api: the banner\'s asset is a target');
  const set = await reg.run({ verb: 'set', address: 'setting:chrome.banner.app.surface', value: 'accent' }) as { ok: boolean; message?: string };
  check(set.ok, `api: set setting:chrome.banner.app.surface accent (${set.message ?? ''})`);
  check((rt.settings.get(cs.CHROME_INSTANCE_KEY('banner', 'app')) as Record<string, unknown>)?.surface === 'accent' && rt.banner({ all: true }).data?.surface === 'accent', 'api: it writes axf.chrome.banner.app (the key the Interface tab writes) and the banner renders it');
  const st = await reg.run({ verb: 'state', address: 'setting:chrome.banner.app.surface' }) as { ok: boolean; state?: { value?: unknown; target?: { value?: unknown } } };
  check(st.ok && (st.state?.target?.value ?? st.state?.value) === 'accent', `api: state reads it back (${JSON.stringify(st).slice(0, 300)})`);
  const bad = await reg.run({ verb: 'set', address: 'setting:chrome.banner.app.surface', value: 'plaid' }) as { ok: boolean };
  check(!bad.ok, 'api: a value the field does not take is refused');
  const rs = await reg.run({ verb: 'set', address: 'setting:chrome.banner.app.surface', value: 'reset' }) as { ok: boolean; message?: string };
  check(rs.ok, `api: reset runs (${rs.message ?? ''})`);
  check(rt.settings.get(cs.CHROME_INSTANCE_KEY('banner', 'app')) == null, `api: reset drops the override (${JSON.stringify(rt.settings.get(cs.CHROME_INSTANCE_KEY('banner', 'app')))})`);
  await reg.run({ verb: 'set', address: 'setting:chrome.toolbar.app.collapsible', value: true });
  check((rt.settings.get(cs.CHROME_INSTANCE_KEY('toolbar', 'app')) as Record<string, unknown>)?.collapsible === true, 'api: a toggle takes true / on');
  const before = rt.settings.savedValues();
  await reg.run({ verb: 'set', address: 'setting:chrome.tab-group.demo.row.style', value: 'pills' });
  check((rt.settings.get(cs.CHROME_INSTANCE_KEY('tab-group', 'demo.row')) as Record<string, unknown>)?.style === 'pills', 'api: a tab row with no settings yet is reachable by its id');
  check(Object.keys(rt.settings.savedValues()).filter((k) => !(k in before)).every((k) => k.startsWith('axf.chrome.tab-group.demo.row')), 'api: and only its key is written');
  let opened: unknown = null;
  const openDialog = rt.openDialog.bind(rt);
  (rt as unknown as { openDialog: (id: string, p?: unknown) => void }).openDialog = (id, p) => { opened = { id, p }; openDialog(id, p as never); };
  await reg.run({ verb: 'open', address: 'setting:chrome.banner.app.height' });
  check(JSON.stringify(opened) === JSON.stringify({ id: CHROME_SETTINGS_DIALOG, p: { type: 'banner', instance: 'app', tab: 'interface' } }), `api: open is the deep link to the banner's Settings → Interface (${JSON.stringify(opened)})`);
}

/* the CLI: `axf console chrome …` is the same REST command on the same address */
{
  // @ts-expect-error plain .mjs
  const cli = await import('../cli/console-control.mjs');
  const r = cli.toRequest(['chrome', 'set', 'banner', 'app', 'surface', 'accent']);
  check(r.path === '/do' && r.body.verb === 'set' && r.body.address === 'setting:chrome.banner.app.surface' && r.body.value === 'accent', 'cli: chrome set → /do set setting:chrome.banner.app.surface');
  check(cli.toRequest(['chrome', 'get', 'toolbar', 'app', 'density']).path === `/state?address=${encodeURIComponent('setting:chrome.toolbar.app.density')}`, 'cli: chrome get <key> → /state of the same address');
  const o = cli.toRequest(['chrome', 'open', 'tab-group', 'ui-review.sections']);
  check(o.body.verb === 'press' && o.body.address === 'function:chrome.settings' && o.body.value === 'tab-group:ui-review.sections:interface', 'cli: chrome open → its Settings → Interface');
  const z = cli.toRequest(['chrome', 'reset', 'banner', 'app', '--confirm']);
  check(z.body.address === 'function:chrome.reset' && z.body.value === 'banner:app' && z.body.confirm === true, 'cli: chrome reset → chrome.reset for that instance');
  let threw = false; try { cli.toRequest(['chrome', 'set', 'window', 'app', 'x', 'y']); } catch { threw = true; }
  check(threw, 'cli: an unknown chrome kind is a usage error');
}

console.log(`${fail ? '✗' : '✓'} chrome Interface tab: ${ok} passed, ${fail} failed (${CASES.map((c) => `${c.type}:${c.instance}`).join(', ')}, grid:demo.grid)`);
process.exit(fail ? 1 : 0);
