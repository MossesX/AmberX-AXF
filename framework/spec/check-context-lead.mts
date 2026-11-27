/**
 * context-lead@1: entries that lead every context menu (core/engines/windows.ts withContextLead, react/components/
 * Overlays.tsx). Unit cases for the merge, then the real AppShell in jsdom: a right-click on the page, a toolbar and a
 * target whose asset shows only its own items, and a touch long-press, each start with the lead entry and one separator;
 * an item the lead stands in for is not repeated; picking it runs its action; no lead leaves menus unchanged.
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-context-lead.mts
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
const { CONTEXT_LEAD_PREFIX, CONTEXT_LEAD_SEPARATOR_ID, withContextLead } = await import('../core/engines/windows.ts');
const { AxfProvider } = await import('../react/AxfProvider.tsx');
const { AppShell } = await import('../react/AppShell.tsx');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const doc = W.document as Document;
const $ = (sel: string) => doc.querySelector<HTMLElement>(sel);

/* ---- unit: the merge ---- */
{
  const lead = [{ id: 'lead', label: 'Lead', action: 'go' }];
  const rest = [{ id: 'a', label: 'A', action: 'a' }, { id: 's', separator: true }, { id: 'b', label: 'B', action: 'go' }];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  check(JSON.stringify(ids(withContextLead(lead, rest))) === JSON.stringify(['lead', CONTEXT_LEAD_SEPARATOR_ID, 'a']), 'lead, separator, the rest; an item running the lead\'s action is dropped with the separator it leaves dangling');
  check(JSON.stringify(withContextLead([], rest)) === JSON.stringify(rest), 'no lead: the menu is unchanged');
  check(JSON.stringify(ids(withContextLead(lead, []))) === JSON.stringify(['lead']), 'nothing else: the lead alone, no separator');
  check(JSON.stringify(ids(withContextLead(lead, [{ id: 'x', separator: true }, { id: 'a', label: 'A' }]))) === JSON.stringify(['lead', CONTEXT_LEAD_SEPARATOR_ID, 'a']), 'a separator the rest starts with is not doubled');
  check(JSON.stringify(ids(withContextLead([{ id: 'x', separator: true }, ...lead, { id: 'y', separator: true }], rest))) === JSON.stringify(['lead', CONTEXT_LEAD_SEPARATOR_ID, 'a']), 'separators around the lead are trimmed');
  check(JSON.stringify(ids(withContextLead(lead, [{ id: 'lead', label: 'Copy' }, { id: 'c', label: 'C' }]))) === JSON.stringify(['lead', CONTEXT_LEAD_SEPARATOR_ID, 'c']), 'an item with the lead\'s id is not shown twice');
}

/* ---- the app ---- */
const root = new URL('../', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, startView: 'home' } as never, assets, storageKey: 'test:context-lead' });
let opened = 0;
rt.actions.register('test.lead', () => { opened++; }, { label: 'Lead' });
const Page = () => h('div', null,
  h('p', { id: 'page-text' }, 'A page'),
  h('div', { role: 'toolbar', 'aria-label': 'Page tools', id: 'page-tools' }, h('span', null, 'tools')),
);
const views = { home: { title: 'Home', render: () => h(Page) } };
const container = doc.getElementById('root')!;
const reactRoot = createRoot(container);
await act(async () => { reactRoot.render(h(AxfProvider, { runtime: rt }, h(AppShell, { views }))); await sleep(20); });

const rightClick = (el: Element) => el.dispatchEvent(new (W.MouseEvent as typeof MouseEvent)('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 60 }));
function pointer(type: string, el: Element, x = 30, y = 60) {
  const e = new (W.MouseEvent as typeof MouseEvent)(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  el.dispatchEvent(e);
}
/** The open menu's top-level entries: a label, or `|` for a separator. */
const menu = () => [...(doc.querySelector('.fx-ctx ul.fx-menu')?.children ?? [])].map((li) => (li.getAttribute('role') === 'separator' ? '|' : li.querySelector('.fx-menu__label')?.textContent ?? '?'));
const close = async () => { await act(async () => { rt.closeContext(); await sleep(5); }); };
const openOn = async (sel: string) => { await act(async () => { rightClick($(sel)!); await sleep(10); }); return menu(); };

const plain = await openOn('#page-text');
check(plain.length > 0 && plain[0] !== 'Lead', 'without a lead the default menu opens as before');
await close();

rt.contextExtras.set(`${CONTEXT_LEAD_PREFIX}test`, () => [{ id: 'test-lead', label: 'Lead', icon: 'settings', action: 'test.lead' }]);

const onPage = await openOn('#page-text');
check(onPage[0] === 'Lead' && onPage[1] === '|' && onPage.length > 2, `right-click on the page: the lead, a separator, then the page's menu (${onPage.join(', ')})`);
check(JSON.stringify(onPage.slice(2)) === JSON.stringify(plain.filter((x, i, all) => !(x === '|' && (i === 0 || i === all.length - 1)))), 'and the rest of the menu is the same as before');
await act(async () => { ($('.fx-ctx [data-axf-item="test-lead"] button') as HTMLButtonElement).click(); await sleep(10); });
check(opened === 1 && !$('.fx-ctx'), 'picking the lead runs its action and closes the menu');

const onToolbar = await openOn('#page-tools');
check(onToolbar[0] === 'Lead' && onToolbar[1] === '|', `right-click on a toolbar: the lead first too (${onToolbar.join(', ')})`);
await close();

// an asset that shows only its own items (contributions: false) still starts with the lead
check(rt.swap('context-menu', 'locked-down'), 'swapped to an asset with contributions off');
const own = await openOn('#page-text');
check(own[0] === 'Lead' && own[1] === '|' && own.length > 2, `contributions off: the lead, then the asset's own items (${own.join(', ')})`);
await close();

// touch long-press opens the same menu
await act(async () => { pointer('pointerdown', $('#page-text')!); await sleep(rt.behavior().interaction.longPressMs + 60); });
const pressed = menu();
check(pressed[0] === 'Lead' && pressed[1] === '|', `long-press on a phone: the lead first (${pressed.join(', ')})`);
await act(async () => { pointer('pointerup', $('#page-text')!); await sleep(5); });
await close();

// taken away: menus go back to how they were
rt.contextExtras.delete(`${CONTEXT_LEAD_PREFIX}test`);
const after = await openOn('#page-text');
check(after[0] !== 'Lead', 'with the lead removed, menus no longer show it');
await close();

await act(async () => { reactRoot.unmount(); });
console.log(`context-lead: ${ok} checks passed${fail ? `, ${fail} failed` : ''}`);
if (fail) process.exit(1);
