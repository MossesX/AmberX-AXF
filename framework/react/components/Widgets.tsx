/*
 * Widgets (asset types with "widget": true: clock, search bar) and the hosts that hold them (banner, toolbar).
 * Placement is the engine's (core/engines/widgets.ts); this draws one placed widget. Widget renderers are an open
 * registry (`registerWidgetRenderer`): a library adds a new widget type by registering its renderer, no shell change.
 * Theme tokens only.
 */
import type { ComponentType } from 'react';
import { searchBarConfig } from '../../core/engines/widgets';
import type { ClockData, SearchBarData } from '../../core/types';
import { useRuntime } from '../AxfProvider';
import { BannerClock } from './Banner';
import { LiveSearch } from './Search';

export interface WidgetRenderProps<D = unknown> { data: D; id: string; /** the host drawing it (`banner`, `toolbar`) */ host?: string }
export type WidgetRenderer<D = unknown> = ComponentType<WidgetRenderProps<D>>;

const renderers = new Map<string, WidgetRenderer>();
/** Register (or replace) the renderer for a widget asset type. Returns an unregister function. */
export function registerWidgetRenderer<D>(type: string, r: WidgetRenderer<D>): () => void {
  renderers.set(type, r as WidgetRenderer);
  return () => { if (renderers.get(type) === r) renderers.delete(type); };
}
export function widgetRenderer(type: string): WidgetRenderer | undefined { return renderers.get(type); }

/** A search bar widget: the app-wide live search (views, settings, actions, assets, windows, page words, module providers). */
export function SearchBarWidget({ data }: WidgetRenderProps<SearchBarData>) {
  const cfg = searchBarConfig(data);
  return (
    <div className="fx-widget-search" style={{ width: `min(calc(var(--fx-space) * ${cfg.width}), 52vw)` }}>
      <LiveSearch config={cfg} />
    </div>
  );
}

registerWidgetRenderer<ClockData>('clock', ({ data }) => <BannerClock data={data} />);
registerWidgetRenderer<SearchBarData>('search-bar', SearchBarWidget);

/** Draw a widget asset by type + id (nothing if it's gone or no renderer is registered for its type). */
export function WidgetView({ type, id, host }: { type: string; id: string; host?: string }) {
  const rt = useRuntime();
  const a = rt.registry.get(type as never, id) as { data: unknown } | undefined;
  const R = renderers.get(type);
  if (!a || !R) return null;
  return <R data={a.data} id={id} host={host} />;
}
