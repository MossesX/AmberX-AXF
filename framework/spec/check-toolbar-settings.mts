/**
 * Toolbar settings change the rendered toolbar (build fix-toolbar-settings-doing-nothing; Brett, Nov 13 2026: "Add a
 * test that changing each setting changes the rendered toolbar."). jsdom, the real AppShell + AxfProvider:
 *   - page toolbars built like Shipped features' bars (Sync / CSV / Markdown buttons, View by segmented + search,
 *     filter checkboxes + status chips + Edit status select) and the app toolbar
 *   - right-click → Toolbar settings… opens that toolbar's dialog; picking Icons in it is saved and drawn
 *   - every field × every value through `chrome.set` (the API: REST / MCP console_action, CLI, voice) changes the
 *     rendered toolbar, and `chrome.unset` / `chrome.reset` put it back
 *   - collapsible: fold button, fold / unfold by click and by `toolbar.fold`, per device
 *   - search box: filters the toolbar's items (and the items of a group)
 *   - persists: a new runtime on the same storage draws the same toolbar
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-toolbar-settings.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const W = dom.window as unknown as Record<string, unknown> & Window;
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'matchMedia', 'StorageEvent', 'history', 'location', 'PopStateEvent', 'HashChangeEvent', 'addEventListener', 'removeEventListener', 'dispatchEvent'] as const) {
  const v = W[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
const mm = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
(W as unknown as { matchMedia: unknown }).matchMedia = mm;
g.matchMedia = mm;
g.IS_REACT_ACT_ENVIRONMENT = true;
const quiet = console.error;
console.error = (...a: unknown[]) => { if (!/not wrapped in act/.test(String(a[0]))) quiet(...a); };
(W.Element as unknown as { prototype: Element }).prototype.getBoundingClientRect = function () { return { left: 10, top: 40, right: 130, bottom: 72, width: 120, height: 32, x: 10, y: 40, toJSON() {} } as DOMRect; };

const React = await import('react');
g.React = React;
const { createElement: h, act } = React;
const { createRoot } = await import('react-dom/client');
const { AxfRuntime } = await import('../core/runtime.ts');
const { CHROME_FIELDS, CHROME_INSTANCE_KEY } = await import('../core/engines/chrome-settings-rules.mjs');
const { AxfProvider } = await import('../react/AxfProvider.tsx');
const { AppShell } = await import('../react/AppShell.tsx');
const { Button, Segmented } = await import('../react/components/Controls.tsx');
const { Checkbox, SelectField, TextField } = await import('../react/components/Forms.tsx');
const { TOOLBAR_AS_BUILT, TOOLBAR_LOOK_FIELDS, installToolbarLook, toolbarFoldKey, toolbarInstanceOf, toolbarStates } = await import('../react/toolbarLook.ts');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const doc = W.document as Document;
const $ = (sel: string) => doc.querySelector<HTMLElement>(sel);
const click = (el: Element) => el.dispatchEvent(new (W.MouseEvent as typeof MouseEvent)('click', { bubbles: true, cancelable: true }));
const settle = () => act(async () => { await sleep(10); });

/* ---- the app: a page with Shipped features' three toolbars ---- */
const root = new URL('../', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const STORE = 'test:toolbar-settings';
const makeRt = () => new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults: { ...defaults, layout: defaults.layout }, startView: 'home' } as never, assets, storageKey: STORE });
const rt = makeRt();
let synced = 0;
const Page = () => h('div', null,
  h('div', { className: 'demo-actions', role: 'toolbar', 'aria-label': 'Shipped features actions' },
    h(Button, { icon: 'refresh', onClick: () => { synced++; } }, 'Sync'),
    h(Button, { icon: 'download' }, 'CSV'),
    h(Button, { icon: 'file' }, 'Markdown')),
  h('div', { className: 'demo-bar', role: 'toolbar', 'aria-label': 'Shipped features view' },
    h(Segmented, { size: 'sm', label: 'View by', value: 'build', onChange: () => {}, options: [{ value: 'build', label: 'Build', icon: 'layers' }, { value: 'status', label: 'Status', icon: 'list' }] }),
    h(TextField, { label: 'Search', value: '', onChange: () => {} })),
  h('div', { className: 'demo-filters', role: 'toolbar', 'aria-label': 'Shipped features filters' },
    h(Checkbox, { label: 'Hide completed', checked: false, onChange: () => {} }),
    h(Checkbox, { label: 'Hide pending', checked: false, onChange: () => {} }),
    h('span', { role: 'group', 'aria-label': 'Status' }, ...['Planned', 'Live', 'Merged'].map((s) => h('button', { key: s, type: 'button', className: 'fx-chip' }, s))),
    h(SelectField, { label: 'Edit status', value: '', onChange: () => {}, options: [{ value: '', label: 'Any edit status' }] })),
);
const views = { home: { title: 'Home', render: () => h(Page) } };
const reactRoot = createRoot(doc.getElementById('root')!);
await act(async () => { reactRoot.render(h(AxfProvider, { runtime: rt }, h(AppShell, { views }))); });
await settle();

const bar = (label: string) => $(`[role="toolbar"][aria-label="${label}"]`)!;
const ACTIONS = 'Shipped features actions', VIEW = 'Shipped features view', FILTERS = 'Shipped features filters';
check(bar(ACTIONS) && bar(VIEW) && bar(FILTERS), 'the three Shipped features toolbars render');
check(toolbarInstanceOf(bar(ACTIONS)) === 'shipped-features-actions' && toolbarInstanceOf(bar(FILTERS)) === 'shipped-features-filters', 'instance id = the slug its context menu opens');
check(!bar(ACTIONS).hasAttribute('data-axf-tb-variant'), 'nothing set: the toolbar is drawn as its plugin built it');

/* ---- right-click → Toolbar settings… → pick Icons ---- */
{
  const btn = bar(ACTIONS).querySelector('button')!;
  await act(async () => { btn.dispatchEvent(new (W.MouseEvent as typeof MouseEvent)('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 50 })); });
  await settle();
  const item = [...doc.querySelectorAll<HTMLElement>('.fx-ctx [role="menuitem"], .fx-ctx button')].find((b) => /Toolbar settings/.test(b.textContent ?? ''));
  check(!!item, 'right-click on a page toolbar offers Toolbar settings…');
  if (item) { await act(async () => { click(item); }); await settle(); }
  const dlg = [...doc.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => /shipped-features-actions/.test(d.textContent ?? ''));
  check(!!dlg, 'the dialog opens for that toolbar (shipped-features-actions)');
  const icons = dlg && [...dlg.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent?.trim() === 'Icons');
  check(!!icons, 'the dialog offers Buttons: Icons');
  check(icons?.getAttribute('aria-checked') !== 'true', 'and does not claim Icons before it is picked (page toolbars start as Icons + labels)');
  if (icons) { await act(async () => { click(icons); }); await settle(); }
  check((rt.settings.get(CHROME_INSTANCE_KEY('toolbar', 'shipped-features-actions')) as Record<string, unknown> | null)?.variant === 'icons', 'picking Icons is saved (it used to be dropped as "same as the asset")');
  check(bar(ACTIONS).getAttribute('data-axf-tb-variant') === 'icons', 'and drawn on that toolbar at once');
  check(!bar(VIEW).hasAttribute('data-axf-tb-variant'), 'only on that toolbar');
  await act(async () => { rt.closeDialog?.(); });
  await act(async () => { rt.dispatch('chrome.reset:toolbar:shipped-features-actions'); });
  await settle();
}

/* ---- every field × every value, on every Shipped features toolbar, through the API ---- */
const ATTR: Record<string, (v: unknown) => [string, string | null]> = {
  variant: (v) => ['data-axf-tb-variant', String(v)],
  align: (v) => ['data-axf-tb-align', String(v)],
  density: (v) => ['data-axf-tb-density', String(v)],
  surface: (v) => ['data-axf-tb-surface', String(v)],
  divider: (v) => ['data-axf-tb-divider', v ? 'on' : 'off'],
  showSearch: (v) => ['data-axf-tb-search', v ? 'on' : null],
  collapsible: (v) => ['data-axf-tb-collapsible', v ? 'on' : null],
};
const fields = CHROME_FIELDS.toolbar.filter((f: { key: string }) => f.key !== 'tapConfirm');
check(fields.length === TOOLBAR_LOOK_FIELDS.length && fields.every((f: { key: string }) => (TOOLBAR_LOOK_FIELDS as readonly string[]).includes(f.key)), 'every toolbar setting in the dialog is drawn by the toolbar host (none left out)');
for (const label of [ACTIONS, VIEW, FILTERS]) {
  const inst = toolbarInstanceOf(bar(label));
  for (const f of fields as { key: string; kind: string; options?: string[] }[]) {
    const values: unknown[] = f.kind === 'toggle' ? [true, false] : f.options!;
    for (const v of values) {
      if (v === TOOLBAR_AS_BUILT[f.key as keyof typeof TOOLBAR_AS_BUILT]) continue; // as built: nothing to change
      const before = bar(label).outerHTML;
      await act(async () => { rt.dispatch(`chrome.set:toolbar:${inst}:${f.key}:${typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`); });
      await settle();
      const [attr, want] = ATTR[f.key]!(v);
      check(bar(label).getAttribute(attr) === want, `${label}: ${f.key} = ${String(v)} → ${attr}="${want}"`);
      check(bar(label).outerHTML !== before, `${label}: ${f.key} = ${String(v)} changes the rendered toolbar`);
      await act(async () => { rt.dispatch(`chrome.unset:toolbar:${inst}:${f.key}`); });
      await settle();
      check(bar(label).getAttribute(attr) === null, `${label}: ${f.key} unset → back as built`);
    }
  }
}

/* ---- what each look does to the items ---- */
{
  await act(async () => { rt.dispatch('chrome.set:toolbar:shipped-features-actions:variant:icons'); });
  await settle();
  const span = bar(ACTIONS).querySelector('button > span:not(.fx-icon)')!;
  const sel = "[role='toolbar'][data-axf-tb-variant='icons'] :is(button, [role='button']):has(> .fx-icon) > span:not(.fx-icon)";
  let matches: boolean | null = null; try { matches = span.matches(sel); } catch { matches = null; }
  check(matches !== false, 'Icons: the Sync / CSV / Markdown text is the one the stylesheet hides (kept for screen readers)');
  const css = readFileSync(join(root, 'ui', 'axf.css'), 'utf8');
  for (const s of ["data-axf-tb-variant='icons'", "data-axf-tb-variant='labels'", "data-axf-tb-align='center'", "data-axf-tb-align='spread'", "data-axf-tb-density='compact'", "data-axf-tb-density='roomy'", "data-axf-tb-surface='raised'", "data-axf-tb-surface='glass'", "data-axf-tb-surface='flat'", "data-axf-tb-divider='on'", "data-axf-tb-divider='off'", "data-axf-tb-folded='on'", "data-axf-tb-filtered='out'"]) check(css.includes(s), `axf.css draws ${s}`);
  await act(async () => { rt.dispatch('chrome.reset:toolbar:shipped-features-actions'); });
  await settle();
}

/* ---- collapsible: fold button, click, API, per device ---- */
{
  await act(async () => { rt.dispatch('chrome.set:toolbar:shipped-features-filters:collapsible:on'); });
  await settle();
  const fold = () => bar(FILTERS).querySelector<HTMLButtonElement>(':scope > [data-axf-tb-own="fold"]');
  check(!!fold() && bar(FILTERS).firstElementChild === fold(), 'Collapsible: a fold button leads the toolbar');
  check(fold()?.getAttribute('aria-expanded') === 'true' && !bar(FILTERS).hasAttribute('data-axf-tb-folded'), 'open by default');
  await act(async () => { click(fold()!); });
  await settle();
  check(bar(FILTERS).getAttribute('data-axf-tb-folded') === 'on' && fold()?.getAttribute('aria-expanded') === 'false', 'clicking it folds the toolbar');
  check(rt.settings.get(toolbarFoldKey('shipped-features-filters')) === true, 'the fold is saved');
  await act(async () => { rt.dispatch('toolbar.fold:shipped-features-filters:off'); });
  await settle();
  check(!bar(FILTERS).hasAttribute('data-axf-tb-folded'), 'toolbar.fold:<instance>:off unfolds it (API)');
  await act(async () => { rt.dispatch('toolbar.fold:shipped-features-filters:toggle'); });
  await settle();
  check(bar(FILTERS).getAttribute('data-axf-tb-folded') === 'on', 'toolbar.fold:<instance>:toggle folds it again');
  await act(async () => { rt.dispatch('chrome.set:toolbar:shipped-features-filters:collapsible:off'); });
  await settle();
  check(!fold() && !bar(FILTERS).hasAttribute('data-axf-tb-folded'), 'Collapsible off: the fold button goes and every item shows');
  await act(async () => { rt.dispatch('toolbar.fold:shipped-features-filters:off'); rt.dispatch('chrome.reset:toolbar:shipped-features-filters'); });
  await settle();
}

/* ---- search box filters the items ---- */
{
  await act(async () => { rt.dispatch('chrome.set:toolbar:shipped-features-actions:showSearch:on'); rt.dispatch('chrome.set:toolbar:shipped-features-filters:showSearch:on'); });
  await settle();
  const box = (l: string) => bar(l).querySelector<HTMLInputElement>(':scope > [data-axf-tb-own="search"]')!;
  check(!!box(ACTIONS) && bar(ACTIONS).lastElementChild === box(ACTIONS), 'Search box: a filter box ends the toolbar');
  const type = async (l: string, v: string) => { await act(async () => { box(l).value = v; box(l).dispatchEvent(new (W.Event as typeof Event)('input', { bubbles: true })); }); };
  await type(ACTIONS, 'csv');
  const shown = [...bar(ACTIONS).querySelectorAll(':scope > button:not([data-axf-tb-filtered])')].map((b) => b.textContent?.trim());
  check(shown.length === 1 && shown[0] === 'CSV', 'typing "csv" leaves only CSV');
  await type(FILTERS, 'live');
  const group = bar(FILTERS).querySelector<HTMLElement>(':scope > [role="group"]')!;
  check(!group.hasAttribute('data-axf-tb-filtered') && [...group.children].filter((c) => !c.hasAttribute('data-axf-tb-filtered')).length === 1, 'filtering a status chip group keeps the matching chip only');
  check([...bar(FILTERS).querySelectorAll(':scope > .fx-checkrow')].every((c) => c.hasAttribute('data-axf-tb-filtered')), 'and hides the checkboxes that do not match');
  await type(ACTIONS, '');
  check(!bar(ACTIONS).querySelector('[data-axf-tb-filtered]'), 'an empty box shows everything');
  check(synced === 0, 'the toolbar host never presses a button itself');
  await act(async () => { rt.dispatch('chrome.reset:toolbar:shipped-features-actions'); rt.dispatch('chrome.reset:toolbar:shipped-features-filters'); });
  await settle();
  check(!box(ACTIONS) && !bar(FILTERS).querySelector('[data-axf-tb-filtered]'), 'Search box off: the box goes and nothing stays hidden');
}

/* ---- the app toolbar honours its own settings ---- */
{
  await act(async () => { rt.dispatch('chrome.set:toolbar:app:variant:labels'); });
  await settle();
  const app = $('[role="toolbar"][data-axf-toolbar="app"]');
  if (app) {
    check(app.classList.contains('fx-toolbar--labels'), 'the app toolbar draws Buttons: Labels from its own settings');
    check(!app.hasAttribute('data-axf-tb-variant'), 'and the host leaves the fields the app toolbar draws itself');
    await act(async () => { rt.dispatch('chrome.set:toolbar:app:surface:raised'); });
    await settle();
    check(app.getAttribute('data-axf-tb-surface') === 'raised', 'its surface is drawn by the host');
    await act(async () => { rt.dispatch('chrome.reset:toolbar:app'); });
    await settle();
  } else console.log('· the app toolbar is hidden in this layout (skipped)');
}

/* ---- state readable for the API (console catalog) ---- */
{
  await act(async () => { rt.dispatch('chrome.set:toolbar:shipped-features-actions:variant:labels'); rt.dispatch('toolbar.fold:offscreen-bar:on'); rt.dispatch('chrome.set:toolbar:offscreen-bar:collapsible:on'); });
  await settle();
  const st = toolbarStates(doc, rt.settings);
  const a = st.find((t) => t.instance === 'shipped-features-actions');
  check(a?.onScreen && a.settings.variant === 'labels' && a.label === ACTIONS, 'toolbarStates reads a toolbar on screen with what is set for it');
  check(st.some((t) => t.instance === 'shipped-features-filters' && t.onScreen && !Object.keys(t.settings).length), 'and lists toolbars with nothing set');
  const off = st.find((t) => t.instance === 'offscreen-bar');
  check(off && !off.onScreen && off.folded && off.settings.collapsible === true, 'and toolbars with saved settings that are not on screen (folded too)');
  await act(async () => { rt.dispatch('chrome.reset:toolbar:shipped-features-actions'); rt.dispatch('chrome.reset:toolbar:offscreen-bar'); rt.dispatch('toolbar.fold:offscreen-bar:off'); });
  await settle();
}

/* ---- persists: a fresh runtime on the same storage draws the same toolbar ---- */
{
  await act(async () => { rt.dispatch('chrome.set:toolbar:shipped-features-view:density:compact'); rt.dispatch('chrome.set:toolbar:shipped-features-view:variant:labels'); });
  await settle();
  const rt2 = makeRt();
  const d2 = new JSDOM('<!doctype html><html><body><div role="toolbar" aria-label="Shipped features view"><button type="button">Build</button></div></body></html>').window.document;
  const host = installToolbarLook(d2, rt2.settings);
  const el = d2.querySelector<HTMLElement>('[role="toolbar"]')!;
  check(el.getAttribute('data-axf-tb-density') === 'compact' && el.getAttribute('data-axf-tb-variant') === 'labels', 'saved settings come back after a reload (a new runtime on the same storage)');
  const late = d2.createElement('div'); late.setAttribute('role', 'toolbar'); late.setAttribute('aria-label', 'Shipped features view');
  d2.body.appendChild(late);
  await sleep(10);
  check(late.getAttribute('data-axf-tb-density') === 'compact', 'a toolbar that appears later gets its settings too');
  host.dispose();
  await act(async () => { rt.dispatch('chrome.reset:toolbar:shipped-features-view'); });
}

await act(async () => { reactRoot.unmount(); });
console.log(`toolbar settings: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
