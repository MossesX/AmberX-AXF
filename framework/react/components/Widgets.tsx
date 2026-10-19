/*
 * Widgets (asset types with "widget": true: clock, search bar) and the hosts that hold them (banner, toolbar).
 * Placement is the engine's (core/engines/widgets.ts); this draws one placed widget. Theme tokens only.
 */
import { SEARCH_BAR_WIDTH } from '../../core/engines/widgets';
import type { ClockData, SearchBarData } from '../../core/types';
import { useRuntime } from '../AxfProvider';
import { BannerClock } from './Banner';
import { LiveSearch } from './Search';

/** A search bar widget: the app-wide live search (views, settings, actions, assets, windows, page words, module providers). */
export function SearchBarWidget({ data }: { data: SearchBarData }) {
  const w = SEARCH_BAR_WIDTH[data.width] ?? SEARCH_BAR_WIDTH.regular;
  return (
    <div className="fx-widget-search" style={{ width: `min(calc(var(--fx-space) * ${w}), 52vw)` }}>
      <LiveSearch config={{ live: true, placeholder: data.placeholder, maxResults: data.maxResults, kinds: data.kinds, shortcut: data.shortcut }} />
    </div>
  );
}

/** Draw a widget asset by type + id (nothing if it's gone). */
export function WidgetView({ type, id }: { type: string; id: string }) {
  const rt = useRuntime();
  const a = rt.registry.get(type as never, id) as { data: unknown } | undefined;
  if (!a) return null;
  if (type === 'clock') return <BannerClock data={a.data as ClockData} />;
  if (type === 'search-bar') return <SearchBarWidget data={a.data as SearchBarData} />;
  return null;
}
