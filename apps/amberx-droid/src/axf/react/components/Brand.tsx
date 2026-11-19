/**
 * Brand decorations (branding@1): what a chrome piece draws at its brand slot. The runtime resolves the active
 * branding package (`rt.brandPlace(slot)`); this file only places it.
 *
 *   <BrandMark slot="banner" height={h} />   the mark / wordmark / lockup / animated mark for a slot (null = nothing)
 *   useBrandPlace(slot)                       the resolved place, re-rendered on hot swap
 *   brandHostProps(place)                     class + data attributes a host adds for accent-edge / watermark modes
 *
 * SVG comes from the engine's `markSvg` (path data and one text node only, colours as tokens), so inserting it as HTML
 * is safe by construction. Nothing here hardcodes a colour or a size: heights come from the host's tokens.
 */
import { useSyncExternalStore, type CSSProperties } from 'react';
import { useOptionalRuntime } from '../AxfProvider';
import type { BrandPlace } from '../../core';

const noStore = { subscribe: () => () => {}, get: () => null };

export function useBrandPlace(slot: string, height = 20): BrandPlace | null {
  const rt = useOptionalRuntime();
  // re-render on every runtime change (hot swaps of branding / marks / packs); a null runtime subscribes to nothing
  useSyncExternalStore(rt ? rt.subscribe : noStore.subscribe, rt ? rt.getState : noStore.get, rt ? rt.getState : noStore.get);
  return rt ? rt.brandPlace(slot, height) : null;
}

/** Class + data attributes for a host element: `is-brand-edge` draws the accent edge, `is-brand-watermark` the faint mark behind. */
export function brandHostProps(place: BrandPlace | null): { className: string; 'data-fx-brand-mode'?: string } {
  if (!place) return { className: '' };
  if (place.mode === 'accent-edge') return { className: 'is-brand-edge', 'data-fx-brand-mode': place.mode };
  if (place.mode === 'watermark') return { className: 'is-brand-watermark', 'data-fx-brand-mode': place.mode };
  return { className: '', 'data-fx-brand-mode': place.mode };
}

/** The mark a slot draws (mark / wordmark / lockup / animated), or null. `height` is in px of the host's own scale. */
export function BrandMark({ slot, height = 20, className = '' }: { slot: string; height?: number; className?: string }) {
  const place = useBrandPlace(slot, height);
  if (!place || !place.svg) return null;
  const anim = place.animation;
  const style = anim ? ({ ...anim.vars, animationName: anim.name, animationDuration: `${anim.durationMs}ms`, animationDelay: `${anim.delayMs}ms`, animationIterationCount: anim.iteration } as CSSProperties) : undefined;
  return (
    <span
      className={`fx-brand fx-brand--${place.mode} ${anim?.className ?? ''} ${className}`.trim()}
      data-fx-brand-slot={slot}
      style={style}
      aria-hidden={place.mode === 'mark' || place.mode === 'animated' ? 'true' : undefined}
      dangerouslySetInnerHTML={{ __html: place.svg }}
    />
  );
}

/** The faint watermark mark for a host whose slot mode is `watermark` (absolute, behind the content). */
export function BrandWatermark({ slot }: { slot: string }) {
  const place = useBrandPlace(slot, 160);
  if (!place || place.mode !== 'watermark' || !place.svg) return null;
  return <span className="fx-brand-watermark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: place.svg }} />;
}
