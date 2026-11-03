/*
 * A tab's two panes (headless-tabs, Nov 3 2026): pane A = the live session, pane B = its context chain. Side by side
 * or stacked (tab menu, remembered per tab; default in Settings → Terminal → Split). On a narrow window (a phone) the
 * panes become one swipeable row (scroll snap), with two chips to jump between them. Theme tokens only.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type Split = 'side' | 'stacked' | 'none';
const P = 'axp-split';

export function SplitView({ split, active, a, b, labels = ['Session', 'Context chain'] }: { split: Split; active: boolean; a: ReactNode; b: ReactNode | null; labels?: [string, string] }) {
  const root = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null); // as wide as the narrow breakpoint (CSS, from tokens): narrower = swipe
  const [narrow, setNarrow] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const el = root.current; if (!el) return;
    const ro = new ResizeObserver(() => { const w = probe.current?.offsetWidth ?? 0; setNarrow(w > 0 && el.clientWidth > 0 && el.clientWidth < w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const on = split !== 'none' && b !== null;
  const go = (i: number) => { const r = row.current; if (r) r.scrollTo({ left: i * r.clientWidth, behavior: 'smooth' }); setPage(i); };
  return (
    <div ref={root} className={`${P} ${on ? `${P}--${narrow ? 'swipe' : split}` : ''}`} hidden={!active}>
      <span ref={probe} className={`${P}__probe`} aria-hidden />
      {on && narrow && (
        <div className={`${P}__pager`} role="tablist" aria-label="Panes">
          {labels.map((l, i) => <button key={l} type="button" role="tab" aria-selected={page === i} className={`fx-chip ${page === i ? 'is-on' : ''}`} onClick={() => go(i)}>{l}</button>)}
        </div>
      )}
      <div ref={row} className={`${P}__row`} onScroll={(e) => { if (!narrow) return; const r = e.currentTarget; setPage(Math.round(r.scrollLeft / Math.max(1, r.clientWidth))); }}>
        <div className={`${P}__pane ${P}__pane--a`}>{a}</div>
        {on && <div className={`${P}__pane ${P}__pane--b`}>{b}</div>}
      </div>
    </div>
  );
}
