/** Shell chrome: application menu bar, toolbar, navigation menu, status bar. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ASSET_TYPES, assetTypeSpecs, FRAMEWORK_VERSION } from '../../core';
import { useAsset, useFrameState, useRuntime } from '../FrameProvider';
import { Icon } from './Icon';
import { MenuList } from './MenuList';
import type { ViewMap } from '../AppShell';

/* ---------------- MenuBar (app-menu asset) ---------------- */

export function MenuBar() {
  const rt = useRuntime();
  const menu = useAsset('app-menu');
  const state = useFrameState();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const policy = rt.asset('uac-policy').data;
  const role = policy.roles.find((r) => r.id === state.role);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="fx-menubar" ref={ref} role="menubar">
      <div className="fx-brand">
        <span className="fx-brand__mark" aria-hidden="true" />
        <span className="fx-brand__name">{rt.manifest.app.name}</span>
      </div>
      <div className="fx-menubar__menus">
        {menu.data.menus.map((m) => (
          <div key={m.id} className="fx-menubar__item">
            <button
              type="button"
              className={`fx-menubar__btn ${open === m.id ? 'is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open === m.id}
              onClick={() => setOpen((o) => (o === m.id ? null : m.id))}
              onMouseEnter={() => open && setOpen(m.id)}
            >
              {m.label}
            </button>
            {open === m.id && (
              <div className="fx-dropdown fx-popover">
                <MenuList items={m.items} onDone={() => setOpen(null)} />
              </div>
            )}
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
  useFrameState();
  const [q, setQ] = useState('');

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
    <div className={`fx-toolbar fx-toolbar--${tb.data.variant}`} data-align={tb.data.align} role="toolbar">
      {tb.data.groups.map((g) => (
        <div key={g.id} className="fx-toolbar__group">
          {g.items.map((it) => {
            const gate = rt.gate(it.requires);
            if (gate === 'hide') return null;
            return (
              <button
                key={it.id}
                type="button"
                className="fx-toolbtn"
                disabled={gate === 'disable'}
                title={gate === 'disable' ? `${it.label} — requires ${it.requires}` : it.label}
                aria-label={it.label}
                onClick={() => rt.dispatch(it.action)}
              >
                {tb.data.variant !== 'labels' && <Icon name={gate === 'disable' ? 'lock' : it.icon} size={16} />}
                {tb.data.variant !== 'icons' && <span>{it.label}</span>}
              </button>
            );
          })}
        </div>
      ))}
      {tb.data.showSearch && (
        <form className="fx-search" onSubmit={run} role="search">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to view or swap asset…" aria-label="Search views and assets" />
        </form>
      )}
    </div>
  );
}

/* ---------------- NavMenu (nav-menu asset, oriented by the layout asset) ---------------- */

export function NavMenu({ views }: { views: ViewMap }) {
  const rt = useRuntime();
  const nav = useAsset('nav-menu');
  const layout = useAsset('layout');
  const state = useFrameState();
  const orient = layout.data.nav === 'top' ? 'horizontal' : 'vertical';

  return (
    <nav className={`fx-nav fx-nav--${nav.data.style}`} data-orient={orient} aria-label="Main">
      {nav.data.header && orient === 'vertical' && <div className="fx-nav__header">{nav.data.header}</div>}
      {nav.data.sections.map((sec, i) => {
        const items = sec.items.filter((it) => views[it.view] && rt.gate(it.requires) !== 'hide');
        if (!items.length) return null;
        return (
          <div key={i} className="fx-nav__section">
            {sec.label && <div className="fx-nav__label">{sec.label}</div>}
            {items.map((it) => {
              const locked = rt.gate(it.requires) === 'disable';
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`fx-nav__item ${state.view === it.view ? 'is-active' : ''}`}
                  aria-current={state.view === it.view ? 'page' : undefined}
                  disabled={locked}
                  title={it.label}
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
  const state = useFrameState();
  const name = (t: 'color-theme' | 'style-theme' | 'layout') => rt.asset(t).name;
  return (
    <footer className="fx-status">
      <span className="fx-status__dot" aria-hidden="true" />
      <span>Frame {FRAMEWORK_VERSION}</span>
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
