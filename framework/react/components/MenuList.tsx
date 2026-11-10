import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { filterMenu, resolveChecked, type AssetType, type MenuItem } from '../../core';
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

/** Items without the hooks a host app took over (embed@1), nested lists included. */
function dropTaken(items: MenuItem[], rt: ReturnType<typeof useRuntime>): MenuItem[] {
  if (!rt.embedded?.takes?.length) return items;
  return items
    .filter((i) => i.separator || !(i.action && rt.takenByHost({ action: i.action })))
    .map((i) => (i.items ? { ...i, items: dropTaken(i.items, rt) } : i))
    .filter((i) => i.separator || !i.items || i.items.length > 0 || !!i.action);
}

/**
 * Shared renderer for dropdown menus and context menus (UAC-aware, nested).
 *
 * Keyboard (core/engines/menufit.ts `menuKey`): arrows move with wrap, Home / End jump, ArrowRight (or Enter) on a row
 * with a submenu opens it and puts focus on its first row, ArrowLeft / Escape inside a submenu close it and put focus
 * back on the parent row, Escape at the root closes the menu (`onDone`). A submenu that flipped left or up keeps the
 * same keys: the flip moves the box, never the focus.
 */
export function MenuList({ items, onDone, payload, showIcons = true, showShortcuts = true, autoFocus, onClose }: MenuListProps) {
  const rt = useRuntime();
  useAxfState();
  const [openSub, setOpenSub] = useState<string | null>(null);
  // opened with the keyboard: focus goes into the submenu; opened by hover it stays where the pointer is
  const [subByKey, setSubByKey] = useState(false);
  const ref = useRef<HTMLUListElement>(null);
  // Hooks the host app took over (embed@1 takes, e.g. Settings) are dropped like hidden items.
  const visible = filterMenu(dropTaken(items, rt), (r) => rt.gate(r));

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
      case 'open': setOpenSub(row!.dataset.axfItem ?? null); setSubByKey(true); break;
      case 'close': onClose?.(); break;
      case 'escape': onDone(); break;
    }
  };

  return (
    <ul className="fx-menu" role="menu" ref={ref} onKeyDown={onKey}>
      {visible.map((item) => {
        if (item.separator) return <li key={item.id} className={item.spacer ? 'fx-menu__spacer' : 'fx-menu__sep'} role="separator" />;
        // a hook of a function the host locks (e.g. plugins) stays, greyed out with its note
        const hostLock = item.action ? rt.lockedByHost({ action: item.action }) : null;
        const locked = rt.gate(item.requires) === 'disable' || !!hostLock;
        // a live list (`provider`, rt.registerAppMenuProvider) is a submenu filled when it opens
        const hasSub = !!item.items?.length || (!!item.provider && !item.action);
        // a check mark bound to a setting / counter / slot (context-menu toggles such as AshesUI)
        const check = resolveChecked(item.checked, { counter: (n) => rt.badge(n), setting: (k) => rt.settings.get(k), hidden: (t) => rt.slotHidden(t as AssetType) });
        const sub = hasSub && openSub === item.id;
        return (
          <li
            key={item.id}
            className="fx-menu__li"
            data-axf-item={item.id}
            onMouseEnter={() => { setOpenSub(hasSub ? item.id : null); setSubByKey(false); }}
          >
            <button
              type="button"
              role={check === null ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={check === null ? undefined : check}
              aria-haspopup={hasSub ? 'menu' : undefined}
              aria-expanded={hasSub ? sub : undefined}
              className="fx-menu__item"
              data-axf-item={item.id}
              data-axf-action={item.action}
              disabled={locked}
              title={hostLock ?? (locked ? `Requires ${item.requires}` : undefined)}
              onClick={(e) => {
                if (hasSub) {
                  e.stopPropagation();
                  // a click (Enter / Space too: the button fires click) toggles the submenu; from the keyboard focus goes in
                  setOpenSub((s) => (s === item.id ? null : item.id));
                  setSubByKey(e.detail === 0);
                  return;
                }
                onDone();
                if (item.action) rt.dispatch(item.action, { payload });
              }}
            >
              {showIcons && (
                <span className="fx-menu__icon">{locked ? <Icon name="lock" size={14} /> : <Icon name={item.icon} size={15} />}</span>
              )}
              <span className="fx-menu__label">{item.label}</span>
              {check !== null && <span className="fx-menu__check">{check && <Icon name="check" size={14} />}</span>}
              {showShortcuts && item.shortcut && <Kbd>{item.shortcut}</Kbd>}
              {hasSub && <Icon name="chevron-right" size={14} />}
            </button>
            {sub && (
              <MenuSub>
                {item.items?.length ? <MenuList items={item.items} onDone={onDone} payload={payload} showIcons={showIcons} showShortcuts={showShortcuts} autoFocus={subByKey} onClose={() => closeSub(item.id)} />
                  : <ProviderList id={item.provider!} onDone={onDone} payload={payload} showIcons={showIcons} showShortcuts={showShortcuts} autoFocus={subByKey} onClose={() => closeSub(item.id)} />}
              </MenuSub>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A live list's items (loaded when its submenu opens), with loading / error / empty rows. */
function ProviderList({ id, ...rest }: { id: string } & Omit<MenuListProps, 'items'>) {
  const rt = useRuntime();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    rt.loadAppMenuProvider(id).then((list) => { if (live) setItems(list.map((i) => ({ ...i, requires: i.locked ? i.requires : undefined })) as MenuItem[]); }, (e: Error) => { if (live) setError(e.message || 'could not load'); });
    return () => { live = false; };
  }, [rt, id]);
  if (error) return <ul className="fx-menu" role="menu"><li className="fx-menu__li"><span className="fx-menu__row fx-muted">{error}</span></li></ul>;
  if (!items) return <ul className="fx-menu" role="menu"><li className="fx-menu__li"><span className="fx-menu__row fx-muted">Loading…</span></li></ul>;
  if (!items.length) return <ul className="fx-menu" role="menu"><li className="fx-menu__li"><span className="fx-menu__row fx-muted">Nothing here</span></li></ul>;
  return <MenuList items={items} {...rest} />;
}
