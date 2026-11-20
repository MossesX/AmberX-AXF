/**
 * Console screen (console-screen@1, core/engines/console-screen.mjs): the page side of "Amber sees and drives the
 * console by words" (build voice-console-control, Nov 20 2026).
 *
 *   screenMap(rt)        every interactive element on the screen right now, numbered in reading order: its visible
 *                        words, kind, state, console-control@1 address (when the control registry knows it) and its
 *                        box in screenshot pixels. Off-screen ones are listed as "scroll to see".
 *   driveScreen(rt, c)   one console-screen@1 command: click / right-click / double-click a target named by words, a
 *                        number from the last map, an address or x,y; walk a menu path; right-click then pick a
 *                        context-menu item; expand or collapse a row; scroll; type; press keys. Answers with what it
 *                        did and the new map.
 *
 * It acts the way a person does: real pointer, mouse, click, contextmenu and keyboard events on the element under the
 * point, so every screen works without code of its own. Several matches are answered as numbered choices, never
 * guessed. A control that deletes, stops or merges is pressed only with `confirm`; approve / deny never.
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { executeControl } from '@console/control/executor';
import { CONSOLE_SHOT_MAX_WIDTH } from '@console/axf/core/engines/console-commands.mjs';
import {
  CONSOLE_SCREEN_FRAME, CONSOLE_SCREEN_LABEL_MAX, normalizeScreenCommand, screenElementMap, screenResolveTarget, screenTargetGuard,
  type RawScreenElement, type ScreenCommand, type ScreenElement, type ScreenElementKind, type ScreenKey,
} from '@console/axf/core/engines/console-screen.mjs';

const INTERACTIVE = [
  'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea', 'summary', '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]', '[role="option"]', '[role="checkbox"]', '[role="switch"]', '[role="link"]', '[role="treeitem"]', '[role="combobox"]', '[data-axf-row]',
  '[data-axf-target]', '[aria-expanded]', '[contenteditable="true"]', 'article[data-fx-ctx-target]', 'li[data-fx-ctx-target]', '[tabindex]:not([tabindex="-1"])',
].join(', ');
const MENU_ITEMS = '[role="menu"] [role^="menuitem"], .fx-ctx button, .fx-ctx [role^="menuitem"]';
const EXPAND_LABEL = /^(expand|collapse|show the details|fold|unfold|show more|show less|hide the details)\b/i;
/** What stays in a map: the visible elements, then at most this many that need a scroll. */
const AWAY_MAX = 120;

export interface ScreenAnswer {
  $axf: typeof CONSOLE_SCREEN_FRAME; ok: boolean; action: string; did?: string; code?: string; message?: string;
  target?: ScreenElement; candidates?: ScreenElement[]; elements: ScreenElement[]; viewport: { width: number; height: number; scale: number };
  [k: string]: unknown;
}

/** The elements of the last map by number, so "click 7" presses exactly what Amber was shown. */
let lastMap = new Map<number, WeakRef<Element>>();
let lastScale = 0;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const viewport = () => ({ width: document.documentElement.clientWidth || window.innerWidth, height: document.documentElement.clientHeight || window.innerHeight });
/** The scale a whole-page screenshot is drawn at (web/capture.ts), so boxes and x,y targets are in its pixels. */
export const shotScale = () => Math.min(window.devicePixelRatio || 1, CONSOLE_SHOT_MAX_WIDTH / viewport().width);
const squash = (s: string | null | undefined, max = CONSOLE_SCREEN_LABEL_MAX) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The DOM settles: two frames, then no mutation for a short while (at most `max` ms). */
function settled(max = 1500, quiet = 180): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const done = () => { mo.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); };
    const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    timer = setTimeout(done, quiet + 60);
    const cap = setTimeout(done, max);
  });
}

function shown(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null;
  if (el.closest('[inert], [aria-hidden="true"]')) return null;
  return r;
}

/** Is the element what a click at this point would reach (not under a dialog, a menu or another layer)? */
function reachable(el: Element, x: number, y: number): boolean {
  const hit = document.elementFromPoint(x, y);
  return !!hit && (el === hit || el.contains(hit) || hit.closest(INTERACTIVE) === el);
}

function labelOf(el: Element): string {
  const h = el as HTMLElement;
  const aria = el.getAttribute('aria-label');
  if (aria) return squash(aria);
  const by = el.getAttribute('aria-labelledby');
  if (by) { const t = squash(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')); if (t) return t; }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const lab = el.labels?.[0]?.textContent ?? el.closest('label')?.textContent ?? el.closest('.fx-field')?.querySelector('label, .fx-field__label')?.textContent;
    return squash(lab) || squash(el.getAttribute('placeholder')) || squash(el.getAttribute('name')) || squash(el.getAttribute('title')) || (el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase());
  }
  if (el.matches('[data-axf-row], [role="row"]')) {
    const cells = Array.from(el.querySelectorAll('[role="gridcell"], td')).map((c) => squash((c as HTMLElement).innerText ?? c.textContent, 90)).filter(Boolean);
    if (cells.length) return squash(cells.join(' · '), CONSOLE_SCREEN_LABEL_MAX);
  }
  return squash(h.innerText ?? el.textContent) || squash(el.getAttribute('title')) || squash(el.getAttribute('data-help')) || squash(el.getAttribute('data-axf-target'));
}

function kindOf(el: Element): ScreenElementKind {
  const role = el.getAttribute('role') ?? '';
  if (el.matches('[data-axf-row], [role="row"], article[data-fx-ctx-target], li[data-fx-ctx-target]')) return 'row';
  if (role.startsWith('menuitem') || el.closest('.fx-ctx')) return 'menuitem';
  if (role === 'tab') return 'tab';
  if (role === 'option' || role === 'treeitem') return 'option';
  if (role === 'switch') return 'switch';
  if (role === 'checkbox' || (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio'))) return el.closest('.fx-switch') ? 'switch' : 'checkbox';
  if (el instanceof HTMLSelectElement || role === 'combobox') return 'select';
  if (el instanceof HTMLTextAreaElement || el.getAttribute('contenteditable') === 'true') return 'input';
  if (el instanceof HTMLInputElement) return ['button', 'submit', 'reset'].includes(el.type) ? 'button' : 'input';
  if (el.getAttribute('aria-haspopup') === 'menu' || el.hasAttribute('data-axf-menu-btn')) return 'menu';
  if (el.tagName === 'SUMMARY' || (el.hasAttribute('aria-expanded') && !el.getAttribute('aria-haspopup')) || EXPAND_LABEL.test(el.getAttribute('aria-label') ?? '')) return 'expander';
  if (el.tagName === 'A' || role === 'link') return 'link';
  if (el.tagName === 'BUTTON' || role === 'button') return 'button';
  return 'item';
}

/** The row's own expander: a control with aria-expanded, or a button named Expand / Collapse. */
function expanderOf(row: Element): Element | null {
  if (row.hasAttribute('aria-expanded') || row.tagName === 'SUMMARY') return row;
  return row.querySelector('[aria-expanded]') ?? Array.from(row.querySelectorAll('button, [role="button"]')).find((b) => EXPAND_LABEL.test(b.getAttribute('aria-label') ?? squash(b.textContent))) ?? null;
}

function expandedOf(el: Element): boolean | undefined {
  const x = expanderOf(el);
  if (!x) return undefined;
  const a = x.getAttribute('aria-expanded');
  if (a === 'true' || a === 'false') return a === 'true';
  if (x.tagName === 'SUMMARY') return (x.parentElement as HTMLDetailsElement | null)?.open === true;
  return /^(collapse|fold|show less|hide)/i.test(x.getAttribute('aria-label') ?? squash(x.textContent));
}

function stateOf(el: Element, kind: ScreenElementKind): RawScreenElement['state'] {
  const s: NonNullable<RawScreenElement['state']> = {};
  const expanded = kind === 'row' || kind === 'expander' || kind === 'menu' || el.hasAttribute('aria-expanded') ? expandedOf(el) : undefined;
  if (expanded !== undefined) s.expanded = expanded;
  if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'true' || el.getAttribute('aria-current') === 'page' || el.classList.contains('is-active')) s.selected = true;
  if ((el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true') s.disabled = true;
  const checked = el.getAttribute('aria-checked');
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) s.checked = el.checked;
  else if (checked === 'true' || checked === 'false') s.checked = checked === 'true';
  if (el.getAttribute('aria-pressed') === 'true') s.pressed = true;
  if (el.classList.contains('is-danger') || el.classList.contains('fx-btn--danger')) s.danger = true;
  if (el instanceof HTMLSelectElement) s.value = squash(el.selectedOptions[0]?.textContent, 120);
  else if ((el instanceof HTMLInputElement && !['password', 'checkbox', 'radio', 'file', 'button', 'submit'].includes(el.type)) || el instanceof HTMLTextAreaElement) s.value = squash(el.value, 120);
  return s;
}

function groupOf(el: Element): string {
  if (el.closest('.fx-ctx')) return 'context menu';
  const menu = el.closest('[role="menu"]');
  if (menu) return squash(menu.getAttribute('aria-label'), 40) ? `menu ${squash(menu.getAttribute('aria-label'), 40)}` : 'menu';
  const dialog = el.closest('[role="dialog"], [role="alertdialog"], .fx-window');
  if (dialog) return `dialog ${squash(dialog.getAttribute('aria-label') ?? dialog.querySelector('h1, h2, h3, .fx-window__title')?.textContent, 40)}`.trim();
  if (el.closest('[role="menubar"]')) return 'app menu';
  const bar = el.closest('[role="toolbar"]');
  if (bar) return `toolbar ${squash(bar.getAttribute('aria-label'), 40)}`.trim();
  if (el.closest('[role="tablist"]')) return 'tabs';
  if (el.closest('nav')) return 'side menu';
  const grid = el.closest('[role="grid"]');
  if (grid && !el.matches('[data-axf-row]')) { const row = el.closest('[data-axf-row]'); return row ? `row ${squash(labelOf(row), 40)}` : `grid ${squash(grid.getAttribute('aria-label'), 40)}`; }
  if (grid) return `grid ${squash(grid.getAttribute('aria-label'), 40)}`;
  return '';
}

/** Every rendered element the control registry has an address for. */
function addresses(rt: AxfRuntime): Map<Element, string> {
  const out = new Map<Element, string>();
  try {
    const reg = controlRegistry(rt);
    for (const t of reg.snapshot().targets) {
      if (t.virtual) continue;
      const el = reg.entry(t.address)?.def.element?.();
      if (el && !out.has(el)) out.set(el, t.address);
    }
  } catch { /* the registry is not installed: the map still lists everything, without addresses */ }
  return out;
}

/**
 * Every interactive element on the screen, numbered (reading order). `origin` and `scale` place the boxes in the
 * pixels of the screenshot that goes with the map (the whole page by default).
 */
export function screenMap(rt: AxfRuntime, opts: { scale?: number; origin?: { x: number; y: number } } = {}): { elements: ScreenElement[]; viewport: ScreenAnswer['viewport'] } {
  const vp = viewport();
  const scale = opts.scale || lastScale || shotScale();
  const origin = opts.origin ?? { x: 0, y: 0 };
  const known = addresses(rt);
  const modal = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"]')).filter((d) => shown(d)).pop() ?? null;
  const raw: (RawScreenElement & { el: Element })[] = [];
  let away = 0;
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    const r = shown(el);
    if (!r) continue;
    const kind = kindOf(el);
    // a focusable wrapper around real controls names nothing by itself
    if (kind === 'item' && el.querySelector(INTERACTIVE)) continue;
    const inView = r.bottom > 0 && r.right > 0 && r.top < vp.height && r.left < vp.width;
    let visible = false;
    if (inView) {
      const x = Math.min(vp.width - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(vp.height - 1, Math.max(0, r.top + r.height / 2));
      visible = reachable(el, x, y) || reachable(el, Math.min(vp.width - 1, Math.max(0, r.left + 6)), y);
      if (!visible) continue; // under a dialog, a menu or another layer: not something to click now
    } else if (modal && !modal.contains(el)) continue;
    else if (++away > AWAY_MAX) continue;
    const label = labelOf(el);
    if (!label) continue;
    let address = known.get(el);
    for (let p = el.parentElement, i = 0; !address && p && i < 2 && (kind === 'input' || kind === 'checkbox' || kind === 'switch' || kind === 'select'); p = p.parentElement, i++) address = known.get(p);
    raw.push({ el, label, kind, group: groupOf(el), state: stateOf(el, kind), ...(address ? { address } : {}), visible,
      box: { x: (r.left - origin.x) * scale, y: (r.top - origin.y) * scale, w: r.width * scale, h: r.height * scale } });
  }
  const elements = screenElementMap(raw);
  // the engine keeps the order of equal inputs: pair each numbered element with the DOM element it came from
  const pool = new Map<string, Element[]>();
  const keyOf = (e: { label: string; kind: string; box: { x: number; y: number } }) => `${e.kind}|${e.label}|${Math.round(e.box.x)}|${Math.round(e.box.y)}`;
  for (const r of raw) { const k = keyOf({ label: squash(r.label), kind: r.kind, box: r.box }); pool.set(k, [...(pool.get(k) ?? []), r.el]); }
  lastMap = new Map();
  for (const e of elements) { const el = pool.get(keyOf(e))?.shift(); if (el) lastMap.set(e.n, new WeakRef(el)); }
  lastScale = scale;
  return { elements, viewport: { ...vp, scale: Math.round(scale * 100) / 100 } };
}

const elementOf = (e: ScreenElement): Element | null => { const el = lastMap.get(e.n)?.deref(); return el?.isConnected ? el : null; };

/* ================================================================== pointer + keyboard */

function fire(el: Element, type: string, x: number, y: number, button = 0, detail = 1): boolean {
  const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button, buttons: type.endsWith('down') ? (button === 2 ? 2 : 1) : 0, detail };
  const ev = type.startsWith('pointer') && typeof PointerEvent === 'function' ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(type, init);
  return el.dispatchEvent(ev);
}

/** Where a person would click an element: its middle, or the first spot along it that is the element itself (not a button inside a row). */
function pointOn(el: Element): { x: number; y: number; at: Element } {
  const r = el.getBoundingClientRect();
  const y = r.top + r.height / 2;
  const spots = el.querySelector(INTERACTIVE) ? [0.5, 0.25, 0.75, 0.1, 0.9] : [0.5];
  for (const f of spots) {
    const x = r.left + r.width * f;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit)) && (spots.length === 1 || hit.closest(INTERACTIVE) === el)) return { x, y, at: hit };
  }
  return { x: r.left + r.width / 2, y, at: el };
}

function press(at: Element, x: number, y: number, how: 'click' | 'right_click' | 'double_click'): void {
  const button = how === 'right_click' ? 2 : 0;
  const down = (detail: number) => {
    fire(at, 'pointerdown', x, y, button, detail);
    if (fire(at, 'mousedown', x, y, button, detail) && button === 0) (at.closest('button, a[href], input, select, textarea, [tabindex]') as HTMLElement | null)?.focus?.({ preventScroll: true });
    fire(at, 'pointerup', x, y, button, detail);
    fire(at, 'mouseup', x, y, button, detail);
  };
  down(1);
  if (how === 'right_click') { fire(at, 'contextmenu', x, y, 2, 0); return; }
  fire(at, 'click', x, y, 0, 1);
  if (how === 'double_click' && at.isConnected) { down(2); fire(at, 'click', x, y, 0, 2); fire(at, 'dblclick', x, y, 0, 2); }
}

function typeInto(el: Element, value: string): boolean {
  const h = el as HTMLElement;
  h.focus?.({ preventScroll: true });
  if (el instanceof HTMLSelectElement) {
    const want = value.trim().toLowerCase();
    const opt = Array.from(el.options).find((o) => o.value.toLowerCase() === want || squash(o.textContent).toLowerCase() === want) ?? Array.from(el.options).find((o) => squash(o.textContent).toLowerCase().includes(want));
    if (!opt) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, opt.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // React tracks the value it set: go through the native setter so the input event is seen as a change
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (h.isContentEditable) {
    h.textContent = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    return true;
  }
  return false;
}

function pressKey(k: ScreenKey): void {
  const el = (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body) as HTMLElement;
  const init = { key: k.key, code: k.key.length === 1 ? (/[a-z]/i.test(k.key) ? `Key${k.key.toUpperCase()}` : k.key === ' ' ? 'Space' : '') : k.key, bubbles: true, cancelable: true, composed: true, ctrlKey: k.ctrl, shiftKey: k.shift, altKey: k.alt, metaKey: k.meta };
  const went = el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));
  if (!went || k.ctrl || k.alt || k.meta) return; // a handler took it, or a shortcut with no default of its own
  // what the browser itself does for a real key, which a dispatched event does not
  if (k.key === 'Enter' || k.key === ' ') {
    if (el.matches('button, a[href], [role="button"], [role^="menuitem"], [role="tab"], summary, input[type="checkbox"], input[type="radio"]')) el.click();
    else if (k.key === 'Enter' && el instanceof HTMLInputElement) el.form?.requestSubmit?.();
  } else if (k.key === 'Tab') {
    const all = Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((e) => !(e as HTMLButtonElement).disabled && shown(e));
    const i = all.indexOf(el);
    all[(i + (k.shift ? -1 : 1) + all.length) % all.length]?.focus();
  }
}

/* ================================================================== running a command */

type Found = { el: Element; element?: ScreenElement; x: number; y: number; at: Element } | { fail: Partial<ScreenAnswer> };

/** The element (and the point on it) a target names, scrolled into view. */
async function find(rt: AxfRuntime, target: string, prefer: readonly string[], within?: (e: ScreenElement) => boolean): Promise<Found> {
  // a number names what the last map showed, even if the screen moved since
  const numbered = /^#?\d{1,4}$/.test(target.trim()) ? lastMap.get(Number(target.trim().replace('#', '')))?.deref() : undefined;
  let { elements } = screenMap(rt);
  if (within) elements = elements.filter(within);
  let el: Element | null = null;
  let element: ScreenElement | undefined;
  if (numbered?.isConnected) {
    el = numbered;
    element = elements.find((e) => elementOf(e) === numbered);
  } else {
    const r = screenResolveTarget(elements, target, { prefer });
    if (r.point) {
      const x = r.point.x / lastScale, y = r.point.y / lastScale;
      const at = document.elementFromPoint(x, y);
      if (!at) return { fail: { code: 'not_found', message: `${target} is outside the screen (${Math.round(viewport().width * lastScale)}×${Math.round(viewport().height * lastScale)} in screenshot pixels)` } };
      const owner = at.closest(INTERACTIVE);
      return { el: owner ?? at, element: elements.find((e) => elementOf(e) === owner), x, y, at };
    }
    if (!r.element) {
      return { fail: r.ambiguous
        ? { code: 'ambiguous', message: `"${target}" matches ${r.candidates.length} elements: say which by number`, candidates: r.candidates }
        : { code: 'not_found', message: `nothing on the screen is called "${target}"${r.candidates?.length ? '; the closest are listed' : ''}`, candidates: r.candidates ?? [] } };
    }
    element = r.element;
    el = elementOf(r.element);
  }
  if (!el) return { fail: { code: 'not_found', message: `"${target}" is no longer on the screen` } };
  if (!element?.visible) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    await settled(600, 120);
  }
  return { el, element, ...pointOn(el) };
}

/** Stop before a control that deletes, stops or merges (unless confirmed) or that only Brett presses. */
function guard(el: Element, element: ScreenElement | undefined, c: ScreenCommand): Partial<ScreenAnswer> | null {
  const kind = kindOf(el);
  const e = element ?? { label: labelOf(el), state: stateOf(el, kind) };
  const g = screenTargetGuard(e);
  if (g === 'person') return { code: 'denied', personOnly: true, message: `"${e.label}" is a decision only Brett makes with his own tap` };
  if (g === 'destructive' && !c.confirm) return { code: 'confirmation_required', destructive: true, message: `"${e.label}" deletes, stops or merges something: tell Brett what it will do, then send the same call again with confirm=true` };
  if ((el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true') return { code: 'unavailable', because: 'disabled', message: `"${e.label}" is disabled right now` };
  return null;
}

const named = (f: { el: Element; element?: ScreenElement }) => `"${f.element?.label ?? labelOf(f.el) ?? f.el.tagName.toLowerCase()}"`;
const menuOpen = () => Array.from(document.querySelectorAll(MENU_ITEMS)).some((e) => shown(e));
/** Something a menu path steps through: a menu, a menu item, a tab, a link, or anything in the app menu, side menu or a tab row. */
const menuish = (e: ScreenElement) => ['menuitem', 'menu', 'tab', 'link', 'option'].includes(e.kind) || /^(app menu|side menu|tabs|menu|context menu)/.test(e.group ?? '');
const inMenu = (e: ScreenElement) => e.kind === 'menuitem' || (e.group ?? '').startsWith('menu') || e.group === 'context menu';

async function waitFor(test: () => boolean, ms = 1500): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (test()) return true; await wait(60); }
  return test();
}

async function toggle(rt: AxfRuntime, c: ScreenCommand, open: boolean): Promise<Partial<ScreenAnswer>> {
  const f = await find(rt, c.target!, ['row', 'expander']);
  if ('fail' in f) return f.fail;
  // the target itself, or the row it sits in (a button inside a row names the row's expander)
  const owner = expanderOf(f.el) ? f.el : f.el.closest('[data-axf-row], [role="row"]') ?? f.el;
  const x = expanderOf(owner);
  const now = expandedOf(owner);
  if (now === open) return { did: `${named(f)} was already ${open ? 'expanded' : 'collapsed'}`, target: f.element };
  if (x) { const p = pointOn(x); press(p.at, p.x, p.y, 'click'); } else if (f.el.matches('[data-axf-row], [role="row"]')) press(f.at, f.x, f.y, 'double_click'); // a grid row toggles on a double-click
  else return { code: 'not_implemented', message: `${named(f)} has nothing to ${open ? 'expand' : 'collapse'}`, target: f.element };
  await settled();
  return { did: `${open ? 'expanded' : 'collapsed'} ${named(f)}`, target: f.element };
}

/** Walk a path through the app menu or the side menu: each name is clicked where it shows (an open menu first). */
async function walkMenu(rt: AxfRuntime, c: ScreenCommand): Promise<Partial<ScreenAnswer>> {
  const path = c.path!;
  const done: string[] = [];
  for (const [i, name] of path.entries()) {
    const last = i === path.length - 1;
    const prefer = ['menuitem', 'menu', 'tab', 'link', 'option'];
    // an open menu's items first, then menus, tabs and links on the screen; a plain button that only mentions the
    // name (a banner chip saying "settings aren't coming…") is the last resort, after looking inside the app menus
    let f = await find(rt, name, prefer, menuOpen() ? inMenu : menuish);
    if ('fail' in f && menuOpen()) f = await find(rt, name, prefer, menuish);
    if ('fail' in f && i === 0) {
      // not on the screen yet: look inside each app menu, then behind a folded side menu
      const openers = Array.from(document.querySelectorAll('[data-axf-menu-btn], [aria-haspopup="menu"], button[aria-controls][aria-expanded="false"]')).filter((b) => shown(b));
      for (const b of openers) {
        const p = pointOn(b);
        press(p.at, p.x, p.y, 'click');
        await waitFor(menuOpen, 500);
        const inside = await find(rt, name, prefer, inMenu);
        if (!('fail' in inside)) { f = inside; done.push(labelOf(b)); break; }
        // not in this menu: close it again (Escape, then its own button if it is still open) before the next one
        pressKey({ key: 'Escape', ctrl: false, shift: false, alt: false, meta: false });
        await settled(400, 80);
        if (menuOpen() && b.isConnected) { const again = pointOn(b); press(again.at, again.x, again.y, 'click'); await settled(400, 80); }
      }
    }
    if ('fail' in f) { const any = await find(rt, name, prefer); if (!('fail' in any) || any.fail.code === 'ambiguous') f = any; }
    if ('fail' in f) return { ...f.fail, message: `${done.length ? `went ${done.join(' › ')}, then ` : ''}${f.fail.message}`, walked: done };
    if (last) { const stop = guard(f.el, f.element, c); if (stop) return { ...stop, target: f.element, walked: done }; }
    press(f.at, f.x, f.y, 'click');
    done.push(f.element?.label ?? labelOf(f.el));
    await settled();
  }
  return { did: `went ${done.join(' › ')}`, walked: done };
}

async function run(rt: AxfRuntime, c: ScreenCommand): Promise<Partial<ScreenAnswer>> {
  switch (c.action) {
    case 'map': return { did: 'read the screen' };
    case 'click': case 'double_click': case 'right_click': {
      const f = await find(rt, c.target!, []);
      if ('fail' in f) return f.fail;
      if (c.action !== 'right_click') { const stop = guard(f.el, f.element, c); if (stop) return { ...stop, target: f.element }; }
      press(f.at, f.x, f.y, c.action);
      if (c.action === 'right_click') await waitFor(menuOpen, 1200);
      await settled();
      const verb = c.action === 'click' ? 'clicked' : c.action === 'double_click' ? 'double-clicked' : 'right-clicked';
      return { did: `${verb} ${named(f)}${c.action === 'right_click' ? (menuOpen() ? ': its menu is open' : ': no menu opened') : ''}`, target: f.element, ...(c.action === 'right_click' ? { menu: menuOpen() } : {}) };
    }
    case 'context_menu': {
      const f = await find(rt, c.target!, ['row']);
      if ('fail' in f) return f.fail;
      press(f.at, f.x, f.y, 'right_click');
      if (!(await waitFor(menuOpen, 1500))) return { code: 'not_found', message: `right-clicked ${named(f)}, but no menu opened`, target: f.element };
      await settled(600, 120);
      if (!c.item) return { did: `right-clicked ${named(f)}: its menu is open`, target: f.element, menu: true };
      const it = await find(rt, c.item, ['menuitem'], inMenu);
      if ('fail' in it) return { ...it.fail, message: `the menu of ${named(f)} is open; ${it.fail.message}`, target: f.element, menu: true };
      const stop = guard(it.el, it.element, c);
      if (stop) return { ...stop, target: it.element, menu: true };
      press(it.at, it.x, it.y, 'click');
      await settled();
      return { did: `right-clicked ${named(f)} and picked ${named(it)}`, target: it.element };
    }
    case 'menu': return walkMenu(rt, c);
    case 'expand': return toggle(rt, c, true);
    case 'collapse': return toggle(rt, c, false);
    case 'scroll': {
      if (c.to) {
        const f = await find(rt, c.to, []);
        if ('fail' in f) return f.fail;
        f.el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await settled(800, 120);
        return { did: `scrolled to ${named(f)}`, target: f.element };
      }
      const a = await executeControl(rt, { verb: 'scroll', scroll: { dir: c.dir } });
      await settled(600, 120);
      return a.ok ? { did: `scrolled ${c.dir}`, scroll: (a as unknown as { scroll?: unknown }).scroll } : { code: a.code, message: a.message };
    }
    case 'type': {
      let el: Element | null = document.activeElement;
      let element: ScreenElement | undefined;
      if (c.target) {
        const f = await find(rt, c.target, ['input', 'select']);
        if ('fail' in f) return f.fail;
        el = f.el.matches('input, textarea, select, [contenteditable="true"]') ? f.el : f.el.querySelector('input, textarea, select, [contenteditable="true"]') ?? f.el;
        element = f.element;
      }
      if (!el || !typeInto(el, c.text ?? '')) return { code: 'invalid', message: c.target ? `"${element?.label ?? c.target}" is not a field to type into` : 'no field has the focus: name the field as target', target: element };
      if (c.submit) pressKey({ key: 'Enter', ctrl: false, shift: false, alt: false, meta: false });
      await settled();
      const secret = el instanceof HTMLInputElement && el.type === 'password';
      return { did: `typed ${secret ? '(hidden)' : JSON.stringify((c.text ?? '').slice(0, 80))} into "${element?.label ?? labelOf(el)}"${c.submit ? ' and pressed Enter' : ''}`, target: element };
    }
    case 'key': {
      for (const k of c.keys!) { pressKey(k); await wait(40); }
      await settled();
      return { did: `pressed ${c.keys!.map((k) => [k.ctrl && 'Ctrl', k.shift && 'Shift', k.alt && 'Alt', k.meta && 'Meta', k.key === ' ' ? 'Space' : k.key].filter(Boolean).join('+')).join(', ')}` };
    }
    default: return { code: 'invalid', message: `unknown action ${String(c.action)}` };
  }
}

/** Run one console-screen@1 command. Never throws: a failure is an answer with a wire code, and the map comes back either way. */
export async function driveScreen(rt: AxfRuntime, raw: unknown): Promise<ScreenAnswer> {
  const n = normalizeScreenCommand(raw);
  const answer = (part: Partial<ScreenAnswer>, action: string): ScreenAnswer => {
    const map = screenMap(rt);
    return { $axf: CONSOLE_SCREEN_FRAME, ok: !part.code, action, ...part, ...map };
  };
  if (n.errors) return answer({ code: 'invalid', message: n.errors.join('; ') }, String((raw as { action?: unknown })?.action ?? ''));
  if (n.command.scale) lastScale = n.command.scale;
  try { return answer(await run(rt, n.command), n.command.action); } catch (e) { return answer({ code: 'unexpected', message: String((e as Error)?.message ?? e) }, n.command.action); }
}
