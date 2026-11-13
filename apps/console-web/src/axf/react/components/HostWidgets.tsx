/*
 * Widgets on toolbars and tab rows (Brett, Nov 13 2026: "I can attach widgets to the toolbar right, just like the banner
 * widgets"). Every toolbar (the app's, a page's, a workspace's) and every tab row hosts the same widgets the banner does,
 * from the same registry: status chips, counters, CPU / disk meters, account, clocks, search, logos… A person adds,
 * removes and arranges them per bar from its right-click menu (Widgets…) and its chrome settings, drags them in arrange
 * mode, and they move into a ⋯ menu when the bar runs out of room. Rules: core/engines/hostwidgets.ts (what the person
 * chose), core/engines/bannerwidgets.ts (how each widget is drawn), core/engines/widgets.ts (where it sits).
 * Theme tokens only.
 */
import { useState, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { bannerWidgetCapCss, type BannerWidgetSize } from '../../core/engines/bannerwidgets';
import { HOST_APP_INSTANCE, hostSpec, instanceHost, type PlacedAttachment } from '../../core/engines/widgets';
import { HOST_WIDGETS_DIALOG, type AxfRuntime, type BannerWidget } from '../../core/runtime';
import { useAxfState, useRuntime } from '../AxfProvider';
import { ArrangeBar, arrangedSide, useArrange } from './Arrange';
import { BannerWidgetBody } from './Banner';
import { BannerMore, useBannerOverflow, WidgetFieldsFor } from './BannerWidgets';
import { Button, Chip, IconButton } from './Controls';
import { Checkbox, Note, TextField } from './Forms';
import { Icon } from './Icon';
import type { DialogMap } from './Overlays';

export type WidgetHostKind = 'toolbar' | 'tab-group';

const SIDE_LABEL: Record<string, string> = { start: 'Start', end: 'End' };
const SIZE_LABEL: Record<BannerWidgetSize, string> = { icon: 'Icon only', compact: 'Compact', normal: 'Normal', wide: 'Wide' };
const KIND_WORD: Record<WidgetHostKind, string> = { toolbar: 'toolbar', 'tab-group': 'tab row' };
const KIND_PREFIX: Record<WidgetHostKind, string> = { toolbar: 'toolbar', 'tab-group': 'tabs' };

/** What the item around a widget carries on a toolbar or tab row: its size, what it shows, its width cap. */
export function hostItemAttrs(rt: AxfRuntime, host: WidgetHostKind, instance: string, key: string): Record<string, unknown> {
  const v = rt.hostWidgetView(host, instance, key);
  const max = bannerWidgetCapCss(v.cap);
  return { 'data-fx-wsize': v.size, 'data-fx-wshow': v.show === 'auto' ? undefined : v.show, ...(max ? { style: { maxWidth: max } } : {}) };
}

export interface HostWidgetsApi {
  /** the host id arrange mode and the arrangement setting use (`toolbar`, `toolbar@settings-toolbar`, `tab-group@ui-review.sections`) */
  hostId: string;
  /** arrange mode on for this bar */
  on: boolean;
  /** anything drawn (or arrange mode on, so the empty sides show as drop targets) */
  any: boolean;
  placed: Record<string, PlacedAttachment[]>;
  /** the start side's widgets (null when there is nothing to draw there) */
  start: ReactNode;
  end: ReactNode;
  /** the arrange-mode bar (null when off) */
  bar: ReactNode;
  /** on the bar's root: the arrange host id */
  rootProps: Record<string, string>;
}

/**
 * The widgets of one toolbar or tab row, ready to draw: start and end strips (arrange mode, drag + snap, the ⋯ menu for
 * what doesn't fit) and the arrange bar. `root` is the bar's element: the ⋯ rule measures it (everything on it that is
 * not a widget keeps its room; the widgets share what is left, lowest priority leaving first).
 */
export function useHostWidgets(host: WidgetHostKind, instance: string, root: RefObject<HTMLElement | null>): HostWidgetsApi {
  const rt = useRuntime();
  useAxfState();
  const hostId = instanceHost(host, instance);
  const placed = rt.hostInstanceWidgets(host, instance);
  const arrange = useArrange(hostId, placed);
  const sides = hostSpec(host)?.sides ?? ['start', 'end'];
  const all = sides.flatMap((s) => placed[s] ?? []);
  const overflow = useBannerOverflow(root, all, !arrange.on && all.length > 0, {
    attr: 'data-axf-host-item',
    view: (key) => rt.hostWidgetView(host, instance, key),
    available: (el, gap) => {
      const cs = getComputedStyle(el);
      let taken = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      let n = 0;
      for (const c of Array.from(el.children) as HTMLElement[]) { n++; if (!c.hasAttribute('data-axf-host-side') && !c.classList.contains('fx-arrange__bar')) taken += c.offsetWidth; }
      return el.clientWidth - taken - gap * Math.max(0, n - 1);
    },
  });
  const body = (p: PlacedAttachment) => <BannerWidgetBody type={p.type} id={p.id} host={host} show={rt.hostWidgetView(host, instance, p.key).show} />;
  const draw = (p: PlacedAttachment, i: number) => arrange.item(p, i, 'fx-toolbar__widget', { 'data-axf-host-item': p.key, 'data-axf-origin': p.origin, ...hostItemAttrs(rt, host, instance, p.key) }, body(p));
  const side = (s: string) => {
    const list = (placed[s] ?? []).filter((p) => !overflow.includes(p.key));
    const last = s === sides[sides.length - 1];
    if (!arrange.on && !list.length && !(last && overflow.length)) return null;
    return (
      <span className={`fx-toolbar__widgets is-${s}`} data-axf-host-side={s} {...arrange.sideProps(s)}>
        {arrangedSide(arrange, s, list, draw)}
        {last && <BannerMore keys={overflow} className="fx-toolbar__widget fx-toolbar__more-btn" target={host} what={`${KIND_WORD[host]} widget`} draw={(k) => { const p = all.find((x) => x.key === k); return p ? <span data-axf-host-item={k} {...hostItemAttrs(rt, host, instance, k)}>{body(p)}</span> : null; }} />}
      </span>
    );
  };
  return {
    hostId,
    on: arrange.on,
    any: arrange.on || all.length > 0,
    placed,
    start: side(sides[0]!),
    end: sides.length > 1 ? side(sides[sides.length - 1]!) : null,
    bar: arrange.on ? <ArrangeBar host={hostId} label={KIND_WORD[host]} /> : null,
    rootProps: { 'data-axf-arrange-host': hostId },
  };
}

/** The picker of one toolbar or tab row: what is on it (by side, drag or arrows to reorder, settings), what can be added. */
export function HostWidgetsPanel({ host, instance, initial }: { host: WidgetHostKind; instance: string; initial?: string }) {
  const rt = useRuntime();
  useAxfState();
  const hostId = instanceHost(host, instance);
  const sides = hostSpec(host)?.sides ?? ['start', 'end'];
  const rows = rt.hostWidgets(host, instance);
  const [open, setOpen] = useState(initial ?? '');
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState<{ key: string; side: string; index: number } | null>(null);
  const on = rows.filter((w) => w.attached);
  const q = query.trim().toLowerCase();
  const off = rows.filter((w) => !w.attached && (!q || w.label.toLowerCase().includes(q) || w.type.includes(q) || w.id.toLowerCase().includes(q) || w.aliases.some((a) => a.toLowerCase().includes(q))));
  const word = KIND_WORD[host];
  const prefix = KIND_PREFIX[host];
  const title = instance === HOST_APP_INSTANCE ? `The app ${word}` : `${word[0]!.toUpperCase()}${word.slice(1)} · ${instance}`;

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
    onPointerUp: () => { if (drag?.key === w.key && drag.index >= 0) rt.moveHostItem(hostId, w.key, drag.side, drag.index); setDrag(null); },
    onPointerCancel: () => setDrag(null),
  });

  const row = (w: BannerWidget, i: number, total: number) => {
    const isOpen = open === w.key;
    const mine = w.origin === 'person';
    return (
      <div key={w.key} className={`fx-banner-widgets__row${drag?.key === w.key ? ' is-dragging' : ''}`} data-axf-widget-row={w.key}>
        <div className="fx-banner-widgets__line">
          <span className="fx-banner-widgets__grip" title="Drag to reorder" aria-hidden="true" {...handle(w)}><Icon name="grip" size={14} /></span>
          <Checkbox className="fx-banner-widgets__check" label={w.label} checked={!w.view.hidden} onChange={(v) => rt.setHostWidget(host, instance, w.key, { hidden: !v })} />
          {!w.view.hidden && !w.shown && <span className="fx-muted fx-small">empty</span>}
          <span className="fx-grow" />
          <span className="fx-muted fx-small">{SIZE_LABEL[w.view.size]}</span>
          <IconButton icon="chevron-up" label={`Move ${w.label} up`} disabled={i === 0} onClick={() => rt.moveHostItem(hostId, w.key, w.at, i - 1)} />
          <IconButton icon="chevron-down" label={`Move ${w.label} down`} disabled={i === total - 1} onClick={() => rt.moveHostItem(hostId, w.key, w.at, i + 1)} />
          <IconButton icon="settings" label={`Settings for ${w.label}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : w.key)} />
          <IconButton icon={mine ? 'x' : 'eye'} label={`${mine ? 'Remove' : 'Hide'} ${w.label}`} title={mine ? 'Remove from this bar' : 'Hide (the bar or a plugin put it here)'} onClick={() => rt.removeHostWidget(host, instance, w.key)} />
        </div>
        {isOpen && <WidgetFieldsFor w={w} saved={rt.hostWidgetChoice(host, instance).prefs[w.key] ?? {}} sides={sides} sideLabel={(s) => SIDE_LABEL[s] ?? s}
          set={(patch) => rt.setHostWidget(host, instance, w.key, patch)} move={(side) => rt.moveHostItem(hostId, w.key, side, 999)} reset={() => rt.dispatch(`${prefix}.widget:${instance}:${w.key}:reset`)} />}
      </div>
    );
  };

  return (
    <div className="fx-banner-widgets" data-axf-host-widgets={hostId}>
      <p className="fx-muted fx-small">{title}</p>
      {sides.map((side) => {
        const list = on.filter((w) => w.at === side);
        return (
          <section key={side} className="fx-banner-widgets__side" data-axf-widget-side={side}>
            <h4 className="fx-banner-widgets__title">{SIDE_LABEL[side] ?? side}</h4>
            {list.length ? list.map((w, i) => row(w, i, list.length)) : <p className="fx-muted fx-small">Nothing here. Add a widget below or drag one in.</p>}
          </section>
        );
      })}
      <section className="fx-banner-widgets__side" data-axf-widget-catalog="">
        <h4 className="fx-banner-widgets__title">Add a widget</h4>
        <TextField label="Find a widget" value={query} onChange={setQuery} placeholder="CPU, clock, account, status…" />
        {off.length === 0 && <p className="fx-muted fx-small">{q ? `Nothing matches "${query}".` : 'Every widget is already on this bar.'}</p>}
        {off.slice(0, 40).map((w) => (
          <div key={w.key} className="fx-banner-widgets__row" data-axf-widget-add={w.key}>
            <div className="fx-banner-widgets__line">
              {w.icon && <Icon name={w.icon} size={14} />}
              <span>{w.label}</span>
              <Chip>{w.type.replace(/-/g, ' ')}</Chip>
              <span className="fx-grow" />
              {sides.map((s) => <Button key={s} size="sm" tone="ghost" icon="plus" onClick={() => rt.addHostWidget(host, instance, w.type, w.id, s)}>{SIDE_LABEL[s] ?? s}</Button>)}
            </div>
          </div>
        ))}
        {off.length > 40 && <p className="fx-muted fx-small">{off.length - 40} more: type to narrow it down.</p>}
      </section>
      <Note icon="info">Saved for this {word} in this app on this kind of device (phone or computer) and kept in sync through axHub. Voice and the API: "{prefix}.widget:{instance}:cpu:add".</Note>
      <div className="fx-row fx-row--wrap">
        <Button tone="ghost" icon="undo" onClick={() => rt.resetHostWidgets(host, instance)}>Reset to default</Button>
        {on.length > 0 && <Button tone="ghost" icon="move" onClick={() => { rt.closeDialog(); rt.setArranging(hostId); }}>Drag them on the {word}</Button>}
        <Button tone="ghost" icon="settings" onClick={() => rt.dispatch(`chrome.settings:${host}:${instance}`)}>{word[0]!.toUpperCase()}{word.slice(1)} settings…</Button>
      </div>
    </div>
  );
}

const kindOf = (v: unknown): WidgetHostKind => (v === 'tab-group' ? 'tab-group' : 'toolbar');

export const hostWidgetsDialog: DialogMap = {
  [HOST_WIDGETS_DIALOG]: { title: 'Widgets on this bar', icon: 'layers', searchable: false, render: (p) => <HostWidgetsPanel host={kindOf(p.host)} instance={typeof p.instance === 'string' && p.instance ? p.instance : HOST_APP_INSTANCE} initial={typeof p.key === 'string' ? p.key : undefined} /> },
};
