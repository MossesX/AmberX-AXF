/**
 * Right-click any menu item → item-settings dialog; per-item tokens written to `axf.tokens.menu`; persist and reload.
 * Build molly-flagship-skin s4 (menu-item@2, spec/MENUS.md; control@1 `tokens.menu`, spec/CONTROL.md).
 *
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-menu-settings.mts
 *
 * 1. Runtime: setMenuToken / menuItemTokens / resetMenuItem; the compiled menu applies behaviour tokens and carries
 *    appearance tokens as `look`; the actions menu.item.set / menu.item.reset / menu.item.settings (the API and voice
 *    twins) do the same; a new runtime over the same storage reads the overrides back (persist + reload).
 * 2. DOM: right-click on a row closes the menu and opens the dialog on the row's path; the dialog's fields write tokens,
 *    the row restyles (`data-fx-tone`) and relabels at once; per-token and whole-item reset.
 * 3. The console runner (token-control lib/tokens.mjs): control@1 `tokens.menu` list / get / set / reset over the look
 *    document, so REST, MCP and the CLI write the same key every app reads.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true, virtualConsole: new VirtualConsole().sendTo(console) });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'matchMedia'] as const) {
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
const { MenuItemSettingsPanel, MENU_ITEM_SETTINGS_DIALOG } = await import('../react/components/MenuItemSettings.tsx');
const { compileAppMenu, mergeAppMenu, MENU_TOKENS_KEY, MENU_ITEM_DIALOG } = await import('../core/engines/appmenu.ts');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const root = new URL('../', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const STORAGE = 'test:menu-settings';
const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, hidden: [] } as never, assets, storageKey: STORAGE });
const asset = { menus: [{ id: 'file', label: 'File', items: [
  { id: 'new', label: 'New file', icon: 'plus', action: 'file.new', shortcut: 'Alt+N' },
  { id: 'save', label: 'Save', icon: 'save', action: 'file.save' },
  { id: 'exports', label: 'Export', icon: 'share', items: [{ id: 'json', label: 'As JSON', action: 'file.export:json' }, { id: 'csv', label: 'As CSV', action: 'file.export:csv' }] },
  { id: 'theme', label: 'Theme', setting: 'ui.theme', choices: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] },
] }] };
const compiled = (r = rt) => compileAppMenu(mergeAppMenu(asset, []), (r as unknown as { appMenuEnv: () => never }).appMenuEnv()).menus[0]!;
const row = (id: string, r = rt) => compiled(r).items.find((i) => i.id === id)!;
// events run inside act and the runtime's coalesced re-render (a microtask) is awaited there too
const click = (el: Element | null, type = 'click') => act(async () => { el?.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 0)); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const type = (input: Element | null, value: string) => act(async () => {
  const el = input as HTMLInputElement;
  const proto = el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new dom.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
});

/* ------------------------------------------------------------ 1. runtime + actions + persistence */
{
  check(Object.keys(rt.menuOverrides()).length === 0, 'no overrides at start');
  check(rt.setMenuToken('app-menu/file/save', 'label', 'Save now') === true, 'setMenuToken accepts a good path and token');
  check(rt.setMenuToken('nav/x', 'label', 'X') === false && rt.setMenuToken('app-menu/file/save', 'colour', 'red') === false, '…and refuses a bad path or token');
  check(row('save').label === 'Save now', 'the compiled menu shows the label override');
  rt.setMenuToken('app-menu/file/save', 'tone', 'accent'); rt.setMenuToken('app-menu/file/save', 'weight', 'bold');
  check(JSON.stringify(row('save').look) === JSON.stringify({ tone: 'accent', weight: 'bold' }), 'appearance tokens ride on the compiled item as look');
  rt.setMenuToken('app-menu/file/exports/csv', 'visible', false); rt.setMenuToken('app-menu/file/exports/json', 'order', 1);
  check(row('exports').items!.map((i) => i.id).join(',') === 'json', 'visible:false hides a child; order places');
  rt.setMenuToken('app-menu/file/save', 'tone', 'theme');
  check(!('tone' in rt.menuItemTokens('app-menu/file/save')), 'setting the default clears the token');
  rt.setMenuToken('app-menu/file/save', 'weight', null);
  check(JSON.stringify(rt.menuItemTokens('app-menu/file/save')) === JSON.stringify({ label: 'Save now' }), 'null clears a token');
  // the actions (console_action, voice): the path is URI-encoded
  const enc = encodeURIComponent('app-menu/file/new');
  rt.dispatch(`menu.item.set:${enc}:tone:danger`);
  rt.dispatch(`menu.item.set:${enc}:visible:false`);
  rt.dispatch(`menu.item.set:${enc}:order:5`);
  rt.dispatch(`menu.item.set:${enc}:label:${encodeURIComponent('New file…')}`);
  check(JSON.stringify(rt.menuItemTokens('app-menu/file/new')) === JSON.stringify({ tone: 'danger', visible: false, order: 5, label: 'New file…' }), 'menu.item.set writes tokens with values read by kind');
  rt.dispatch(`menu.item.set:${enc}:tone:%23ff0000`);
  check(rt.menuItemTokens('app-menu/file/new').tone === 'danger', 'a literal colour is refused (theme tokens only)');
  rt.dispatch(`menu.item.reset:${enc}:visible`);
  check(!('visible' in rt.menuItemTokens('app-menu/file/new')) && rt.menuItemTokens('app-menu/file/new').tone === 'danger', 'menu.item.reset with a token drops just that token');
  rt.dispatch(`menu.item.reset:${enc}`);
  check(Object.keys(rt.menuItemTokens('app-menu/file/new')).length === 0 && rt.menuItemTokens('app-menu/file/save').label === 'Save now', 'menu.item.reset with a path drops that item only');
  rt.dispatch(`menu.item.settings:${enc}`);
  check(rt.getState().dialog?.id === MENU_ITEM_DIALOG && (rt.getState().dialog?.props as { path?: string })?.path === 'app-menu/file/new', 'menu.item.settings opens the dialog on the path');
  rt.closeDialog();
  rt.dispatch('menu.item.settings:nope');
  check(!rt.getState().dialog, 'a bad path opens nothing');
  // persist + reload: a new runtime over the same storage reads the overrides back and compiles them in
  const again = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, hidden: [] } as never, assets, storageKey: STORAGE });
  check(JSON.stringify(again.menuOverrides()) === JSON.stringify(rt.menuOverrides()), 'overrides persist and reload');
  check(row('save', again).label === 'Save now' && row('exports', again).items!.map((i) => i.id).join(',') === 'json', 'the reloaded runtime compiles them in');
  check(MENU_TOKENS_KEY === 'axf.tokens.menu' && rt.settings.get(MENU_TOKENS_KEY) !== null, 'the store is the axf.tokens.menu setting (an axf.tokens. key: shared through the axHub look)');
  rt.resetMenuItem();
  check(Object.keys(rt.menuOverrides()).length === 0 && rt.settings.get(MENU_TOKENS_KEY) === null, 'resetMenuItem() drops everything and clears the key');
}

/* ------------------------------------------------------------ 2. DOM: right-click → dialog → tokens → the row follows */
{
  let closed = 0;
  function Menu() {
    const r = useRuntime();
    useAxfState();
    const menu = compileAppMenu(mergeAppMenu(asset, []), (r as unknown as { appMenuEnv: () => never }).appMenuEnv()).menus[0]!;
    return h(AppMenuList, { items: menu.items, depth: 1, onDone: () => { closed++; } });
  }
  function Dialog() {
    const r = useRuntime();
    const st = useAxfState();
    const p = (st.dialog?.props as { path?: string } | undefined)?.path;
    return st.dialog?.id === MENU_ITEM_SETTINGS_DIALOG && p ? h(MenuItemSettingsPanel, { path: p }) : null;
  }
  void useRuntime;
  const host = document.createElement('div'); document.body.appendChild(host);
  const r = createRoot(host);
  act(() => r.render(h(AxfProvider, { runtime: rt } as never, h('div', null, h(Menu), h(Dialog)))));
  const rowEl = (id: string) => host.querySelector<HTMLElement>(`[data-axf-menu-item="${id}"]`);
  check(rowEl('save')?.dataset.axfPath === 'app-menu/file/save', 'rows carry their path');
  await click(rowEl('save'), 'contextmenu');
  check(closed === 1, 'right-click closes the menu');
  check(rt.getState().dialog?.id === MENU_ITEM_SETTINGS_DIALOG && (rt.getState().dialog?.props as { path?: string })?.path === 'app-menu/file/save', '…and opens the item-settings dialog on the row');
  const panel = () => host.querySelector<HTMLElement>('[data-axf-menu-item-settings="app-menu/file/save"]');
  check(!!panel(), 'the dialog body renders for the path');
  const field = (label: string) => Array.from(panel()!.querySelectorAll<HTMLElement>('label, .fx-field')).find((l) => l.textContent?.startsWith(label))?.querySelector('input, select, textarea') ?? null;
  const labelInput = field('Label');
  check((labelInput as HTMLInputElement | null)?.value === 'Save', 'the Label field shows the inherited label');
  await type(labelInput, 'Save it'); await flush();
  check(rt.menuItemTokens('app-menu/file/save').label === 'Save it', 'typing a label writes the token');
  check(rowEl('save')?.textContent?.includes('Save it'), '…and the row relabels at once');
  check(!!panel()?.querySelector('[data-axf-reset-token="label"]'), 'a changed token gets its own reset');
  await type(labelInput, 'Save'); await flush();
  check(!('label' in rt.menuItemTokens('app-menu/file/save')), 'typing the inherited value back clears the override');
  // appearance tab
  const tab = Array.from(panel()!.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent?.includes('Appearance'));
  await click(tab!); await flush();
  const tone = field('Text colour');
  check(!!tone && tone.tagName === 'SELECT', 'the Appearance tab lists Text colour as a select of theme tones');
  await type(tone, 'accent'); await flush();
  check(rt.menuItemTokens('app-menu/file/save').tone === 'accent', 'picking a tone writes the token');
  check(rowEl('save')?.dataset.fxTone === 'accent', '…and the row carries data-fx-tone for the stylesheet');
  check(Array.from(panel()!.querySelectorAll<HTMLElement>('select option')).every((o) => !/^#|rgb\(/.test(o.getAttribute('value') ?? '')), 'no literal colours are offered: theme tokens only');
  await click(panel()!.querySelector('[data-axf-reset-token="tone"]')); await flush();
  check(!('tone' in rt.menuItemTokens('app-menu/file/save')) && !rowEl('save')?.dataset.fxTone, 'per-token reset clears the token and the attribute');
  await type(tone, 'danger'); await flush();
  const weight = field('Weight'); await type(weight, 'bold'); await flush();
  check(rowEl('save')?.dataset.fxTone === 'danger' && rowEl('save')?.dataset.fxWeight === 'bold', 'two appearance tokens on one row');
  await click(panel()!.querySelector('[data-axf-reset-item]')); await flush();
  check(Object.keys(rt.menuItemTokens('app-menu/file/save')).length === 0 && !rowEl('save')?.dataset.fxTone, 'Reset this item drops every token of the item');
  // a choice row's radio opens its parent setting's path
  rt.closeDialog(); await flush();
  await click(rowEl('theme')); await flush();
  const radio = host.querySelector<HTMLElement>('[role="menuitemradio"]');
  await click(radio, 'contextmenu'); await flush();
  check((rt.getState().dialog?.props as { path?: string })?.path === 'app-menu/file/theme', 'right-click on a choice opens its setting row');
  rt.closeDialog();
  act(() => r.unmount()); host.remove();
}

/* ------------------------------------------------------------ 3. the console runner: control@1 tokens.menu */
{
  const T = mkdtempSync(join(tmpdir(), 'axf-menu-tokens-'));
  process.env.AXF_APPEARANCE_FILE = join(T, 'appearance.json');
  process.env.AXF_CONTROL_DATA_DIR = join(T, 'data');
  writeFileSync(process.env.AXF_APPEARANCE_FILE, JSON.stringify({ $axf: 'appearance@1', slots: {}, settings: {} }));
  const { runTokens } = await import('../../apps/console-web/plugins/token-control/lib/tokens.mjs') as { runTokens: (c: Record<string, unknown>) => Record<string, any> };
  const doc = () => JSON.parse(readFileSync(process.env.AXF_APPEARANCE_FILE!, 'utf8'));
  check(runTokens({ op: 'list', target: 'tokens.menu' }).total === 0, 'runner: nothing overridden at start');
  const set = runTokens({ op: 'set', target: 'tokens.menu', path: 'app-menu/file/save@tone', value: 'accent', by: 'test' });
  check(set.changed === true && set.item.value === 'accent' && set.key === MENU_TOKENS_KEY, 'runner: set answers the item and the key');
  check(doc().settings[MENU_TOKENS_KEY]['app-menu/file/save'].tone === 'accent', 'runner: the look document carries axf.tokens.menu');
  runTokens({ op: 'set', target: 'tokens.menu', path: 'context-menu/default/copy@label', value: 'Copy text', by: 'test' });
  check(runTokens({ op: 'get', target: 'tokens.menu', path: 'app-menu/file/save@tone' }).value === 'accent', 'runner: get one token');
  check(runTokens({ op: 'get', target: 'tokens.menu', path: 'app-menu/file/save@weight' }).value === 'theme', 'runner: get an unset token answers its default');
  check(JSON.stringify(runTokens({ op: 'get', target: 'tokens.menu', path: 'app-menu/file/save' }).value) === JSON.stringify({ tone: 'accent' }), 'runner: get a bare path answers the item\'s tokens');
  const list = runTokens({ op: 'list', target: 'tokens.menu' });
  check(list.total === 2 && list.items.map((i: any) => i.id).sort().join(',') === 'app-menu/file/save@tone,context-menu/default/copy@label' && 'tone' in list.tokens, 'runner: list = every override + the token registry');
  check(runTokens({ op: 'reset', target: 'tokens.menu', path: 'app-menu/file/save@tone' }).cleared.join(',') === 'app-menu/file/save@tone', 'runner: reset one token');
  check(runTokens({ op: 'reset', target: 'tokens.menu', path: 'context-menu/default/copy' }).changed === true && !doc().settings[MENU_TOKENS_KEY], 'runner: reset an item; an empty set clears the key');
  let threw = '';
  try { runTokens({ op: 'set', target: 'tokens.menu', path: 'app-menu/file/save', value: 'x' }); } catch (e) { threw = (e as Error).message; }
  check(threw.includes('<item path>@<token>'), 'runner: set without a token is refused');
}

console.log(`check-menu-settings: ${ok} ok, ${fail} failed`);
if (fail) process.exit(1);
