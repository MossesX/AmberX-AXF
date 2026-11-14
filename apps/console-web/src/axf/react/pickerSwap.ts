/**
 * Picker swap layer (picker@1, spec/PICKER.md § 2 "Swap contract"). When the picker swap is on (pickerConfig; the
 * picker-dialog plugin switches it):
 *
 *   - framework SelectFields render a PickerField (Forms.tsx reads the same switch), so their Field label, hint, error
 *     and aria-describedby carry over;
 *   - every remaining native <select> in the document gets a picker trigger next to it. The select stays in the DOM,
 *     visually hidden (`fx-picker__native`), as the source of truth: the form still submits it, a choice sets its value
 *     through the native setter and fires `input` + `change` (bubbling), so React's onChange and plain listeners both
 *     see the same strings they always did. A MutationObserver picks up selects added later and option lists that change.
 *
 * Opt out with `data-fx-picker="native"` on the select or any ancestor. Off (or this app excluded) restores the
 * originals untouched: the trigger roots are unmounted and removed, and the class and marker the layer added are taken
 * off again; nothing else on the select is ever written.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PickerField } from './components/PickerField';
import { labelOfElement } from './components/PickerField';
import { fromNativeOptions, pickerIdOf, type NativeOptionRow, type PickerModel } from '../core/engines/picker';
import { getPickerSwap, subscribePickerSwap, swapActive } from './pickerConfig';

const MARK = 'data-fx-picker-swapped';
const SKIP = '[data-fx-picker="native"], .fx-picker, .fx-picker-host';

interface Enhanced { select: HTMLSelectElement; host: HTMLElement; root: Root; sig: string }
const enhanced = new Map<HTMLSelectElement, Enhanced>();

/** The engine model of a native select, read from the DOM ('' option kept as the empty choice). */
export function readSelect(select: HTMLSelectElement): { model: PickerModel; empty?: string } {
  const rows: NativeOptionRow[] = Array.from(select.options).map((o) => ({
    value: o.value, text: o.text, selected: o.selected, disabled: o.disabled || (o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled),
    group: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : '',
    data: { icon: o.dataset.icon, description: o.dataset.description, keywords: o.dataset.keywords },
  }));
  const label = labelOfElement(select);
  const model = fromNativeOptions({ id: select.id || select.name || label, label, multiple: select.multiple, options: rows });
  const emptyRow = Array.from(select.options).find((o) => o.value === '' && !o.disabled);
  return { model, empty: emptyRow ? emptyRow.text || '—' : undefined };
}

const sigOf = (s: HTMLSelectElement) => `${s.disabled ? 1 : 0}|${s.multiple ? 1 : 0}|${Array.from(s.options).map((o) => `${o.value}\u0001${o.text}\u0001${o.selected ? 1 : 0}${o.disabled ? 1 : 0}`).join('\u0002')}`;

/** Set a native select's value the way a user would, so React and plain listeners both hear it. */
export function writeSelect(select: HTMLSelectElement, value: string[]): void {
  if (select.multiple) for (const o of Array.from(select.options)) o.selected = value.includes(o.value);
  else Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value[0] ?? '');
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function render(e: Enhanced): void {
  const { select } = e;
  const { model, empty } = readSelect(select);
  const common = {
    label: model.label, labelText: model.label, options: model.options, groups: model.groups, bare: true,
    disabled: select.disabled, required: select.required, pickerId: pickerIdOf(model.id), empty,
    searchThreshold: getPickerSwap().searchThreshold ?? undefined,
    describedBy: select.getAttribute('aria-describedby') ?? undefined,
  };
  e.root.render(model.multiple
    ? createElement(PickerField, { ...common, multiple: true, value: model.value, onChange: (v: string[]) => writeSelect(select, v) })
    : createElement(PickerField, { ...common, value: model.value[0] ?? '', onChange: (v: string) => writeSelect(select, [v]) }));
}

export function enhanceSelect(select: HTMLSelectElement): boolean {
  if (enhanced.has(select) || !select.isConnected || select.closest(SKIP)) return false;
  const host = document.createElement('span');
  host.className = 'fx-picker-host';
  select.after(host);
  const e: Enhanced = { select, host, root: createRoot(host), sig: sigOf(select) };
  enhanced.set(select, e);
  select.classList.add('fx-picker__native');
  select.setAttribute(MARK, '');
  select.setAttribute('tabindex', '-1');
  select.setAttribute('aria-hidden', 'true');
  render(e);
  return true;
}

export function restoreSelect(select: HTMLSelectElement): void {
  const e = enhanced.get(select);
  if (!e) return;
  enhanced.delete(select);
  e.root.unmount();
  e.host.remove();
  select.classList.remove('fx-picker__native');
  select.removeAttribute(MARK);
  select.removeAttribute('tabindex');
  select.removeAttribute('aria-hidden');
}

/** Re-read every enhanced select (option lists or values set by script); drop the ones that left the page. */
function sync(): void {
  for (const e of [...enhanced.values()]) {
    if (!e.select.isConnected) { restoreSelect(e.select); continue; }
    const sig = sigOf(e.select);
    if (sig !== e.sig) { e.sig = sig; render(e); }
  }
}

function scan(root: ParentNode = document): void {
  for (const s of Array.from(root.querySelectorAll('select'))) enhanceSelect(s);
}

export const enhancedCount = (): number => enhanced.size;

/**
 * Run the swap for this document while the config says so (AxfProvider calls this once). Returns the cleanup that
 * restores everything.
 */
export function installPickerSwap(): () => void {
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const onChange = (ev: Event) => { const t = ev.target; if (t instanceof HTMLSelectElement && enhanced.has(t)) sync(); };
  const stop = () => {
    observer?.disconnect(); observer = null;
    if (timer) clearInterval(timer); timer = null;
    document.removeEventListener('change', onChange, true);
    for (const s of [...enhanced.keys()]) restoreSelect(s);
  };
  const start = () => {
    if (observer) return;
    scan();
    observer = new MutationObserver((records) => {
      let dirty = false;
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) if (n instanceof Element) { if (n instanceof HTMLSelectElement) enhanceSelect(n); else if (!n.closest('.fx-picker-host, .fx-picker__scrim')) scan(n); }
        if (r.target instanceof Element && r.target.closest(`select[${MARK}]`)) dirty = true;
        if (r.removedNodes.length) dirty = true;
      }
      if (dirty) sync();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label', 'selected', 'value', 'multiple'] });
    document.addEventListener('change', onChange, true);
    // values set by a framework through the DOM property (React's controlled select) change no attribute: a light re-read
    timer = setInterval(sync, 400);
  };
  const apply = () => {
    const c = getPickerSwap();
    document.documentElement.toggleAttribute('data-fx-picker-on', swapActive(c));
    if (swapActive(c) && !c.sheetOnPhone) document.documentElement.setAttribute('data-fx-picker-sheet', 'off');
    else document.documentElement.removeAttribute('data-fx-picker-sheet');
    if (swapActive(c) && c.swapSelects) start(); else stop();
    // the threshold may have changed: redraw the triggers
    for (const e of enhanced.values()) render(e);
  };
  const unsub = subscribePickerSwap(apply);
  apply();
  return () => { unsub(); stop(); document.documentElement.removeAttribute('data-fx-picker-on'); document.documentElement.removeAttribute('data-fx-picker-sheet'); };
}
