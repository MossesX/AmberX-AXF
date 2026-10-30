/*
 * The ⋯ menu for compact rows and page heads (screens-compact, Oct 30 2026): an IconButton "more" that opens a small
 * framework menu (fx-popover fx-dropdown + fx-menu__item) under itself, so a row keeps 2–3 primary buttons and the rest
 * stay one tap away. Closes on pick, outside tap or Escape. This plugin's own copy (plugins never share code by folder).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconButton } from '@console/axf/react';

export interface MoreItem { label: string; icon?: string; onPick: () => void; disabled?: boolean; title?: string }

export function MoreMenu({ items, label = 'More', icon = 'more' }: { items: (MoreItem | false | null | undefined)[]; label?: string; icon?: string }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = items.filter(Boolean) as MoreItem[];
  useEffect(() => {
    if (!at) return;
    const off = (e: Event) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setAt(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null); };
    document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key); };
  }, [at]);
  if (!list.length) return null;
  const open = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(260, globalThis.innerWidth - 16);
    setAt(at ? null : { top: r.bottom, left: Math.max(8, Math.min(r.right - w, globalThis.innerWidth - w - 8)) });
  };
  return (
    <>
      <span ref={btn} className="axp-feature-matrix__morebtn"><IconButton icon={icon} label={label} aria-haspopup="menu" aria-expanded={!!at} onClick={open} /></span>
      {at && createPortal(
        <div ref={pop} className="fx-popover fx-dropdown axp-feature-matrix__more" style={{ top: at.top, left: at.left }} role="menu" aria-label={label}>
          <ul className="fx-menu">
            {list.map((it) => (
              <li key={it.label} className="fx-menu__li">
                <button type="button" role="menuitem" className="fx-menu__item" disabled={it.disabled} title={it.title} onClick={() => { setAt(null); it.onPick(); }}>
                  <span className="fx-menu__icon">{it.icon && <Icon name={it.icon} size={14} />}</span><span className="fx-menu__label">{it.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
