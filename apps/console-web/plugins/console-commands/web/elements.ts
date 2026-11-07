/*
 * Elements on screen and setting values for remote callers (control@1 console.elements / console.values,
 * full-api-control, Nov 7 2026, Brett: "the API must be able to do anything I can do by hand in the console").
 *
 * The console answers what it shows right now: every button, switch, tab, menu item, context-menu entry, toolbar
 * button, field and link (dialogs, menus and pop-ups included), each with a stable id `<where>/<role>:<label>`, and
 * presses, flips, fills, focuses or right-clicks one. Never for Brett's own taps: anything inside
 * `[data-axf-person-only]` (approvals, owner-only settings) is listed but refused, and every press runs through
 * `rt.actions.asRemote`, so a personOnly action it reaches refuses too. A press that deletes or resets something waits
 * for the caller's confirm token (the server asks for it; `confirmed` on the message says it was given).
 */
import type { AxfRuntime } from '@console/axf/core';
import {
  CONSOLE_ELEMENT_ROLES, CONSOLE_ELEMENTS_MAX, consoleElementDestructive, consoleElementId, consoleElementResolve, foldWords, type ConsoleMessage,
} from '@console/axf/core/engines/console-commands.mjs';

export type Answer = [boolean, string, Record<string, unknown>?];

export interface ScreenElement {
  id: string; role: string; label: string; where: string;
  state?: { checked?: boolean; pressed?: boolean; selected?: boolean; expanded?: boolean; disabled?: boolean; value?: string };
  options?: string[]; danger?: boolean; personOnly?: boolean;
}

const ROLE_SELECTOR = CONSOLE_ELEMENT_ROLES.map((r) => `[role="${r}"]`).join(', ');
const SELECTOR = `button, a[href], input:not([type="hidden"]), select, textarea, ${ROLE_SELECTOR}`;
const SCOPES = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="toolbar"], [role="tablist"], [data-axf-tab-group], [role="navigation"], nav, [data-axf-panel], [role="region"], section, [data-axf-banner], header';
const FLASH = 'axf-cc-flash';

const clip = (s: string | null | undefined, n = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function roleOf(el: Element): string {
  const r = el.getAttribute('role');
  if (r && CONSOLE_ELEMENT_ROLES.includes(r)) return r;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type;
    return t === 'checkbox' ? 'checkbox' : t === 'radio' ? 'radio' : t === 'range' ? 'slider' : t === 'number' ? 'spinbutton' : t === 'search' ? 'searchbox' : t === 'button' || t === 'submit' || t === 'reset' ? 'button' : 'textbox';
  }
  return 'button';
}

function labelOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return clip(aria);
  const by = el.getAttribute('aria-labelledby');
  if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '); if (clip(t)) return clip(t); }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const lab = el.labels?.[0]?.textContent || el.closest('label')?.textContent;
    if (clip(lab)) return clip(lab);
    if ('placeholder' in el && el.placeholder) return clip(el.placeholder);
    if (el.name) return clip(el.name);
  }
  return clip(el.getAttribute('title')) || clip(el.textContent) || clip(el.getAttribute('data-tip')) || clip(el.getAttribute('data-axf-toolbar'));
}

function whereOf(rt: AxfRuntime, el: Element): string {
  const s = el.parentElement?.closest(SCOPES);
  if (s) {
    const name = s.getAttribute('aria-label') || s.getAttribute('data-axf-tab-group') || s.getAttribute('data-axf-toolbar') || s.getAttribute('data-axf-panel')
      || s.querySelector('h1, h2, h3, [role="heading"], .fx-dialog__title')?.textContent || s.getAttribute('role') || s.tagName.toLowerCase();
    return clip(name, 50);
  }
  return rt.getState().view || 'screen';
}

function visible(el: Element): boolean {
  if (!el.getClientRects().length) return false;
  if (el.closest('[aria-hidden="true"], [inert]')) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

function stateOf(el: Element): ScreenElement['state'] {
  const st: NonNullable<ScreenElement['state']> = {};
  const a = (n: string) => el.getAttribute(n);
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) st.checked = el.checked;
  else if (a('aria-checked')) st.checked = a('aria-checked') === 'true';
  if (a('aria-pressed')) st.pressed = a('aria-pressed') === 'true';
  if (a('aria-selected')) st.selected = a('aria-selected') === 'true';
  if (a('aria-expanded')) st.expanded = a('aria-expanded') === 'true';
  if ((el as HTMLButtonElement).disabled || a('aria-disabled') === 'true') st.disabled = true;
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    if (!(el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'password'))) st.value = clip(el.value, 200);
  } else if (a('aria-valuenow')) st.value = String(a('aria-valuenow'));
  return Object.keys(st).length ? st : undefined;
}

/** Everything a person could press, flip or fill on screen right now, with its stable id. */
export function scan(rt: AxfRuntime): { items: ScreenElement[]; els: Map<string, Element> } {
  const items: ScreenElement[] = [];
  const els = new Map<string, Element>();
  const seen = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
    if (!visible(el) || el.closest('[data-axf-cc-skip]')) continue;
    if (el.matches('a[href]') && el.querySelector(SELECTOR)) continue; // a link wrapping a button: the button is the element
    const role = roleOf(el), label = labelOf(el), where = whereOf(rt, el);
    const base = consoleElementId({ own: el.getAttribute('data-axf-id') ?? '', where, role, label });
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    const id = n > 1 && !el.getAttribute('data-axf-id') ? consoleElementId({ where, role, label, n }) : base;
    const danger = el.matches('.fx-btn--danger, [data-tone="danger"], .is-danger, [data-axf-danger]');
    const item: ScreenElement = { id, role, label, where, state: stateOf(el), ...(danger ? { danger: true } : {}), ...(el.closest('[data-axf-person-only]') ? { personOnly: true } : {}) };
    if (el instanceof HTMLSelectElement) item.options = Array.from(el.options).map((o) => clip(o.value || o.text, 60)).slice(0, 50);
    if (!item.state) delete item.state;
    items.push(item); els.set(id, el);
    if (items.length >= CONSOLE_ELEMENTS_MAX * 4) break;
  }
  return { items, els };
}

/** Put a value into a field the way typing would, so React's own handlers see it. */
function fill(el: Element, value: unknown): string | null {
  if (el instanceof HTMLSelectElement) {
    const want = String(value);
    const opt = Array.from(el.options).find((o) => o.value === want) ?? Array.from(el.options).find((o) => foldWords(o.text) === foldWords(want));
    if (!opt) return `no choice "${want}" (${Array.from(el.options).map((o) => o.value || o.text).join(', ')})`;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, opt.value);
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, String(value));
  } else if ((el as HTMLElement).isContentEditable) {
    (el as HTMLElement).textContent = String(value);
  } else return 'that element takes no typed value (press it, or toggle it)';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return null;
}

function flash(el: Element) {
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  el.classList.add(FLASH);
  setTimeout(() => el.classList.remove(FLASH), 1800);
}

function describe(rt: AxfRuntime, el: Element, id: string): ScreenElement | null {
  if (!el.isConnected) return null;
  const s = stateOf(el);
  return { id, role: roleOf(el), label: labelOf(el), where: whereOf(rt, el), ...(s ? { state: s } : {}) };
}

/** op `elements`: list (arg = words, spec = limit) or get one (target). */
export function listElements(rt: AxfRuntime, m: ConsoleMessage): Answer {
  const { items } = scan(rt);
  if (m.target) {
    const r = consoleElementResolve(items, m.target);
    if (!r.item) return [false, r.ambiguous ? `"${m.target}" matches several elements; send the id` : `nothing on screen is "${m.target}"`, { code: r.ambiguous ? 'validation' : 'not_found', candidates: (r.candidates ?? []).slice(0, 8) }];
    return [true, `${r.item.label} (${r.item.role})`, { item: r.item }];
  }
  const words = foldWords(m.arg ?? '').split(' ').filter(Boolean);
  const hits = words.length ? items.filter((e) => { const t = foldWords(`${e.label} ${e.where} ${e.role} ${e.id}`); return words.every((w) => t.includes(w)); }) : items;
  const limit = Math.max(1, Math.min(Number(m.spec) || 200, CONSOLE_ELEMENTS_MAX));
  return [true, `${hits.length} element(s) on screen`, { items: hits.slice(0, limit), total: hits.length, screen: rt.getState().view, dialog: rt.getState().dialog?.id ?? '' }];
}

/** op `press`: press | toggle | set | focus | context one element. */
export function pressElement(rt: AxfRuntime, m: ConsoleMessage): Answer {
  const { items, els } = scan(rt);
  const r = consoleElementResolve(items, m.target);
  if (!r.item) return [false, r.ambiguous ? `"${m.target}" matches several elements; send the id` : `nothing on screen is "${m.target}" (list console.elements to see what is)`, { code: r.ambiguous ? 'validation' : 'not_found', candidates: (r.candidates ?? []).slice(0, 8) }];
  const item = r.item as ScreenElement;
  const el = els.get(item.id)!;
  const verb = m.verb ?? 'press';
  let input: { on?: boolean; value?: unknown } = {};
  try { input = JSON.parse(m.arg || '{}') as typeof input; } catch { /* none */ }
  if (item.personOnly && verb !== 'focus') return [false, `${item.label} needs Brett's own tap`, { code: 'denied', element: item }];
  if (item.state?.disabled && verb !== 'focus') return [false, `${item.label} is switched off right now`, { code: 'validation', element: item }];
  if (verb !== 'focus' && verb !== 'context' && consoleElementDestructive(item) && !m.confirmed) return [false, `pressing ${item.label} deletes or resets something`, { needsConfirm: true, element: item }];
  if (verb === 'focus') { flash(el); (el as HTMLElement).focus?.(); return [true, `showing ${item.label}`, { element: item }]; }
  flash(el);
  if (verb === 'context') {
    const b = el.getBoundingClientRect();
    rt.actions.asRemote(() => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 2 })));
    return [true, `opened the menu of ${item.label} (list console.elements for its items)`, { element: item }];
  }
  if (verb === 'set') {
    const why = fill(el, input.value);
    if (why) return [false, why, { code: 'validation', element: item }];
    return [true, `set ${item.label}`, { element: describe(rt, el, item.id) }];
  }
  if (verb === 'toggle' && typeof input.on === 'boolean') {
    const now = item.state?.checked ?? item.state?.pressed ?? item.state?.selected;
    if (now === input.on) return [true, `${item.label} was already ${input.on ? 'on' : 'off'}`, { element: item }];
  }
  rt.actions.asRemote(() => (el as HTMLElement).click());
  return [true, `${verb === 'toggle' ? 'flipped' : 'pressed'} ${item.label}`, { element: describe(rt, el, item.id) ?? item }];
}

/** ops `read` / `set` / `unset`: a setting's value through the settings registry, exactly as its control writes it. */
export function valueOp(rt: AxfRuntime, m: ConsoleMessage): Answer {
  const key = m.target ?? '';
  const spec = rt.settings.spec(key);
  if (m.op === 'read') {
    if (spec?.kind === 'secret') return [false, `${spec.label} is a secret: never read back`, { code: 'denied' }];
    return [true, `${spec?.label ?? key}`, { value: rt.settings.get(key) ?? null, item: spec ? { key, label: spec.label, kind: spec.kind, default: spec.default ?? null } : { key, undeclared: true } }];
  }
  if (spec?.requires && !rt.can(spec.requires)) return [false, `this role can't change ${spec.label} (${spec.requires})`, { code: 'denied' }];
  const was = spec?.kind === 'secret' ? '(secret)' : rt.settings.get(key) ?? null;
  if (m.op === 'unset') { rt.settings.clear(key); return [true, `reset ${spec?.label ?? key}`, { value: spec?.kind === 'secret' ? '(secret)' : rt.settings.get(key) ?? null, was }]; }
  let value: unknown;
  try { value = JSON.parse(m.arg ?? 'null'); } catch { return [false, 'the value is not JSON', { code: 'validation' }]; }
  rt.settings.set(key, value as never);
  return [true, `set ${spec?.label ?? key}`, { value: spec?.kind === 'secret' ? '(secret)' : rt.settings.get(key) ?? null, was }];
}
