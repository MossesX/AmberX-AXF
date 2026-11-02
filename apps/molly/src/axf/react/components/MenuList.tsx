import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { filterMenu, resolveChecked, type AssetType, type MenuItem } from '../../core';
import { useRuntime, useAxfState } from '../AxfProvider';
import { Icon } from './Icon';
import { Kbd } from './Controls';

interface MenuListProps {
  items: MenuItem[];
  onDone: () => void;
  payload?: string;
  showIcons?: boolean;
  showShortcuts?: boolean;
}

/**
 * A submenu's flyout box: opens to the right of its row and flips to the left only when it would run off the screen
 * (Brett, Oct 28 2026); a box taller than the room below moves up to fit. Used by context menus and the app menu.
 */
export function MenuSub({ children, role }: { children: ReactNode; role?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  const [lift, setLift] = useState(0);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || getComputedStyle(el).position !== 'absolute') return; // phones show submenus inline
    // measured again whenever the box changes size (a live list fills in after its loading row)
    const fit = () => {
      const parent = el.parentElement?.getBoundingClientRect();
      if (!parent) return;
      const w = el.offsetWidth, h = el.offsetHeight;
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const rightEdge = parent.right + 2 + w;
      const left = rightEdge > vw - 4 && parent.left - w >= 0; // flip only when the right has no room and the left has
      setFlip(left);
      setShift(!left && rightEdge > vw - 4 ? Math.min(parent.right + 2 - 4, rightEdge - vw + 4) : 0);
      const top = parent.top - 4;
      setLift(top + h > vh - 4 ? Math.min(top - 4, top + h - vh + 4) : 0);
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const move = lift > 0 || shift > 0 ? { transform: `translate(${shift > 0 ? -shift : 0}px, ${lift > 0 ? -lift : 0}px)` } : undefined;
  return (
    <div ref={ref} className="fx-menu__sub fx-popover" role={role} data-fx-flip={flip ? 'left' : undefined}
      style={move}>
      {children}
    </div>
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

/** Shared renderer for dropdown menus and context menus (UAC-aware, nested). */
export function MenuList({ items, onDone, payload, showIcons = true, showShortcuts = true }: MenuListProps) {
  const rt = useRuntime();
  useAxfState();
  const [openSub, setOpenSub] = useState<string | null>(null);
  // Hooks the host app took over (embed@1 takes, e.g. Settings inside Patches) are dropped like hidden items.
  const visible = filterMenu(dropTaken(items, rt), (r) => rt.gate(r));

  return (
    <ul className="fx-menu" role="menu">
      {visible.map((item) => {
        if (item.separator) return <li key={item.id} className={item.spacer ? 'fx-menu__spacer' : 'fx-menu__sep'} role="separator" />;
        // a hook of a function the host locks (plugins inside Patches) stays, greyed out with its note
        const hostLock = item.action ? rt.lockedByHost({ action: item.action }) : null;
        const locked = rt.gate(item.requires) === 'disable' || !!hostLock;
        // a live list (`provider`, rt.registerAppMenuProvider) is a submenu filled when it opens
        const hasSub = !!item.items?.length || (!!item.provider && !item.action);
        // a check mark bound to a setting / counter / slot (context-menu toggles such as AshesUI)
        const check = resolveChecked(item.checked, { counter: (n) => rt.badge(n), setting: (k) => rt.settings.get(k), hidden: (t) => rt.slotHidden(t as AssetType) });
        return (
          <li
            key={item.id}
            className="fx-menu__li"
            data-axf-item={item.id}
            onMouseEnter={() => setOpenSub(hasSub ? item.id : null)}
          >
            <button
              type="button"
              role={check === null ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={check === null ? undefined : check}
              className="fx-menu__item"
              data-axf-action={item.action}
              disabled={locked}
              title={hostLock ?? (locked ? `Requires ${item.requires}` : undefined)}
              onClick={(e) => {
                if (hasSub) {
                  e.stopPropagation();
                  setOpenSub((s) => (s === item.id ? null : item.id));
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
            {hasSub && openSub === item.id && (
              <MenuSub>
                {item.items?.length ? <MenuList items={item.items} onDone={onDone} payload={payload} showIcons={showIcons} showShortcuts={showShortcuts} />
                  : <ProviderList id={item.provider!} onDone={onDone} payload={payload} showIcons={showIcons} showShortcuts={showShortcuts} />}
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
