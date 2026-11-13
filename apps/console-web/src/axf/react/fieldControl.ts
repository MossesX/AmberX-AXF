/**
 * Fields and buttons on any screen (console-control@1 → "Fields and buttons on any screen", spec/CONSOLE-CONTROL.md;
 * build full-voice-api-control-type-fields-press, Nov 13 2026).
 *
 * Brett: "full voice control for API so I can build, control absolutely everything, don't even have to touch the phone at
 * all". Registered targets cover the framework controls that opt in (TabGroup, settings rows, grids, Button with an id).
 * This layer covers everything else on the surface in front (the open dialog, else the main pane): every input, select,
 * textarea, switch, checkbox, radio / choice group, button, menu item and tab that no registered target already owns gets
 * an address, so the New Project wizard and any plugin dialog can be filled in and submitted without a tap:
 *
 *   view:projects/panel:dialog:new-project/setting:field.name        a text field (set = type into it)
 *   view:projects/panel:dialog:new-project/setting:field.template    a select / choice group (set = pick by value or label)
 *   view:projects/panel:dialog:new-project/button:create             a button (press = click)
 *
 * The kinds are the contract's own (`setting` = a control with a value, `button` = a control that does one thing, `panel`
 * = the dialog), so no transport changes: `list` lists them, `state` reads them (type, value, required, options),
 * `set` types / picks / toggles, `press` clicks, `focus` scrolls to and highlights. `screenReport()` is the read-back
 * (what is on screen: view, dialog, fields with values, buttons, tabs, headings) that `state` with no address answers.
 *
 * Values are typed the way a person would: the native value setter plus `input` and `change` events, so React-controlled
 * inputs see the change. A password's value is never read back (`••••`). Nothing here is styled: the highlight is the
 * registry's own theme-token class.
 */
import type { AxfRuntime } from '../core';
import { controlRegistry, controlSlug, type ControlRegistry, type ControlTargetDef } from './controlTargets';

/** Ids starting with this prefix are auto-discovered fields (`setting:field.<id>`), never settings-registry keys. */
export const FIELD_ID_PREFIX = 'field.';
/** An element (or an ancestor) with this attribute is never auto-discovered (the chrome, a live preview, a terminal). */
export const FIELD_SKIP_ATTR = 'data-axf-control-skip';

export type FieldType = 'text' | 'textarea' | 'number' | 'email' | 'password' | 'url' | 'search' | 'tel' | 'date' | 'time' | 'datetime-local' | 'color' | 'range' | 'file'
  | 'select' | 'switch' | 'checkbox' | 'choice' | 'multichoice';

export interface FieldInfo {
  address: string;
  id: string;
  label: string;
  type: FieldType;
  value: unknown;
  required: boolean;
  disabled: boolean;
  options?: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  error?: string;
}

export interface ButtonInfo { address: string; id: string; label: string; role: 'button' | 'menuitem' | 'tab' | 'link'; disabled: boolean; selected?: boolean }

export interface ScreenReport {
  view: string;
  title: string;
  /** the open dialog, or null */
  dialog: { id: string; title: string; address: string } | null;
  /** the address prefix of everything below (`view:x` or `view:x/panel:dialog:y`) */
  surface: string;
  headings: string[];
  fields: FieldInfo[];
  buttons: ButtonInfo[];
  /** the visible text of the surface, trimmed (for narration) */
  text: string;
}

const FIELD_SELECTOR = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea, [role=switch], [role=checkbox]:not(input), [contenteditable=true]';
const BUTTON_SELECTOR = 'button, [role=button], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], a[href], input[type=submit], input[type=button]';
const CHOICE_GROUP = '[role=radiogroup], [role=group][aria-label]';
const DIALOG_SELECTOR = '[role=dialog][aria-modal=true], [role=alertdialog], dialog[open]';
const MAIN_SELECTOR = '[data-axf-view]:not([hidden]), .fx-main__inner:not([hidden]), main';
const REACT_ID = /^(:r[\w]*:|«r[\w]*»|r\d+)$/;

/* ================================================================== pure-ish helpers */

const textOf = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const visible = (el: Element) => {
  if (!(el instanceof HTMLElement)) return true;
  if (el.hidden || el.closest('[hidden], [aria-hidden=true], [inert]')) return false;
  return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0 || el.offsetParent !== null;
};
const skipped = (el: Element) => !!el.closest(`[${FIELD_SKIP_ATTR}]`);

/** The accessible label of a control: aria-label, aria-labelledby, `<label for>`, the wrapping label, the framework Field's label, placeholder, title. */
export function labelOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) { const t = by.split(/\s+/).map((id) => textOf(el.ownerDocument.getElementById(id))).filter(Boolean).join(' '); if (t) return t; }
  if (el.id) { const l = el.ownerDocument.querySelector(`label[for="${cssEscape(el.id)}"]`); if (l && textOf(l)) return textOf(l); }
  const wrap = el.closest('label');
  if (wrap && textOf(wrap)) return textOf(wrap);
  const field = el.closest('.fx-field');
  const fl = field?.querySelector('.fx-field__label, label, legend');
  if (fl && textOf(fl)) return textOf(fl);
  const ph = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name');
  return (ph ?? '').trim();
}

function fieldType(el: Element): FieldType {
  const role = el.getAttribute('role');
  if (role === 'switch') return 'switch';
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLTextAreaElement || el.getAttribute('contenteditable') === 'true') return 'textarea';
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'choice';
    return (['number', 'email', 'password', 'url', 'search', 'tel', 'date', 'time', 'datetime-local', 'color', 'range', 'file'].includes(t) ? t : 'text') as FieldType;
  }
  if (role === 'checkbox') return 'checkbox';
  return 'text';
}

function checkedOf(el: Element): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  return el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true';
}

function disabledOf(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' || !!el.closest('fieldset[disabled]');
}

/** "on" / "yes" / "true" / "1" / "checked" → true, "off" / "no" / "false" / "0" → false, "toggle" → !current. */
export function boolWord(value: unknown, current: boolean): boolean | null {
  if (typeof value === 'boolean') return value;
  const w = String(value ?? '').trim().toLowerCase();
  if (['toggle', 'flip', 'switch'].includes(w)) return !current;
  if (['on', 'yes', 'true', '1', 'checked', 'enable', 'enabled', 'tick', 'ticked', 'check'].includes(w)) return true;
  if (['off', 'no', 'false', '0', 'unchecked', 'disable', 'disabled', 'untick', 'clear', 'uncheck'].includes(w)) return false;
  return null;
}

/** The option a spoken / typed value means: exact value, then exact label, then a label that starts with or contains it (case-insensitive). */
export function pickOption<T extends { value: string; label: string; disabled?: boolean }>(options: T[], value: unknown): T | null {
  const w = String(value ?? '').trim().toLowerCase();
  if (!w) return null;
  const live = options.filter((o) => !o.disabled);
  return live.find((o) => o.value.toLowerCase() === w) ?? live.find((o) => o.label.toLowerCase() === w)
    ?? live.find((o) => o.label.toLowerCase().startsWith(w)) ?? live.find((o) => o.label.toLowerCase().includes(w))
    ?? live.find((o) => controlSlug(o.label) === controlSlug(w)) ?? null;
}

/** Type a value into an input / textarea / select the way a keyboard would (React sees it). */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement, text: string): void {
  if (el.getAttribute('contenteditable') === 'true') {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return;
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  (el as HTMLInputElement).focus?.({ preventScroll: true });
  if (setter) setter.call(el, text); else (el as HTMLInputElement).value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ================================================================== the surface in front */

/** The topmost open dialog, else the main pane, else the body. */
export function activeSurface(doc: Document = document): { el: Element; dialog: Element | null } {
  const dialogs = [...doc.querySelectorAll(DIALOG_SELECTOR)].filter((d) => visible(d) && !skipped(d));
  const dialog = dialogs[dialogs.length - 1] ?? null;
  if (dialog) return { el: dialog, dialog };
  const main = [...doc.querySelectorAll(MAIN_SELECTOR)].find((m) => visible(m) && !skipped(m));
  return { el: main ?? doc.body, dialog: null };
}

/** Open menus and listboxes float outside the surface; their items count as on screen. */
function floatingMenus(doc: Document): Element[] {
  return [...doc.querySelectorAll('[role=menu], [role=listbox]')].filter((m) => visible(m) && !skipped(m));
}

interface Discovered { fields: (FieldInfo & { def: ControlTargetDef })[]; buttons: (ButtonInfo & { def: ControlTargetDef })[]; surface: string; dialog: ScreenReport['dialog']; root: Element }

/**
 * Walk the surface in front and describe every field and button no registered target already owns (`owned` = the
 * elements registered targets point at). Addresses are unique on the surface: a repeated id gets `-2`, `-3`, ….
 */
export function discover(rt: AxfRuntime, owned: Set<Element>, doc: Document = document): Discovered {
  const st = rt.getState() as { view: string; dialog?: { id: string } | null };
  const { el: root, dialog } = activeSurface(doc);
  const dialogId = dialog ? (st.dialog?.id ?? controlSlug(labelOf(dialog) || 'dialog')) : '';
  const dialogTitle = dialog ? (labelOf(dialog) || textOf(dialog.querySelector('h1, h2, h3')) || dialogId) : '';
  const surface = dialog ? `view:${st.view}/panel:dialog:${dialogId}` : `view:${st.view}`;
  const isOwned = (el: Element) => { for (let n: Element | null = el; n && n !== root.parentElement; n = n.parentElement) if (owned.has(n)) return true; return false; };
  const used = new Map<string, number>();
  const unique = (base: string) => { const b = base || 'control'; const n = (used.get(b) ?? 0) + 1; used.set(b, n); return n === 1 ? b : `${b}-${n}`; };
  const idOf = (el: Element, label: string) => {
    const own = el.getAttribute('data-axf-id') || el.getAttribute('name') || (el.id && !REACT_ID.test(el.id) ? el.id : '');
    return controlSlug(own && !/^\d+$/.test(own) ? own : label) || controlSlug(el.getAttribute('type') ?? el.tagName);
  };

  const fields: Discovered['fields'] = [];
  const buttons: Discovered['buttons'] = [];
  const claimed = new Set<Element>();

  // choice groups: a radiogroup (framework ChoiceGrid, native radios) is one field with options
  const groups: Element[] = [...root.querySelectorAll(CHOICE_GROUP)].filter((g) => visible(g) && !skipped(g) && !isOwned(g) && g.querySelector('[role=radio], [role=checkbox], input[type=radio], input[type=checkbox]'));
  const radiosByName = new Map<string, HTMLInputElement[]>();
  for (const r of root.querySelectorAll<HTMLInputElement>('input[type=radio]')) if (r.name && !r.closest(CHOICE_GROUP)) { const l = radiosByName.get(r.name) ?? []; l.push(r); radiosByName.set(r.name, l); }

  const pushChoice = (key: string, label: string, items: Element[], multiple: boolean, anchor: Element) => {
    const optionOf = (it: Element) => ({ value: it instanceof HTMLInputElement ? it.value : (it.getAttribute('data-value') || it.getAttribute('data-id') || controlSlug(labelOf(it) || textOf(it))), label: labelOf(it) || textOf(it), ...(disabledOf(it) ? { disabled: true } : {}) });
    const id = FIELD_ID_PREFIX + unique(key);
    const address = `${surface}/setting:${id}`;
    const read = () => { const on = items.filter(checkedOf).map((it) => optionOf(it).value); return multiple ? on : (on[0] ?? ''); };
    const def: ControlTargetDef = {
      address, kind: 'setting', label, detail: dialogTitle || undefined, keywords: [id, ...items.map((it) => optionOf(it).label)],
      element: () => anchor,
      get: read,
      set: (value) => {
        const want = multiple && (Array.isArray(value) || String(value).includes(',')) ? (Array.isArray(value) ? value : String(value).split(',')).map((v) => String(v).trim()) : [value];
        const opts = items.map((it) => ({ ...optionOf(it), el: it }));
        for (const w of want) {
          const o = pickOption(opts, w);
          if (!o) return `${label} has no option "${String(w)}" (options: ${opts.map((x) => x.label).join(', ')})`;
          if (!checkedOf(o.el)) (o.el as HTMLElement).click();
        }
        return undefined;
      },
      isDisabled: () => items.every(disabledOf),
      state: () => ({ type: multiple ? 'multichoice' : 'choice', options: items.map(optionOf), required: anchor.getAttribute('aria-required') === 'true', source: 'screen' }),
    };
    items.forEach((it) => claimed.add(it));
    fields.push({ address, id, label, type: multiple ? 'multichoice' : 'choice', value: read(), required: anchor.getAttribute('aria-required') === 'true', disabled: items.every(disabledOf), options: items.map(optionOf), def });
  };

  for (const g of groups) {
    const items = [...g.querySelectorAll('[role=radio], [role=checkbox], input[type=radio], input[type=checkbox]')].filter((it) => visible(it) && !isOwned(it));
    if (!items.length) continue;
    const multiple = items.some((it) => it.getAttribute('role') === 'checkbox' || (it instanceof HTMLInputElement && it.type === 'checkbox'));
    const label = labelOf(g) || textOf(g.closest('.fx-field, fieldset')?.querySelector('.fx-field__label, legend')) || 'Choice';
    pushChoice(idOf(g, label), label, items, multiple, g);
  }
  for (const [name, radios] of radiosByName) {
    const live = radios.filter((r) => visible(r) && !isOwned(r));
    if (!live.length) continue;
    const label = textOf(live[0]!.closest('fieldset')?.querySelector('legend')) || name;
    pushChoice(controlSlug(name), label, live, false, live[0]!.closest('fieldset') ?? live[0]!);
  }

  for (const el of root.querySelectorAll(FIELD_SELECTOR)) {
    if (claimed.has(el) || !visible(el) || skipped(el) || isOwned(el)) continue;
    if (el instanceof HTMLInputElement && el.type === 'color' && el.parentElement?.querySelector('input:not([type=color])')) continue; // ColorField: the text input carries the value
    const label = labelOf(el) || 'Field';
    const type = fieldType(el);
    const id = FIELD_ID_PREFIX + unique(idOf(el, label));
    const address = `${surface}/setting:${id}`;
    const isBool = type === 'switch' || type === 'checkbox';
    const options = el instanceof HTMLSelectElement ? [...el.options].map((o) => ({ value: o.value, label: o.label || o.text, ...(o.disabled ? { disabled: true } : {}) })) : undefined;
    const required = (el as HTMLInputElement).required === true || el.getAttribute('aria-required') === 'true';
    const read = (): unknown => {
      if (isBool) return checkedOf(el);
      if (type === 'password') return (el as HTMLInputElement).value ? '••••' : '';
      if (el.getAttribute('contenteditable') === 'true') return textOf(el);
      if (type === 'number' || type === 'range') { const v = (el as HTMLInputElement).value; return v === '' ? '' : Number(v); }
      return (el as HTMLInputElement).value ?? '';
    };
    const errorOf = () => { const ids = el.getAttribute('aria-describedby'); const err = el.getAttribute('aria-invalid') === 'true' && ids ? ids.split(/\s+/).map((i) => textOf(el.ownerDocument.getElementById(i))).filter(Boolean).join(' ') : ''; return err || undefined; };
    const def: ControlTargetDef = {
      address, kind: 'setting', label, detail: dialogTitle || undefined, keywords: [id, el.getAttribute('placeholder') ?? ''],
      element: () => el,
      get: read,
      set: (value) => {
        if (type === 'file') return `${label} takes a file: it can't be typed`;
        if (isBool) {
          const want = boolWord(value, checkedOf(el));
          if (want === null) return `${label} is on or off: say on, off or toggle`;
          if (want !== checkedOf(el)) (el as HTMLElement).click();
          return undefined;
        }
        if (el instanceof HTMLSelectElement) {
          const o = pickOption(options ?? [], value);
          if (!o) return `${label} has no option "${String(value)}" (options: ${(options ?? []).map((x) => x.label).join(', ')})`;
          typeInto(el, o.value);
          return undefined;
        }
        const text = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value);
        if ((type === 'number' || type === 'range') && text !== '' && !Number.isFinite(Number(text))) return `${label} takes a number`;
        typeInto(el as HTMLInputElement, text);
        return undefined;
      },
      isDisabled: () => disabledOf(el) || (el as HTMLInputElement).readOnly === true,
      state: () => ({ type, required, ...(options ? { options } : {}), ...(el.getAttribute('placeholder') ? { placeholder: el.getAttribute('placeholder') } : {}), ...(errorOf() ? { error: errorOf() } : {}), source: 'screen' }),
    };
    fields.push({ address, id, label, type, value: read(), required, disabled: disabledOf(el), ...(options ? { options } : {}), ...(el.getAttribute('placeholder') ? { placeholder: el.getAttribute('placeholder')! } : {}), ...(errorOf() ? { error: errorOf() } : {}), def });
  }

  const buttonRoots = [root, ...floatingMenus(doc).filter((m) => !root.contains(m))];
  for (const r of buttonRoots) for (const el of r.querySelectorAll(BUTTON_SELECTOR)) {
    if (claimed.has(el) || !visible(el) || skipped(el) || isOwned(el)) continue;
    if (el.matches('[role=radio], [role=checkbox], [role=switch]')) continue;
    const label = labelOf(el) || textOf(el) || (el as HTMLInputElement).value || '';
    if (!label) continue;
    const role: ButtonInfo['role'] = el.matches('[role=tab]') ? 'tab' : el.matches('[role^=menuitem]') ? 'menuitem' : el.matches('a[href]:not([role=button])') ? 'link' : 'button';
    const id = unique(idOf(el, label));
    const address = `${surface}/button:${id}`;
    const selected = role === 'tab' ? el.getAttribute('aria-selected') === 'true' : undefined;
    const def: ControlTargetDef = {
      address, kind: 'button', label, detail: dialogTitle || undefined, keywords: [role, el.getAttribute('title') ?? ''],
      element: () => el,
      invoke: () => { (el as HTMLElement).click(); return true; },
      isDisabled: () => disabledOf(el),
      state: () => ({ role, ...(role === 'tab' ? { selected: el.getAttribute('aria-selected') === 'true' } : {}), ...(el.getAttribute('aria-expanded') ? { expanded: el.getAttribute('aria-expanded') === 'true' } : {}), source: 'screen' }),
    };
    buttons.push({ address, id, label, role, disabled: disabledOf(el), ...(selected !== undefined ? { selected } : {}), def });
  }

  return { fields, buttons, surface, dialog: dialog ? { id: dialogId, title: dialogTitle, address: surface } : null, root };
}

/* ================================================================== registry wiring */

const installed = new WeakMap<ControlRegistry, { refresh: () => void }>();

/**
 * Keep the registry's auto targets equal to the surface in front: refreshed before every command runs (the registry
 * calls `refresh`) and after the page changes (a MutationObserver, debounced). The dialog itself is a `panel` target
 * (open = it is already open; `state` = its title and field count). Returns the uninstaller.
 */
export function installFieldControl(rt: AxfRuntime, doc: Document = document): () => void {
  const reg = controlRegistry(rt);
  let offs: (() => void)[] = [];
  let last = '';
  const refresh = () => {
    const owned = reg.ownedElements();
    const d = discover(rt, owned, doc);
    const sig = [d.surface, ...d.fields.map((f) => f.address), ...d.buttons.map((b) => b.address)].join('|');
    if (sig === last) return;
    last = sig;
    for (const off of offs) off();
    offs = [];
    if (d.dialog) offs.push(reg.register({ address: d.surface, kind: 'panel', label: d.dialog.title, detail: 'Dialog', keywords: ['dialog', d.dialog.id], element: () => d.root, state: () => ({ dialog: d.dialog!.id, fields: d.fields.length, buttons: d.buttons.length, source: 'screen' }) }, null, { auto: true }));
    for (const f of d.fields) offs.push(reg.register(f.def, null, { auto: true }));
    for (const b of d.buttons) offs.push(reg.register(b.def, null, { auto: true }));
  };
  reg.addRefresher(refresh);
  reg.setScreenReporter(() => screenReport(rt, reg, doc));
  let pending: ReturnType<typeof setTimeout> | null = null;
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => { if (pending) return; pending = setTimeout(() => { pending = null; refresh(); }, 150); }) : null;
  mo?.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'open', 'disabled', 'aria-disabled', 'role'] });
  installed.set(reg, { refresh });
  refresh();
  return () => { mo?.disconnect(); if (pending) clearTimeout(pending); reg.addRefresher(null, refresh); reg.setScreenReporter(null); for (const off of offs) off(); offs = []; installed.delete(reg); };
}

/** What is on screen right now, for narration and verification (the `state` verb with no address answers it as `screen`). */
export function screenReport(rt: AxfRuntime, reg: ControlRegistry = controlRegistry(rt), doc: Document = document): ScreenReport {
  installed.get(reg)?.refresh();
  const d = discover(rt, reg.ownedElements(), doc);
  const st = rt.getState() as { view: string };
  const viewEntry = reg.entry(`view:${st.view}`);
  // registered targets on the surface count too (settings rows, TabGroup tabs, Buttons with an id): listed with the auto ones
  const snap = reg.snapshot();
  const onSurface = (a: string) => a.startsWith(d.surface + '/') || (!d.dialog && a.startsWith(`view:${st.view}/`));
  const regFields: FieldInfo[] = [];
  const regButtons: ButtonInfo[] = [];
  for (const t of snap.targets) {
    if (!onSurface(t.address) || t.address.includes(`/setting:${FIELD_ID_PREFIX}`)) continue;
    const e = reg.entry(t.address);
    if (!e || e.def.virtual) continue;
    const el = e.def.element?.() ?? null;
    if (!el || !visible(el) || !d.root.contains(el)) continue;
    const id = t.address.slice(t.address.lastIndexOf(':') + 1);
    if (t.kind === 'setting') {
      const s = (e.def.state?.() ?? {}) as { type?: string; options?: unknown[] };
      regFields.push({ address: t.address, id, label: t.label, type: (s.type as FieldType) ?? 'text', value: e.def.get?.(), required: false, disabled: !!t.disabled, ...(Array.isArray(s.options) ? { options: s.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o as { value: string; label: string })) } : {}) });
    } else if (t.kind === 'button' || t.kind === 'tab' || t.kind === 'subtab' || t.kind === 'function') {
      regButtons.push({ address: t.address, id, label: t.label, role: t.kind === 'tab' || t.kind === 'subtab' ? 'tab' : 'button', disabled: !!t.disabled, ...(t.kind === 'tab' || t.kind === 'subtab' ? { selected: el.getAttribute('aria-selected') === 'true' } : {}) });
    }
  }
  const strip = <T extends { def?: unknown }>(x: T) => { const { def: _def, ...rest } = x; return rest; };
  const headings = [...d.root.querySelectorAll('h1, h2, h3, [role=heading]')].filter(visible).map(textOf).filter(Boolean).slice(0, 12);
  return {
    view: st.view,
    title: viewEntry?.def.label ?? st.view,
    dialog: d.dialog,
    surface: d.surface,
    headings,
    fields: [...regFields, ...d.fields.map(strip)] as FieldInfo[],
    buttons: [...regButtons, ...d.buttons.map(strip)] as ButtonInfo[],
    text: textOf(d.root).slice(0, 1200),
  };
}

const cssEscape = (s: string) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
