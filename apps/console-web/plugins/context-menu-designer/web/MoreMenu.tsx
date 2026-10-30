/**
 * ⋯ menu (compact pages, Oct 30 2026): the page's secondary actions behind one IconButton, drawn as a framework
 * popover menu (fx-ctx + fx-menu, so it follows the context-menu look). Closes on pick, outside tap, Escape or scroll.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconButton, usePortalRoot } from '@console/axf/react';

export interface MoreItem { id: string; label: string; icon?: string; disabled?: boolean; onSelect: () => void }

export function MoreMenu({ items, label = 'More actions', className }: { items: (MoreItem | false | null | undefined)[]; label?: string; className?: string }) {
  const root = usePortalRoot();
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = items.filter(Boolean) as MoreItem[];
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const scroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    globalThis.addEventListener('scroll', scroll, true);
    globalThis.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key); globalThis.removeEventListener('scroll', scroll, true); globalThis.removeEventListener('resize', close); };
  }, [at]);
  if (!list.length) return null;
  return (
    <span ref={btn} className={className}>
      <IconButton icon="more" label={label} aria-haspopup="menu" aria-expanded={!!at} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt(at ? null : { top: r.bottom, right: Math.max(0, globalThis.innerWidth - r.right) }); }} />
      {at && createPortal(
        <div ref={pop} className="fx-ctx fx-popover" role="menu" aria-label={label} style={{ top: at.top, right: at.right, left: 'auto' }}>
          <ul className="fx-menu">
            {list.map((i) => (
              <li key={i.id} className="fx-menu__li">
                <button type="button" role="menuitem" className="fx-menu__item" disabled={i.disabled} onClick={() => { setAt(null); i.onSelect(); }}>
                  <span className="fx-menu__icon">{i.icon ? <Icon name={i.icon} size={14} /> : null}</span>
                  <span className="fx-menu__label">{i.label}</span>
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
