/*
 * Banner (asset type `banner`): the thin permanent bar across the top of the screen. Logo on the left, then the
 * attachments the engine places (core/engines/banner.ts → widget host engine) on the left, center and right: badges and
 * widgets (clock, search bar) from the banner asset itself and from modules at run time (rt.attachToBanner). A runtime
 * popup (rt.showBannerPopup) pops a short message out to the right of its attachment for a few seconds; tapping it
 * dismisses it early. Theme tokens only.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { animationFor, glyphSvg, markSvg } from '../../core/engines/brand';
import { BANNER_SIDES, badgeLook, badgeToneToken, bannerSurface, clockTickMs, formatClock, type ClockParts, type PlacedAttachment } from '../../core/engines/banner';
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

/** A logo-mark, animated logo or icon-pack glyph from the registry, drawn as the badge's icon (brand looks). */
function BadgeMark({ spec, size }: { spec: string; size: number }) {
  const rt = useRuntime();
  const [kind, rest] = spec.startsWith('anim:') ? ['anim', spec.slice(5)] : spec.startsWith('glyph:') ? ['glyph', spec.slice(6)] : ['mark', spec];
  if (kind === 'glyph') {
    const [pack, name] = rest.split('/');
    const p = rt.registry.get('icon-pack' as never, pack ?? '') as { data: unknown } | undefined;
    const svg = p && name ? glyphSvg(p.data, name, size) : null;
    return svg ? <span className="fx-banner__mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} /> : null;
  }
  const anim = kind === 'anim' ? rt.registry.get('animated-logo' as never, rest) as { data: { mark?: string } } | undefined : undefined;
  const mark = rt.registry.get('logo-mark' as never, anim ? String(anim.data.mark ?? '') : rest) as { data: unknown } | undefined;
  if (!mark) return null;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const a = anim ? animationFor(anim.data, reduced) : null;
  const style = a ? ({ ...a.vars, animationName: a.name, animationDuration: `${a.durationMs}ms`, animationDelay: `${a.delayMs}ms`, animationIterationCount: a.iteration } as CSSProperties) : undefined;
  return <span className={`fx-banner__mark ${a?.className ?? ''}`.trim()} style={style} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markSvg(mark.data, { height: size, title: '', text: false }) }} />;
}

export function BannerBadge({ data, id }: { data: BadgeData; id?: string }) {
  const rt = useRuntime();
  const look = badgeLook(data);
  const glyph = data.mark ? <BadgeMark spec={data.mark} size={14} /> : data.text ? <span className="fx-banner__badge-text">{data.text}</span> : <Icon name={data.icon} size={12} />;
  const body = (
    <>
      {data.shape === 'dot' ? <span className="fx-banner__dot" /> : glyph}
      {data.shape === 'pill' && <span className="fx-banner__badge-label">{data.label}</span>}
      {/* one bright pulse on top each time `pulse` goes up (a remount restarts the CSS animation; no timers) */}
      {typeof data.pulse === 'number' && data.pulse > 0 && <span key={data.pulse} className="fx-banner__badge-pulse" data-motion={data.pulseMotion || 'glow'} aria-hidden="true" />}
    </>
  );
  const props = {
    className: `fx-banner__badge is-${data.shape} ${look.className}`.trim(), 'data-tone': data.tone, 'data-tone2': data.tone2, 'data-token': badgeToneToken(data),
    'data-motion': look.motion, 'data-once': look.once ? '' : undefined, style: look.vars as CSSProperties,
    // right-click / long-press: the banner's own menu, plus whatever a module offers for `badge:<id>` (rt.contextExtras)
    'data-fx-ctx-target': id ? 'banner' : undefined, 'data-fx-ctx-payload': id ? `badge:${id}` : undefined,
    title: data.tooltip ?? data.label, 'aria-label': data.tooltip ?? data.label,
  };
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
      {a.type === 'badge' ? <BannerBadge data={asset.data as BadgeData} id={a.id} /> : <WidgetView type={a.type} id={a.id} host="banner" />}
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
