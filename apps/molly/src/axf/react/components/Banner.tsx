/*
 * Banner (asset type `banner`): the thin permanent bar across the top of the screen. Logo on the left, then the
 * attachments the engine places (core/engines/banner.ts → widget host engine) on the left, center and right: badges and
 * widgets (clock, search bar) from the banner asset itself and from modules at run time (rt.attachToBanner). A runtime
 * popup (rt.showBannerPopup) pops a short message out to the right of its attachment for a few seconds; tapping it
 * dismisses it early. Theme tokens only.
 */
import { useEffect, useState } from 'react';
import { BANNER_SIDES, badgeToneToken, bannerSurface, clockTickMs, formatClock, type ClockParts, type PlacedAttachment } from '../../core/engines/banner';
import type { BadgeData, ClockData } from '../../core/types';
import { useAxfState, useRuntime } from '../AxfProvider';
import { ArrangeBar, arrangedSide, useArrange } from './Arrange';
import { BrandMark, brandHostProps, useBrandPlace } from './Brand';
import { Icon } from './Icon';
import { WidgetView } from './Widgets';

function clockParts(tz?: string): ClockParts {
  const now = new Date();
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday ?? '');
    return { year: +p.year!, month: +p.month!, day: +p.day!, weekday: wd < 0 ? now.getDay() : wd, hour: +p.hour! % 24, minute: +p.minute!, second: +p.second! };
  } catch {
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), weekday: now.getDay(), hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds() };
  }
}

/** A clock widget. Ticks every second with seconds shown, else exactly on the minute (no drift, no wasted renders). */
export function BannerClock({ data }: { data: ClockData }) {
  const [, tick] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const step = clockTickMs(data);
    const arm = () => { timer = setTimeout(() => { tick((n) => n + 1); arm(); }, step - (Date.now() % step)); };
    arm();
    return () => { if (timer) clearTimeout(timer); };
  }, [data.seconds]);
  const text = formatClock(data, clockParts(data.timezone));
  return <time className={`fx-banner__clock${data.mono === false ? '' : ' is-mono'}`} aria-label={`Time ${text}`} title={data.timezone || undefined}>{text}</time>;
}

export function BannerBadge({ data }: { data: BadgeData }) {
  const rt = useRuntime();
  const body = (
    <>
      {data.shape === 'dot' ? <span className="fx-banner__dot" /> : <Icon name={data.icon} size={12} />}
      {data.shape === 'pill' && <span className="fx-banner__badge-label">{data.label}</span>}
    </>
  );
  const props = { className: `fx-banner__badge is-${data.shape}`, 'data-tone': data.tone, 'data-token': badgeToneToken(data), title: data.tooltip ?? data.label, 'aria-label': data.tooltip ?? data.label };
  return data.link
    ? <button type="button" {...props} onClick={() => rt.dispatch(data.link!)}>{body}</button>
    : <span role="img" {...props}>{body}</span>;
}

function Attached({ a }: { a: PlacedAttachment }) {
  const rt = useRuntime();
  const state = useAxfState();
  const asset = rt.registry.get(a.type as never, a.id) as { data: unknown } | undefined;
  if (!asset) return null;
  const pop = state.bannerPopup && state.bannerPopup.key === a.key ? state.bannerPopup : null;
  return (
    <>
      {a.type === 'badge' ? <BannerBadge data={asset.data as BadgeData} /> : <WidgetView type={a.type} id={a.id} host="banner" />}
      {pop && <span className="fx-banner__pop" role="status" onClick={() => rt.dismissBannerPopup()}>{pop.text}</span>}
    </>
  );
}

/** The mark height the banner's brand slot draws at: 55% of the banner (same as the built-in mark's CSS size). */
function bannerMarkPx(data: { height?: number }): number {
  return Math.round(((data.height ?? 24) * 0.55));
}

export function Banner() {
  const rt = useRuntime();
  useAxfState();
  const { data, placed } = rt.banner();
  const arrange = useArrange('banner', placed);
  // branding@1: the banner's brand slot replaces the built-in mark (lockup by default); accent-edge / watermark mark the host
  const brand = useBrandPlace('banner');
  const host = brandHostProps(brand);
  if (!data) return null;
  const drawsMark = !!brand?.svg;
  // a lockup / wordmark already carries the brand name, so the asset's own logo text is only shown next to a plain mark
  const showText = data.logo?.text && (!drawsMark || brand?.mode === 'mark' || brand?.mode === 'animated');
  return (
    <div className={`fx-banner is-${bannerSurface(data)}${data.divider === false ? '' : ' has-divider'}${arrange.on ? ' is-arranging' : ''} ${host.className}`.trim()} role="banner" data-fx-ctx-target="banner" data-axf-search="off" data-axf-arrange-host="banner" data-fx-brand-mode={host['data-fx-brand-mode']}>
      {BANNER_SIDES.map((side) => (
        <div key={side} className={`fx-banner__side is-${side}`} {...arrange.sideProps(side)}>
          {side === 'left' && data.logo?.show !== false && (
            <span className="fx-banner__logo">
              {drawsMark ? <BrandMark slot="banner" height={bannerMarkPx(data)} /> : <span className="fx-brand__mark" aria-hidden="true" />}
              {showText && <span className="fx-banner__name">{data.logo?.text}</span>}
            </span>
          )}
          {arrangedSide(arrange, side, placed[side], (a, i) => arrange.item(a, i, 'fx-banner__item', { 'data-axf-banner-item': a.key, 'data-axf-origin': a.origin }, <Attached a={a} />))}
        </div>
      ))}
      <ArrangeBar host="banner" label="banner" />
    </div>
  );
}
