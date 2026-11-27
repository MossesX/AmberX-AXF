/*
 * Skin editor — web model (pure helpers over the token-registry@1 / skin-snapshot@1 engine).
 * The sandbox is a wrapper element carrying the head snapshot's state as CSS custom properties: every framework control
 * inside reads var(--fx-*), so an edit hot-renders the preview with no engine round trip.
 */
import type { CSSProperties } from 'react';
import type { RegistryToken, SkinState, TokenLevel } from '@console/axf/core/engines/token-registry.mjs';
import { LEVEL_RANK, tokensAtLevel } from '@console/axf/core/engines/token-registry.mjs';
import type { UiPick } from './api';

export type { RegistryToken, SkinState, TokenLevel };
export const LEVELS: { value: TokenLevel; label: string; title: string }[] = [
  { value: 'basic', label: 'Basic', title: 'The handful of tokens everyone changes: page colours, accent, font, size, spacing, corners' },
  { value: 'pro', label: 'Pro', title: 'Plus per-element looks: buttons, tabs, grids, dialogs, transparencies' },
  { value: 'advanced', label: 'Advanced', title: 'Everything: layout, type scale, density, sizing, shadows, motion' },
];
export const LEVEL_KEY = 'axf.skin-editor.level';
export const UI_KEY = 'axf.skin-editor.ui';
export const ELEMENT_KEY = 'axf.skin-editor.element';
export const PANEL_KEY = 'axf.skin-editor.panel';

/** The element gallery: real framework controls with sample data, one card per element type the registry knows. */
export const ELEMENTS: { id: string; label: string; icon: string }[] = [
  { id: 'button', label: 'Buttons', icon: 'box' }, { id: 'field', label: 'Fields', icon: 'edit' }, { id: 'segmented', label: 'Segmented', icon: 'sliders' },
  { id: 'chip', label: 'Chips', icon: 'star' }, { id: 'tab-group', label: 'Tabs', icon: 'layers' }, { id: 'container', label: 'Cards', icon: 'grid' },
  { id: 'grid', label: 'Grid', icon: 'list' }, { id: 'note', label: 'Notes', icon: 'info' }, { id: 'toolbar', label: 'Toolbar', icon: 'menu' },
  { id: 'slider', label: 'Slider', icon: 'sliders' }, { id: 'dialog', label: 'Dialog', icon: 'maximize' },
];

/** fx- class prefixes → the registry element they belong to (what a click in the sandbox picks). */
const CLASS_ELEMENT: [string, string][] = [
  ['fx-iconbtn', 'icon-button'], ['fx-btn', 'button'], ['fx-seg', 'segmented'], ['fx-chip', 'chip'], ['fx-tab', 'tab-group'], ['fx-card', 'container'],
  ['fx-dialog', 'dialog'], ['fx-popover', 'popup'], ['fx-menu', 'context-menu'], ['fx-menubar', 'app-menu'], ['fx-nav', 'nav-menu'], ['fx-toolbar', 'toolbar'],
  ['fx-banner', 'banner'], ['fx-window', 'window'], ['fx-input', 'field'], ['fx-select', 'field'], ['fx-field', 'field'], ['fx-switch', 'field'], ['fx-slider', 'slider'],
  ['fx-badge', 'badge'], ['fx-gauge', 'gauge'], ['fx-meter', 'meter'], ['fx-avatar', 'avatar'], ['fx-progress', 'progress'], ['fx-note', 'note'], ['fx-table', 'grid'],
  ['fx-grid', 'grid'], ['fx-pagehead', 'typography'], ['fx-eyebrow', 'typography'],
];

/** The registry element a DOM element (or one of its ancestors) belongs to, by its fx- class; '' when none. */
export function elementOf(el: Element | null, stopAt?: Element | null): string {
  let cur: Element | null = el;
  while (cur && cur !== stopAt) {
    const cls = typeof cur.className === 'string' ? cur.className : '';
    for (const [prefix, element] of CLASS_ELEMENT) if (new RegExp(`(^|\\s)${prefix}(\\s|$|__|--)`).test(cls)) return element;
    cur = cur.parentElement;
  }
  return '';
}

/** The picked UI of the DOM element clicked anywhere in the app (its view root carries data-axf-view). */
export function uiOf(el: Element | null, title: (viewId: string) => string): UiPick | null {
  const root = el?.closest('[data-axf-view]');
  const id = root?.getAttribute('data-axf-view');
  return id ? { kind: 'view', id, label: title(id) } : null;
}

/** The sandbox wrapper's inline style: one custom property per edited token. */
export function cssVars(state: SkinState): CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(state)) out[k] = String(v);
  return out as CSSProperties;
}

/** Palette and colour-area tokens take a colour picker; transparencies and backdrops stay text. */
export const isColourToken = (t: RegistryToken) => t.area === 'colour' && t.element !== 'transparency' && !/^--fx-(opacity|backdrop)-/.test(t.id);

/** The tokens the editor lists: the level, then the picked element (its own tokens, with the basic palette kept), then the words. */
export function visibleTokens(tokens: RegistryToken[], level: TokenLevel, element: string, q: string): RegistryToken[] {
  let list = tokensAtLevel(tokens, level);
  if (element) list = list.filter((t) => t.element === element || (t.level === 'basic' && LEVEL_RANK[t.level] <= LEVEL_RANK[level]));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) list = list.filter((t) => words.every((w) => `${t.id} ${t.element} ${t.description} ${t.area} ${t.state}`.toLowerCase().includes(w)));
  return list;
}

/** Tokens grouped by element, in the registry's order, for the editor's folds. */
export function groupByElement(tokens: RegistryToken[]): { element: string; tokens: RegistryToken[] }[] {
  const by = new Map<string, RegistryToken[]>();
  for (const t of tokens) (by.get(t.element) ?? by.set(t.element, []).get(t.element)!).push(t);
  return [...by.entries()].map(([element, list]) => ({ element, tokens: list })).sort((a, b) => a.element.localeCompare(b.element));
}

/** "2 min ago", "just now", "3 h ago": the history rows' time. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** A skin id from a name: "Midnight Sky" → "midnight-sky". */
export const skinIdOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** The default skin's base for an export: the app's look as it stands (its active slots), so the exported skin is complete. */
export function baseFromActive(active: Record<string, string>): Record<string, unknown> {
  const sections = new Set(['layout', 'color-theme', 'style-theme', 'behavior-theme', 'skin', 'design-package']);
  const assets: Record<string, string> = {};
  for (const [type, id] of Object.entries(active)) if (!sections.has(type) && id) assets[type] = id;
  return { layoutTheme: active.layout, colorTheme: active['color-theme'], styleTheme: active['style-theme'], behaviorTheme: active['behavior-theme'], assets };
}
