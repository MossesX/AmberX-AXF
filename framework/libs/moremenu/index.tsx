/**
 * ⋯ "More" menu (`ai.amberx.axf.moremenu`, web): the page's secondary actions behind one IconButton, drawn as a
 * framework popover menu. Closes on pick, outside tap, Escape, scroll or resize. Harvested Nov 7 2026 from the
 * byte-identical copies ten console plugins carried (`web/more.tsx` ×4, `web/MoreMenu.tsx` ×6); the two looks they had
 * are the `look` prop (`./core.ts`). Framework controls and `fx-*` classes only.
 *
 *   import { MoreMenu } from '<app>/axf/libs/moremenu';
 *   <MoreMenu label="More for this entry" items={[{ label: 'Export', icon: 'download', onPick: () => … }, busy && null]} />
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './moremenu.css';
import { Icon, IconButton } from '../../react';
import { usePortalRoot } from '../../react/components/InterfaceScope';
import type { AxfWebLibrary } from '../../react/library';
import { MORE_MENU_ID, itemKey, pick, placeMenu, placementStyle, popoverClass, visibleItems, type MoreItem, type MoreMenuLook, type Placement } from './core';

export * from './core';

export interface MoreMenuProps {
  items: readonly (MoreItem | false | null | undefined)[];
  /** The button's accessible label (and the menu's). */
  label?: string;
  /** Icon on the button (default `more`). */
  icon?: string;
  /** `ctx` (default) or `dropdown`, see core.ts. */
  look?: MoreMenuLook;
  /** Extra class on the wrapper span (a plugin's own layout hook). */
  className?: string;
}

export function MoreMenu({ items, label = 'More', icon = 'more', look = 'ctx', className }: MoreMenuProps) {
  const root = usePortalRoot();
  const [at, setAt] = useState<Placement | null>(null);
  const btn = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = visibleItems(items);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const down = (e: Event) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const scroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    globalThis.addEventListener('scroll', scroll, true);
    globalThis.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key); globalThis.removeEventListener('scroll', scroll, true); globalThis.removeEventListener('resize', close); };
  }, [at]);
  if (!list.length) return null;
  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    setAt(at ? null : placeMenu(r, globalThis.innerWidth, look));
  };
  return (
    <span ref={btn} className={['axf-moremenu__btn', className].filter(Boolean).join(' ')}>
      <IconButton icon={icon} label={label} aria-haspopup="menu" aria-expanded={!!at} onClick={open} />
      {at && createPortal(
        <div ref={pop} className={popoverClass(look)} role="menu" aria-label={label} style={placementStyle(at)}>
          <ul className="fx-menu">
            {list.map((it) => (
              <li key={itemKey(it)} className="fx-menu__li">
                <button type="button" role="menuitem" className={it.danger ? 'fx-menu__item is-danger' : 'fx-menu__item'} disabled={it.disabled} title={it.title} onClick={() => { setAt(null); pick(it); }}>
                  <span className="fx-menu__icon">{it.icon ? <Icon name={it.icon} size={14} /> : null}</span>
                  <span className="fx-menu__label">{it.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>,
        root,
      )}
    </span>
  );
}

/** Installable library record (no runtime registration needed: the component is imported where it is used). */
export const moreMenuLibrary: AxfWebLibrary = { id: MORE_MENU_ID, label: 'More menu', version: '1.0.0' };
export const library = moreMenuLibrary;
