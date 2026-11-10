/**
 * Choice settings, live status slots and tooltips on every icon, in a DOM (jsdom). Build molly-flagship-skin s3 (Brett,
 * Nov 10 2026: "Choices in the app menu change instantly with status listed beside them. Live info next to entries like
 * the little green axHub logo, red if not. Hover explains icons.").
 *
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-menu-items.mts
 *
 * 1. Runtime: setting.set / setting.toggle write the setting; registerMenuStatus / setMenuStatus / menuStatus; a module's
 *    sources go with removeAppMenuItems(module); compileMenuItems compiles a flat list with the runtime's own env.
 * 2. The application menu: a choice row shows its value beside the label, opens its choices as radio rows with the
 *    current one checked, a pick applies at once (the setting changes, the menu stays open, the value updates); a switch
 *    flips on click; a cycling row steps; a status slot draws the source's state (tone, animation, tooltip) and follows
 *    it live; every icon, key cap and chevron has a tooltip.
 * 3. Context menus (MenuList over rt.compileMenuItems): the same rows, under context-menu/<target> paths.
 */
import { JSDOM, VirtualConsole } from 'jsdom';

// render errors reach this console (jsdom keeps them to itself otherwise)
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true, virtualConsole: new VirtualConsole().sendTo(console) });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'matchMedia'] as const) {
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
const { AxfProvider, useRuntime, useAxfState } = await import('../react/AxfProvider.tsx');
const { AppMenuList } = await import('../react/components/AppMenu.tsx');
const { MenuList } = await import('../react/components/MenuList.tsx');
const { readFileSync, readdirSync } = await import('node:fs');
const { join } = await import('node:path');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const root = new URL('../', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, hidden: [] } as never, assets, storageKey: 'test:menu-items' });

const click = (el: Element | null) => act(() => { el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
const key = (el: Element | null, k: string) => act(() => { el?.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/* ------------------------------------------------------------ 1. runtime */
{
  rt.dispatch('setting.set:ui.theme:%22dark%22');
  check(rt.settings.get('ui.theme') === 'dark', 'setting.set writes a string value');
  rt.dispatch('setting.set:ui.size:14');
  check(rt.settings.get('ui.size') === 14, 'setting.set writes a number');
  rt.dispatch('setting.toggle:files.autosave');
  check(rt.settings.get('files.autosave') === true, 'setting.toggle turns an unset setting on');
  rt.dispatch('setting.toggle:files.autosave');
  check(rt.settings.get('files.autosave') === false, '…and off again');
  rt.dispatch('setting.set:ui.theme:%ZZ');
  check(rt.settings.get('ui.theme') === 'dark', 'a bad value is refused and the setting is kept');
  check(rt.menuStatus('hub') === null, 'an unregistered source reads null');
  rt.setMenuStatus('hub', { state: 'on', text: 'Connected', icon: 'cloud' }, 'lib-hub');
  check(rt.menuStatus('hub')?.state === 'on' && rt.menuStatusIds().includes('hub'), 'setMenuStatus registers a static source');
  let reads = 0;
  const off = rt.registerMenuStatus('builds', () => { reads++; return { state: 'busy', text: `${reads}` }; });
  check(rt.menuStatus('builds')?.state === 'busy' && reads === 1, 'a read function is called on demand');
  off();
  check(rt.menuStatus('builds') === null, 'the remover unregisters');
  const listeners = new Set<() => void>();
  rt.registerMenuStatus('live', { read: () => ({ state: 'warn' }), subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, module: 'plug' });
  check(listeners.size === 1, 'a subscribing source is subscribed to');
  rt.removeAppMenuItems('plug');
  check(rt.menuStatus('live') === null && listeners.size === 0, "removeAppMenuItems(module) drops the module's sources and unsubscribes");
  const flat = rt.compileMenuItems([{ id: 'a', label: 'A', action: 'noop', status: 'source:hub' }, { id: 'b', label: 'B', setting: 'ui.theme', choices: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] }], 'default');
  check(flat[0]?.path === 'context-menu/default/a' && flat[0]?.status?.tone === 'success' && flat[0]?.status?.icon === 'cloud', 'compileMenuItems: context paths and the hub source');
  check(flat[1]?.kind === 'choice' && flat[1]?.valueLabel === 'Dark', 'compileMenuItems: the choice reads the runtime setting');
}

/* ------------------------------------------------------------ 2. the application menu */
{
  const asset = { menus: [{ id: 'view', label: 'View', items: [
    { id: 'theme', label: 'Theme', icon: 'palette', hint: 'Light, dark or follow the system', setting: 'ui.theme', choices: [{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'system', label: 'System' }] },
    { id: 'density', label: 'Density', setting: 'ui.density', cycle: true, choices: [{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }, { value: 'roomy', label: 'Roomy' }] },
    { id: 'autosave', label: 'Auto save', setting: 'files.autosave' },
    { id: 'hub', label: 'axHub', icon: 'cloud', action: 'nav:hub', shortcut: 'Alt+H', status: { source: 'source:hub', tooltip: 'axHub connection' } },
    { id: 'tools', label: 'Tools', icon: 'settings', items: [{ id: 'a', label: 'A', action: 'noop' }] },
  ] }] };
  rt.settings.set('ui.theme', 'dark'); rt.settings.set('ui.density', 'regular'); rt.settings.set('files.autosave', false);
  rt.setMenuStatus('hub', { state: 'on', text: 'Connected', icon: 'cloud' }, 'lib-hub');
  const { compileAppMenu, mergeAppMenu } = await import('../core/engines/appmenu.ts');
  // the menu as the menubar draws it: subscribed to the runtime, compiled from it on every render
  function Menu() {
    const r = useRuntime();
    useAxfState();
    const env = (r as unknown as { appMenuEnv: () => never }).appMenuEnv();
    const menu = compileAppMenu(mergeAppMenu(asset, []), env).menus[0]!;
    return h(AppMenuList, { items: menu.items, depth: 1, onDone: () => { closed++; }, autoFocus: true });
  }
  let closed = 0;
  const host = document.createElement('div'); document.body.appendChild(host);
  const r = createRoot(host);
  act(() => r.render(h(AxfProvider, { runtime: rt } as never, h(Menu))));
  const row = (id: string) => host.querySelector<HTMLElement>(`ul[data-axf-menu-depth="1"] > li > [data-axf-menu-item="${id}"]`);
  const value = (id: string) => row(id)?.querySelector('.fx-menu__value')?.textContent;
  check(value('theme') === 'Dark', 'the choice row shows its current value beside the label');
  check(row('theme')?.getAttribute('aria-haspopup') === 'menu' && row('theme')?.dataset.axfKind === 'choice', 'a choice with a list opens a sub-menu');
  check(row('theme')?.title === 'Light, dark or follow the system', 'the row explains itself on hover (hint)');
  check(row('theme')?.querySelector('.fx-menu__icon')?.getAttribute('title') === 'Light, dark or follow the system', 'the icon explains itself on hover');
  click(row('theme'));
  const radios = Array.from(host.querySelectorAll<HTMLElement>('ul[data-axf-menu-depth="2"] [role="menuitemradio"]'));
  check(radios.map((b) => b.textContent).join(',') === 'Light,Dark,System', 'the choices are radio rows');
  check(radios.map((b) => b.getAttribute('aria-checked')).join(',') === 'false,true,false', 'the current choice is checked');
  check(radios[0]?.dataset.axfPath === 'app-menu/view/theme/light', 'a choice row has its own path');
  check(radios[2]?.title === 'Theme: System', 'a choice without a hint still explains itself');
  click(radios[0]!);
  await flush();
  check(rt.settings.get('ui.theme') === 'light', 'a pick writes the setting at once');
  check(closed === 0, '…and the menu stays open');
  check(value('theme') === 'Light', '…and the value beside the entry follows');
  check(host.querySelector('ul[data-axf-menu-depth="2"] [role="menuitemradio"][aria-checked="true"]')?.textContent === 'Light', '…and the check moves');
  // switch
  check(row('autosave')?.getAttribute('role') === 'menuitemcheckbox' && row('autosave')?.getAttribute('aria-checked') === 'false' && value('autosave') === 'Off', 'a switch is a checkbox row reading Off');
  click(row('autosave')); await flush();
  check(rt.settings.get('files.autosave') === true && value('autosave') === 'On' && row('autosave')?.getAttribute('aria-checked') === 'true' && closed === 0, 'a click flips the switch, the menu stays open');
  // cycle
  check(!row('density')?.getAttribute('aria-haspopup') && value('density') === 'Regular', 'a cycling choice has no sub-menu');
  click(row('density')); await flush();
  check(rt.settings.get('ui.density') === 'roomy' && value('density') === 'Roomy', 'a click steps to the next choice');
  click(row('density')); await flush();
  check(rt.settings.get('ui.density') === 'compact', '…and wraps');
  // status slot
  const slot = () => row('hub')?.querySelector<HTMLElement>('.fx-menu__status');
  check(slot()?.dataset.fxTone === 'success' && slot()?.dataset.fxAnim === 'none' && slot()?.title === 'axHub connection: Connected', 'the axHub slot is green and explains itself');
  check(slot()?.getAttribute('role') === 'img' && slot()?.getAttribute('aria-label') === slot()?.title, 'the slot is an image with a name');
  act(() => rt.setMenuStatus('hub', { state: 'off', text: 'Unreachable', icon: 'cloud' }));
  check(slot()?.dataset.fxTone === 'danger' && slot()?.title === 'axHub connection: Unreachable', '…red when not, live');
  act(() => rt.setMenuStatus('hub', { state: 'busy', text: 'Checking' }));
  check(slot()?.dataset.fxTone === 'accent' && slot()?.dataset.fxAnim === 'pulse', '…pulsing while busy');
  act(() => rt.unregisterMenuStatus('hub'));
  check(slot()?.dataset.fxTone === 'muted' && slot()?.dataset.axfStatus === 'unknown', '…muted Unknown once the source is gone');
  // every icon explains itself
  check(row('hub')?.querySelector('.fx-menu__icon')?.getAttribute('title') === 'axHub', 'an icon without a hint is explained by the label');
  check(row('hub')?.querySelector('.fx-menu__kbd')?.getAttribute('title') === 'Shortcut: Alt+H', 'the key cap explains itself');
  check(row('tools')?.querySelector('.fx-menu__chevron')?.getAttribute('title') === 'Opens a sub-menu', 'the chevron explains itself');
  // keyboard into the choice list
  act(() => row('theme')?.focus());
  key(row('theme'), 'ArrowRight');
  check((document.activeElement as HTMLElement)?.getAttribute('role') === 'menuitemradio', 'ArrowRight opens the choices with focus on the first');
  key(document.activeElement, 'ArrowLeft');
  check(document.activeElement === row('theme'), 'ArrowLeft returns to the choice row');
  act(() => r.unmount()); host.remove();
}

/* ------------------------------------------------------------ 3. context menus */
{
  rt.settings.set('editor.wrap', true); rt.settings.set('editor.size', 14);
  rt.setMenuStatus('hub', { state: 'on', text: 'Connected' });
  const items = [
    { id: 'copy', label: 'Copy', icon: 'copy', action: 'edit.copy', shortcut: 'Ctrl+C', hint: 'Copy the selection' },
    { id: 'wrap', label: 'Word wrap', setting: 'editor.wrap' },
    { id: 'size', label: 'Text size', setting: 'editor.size', choices: [{ value: 12, label: 'Small' }, { value: 14, label: 'Medium' }, { value: 18, label: 'Large' }] },
    { id: 'hub', label: 'axHub', action: 'nav:hub', status: 'source:hub' },
  ];
  let done = 0;
  const host = document.createElement('div'); document.body.appendChild(host);
  const r = createRoot(host);
  act(() => r.render(h(AxfProvider, { runtime: rt } as never, h(MenuList, { items: items as never, where: 'editor', onDone: () => { done++; }, autoFocus: true }))));
  const row = (id: string) => host.querySelector<HTMLElement>(`[role^="menuitem"][data-axf-item="${id}"]`);
  check(row('copy')?.dataset.axfPath === 'context-menu/editor/copy', 'context rows carry context-menu/<target> paths');
  check(row('copy')?.title === 'Copy the selection' && row('copy')?.querySelector('.fx-menu__icon')?.getAttribute('title') === 'Copy the selection', 'hint on the row and its icon');
  check(row('wrap')?.getAttribute('role') === 'menuitemcheckbox' && row('wrap')?.querySelector('.fx-menu__value')?.textContent === 'On', 'a switch in a context menu');
  check(row('size')?.querySelector('.fx-menu__value')?.textContent === 'Medium', 'a numeric choice shows its value');
  click(row('size'));
  const large = Array.from(host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find((b) => b.textContent === 'Large');
  click(large!); await flush();
  check(rt.settings.get('editor.size') === 18 && row('size')?.querySelector('.fx-menu__value')?.textContent === 'Large' && done === 0, 'a pick applies at once and keeps the context menu open');
  check(row('hub')?.querySelector<HTMLElement>('.fx-menu__status')?.dataset.fxTone === 'success', 'a status slot in a context menu');
  click(row('copy'));
  check(done === 1, 'an ordinary action closes the context menu');
  act(() => r.unmount()); host.remove();
}

console.log(`check-menu-items: ${ok} ok, ${fail} failed`);
if (fail) process.exit(1);
