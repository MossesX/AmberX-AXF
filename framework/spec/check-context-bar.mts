/**
 * context-bar@1: a context menu's quick-action strip and Search anywhere (core/engines/windows.ts splitContextBar,
 * react/components/Overlays.tsx ContextMenuHost). Unit cases for the split, then the real AppShell in jsdom: items with
 * `place: "toolbar"` are icon buttons in a labelled toolbar on top, the list keeps the rest, the search box is pinned
 * last, typing while the menu is open lands in it, results replace the list, Escape clears then closes.
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-context-bar.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const W = dom.window as unknown as Record<string, unknown> & Window;
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'Document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'matchMedia', 'StorageEvent'] as const) {
  const v = W[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
const mm = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
(W as unknown as { matchMedia: unknown }).matchMedia = mm;
g.matchMedia = mm;
g.IS_REACT_ACT_ENVIRONMENT = true;
const quiet = console.error;
console.error = (...a: unknown[]) => { if (!/not wrapped in act/.test(String(a[0]))) quiet(...a); };

const React = await import('react');
g.React = React;
const { createElement: h, act } = React;
const { createRoot } = await import('react-dom/client');
const { AxfRuntime } = await import('../core/runtime.ts');
const { splitContextBar } = await import('../core/engines/windows.ts');
const { AxfProvider } = await import('../react/AxfProvider.tsx');
const { AppShell } = await import('../react/AppShell.tsx');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const doc = W.document as Document;
const $ = (sel: string) => doc.querySelector<HTMLElement>(sel);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(',');

/* ---- unit: the split ---- */
{
  const items = [
    { id: 'a', label: 'A' }, { id: 's1', separator: true },
    { id: 'cut', label: 'Cut', place: 'toolbar' }, { id: 'copy', label: 'Copy', place: 'toolbar' }, { id: 's2', separator: true },
    { id: 'b', label: 'B' }, { id: 's3', separator: true }, { id: 'r', label: 'Reload', place: 'toolbar' },
  ];
  const { bar, list } = splitContextBar(items);
  check(ids(bar) === 'cut,copy,r', `strip items in order (${ids(bar)})`);
  check(ids(list) === 'a,s1,b', `the list keeps the rest, no doubled or trailing separator (${ids(list)})`);
  const none = splitContextBar([{ id: 'a', label: 'A' }, { id: 's', separator: true }, { id: 'b', label: 'B' }]);
  check(!none.bar.length && ids(none.list) === 'a,s,b', 'no strip items: the list is unchanged');
  check(!splitContextBar([{ id: 's', separator: true, place: 'toolbar' }]).bar.length, 'a separator never goes in the strip');
}

/* ---- the app ---- */
const root = new URL('../', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
assets.push({
  $axf: 'asset@1', type: 'context-menu', id: 'bar-test', name: 'Bar test', version: '1.0.0',
  data: { variant: 'compact', showIcons: true, showShortcuts: true, contributions: false, search: 'Find it…', targets: { default: [
    { id: 'cut', label: 'Cut', icon: 'cut', action: 'test.cut', place: 'toolbar' },
    { id: 'copy', label: 'Copy', icon: 'copy', action: 'test.copy', place: 'toolbar' },
    { id: 'one', label: 'One', icon: 'list', action: 'test.one' },
    { id: 's', separator: true },
    { id: 'two', label: 'Two', icon: 'list', action: 'test.two' },
  ] } },
});
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, startView: 'home' } as never, assets, storageKey: 'test:context-bar' });
const ran: string[] = [];
for (const a of ['cut', 'copy', 'one', 'two']) rt.actions.register(`test.${a}`, () => { ran.push(a); }, { label: a });
const Page = () => h('div', null, h('p', { id: 'page-text' }, 'A page'));
const views = { home: { title: 'Home', render: () => h(Page) } };
const reactRoot = createRoot(doc.getElementById('root')!);
await act(async () => { reactRoot.render(h(AxfProvider, { runtime: rt }, h(AppShell, { views }))); await sleep(20); });

const rightClick = (el: Element) => el.dispatchEvent(new (W.MouseEvent as typeof MouseEvent)('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 60 }));
const labels = () => [...(doc.querySelector('.fx-ctx ul.fx-menu')?.children ?? [])].map((li) => (li.getAttribute('role') === 'separator' ? '|' : li.querySelector('.fx-menu__label, .fx-search__label')?.textContent ?? '?'));
const open = async () => { await act(async () => { rightClick($('#page-text')!); await sleep(10); }); };
const close = async () => { await act(async () => { rt.closeContext(); await sleep(5); }); };

// the default asset has no strip items and no search: the menu is as before
await open();
check(!!$('.fx-ctx') && !$('.fx-ctx__bar') && !$('.fx-ctx__search'), 'an asset without strip items or search: no strip, no search box');
await close();

check(rt.swap('context-menu', 'bar-test'), 'swapped to the test asset');
await open();
const bar = $('.fx-ctx > .fx-ctx__bar');
check(bar?.getAttribute('role') === 'toolbar' && !!bar.getAttribute('aria-label'), 'the strip is a labelled toolbar');
check([...(bar?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label')).join(',') === 'Cut,Copy', 'the strip holds the toolbar items as icon buttons');
check(labels().join(',') === 'One,|,Two', `the list holds only the rest (${labels().join(',')})`);
const box = $('.fx-ctx')!;
const kids = [...box.children];
const search = $('.fx-ctx > .fx-ctx__search');
check(!!search && kids.indexOf(search) === kids.length - 1, 'Search anywhere is the last thing in the menu');
check(search?.querySelector('input')?.getAttribute('placeholder') === 'Find it…', 'a string search value is the placeholder');
check(doc.activeElement !== search?.querySelector('input'), 'the box does not take focus on open (cut / copy / paste keep the selection)');
await act(async () => { (bar!.querySelector('[data-axf-item="copy"]') as HTMLButtonElement).click(); await sleep(10); });
check(ran.join(',') === 'copy' && !$('.fx-ctx'), 'a strip button runs its action and closes the menu');

// another target's menu (here a toolbar's) gets the default target's strip and the search box too
rt.contextExtras.set('bar-test-target', () => [{ id: 'own', label: 'Own', icon: 'list', action: 'test.one' }]);
await act(async () => { rt.openContext(30, 60, 'bar-test-target'); await sleep(10); });
check([...doc.querySelectorAll('.fx-ctx__bar button')].map((b) => b.getAttribute('aria-label')).join(',') === 'Cut,Copy' && !!$('.fx-ctx__search'), 'another target\'s menu carries the default strip and Search anywhere');
await close();

// typing while the menu is open goes to the search box; results replace the list; Escape clears, then closes
await open();
const input = () => $('.fx-ctx__search input') as HTMLInputElement | null;
await act(async () => { doc.body.dispatchEvent(new (W.KeyboardEvent as typeof KeyboardEvent)('keydown', { key: 'h', bubbles: true })); await sleep(5); });
check(doc.activeElement === input(), 'a printable key while the menu is open focuses Search anywhere');
await act(async () => {
  const el = input()!;
  Object.getOwnPropertyDescriptor(W.HTMLInputElement.prototype, 'value')!.set!.call(el, 'Home');
  el.dispatchEvent(new (W.Event as typeof Event)('input', { bubbles: true }));
  await sleep(10);
});
check(!labels().includes('One') && labels().length > 0, `typing replaces the list with results (${labels().join(',')})`);
await act(async () => { input()!.dispatchEvent(new (W.KeyboardEvent as typeof KeyboardEvent)('keydown', { key: 'Escape', bubbles: true })); await sleep(5); });
check(input()?.value === '' && labels().join(',') === 'One,|,Two', 'Escape clears the box and the list comes back');
await act(async () => { input()!.dispatchEvent(new (W.KeyboardEvent as typeof KeyboardEvent)('keydown', { key: 'Escape', bubbles: true })); await sleep(5); });
check(!$('.fx-ctx'), 'a second Escape closes the menu');
await open();
check(input()?.value === '', 'the box is empty again on the next open');
await close();

await act(async () => { reactRoot.unmount(); });
console.log(`context-bar: ${ok} checks passed${fail ? `, ${fail} failed` : ''}`);
if (fail) process.exit(1);
