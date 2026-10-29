/** Shell chrome: application menu bar, toolbar, navigation menu, status bar. */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ASSET_TYPES, assetTypeSpecs, FRAMEWORK_VERSION, type NavItem } from '../../core';
import { useAsset, useAxfState, useRuntime } from '../AxfProvider';
import { Icon } from './Icon';
import { BrandMark, brandHostProps, useBrandPlace } from './Brand';
import { AppMenuDropdown } from './AppMenu';
import { LiveSearch } from './Search';
import type { ViewMap } from '../AppShell';
import { WidgetView } from './Widgets';
import { ArrangeBar, arrangedSide, useArrange } from './Arrange';
import type { PlacedAttachment } from '../../core/engines/widgets';
import type { CompiledMenuItem } from '../../core/engines/appmenu';

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

  const menuMark = useBrandPlace('app-menu', 18);
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
        {/* the branding package names the app everywhere it shows (GizmoX for the Dev Console); the manifest name is the fallback */}
        {menuMark?.svg ? <BrandMark slot="app-menu" height={18} /> : <span className="fx-brand__mark" aria-hidden="true" />}
        <span className="fx-brand__name">{rt.branding()?.name || rt.manifest.app.name}</span>
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
  const brand = useBrandPlace('toolbar');
  const brandHost = brandHostProps(brand);
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
    <div className={`fx-toolbar fx-toolbar--${tb.data.variant}${arrange.on ? ' is-arranging' : ''} ${brandHost.className}`.trim()} data-align={tb.data.align} role="toolbar" data-fx-ctx-target="toolbar" data-axf-arrange-host="toolbar" data-fx-brand-mode={brandHost['data-fx-brand-mode']}>
      <ArrangeBar host="toolbar" label="toolbar" />
      {brand?.svg && <span className="fx-toolbar__brand"><BrandMark slot="toolbar" height={20} /></span>}
      {(arrange.on || widgets.start.length > 0) && <span className="fx-toolbar__widgets is-start" {...arrange.sideProps('start')}>{arrangedSide(arrange, 'start', widgets.start, drawWidget)}</span>}
      {tb.data.groups.map((g) => <ToolbarGroupView key={g.id} group={g} variant={tb.data.variant} />)}
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


type ToolbarItem = { id: string; icon: string; label: string; action: string; requires?: string; badge?: string; checked?: string };
type ToolbarGroup = { id: string; items: ToolbarItem[]; provider?: string; max?: number; label?: string };

/**
 * One toolbar group: its fixed items, then (when it names a `provider`) the live list from the app menu's provider
 * registry, reloaded shortly after the app's state changes so the buttons follow what's open, enabled or counted.
 */
function ToolbarGroupView({ group: g, variant }: { group: ToolbarGroup; variant: string }) {
  const rt = useRuntime();
  const state = useAxfState();
  const [live, setLive] = useState<CompiledMenuItem[]>([]);
  useEffect(() => {
    if (!g.provider) return undefined;
    let gone = false;
    const t = setTimeout(() => {
      rt.loadToolbarProvider(g.provider!, g.max ?? 8).then((items) => { if (!gone) setLive(items); }).catch(() => { if (!gone) setLive([]); });
    }, live.length ? 400 : 0);
    return () => { gone = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.provider, g.max, state.rev]);
  const fromProvider = live.filter((it) => !it.separator && it.action);
  if (!g.items.length && !fromProvider.length) return null;
  return (
    <div className="fx-toolbar__group" role="group" aria-label={g.label} data-axf-provider={g.provider}>
      {g.items.map((it) => <ToolbarButton key={it.id} item={it} variant={variant} />)}
      {fromProvider.map((it) => (
        <ToolbarButton key={`p:${it.id}`} variant={variant} lockedNote={it.locked ? 'not available' : undefined}
          item={{ id: it.id, icon: it.icon ?? 'chevron-right', label: it.label, action: it.action!, badge: it.badge, checked: it.checked }} />
      ))}
    </div>
  );
}

/** One toolbar item: gated by UAC, left out when the host app does it, greyed when the host locks it, pressed when its `checked` binding is on. */
function ToolbarButton({ item: it, variant, lockedNote }: { item: ToolbarItem; variant: string; lockedNote?: string }) {
  const rt = useRuntime();
  const gate = rt.gate(it.requires);
  if (gate === 'hide') return null;
  if (rt.takenByHost({ action: it.action })) return null; // the host app does this (embed@1 takes)
  const count = it.badge ? rt.badge(it.badge) : 0;
  const pressed = it.checked ? rt.toolbarChecked(it.checked) : null;
  // a hook of a function the host locks (plugins inside Patches): greyed out, its note as the tooltip
  const hostLock = rt.lockedByHost({ action: it.action }) ?? lockedNote;
  const off = gate === 'disable' || !!hostLock;
  return (
    <button
      type="button"
      className={`fx-toolbtn${pressed ? ' is-on' : ''}`}
      disabled={off}
      aria-pressed={pressed === null ? undefined : pressed}
      title={hostLock ? `${it.label} — ${hostLock}` : gate === 'disable' ? `${it.label} — requires ${it.requires}` : it.label}
      aria-label={count ? `${it.label} (${count} new)` : it.label}
      onClick={() => rt.dispatch(it.action)}
    >
      {variant !== 'labels' && <Icon name={off ? 'lock' : it.icon} size={16} />}
      {variant !== 'icons' && <span>{it.label}</span>}
      {count > 0 && <span className="fx-toolbtn__badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

/**
 * A toolbar drawn from a named toolbar asset rather than the app's active one: a page's own toolbar (the settings
 * interface names one in its `toolbar` field). Same items, look and gating as the app toolbar; no widgets or fold.
 * `search` fills the asset's search spot when it has `showSearch`. Null when the asset isn't registered.
 */
export function AssetToolbar({ id, search, label = 'Page toolbar' }: { id: string; search?: ReactNode; label?: string }) {
  const rt = useRuntime();
  useAxfState();
  const tb = rt.registry.list('toolbar').find((a) => a.id === id);
  if (!tb) return null;
  const data = tb.data as { variant: string; align?: string; showSearch?: boolean; groups: ToolbarGroup[] };
  return (
    <div className={`fx-toolbar fx-toolbar--${data.variant}`} data-align={data.align} role="toolbar" aria-label={label} data-axf-toolbar-asset={tb.id}>
      {data.groups.map((g) => <ToolbarGroupView key={g.id} group={g} variant={data.variant} />)}
      {data.showSearch && search}
    </div>
  );
}

/* ---------------- NavMenu (nav-menu asset, oriented by the layout asset) ---------------- */

/**
 * Sections with the same eyebrow are one section (DESIGN-LANGUAGE §11: one level, grouped by eyebrow), so plugins
 * that file their page under "Voice" join the asset's own "Voice" section instead of repeating the eyebrow. Order:
 * first appearance wins; unlabelled sections stay separate.
 */
export function mergeNavSections<S extends { label?: string | null; items: NavItem[] }>(sections: S[]): S[] {
  const out: S[] = [];
  const byLabel = new Map<string, S>();
  for (const s of sections) {
    const key = s.label ? s.label.trim().toLowerCase() : '';
    const hit = key ? byLabel.get(key) : undefined;
    if (hit) { hit.items = [...hit.items, ...s.items.filter((it) => !hit.items.some((x) => x.view === it.view))]; continue; }
    const copy = { ...s, items: [...s.items] };
    out.push(copy);
    if (key) byLabel.set(key, copy);
  }
  return out;
}

/** A nav item's badge: a runtime counter name (`tasks.today`) shows its count and hides at 0; any other text shows as is. */
function NavBadge({ badge }: { badge?: string }) {
  const rt = useRuntime();
  useAxfState();
  if (!badge) return null;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(badge)) {
    const n = rt.badge(badge);
    return n > 0 ? <span className="fx-nav__badge" aria-label={`${n}`}>{n > 99 ? '99+' : n}</span> : null;
  }
  return <span className="fx-nav__badge">{badge}</span>;
}

export function NavMenu({ views }: { views: ViewMap }) {
  const rt = useRuntime();
  const nav = useAsset('nav-menu');
  const layout = useAsset('layout');
  const state = useAxfState();
  const orient = layout.data.nav === 'top' ? 'horizontal' : 'vertical';

  return (
    <nav className={`fx-nav fx-nav--${nav.data.style}`} data-orient={orient} aria-label="Main">
      {nav.data.header && orient === 'vertical' && <div className="fx-nav__header">{nav.data.header}</div>}
      {mergeNavSections([...nav.data.sections, ...rt.navExtras]).map((sec, i) => {
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
                  <NavBadge badge={it.badge} />
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
