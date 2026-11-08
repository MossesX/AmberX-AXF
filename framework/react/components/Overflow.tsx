/*
 * The ⋯ overflow control (terminal-header-responsive, Nov 8 2026, Brett: "When space runs out, move items into a
 * three-dots overflow menu, exactly like the top banner's overflow does. Reuse the same framework overflow control").
 * One control for every bar that runs out of room: the main banner, banner strips, the Terminal's command toolbar and
 * its context-chain bar, and any later bar. The bar measures its own width (ResizeObserver on the bar and on every item,
 * never the viewport), the rule in core/engines/bannerwidgets.ts (`overflowWidgets`) decides what leaves (lowest
 * priority first, the last on the bar first within a priority, pinned items never), and `OverflowMore` draws the ⋯
 * button with the items that left, still live, nothing lost. Theme tokens only (axf.css, `fx-overflow`).
 *
 * Use:
 *   const out = useOverflow(barRef, items, true);            // items: { key, priority, overflow }
 *   {items.filter((i) => !out.includes(i.key)).map(draw)}    // each drawn item carries data-axf-overflow-item={key}
 *   <OverflowMore keys={out} draw={draw} label="more commands" />
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { overflowWidgets, type OverflowItem } from '../../core/engines/bannerwidgets';
import { IconButton } from './Controls';

export type OverflowEntry = Omit<OverflowItem, 'width'>;

export interface OverflowMeasure {
  /** attribute every item on the bar carries, its value the item's key (default data-axf-overflow-item) */
  attr?: string;
  /** width an item takes; default its offsetWidth, or the min-width of a flexible piece inside it ([data-axf-overflow-flex]) */
  widthOf?: (node: HTMLElement) => number;
  /** room the items have; default the bar's inner width (padding off) */
  available?: (bar: HTMLElement) => number;
  /** gap between items; default the bar's column gap */
  gap?: (bar: HTMLElement) => number;
  /** room the ⋯ button takes; default the bar's height (a square button) */
  moreWidth?: (bar: HTMLElement) => number;
}

const flexWidth = (n: HTMLElement) => {
  const flex = n.matches('[data-axf-overflow-flex]') ? n : n.querySelector<HTMLElement>('[data-axf-overflow-flex]');
  const min = flex ? parseFloat(getComputedStyle(flex).minWidth) : NaN;
  return flex && Number.isFinite(min) && min > 0 ? min + (n === flex ? 0 : n.offsetWidth - flex.offsetWidth) : n.offsetWidth;
};

/**
 * Which items don't fit on a bar right now. Widths are kept from when each one was last drawn, so an item in the ⋯ menu
 * comes back as soon as the bar has room for it, and the answer doesn't depend on what is drawn this moment.
 */
export function useOverflow(root: RefObject<HTMLElement | null>, items: readonly OverflowEntry[], on: boolean, m: OverflowMeasure = {}): string[] {
  const widths = useRef(new Map<string, number>());
  const [out, setOut] = useState<string[]>([]);
  const attr = m.attr ?? 'data-axf-overflow-item';
  const rank = items.map((i) => `${i.key}=${i.priority}${i.overflow ? '' : '!'}`).join('|');
  const opts = useRef(m); opts.current = m;
  const list = useRef(items); list.current = items;
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !on || typeof ResizeObserver === 'undefined') { setOut((p) => (p.length ? [] : p)); return; }
    const nodes = () => [...el.querySelectorAll<HTMLElement>(`[${attr}]`)];
    const measure = () => {
      const o = opts.current;
      for (const n of nodes()) widths.current.set(n.getAttribute(attr)!, (o.widthOf ?? flexWidth)(n));
      const cs = getComputedStyle(el);
      const gap = o.gap ? o.gap(el) : parseFloat(cs.columnGap) || 0;
      const available = o.available ? o.available(el) : el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const now = list.current.map((i) => ({ ...i, width: widths.current.get(i.key) ?? 0 })).filter((i) => i.width > 0);
      const next = overflowWidgets(now, available, o.moreWidth ? o.moreWidth(el) : el.clientHeight, gap);
      setOut((p) => (p.join('|') === next.join('|') ? p : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const n of nodes()) ro.observe(n);
    measure();
    return () => ro.disconnect();
  }, [root, rank, on, attr, out.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return on ? out : [];
}

export interface OverflowMoreProps {
  keys: string[];
  draw: (key: string) => ReactNode;
  /** what the items are, for the button's label: "3 more <label>" */
  label?: string;
  /** extra classes on the button's wrapper and on the menu (a host's own look, e.g. the banner's) */
  className?: string;
  menuClassName?: string;
  itemClassName?: string;
  /** extra attributes on the menu (context-menu target, search opt-out …) */
  menuAttrs?: Record<string, string>;
  /** attribute naming each item in the menu (default data-axf-overflow-more) */
  itemAttr?: string;
}

/** The ⋯ button and its menu: the items that didn't fit, still live, nothing lost. */
export function OverflowMore({ keys, draw, label = 'items', className = '', menuClassName = '', itemClassName = '', menuAttrs, itemAttr = 'data-axf-overflow-more' }: OverflowMoreProps) {
  const btn = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!pos) return;
    const down = (e: Event) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [pos]);
  useEffect(() => { if (!keys.length) setPos(null); }, [keys.length]);
  if (!keys.length) return null;
  const toggle = () => {
    if (pos) { setPos(null); return; }
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: r.bottom, right: Math.max(0, document.documentElement.clientWidth - r.right) });
  };
  const n = keys.length;
  return (
    <span ref={btn} className={`fx-overflow__btn ${className}`.trim()} data-axf-overflow-btn="">
      <IconButton icon="more" label={`${n} more ${label}`} title={`${n} more`} aria-expanded={!!pos} aria-haspopup="true" onClick={toggle} />
      {pos && createPortal(
        <div ref={box} className={`fx-popover fx-overflow ${menuClassName}`.trim()} style={pos} data-fx-overlay="" {...menuAttrs}>
          {keys.map((k) => <div key={k} className={`fx-overflow__item ${itemClassName}`.trim()} {...{ [itemAttr]: k }}>{draw(k)}</div>)}
        </div>,
        document.body,
      )}
    </span>
  );
}
