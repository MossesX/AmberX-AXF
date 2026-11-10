/**
 * TabGroup — every tab row is a tab-group asset (Brett, Nov 4 2026, build tab-group-assets: "all tab groups are
 * supposed to be assets. With a settings interface, that's also an asset.").
 *
 * One component for every row of tabs in every app on the framework: page tabs, section switchers, settings tab bars,
 * list / view switchers. It draws from the tab-group asset in force for the row (the app's active tab-group, or the
 * asset this row picked for itself: setting `axf.chrome.tab-group.<id>.asset`) with the row's own overrides written
 * over it (`axf.chrome.tab-group.<id>`, chrome-settings@1), and it carries the chrome context menu: right-click or
 * long-press the row → Settings… / Change tab style… / Move (components/ChromeContext.tsx).
 *
 * What the asset decides (tab-group@1): style, position (top / bottom / left / right), display (icons + text / text /
 * icons), overflow (scroll / wrap / More menu / dropdown), size, divider, sticky, collapsible (fold to the active tab),
 * closable + reorderable (only where the host passes onClose / onReorder), count badges, remember the last tab.
 * The host decides the tabs, the value and what happens on change. Nothing here is styled by a literal: every colour,
 * size and radius comes from axf.css tokens through the engine's data attributes and vars.
 *
 *   <TabGroup id="ui-review.sections" label="Sections" value={kind} onChange={setKind}
 *             tabs={[{ value: '', label: 'All', badge: 12 }, { value: 'app', label: 'Whole apps', icon: 'box', badge: 3 }]} />
 *
 * With `children`, the row and the panel are laid out together (`.fx-tabframe`), so left / right positions work.
 * `id` is the row's settings id: stable, unique in the app (`<plugin>.<row>`), and what check-chrome-assets.mjs asks for.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { CHROME_INSTANCE_ASSET_KEY, CHROME_INSTANCE_KEY, TAB_GROUP_FOLD_KEY, TAB_GROUP_LAST_KEY, chromeInstanceData, normalizeTabGroup, tabGroupStyle, type AxfRuntime, type TabGroupData } from '../../core';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Icon } from './Icon';

export interface TabDef<T extends string = string> {
  value: T;
  label: string;
  icon?: string;
  /** a count (or short text) shown as a badge; hidden at 0 / empty, and when the asset turns badges off */
  badge?: number | string;
  /** tooltip; icons-only rows use the label */
  title?: string;
  disabled?: boolean;
  /** false keeps the close button off this tab even when the row is closable */
  closable?: boolean;
}

export interface TabGroupProps<T extends string = string> {
  /** the row's settings id (stable, unique in the app) */
  id: string;
  /** accessible name of the row */
  label: string;
  value: T;
  onChange: (value: T) => void;
  tabs: TabDef<T>[];
  className?: string;
  /** the host lets tabs close (shown only when the asset says closable) */
  onClose?: (value: T) => void;
  /** the host lets tabs be dragged into another order (shown only when the asset says reorderable) */
  onReorder?: (values: T[]) => void;
  /** something at the end of the row (a button, a count) */
  extra?: ReactNode;
  /** the panel: laid out with the row so left / right positions work */
  children?: ReactNode;
  /** a tab-group asset id this row always uses (a host's fixed choice); the row's own pick still wins */
  asset?: string;
  /** small text (window tab bars, dense tools) */
  size?: 'sm';
}

/** Re-render when one of these settings keys changes. */
function useSettingsKeys(rt: AxfRuntime, keys: string[]): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const offs = keys.map((k) => rt.settings.onChange(k, () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, keys.join('|')]);
  return tick;
}

/** The tab-group data a row renders with: its own asset pick (or the host's, or the app's) + its own overrides. */
export function tabGroupDataFor(rt: AxfRuntime, id: string, hostAsset?: string): Required<TabGroupData> {
  const pick = rt.settings.get(CHROME_INSTANCE_ASSET_KEY('tab-group', id));
  const pickId = typeof pick === 'string' && pick ? pick : hostAsset;
  const base = (pickId && rt.registry.get('tab-group', pickId)?.data) || rt.assetOrNull('tab-group')?.data || null;
  return normalizeTabGroup(chromeInstanceData('tab-group', base as Partial<TabGroupData> | null, rt.settings.get(CHROME_INSTANCE_KEY('tab-group', id))));
}

/** The row's effective tab-group data, live (re-renders on its settings and on any asset swap). */
export function useTabGroupData(id: string, hostAsset?: string): Required<TabGroupData> {
  const rt = useRuntime();
  useAxfState();
  useSettingsKeys(rt, [CHROME_INSTANCE_KEY('tab-group', id), CHROME_INSTANCE_ASSET_KEY('tab-group', id)]);
  return tabGroupDataFor(rt, id, hostAsset);
}

const MORE_ROOM = 44; // px of row kept for the More button while measuring (layout only: the button itself is token-sized)

export function TabGroup<T extends string = string>({ id, label, value, onChange, tabs, className, onClose, onReorder, extra, children, asset, size }: TabGroupProps<T>) {
  const rt = useRuntime();
  const data = useTabGroupData(id, asset);
  useSettingsKeys(rt, [TAB_GROUP_FOLD_KEY(id)]);
  const hidden = rt.slotHidden('tab-group');
  const out = tabGroupStyle(data, hidden);
  const rowRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [visible, setVisible] = useState<number>(Infinity);
  const widths = useRef<number[]>([]);
  const [drag, setDrag] = useState<{ from: number; over: number | null; after: boolean } | null>(null);

  // remember the last tab (per device): reopen on it, keep it as it changes
  const lastKey = TAB_GROUP_LAST_KEY(id);
  useEffect(() => {
    if (!data.rememberLast) return;
    const saved = rt.settings.get(lastKey);
    if (typeof saved === 'string' && saved !== value && tabs.some((t) => t.value === saved && !t.disabled)) onChange(saved as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.rememberLast, id]);
  // onChange fires on every tap, the active tab's too: a host may treat a re-tap as "back up" (Notes → Lists)
  const pick = useCallback((v: T) => {
    onChange(v);
    if (data.rememberLast) rt.settings.set(lastKey, v);
    setMenu(false);
  }, [value, onChange, data.rememberLast, rt, lastKey]);

  // overflow 'more': measure once with every tab shown, then keep what fits; the active tab is always on the row
  const more = data.overflow === 'more' && data.position !== 'left' && data.position !== 'right';
  useLayoutEffect(() => {
    if (!more) { setVisible(Infinity); return; }
    const el = rowRef.current;
    if (!el) return;
    const measure = () => {
      const btns = Array.from(el.querySelectorAll<HTMLElement>(':scope > .fx-tab'));
      if (btns.length === tabs.length && btns.every((b) => b.offsetWidth > 0)) widths.current = btns.map((b) => b.offsetWidth);
      const w = widths.current;
      if (w.length !== tabs.length) { setVisible(Infinity); return; }
      const room = el.clientWidth - (extra ? MORE_ROOM * 2 : MORE_ROOM);
      let used = 0, n = 0;
      for (const x of w) { if (used + x > room) break; used += x; n++; }
      setVisible(n >= tabs.length ? Infinity : Math.max(1, n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [more, tabs.map((t) => `${t.value}:${t.label}:${t.badge ?? ''}`).join('|'), data.display, data.density]);

  const folded = data.collapsible && rt.settings.get(TAB_GROUP_FOLD_KEY(id)) === true;
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.value === value));
  // which tabs sit on the row and which go under More (the active one swaps in for the last visible)
  const { shown, overflowed } = useMemo(() => {
    if (!more || !Number.isFinite(visible) || visible >= tabs.length) return { shown: tabs.map((_, i) => i), overflowed: [] as number[] };
    const idx = tabs.map((_, i) => i);
    let shown = idx.slice(0, visible);
    if (!shown.includes(activeIndex)) shown = [...shown.slice(0, -1), activeIndex];
    return { shown, overflowed: idx.filter((i) => !shown.includes(i)) };
  }, [more, visible, tabs, activeIndex]);

  const vars = out.vars as Record<string, string>;
  const style = Object.fromEntries(Object.entries(vars)) as CSSProperties;
  const attrs = out.attrs;
  const cls = ['fx-tabs', 'fx-tabs--group', size === 'sm' ? 'fx-tabs--sm' : '', folded ? 'is-folded' : '', className ?? ''].filter(Boolean).join(' ');
  const vertical = data.position === 'left' || data.position === 'right';
  const closable = data.closable && !!onClose;
  const reorderable = data.reorderable && !!onReorder;

  const dragProps = (i: number) => (!reorderable ? {} : {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(tabs[i]!.value)); setDrag({ from: i, over: null, after: false }); },
    onDragOver: (e: DragEvent) => { if (!drag) return; e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const after = vertical ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2; setDrag({ ...drag, over: i, after }); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (!drag) return;
      const order = tabs.map((t) => t.value);
      const [moved] = order.splice(drag.from, 1);
      let at = i + (drag.after ? 1 : 0);
      if (drag.from < at) at--;
      order.splice(at, 0, moved!);
      setDrag(null);
      if (order.some((v, k) => v !== tabs[k]!.value)) onReorder!(order);
    },
    onDragEnd: () => setDrag(null),
  });

  const tabEl = (i: number) => {
    const t = tabs[i]!;
    const active = t.value === value;
    const badge = t.badge !== undefined && t.badge !== 0 && t.badge !== '' ? <span className="fx-tab__badge">{t.badge}</span> : null;
    const dropCls = drag && drag.over === i && drag.from !== i ? (drag.after ? ' is-drop-after' : ' is-drop-before') : '';
    return (
      <button key={t.value} type="button" role="tab" aria-selected={active} aria-controls={undefined} disabled={t.disabled}
        className={`fx-tab${active ? ' is-active' : ''}${drag?.from === i ? ' is-dragging' : ''}${dropCls}`}
        title={t.title ?? (data.display === 'icons' ? t.label : undefined)} data-axf-tab={t.value} onClick={() => pick(t.value)} {...dragProps(i)}>
        {t.icon && <Icon name={t.icon} size={size === 'sm' ? 12 : 14} />}
        <span className="fx-tab__text">{t.label}</span>
        {badge}
        {closable && t.closable !== false && (
          <span role="button" tabIndex={0} className="fx-tab__close" aria-label={`Close ${t.label}`} onClick={(e) => { e.stopPropagation(); onClose!(t.value); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClose!(t.value); } }}>
            <Icon name="x" size={11} />
          </span>
        )}
      </button>
    );
  };

  const list = (items: number[], onDone: () => void) => (
    <ul className="fx-menu fx-tabs__menu fx-popover" role="menu" aria-label={label}>
      {items.map((i) => { const t = tabs[i]!; return (
        <li key={t.value} role="none" className="fx-menu__li">
          <button type="button" role="menuitemradio" aria-checked={t.value === value} disabled={t.disabled} className={`fx-menu__item${t.value === value ? ' is-checked' : ''}`} onClick={() => { pick(t.value); onDone(); }}>
            {t.icon && <Icon name={t.icon} size={14} />}<span className="fx-menu__label">{t.label}</span>{t.badge !== undefined && t.badge !== 0 && t.badge !== '' && <span className="fx-tab__badge">{t.badge}</span>}
          </button>
        </li>
      ); })}
    </ul>
  );

  // close the More / dropdown list on an outside press or Escape
  useEffect(() => {
    if (!menu) return;
    const away = (e: Event) => { if (!(e.target as Element).closest?.('.fx-tabs__menu, .fx-tabs__more, .fx-tabs__pick')) setMenu(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key); };
  }, [menu]);

  let row: ReactNode;
  if (data.overflow === 'dropdown') {
    const cur = tabs[activeIndex];
    row = (
      <div ref={rowRef} className={`${cls} fx-tabs--dropdown`} role="tablist" aria-label={label} data-axf-tab-group={id} data-fx-ctx-target="tab-group" data-fx-ctx-payload={id} style={style} {...attrs}>
        <button type="button" className="fx-tabs__pick" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {cur?.icon && data.display !== 'text' && <Icon name={cur.icon} size={14} />}
          {data.display !== 'icons' && <span className="fx-tab__text">{cur?.label ?? label}</span>}
          {cur?.badge !== undefined && cur.badge !== 0 && cur.badge !== '' && data.badges && <span className="fx-tab__badge">{cur.badge}</span>}
          <Icon name="chevron-down" size={12} />
        </button>
        {extra}
        {menu && list(tabs.map((_, i) => i), () => setMenu(false))}
      </div>
    );
  } else {
    row = (
      <div ref={rowRef} className={cls} role="tablist" aria-label={label} aria-orientation={vertical ? 'vertical' : 'horizontal'} data-axf-tab-group={id} data-fx-ctx-target="tab-group" data-fx-ctx-payload={id} style={style} {...attrs}>
        {shown.map(tabEl)}
        {overflowed.length > 0 && (
          <button type="button" className="fx-tab fx-tabs__more" aria-haspopup="menu" aria-expanded={menu} aria-label={`${overflowed.length} more`} title={`${overflowed.length} more`} onClick={() => setMenu((m) => !m)}>
            <Icon name="more" size={14} /><span className="fx-tab__text">More</span>
            {overflowed.some((i) => tabs[i]!.value === value) && <span className="fx-tab__badge">•</span>}
          </button>
        )}
        {data.collapsible && (
          <button type="button" className="fx-tab fx-tabs__fold" aria-pressed={folded} aria-label={folded ? 'Show every tab' : 'Fold to the active tab'} title={folded ? 'Show every tab' : 'Fold to the active tab'} onClick={() => rt.settings.set(TAB_GROUP_FOLD_KEY(id), !folded)}>
            <Icon name={folded ? 'chevron-down' : 'chevron-up'} size={12} />
          </button>
        )}
        {extra}
        {menu && overflowed.length > 0 && list(overflowed, () => setMenu(false))}
      </div>
    );
  }

  if (children === undefined) return row;
  return (
    <div className="fx-tabframe" data-fx-tabs-position={data.position}>
      {row}
      <div className="fx-tabframe__panel" role="tabpanel">{children}</div>
    </div>
  );
}
