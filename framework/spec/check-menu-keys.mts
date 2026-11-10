/**
 * Keyboard focus across sub-menus and the page scroll lock, in a DOM (jsdom). Build molly-flagship-skin s2 (Brett,
 * Nov 10 2026: "Sub menus … expand left if they'd go off screen; the menu scrolls, not the screen").
 *
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-menu-keys.mts
 *
 * 1. AppMenuList (the application menu): arrows wrap over every row (check rows included), ArrowRight on a submenu row
 *    opens it and puts focus on its first row, ArrowLeft / Escape inside the submenu close it and put focus back on the
 *    parent row, Escape at the root reaches the drop-down; a re-fit (flip) never moves focus.
 * 2. MenuList (context menus): the same keys; Escape at the root closes the menu; the menu takes focus as it opens.
 * 3. installMenuFit's scroll lock: with no menu open the page scrolls; with one open a wheel outside it is swallowed, a
 *    wheel inside it scrolls the menu when it can and is swallowed when it can't.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'WheelEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'matchMedia'] as const) {
  const v = (dom.window as unknown as Record<string, unknown>)[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
(dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
g.matchMedia = (dom.window as unknown as { matchMedia: unknown }).matchMedia;
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
g.React = React;
const { createElement: h, act } = React;
const { createRoot } = await import('react-dom/client');
const { AxfRuntime } = await import('../core/runtime.ts');
const { AxfProvider } = await import('../react/AxfProvider.tsx');
const { AppMenuList } = await import('../react/components/AppMenu.tsx');
const { MenuList } = await import('../react/components/MenuList.tsx');
const { installMenuFit } = await import('../react/components/menuFit.ts');
const { readFileSync, readdirSync } = await import('node:fs');
const { join } = await import('node:path');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const root = new URL('../', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, hidden: [] } as never, assets, storageKey: 'test:menu-keys' });

const key = (el: Element | null, k: string) => act(() => { el?.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const active = () => (document.activeElement as HTMLElement | null)?.dataset;
const mount = (node: React.ReactElement) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const r = createRoot(host);
  act(() => r.render(h(AxfProvider, { runtime: rt } as never, node)));
  return { host, unmount: () => { act(() => r.unmount()); host.remove(); } };
};

/* ------------------------------------------------------------ 1. the application menu */
{
  const row = (id: string, more: Record<string, unknown> = {}) => ({ id, label: id.toUpperCase(), kind: 'action', path: `app-menu/m/${id}`, locked: false, origin: 'asset', action: `noop:${id}`, ...more });
  const items = [row('a'), row('b', { kind: 'submenu', action: undefined, items: [row('c', { path: 'app-menu/m/b/c' }), row('d', { path: 'app-menu/m/b/d' }), row('e', { path: 'app-menu/m/b/e', locked: true })] }), row('f', { check: true }), row('g')];
  let escaped = 0;
  const { host, unmount } = mount(h('div', { onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') escaped++; } }, h(AppMenuList, { items: items as never, depth: 1, onDone: () => {}, autoFocus: true })));
  const list = () => host.querySelector('ul[data-axf-menu-depth="1"]')!;
  check(active()?.axfMenuItem === 'a', 'autoFocus puts focus on the first row');
  key(document.activeElement, 'ArrowDown'); check(active()?.axfMenuItem === 'b', 'ArrowDown moves to the next row');
  key(document.activeElement, 'ArrowDown'); check(active()?.axfMenuItem === 'f', 'a check row (menuitemcheckbox) is reached too');
  key(document.activeElement, 'ArrowDown'); key(document.activeElement, 'ArrowDown'); check(active()?.axfMenuItem === 'a', 'ArrowDown wraps to the first row');
  key(document.activeElement, 'End'); check(active()?.axfMenuItem === 'g', 'End jumps to the last row');
  key(document.activeElement, 'ArrowUp'); key(document.activeElement, 'ArrowUp'); check(active()?.axfMenuItem === 'b', 'ArrowUp moves back');
  check(!host.querySelector('ul[data-axf-menu-depth="2"]'), 'no submenu open yet');
  key(document.activeElement, 'ArrowRight');
  check(!!host.querySelector('ul[data-axf-menu-depth="2"]'), 'ArrowRight on a submenu row opens the flyout');
  check(active()?.axfMenuItem === 'c', '…and puts focus on its first row');
  check(list().querySelector('[data-axf-menu-item="b"]')?.getAttribute('aria-expanded') === 'true', 'the parent row says it is expanded');
  key(document.activeElement, 'ArrowDown'); check(active()?.axfMenuItem === 'd', 'arrows move inside the submenu');
  key(document.activeElement, 'ArrowDown'); check(active()?.axfMenuItem === 'c', 'a locked row is skipped and the submenu wraps on its own rows');
  // a flip re-fit changes where the box is, never where focus is
  const sub = host.querySelector<HTMLElement>('.fx-menu__sub')!;
  sub.setAttribute('data-fx-flip', 'left up');
  check(active()?.axfMenuItem === 'c', 'a flipped submenu keeps its focus');
  key(document.activeElement, 'ArrowLeft');
  check(!host.querySelector('ul[data-axf-menu-depth="2"]'), 'ArrowLeft inside the submenu closes it');
  check(active()?.axfMenuItem === 'b', '…and focus is back on the parent row');
  key(document.activeElement, 'Enter');
  check(!!host.querySelector('ul[data-axf-menu-depth="2"]') && active()?.axfMenuItem === 'c', 'Enter on the submenu row opens it with focus inside');
  key(document.activeElement, 'Escape');
  check(!host.querySelector('ul[data-axf-menu-depth="2"]') && active()?.axfMenuItem === 'b', 'Escape inside the submenu closes only the submenu, focus back on the parent row');
  check(escaped === 0, '…and does not reach the drop-down');
  key(document.activeElement, 'Escape');
  check(escaped === 1, 'Escape at the root reaches the drop-down (which closes the menu)');
  // hover opens without stealing focus (React synthesises onMouseEnter from mouseover)
  act(() => { list().querySelector('[data-axf-menu-item="b"]')!.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })); });
  check(!!host.querySelector('ul[data-axf-menu-depth="2"]') && active()?.axfMenuItem === 'b', 'hover opens the submenu and leaves focus where it was');
  unmount();
}

/* ------------------------------------------------------------ 2. context menus */
{
  const items = [
    { id: 'copy', label: 'Copy', action: 'edit.copy' }, { id: 'sep', separator: true },
    { id: 'more', label: 'More', items: [{ id: 'x', label: 'X', action: 'noop' }, { id: 'y', label: 'Y', action: 'noop' }] },
    { id: 'wrap', label: 'Wrap', action: 'noop', checked: 'setting:editor.wrap' },
  ];
  let done = 0;
  const { host, unmount } = mount(h(MenuList, { items: items as never, onDone: () => { done++; }, autoFocus: true }));
  check(active()?.axfItem === 'copy', 'a context menu takes focus on its first row as it opens');
  key(document.activeElement, 'ArrowDown'); check(active()?.axfItem === 'more', 'the separator is skipped');
  key(document.activeElement, 'ArrowDown'); check(active()?.axfItem === 'wrap', 'the check row is reached');
  key(document.activeElement, 'ArrowUp'); key(document.activeElement, 'ArrowRight');
  check(active()?.axfItem === 'x', 'ArrowRight opens the submenu with focus on its first row');
  check(host.querySelector('[data-axf-item="more"][role]')?.getAttribute('aria-expanded') === 'true', 'the parent row is marked expanded');
  key(document.activeElement, 'Escape'); check(active()?.axfItem === 'more' && !host.querySelector('.fx-menu__sub'), 'Escape closes the submenu and refocuses the parent row');
  check(done === 0, '…without closing the menu');
  key(document.activeElement, 'Escape'); check(done === 1, 'Escape at the root closes the context menu');
  unmount();
}

/* ------------------------------------------------------------ 3. the menu scrolls, not the page */
{
  const stop = installMenuFit(document.body);
  const wheel = (target: Element, deltaY: number) => { const e = new dom.window.WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }); target.dispatchEvent(e); return e.defaultPrevented; };
  const page = document.createElement('div'); document.body.appendChild(page);
  check(wheel(page, 40) === false, 'no menu open: the page scrolls');
  const box = document.createElement('div'); box.className = 'fx-dropdown fx-popover'; box.setAttribute('data-fx-fit', 'managed');
  const scroller = document.createElement('div'); scroller.className = 'fx-menu__scroll'; box.appendChild(scroller);
  const inner = document.createElement('button'); scroller.appendChild(inner);
  document.body.appendChild(box);
  Object.defineProperty(scroller, 'scrollHeight', { value: 900, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
  scroller.scrollTop = 0;
  check(wheel(page, 40) === true, 'a menu is open: a wheel outside it is swallowed (the page never moves)');
  check(wheel(inner, 40) === false, 'a wheel down inside the menu with more below scrolls the menu');
  check(wheel(inner, -40) === true, 'a wheel up at the menu top is swallowed instead of reaching the page');
  Object.defineProperty(scroller, 'scrollTop', { value: 500, configurable: true, writable: true });
  check(wheel(inner, 40) === true, 'a wheel down at the menu end is swallowed instead of reaching the page');
  box.remove();
  check(wheel(page, 40) === false, 'menu closed: the page scrolls again');
  stop();
  check(wheel(page, 40) === false && (document.body.appendChild(box), wheel(page, 40) === false), 'after the remover nothing is swallowed');
  box.remove(); page.remove();
}

console.log(`check-menu-keys: ${ok} ok, ${fail} failed`);
if (fail) process.exit(1);
