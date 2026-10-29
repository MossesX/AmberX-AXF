/**
 * Brand library view (nav → Plugins → Brand library): tabs Logos · Animated logos · Icon packs · Branding packages,
 * one search bar, brand + facet filters, a virtualised grid of tiles (only the rows on screen are drawn; 250 marks
 * scroll smoothly on a phone) and the preview pane for the picked tile.
 *
 * lib-datagrid is a row/column grid (tables); a thumbnail wall is not a table, so the wall is windowed here with
 * the pure `gridWindow` from model.ts. Sizes come from tokens: the tile width is `--axp-brand-library-tile`
 * (a multiple of --fx-space), measured once per resize from a probe element.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrandWatermark, Button, Icon, SelectField, TextField, useRuntime } from '@console/axf/react';
import { loadConfig, loadType, saveConfig } from './api';
import { DEFAULT_CONFIG, FACET_OF, TABS, facetValues, filterItems, gridWindow, tabOf, type Config, type LibAsset, type TabId } from './model';
import { TileArt, type MarkIndex } from './tiles';

/** Mark height inside a tile, per tile size (px of the tile's own scale; the tile itself is token-sized). */
const ART_HEIGHT = { sm: 28, md: 40, lg: 56 } as const;

function useMeasure<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return [ref, box];
}

export interface PreviewProps { asset: LibAsset; marks: MarkIndex; config: Config; onClose: () => void; onApplied: (c: Config) => void }

export function BrandLibrary({ renderPreview }: { renderPreview?: (p: PreviewProps) => ReactNode }) {
  const rt = useRuntime();
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [tab, setTab] = useState<TabId>(DEFAULT_CONFIG.tab);
  const [items, setItems] = useState<LibAsset[] | null>(null);
  const [marks, setMarks] = useState<MarkIndex>(new Map());
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [facet, setFacet] = useState('');
  const [picked, setPicked] = useState<LibAsset | null>(null);
  const [retry, setRetry] = useState(0);

  // settings first (which tab opens, tile size, brand filter), then the marks every tab draws with
  useEffect(() => {
    let live = true;
    loadConfig().then((c) => { if (!live) return; setConfig(c); setTab(c.tab); setBrand(c.brand); }, () => {});
    loadType('logo-mark').then((xs) => live && setMarks(new Map(xs.map((m) => [m.id, m]))), () => {});
    return () => { live = false; };
  }, []);

  const type = tabOf(tab).type;
  useEffect(() => {
    let live = true;
    setItems(null); setError(''); setFacet(''); setPicked(null);
    loadType(type).then((xs) => live && setItems(xs), (e: Error) => live && setError(e.message || 'The brand library is not reachable.'));
    return () => { live = false; };
  }, [type, retry]);

  const facetDef = FACET_OF[type];
  const brands = useMemo(() => facetValues(items ?? [], 'brand'), [items]);
  const facets = useMemo(() => (facetDef ? facetValues(items ?? [], facetDef.key) : []), [items, facetDef]);
  const shown = useMemo(() => filterItems(items ?? [], type, { q, brand, facet }), [items, type, q, brand, facet]);

  const pickTab = (t: TabId) => { setTab(t); void saveConfig({ tab: t }).then(setConfig, () => {}); };
  const clear = () => { setQ(''); setBrand(''); setFacet(''); };
  const copyId = useCallback((a: LibAsset) => {
    void navigator.clipboard?.writeText(a.id).then(() => rt.toast(`Copied ${a.id}.`, 'success', 'Brand library'), () => rt.toast(a.id, 'info', 'Brand library id'));
  }, [rt]);

  return (
    <div className="axp-brand-library">
      <div className="fx-tabs axp-brand-library__tabs" role="tablist" aria-label="Brand library">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className={`fx-tab ${tab === t.id ? 'is-active' : ''}`} aria-selected={tab === t.id} onClick={() => pickTab(t.id)}>
            <Icon name={t.icon} size={14} />{t.label}
          </button>
        ))}
      </div>

      <div className="axp-brand-library__filters">
        <TextField className="axp-brand-library__search" label="Search" value={q} onChange={setQ} placeholder={`Search ${items?.length ?? ''} ${tabOf(tab).noun}s by name, id or tag`} />
        {brands.length > 1 && <SelectField label="Brand" value={brand} onChange={setBrand} empty="Every brand" options={brands.map((b) => ({ value: b, label: b }))} />}
        {facetDef && facets.length > 1 && <SelectField label={facetDef.label} value={facet} onChange={setFacet} empty="Any" options={facets.map((f) => ({ value: f, label: f }))} />}
      </div>

      <p className="axp-brand-library__count" aria-live="polite">
        {items ? `${shown.length} of ${items.length}` : ''}
        {(q || brand || facet) && <Button size="sm" tone="quiet" icon="x" onClick={clear}>Clear filters</Button>}
      </p>

      <div className={`axp-brand-library__body ${picked ? 'has-preview' : ''}`}>
        {error ? (
          <div className="axp-brand-library__empty" role="status"><Icon name="cloud" size={24} /><p>{error}</p><Button icon="refresh" onClick={() => setRetry((n) => n + 1)}>Try again</Button></div>
        ) : !items ? (
          <div className="axp-brand-library__skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: 12 }, (_, i) => <span key={i} className="axp-brand-library__skel" />)}</div>
        ) : shown.length === 0 ? (
          <div className="axp-brand-library__empty" role="status"><BrandWatermark slot="empty-state" /><Icon name="search" size={24} /><p>Nothing matches these filters.</p><Button icon="x" onClick={clear}>Clear filters</Button></div>
        ) : (
          <VirtualGrid items={shown} marks={marks} config={config} picked={picked?.id ?? ''} onPick={setPicked} onCopy={copyId} />
        )}
        {picked && renderPreview?.({ asset: picked, marks, config, onClose: () => setPicked(null), onApplied: setConfig })}
      </div>
    </div>
  );
}

function VirtualGrid({ items, marks, config, picked, onPick, onCopy }: { items: LibAsset[]; marks: MarkIndex; config: Config; picked: string; onPick: (a: LibAsset) => void; onCopy: (a: LibAsset) => void }) {
  const [ref, box] = useMeasure<HTMLDivElement>();
  const probe = useRef<HTMLSpanElement>(null);
  const [cell, setCell] = useState({ tile: 0, gap: 0, row: 1 }) // measured from the token-sized probe below;
  const [scrollTop, setScrollTop] = useState(0);

  // tile + gap come from tokens (CSS); read their pixel size so the window maths matches what the browser draws
  useLayoutEffect(() => {
    const p = probe.current;
    if (!p) return;
    const cs = getComputedStyle(p);
    const tile = p.offsetWidth || 1;
    const gap = parseFloat(cs.marginRight) || 0;
    setCell({ tile, gap, row: (p.offsetHeight || tile) + gap });
  }, [config.tile, config.names, box.width]);

  const w = gridWindow({ count: items.length, width: box.width, tile: cell.tile, gap: cell.gap, scrollTop, height: box.height, rowHeight: cell.row });
  const visible = items.slice(w.start, w.end);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: w.cols, ArrowUp: -w.cols }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    const next = items[Math.max(0, Math.min(items.length - 1, i + move))];
    if (next) { onPick(next); (ref.current?.querySelector(`[data-id="${next.id}"]`) as HTMLElement | null)?.focus(); }
  };

  return (
    <div ref={ref} className={`axp-brand-library__scroller is-${config.tile}`} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)} role="grid" aria-rowcount={w.rows} aria-colcount={w.cols} aria-label="Brand assets">
      <span ref={probe} className="axp-brand-library__tile axp-brand-library__probe" aria-hidden="true"><span className="axp-brand-library__tile-art" />{config.names && <span className="axp-brand-library__tile-name">x</span>}</span>
      <div className="axp-brand-library__canvas" style={{ height: w.total }}>
        <div className="axp-brand-library__rows" style={{ transform: `translateY(${w.first * cell.row}px)`, gridTemplateColumns: `repeat(${w.cols}, ${cell.tile}px)` }}>
          {visible.map((a, k) => {
            const i = w.start + k;
            return (
              <button key={a.id} type="button" data-id={a.id} role="gridcell" className={`axp-brand-library__tile ${picked === a.id ? 'is-active' : ''}`} aria-selected={picked === a.id}
                title={`${a.name} — ${a.id}`} onClick={() => onPick(a)} onKeyDown={(e) => onKey(e, i)}
                onDoubleClick={() => onCopy(a)}>
                <span className="axp-brand-library__tile-art"><TileArt a={a} marks={marks} height={ART_HEIGHT[config.tile]} motion={config.motion} /></span>
                {config.names && <span className="axp-brand-library__tile-name">{a.name}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
