/*
 * Widgets on any toolbar, banner style (toolbar-widgets@1, Brett Nov 13 2026: "I can attach widgets to the toolbar
 * right, just like the banner widgets"). ToolbarWidgetSlot draws one side of one toolbar instance's widgets inside the
 * toolbar's role="toolbar" element, through the banner widget frame: every item is a `.fx-banner__item` carrying the
 * resolved size / show / width cap / shape (rt.toolbarInstanceWidgets → attrs), so any banner widget style and shape
 * draws the same on a toolbar as on the banner. Every widget is a console-control target `toolbar:<id>/widget:<type:id>`.
 * Widgets that don't fit go into the toolbar's ⋯ widget menu (fitToolbar order: the flexible piece gives way first,
 * then widgets by priority, then the bar scrolls with snap). Theme tokens only.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { fitToolbar, type ResolvedToolbarWidget, type ResolvedToolbarWidgets } from '../../core/engines/toolbar-widgets';
import { useAxfState, useRuntime } from '../AxfProvider';
import { BannerMore } from './BannerWidgets';
import { WidgetView } from './Widgets';

/** The console-control address of one widget on one toolbar. */
export const toolbarWidgetAddress = (instance: string, key: string): string => `toolbar:${instance}/widget:${key}`;

/** Every widget one toolbar instance draws (re-read on every runtime change). */
export function useToolbarWidgets(instance: string): ResolvedToolbarWidgets {
  const rt = useRuntime();
  useAxfState();
  return rt.toolbarInstanceWidgets(instance);
}

/** The engine's width-cap custom property name on a resolved widget's attrs (core/engines/toolbar-widgets.ts). */
const CAP_ATTR = ['--fx', 'widget-cap'].join('-');

/** What the item around one widget carries: the banner frame's size / show / shape attributes and its width cap (same as bannerItemAttrs). */
export function toolbarWidgetItemProps(w: ResolvedToolbarWidget): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w.attrs)) if (k.startsWith('data-')) out[k] = v;
  if (out['data-fx-wshow'] === 'auto') delete out['data-fx-wshow'];
  const cap = w.attrs[CAP_ATTR];
  if (cap) out.style = { maxWidth: cap } as CSSProperties;
  return out;
}

/** The body of one widget: the widget asset drawn the way its view says (a status drawn icon-only keeps its dot). */
export function ToolbarWidgetBody({ w }: { w: Pick<ResolvedToolbarWidget, 'type' | 'id' | 'view'> }) {
  const patch = w.view.show === 'icon' && w.type === 'status' ? { dot: true } : undefined;
  return <WidgetView type={w.type} id={w.id} host="toolbar" patch={patch} />;
}

/**
 * Which widgets of a toolbar don't fit right now, in the fitToolbar order. Widths are kept from each widget's last draw so
 * one in the ⋯ menu comes back as soon as there is room.
 */
export function useToolbarWidgetOverflow(root: RefObject<HTMLElement | null>, resolved: ResolvedToolbarWidgets, on: boolean): string[] {
  const widths = useRef(new Map<string, number>());
  const [out, setOut] = useState<string[]>([]);
  const all = Object.values(resolved.sides).flat();
  const rank = all.map((w) => `${w.key}=${w.view.priority}${w.view.overflow ? '' : '!'}`).join('|');
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !on || !all.length || typeof ResizeObserver === 'undefined') { setOut((p) => (p.length ? [] : p)); return; }
    const measure = () => {
      for (const n of el.querySelectorAll<HTMLElement>('[data-axf-toolbar-widget]')) widths.current.set(n.getAttribute('data-axf-toolbar-widget')!, n.offsetWidth);
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.columnGap) || 0;
      // the flexible piece: everything on the bar that is not a widget side (groups, search, the bar's own ⋯)
      let flex = 0, min = 0;
      for (const c of Array.from(el.children) as HTMLElement[]) {
        if (c.classList.contains('fx-toolbar__widgets')) continue;
        flex += c.offsetWidth;
        min += parseFloat(getComputedStyle(c).minWidth) || 0;
      }
      const plan = {
        sides: Object.fromEntries(Object.entries(resolved.sides).map(([s, list]) => [s, list.map((w) => ({ key: w.key, width: widths.current.get(w.key) ?? 0, priority: w.view.priority, overflow: w.view.overflow })).filter((i) => i.width > 0)])),
        flex: flex ? { width: flex, min: Math.min(min, flex) } : null,
        gap,
        moreWidth: el.querySelector<HTMLElement>('.fx-toolbar__widgets-more')?.offsetWidth || el.clientHeight,
      };
      const next = fitToolbar(plan, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)).overflow;
      setOut((p) => (p.join('|') === next.join('|') ? p : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [root, rank, on, out.join('|')]);
  return on ? out : [];
}

export interface ToolbarWidgetSlotProps {
  /** the toolbar instance (its settings id: `app`, a page toolbar's id, `<scope>.<slot>`) */
  instance: string;
  side: 'start' | 'end';
  /** what the toolbar calls itself (for screen readers) */
  label?: string;
  /** widgets drawn in the ⋯ menu instead of on the bar (useToolbarWidgetOverflow); the end side draws the ⋯ button */
  overflow?: readonly string[];
  /** the resolved widgets, when the host already has them */
  resolved?: ResolvedToolbarWidgets;
}

/** One side of one toolbar's widgets, in the banner widget frame. Draws nothing when the side is empty. */
export function ToolbarWidgetSlot({ instance, side, label, overflow = [], resolved }: ToolbarWidgetSlotProps) {
  const own = useToolbarWidgets(instance);
  const r = resolved ?? own;
  const list = (r.sides[side] ?? []).filter((w) => !overflow.includes(w.key));
  const more = side === 'end' ? Object.values(r.sides).flat().filter((w) => overflow.includes(w.key)) : [];
  if (!list.length && !more.length) return null;
  return (
    <div className={`fx-toolbar__widgets is-${side}`} role="group" aria-label={`${label ?? 'Toolbar'} widgets (${side})`} data-axf-toolbar-widgets={`${instance}:${side}`}>
      {list.map((w) => <ToolbarWidgetItem key={w.key} instance={instance} w={w} />)}
      {more.length > 0 && (
        <span className="fx-toolbar__widgets-more">
          <BannerMore keys={more.map((w) => w.key)} noun="toolbar widget" ctxTarget="toolbar" draw={(k) => { const w = more.find((x) => x.key === k); return w ? <ToolbarWidgetItem instance={instance} w={w} /> : null; }} />
        </span>
      )}
    </div>
  );
}

/** One widget on a toolbar: the banner item frame, its attributes, its address. */
export function ToolbarWidgetItem({ instance, w }: { instance: string; w: ResolvedToolbarWidget }) {
  return (
    <span
      className={`fx-banner__item fx-toolbar__widget${w.shape ? ' fx-shaped' : ''}`}
      data-axf-toolbar-widget={w.key}
      data-axf-origin={w.origin}
      data-axf-target={toolbarWidgetAddress(instance, w.key)}
      {...toolbarWidgetItemProps(w)}
    >
      <ToolbarWidgetBody w={w} />
    </span>
  );
}
