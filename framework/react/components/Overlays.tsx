/** Overlay engines: dialogs, toasts/popups, and the context menu. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { SEARCH_KIND_LABELS, filterMenu, resolveChecked, type AssetType, type MenuItem, type SearchHit } from '../../core';
import { useAsset, useAxfState, useRuntime } from '../AxfProvider';
import { Icon } from './Icon';
import { scanPage } from './Search';
import { BrandMark, BrandWatermark, brandHostProps } from './Brand';
import { useScopeId } from './InterfaceScope';
import { MenuList, MenuScroll } from './MenuList';
import { useMenuFit } from './menuFit';
import { dialogSurface } from '../../core/engines/settingsopen';
import { CONTEXT_LEAD_PREFIX, splitContextBar, withContextLead, type MenuEntry } from '../../core/engines/windows';
import { chromeInstanceSlug } from '../../core/engines/chrome-settings-rules.mjs';

export interface DialogDef {
  title: string;
  icon?: string;
  render: (props: Record<string, unknown>, close: () => void) => ReactNode;
  /** false keeps it out of search (dialogs that only make sense with props, e.g. asset-json) */
  searchable?: boolean;
  /** glass = see-through surface (--fx-opacity-glass + --fx-blur); every settings dialog gets it by default (dialogSurface) */
  surface?: 'glass';
  /** wide = room for a settings interface (two thirds of the screen, up to the page width) */
  size?: 'wide';
}
export type DialogMap = Record<string, DialogDef>;

/* ---------------- DialogHost (dialog asset) ---------------- */

// A reload while a dialog was open skips the cleanup that drops its history entry, so the page comes back with the
// dialog shut and the entry still current: the first Back press would do nothing. Dialogs are not restored on load, so
// an entry found at start-up is that leftover; step back off it. Once per page, however many hosts mount.
let leftoverChecked = false;
function dropLeftoverDialogEntry(): void {
  if (leftoverChecked || typeof history === 'undefined') return;
  leftoverChecked = true;
  try { if ((history.state as { axfDialog?: boolean } | null)?.axfDialog) history.back(); } catch { /* history unavailable */ }
}

export function DialogHost({ dialogs }: { dialogs: DialogMap }) {
  const rt = useRuntime();
  const state = useAxfState();
  const d = useAsset('dialog').data;
  const panelRef = useRef<HTMLDivElement>(null);
  const scope = useScopeId();
  // a dialog belongs to the interface scope it was opened in; every other scope's host leaves it alone
  const mine = !state.dialog || (state.dialog.scope ?? '') === scope;
  const def = state.dialog && mine ? dialogs[state.dialog.id] : undefined;

  useEffect(() => {
    if (def) panelRef.current?.focus();
  }, [def]);

  // Android back (and the browser's back) closes the dialog: one history entry while any dialog is open here. Keyed on
  // open / shut, not the id, so going from one dialog straight to another keeps the one entry.
  const isOpen = !!def;
  const openAtStart = useRef(!!state.dialog);
  useEffect(() => { if (!openAtStart.current) dropLeftoverDialogEntry(); }, []);
  useEffect(() => {
    if (!isOpen) return;
    history.pushState({ axfDialog: true }, '');
    let popped = false;
    const onPop = () => { popped = true; rt.closeDialog(); };
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('popstate', onPop);
      // shut some other way (X, outside tap, Escape, swipe, a console command): drop the entry it pushed
      if (!popped && (history.state as { axfDialog?: boolean } | null)?.axfDialog) history.back();
    };
  }, [isOpen, rt]);

  // Swipe down on the title bar (touch) closes it: the dialog follows the finger, and past a quarter of its height it goes.
  const [pull, setPull] = useState(0);
  const swipe = useRef<{ id: number; y: number } | null>(null);
  const onHeadDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch' || (e.target as Element).closest('button')) return;
    swipe.current = { id: e.pointerId, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onHeadMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (swipe.current?.id === e.pointerId) setPull(Math.max(0, e.clientY - swipe.current.y));
  };
  const onHeadUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (swipe.current?.id !== e.pointerId) return;
    const h = panelRef.current?.offsetHeight ?? 400;
    const go = e.type === 'pointerup' && Math.max(0, e.clientY - swipe.current.y) > Math.max(rt.behavior().interaction.dragThreshold * 4, h / 4);
    swipe.current = null;
    setPull(0);
    if (go) rt.closeDialog();
  };

  if (!state.dialog || !mine) return null;
  if (!def) {
    queueMicrotask(() => {
      rt.closeDialog();
      rt.toast(`No dialog is registered as "${state.dialog?.id}".`, 'warning');
    });
    return null;
  }
  const close = () => rt.closeDialog();
  const brand = rt.brandPlace('dialog', 16);
  const brandHost = brandHostProps(brand);
  return (
    <div className="fx-backdrop" onPointerDown={(e) => d.closeOnBackdrop && rt.behavior().windows.closeOnBackdrop && e.target === e.currentTarget && close()}>
      <div className={`fx-dialog ${brandHost.className}`.trim()} data-fx-dialog-surface={dialogSurface(state.dialog.id, def)} data-fx-dialog-size={def.size} role="dialog" aria-modal="true" aria-label={def.title} tabIndex={-1} ref={panelRef} data-fx-brand-mode={brandHost['data-fx-brand-mode']} style={pull ? { transform: `translateY(${pull}px)` } : undefined}>
        <header className="fx-dialog__head" onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp}>
          {brand?.svg && <BrandMark slot="dialog" height={16} className="fx-dialog__brand" />}
          {def.icon && <Icon name={def.icon} size={18} />}
          <h2>{def.title}</h2>
          <button type="button" className="fx-iconbtn" onClick={close} aria-label="Close dialog">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="fx-dialog__body">{def.render(state.dialog.props ?? {}, close)}<BrandWatermark slot="dialog" /></div>
      </div>
    </div>
  );
}

/* ---------------- ToastHost (popup asset) ---------------- */

const TOAST_ICON = { info: 'info', success: 'check-circle', warning: 'alert', danger: 'x-circle' } as const;

export function ToastHost() {
  const rt = useRuntime();
  const state = useAxfState();
  const p = useAsset('popup').data;
  const scope = useScopeId();
  return (
    <div className="fx-toasts" aria-live="polite">
      {state.toasts.filter((t) => (t.scope ?? '') === scope).map((t) => (
        <div key={t.id} className={`fx-toast fx-toast--${t.kind}`} role="status">
          {p.showIcon && <Icon name={TOAST_ICON[t.kind]} size={18} className="fx-toast__icon" />}
          <div className="fx-toast__text">
            {t.title && <strong>{t.title}</strong>}
            <span>{t.message}</span>
          </div>
          <button type="button" className="fx-iconbtn" onClick={() => rt.dismissToast(t.id)} aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- ContextMenuHost (context-menu asset) ---------------- */

export function ContextMenuHost() {
  const rt = useRuntime();
  const state = useAxfState();
  // chrome-settings@1: the context menu's settings-dialog overrides (instance `app`) over its asset
  const cmAsset = useAsset('context-menu').data;
  const cm = rt.chromeData('context-menu', 'app', cmAsset) ?? cmAsset;
  const ref = useRef<HTMLDivElement>(null);
  const scope = useScopeId();

  useEffect(() => {
    const open = (target: Element | null, x: number, y: number) => {
      // one host per interface scope: only the host of the scope the pointer is in opens the menu
      if ((target?.closest('[data-fx-scope]')?.getAttribute('data-fx-scope') ?? '') !== scope) return;
      // which banner widget was hit: its menu offers Widget settings for that one
      rt.contextBannerWidget = target?.closest('[data-axf-banner-item]')?.getAttribute('data-axf-banner-item') ?? null;
      // which toolbar widget was hit: its toolbar's menu offers Style… / Move / Detach for that one (toolbar-widgets@1)
      rt.contextToolbarWidget = target?.closest('[data-axf-toolbar-widget]')?.getAttribute('data-axf-toolbar-widget') ?? null;
      // chrome-settings@1 (Nov 4 2026): a toolbar, a tab row or a nav that names no target is still one, so every
      // toolbar / tab group / navigation menu gets Settings / Change / Move without an attribute of its own
      const el = target?.closest('[data-fx-ctx-target], [role="toolbar"], [role="tablist"], nav');
      const own = el?.getAttribute('data-fx-ctx-target');
      const name = own ?? (el?.getAttribute('role') === 'toolbar' ? 'toolbar' : el?.getAttribute('role') === 'tablist' ? 'tab-group' : el?.tagName === 'NAV' && el.getAttribute('data-axf-not-nav') === null ? 'nav' : 'default');
      if (own) { rt.openContext(x, y, name, el?.getAttribute('data-fx-ctx-payload') ?? undefined); return; }
      // an implicit target's instance id: its settings id, else its accessible name as a slug
      const label = name === 'toolbar' ? el?.getAttribute('data-axf-toolbar') ?? el?.getAttribute('data-axf-toolbar-asset') ?? el?.getAttribute('aria-label') : name === 'tab-group' ? el?.getAttribute('data-axf-tab-group') ?? el?.getAttribute('aria-label') : name === 'nav' ? el?.getAttribute('data-axf-nav') ?? el?.getAttribute('aria-label') : null;
      const slug = chromeInstanceSlug(label);
      rt.openContext(x, y, name, slug || undefined);
    };
    const onCtx = (e: MouseEvent) => {
      // A touch long-press also fires the browser's own contextmenu: the long-press timer handles it, once.
      if (start) { e.preventDefault(); return; }
      const t = e.target as Element;
      // A banner (outside the shell, in a box that otherwise ignores the menu) is always a target: Banner settings.
      const banner = !!t.closest('[data-fx-ctx-target="axf-banner"], [data-fx-ctx-target="banner"]') && !t.closest('input, textarea, .fx-ctx');
      if (!banner && t.closest('input, textarea, .fx-ctx, [data-fx-ctx-ignore]')) return;
      if (!banner && !t.closest('.fx-shell')) return;
      // hidden: the browser's own menu, unless a host that took the context menu shows it (embed@1, rt.openContext forwards)
      if (rt.slotHidden('context-menu') && !rt.hostTakes('context-menu')) return;
      e.preventDefault();
      open(t, e.clientX, e.clientY);
    };
    // Long-press for touch devices
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || (rt.slotHidden('context-menu') && !rt.hostTakes('context-menu'))) return;
      const t = e.target as Element;
      const banner = !!t.closest('[data-fx-ctx-target="axf-banner"], [data-fx-ctx-target="banner"]') && !t.closest('input, textarea, .fx-ctx');
      if (!banner && (t.closest('input, textarea, .fx-ctx, [data-fx-ctx-ignore]') || !t.closest('.fx-shell'))) return;
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => open(t, e.clientX, e.clientY), rt.behavior().interaction.longPressMs); // behaviour theme (was 550 ms)
    };
    const cancel = (e: Event) => {
      const p = e as PointerEvent;
      if (start && e.type === 'pointermove' && Math.hypot(p.clientX - start.x, p.clientY - start.y) < Math.max(1, rt.behavior().interaction.dragThreshold)) return;
      clearTimeout(timer);
      start = null;
    };
    const onAway = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.fx-ctx')) rt.closeContext();
    };
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', cancel);
    document.addEventListener('pointerup', cancel);
    // Scrolling on a phone ends the touch with pointercancel (no move/up), so the timer must stop there too.
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('scroll', cancel, true);
    document.addEventListener('pointerdown', onAway, true);
    window.addEventListener('blur', () => rt.closeContext());
    return () => {
      document.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', cancel);
      document.removeEventListener('pointerup', cancel);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('scroll', cancel, true);
      document.removeEventListener('pointerdown', onAway, true);
    };
  }, [rt, scope]);

  // On screen: below-right of the pointer, flipped or shifted to fit, scrolling inside when taller than the room (menu-fit@1)
  useMenuFit(ref, 'point', () => state.context && { left: state.context.x, right: state.context.x, top: state.context.y, bottom: state.context.y }, {}, [state.context]);

  // Search anywhere's words and pick: a fresh box every time the menu opens
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => { setQuery(''); setActive(0); }, [state.context]);

  if (!state.context || (state.context.scope ?? '') !== scope) return null;
  const ctx = state.context;
  // `contributions: false`: a target the asset defines shows only the asset's own items (e.g. context-menu/amber)
  const own = cm.contributions === false && !!(cm.targets[ctx.target] ?? (!ctx.target || ctx.target === 'default' ? cm.targets.default : undefined));
  const contributed = own ? [] : rt.contributedContext(ctx.target);
  const extra = own ? [] : [...(rt.contextExtras.get(ctx.target)?.(ctx.target, ctx.payload) ?? []), ...contributed];
  // chrome-settings@1: the shared Settings / Change / Move block of a tab group, toolbar, banner, nav or menu bar is
  // that element's own menu (right after the kind's items), never a tail item under the whole default menu
  const chrome = own ? [] : rt.contextExtras.get('*:chrome')?.(ctx.target, ctx.payload) ?? [];
  const everywhere = own ? [] : [...rt.contextExtras.entries()].filter(([k]) => (k === '*' || k.startsWith('*:')) && k !== '*:chrome').flatMap(([, f]) => f(ctx.target, ctx.payload));
  const base = cm.targets[ctx.target] ?? (extra.length || chrome.length ? [] : cm.targets.default ?? []);
  // An element naming a target the asset doesn't know still gets the default menu's contributions (e.g. a plugin link).
  const fallback = !own && !cm.targets[ctx.target] && !extra.length && !chrome.length ? rt.contributedContext('default') : [];
  const chromeSep = extra.length && chrome.length ? [{ id: 'chrome-sep', separator: true }] : [];
  const more = [...extra, ...chromeSep, ...chrome, ...fallback] as unknown as typeof base;
  const sep = base.length && more.length && !base[base.length - 1]?.separator ? [{ id: 'x-sep', separator: true } as unknown as (typeof base)[number]] : [];
  const tail = everywhere.length ? [{ id: 'ctx-everywhere-sep', separator: true }, ...everywhere] : [];
  // context-lead@1: entries every menu starts with (e.g. the console's Console settings), above a separator, on any
  // target, even one whose asset turns contributions off
  const lead = [...rt.contextExtras.entries()].filter(([k]) => k.startsWith(CONTEXT_LEAD_PREFIX)).flatMap(([, f]) => f(ctx.target, ctx.payload));
  const rest = [...base, ...sep, ...more, ...(tail as unknown as typeof base)];
  const all = withContextLead(lead as unknown as MenuEntry[], rest as unknown as MenuEntry[]) as unknown as typeof base;
  // context-menu rebuild (Nov 20 2026): `place: "toolbar"` items (cut / copy / paste, theme steps…) sit in the icon
  // strip on top, the list keeps the rest, and Search anywhere is pinned at the bottom
  // the default target's strip items lead the strip of every menu of the asset (a plugin's or a toolbar's menu too)
  const split = splitContextBar(all);
  const list = split.list;
  const bar = [...split.bar, ...splitContextBar(cm.targets.default ?? []).bar].filter((x, i, xs) => xs.findIndex((y) => y.id === x.id) === i);
  const search = cm.search ? (typeof cm.search === 'string' ? cm.search : 'Search anywhere…') : null;
  const done = () => rt.closeContext();
  return (
    <div
      ref={ref}
      className="fx-ctx fx-popover"
      style={{ left: state.context.x, top: state.context.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {bar.length > 0 && <ContextBar items={bar} payload={ctx.payload} onDone={done} />}
      <MenuScroll box={ref}>
        {query.trim()
          ? <ContextHits query={query} active={active} setActive={setActive} onDone={done} />
          : <MenuList items={list} payload={ctx.payload} onDone={done} showIcons={cm.showIcons} showShortcuts={cm.showShortcuts} />}
      </MenuScroll>
      {search && <ContextSearch placeholder={search} query={query} setQuery={setQuery} active={active} setActive={setActive} onDone={done} />}
    </div>
  );
}

/** The icon strip on top of a context menu: each item an icon button (its label is the tooltip and accessible name). */
function ContextBar({ items, payload, onDone }: { items: MenuItem[]; payload?: string; onDone: () => void }) {
  const rt = useRuntime();
  const visible = filterMenu(items, (r) => rt.gate(r)).filter((i) => !(i.action && rt.takenByHost({ action: i.action })));
  if (!visible.length) return null;
  return (
    <div className="fx-ctx__bar" role="toolbar" aria-label="Quick actions" data-axf-toolbar="context-quick">
      {visible.map((item) => {
        const hostLock = item.action ? rt.lockedByHost({ action: item.action }) : null;
        const locked = rt.gate(item.requires) === 'disable' || !!hostLock;
        const check = resolveChecked(item.checked, { counter: (n) => rt.badge(n), setting: (k) => rt.settings.get(k), hidden: (t) => rt.slotHidden(t as AssetType) });
        const tip = hostLock ?? (locked ? `Requires ${item.requires}` : `${item.label ?? item.id}${item.shortcut ? ` (${item.shortcut})` : ''}`);
        return (
          <button
            key={item.id}
            type="button"
            className={`fx-iconbtn fx-ctx__tool${check ? ' is-active' : ''}`}
            data-axf-item={item.id}
            data-axf-action={item.action}
            aria-label={item.label ?? item.id}
            aria-pressed={check === null ? undefined : check}
            title={tip}
            disabled={locked}
            onClick={() => { onDone(); if (item.action) rt.dispatch(item.action, { payload }); }}
          >
            <Icon name={locked ? 'lock' : item.icon ?? 'check-circle'} size={16} />
          </button>
        );
      })}
    </div>
  );
}

const CTX_HITS = 10;

/** What Search anywhere finds for the words typed (the page on screen is scanned first, like the toolbar search). */
function useContextHits(query: string): SearchHit[] {
  const rt = useRuntime();
  const state = useAxfState();
  return useMemo(() => {
    if (!query.trim()) return [];
    scanPage(rt.getState().view);
    return rt.search.query(query, { limit: CTX_HITS });
  }, [rt, query, state.rev]);
}

function pickHit(rt: ReturnType<typeof useRuntime>, h: SearchHit | undefined, onDone: () => void): void {
  if (!h) return;
  if (h.locked) { rt.toast(`"${h.label}" needs ${h.requires}.`, 'warning', 'Locked'); return; }
  onDone();
  rt.search.focus(h);
}

/** Search anywhere's results, in place of the menu's list while there is a query. */
function ContextHits({ query, active, setActive, onDone }: { query: string; active: number; setActive: (i: number) => void; onDone: () => void }) {
  const rt = useRuntime();
  const hits = useContextHits(query);
  if (!hits.length) return <ul className="fx-menu" role="menu"><li className="fx-menu__li"><span className="fx-menu__row fx-muted">Nothing matches “{query.trim()}”.</span></li></ul>;
  return (
    <ul className="fx-menu" role="menu" aria-label="Search results" data-axf-search="off">
      {hits.map((h, i) => (
        <li key={h.id} className="fx-menu__li" data-axf-item={`search:${h.id}`}>
          <button
            type="button"
            role="menuitem"
            className={`fx-menu__item${i === active ? ' is-active' : ''}`}
            aria-disabled={h.locked || undefined}
            onPointerEnter={() => setActive(i)}
            onClick={() => pickHit(rt, h, onDone)}
          >
            <span className="fx-menu__icon"><Icon name={h.locked ? 'lock' : h.icon ?? 'search'} size={15} /></span>
            <span className="fx-search__text">
              <span className="fx-search__label">{h.label}</span>
              {h.detail && <span className="fx-search__detail">{h.detail}</span>}
            </span>
            <span className="fx-search__kind">{SEARCH_KIND_LABELS[h.kind] ?? h.kind}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Search anywhere: the box pinned at the bottom of the context menu. Typing anywhere while the menu is open lands
 * here (focus is not taken on open, so Cut / Copy / Paste still act on what was selected); Enter opens the pick,
 * arrows move it, Escape clears the box, then closes the menu. */
function ContextSearch({ placeholder, query, setQuery, active, setActive, onDone }: {
  placeholder: string; query: string; setQuery: (q: string) => void; active: number; setActive: (f: (i: number) => number) => void; onDone: () => void;
}) {
  const rt = useRuntime();
  const input = useRef<HTMLInputElement>(null);
  const hits = useContextHits(query);
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (document.activeElement === input.current || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      input.current?.focus(); // the key's character then goes into the box
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pickHit(rt, hits[active], onDone); }
    else if (e.key === 'Escape') { e.preventDefault(); if (query) { e.stopPropagation(); setQuery(''); } else onDone(); }
  };
  return (
    <div className="fx-search fx-ctx__search" role="search" data-axf-search="off">
      <Icon name="search" size={14} />
      <input
        ref={input}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(() => 0); }}
        onKeyDown={onKey}
        placeholder={placeholder}
        aria-label="Search anywhere"
      />
      {query && <button type="button" className="fx-search__clear" aria-label="Clear search" onClick={() => { setQuery(''); input.current?.focus(); }}><Icon name="x" size={12} /></button>}
    </div>
  );
}
