/** Shell chrome: application menu bar, toolbar, navigation menu, status bar. */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ASSET_TYPES, assetTypeSpecs, FRAMEWORK_VERSION } from '../../core';
import { useAsset, useAxfState, useRuntime } from '../AxfProvider';
import { Icon } from './Icon';
import { AppMenuDropdown } from './AppMenu';
import { LiveSearch } from './Search';
import type { ViewMap } from '../AppShell';
import { WidgetView } from './Widgets';
import { ArrangeBar, arrangedSide, useArrange } from './Arrange';
import type { PlacedAttachment } from '../../core/engines/widgets';
import type { AttachTarget, ToolbarAttach, ToolbarItemCall, ToolbarItemKind, ToolbarOwner } from '../../core/engines/toolbar';

/* ---------------- MenuBar (app-menu asset) ---------------- */

export function MenuBar() {
  const rt = useRuntime();
  useAsset('app-menu');
  const state = useAxfState();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const policy = rt.asset('uac-policy').data;
  const role = policy.roles.find((r) => r.id === state.role);
  // The compiled menu: the asset's menus + every contribution + live lists, gated for the current role (core/engines/appmenu.ts).
  const menus = rt.appMenu().menus;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  // Left / Right move between menus while one is open (a submenu list handles its own arrows first).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open || !menus.length) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = menus.findIndex((m) => m.id === open);
    const next = menus[(i + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length];
    if (next) { e.preventDefault(); setOpen(next.id); }
  };

  return (
    <div className="fx-menubar" ref={ref} role="menubar" onKeyDown={onKey}>
      <div className="fx-brand">
        <span className="fx-brand__mark" aria-hidden="true" />
        <span className="fx-brand__name">{rt.manifest.app.name}</span>
      </div>
      <div className="fx-menubar__menus">
        {menus.map((m) => (
          <div key={m.id} className="fx-menubar__item">
            <button
              type="button"
              className={`fx-menubar__btn ${open === m.id ? 'is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open === m.id}
              data-axf-menu-btn={m.id}
              onClick={() => setOpen((o) => (o === m.id ? null : m.id))}
              onMouseEnter={() => open && setOpen(m.id)}
            >
              {m.label}
            </button>
            {open === m.id && <AppMenuDropdown key={m.id} menu={m} onDone={() => setOpen(null)} />}
          </div>
        ))}
      </div>
      <button type="button" className="fx-rolechip" onClick={() => rt.navigate('account')} title="User account control">
        <Icon name="shield" size={13} />
        {role?.label ?? state.role}
      </button>
    </div>
  );
}

/* ---------------- Toolbar (toolbar asset) ---------------- */

export function Toolbar({ views }: { views: ViewMap }) {
  const rt = useRuntime();
  const tb = useAsset('toolbar');
  useAxfState();
  const [q, setQ] = useState('');
  // Widgets (clock, search bar) at the toolbar's start / end: its own `widgets` + run-time ones (core/engines/widgets.ts).
  const widgets = rt.toolbarWidgets();
  // Arrange mode (right-click the toolbar → Arrange widgets): drag a widget, it snaps between the others (Arrange.tsx).
  const arrange = useArrange('toolbar', widgets);
  const drawWidget = (w: PlacedAttachment, i: number) => arrange.item(w, i, 'fx-toolbar__widget', { 'data-axf-toolbar-widget': w.key, 'data-axf-origin': w.origin }, <WidgetView type={w.type} id={w.id} host="toolbar" />);
  // `collapsible` toolbars fold to a thin handle; the fold is a per-device setting (axf.toolbar.collapsed).
  const collapsible = tb.data.collapsible === true;
  const collapsed = rt.toolbarCollapsed();
  const fold = (on: boolean) => rt.setToolbarCollapsed(on);
  if (collapsible && collapsed) {
    return (
      <div className={`fx-toolbar fx-toolbar--${tb.data.variant} is-collapsed`} data-align={tb.data.align} role="toolbar" aria-label="Toolbar (folded)">
        <button type="button" className="fx-toolbtn fx-toolbar__fold" aria-label="Unfold the toolbar" aria-expanded="false" onClick={() => fold(false)}><Icon name="chevron-down" size={14} /></button>
      </div>
    );
  }

  // Search doubles as a mini command palette: jump to a view or hot-swap an asset by name.
  const run = (e: FormEvent) => {
    e.preventDefault();
    const needle = q.trim().toLowerCase();
    if (!needle) return;
    const view = Object.entries(views).find(([id, v]) => id === needle || v.title.toLowerCase().includes(needle));
    if (view) {
      rt.navigate(view[0]);
      setQ('');
      return;
    }
    for (const t of ASSET_TYPES) {
      const hit = rt.registry.list(t).find((a) => a.name.toLowerCase().includes(needle) || a.id === needle);
      if (hit) {
        if (rt.swap(t, hit.id)) rt.toast(`${assetTypeSpecs[t].label} → ${hit.name}`, 'success', 'Hot-swapped');
        setQ('');
        return;
      }
    }
    rt.toast(`Nothing matches "${q}".`, 'warning', 'Search');
  };

  return (
    <div className={`fx-toolbar fx-toolbar--${tb.data.variant}${arrange.on ? ' is-arranging' : ''}`} data-align={tb.data.align} role="toolbar" data-fx-ctx-target="toolbar" data-axf-arrange-host="toolbar">
      <ArrangeBar host="toolbar" label="toolbar" />
      {(arrange.on || widgets.start.length > 0) && <span className="fx-toolbar__widgets is-start" {...arrange.sideProps('start')}>{arrangedSide(arrange, 'start', widgets.start, drawWidget)}</span>}
      {tb.data.groups.map((g) => (
        <div key={g.id} className="fx-toolbar__group">
          {g.items.map((it) => <ToolbarButton key={it.id} item={it} variant={tb.data.variant} itemStyle={tb.data.itemStyle} host={{ toolbar: tb.id, ...(tb.data.attach ? { target: tb.data.attach.target } : {}) }} />)}
        </div>
      ))}
      {(arrange.on || widgets.end.length > 0) && <span className="fx-toolbar__widgets is-end" {...arrange.sideProps('end')}>{arrangedSide(arrange, 'end', widgets.end, drawWidget)}</span>}
      {tb.data.showSearch && tb.data.search?.live && <LiveSearch config={tb.data.search} />}
      {tb.data.showSearch && !tb.data.search?.live && (
        <form className="fx-search" onSubmit={run} role="search">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to view or swap asset…" aria-label="Search views and assets" />
        </form>
      )}
      {collapsible && <button type="button" className="fx-toolbtn fx-toolbar__fold" aria-label="Fold the toolbar" aria-expanded="true" onClick={() => fold(true)}><Icon name="chevron-up" size={14} /></button>}
    </div>
  );
}


type ToolbarItem = {
  id: string; icon: string; label: string; action: string; requires?: string; badge?: string;
  /* toolbar-binding@1 */
  kind?: ToolbarItemKind; value?: string; count?: string;
};

/** Where a toolbar's items go (toolbar-binding@1): its id and the element it is attached to, when any. */
interface ToolbarHost { toolbar: string; target?: string }

/**
 * One toolbar item: gated by UAC, left out when the host app does it, greyed when the host locks it. Attached toolbars
 * (toolbar-binding@1) ask their element how the item looks (active, sort direction, corner count) and run it there.
 */
function ToolbarButton({ item: it, variant, itemStyle = 'button', host }: { item: ToolbarItem; variant: string; itemStyle?: string; host?: ToolbarHost }) {
  const rt = useRuntime();
  const gate = rt.gate(it.requires);
  if (gate === 'hide') return null;
  if (it.action && rt.takenByHost({ action: it.action })) return null; // the host app does this (embed@1 takes)
  const call: ToolbarItemCall = { toolbar: host?.toolbar ?? '', item: it.id, kind: it.kind ?? 'action', action: it.action ?? '', ...(it.value !== undefined ? { value: it.value } : {}) };
  const st = host ? rt.toolbarItemState(host.target, call) : undefined;
  const count = it.count ? st?.count ?? 0 : it.badge ? rt.badge(it.badge) : 0;
  const label = st?.label ?? it.label;
  // a hook of a function the host locks (plugins inside Patches): greyed out, its note as the tooltip
  const hostLock = it.action ? rt.lockedByHost({ action: it.action }) : undefined;
  const off = gate === 'disable' || !!hostLock || !!st?.disabled;
  const active = !!st?.active;
  const pressable = call.kind !== 'action';
  const tip = hostLock ? `${label} — ${hostLock}` : gate === 'disable' ? `${label} — requires ${it.requires}` : call.kind === 'sort' && active ? `${label} — tap again to reverse` : label;
  const run = () => { if (host) rt.runToolbarItem(host.target, call); else rt.dispatch(it.action); };
  return (
    <button
      type="button"
      className={`fx-toolbtn fx-toolbtn--${itemStyle}${active ? ' is-active' : ''}`}
      disabled={off}
      title={tip}
      aria-pressed={pressable ? active : undefined}
      aria-label={count ? `${label} (${count})` : label}
      data-axf-toolbar-item={it.id}
      onClick={run}
    >
      {(variant !== 'labels' || itemStyle === 'tile') && <Icon name={off && !st?.disabled ? 'lock' : it.icon} size={itemStyle === 'tile' ? 18 : 16} />}
      {(variant !== 'icons' || itemStyle === 'tile') && <span className="fx-toolbtn__label">{label}</span>}
      {call.kind === 'sort' && active && st?.dir && <Icon name={st.dir === 'asc' ? 'chevron-up' : 'chevron-down'} size={13} />}
      {(count > 0 || (it.count && st?.count !== undefined)) && <span className={`fx-toolbtn__badge${count === 0 ? ' is-zero' : ''}`} aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

type AssetToolbarData = {
  variant: string; align?: string; showSearch?: boolean; groups: { id: string; items: ToolbarItem[] }[];
  label?: string; itemStyle?: string; density?: string; surface?: string; attach?: ToolbarAttach; owner?: ToolbarOwner;
};

/**
 * A toolbar drawn from a named toolbar asset rather than the app's active one: a page's own toolbar (the settings
 * interface names one in its `toolbar` field) or a toolbar attached to an element (toolbar-binding@1; see
 * AttachedToolbars). Same items, look and gating as the app toolbar; no widgets or fold. Per-device look overrides
 * (`axf.toolbar.<id>.<field>`, set in the owning plugin's settings) win over the asset. `search` fills the asset's
 * search spot when it has `showSearch`. Null when the asset isn't registered or the device hides it.
 */
export function AssetToolbar({ id, search, label }: { id: string; search?: ReactNode; label?: string }) {
  const rt = useRuntime();
  useAxfState();
  const tb = rt.registry.list('toolbar').find((a) => a.id === id);
  if (!tb) return null;
  const data = tb.data as AssetToolbarData;
  if (rt.toolbarSetting(tb.id, 'hidden') === true) return null;
  const variant = String(rt.toolbarSetting(tb.id, 'variant') ?? data.variant);
  const itemStyle = String(rt.toolbarSetting(tb.id, 'itemStyle') ?? data.itemStyle ?? 'button');
  const density = rt.toolbarSetting(tb.id, 'density') ?? data.density;
  const surface = rt.toolbarSetting(tb.id, 'surface') ?? data.surface;
  const host: ToolbarHost = { toolbar: tb.id, ...(data.attach ? { target: data.attach.target } : {}) };
  return (
    <div
      className={`fx-toolbar fx-toolbar--${variant} fx-toolbar--items-${itemStyle}`}
      data-align={data.align}
      data-density={density}
      data-surface={surface}
      role="toolbar"
      aria-label={label ?? data.label ?? tb.name}
      data-axf-toolbar-asset={tb.id}
      data-axf-attached={data.attach?.target}
    >
      {data.label && <span className="fx-toolbar__label">{data.label}</span>}
      {data.groups.map((g) => (
        <div key={g.id} className="fx-toolbar__group">
          {g.items.map((it) => <ToolbarButton key={it.id} item={it} variant={variant} itemStyle={itemStyle} host={host} />)}
        </div>
      ))}
      {data.showSearch && search}
    </div>
  );
}

/**
 * Every toolbar asset attached to an element (toolbar-binding@1): `data.attach.target === target`, at one side
 * (default top), in `attach.order`. Pages put this next to the element they register with `useAttachTarget`, so a
 * toolbar added later (an app's own, a plugin's) shows up there without touching the page.
 */
export function AttachedToolbars({ target, at = 'top', className }: { target: string; at?: string; className?: string }) {
  const rt = useRuntime();
  useAxfState();
  const list = rt.toolbarsFor(target, at);
  if (!list.length) return null;
  return (
    <div className={`fx-attached fx-attached--${at}${className ? ` ${className}` : ''}`} data-axf-attach-target={target}>
      {list.map((t) => <AssetToolbar key={t.id} id={t.id} />)}
    </div>
  );
}

/**
 * Register an element toolbars attach to (toolbar-binding@1). `target` may change every render (it closes over the
 * page's state): the registration stays, the latest functions are used, and attached toolbars redraw.
 */
export function useAttachTarget(id: string, target: AttachTarget): void {
  const rt = useRuntime();
  const ref = useRef(target);
  ref.current = target;
  useEffect(() => rt.registerAttachTarget(id, {
    kind: target.kind,
    label: target.label,
    run: (c) => ref.current.run(c),
    state: (c) => ref.current.state?.(c),
  }), [rt, id, target.kind, target.label]);
}

/* ---------------- NavMenu (nav-menu asset, oriented by the layout asset) ---------------- */

export function NavMenu({ views }: { views: ViewMap }) {
  const rt = useRuntime();
  const nav = useAsset('nav-menu');
  const layout = useAsset('layout');
  const state = useAxfState();
  const orient = layout.data.nav === 'top' ? 'horizontal' : 'vertical';

  return (
    <nav className={`fx-nav fx-nav--${nav.data.style}`} data-orient={orient} aria-label="Main">
      {nav.data.header && orient === 'vertical' && <div className="fx-nav__header">{nav.data.header}</div>}
      {[...nav.data.sections, ...rt.navExtras].map((sec, i) => {
        const items = sec.items.filter((it) => views[it.view] && rt.gate(it.requires) !== 'hide' && !rt.takenByHost({ view: it.view }));
        if (!items.length) return null;
        return (
          <div key={i} className="fx-nav__section">
            {sec.label && <div className="fx-nav__label">{sec.label}</div>}
            {items.map((it) => {
              const hostLock = rt.lockedByHost({ view: it.view });
              const locked = rt.gate(it.requires) === 'disable' || !!hostLock;
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`fx-nav__item ${state.view === it.view ? 'is-active' : ''}`}
                  aria-current={state.view === it.view ? 'page' : undefined}
                  disabled={locked}
                  title={hostLock ? `${it.label} — ${hostLock}` : it.label}
                  data-fx-ctx-target="nav-item"
                  data-fx-ctx-payload={it.view}
                  onClick={() => rt.navigate(it.view)}
                >
                  <Icon name={locked ? 'lock' : it.icon} size={17} />
                  <span className="fx-nav__text">{it.label}</span>
                  {it.badge && <span className="fx-nav__badge">{it.badge}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

/* ---------------- StatusBar ---------------- */

export function StatusBar() {
  const rt = useRuntime();
  const state = useAxfState();
  const name = (t: 'color-theme' | 'style-theme' | 'layout') => rt.asset(t).name;
  return (
    <footer className="fx-status">
      <span className="fx-status__dot" aria-hidden="true" />
      <span>AmberX AXF {FRAMEWORK_VERSION}</span>
      <span className="fx-status__sep" />
      <span title="Color theme">{name('color-theme')}</span>
      <span title="Style theme">{name('style-theme')}</span>
      <span title="Layout">{name('layout')}</span>
      <span className="fx-status__grow" />
      <span>{rt.registry.count()} assets</span>
      <span>{state.swaps} swaps</span>
    </footer>
  );
}
