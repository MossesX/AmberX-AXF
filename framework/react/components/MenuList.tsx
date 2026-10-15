import { useState } from 'react';
import { filterMenu, type MenuItem } from '../../core';
import { useRuntime, useFrameState } from '../FrameProvider';
import { Icon } from './Icon';
import { Kbd } from './Controls';

interface MenuListProps {
  items: MenuItem[];
  onDone: () => void;
  payload?: string;
  showIcons?: boolean;
  showShortcuts?: boolean;
}

/** Shared renderer for dropdown menus and context menus (UAC-aware, nested). */
export function MenuList({ items, onDone, payload, showIcons = true, showShortcuts = true }: MenuListProps) {
  const rt = useRuntime();
  useFrameState();
  const [openSub, setOpenSub] = useState<string | null>(null);
  const visible = filterMenu(items, (r) => rt.gate(r));

  return (
    <ul className="fx-menu" role="menu">
      {visible.map((item) => {
        if (item.separator) return <li key={item.id} className="fx-menu__sep" role="separator" />;
        const locked = rt.gate(item.requires) === 'disable';
        const hasSub = !!item.items?.length;
        return (
          <li
            key={item.id}
            className="fx-menu__li"
            onMouseEnter={() => setOpenSub(hasSub ? item.id : null)}
          >
            <button
              type="button"
              role="menuitem"
              className="fx-menu__item"
              disabled={locked}
              title={locked ? `Requires ${item.requires}` : undefined}
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
              {showShortcuts && item.shortcut && <Kbd>{item.shortcut}</Kbd>}
              {hasSub && <Icon name="chevron-right" size={14} />}
            </button>
            {hasSub && openSub === item.id && (
              <div className="fx-menu__sub fx-popover">
                <MenuList items={item.items!} onDone={onDone} payload={payload} showIcons={showIcons} showShortcuts={showShortcuts} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
