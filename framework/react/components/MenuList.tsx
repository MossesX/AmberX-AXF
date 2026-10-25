import { useState } from 'react';
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
        if (item.separator) return <li key={item.id} className="fx-menu__sep" role="separator" />;
        // a hook of a function the host locks (plugins inside Patches) stays, greyed out with its note
        const hostLock = item.action ? rt.lockedByHost({ action: item.action }) : null;
        const locked = rt.gate(item.requires) === 'disable' || !!hostLock;
        const hasSub = !!item.items?.length;
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
