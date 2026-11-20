/**
 * Screen map (build screen-voice-drive, Nov 20 2026): every clickable thing the console draws right now, with the exact
 * words it shows, where it sits and the console-control@1 address that clicks it. A console screenshot carries it, so a
 * caller that cannot see the image (a voice call) can still be told what is on the screen and click it by its words.
 *
 *   const map = screenMap(rt);            // the whole viewport
 *   const map = screenMap(rt, panelEl);   // only what shows inside one element (a screenshot of one panel)
 *
 * Two sources, merged:
 *   1. the control registry: every registered target that draws an element (tabs, buttons, rows, steps, settings, plugins);
 *   2. a sweep of the document for the clickable controls that have no address of their own (plain buttons, links, menu
 *      items, inputs). Each gets a short-lived `view:<screen>/button:seen.<its-words>` target whose press is its click,
 *      so console-control@1 `press` reaches it like any other. They are replaced by the next map.
 *
 * An item is `on: 'screen'` when it can be seen (inside the viewport, not clipped by a scrolling pane, not covered by a
 * dialog) and `on: 'scroll'` when it is drawn but scrolled out of sight. Hidden and covered controls are left out.
 */
import type { AxfRuntime } from '../core';
import { CONSOLE_CONTROL_WIRE, ConsoleControlError, type ConsoleControlKind, type ControlTarget } from '../core/engines/console-control';
import { controlRegistry, controlSlug, SEEN_TARGET_PREFIX, type ControlTargetDef } from './controlTargets';

/** What a caller is told an item is. */
export type ScreenMapRole = 'button' | 'tab' | 'row' | 'step' | 'link' | 'menu item' | 'input' | 'switch' | 'plugin';

export interface ScreenMapItem {
  address: string;
  /** the console-control@1 kind of the address (what decides the verb that clicks it) */
  kind: ConsoleControlKind;
  role: ScreenMapRole;
  /** the words it shows (else its accessible name) */
  text: string;
  /** the registered label, when it differs from the words shown */
  label?: string;
  x: number; y: number; w: number; h: number;
  on: 'screen' | 'scroll';
  disabled?: true;
  /** pressing it deletes or resets something (a press needs confirm) */
  destructive?: true;
  /** a tab that is the open one, a switch that is on, an input's text */
  value?: string | number | boolean;
}

export interface ScreenMap { view: string; width: number; height: number; items: ScreenMapItem[]; truncated?: true }

export const SCREEN_MAP_MAX_ITEMS = 300;
export const SCREEN_MAP_TEXT_MAX = 120;
/** Items whose tops are within this many pixels read as one line. */
export const SCREEN_MAP_LINE_PX = 10;

/** Registered kinds that are containers, not something to click. */
const CONTAINER_KINDS = new Set<ConsoleControlKind>(['view', 'panel', 'grid', 'scroll', 'toolbar']);
/** Registered kinds that are one control: a clickable element inside one is that control, not another item. */
const LEAF_KINDS = new Set<ConsoleControlKind>(['button', 'tab', 'subtab', 'setting', 'function']);
/** Registered kinds listed by their registered name, not by every word their element holds. */
const NAMED_KINDS = new Set<ConsoleControlKind>(['setting', 'plugin']);
const ROLE_OF_KIND: Partial<Record<ConsoleControlKind, ScreenMapRole>> = { tab: 'tab', subtab: 'tab', button: 'button', function: 'button', row: 'row', step: 'step', setting: 'input', plugin: 'plugin' };
const CLICKABLE = 'button, a[href], summary, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"]';
/** What a tab target's element must be to count as the tab itself (some targets answer with the panel they open). */
const TAB_CONTROL = '[role="tab"], [data-axf-tab], button, a[href]';
const CLIPS = /auto|scroll|hidden|clip/;
const DESTRUCTIVE_WORDS = /\b(delete|remove|purge|wipe|reset|uninstall|drop|clear|discard|revoke|destroy|erase|kill)\b/i;

/* ================================================================== pure half */

/** Words as they read: whitespace collapsed, trimmed, capped. */
export function screenMapText(raw: unknown, max = SCREEN_MAP_TEXT_MAX): string {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Reading order: top to bottom, then left to right; tops within SCREEN_MAP_LINE_PX of the line's first item share a line. */
export function screenMapOrder<T extends { x: number; y: number }>(items: T[]): T[] {
  const byTop = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: T[] = [];
  let line: T[] = [];
  const flush = () => { out.push(...line.sort((a, b) => a.x - b.x)); line = []; };
  for (const it of byTop) {
    if (line.length && it.y - line[0]!.y > SCREEN_MAP_LINE_PX) flush();
    line.push(it);
  }
  flush();
  return out;
}

/** The id of the short-lived target for a control without an address: `seen.<its words>`, numbered when the words repeat. */
export function seenTargetId(text: string, taken: Set<string>): string {
  const base = `${SEEN_TARGET_PREFIX}${controlSlug(text).slice(0, 60) || 'control'}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}.${n}`;
  taken.add(id);
  return id;
}

/** What a swept element is, from its tag and ARIA role. */
export function screenMapRole(tag: string, role: string | null, type: string | null): ScreenMapRole {
  const r = (role ?? '').toLowerCase(), t = tag.toLowerCase(), ty = (type ?? '').toLowerCase();
  if (r === 'tab') return 'tab';
  if (r === 'link' || (t === 'a' && !r)) return 'link';
  if (r.startsWith('menuitem') || r === 'option') return 'menu item';
  if (r === 'switch' || r === 'checkbox' || r === 'radio' || ty === 'checkbox' || ty === 'radio') return 'switch';
  if (t === 'input' && ['button', 'submit', 'reset', 'image'].includes(ty)) return 'button';
  if (t === 'input' || t === 'select' || t === 'textarea') return 'input';
  return 'button';
}

/* ================================================================== DOM half */

interface Box { left: number; top: number; right: number; bottom: number }
const boxOf = (r: DOMRect | Box): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
const cut = (a: Box, b: Box): Box | null => {
  const o = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return o.right - o.left >= 2 && o.bottom - o.top >= 2 ? o : null;
};

/** Where an element sits: its box, and whether it can be seen, is scrolled out of sight, or is not shown at all (null). */
function place(el: Element, clip: Box, clips: Map<Element, Box | false>): { box: Box; on: 'screen' | 'scroll' } | null {
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return null;
  const box = boxOf(rect);
  let seen: Box | null = cut(box, clip);
  // the page itself is the viewport clip; every scrolling or clipping pane on the way up narrows what shows
  for (let p = el.parentElement; p && seen && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    let c = clips.get(p);
    if (c === undefined) {
      const s = getComputedStyle(p);
      c = CLIPS.test(`${s.overflowX} ${s.overflowY}`) ? boxOf(p.getBoundingClientRect()) : false;
      clips.set(p, c);
    }
    if (c) seen = cut(seen, c);
  }
  if (!seen) return { box, on: 'scroll' };
  const top = document.elementFromPoint((seen.left + seen.right) / 2, (seen.top + seen.bottom) / 2);
  // something else is drawn over it (a dialog, a menu): not on the screen as far as a click goes
  if (top && !el.contains(top) && !top.contains(el)) return null;
  return { box, on: 'screen' };
}

function wordsOf(el: Element): string {
  const h = el as HTMLElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return screenMapText(el.value || el.getAttribute('aria-label') || el.title);
    const lab = el.getAttribute('aria-label') || [...(el.labels ?? [])].map((l) => l.innerText ?? l.textContent ?? '').join(' ') || el.getAttribute('placeholder') || el.title || el.name;
    return screenMapText(lab);
  }
  return screenMapText(h.innerText || h.textContent) || screenMapText(el.getAttribute('aria-label') || el.getAttribute('title') || el.querySelector('img[alt]')?.getAttribute('alt'));
}

function valueOf(el: Element): string | boolean | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    if (el.type === 'password' || ['button', 'submit', 'reset'].includes(el.type)) return undefined;
    return el.value ? screenMapText(el.value, 80) : undefined;
  }
  if (el instanceof HTMLSelectElement) return screenMapText(el.selectedOptions[0]?.textContent ?? el.value, 80) || undefined;
  if (el instanceof HTMLTextAreaElement) return el.value ? screenMapText(el.value, 80) : undefined;
  for (const a of ['aria-selected', 'aria-checked', 'aria-pressed', 'aria-expanded']) { const v = el.getAttribute(a); if (v === 'true') return true; if (v === 'false' && a !== 'aria-selected') return false; }
  return undefined;
}

const isDisabled = (el: Element) => (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';

const sweeps = new WeakMap<AxfRuntime, () => void>();

/**
 * Map what the console shows now. `within` narrows it to one element (what a screenshot of one panel captured).
 * Registers the swept controls as short-lived button targets (the ones from the map before are dropped).
 */
export function screenMap(rt: AxfRuntime, within?: Element | null): ScreenMap {
  const reg = controlRegistry(rt);
  const view = rt.getState().view;
  const width = window.innerWidth, height = window.innerHeight;
  sweeps.get(rt)?.();
  sweeps.delete(rt);
  const viewport: Box = { left: 0, top: 0, right: width, bottom: height };
  const clip = within ? cut(boxOf(within.getBoundingClientRect()), viewport) ?? viewport : viewport;
  const clips = new Map<Element, Box | false>();
  const items: ScreenMapItem[] = [];
  const push = (it: Omit<ScreenMapItem, 'x' | 'y' | 'w' | 'h' | 'on'>, p: { box: Box; on: 'screen' | 'scroll' }) => {
    items.push({ ...it, x: Math.round(p.box.left), y: Math.round(p.box.top), w: Math.round(p.box.right - p.box.left), h: Math.round(p.box.bottom - p.box.top), on: p.on });
  };

  // 1. registered targets that draw an element
  const leaves: Element[] = [];
  const owned = new Set<Element>();
  const rendered = reg.rendered();
  const uses = new Map<Element, number>();
  for (const { el } of rendered) uses.set(el, (uses.get(el) ?? 0) + 1);
  for (const { target, el } of rendered) {
    if (CONTAINER_KINDS.has(target.kind) || (within && !within.contains(el))) continue;
    if (target.kind === 'tab' || target.kind === 'subtab') {
      if (!target.address.slice(target.address.lastIndexOf('/') + 1).includes('=')) continue; // the tab row, not a tab
      if ((uses.get(el) ?? 0) > 1) continue; // a tab folded under More answers with its row's element: not drawn itself
      if (!el.matches(TAB_CONTROL)) continue; // its element is the tab's panel, not the tab: the sweep lists the real control
    }
    // a button or tab whose element holds other controls is the region it opens (a dialog, a panel), not the control itself
    if (target.kind !== 'setting' && LEAF_KINDS.has(target.kind) && !el.matches(CLICKABLE) && el.querySelector(CLICKABLE)) continue;
    owned.add(el);
    if (LEAF_KINDS.has(target.kind)) leaves.push(el);
    const p = place(el, clip, clips);
    if (!p) continue;
    const label = screenMapText(target.label);
    // a setting's row and a plugin's card hold more words than their name: the name is what a caller says
    const text = NAMED_KINDS.has(target.kind) ? label || wordsOf(el) : wordsOf(el) || label;
    if (!text) continue;
    const value = registeredValue(target, el);
    push({
      address: target.address, kind: target.kind, role: ROLE_OF_KIND[target.kind] ?? 'button', text, ...(label && label.toLowerCase() !== text.toLowerCase() ? { label } : {}),
      ...(target.disabled ? { disabled: true as const } : {}), ...(target.destructive ? { destructive: true as const } : {}), ...(value !== undefined ? { value } : {}),
    }, p);
  }

  // 2. clickable controls with no address of their own: each becomes a short-lived button target
  const taken = new Set<string>();
  const defs: ControlTargetDef[] = [];
  const root: ParentNode = within ?? document;
  for (const el of root.querySelectorAll<HTMLElement>(CLICKABLE)) {
    if (owned.has(el) || leaves.some((l) => l.contains(el) || el.contains(l))) continue;
    const p = place(el, clip, clips);
    if (!p) continue;
    const text = wordsOf(el);
    if (!text) continue;
    const address = `view:${view}/button:${seenTargetId(text, taken)}`;
    const destructive = DESTRUCTIVE_WORDS.test(text);
    const value = valueOf(el);
    defs.push({
      address, kind: 'button', label: text, detail: 'On screen', element: () => (el.isConnected ? el : null), isDisabled: () => isDisabled(el), ...(destructive ? { destructive } : {}),
      invoke: () => {
        if (!el.isConnected) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.NOT_FOUND, `${text} is no longer on the screen: take a new screenshot`, { nearest: [] });
        if (el.matches('input, select, textarea')) el.focus();
        el.click();
      },
    });
    push({
      address, kind: 'button', role: screenMapRole(el.tagName, el.getAttribute('role'), el.getAttribute('type')), text,
      ...(isDisabled(el) ? { disabled: true as const } : {}), ...(destructive ? { destructive: true as const } : {}), ...(value !== undefined ? { value } : {}),
    }, p);
  }
  if (defs.length) sweeps.set(rt, reg.registerAll(defs));

  const ordered = [...screenMapOrder(items.filter((i) => i.on === 'screen')), ...screenMapOrder(items.filter((i) => i.on === 'scroll'))];
  return { view, width, height, items: ordered.slice(0, SCREEN_MAP_MAX_ITEMS), ...(ordered.length > SCREEN_MAP_MAX_ITEMS ? { truncated: true as const } : {}) };
}

/** A tab says whether it is the open one; a setting or a switch its value. */
function registeredValue(target: ControlTarget, el: Element): string | number | boolean | undefined {
  if (target.kind === 'tab' || target.kind === 'subtab') return target.value === true || el.getAttribute('aria-selected') === 'true' ? true : undefined;
  if (typeof target.value === 'boolean' || typeof target.value === 'number') return target.value;
  if (typeof target.value === 'string' && target.value) return screenMapText(target.value, 80);
  return valueOf(el);
}
