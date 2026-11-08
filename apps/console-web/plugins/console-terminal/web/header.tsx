/*
 * Terminal window header bars on the framework's ⋯ overflow control (terminal-header-responsive, Nov 8 2026): the bar
 * measures its own width (ResizeObserver on the bar and its items, never the viewport) and the items that don't fit go
 * into the ⋯ menu, lowest priority first, pinned ones never (header-core.ts). Same control as the top banner's ⋯.
 * Each item draws itself twice: on the bar, and as a row in the menu (icon + its name, still live).
 */
import { useRef, type ReactNode, type RefObject } from 'react';
import { OverflowMore, useOverflow } from '@console/axf/react';
import type { Settings } from './api';
import { HEADER_ITEMS, forcedOut, headerStyle, normPins, overflowEntries, type HeaderBar, type HeaderStyle } from './header-core';

export interface BarItem { key: string; bar: ReactNode; menu?: ReactNode }

/** The room every item but ours takes: spacers, separators, anything without the item attribute (the ⋯ button excluded). */
const others = (el: HTMLElement, gap: number) => [...el.children].reduce((sum, c) => {
  const n = c as HTMLElement;
  if (n.hasAttribute('data-axf-overflow-item') || n.hasAttribute('data-axf-overflow-btn')) return sum;
  return sum + (n.classList.contains('fx-grow') ? 0 : n.offsetWidth) + gap;
}, 0);

export function useHeaderBar(bar: HeaderBar, items: readonly BarItem[], settings: Settings | null): { ref: RefObject<HTMLDivElement>; style: HeaderStyle; draw: (k: string) => ReactNode; more: ReactNode; items: BarItem[] } {
  const ref = useRef<HTMLDivElement>(null);
  const pins = normPins(settings?.headerPins);
  const style = headerStyle(settings?.headerStyle);
  const keys = items.map((i) => i.key);
  const entries = overflowEntries(bar, keys, pins);
  const measured = useOverflow(ref, entries, style !== 'menu', {
    available: (el) => { const cs = getComputedStyle(el); const gap = parseFloat(cs.columnGap) || 0; return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - others(el, gap); },
  });
  const forced = forcedOut(style, keys, pins);
  const out = style === 'menu' ? forced : measured;
  const byKey = new Map(items.map((i) => [i.key, i]));
  const label = bar === 'chain' ? 'context chain controls' : 'terminal commands';
  const drawMenu = (k: string) => byKey.get(k)?.menu ?? byKey.get(k)?.bar ?? null;
  return {
    ref, style,
    draw: (k) => { const it = byKey.get(k); return it ? <span key={k} className="axp-wt__hitem" data-axf-overflow-item={k} data-axp-pinned={pins.includes(k) ? '' : undefined}>{it.bar}</span> : null; },
    items: items.filter((i) => !out.includes(i.key)),
    more: <OverflowMore keys={out} draw={drawMenu} label={label} menuClassName="axp-wt__more" menuAttrs={{ 'data-axp-header-more': bar }} />,
  };
}

/** A menu row for an icon button that went into ⋯: icon + name, same action. */
export function MenuRow({ icon, label, onClick, disabled, active }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" role="menuitem" className={`fx-menu__item axp-wt__morerow ${active ? 'is-active' : ''}`} aria-pressed={active === undefined ? undefined : active} disabled={disabled} onClick={onClick}>
      {icon}<span className="fx-grow">{label}</span>
    </button>
  );
}

export const headerLabel = (id: string) => HEADER_ITEMS.find((i) => i.id === id)?.label ?? id;
