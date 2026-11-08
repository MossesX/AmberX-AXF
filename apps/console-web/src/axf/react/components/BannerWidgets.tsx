/*
 * Banner widgets (Brett, Nov 4 2026: "right-click the banner and select which widgets appear in it … I need settings for
 * them all so I can change how big they are, how much room they take up."). The picker lists every widget the banner
 * knows about (rt.bannerWidgets, one registry): show or hide, drag or arrow to reorder, a live preview, and for each one
 * its size, what it shows, its width, hide when empty, the ⋯ menu and its region. Every change is saved at once and
 * drawn at once. Also here: the ⋯ menu that takes the widgets that don't fit. Rules: core/engines/bannerwidgets.ts.
 * Theme tokens only.
 */
import { useEffect, useState, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { BANNER_SIDES, type PlacedAttachment } from '../../core/engines/banner';
import { BANNER_WIDGET_MAX_WIDTH, BANNER_WIDGET_PRIORITY, BANNER_WIDGET_SHOWS, BANNER_WIDGET_SIZES, bannerWidgetCapCss, type BannerWidgetShow, type BannerWidgetSize, type BannerWidthUnit } from '../../core/engines/bannerwidgets';
import { BANNER_WIDGETS_DIALOG, type AxfRuntime, type BannerWidget } from '../../core/runtime';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Banner } from './Banner';
import { bannerLabel, isBannerHidden, setBannerHide, useBannerHideTick, useKnownBanners } from './BannerSettings';
import { Button, IconButton } from './Controls';
import { Checkbox, Note, SelectField, Switch, TextField } from './Forms';
import { Icon } from './Icon';
import { OverflowMore, useOverflow } from './Overflow';
import type { DialogMap } from './Overlays';

const SIZE_LABEL: Record<BannerWidgetSize, string> = { icon: 'Icon only', compact: 'Compact', normal: 'Normal', wide: 'Wide' };
const SHOW_LABEL: Record<BannerWidgetShow, string> = { auto: 'Its own mix', both: 'Icon and text', icon: 'Icon only', text: 'Text only', number: 'Number only' };
const SIDE_LABEL: Record<string, string> = { left: 'Left', center: 'Centre', right: 'Right' };

/** What the banner item around a widget carries: its size, what it shows, its width cap. */
export function bannerItemAttrs(rt: AxfRuntime, key: string): Record<string, unknown> {
  const v = rt.bannerWidgetView(key);
  const max = bannerWidgetCapCss(v.cap);
  return { 'data-fx-wsize': v.size, 'data-fx-wshow': v.show === 'auto' ? undefined : v.show, ...(max ? { style: { maxWidth: max } } : {}) };
}

/**
 * Which widgets don't fit on a bar right now: the framework's ⋯ overflow control (Overflow.tsx), fed the widgets'
 * priorities and ⋯-menu switches. The search bar gives way first (down to its minimum), so only that much counts as
 * taken; the logo takes its room off the top.
 */
export function useBannerOverflow(root: RefObject<HTMLElement | null>, items: readonly Pick<PlacedAttachment, 'key'>[], on: boolean): string[] {
  const rt = useRuntime();
  const entries = items.map((p) => { const v = rt.bannerWidgetView(p.key); return { key: p.key, priority: v.priority, overflow: v.overflow }; });
  return useOverflow(root, entries, on, {
    attr: 'data-axf-banner-item',
    widthOf: (n) => { const search = n.querySelector<HTMLElement>('.fx-widget-search'); return search ? parseFloat(getComputedStyle(search).minWidth) || n.offsetWidth : n.offsetWidth; },
    gap: (el) => { const side = el.querySelector<HTMLElement>('.fx-banner__side'); return side ? parseFloat(getComputedStyle(side).columnGap) || 0 : 0; },
    available: (el) => {
      const cs = getComputedStyle(el);
      const side = el.querySelector<HTMLElement>('.fx-banner__side');
      const gap = side ? parseFloat(getComputedStyle(side).columnGap) || 0 : 0;
      const logo = el.querySelector<HTMLElement>('.fx-banner__logo')?.offsetWidth ?? 0;
      return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (logo ? logo + gap : 0);
    },
  });
}

/** The banner's ⋯ button and its menu: the framework's OverflowMore in the banner's look. */
export function BannerMore({ keys, draw }: { keys: string[]; draw: (key: string) => ReactNode }) {
  return <OverflowMore keys={keys} draw={draw} label={`banner widget${keys.length === 1 ? '' : 's'}`} className="fx-banner__item fx-banner__more-btn"
    menuClassName="fx-banner__more" itemClassName="fx-banner__more-item" itemAttr="data-axf-banner-more" menuAttrs={{ 'data-fx-ctx-target': 'banner', 'data-axf-search': 'off' }} />;
}

/** Size, what it shows, width, hide when empty, ⋯ menu, priority and region for one widget. */
function WidgetFields({ w }: { w: BannerWidget }) {
  const rt = useRuntime();
  const saved = rt.bannerWidgetPrefs()[w.key] ?? {};
  const set = (patch: Record<string, unknown>) => rt.setBannerWidget(w.key, patch);
  const unit: BannerWidthUnit = saved.maxUnit ?? 'px';
  const [text, setText] = useState(saved.maxWidth ? String(saved.maxWidth) : '');
  useEffect(() => { setText(saved.maxWidth ? String(saved.maxWidth) : ''); }, [saved.maxWidth]);
  const commit = (v: string) => {
    setText(v);
    const n = Number(v);
    if (!v.trim()) set({ maxWidth: null, maxUnit: null });
    else if (Number.isFinite(n) && n >= BANNER_WIDGET_MAX_WIDTH[unit].min) set({ maxWidth: n, maxUnit: unit });
  };
  const limits = BANNER_WIDGET_MAX_WIDTH[unit];
  return (
    <div className="fx-banner-widgets__fields" data-axf-widget-fields={w.key}>
      <SelectField label="Size" value={w.view.size} options={BANNER_WIDGET_SIZES.map((s) => ({ value: s, label: SIZE_LABEL[s] }))} onChange={(v) => set({ size: v })} />
      <SelectField label="Shows" value={saved.show ?? 'auto'} options={BANNER_WIDGET_SHOWS.map((s) => ({ value: s, label: SHOW_LABEL[s] }))} onChange={(v) => set({ show: v })} />
      <TextField label="Max width" value={text} placeholder="By size" hint={`${limits.min} to ${limits.max}, empty = by size`} onChange={commit} />
      <SelectField label="Width in" value={unit} options={[{ value: 'px', label: 'Pixels' }, { value: 'ch', label: 'Characters' }]} onChange={(v) => { if (saved.maxWidth) set({ maxWidth: Math.max(BANNER_WIDGET_MAX_WIDTH[v as BannerWidthUnit].min, Math.min(BANNER_WIDGET_MAX_WIDTH[v as BannerWidthUnit].max, saved.maxWidth)), maxUnit: v }); else set({ maxUnit: null }); }} />
      <SelectField label="Region" value={w.at} options={BANNER_SIDES.map((s) => ({ value: s, label: SIDE_LABEL[s] ?? s }))} onChange={(v) => { if (w.attached) rt.moveHostItem('banner', w.key, v, 999); }} disabled={!w.attached} />
      <SelectField label="Priority" hint="Low goes into ⋯ first" value={String(w.view.priority)} options={Array.from({ length: BANNER_WIDGET_PRIORITY.max }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} onChange={(v) => set({ priority: Number(v) })} />
      <Switch className="fx-banner-widgets__wide" label="Hide when there's nothing to report" checked={w.view.hideWhenEmpty} onChange={(v) => set({ hideWhenEmpty: v })} />
      <Switch className="fx-banner-widgets__wide" label="Move into the ⋯ menu when space runs out" checked={w.view.overflow} onChange={(v) => set({ overflow: v })} />
      <div className="fx-row fx-banner-widgets__wide"><Button size="sm" tone="ghost" icon="undo" onClick={() => rt.dispatch(`banner.widget:${w.key}:reset`)}>Back to default</Button></div>
    </div>
  );
}

/** The picker: every widget, grouped by region, then the ones not on the bar right now. */
export function BannerWidgetsPanel({ initial }: { initial?: string }) {
  const rt = useRuntime();
  useAxfState();
  const rows = rt.bannerWidgets();
  const [open, setOpen] = useState(initial ?? '');
  const [drag, setDrag] = useState<{ key: string; side: string; index: number } | null>(null);
  useBannerHideTick();
  const strips = useKnownBanners();
  const on = rows.filter((w) => w.attached);
  const off = rows.filter((w) => !w.attached);

  const dropAt = (x: number, y: number, key: string) => {
    const el = document.elementFromPoint(x, y);
    const list = el?.closest<HTMLElement>('[data-axf-widget-side]');
    if (!list) return null;
    const side = list.getAttribute('data-axf-widget-side')!;
    const others = [...list.querySelectorAll<HTMLElement>('[data-axf-widget-row]')].filter((n) => n.getAttribute('data-axf-widget-row') !== key);
    const i = others.findIndex((n) => { const r = n.getBoundingClientRect(); return y < r.top + r.height / 2; });
    return { side, index: i < 0 ? others.length : i };
  };
  const handle = (w: BannerWidget) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); setDrag({ key: w.key, side: w.at, index: -1 }); },
    onPointerMove: (e: PointerEvent<HTMLElement>) => { if (drag?.key !== w.key) return; const t = dropAt(e.clientX, e.clientY, w.key); if (t) setDrag({ key: w.key, ...t }); },
    onPointerUp: () => { if (drag?.key === w.key && drag.index >= 0) rt.moveHostItem('banner', w.key, drag.side, drag.index); setDrag(null); },
    onPointerCancel: () => setDrag(null),
  });

  const row = (w: BannerWidget, i: number, total: number) => {
    const isOpen = open === w.key;
    return (
      <div key={w.key} className={`fx-banner-widgets__row${drag?.key === w.key ? ' is-dragging' : ''}`} data-axf-widget-row={w.key}>
        <div className="fx-banner-widgets__line">
          {w.attached && <span className="fx-banner-widgets__grip" title="Drag to reorder" aria-hidden="true" {...handle(w)}><Icon name="grip" size={14} /></span>}
          <Checkbox className="fx-banner-widgets__check" label={w.label} checked={!w.view.hidden} onChange={(v) => rt.setBannerWidget(w.key, { hidden: !v })} />
          {!w.attached && <span className="fx-muted fx-small">nothing to show now</span>}
          {w.attached && !w.view.hidden && !w.shown && <span className="fx-muted fx-small">empty</span>}
          <span className="fx-grow" />
          <span className="fx-muted fx-small">{SIZE_LABEL[w.view.size]}</span>
          {w.attached && <IconButton icon="chevron-up" label={`Move ${w.label} up`} disabled={i === 0} onClick={() => rt.moveHostItem('banner', w.key, w.at, i - 1)} />}
          {w.attached && <IconButton icon="chevron-down" label={`Move ${w.label} down`} disabled={i === total - 1} onClick={() => rt.moveHostItem('banner', w.key, w.at, i + 1)} />}
          <IconButton icon="settings" label={`Settings for ${w.label}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : w.key)} />
        </div>
        {isOpen && <WidgetFields w={w} />}
      </div>
    );
  };

  return (
    <div className="fx-banner-widgets">
      <div className="fx-banner-widgets__preview" aria-label="Banner preview"><Banner preview /></div>
      {BANNER_SIDES.map((side) => {
        const list = on.filter((w) => w.at === side);
        return (
          <section key={side} className="fx-banner-widgets__side" data-axf-widget-side={side}>
            <h4 className="fx-banner-widgets__title">{SIDE_LABEL[side] ?? side}</h4>
            {list.length ? list.map((w, i) => row(w, i, list.length)) : <p className="fx-muted fx-small">Nothing here. Drag a widget in.</p>}
          </section>
        );
      })}
      {off.length > 0 && (
        <section className="fx-banner-widgets__side">
          <h4 className="fx-banner-widgets__title">Not on the bar right now</h4>
          {off.map((w, i) => row(w, i, off.length))}
        </section>
      )}
      {strips.length > 0 && (
        <section className="fx-banner-widgets__side">
          <h4 className="fx-banner-widgets__title">Banners under the bar</h4>
          {strips.map((b) => (
            <div key={b.id} className="fx-banner-widgets__row" data-axf-banner-strip-row={b.id}>
              <div className="fx-banner-widgets__line">
                <Checkbox className="fx-banner-widgets__check" label={bannerLabel(b)} checked={!isBannerHidden(rt, b.id)} onChange={(v) => setBannerHide(rt, b.id, !v)} />
                <span className="fx-grow" />
                <IconButton icon="settings" label={`Banner settings for ${bannerLabel(b)}`} onClick={() => rt.dispatch(`banners.settings:${b.id}`)} />
              </div>
            </div>
          ))}
        </section>
      )}
      <Note icon="info">Saved for this app on this kind of device (phone or computer) and kept in sync through axHub.</Note>
      <div className="fx-row fx-row--wrap">
        <Button tone="ghost" icon="undo" onClick={() => rt.resetBannerWidgets()}>Reset to default</Button>
        <Button tone="ghost" icon="move" onClick={() => { rt.closeDialog(); rt.setArranging('banner'); }}>Drag them on the banner</Button>
        <Button tone="ghost" icon="settings" onClick={() => rt.dispatch('banners.settings')}>Banner settings…</Button>
      </div>
    </div>
  );
}

export const bannerWidgetsDialog: DialogMap = {
  [BANNER_WIDGETS_DIALOG]: { title: 'Banner widgets', icon: 'layers', searchable: false, render: (props) => <BannerWidgetsPanel initial={typeof props.key === 'string' ? props.key : undefined} /> },
};
