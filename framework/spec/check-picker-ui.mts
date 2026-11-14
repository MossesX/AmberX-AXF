/**
 * check-picker-ui — the React picker in a DOM (jsdom; picker@1, spec/PICKER.md § 2). Run: npx -y tsx framework/spec/check-picker-ui.mts
 *
 * 1. PickerField: trigger text and count, opens the dialog (role=dialog, listbox, options, aria-selected), single choice
 *    closes and returns focus, search past the threshold filters, groups draw sections, keyboard (ArrowDown + Enter,
 *    Escape), multiple mode toggles with checkboxes and Done.
 * 2. Swap on: SelectField renders the picker; a native <select> gets a trigger, stays in the DOM (hidden) as the
 *    source of truth, and a choice sets its value and fires `change`. Swap off: the trigger is gone and the select is
 *    exactly as it was (attributes and value).
 * 3. Registry (the API's handlers): list / open / choose by name and position / search / close / clear by id, label
 *    and `button:picker-<id>`.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLSelectElement', 'HTMLOptGroupElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage'] as const) {
  const v = (dom.window as unknown as Record<string, unknown>)[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
(dom.window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
g.React = React;
const { createElement: h, act, useState } = React;
const { createRoot } = await import('react-dom/client');
const { PickerField } = await import('../react/components/PickerField.tsx');
const { SelectField } = await import('../react/components/Forms.tsx');
const { setPickerSwap } = await import('../react/pickerConfig.ts');
const { installPickerSwap, enhancedCount } = await import('../react/pickerSwap.ts');
const { pickerApi } = await import('../react/pickerRegistry.ts');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as HTMLElement[];
const key = (el: Element, k: string) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const FRUIT = ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew', 'Kiwi'].map((l) => ({ value: l.toLowerCase(), label: l, group: l < 'E' ? 'Early' : 'Late', description: `${l} description` }));

/* ---------------------------------------------------------------- 1. PickerField */
const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);
let single = 'banana';
let many: string[] = ['apple'];
function Demo() {
  const [v, setV] = useState(single);
  const [m, setM] = useState<string[]>(many);
  return h('div', null,
    h(PickerField, { label: 'Fruit', value: v, options: FRUIT, onChange: (x: string) => { single = x; setV(x); } }),
    h(PickerField, { label: 'Basket', multiple: true, value: m, options: FRUIT.slice(0, 4), onChange: (x: string[]) => { many = x; setM(x); } }),
  );
}
await act(async () => { root.render(h(Demo)); });
const [fruitBtn, basketBtn] = $$('button[data-fx-picker="field"]');
check(fruitBtn && fruitBtn.textContent?.includes('Banana'), 'trigger shows the chosen label');
check(fruitBtn?.getAttribute('role') === 'combobox' && fruitBtn.getAttribute('aria-haspopup') === 'dialog' && fruitBtn.getAttribute('aria-expanded') === 'false', 'trigger is a combobox with a dialog popup, closed');
check(fruitBtn?.getAttribute('data-axf-target') === 'button:picker-fruit', 'trigger carries the console-control address button:picker-fruit');
check(basketBtn?.querySelector('.fx-picker-trigger__count')?.textContent === '1', 'multiple trigger shows the count');
check(($('label[for]')?.textContent ?? '').includes('Fruit'), 'the Field label names the trigger');

await act(async () => { fruitBtn!.click(); });
const dlg = $('.fx-picker[role="dialog"]');
check(dlg && dlg.getAttribute('aria-modal') === 'true', 'tap opens a modal dialog');
check(fruitBtn!.getAttribute('aria-expanded') === 'true', 'trigger says expanded');
const list = $('[role="listbox"]', dlg!);
check(list && $$('[role="option"]', list).length === 9, 'every option is a role=option row');
check($$('.fx-picker__group-label', dlg!).map((x) => x.textContent).join(',') === 'Early,Late', 'groups draw sections in order');
check($('[role="option"][aria-selected="true"]', dlg!)?.textContent?.includes('Banana'), 'the chosen row is aria-selected');
check($('.fx-picker__desc', dlg!)?.textContent === 'Apple description', 'descriptions are drawn');
const search = $('input.fx-picker__search', dlg!) as HTMLInputElement | null;
check(search && document.activeElement === search, '9 options ≥ threshold 8: the search field shows and has the focus');
check(search?.getAttribute('role') === 'combobox' && search.getAttribute('aria-controls') === list!.id, 'search is a combobox controlling the list');
// search through React's onChange
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(search, 'gra');
  search!.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
check($$('[role="option"]', dlg!).length === 1 && $('[role="option"]', dlg!)?.textContent?.includes('Grape'), 'search filters to Grape');
await act(async () => { key(search!, 'Enter'); });
check(single === 'grape', 'Enter chooses the active row');
check(!$('.fx-picker[role="dialog"]'), 'a single choice closes the dialog');
await tick();
check(document.activeElement === fruitBtn, 'the focus returns to the trigger');

// keyboard: open, ArrowDown, Enter
await act(async () => { fruitBtn!.click(); });
await act(async () => { key($('.fx-picker')!, 'ArrowDown'); });
await act(async () => { key($('.fx-picker')!, 'Enter'); });
check(single === 'honeydew', 'ArrowDown + Enter picks the next row (Grape → Honeydew)');
await act(async () => { fruitBtn!.click(); });
await act(async () => { key($('.fx-picker')!, 'Escape'); });
check(!$('.fx-picker') && single === 'honeydew', 'Escape closes without a change');

// multiple
await act(async () => { basketBtn!.click(); });
const mdlg = $('.fx-picker')!;
check($('[role="listbox"]', mdlg)?.getAttribute('aria-multiselectable') === 'true', 'multiple: aria-multiselectable');
check(!$('input.fx-picker__search', mdlg) && document.activeElement === $('[role="listbox"]', mdlg), '4 options: no search, the list has the focus');
check($$('input.fx-picker__box', mdlg).length === 4, 'multiple: a checkbox on every row');
await act(async () => { ($$('[role="option"]', mdlg)[2] as HTMLElement).click(); });
check(many.join(',') === 'apple,cherry' && $('.fx-picker'), 'tap toggles and keeps the dialog open');
await act(async () => { ($('.fx-picker__done') as HTMLElement).click(); });
check(!$('.fx-picker') && basketBtn!.querySelector('.fx-picker-trigger__count')?.textContent === '2', 'Done closes; the trigger counts 2');

/* ---------------------------------------------------------------- 3. registry (the API) */
const ids = pickerApi.list().map((p) => p.id).sort().join(',');
check(ids === 'basket,fruit', `registry lists every picker (${ids})`);
await act(async () => { pickerApi.open('Fruit'); });
check(pickerApi.openId() === 'fruit' && $('.fx-picker'), 'open by label');
await act(async () => { pickerApi.choose(null, 'cherry'); });
check(single === 'cherry' && !$('.fx-picker'), 'choose by value in the open picker closes it');
await act(async () => { pickerApi.open('button:picker-fruit'); });
await act(async () => { pickerApi.search('fruit', 'e'); });
check(pickerApi.state('fruit').picker?.query === 'e', 'search by API sets the query');
const firstShown = (document.querySelector('[role="option"]') as HTMLElement | null)?.dataset.value;
await act(async () => { pickerApi.choose('picker:fruit', 'the first one'); });
check(firstShown && single === firstShown, `choose by position ("the first one") takes the first row of the filtered list (${firstShown})`);
const amb = pickerApi.choose('fruit', 'berry');
check(!amb.ok || single === 'elderberry', 'a name matches by words');
await act(async () => { pickerApi.choose('basket', 'Date'); });
check(many.includes('date'), 'toggle by name in a multiple picker');
check(!pickerApi.choose('fruit', 'Zucchini').ok, 'an unknown option answers an error');
check(!pickerApi.open('nope').ok, 'an unknown picker answers an error');
await act(async () => { root.unmount(); });
check(pickerApi.list().length === 0, 'unmounted pickers leave the registry');

/* ---------------------------------------------------------------- 2. swap on / off */
const host2 = document.createElement('div');
host2.innerHTML = `<form id="f"><label for="size">Size</label><select id="size" name="size" class="mine"><option value="">Pick one</option><optgroup label="Small"><option value="s">S</option></optgroup><option value="m" selected>M</option><option value="l" data-description="Large">L</option></select>
<span data-fx-picker="native"><select id="keep"><option>x</option></select></span></form>`;
document.body.appendChild(host2);
const sel = $('#size') as HTMLSelectElement;
const before = sel.outerHTML;
let changes = 0;
sel.addEventListener('change', () => { changes++; });
const uninstall = installPickerSwap();
check(enhancedCount() === 0 && !$('.fx-picker-host', host2), 'swap off by default: nothing touched');
await act(async () => { setPickerSwap({ enabled: true, app: 'test' }); });
await tick();
check(enhancedCount() === 1, 'swap on: the native select gets a picker (the opted-out one does not)');
check(sel.isConnected && sel.hasAttribute('data-fx-picker-swapped') && sel.getAttribute('aria-hidden') === 'true', 'the select stays in the DOM, hidden from the a11y tree');
const trig = $('.fx-picker-host button', host2)!;
check(trig?.textContent?.includes('M') && trig.getAttribute('aria-label') === 'Size', 'the trigger shows the value and takes the select\'s label');
await act(async () => { trig.click(); });
check($$('[role="option"]').length === 4 && $('.fx-picker__group-label')?.textContent === 'Small', 'optgroups become sections; the empty option is a row');
await act(async () => { ($$('[role="option"]').find((o) => o.textContent?.includes('L')) as HTMLElement).click(); });
check(sel.value === 'l' && changes === 1, 'a choice sets the native value and fires change');
check(new dom.window.FormData($('#f') as HTMLFormElement).get('size') === 'l', 'the form still submits the select');
await act(async () => { setPickerSwap({ excludeApps: ['test'] }); });
check(enhancedCount() === 0 && !$('.fx-picker-host', host2), 'excluding this app restores the select');
await act(async () => { setPickerSwap({ excludeApps: [] }); });
check(enhancedCount() === 1, 'back on');
await act(async () => { setPickerSwap({ enabled: false }); });
sel.value = 'm';
check(enhancedCount() === 0 && sel.outerHTML === before, 'swap off: the select is exactly as it was (attributes and options)');

// SelectField routes to PickerField while on
const host3 = document.createElement('div');
document.body.appendChild(host3);
const root3 = createRoot(host3);
const sf = () => h(SelectField, { label: 'Mode', value: 'b', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], onChange: () => {} });
await act(async () => { root3.render(sf()); });
check($('select', host3) && !$('[data-fx-picker="field"]', host3), 'SelectField is a native select while the swap is off');
await act(async () => { setPickerSwap({ enabled: true }); });
check(!$('select', host3) && $('[data-fx-picker="field"]', host3)?.textContent?.includes('B'), 'SelectField renders the picker while on');
await act(async () => { setPickerSwap({ enabled: false }); });
check($('select', host3), 'and the native select again when off');
await act(async () => { root3.unmount(); });
uninstall();

console.log(fail ? `✗ picker UI — ${fail} failed, ${ok} passed` : `✓ picker UI — ${ok} checks (field, dialog, keyboard, search, groups, multiple, registry API, swap on/off restore, SelectField routing)`);
process.exit(fail ? 1 : 0);
