/**
 * Application menu renderer (app-menu asset + run-time contributions + live lists; core/engines/appmenu.ts).
 *
 * `AppMenuDropdown` draws one top-level menu: nested flyouts on desktop, drill-down panels on phones (≤ 480 px, a
 * Back row on top), live lists (`provider`) loaded when their submenu opens (a loading row meanwhile), badges
 * (runtime counters), check marks (`checked` bindings), shortcuts and keyboard navigation (arrows, Home/End, Enter,
 * Escape). Theme tokens only (`.fx-menu__*`); `data-axf-menu-item` names each row for tests and screenshots.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { CompiledMenu, CompiledMenuItem } from '../../core/engines/appmenu';
import { MenuSub } from './MenuList';
import { useRuntime } from '../AxfProvider';
import { Icon } from './Icon';
import { Kbd } from './Controls';

/** Phones drill down instead of opening flyouts (the same breakpoint as the banner's label cut). */
export const APP_MENU_PHONE_QUERY = '(max-width: 480px)';

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(APP_MENU_PHONE_QUERY).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(APP_MENU_PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}

type Loaded = { state: 'loading' } | { state: 'ready'; items: CompiledMenuItem[] } | { state: 'error'; message: string };

/** Loads a live list once its submenu opens; re-runs when `open` flips back on (the list may have changed). */
function useProviderItems(provider: string | undefined, open: boolean, depth: number): Loaded | null {
  const rt = useRuntime();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!provider || !open) { setLoaded(null); return; }
    let alive = true;
    setLoaded({ state: 'loading' });
    rt.loadAppMenuProvider(provider, { depth }).then(
      (items) => { if (alive) setLoaded({ state: 'ready', items }); },
      (err) => { if (alive) { setLoaded({ state: 'error', message: String((err as Error)?.message ?? err) }); rt.terminal.warn('menus', `live list "${provider}" failed: ${String(err)}`); } },
    );
    return () => { alive = false; };
  }, [rt, provider, open, depth]);
  return loaded;
}

interface ListProps {
  items: CompiledMenuItem[];
  depth: number;
  onDone: () => void;
  /** phone: enter a submenu (drill down) instead of opening a flyout */
  onEnter?: (item: CompiledMenuItem) => void;
  autoFocus?: boolean;
}

const focusables = (root: HTMLElement | null) => root ? Array.from(root.querySelectorAll<HTMLButtonElement>(':scope > li > [role="menuitem"]:not(:disabled)')) : [];

/** One level of the menu. Submenus open as flyouts (desktop) or through `onEnter` (phone). */
export function AppMenuList({ items, depth, onDone, onEnter, autoFocus }: ListProps) {
  const rt = useRuntime();
  const [openSub, setOpenSub] = useState<string | null>(null);
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => { if (autoFocus) focusables(ref.current)[0]?.focus(); }, [autoFocus]);

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const list = focusables(ref.current);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => { list[(i + list.length) % list.length]?.focus(); };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); e.stopPropagation(); go(at + 1); break;
      case 'ArrowUp': e.preventDefault(); e.stopPropagation(); go(at - 1); break;
      case 'Home': e.preventDefault(); e.stopPropagation(); go(0); break;
      case 'End': e.preventDefault(); e.stopPropagation(); go(list.length - 1); break;
      case 'ArrowRight': {
        const id = list[at]?.dataset.axfMenuItem;
        const item = items.find((i) => i.id === id);
        if (item && (item.items || item.provider)) { e.preventDefault(); e.stopPropagation(); if (onEnter) onEnter(item); else setOpenSub(item.id); }
        break;
      }
      case 'ArrowLeft': if (openSub && !onEnter) { e.preventDefault(); e.stopPropagation(); setOpenSub(null); list[at]?.focus(); } break;
      default: break;
    }
  };

  return (
    <ul className="fx-menu" role="menu" ref={ref} onKeyDown={onKey} data-axf-menu-depth={depth}>
      {items.map((item) => {
        if (item.separator) return <li key={item.id} className="fx-menu__sep" role="separator" />;
        const hasSub = !!item.items || !!item.provider;
        const sub = hasSub && openSub === item.id && !onEnter;
        return (
          <li key={item.id} className={`fx-menu__li ${sub ? 'is-open' : ''}`} onMouseEnter={() => !onEnter && setOpenSub(hasSub ? item.id : null)}>
            <button
              type="button"
              role={item.check !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={item.check}
              aria-haspopup={hasSub ? 'menu' : undefined}
              aria-expanded={hasSub ? sub : undefined}
              className={`fx-menu__item ${item.check ? 'is-checked' : ''}`}
              disabled={item.locked}
              data-axf-menu-item={item.id}
              data-axf-origin={item.origin}
              title={item.locked ? (rt.lockedByHost({ action: item.action, provider: item.provider }) ?? (item.requires ? `Requires ${item.requires}` : 'Not available')) : undefined}
              onClick={(e) => {
                if (hasSub) { e.stopPropagation(); if (onEnter) onEnter(item); else setOpenSub(item.id); return; }
                onDone();
                if (item.action) rt.dispatch(item.action);
              }}
            >
              {item.check !== undefined
                ? <span className="fx-menu__check" aria-hidden="true">{item.check && <Icon name="check" size={14} />}</span>
                : <span className="fx-menu__icon">{item.locked ? <Icon name="lock" size={14} /> : <Icon name={item.icon} size={15} />}</span>}
              <span className="fx-menu__label">{item.label}</span>
              {item.count !== undefined && item.count > 0 && <span className="fx-menu__badge" aria-label={`${item.count} new`}>{item.count > 99 ? '99+' : item.count}</span>}
              {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
              {hasSub && <Icon name="chevron-right" size={14} className="fx-menu__chevron" />}
            </button>
            {sub && (
              <MenuSub role="presentation">
                <SubmenuBody item={item} depth={depth + 1} onDone={onDone} open />
              </MenuSub>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The items of a submenu: the compiled ones, or the live list loaded on open. */
function SubmenuBody({ item, depth, onDone, onEnter, open, autoFocus }: { item: CompiledMenuItem; depth: number; onDone: () => void; onEnter?: (i: CompiledMenuItem) => void; open: boolean; autoFocus?: boolean }) {
  const loaded = useProviderItems(item.provider, open, depth - 1);
  if (item.provider) {
    if (!loaded || loaded.state === 'loading') return <div className="fx-menu__row fx-menu__loading" role="status"><span className="fx-menu__spinner" aria-hidden="true" />Loading…</div>;
    if (loaded.state === 'error') return <div className="fx-menu__row fx-menu__error" role="alert"><Icon name="alert" size={14} />Couldn't load this list</div>;
    if (!loaded.items.length) return <div className="fx-menu__row fx-menu__empty">Nothing here</div>;
    return <AppMenuList items={loaded.items} depth={depth} onDone={onDone} onEnter={onEnter} autoFocus={autoFocus} />;
  }
  return <AppMenuList items={item.items ?? []} depth={depth} onDone={onDone} onEnter={onEnter} autoFocus={autoFocus} />;
}

/**
 * One top-level menu's dropdown. Desktop: the root list with flyouts. Phone: a stack of panels; entering a submenu
 * pushes a panel with a Back row (Escape or Back pops it; Escape at the root closes the menu).
 */
export function AppMenuDropdown({ menu, onDone }: { menu: CompiledMenu; onDone: () => void }) {
  const phone = useIsPhone();
  const [stack, setStack] = useState<CompiledMenuItem[]>([]);
  const enter = useCallback((item: CompiledMenuItem) => setStack((s) => [...s, item]), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  useEffect(() => { if (!phone) setStack([]); }, [phone]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (stack.length) back(); else onDone(); }
    else if (e.key === 'ArrowLeft' && stack.length) { e.preventDefault(); e.stopPropagation(); back(); }
  };
  const top = stack[stack.length - 1];
  return (
    <div className={`fx-dropdown fx-popover ${phone ? 'fx-dropdown--phone' : ''}`} onKeyDown={onKey} data-axf-menu={menu.id} data-axf-menu-origin={menu.origin}>
      {phone && top ? (
        <>
          <button type="button" className="fx-menu__back" onClick={back} aria-label={`Back to ${stack.length > 1 ? stack[stack.length - 2]!.label : menu.label}`}>
            <Icon name="chevron-left" size={14} />
            <span className="fx-menu__label">{top.label}</span>
          </button>
          <SubmenuBody key={stack.map((s) => s.id).join('/')} item={top} depth={stack.length + 1} onDone={onDone} onEnter={enter} open autoFocus />
        </>
      ) : (
        <AppMenuList items={menu.items} depth={1} onDone={onDone} onEnter={phone ? enter : undefined} autoFocus />
      )}
    </div>
  );
}
