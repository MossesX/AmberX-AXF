/*
 * Every UI element in the whole console, gathered in the browser and merged with the server's registry:
 *
 *   server     framework asset slots (toolbar, tab group, banner, nav, dialog, popup, widgets, look …) and every
 *              plugin's manifest `uiElements` (lib/core.mjs)
 *   targets    every console-control@1 target the open console registers (buttons, tabs, settings, grids, rows,
 *              panels, plugins …: the control registry's snapshot)
 *   libraries  every screen, dialog and settings tab each library / plugin contributes (rt.libraries)
 *   on screen  the ones with a visible box in the viewport right now (DOM, never inside the UI Manager window)
 *
 * A live element's id is `target:<address>`, which the server resolves by itself, so props / set / reset reach it
 * through the API too.
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry, CONTROL_TARGET_ATTR } from '@console/axf/react';
import { normalizeElement, elementsFromTargets, type UiElement } from '../../../../../framework/core/engines/ui-manager-rules.mjs';

/** The UI Manager's own root: nothing inside it is ever listed as on screen or picked. */
export const OWN_ROOT = '.axp-uim';

const visibleBox = (el: Element): boolean => {
  if (el.closest(OWN_ROOT)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
};

/** Elements the browser knows (control targets + library screens, dialogs, settings tabs). */
export function liveElements(rt: AxfRuntime): UiElement[] {
  const out: UiElement[] = [];
  try { out.push(...elementsFromTargets(controlRegistry(rt).snapshot())); } catch { /* registry not installed */ }
  for (const l of rt.libraries) {
    const plugin = l.id;
    for (const v of l.ui?.views ?? []) out.push(normalizeElement({ id: `target:view:${v.id}`, label: v.title, kind: 'view', category: 'screens', address: `view:${v.id}`, plugin, app: 'console' })!);
    for (const d of l.ui?.dialogs ?? []) out.push(normalizeElement({ id: `target:dialog:${d.id}`, label: d.title, kind: 'dialog', category: 'dialogs', address: `dialog:${d.id}`, selector: '.fx-dialog', plugin, app: 'console' })!);
    for (const t of l.ui?.settingsTabs ?? []) out.push(normalizeElement({ id: `target:settings-tab:${t.id}`, label: `${t.label} settings`, kind: 'tab', category: 'settings', address: `settings-tab:${t.id}`, plugin, app: 'console' })!);
  }
  return out.filter(Boolean);
}

/** Merge (server first: it carries the asset type and tokens), drop duplicates by id. */
export function mergeElements(server: UiElement[], live: UiElement[]): UiElement[] {
  const seen = new Set<string>();
  const out: UiElement[] = [];
  for (const e of [...server, ...live]) if (e && !seen.has(e.id)) { seen.add(e.id); out.push(e); }
  return out;
}

/** The DOM nodes an element stands for (its selector, its control address). */
export function nodesOf(e: UiElement): Element[] {
  const sels = [e.selector, e.address ? `[${CONTROL_TARGET_ATTR}="${e.address.replace(/"/g, '')}"]` : ''].filter(Boolean) as string[];
  const out: Element[] = [];
  for (const s of sels) { try { out.push(...Array.from(document.querySelectorAll(s))); } catch { /* bad selector */ } }
  return out;
}

/** Ids of the elements with a visible box right now: "On screen now". */
export function visibleIds(elements: UiElement[], cur = ''): string[] {
  if (typeof document === 'undefined') return [];
  const view = new Set<string>();
  for (const e of elements) {
    if (e.address?.startsWith('view:') && !e.address.includes('/') && cur === e.address.slice(5)) { view.add(e.id); continue; }
    if (nodesOf(e).some(visibleBox)) view.add(e.id);
  }
  return [...view];
}

/** The element a node on screen belongs to: its nearest control target, else the nearest framework component root. */
export function elementAt(node: Element | null, elements: UiElement[]): UiElement | null {
  for (let el: Element | null = node; el && el !== document.body; el = el.parentElement) {
    if (el.closest(OWN_ROOT)) return null;
    const addr = el.getAttribute(CONTROL_TARGET_ATTR);
    if (addr) { const hit = elements.find((e) => e.address === addr); if (hit) return hit; }
    for (const e of elements) if (e.selector && !e.address && safeMatches(el, e.selector)) return e;
  }
  return null;
}
const safeMatches = (el: Element, sel: string) => { try { return el.matches(sel); } catch { return false; } };
