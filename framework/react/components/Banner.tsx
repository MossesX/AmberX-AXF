/*
 * Banner (asset type `banner`): the thin permanent bar across the top of the screen. Logo on the left, then the
 * attachments the engine places (core/engines/banner.ts) on the left, center and right: badges and clocks from the
 * banner asset itself and from modules at run time (rt.attachToBanner). A runtime popup (rt.showBannerPopup) pops a short
 * message out to the right of its attachment for a few seconds. Theme tokens only.
 */
import { useEffect, useState } from 'react';
import { BANNER_SIDES, badgeToneToken, formatClock, type ClockParts, type PlacedAttachment } from '../../core/engines/banner';
import type { BadgeData, ClockData } from '../../core/types';
import { useAxfState, useRuntime } from '../AxfProvider';
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

export function BannerClock({ data }: { data: ClockData }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const ms = data.seconds ? 1000 : 15000;
    const t = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [data.seconds]);
  const text = formatClock(data, clockParts(data.timezone));
  return <span className={`fx-banner__clock${data.mono === false ? '' : ' is-mono'}`} aria-label={`Time ${text}`}>{text}</span>;
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
    <span className="fx-banner__item" data-axf-banner-item={a.key}>
      {a.type === 'badge' ? <BannerBadge data={asset.data as BadgeData} /> : <WidgetView type={a.type} id={a.id} />}
      {pop && <span className="fx-banner__pop" role="status">{pop.text}</span>}
    </span>
  );
}

export function Banner() {
  const rt = useRuntime();
  useAxfState();
  const { data, placed } = rt.banner();
  if (!data) return null;
  return (
    <div className={`fx-banner is-${data.surface}${data.divider === false ? '' : ' has-divider'}`} role="banner" data-fx-ctx-target="banner">
      {BANNER_SIDES.map((side) => (
        <div key={side} className={`fx-banner__side is-${side}`}>
          {side === 'left' && data.logo.show && (
            <span className="fx-banner__logo"><span className="fx-brand__mark" aria-hidden="true" />{data.logo.text && <span className="fx-banner__name">{data.logo.text}</span>}</span>
          )}
          {placed[side].map((a) => <Attached key={a.key} a={a} />)}
        </div>
      ))}
    </div>
  );
}
