import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { NavItem } from '../../core';
import { NAV_OPEN_KEY, NAV_COLLAPSED_KEY, NAV_WIDTH_KEY } from '../../core/runtime';
import { navAccent, navArrange, navContains, navFollow, navPathTo, navToggle, parseNavOpen, type NavStyleData } from '../../core/engines/navstyle';
import { useAxfState, useRuntime } from '../AxfProvider';
import type { ViewMap } from '../AppShell';
import { Icon } from './Icon';

/**
 * The navigation with sub menus (nav-style@1, core/engines/navstyle.ts): what NavMenu draws when its nav-menu asset
 * opts in (`navStyle: true`). An item with children (NavItem.items, from the asset or contributed by a plugin onto an
 * existing item) opens a sub menu that slides open under it, nested as deep as the items go; on a phone the bottom
 * strip opens it as a sheet that slides up (swipe up on the strip opens the page's own, swipe down closes it). The
 * animation, colours, fonts, width and behaviour all come from the nav-style asset in force (tokens + root attributes
 * the engine compiles); the open sub menus, the width the nav was dragged to and the collapsed state are kept per
 * device (NAV_OPEN_KEY, NAV_WIDTH_KEY, NAV_COLLAPSED_KEY).
 */

type Section = { label?: string | null; items: NavItem[] };

/** Keep what can be shown: items whose view exists, and groups with something under them. */
function prune(items: readonly NavItem[], views: ViewMap, show: (it: NavItem) => boolean): NavItem[] {
  const out: NavItem[] = [];
  for (const it of items) {
    if (!show(it)) continue;
    const kids = it.items?.length ? prune(it.items, views, show) : [];
    const hasView = !!it.view && !!views[it.view];
    if (!hasView && !kids.length) continue;
    out.push(kids.length ? { ...it, items: kids } : { ...it, items: undefined });
  }
  return out;
}

/** Icon size per nav-style step (px, like every Icon size); a brand icon pack draws at the same size. */
const NAV_ICON_PX: Record<string, number> = { sm: 14, md: 17, lg: 20 };

/** `inert` as a plain attribute: React 18 only passes it through as a string, React 19 types it as a boolean. */
const inertWhen = (on: boolean): object => (on ? { inert: '' } : {});

export function NavTree({ sections, views, style, orient, header }: { sections: Section[]; views: ViewMap; style: NavStyleData; orient: 'horizontal' | 'vertical'; header?: string }) {
  const rt = useRuntime();
  const state = useAxfState();
  const view = state.view;
  const narrow = 'data-fx-narrow' in rt.viewportAttrs();
  const collapsed = rt.settings.get(NAV_COLLAPSED_KEY) === true && style.width.collapsible && !narrow;
  const show = useCallback((it: NavItem) => rt.gate(it.requires) !== 'hide' && !(it.view && rt.takenByHost({ view: it.view })), [rt]);

  // pinned / hidden / ordered top-level items (the style's `items` group), then what can be shown
  const shown = useMemo(() => {
    const pinned: NavItem[] = [];
    const out: Section[] = [];
    for (const sec of sections) {
      const arranged = navArrange(prune(sec.items, views, show), style);
      pinned.push(...arranged.pinned);
      if (arranged.items.length) out.push({ label: sec.label, items: arranged.items });
    }
    return pinned.length ? [{ label: 'Pinned', items: pinned }, ...out] : out;
  }, [sections, views, show, style]);
  const tree = useMemo(() => shown.flatMap((s) => s.items), [shown]);

  // which sub menus are open: saved per device when the style remembers, else this page only
  const [open, setOpenState] = useState<string[]>(() => (style.behavior.remember ? parseNavOpen(rt.settings.get(NAV_OPEN_KEY)) : []));
  const setOpen = useCallback((next: string[]) => {
    setOpenState(next);
    if (style.behavior.remember) rt.settings.set(NAV_OPEN_KEY, JSON.stringify(next));
  }, [rt, style.behavior.remember]);
  const openRef = useRef(open); openRef.current = open;
  // the page moved: its branch opens (followActive), the others close (autoCollapse)
  // Only when the page changes or its branch first shows up (an app's nav arrives): a re-render must never reopen
  // what the user just closed.
  const followed = useRef('');
  const branchKey = navPathTo(tree, view).join('/');
  useEffect(() => {
    const key = `${view}|${branchKey}`;
    if (followed.current === key) return;
    followed.current = key;
    const next = navFollow(tree, openRef.current, view, style);
    if (next.join('|') !== openRef.current.join('|')) setOpen(next);
  }, [view, branchKey, tree, style, setOpen]);

  const toggle = (id: string, want?: boolean) => setOpen(navToggle(tree, openRef.current, id, style.behavior.single, want));
  const hover = style.behavior.openOn === 'hover' && !narrow;
  const leaveTimer = useRef(0);

  const pick = (it: NavItem) => {
    if (collapsed && it.items?.length) rt.settings.clear(NAV_COLLAPSED_KEY);
    if (it.items?.length) {
      const isOpen = openRef.current.includes(it.id);
      // a group with a page: the first tap opens both; tapping it again on its own page closes the sub menu
      if (it.view && views[it.view] && view !== it.view) { rt.navigate(it.view); if (!isOpen) toggle(it.id, true); return; }
      toggle(it.id);
      return;
    }
    if (it.view) rt.navigate(it.view);
  };

  const renderItems = (items: readonly NavItem[], depth: number, sheet = false): JSX.Element[] => items.map((it, i) => {
    const kids = it.items ?? [];
    const isOpen = kids.length > 0 && open.includes(it.id);
    const here = !!it.view && view === it.view;
    const within = !here && kids.length > 0 && navContains(it, view);
    const hostLock = it.view ? rt.lockedByHost({ view: it.view }) : null;
    const locked = rt.gate(it.requires) === 'disable' || !!hostLock;
    const accent = depth === 0 ? navAccent(style, it.id) : null;
    const rowStyle = { '--navs-i': i, ...(accent ? { '--navs-accent': accent } : {}) } as CSSProperties;
    const row = (
      <button
        key={it.id}
        type="button"
        className={`fx-nav__item${here ? ' is-active' : ''}${within ? ' is-within' : ''}${kids.length ? ' fx-nav__item--parent' : ''}`}
        aria-current={here ? 'page' : undefined}
        aria-expanded={kids.length ? isOpen : undefined}
        disabled={locked}
        title={hostLock ? `${it.label} — ${hostLock}` : it.label}
        data-axf-view-link={it.view || undefined}
        data-fx-ctx-target="nav-item"
        data-fx-ctx-payload={it.view || it.id}
        data-depth={depth}
        data-accent={accent ? 'on' : undefined}
        style={rowStyle}
        onClick={() => pick(it)}
      >
        {style.icons.show && <Icon name={locked ? 'lock' : it.icon || 'box'} size={NAV_ICON_PX[style.icons.size] ?? 17} />}
        <span className="fx-nav__text">{it.label}</span>
        <NavCount badge={it.badge} />
        {kids.length > 0 && <span className="fx-nav__chev" aria-hidden="true"><Icon name={style.animation.chevron === 'flip' ? 'chevron-down' : 'chevron-right'} size={14} /></span>}
      </button>
    );
    if (!kids.length) return row;
    return (
      <div
        key={it.id}
        className="fx-nav__group"
        data-open={isOpen ? 'true' : 'false'}
        data-depth={depth}
        style={rowStyle}
        onPointerEnter={hover ? () => { window.clearTimeout(leaveTimer.current); if (!openRef.current.includes(it.id)) toggle(it.id, true); } : undefined}
        onPointerLeave={hover ? () => { leaveTimer.current = window.setTimeout(() => { if (!navContains(it, rt.getState().view)) toggle(it.id, false); }, 280); } : undefined}
      >
        {row}
        {(!narrow || sheet) && (
          <div className="fx-nav__sub" role="group" aria-label={it.label} data-open={isOpen ? 'true' : 'false'} {...inertWhen(!isOpen)}>
            <div className="fx-nav__sub-inner">{renderItems(kids, depth + 1, sheet)}</div>
          </div>
        )}
      </div>
    );
  });

  // phone: the open top-level group's children in a sheet above the bottom strip
  const sheetOf = narrow ? tree.find((it) => it.items?.length && open.includes(it.id)) : undefined;
  // swipe on the phone strip: up opens the page's own group (or the first), down closes the sheet. The pointer may
  // leave the strip while it moves, so the end is read on the window.
  const onDown = (e: ReactPointerEvent) => {
    if (!narrow || !style.behavior.swipe) return;
    const start = { x: e.clientX, y: e.clientY };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', up);
      const dy = ev.clientY - start.y;
      if (Math.abs(dy) < 36 || Math.abs(dy) < Math.abs(ev.clientX - start.x)) return;
      const cur = openRef.current;
      const sheet = tree.find((it) => it.items?.length && cur.includes(it.id));
      const mine = tree.find((it) => it.items?.length && navContains(it, rt.getState().view)) ?? tree.find((it) => it.items?.length);
      if (dy < 0 && mine && !sheet) toggle(mine.id, true);
      if (dy > 0 && sheet) toggle(sheet.id, false);
    };
    window.addEventListener('pointerup', up);
  };

  // resizable: drag the edge; collapsible: a button folds the nav to its icons
  const navRef = useRef<HTMLElement>(null);
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = navRef.current?.parentElement; if (!el) return;
    e.preventDefault();
    const left = el.getBoundingClientRect().left;
    const side = el.closest('[data-side]')?.getAttribute('data-side');
    const move = (ev: PointerEvent) => {
      const w = side === 'right' ? el.getBoundingClientRect().right - ev.clientX : ev.clientX - left;
      rt.settings.set(NAV_WIDTH_KEY, Math.round(Math.min(style.width.max, Math.max(style.width.min, w))));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="fx-navs" data-orient={orient}>
      <nav ref={navRef} className={`fx-nav fx-nav--${rt.asset('nav-menu').data.style}`} data-orient={orient} aria-label="Main" data-fx-ctx-target="nav" onPointerDown={onDown}>
        {(header || (style.width.collapsible && !narrow)) && orient === 'vertical' && (
          <div className="fx-nav__head">
            {header && <div className="fx-nav__header">{header}</div>}
            {style.width.collapsible && !narrow && (
              <button type="button" className="fx-iconbtn fx-nav__fold" title={collapsed ? 'Show labels' : 'Collapse to icons'} aria-label={collapsed ? 'Show labels' : 'Collapse to icons'} onClick={() => (collapsed ? rt.settings.clear(NAV_COLLAPSED_KEY) : rt.settings.set(NAV_COLLAPSED_KEY, true))}>
                <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={14} />
              </button>
            )}
          </div>
        )}
        {shown.map((sec, i) => (
          <div key={`${sec.label ?? ''}:${i}`} className="fx-nav__section">
            {sec.label && <div className="fx-nav__label">{sec.label}</div>}
            {renderItems(sec.items, 0)}
          </div>
        ))}
      </nav>
      {narrow && (
        <div className="fx-nav__sheet" role="group" aria-label={sheetOf?.label ?? 'Sub menu'} data-open={sheetOf ? 'true' : 'false'} {...inertWhen(!sheetOf)}>
          {sheetOf && (
            <>
              <div className="fx-nav__sheet-head">
                <span className="fx-nav__label">{sheetOf.label}</span>
                <button type="button" className="fx-iconbtn" aria-label="Close" onClick={() => toggle(sheetOf.id, false)}><Icon name="x" size={14} /></button>
              </div>
              <div className="fx-nav__sub-inner">{renderItems(sheetOf.items ?? [], 1, true)}</div>
            </>
          )}
        </div>
      )}
      {style.width.resizable && !narrow && !collapsed && orient === 'vertical' && <div className="fx-nav__resize" role="separator" aria-orientation="vertical" aria-label="Resize navigation" onPointerDown={drag} onDoubleClick={() => rt.settings.clear(NAV_WIDTH_KEY)} />}
    </div>
  );
}

/** A nav item's badge: a runtime counter name shows its count (hidden at 0); any other text shows as is. */
function NavCount({ badge }: { badge?: string }) {
  const rt = useRuntime();
  if (!badge) return null;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(badge)) {
    const n = rt.badge(badge);
    return n > 0 ? <span className="fx-nav__badge" aria-label={`${n}`}>{n > 99 ? '99+' : n}</span> : null;
  }
  return <span className="fx-nav__badge">{badge}</span>;
}
