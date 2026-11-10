import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { MenuItem } from '../../core';
import { MENU_ITEM_DIALOG, type CompiledMenuItem } from '../../core/engines/appmenu';
import { menuKey, nextMenuIndex } from '../../core/engines/menufit';
import { useRuntime, useAxfState } from '../AxfProvider';
import { Icon } from './Icon';
import { Kbd } from './Controls';
import { focusMenuItem, menuRows, scrollMenuBy, useMenuFit } from './menuFit';

interface MenuListProps {
  items: MenuItem[];
  onDone: () => void;
  payload?: string;
  showIcons?: boolean;
  showShortcuts?: boolean;
  /** put focus on the first row when the list appears (a context menu that just opened; a submenu opened with the keyboard) */
  autoFocus?: boolean;
  /** a flyout submenu: ArrowLeft / Escape close it and put focus back on its parent row (the parent passes this) */
  onClose?: () => void;
  /** the list's name for item paths (`context-menu/<where>/<id>`): a context menu passes its target (default `menu`) */
  where?: string;
}

/**
 * A submenu's flyout box: opens to the right of its row and flips to the left only when it would run off the screen
 * (Brett, Oct 28 2026); a box taller than the room moves up to fit, and one taller than the screen scrolls inside
 * (menu-fit@1, Nov 3 2026). Placed inside its parent menu box (not its row), so a scrolling parent never clips it.
 * Used by context menus and the app menu. Phones show submenus inline.
 */
export function MenuSub({ children, role }: { children: ReactNode; role?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuFit(ref, 'side', () => ref.current?.parentElement?.getBoundingClientRect());
  return (
    <div ref={ref} className="fx-menu__sub fx-popover" role={role}>
      <MenuScroll box={ref}>{children}</MenuScroll>
    </div>
  );
}

/**
 * A menu box's scrolling body plus its scroll hints: a fade and a chevron at the top / bottom while there is more
 * that way (`data-fx-more` on the box, kept by useMenuFit). A tap on a hint scrolls most of a page.
 */
export function MenuScroll({ box, children }: { box: RefObject<HTMLElement | null>; children: ReactNode }) {
  // the hints are zero-height rows on either side of the scroller (outside its fade mask), so rows never move
  return (
    <>
      <span className="fx-menu__more fx-menu__more--up" aria-hidden="true" onPointerDown={(e) => { e.preventDefault(); scrollMenuBy(box.current, -1); }}><Icon name="chevron-up" size={14} /></span>
      <div className="fx-menu__scroll">{children}</div>
      <span className="fx-menu__more fx-menu__more--down" aria-hidden="true" onPointerDown={(e) => { e.preventDefault(); scrollMenuBy(box.current, 1); }}><Icon name="chevron-down" size={14} /></span>
    </>
  );
}

/* ---------------- row bits shared by the application menu and context menus (menu-item@2, spec/MENUS.md) ---------------- */

/** Origin of the rows a choice setting's list is made of (`choiceRows`). */
export const CHOICE_ORIGIN = 'choice';

/** Does this row have a flyout: a submenu, a live list, or a choice setting's list (not a switch, not a cycling row)? */
export const rowHasSub = (item: CompiledMenuItem): boolean => !!item.items || !!item.provider || (item.kind === 'choice' && !!item.choices?.length && !item.cycle);

/** A pick in a choice list, a switch flip or a cycle step applies at once and leaves the menu open, so the new value shows beside the entry. */
export const rowKeepsOpen = (item: CompiledMenuItem): boolean => item.origin === CHOICE_ORIGIN || item.kind === 'choice';

/** The ARIA role of a row: a choice list's rows are radio items, a switch and every checked row a checkbox item. */
export function rowRole(item: CompiledMenuItem): 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' {
  if (item.origin === CHOICE_ORIGIN) return 'menuitemradio';
  if (item.check !== undefined) return 'menuitemcheckbox';
  return 'menuitem';
}

/** A choice setting's list as rows: one per choice, the current one checked, each running the pick's action. */
export function choiceRows(item: CompiledMenuItem): CompiledMenuItem[] {
  return (item.choices ?? []).map((c) => ({
    id: `${item.id}:${String(c.value)}`, label: c.label, kind: 'action', path: `${item.path}/${String(c.value)}`,
    ...(c.icon ? { icon: c.icon } : {}), hint: c.hint ?? `${item.label}: ${c.label}`, action: c.action, check: c.on, locked: item.locked, origin: CHOICE_ORIGIN,
  }));
}

/** The tooltip of a row: the lock's reason first, else the item's hint. */
export const rowTitle = (item: CompiledMenuItem, lockNote: string | null | undefined): string | undefined =>
  item.locked ? (lockNote ?? (item.requires ? `Requires ${item.requires}` : 'Not available')) : item.hint;

/** The row's appearance overrides as `data-fx-*` attributes the stylesheet maps to theme tokens (menu-item@2 s4). */
export function rowLookAttrs(item: CompiledMenuItem): Record<string, string | undefined> {
  const l = item.look;
  return { 'data-fx-tone': l?.tone, 'data-fx-icon-tone': l?.iconTone, 'data-fx-weight': l?.weight, 'data-fx-emphasis': l?.emphasis, 'data-fx-size': l?.size };
}

/**
 * Right-click on a row: the item-settings dialog on its path (menu-item@2 s4). The menu closes first; the dialog
 * is the framework's (`menuItemDialogs`, registered by AppShell). Choice rows (the radio rows of a choice setting) open
 * their parent setting's path.
 */
export function openMenuItemSettings(rt: ReturnType<typeof useRuntime>, item: CompiledMenuItem, onDone: () => void): void {
  const path = item.origin === CHOICE_ORIGIN ? item.path.slice(0, item.path.lastIndexOf('/')) : item.path;
  onDone();
  rt.openDialog(MENU_ITEM_DIALOG, { path, label: item.label });
}

/** The left slot: a check mark for check / switch / choice rows, else the item's icon (a lock while locked), explained on hover. */
export function MenuRowIcon({ item, show = true }: { item: CompiledMenuItem; show?: boolean }) {
  if (item.check !== undefined) return <span className="fx-menu__check" aria-hidden="true">{item.check && <Icon name="check" size={14} />}</span>;
  if (!show) return null;
  const what = item.hint ?? item.label;
  return (
    <span className="fx-menu__icon" title={what} role={item.icon || item.locked ? 'img' : undefined} aria-label={item.icon || item.locked ? what : undefined}>
      {item.locked ? <Icon name="lock" size={14} /> : <Icon name={item.icon} size={15} />}
    </span>
  );
}

/** A choice setting's current value beside its label (`On` / `Off` for a switch; empty while never saved). */
export function MenuRowValue({ item }: { item: CompiledMenuItem }) {
  if (item.kind !== 'choice' || !item.valueLabel) return null;
  return <span className="fx-menu__value" data-axf-value={String(item.value ?? '')} title={`${item.label}: ${item.valueLabel}`}>{item.valueLabel}</span>;
}

/** The live status slot: the source's icon in the state's tone, animated while busy; hover says what it means. */
export function MenuRowStatus({ item }: { item: CompiledMenuItem }) {
  const s = item.status;
  if (!s) return null;
  return (
    <span className="fx-menu__status" data-fx-tone={s.tone} data-fx-anim={s.anim} data-axf-status={s.state} title={s.tooltip} role="img" aria-label={s.tooltip}>
      <Icon name={s.icon} size={12} />
    </span>
  );
}

/** The shortcut key cap, explained on hover. */
export function MenuRowShortcut({ shortcut, show = true }: { shortcut?: string; show?: boolean }) {
  if (!shortcut || !show) return null;
  return <span className="fx-menu__kbd" title={`Shortcut: ${shortcut}`}><Kbd>{shortcut}</Kbd></span>;
}

/** The sub-menu chevron, explained on hover. */
export function MenuRowChevron() {
  return <span className="fx-menu__chevron" title="Opens a sub-menu" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>;
}

/**
 * Shared renderer for dropdown menus and context menus (UAC-aware, nested). The raw items are compiled through the
 * runtime first (`rt.compileMenuItems`: kinds, paths, gating, host takes and locks, badges, check marks, choice
 * settings, status slots, token overrides), so a context menu row behaves exactly like an application-menu row.
 *
 * Keyboard (core/engines/menufit.ts `menuKey`): arrows move with wrap, Home / End jump, ArrowRight (or Enter) on a row
 * with a submenu opens it and puts focus on its first row, ArrowLeft / Escape inside a submenu close it and put focus
 * back on the parent row, Escape at the root closes the menu (`onDone`). A submenu that flipped left or up keeps the
 * same keys: the flip moves the box, never the focus.
 */
export function MenuList({ items, where = 'menu', ...rest }: MenuListProps) {
  const rt = useRuntime();
  useAxfState();
  return <CompiledMenuList items={rt.compileMenuItems(items, where)} {...rest} />;
}

type CompiledListProps = Omit<MenuListProps, 'items' | 'where'> & { items: CompiledMenuItem[] };

/** One level of compiled rows (the runtime compiled them; a submenu's rows come compiled with their parent). */
export function CompiledMenuList({ items, onDone, payload, showIcons = true, showShortcuts = true, autoFocus, onClose }: CompiledListProps) {
  const rt = useRuntime();
  const [openSub, setOpenSub] = useState<string | null>(null);
  // opened with the keyboard: focus goes into the submenu; opened by hover it stays where the pointer is
  const [subByKey, setSubByKey] = useState(false);
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => { if (autoFocus) focusMenuItem(menuRows(ref.current)[0]); }, [autoFocus]);
  const closeSub = useCallback((id: string) => { setOpenSub(null); setSubByKey(false); focusMenuItem(menuRows(ref.current).find((b) => b.dataset.axfItem === id)); }, []);

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const list = menuRows(ref.current);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const row = list[at];
    const hasSub = row?.getAttribute('aria-haspopup') === 'menu';
    const action = menuKey(e.key, { hasSub, inSub: !!onClose });
    if (!action || action === 'activate') return; // Enter / Space run the button
    e.preventDefault(); e.stopPropagation();
    switch (action) {
      case 'next': case 'prev': case 'first': case 'last': focusMenuItem(list[nextMenuIndex(list.length, at, action)]); break;
      case 'open':
        // already open (hover, or a second ArrowRight): just move focus into it
        if (openSub === row!.dataset.axfItem) focusMenuItem(ref.current?.querySelector<HTMLElement>('.fx-menu__sub [role^="menuitem"]:not(:disabled)'));
        else { setOpenSub(row!.dataset.axfItem ?? null); setSubByKey(true); }
        break;
      case 'close': onClose?.(); break;
      case 'escape': onDone(); break;
    }
  };

  return (
    <ul className="fx-menu" role="menu" ref={ref} onKeyDown={onKey}>
      {items.map((item) => {
        if (item.separator) return <li key={item.id} className="fx-menu__sep" role="separator" data-axf-path={item.path} />;
        const hasSub = rowHasSub(item);
        const sub = hasSub && openSub === item.id;
        const role = rowRole(item);
        return (
          <li
            key={item.id}
            className="fx-menu__li"
            data-axf-item={item.id}
            onMouseEnter={() => { setOpenSub(hasSub ? item.id : null); setSubByKey(false); }}
          >
            <button
              type="button"
              role={role}
              aria-checked={role === 'menuitem' ? undefined : !!item.check}
              aria-haspopup={hasSub ? 'menu' : undefined}
              aria-expanded={hasSub ? sub : undefined}
              className={`fx-menu__item${item.check ? ' is-checked' : ''}`}
              data-axf-item={item.id}
              data-axf-path={item.path}
              data-axf-kind={item.kind}
              data-axf-action={item.action}
              {...rowLookAttrs(item)}
              disabled={item.locked}
              title={rowTitle(item, item.action ? rt.lockedByHost({ action: item.action }) : null)}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenuItemSettings(rt, item, onDone); }}
              onClick={(e) => {
                if (hasSub) {
                  e.stopPropagation();
                  // a click (Enter / Space too: the button fires click) toggles the submenu; from the keyboard focus goes in
                  setOpenSub((s) => (s === item.id ? null : item.id));
                  setSubByKey(e.detail === 0);
                  return;
                }
                // a choice applies at once and the menu stays open, so the value beside the entry shows the change
                if (rowKeepsOpen(item)) { e.stopPropagation(); if (item.action) rt.dispatch(item.action, { payload }); return; }
                onDone();
                if (item.action) rt.dispatch(item.action, { payload });
              }}
            >
              <MenuRowIcon item={item} show={showIcons} />
              <span className="fx-menu__label">{item.label}</span>
              <MenuRowStatus item={item} />
              <MenuRowValue item={item} />
              {item.count !== undefined && item.count > 0 && <span className="fx-menu__badge" aria-label={`${item.count} new`}>{item.count > 99 ? '99+' : item.count}</span>}
              <MenuRowShortcut shortcut={item.shortcut} show={showShortcuts} />
              {hasSub && <MenuRowChevron />}
            </button>
            {sub && (
              <MenuSub>
                {item.kind === 'choice' ? <CompiledMenuList items={choiceRows(item)} onDone={onDone} payload={payload} showIcons={showIcons} showShortcuts={showShortcuts} autoFocus={subByKey} onClose={() => closeSub(item.id)} />
                  : item.provider ? <ProviderList id={item.provider} onDone={onDone} payload={payload} showIcons={showIcons} showShortcuts={showShortcuts} autoFocus={subByKey} onClose={() => closeSub(item.id)} />
                    : <CompiledMenuList items={item.items ?? []} onDone={onDone} payload={payload} showIcons={showIcons} showShortcuts={showShortcuts} autoFocus={subByKey} onClose={() => closeSub(item.id)} />}
              </MenuSub>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A live list's items (loaded when its submenu opens), with loading / error / empty rows. */
function ProviderList({ id, ...rest }: { id: string } & Omit<CompiledListProps, 'items'>) {
  const rt = useRuntime();
  const [items, setItems] = useState<CompiledMenuItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    rt.loadAppMenuProvider(id).then((list) => { if (live) setItems(list); }, (e: Error) => { if (live) setError(e.message || 'could not load'); });
    return () => { live = false; };
  }, [rt, id]);
  if (error) return <ul className="fx-menu" role="menu"><li className="fx-menu__li"><span className="fx-menu__row fx-muted">{error}</span></li></ul>;
  if (!items) return <ul className="fx-menu" role="menu"><li className="fx-menu__li"><span className="fx-menu__row fx-muted">Loading…</span></li></ul>;
  if (!items.length) return <ul className="fx-menu" role="menu"><li className="fx-menu__li"><span className="fx-menu__row fx-muted">Nothing here</span></li></ul>;
  return <CompiledMenuList items={items} {...rest} />;
}
