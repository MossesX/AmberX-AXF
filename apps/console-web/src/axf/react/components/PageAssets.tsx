/**
 * Page assets host (page-assets@1; Brett, Nov 13 2026, build assets-menu-hide-any-asset-visible-and-hidden-li):
 * "Hide any asset on any page. Context menu gets an 'Assets' entry with two submenus: 'Visible assets' and 'Hidden
 * assets', listing every asset on the page. […] When you right-click an asset, that asset is highlighted on the page
 * while the context menu is open, and it's marked in the Assets list."
 *
 * Finds every asset the page shows (toolbars, tab groups, navigation menus, the application menu bar, banners, widgets,
 * grids, containers, and anything marked `data-axf-asset="<type>"`), hides the ones the person hid (the element stays
 * mounted, `data-axf-asset-hidden` takes it off the page), highlights one (`data-axf-asset-highlight`) and builds the
 * context menu's Assets lists. The rules (ids, the hidden list, colours) are core/engines/page-assets-rules.mjs.
 *
 * Actions (console-visible: REST /api/console action, MCP console_action, `console.mjs action`, Amber by voice):
 *   assets.hide:<type>:<instance>[:all]        hide it on this page (`all`: on every page)
 *   assets.unhide:<type>:<instance>            show it again (here and everywhere)
 *   assets.toggle:<type>:<instance>            hide ⇄ show on this page
 *   assets.unhide-all[:all]                    show every asset hidden on this page (`all`: every page)
 *   assets.highlight:<type>:<instance>[:<ms>]  highlight it for a moment (default 4 s); assets.highlight:off clears
 *   assets.colour:<type|hidden>:<colour|default>   a type's list colour, or the hidden colour
 *   assets.list                                say what the page has (the list itself: console_where → here.assets)
 */
import { useEffect, useState } from 'react';
import {
  FRAMEWORK_MODULE, PAGE_ANY, PAGE_ASSETS_HIDDEN_KEY, PAGE_ASSET_COLOURS, PAGE_ASSET_COLOUR_KEY, PAGE_ASSET_HIDDEN_COLOUR_KEY,
  PAGE_ASSET_ICONS, PAGE_ASSET_TYPES, hiddenOnPage, isPageAssetColour, isPageAssetType, pageAssetColourOf, pageAssetHiddenColourOf,
  pageAssetHighlightMs, pageAssetId, pageAssetLabel, pageAssetSlug, parsePageAssetId, withAssetHidden,
  type AxfRuntime, type MenuItem, type PageAssetColour, type PageAssetSummary, type PageAssetType,
} from '../../core';
import { useAxfState, useRuntime } from '../AxfProvider';
import { SelectField } from './Forms';

/** One asset found on the page. */
export interface PageAsset { id: string; type: PageAssetType; instance: string; label: string; hidden: boolean; el: Element }

/** Where each kind shows in the DOM (the first match wins: a menu bar is never also counted as a toolbar). */
const FIND: [PageAssetType, string][] = [
  ['app-menu', '[role="menubar"]'],
  ['toolbar', '[role="toolbar"]'],
  ['tab-group', '[role="tablist"]'],
  ['nav-menu', 'nav:not([data-axf-not-nav])'],
  ['banner', '.fx-banner[role="banner"], [data-fx-banner-id]'],
  ['widget', '[data-axf-banner-item], [data-axf-widget]'],
  ['grid', '[role="grid"], [role="treegrid"], table'],
  ['container', 'section.fx-card'],
];
/** Not part of the page: menus, popovers, dialogs, previews. */
const SKIP = '.fx-ctx, .fx-popover, [role="menu"], [role="dialog"], [data-axf-banner-preview], [inert], [data-axf-asset="off"]';

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

function labelOf(type: PageAssetType, el: Element): string {
  const a = (k: string) => el.getAttribute(k) ?? '';
  const own = a('data-axf-asset-label') || a('aria-label');
  switch (type) {
    case 'toolbar': return a('data-axf-toolbar') || a('data-axf-toolbar-asset') || own;
    case 'tab-group': return a('data-axf-tab-group') || own;
    case 'nav-menu': return a('data-axf-nav') || own;
    case 'app-menu': return own || 'Menu bar';
    case 'banner': return a('data-fx-banner-id') || own || 'App banner';
    case 'widget': return a('data-axf-banner-item') || a('data-axf-widget') || own;
    case 'grid': return own || a('data-axf-dataset');
    case 'container': return own || text(el.querySelector(':scope > .fx-card__head h3'));
  }
  return own;
}

/** Every asset on the page now, in page order, each with a stable id (its type + its name, numbered when it has none). */
export function scanPageAssets(rt: AxfRuntime, root: ParentNode = document): PageAsset[] {
  const page = rt.getState().view;
  const hidden = hiddenOnPage(rt.settings.get(PAGE_ASSETS_HIDDEN_KEY), page);
  const seen = new Set<Element>();
  const ids = new Set<string>();
  const out: PageAsset[] = [];
  const add = (type: PageAssetType, el: Element, explicit?: string) => {
    if (seen.has(el) || el.closest(SKIP)) return;
    seen.add(el);
    const label = labelOf(type, el);
    const base = pageAssetSlug(explicit || label) || `${type}-${out.filter((x) => x.type === type).length + 1}`;
    let instance = base;
    for (let n = 2; ids.has(pageAssetId(type, instance)); n++) instance = `${base}-${n}`;
    const id = pageAssetId(type, instance);
    ids.add(id);
    out.push({ id, type, instance, label: label || `${pageAssetLabel(type)} ${instance.replace(/^.*-(\d+)$/, '$1')}`, hidden: hidden.includes(id), el });
  };
  for (const el of Array.from(root.querySelectorAll('[data-axf-asset]'))) {
    const t = el.getAttribute('data-axf-asset');
    if (isPageAssetType(t)) add(t, el, el.getAttribute('data-axf-asset-id') ?? undefined);
  }
  for (const [type, sel] of FIND) for (const el of Array.from(root.querySelectorAll(sel))) add(type, el);
  // page order, so the lists read top to bottom
  return out.sort((x, y) => (x.el === y.el ? 0 : x.el.compareDocumentPosition(y.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/** What console_where reports of the page (here.assets). */
export function pageAssetsSummary(rt: AxfRuntime): PageAssetSummary[] {
  if (typeof document === 'undefined') return [];
  return scanPageAssets(rt).map((a) => ({ id: a.id, type: a.type, label: a.label, hidden: a.hidden }));
}

/* ---------------- per-runtime state: the right-clicked element, the highlight ---------------- */

interface HostState { target: Element | null; flash: string | null; timer?: ReturnType<typeof setTimeout>; apply?: () => void }
const hosts = new WeakMap<AxfRuntime, HostState>();
const hostOf = (rt: AxfRuntime): HostState => { let h = hosts.get(rt); if (!h) { h = { target: null, flash: null }; hosts.set(rt, h); } return h; };

/** The asset the context menu was opened on (the innermost asset around the right-clicked / long-pressed element). */
export function contextPageAsset(rt: AxfRuntime, list = scanPageAssets(rt)): PageAsset | null {
  const t = hostOf(rt).target;
  if (!t || !rt.getState().context) return null;
  let best: PageAsset | null = null;
  for (const a of list) if (a.el.contains(t) && (!best || best.el.contains(a.el))) best = a;
  return best;
}

export const typeColour = (rt: AxfRuntime, type: PageAssetType): PageAssetColour => pageAssetColourOf(type, rt.settings.get(PAGE_ASSET_COLOUR_KEY(type)));
export const hiddenColour = (rt: AxfRuntime): PageAssetColour => pageAssetHiddenColourOf(rt.settings.get(PAGE_ASSET_HIDDEN_COLOUR_KEY));

/** Put the hidden list and the highlight on the page's elements. */
function applyToPage(rt: AxfRuntime): void {
  if (typeof document === 'undefined') return;
  const h = hostOf(rt);
  // nothing hidden here, nothing lit, nothing marked: no need to look at the page at all (most DOM changes end here)
  const idle = !h.flash && !rt.getState().context && !hiddenOnPage(rt.settings.get(PAGE_ASSETS_HIDDEN_KEY), rt.getState().view).length;
  if (idle && !document.querySelector('[data-axf-asset-hidden], [data-axf-asset-highlight]')) return;
  const list = scanPageAssets(rt);
  const ctx = contextPageAsset(rt, list);
  for (const a of list) {
    if (a.hidden) a.el.setAttribute('data-axf-asset-hidden', ''); else a.el.removeAttribute('data-axf-asset-hidden');
    const lit = a.id === h.flash || a === ctx;
    if (lit) { a.el.setAttribute('data-axf-asset-highlight', typeColour(rt, a.type)); a.el.setAttribute('data-axf-asset-type', a.type); }
    else a.el.removeAttribute('data-axf-asset-highlight');
  }
  // an element that stopped being an asset (or left the list) keeps no stale marks
  for (const el of Array.from(document.querySelectorAll('[data-axf-asset-hidden], [data-axf-asset-highlight]'))) {
    const a = list.find((x) => x.el === el);
    if (!a) { el.removeAttribute('data-axf-asset-hidden'); el.removeAttribute('data-axf-asset-highlight'); }
  }
}

function setHidden(rt: AxfRuntime, id: string, on: boolean, page = rt.getState().view): boolean {
  if (!parsePageAssetId(id)) return false;
  rt.settings.set(PAGE_ASSETS_HIDDEN_KEY, withAssetHidden(rt.settings.get(PAGE_ASSETS_HIDDEN_KEY), page, id, on));
  hostOf(rt).apply?.();
  return true;
}

export function highlightPageAsset(rt: AxfRuntime, id: string | null, ms?: unknown): void {
  const h = hostOf(rt);
  clearTimeout(h.timer);
  h.flash = id;
  if (id) {
    const a = scanPageAssets(rt).find((x) => x.id === id);
    a?.el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    h.timer = setTimeout(() => { h.flash = null; h.apply?.(); }, pageAssetHighlightMs(ms));
  }
  h.apply?.();
}

/* ---------------- the context menu's Assets entry ---------------- */

function row(rt: AxfRuntime, a: PageAsset, current: PageAsset | null): MenuItem {
  const kind = pageAssetLabel(a.type);
  const name = a.label.toLowerCase() === kind.toLowerCase() ? kind : `${kind}: ${a.label}`;
  return {
    id: `page-asset:${a.id}`,
    label: name,
    icon: PAGE_ASSET_ICONS[a.type],
    swatch: a.hidden ? hiddenColour(rt) : typeColour(rt, a.type),
    current: !!current && current.id === a.id,
    action: `assets.${a.hidden ? 'unhide' : 'hide'}:${a.id}`,
  };
}

/** The Assets entry: Hide this <kind> (when the menu was opened on one), then Visible assets ▸ and Hidden assets ▸. */
export function pageAssetsMenu(rt: AxfRuntime): MenuItem[] {
  if (typeof document === 'undefined') return [];
  const list = scanPageAssets(rt);
  const current = contextPageAsset(rt, list);
  const shown = list.filter((a) => !a.hidden);
  const hidden = list.filter((a) => a.hidden);
  const none = (id: string, label: string): MenuItem[] => [{ id, label, icon: 'info' }];
  const items: MenuItem[] = [
    ...(current ? [{ id: 'page-assets.this', label: `${current.hidden ? 'Show' : 'Hide'} this ${pageAssetLabel(current.type).toLowerCase()}`, icon: 'eye', swatch: typeColour(rt, current.type), action: `assets.toggle:${current.id}` }, { id: 'page-assets.this-sep', separator: true }] : []),
    { id: 'page-assets.visible', label: `Visible assets (${shown.length})`, icon: 'eye', items: shown.length ? shown.map((a) => row(rt, a, current)) : none('page-assets.visible-none', 'Nothing shown') },
    { id: 'page-assets.hidden', label: `Hidden assets (${hidden.length})`, icon: 'lock', items: hidden.length ? [...hidden.map((a) => row(rt, a, current)), { id: 'page-assets.hidden-sep', separator: true }, { id: 'page-assets.unhide-all', label: 'Show all', icon: 'undo', action: 'assets.unhide-all' }] : none('page-assets.hidden-none', 'Nothing hidden') },
  ];
  return [{ id: 'page-assets', label: 'Assets', icon: 'layers', items }];
}

/* ---------------- install: actions + the context entry (once per runtime) ---------------- */

const installed = new WeakSet<AxfRuntime>();

export function installPageAssets(rt: AxfRuntime): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  const known = (id: string) => scanPageAssets(rt).some((a) => a.id === id);
  rt.actions.withModule(FRAMEWORK_MODULE, () => {
    const idOf = (type = '', instance = '') => pageAssetId(type, instance);
    rt.actions.register('assets.hide', ([type, instance, where]) => {
      const id = idOf(type, instance);
      if (!setHidden(rt, id, true, where === 'all' ? PAGE_ANY : undefined)) rt.toast(`"${id}" isn't an asset id (type:instance).`, 'warning', 'Assets');
    }, { label: 'Hide an asset on this page (assets.hide:<type>:<instance>[:all])', params: true, effect: 'write' });
    rt.actions.register('assets.unhide', ([type, instance]) => {
      const id = idOf(type, instance);
      if (!setHidden(rt, id, false)) rt.toast(`"${id}" isn't an asset id (type:instance).`, 'warning', 'Assets');
    }, { label: 'Show a hidden asset again (assets.unhide:<type>:<instance>)', params: true, effect: 'write' });
    rt.actions.register('assets.toggle', ([type, instance]) => {
      const id = idOf(type, instance);
      const a = scanPageAssets(rt).find((x) => x.id === id);
      if (a) setHidden(rt, id, !a.hidden); else rt.toast(`No asset "${id}" on this page.`, 'warning', 'Assets');
    }, { label: 'Hide or show an asset on this page (assets.toggle:<type>:<instance>)', params: true, effect: 'write' });
    rt.actions.register('assets.unhide-all', ([where]) => {
      const page = rt.getState().view;
      const left = where === 'all' ? [] : (rt.settings.get(PAGE_ASSETS_HIDDEN_KEY) as string[] | null ?? []).filter((e) => typeof e === 'string' && !e.startsWith(`${page}|`) && !e.startsWith(`${PAGE_ANY}|`));
      if (left.length) rt.settings.set(PAGE_ASSETS_HIDDEN_KEY, left); else rt.settings.clear(PAGE_ASSETS_HIDDEN_KEY);
      hostOf(rt).apply?.();
    }, { label: 'Show every hidden asset on this page (assets.unhide-all[:all])', effect: 'write' });
    rt.actions.register('assets.highlight', ([type = '', instance = '', ms]) => {
      if (type === 'off' || !type) { highlightPageAsset(rt, null); return; }
      const id = idOf(type, instance);
      if (!known(id)) { rt.toast(`No asset "${id}" on this page.`, 'warning', 'Assets'); return; }
      highlightPageAsset(rt, id, ms);
    }, { label: 'Highlight an asset on the page (assets.highlight:<type>:<instance>[:<ms>] | off)', params: true, effect: 'read' });
    rt.actions.register('assets.colour', ([which = '', colour = '']) => {
      const key = which === 'hidden' ? PAGE_ASSET_HIDDEN_COLOUR_KEY : isPageAssetType(which) ? PAGE_ASSET_COLOUR_KEY(which) : null;
      if (!key) { rt.toast(`Use assets.colour:<${[...PAGE_ASSET_TYPES, 'hidden'].join('|')}>:<colour>.`, 'warning', 'Assets'); return; }
      if (colour === 'default') rt.settings.clear(key);
      else if (isPageAssetColour(colour)) rt.settings.set(key, colour);
      else { rt.toast(`Colours: ${PAGE_ASSET_COLOURS.join(', ')} or default.`, 'warning', 'Assets'); return; }
      hostOf(rt).apply?.();
    }, { label: 'Colour of an asset type in the Assets lists, or the hidden colour (assets.colour:<type|hidden>:<colour|default>)', params: true, effect: 'write' });
    rt.actions.register('assets.list', () => {
      const list = scanPageAssets(rt);
      const hidden = list.filter((a) => a.hidden);
      rt.toast(`${list.length - hidden.length} shown, ${hidden.length} hidden${hidden.length ? `: ${hidden.map((a) => a.label).join(', ')}` : ''}.`, 'info', 'Assets on this page');
    }, { label: 'Assets on this page (shown / hidden)', effect: 'read' });
  });
  rt.contextExtras.set('*:assets', () => pageAssetsMenu(rt));
}

/**
 * Mounted once by AppShell: keeps the hidden list and the highlight on the page as it changes (new elements, another
 * page, a setting), and remembers what was right-clicked so that asset is highlighted while the menu is open.
 */
export function PageAssetsHost() {
  const rt = useRuntime();
  const state = useAxfState();
  installPageAssets(rt);
  const [, bump] = useState(0);
  useEffect(() => {
    const h = hostOf(rt);
    let pending: ReturnType<typeof setTimeout> | undefined;
    const apply = () => { clearTimeout(pending); pending = undefined; applyToPage(rt); };
    const soon = () => { if (!pending) pending = setTimeout(apply, 120); };
    h.apply = apply;
    const mark = (e: Event) => { h.target = e.target as Element; };
    const touch = (e: PointerEvent) => { if (e.pointerType === 'touch') h.target = e.target as Element; };
    document.addEventListener('contextmenu', mark, true);
    document.addEventListener('pointerdown', touch, true);
    const mo = new MutationObserver(soon);
    mo.observe(document.body, { childList: true, subtree: true });
    const off = rt.settings.onAnyChange((k) => { if (k.startsWith('axf.assets.')) { soon(); bump((n) => n + 1); } });
    apply();
    return () => { mo.disconnect(); off(); clearTimeout(pending); document.removeEventListener('contextmenu', mark, true); document.removeEventListener('pointerdown', touch, true); if (h.apply === apply) h.apply = undefined; };
  }, [rt]);
  // the context menu opening / closing and page changes move the highlight and the hidden set
  useEffect(() => { hostOf(rt).apply?.(); }, [rt, state.context, state.view]);
  return null;
}

/** Settings → Appearance: the colour of each asset type in the Assets lists, and the hidden colour. */
export function PageAssetColours() {
  const rt = useRuntime();
  const [, force] = useState(0);
  useEffect(() => rt.settings.onAnyChange((k) => { if (k.startsWith('axf.assets.colour.')) force((n) => n + 1); }), [rt]);
  const options = PAGE_ASSET_COLOURS.map((c) => ({ value: c, label: c.replace(/^./, (x) => x.toUpperCase()) }));
  return (
    <div className="fx-stack fx-stack--xs" data-axf-asset-colours="">
      <span className="fx-field__label">Assets list colours</span>
      <span className="fx-small fx-muted">The colour of each asset type in the context menu's Assets lists and its highlight; hidden assets use the hidden colour.</span>
      <div className="axf-asset-colours">
        {PAGE_ASSET_TYPES.map((t) => (
          <div key={t} className="fx-row axf-asset-colours__row" data-axf-asset-colour={t}>
            <span className={`fx-menu__swatch fx-tone-mark--${typeColour(rt, t)}`} aria-hidden="true" />
            <SelectField label={pageAssetLabel(t)} value={typeColour(rt, t)} options={options} onChange={(v) => rt.dispatch(`assets.colour:${t}:${v}`)} />
          </div>
        ))}
        <div className="fx-row axf-asset-colours__row" data-axf-asset-colour="hidden">
          <span className={`fx-menu__swatch fx-tone-mark--${hiddenColour(rt)}`} aria-hidden="true" />
          <SelectField label="Hidden" value={hiddenColour(rt)} options={options} onChange={(v) => rt.dispatch(`assets.colour:hidden:${v}`)} />
        </div>
      </div>
    </div>
  );
}
