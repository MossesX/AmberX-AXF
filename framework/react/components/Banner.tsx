/*
 * Banner (asset type `banner`): the thin permanent bar across the top of the screen. Logo on the left, then the
 * attachments the engine places (core/engines/banner.ts → widget host engine) on the left, center and right: badges and
 * widgets (clock, search bar) from the banner asset itself and from modules at run time (rt.attachToBanner). A runtime
 * popup (rt.showBannerPopup) pops a short message out to the right of its attachment for a few seconds; tapping it
 * dismisses it early. Theme tokens only.
 */
import { useEffect, useRef, useState } from 'react';
import { BANNER_SIDES, badgeToneToken, bannerSurface, clockTickMs, formatClock, type ClockParts, type PlacedAttachment } from '../../core/engines/banner';
import { bannerWidgetNumber } from '../../core/engines/bannerwidgets';
import { statusOn, widgetTone } from '../../core/engines/widgets';
import type { BadgeData, ClockData, CounterData, StatusData } from '../../core/types';
import { useAxfState, useRuntime } from '../AxfProvider';
import { ArrangeBar, arrangedSide, useArrange } from './Arrange';
import { BrandMark, brandHostProps, useBrandPlace } from './Brand';
import { Icon } from './Icon';
import { BannerMore, bannerItemAttrs, useBannerOverflow } from './BannerWidgets';
import { Tap, WidgetView } from './Widgets';
import { useWidgetIcon } from '../widgetIcons';
import { bannerWidgetIconId, modeFromBannerShow, type ResolvedWidgetIcon } from '../../core/engines/widget-icons';
import { controlSlug } from '../controlTargets';
import { CHROME_INSTANCE_KEY } from '../../core/engines/chrome-settings-rules.mjs';

/**
 * Re-render when this banner's own settings change (chrome-settings@1 `axf.chrome.banner.app`, written by its Settings…
 * dialog, Look / Behaviour / Interface tabs, chrome.set): the frame re-reads them at once, never after a reload.
 */
function useBannerOverrides(): void {
  const rt = useRuntime();
  const [, tick] = useState(0);
  useEffect(() => rt.settings.onChange(CHROME_INSTANCE_KEY('banner', 'app'), () => tick((n) => n + 1)), [rt]);
}

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

export function BannerBadge({ data, id }: { data: BadgeData; id?: string }) {
  const rt = useRuntime();
  const body = (
    <>
      {data.shape === 'dot' ? <span className="fx-banner__dot" /> : <Icon name={data.icon} size={12} />}
      {data.shape === 'pill' && <span className="fx-banner__badge-label">{data.label}</span>}
    </>
  );
  const props = { className: `fx-banner__badge is-${data.shape}`, 'data-tone': data.tone, 'data-token': badgeToneToken(data), title: data.tooltip ?? data.label, 'aria-label': data.tooltip ?? data.label };
  return data.link
    ? <button type="button" {...props} {...(id ? { 'data-axf-target': `button:banner.${controlSlug(id)}` } : {})} onClick={() => rt.dispatch(data.link!)}>{body}</button>
    : <span role="img" {...props}>{body}</span>;
}

/** A widget set to show only its number: its count, tapping it does what the widget does. */
function WidgetNumber({ type, data }: { type: string; data: Partial<StatusData & CounterData> & { counter?: string } }) {
  const rt = useRuntime();
  const n = rt.badge(data.counter ?? '');
  const on = statusOn(n);
  const text = bannerWidgetNumber(type === 'status' ? (on ? data.onLabel : data.offLabel) : '', n);
  const tone = widgetTone(type === 'status' ? (on ? data.onTone : data.offTone) : data.tone);
  return <Tap action={data.link} className="fx-widget-counter" title={type === 'status' ? (on ? data.onLabel : data.offLabel) : data.label}><span className="fx-widget-counter__num" data-tone={tone}>{text}</span></Tap>;
}

/** Widget kinds that draw words the icon rule can replace (widget-icons@1). The rest (clock, search bar, logo, …) draw as they are. */
const ICONIC = new Set(['status', 'label', 'counter', 'action-button', 'link', 'badge']);

/** The words a widget shows right now, for the long-text rule. */
function widgetWords(rt: ReturnType<typeof useRuntime>, type: string, d: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  if (type === 'status') return s(statusOn(rt.badge(s(d.counter))) ? d.onLabel : d.offLabel);
  if (type === 'label') return s(d.text);
  return s(d.label);
}

/** A widget drawn by the icon rule: its icon, its text (under the --fx-size-widget-text-max cap) unless it is icon only, the full text as the tooltip. */
function IconicWidget({ type, d, r }: { type: string; d: Record<string, unknown>; r: ResolvedWidgetIcon }) {
  const rt = useRuntime();
  const on = type === 'status' && statusOn(rt.badge(String(d.counter ?? '')));
  const tone = type === 'status' ? widgetTone((on ? d.onTone : d.offTone) as never) : widgetTone(d.tone as never);
  const link = typeof d.link === 'string' ? d.link : undefined;
  const tip = r.tooltip || r.label || undefined;
  const cls = `fx-widget-iconic is-${r.mode.replace('+', '-')}`;
  const body = (
    <>
      <span className="fx-widget-iconic__glyph" data-tone={tone}><Icon name={r.icon} size={14} /></span>
      {r.mode !== 'icon' && r.label && <span className="fx-widget-iconic__text" data-tone={tone}>{r.label}</span>}
    </>
  );
  // the words are never lost: the tooltip (title) and the accessible name carry the full text
  return link
    ? <Tap action={link} className={cls} title={tip}>{body}</Tap>
    : <span className={cls} title={tip} aria-label={tip} role={r.mode === 'icon' ? 'img' : undefined}>{body}</span>;
}

/** One banner widget as the person set it up (bar, ⋯ menu, a host's banner strip). */
export function BannerWidgetBody({ type, id }: { type: string; id: string }) {
  const rt = useRuntime();
  const asset = rt.registry.get(type as never, id) as { data: unknown } | undefined;
  const d = (asset?.data ?? {}) as Record<string, unknown>;
  const { show } = rt.bannerWidgetView(`${type}:${id}`);
  // widget-icons@1: every widget that draws words gets an icon (its own, its default, or the person's pick)
  const r = useWidgetIcon({ id: bannerWidgetIconId(`${type}:${id}`), kind: type, text: widgetWords(rt, type, d), icon: typeof d.icon === 'string' ? d.icon : undefined, tooltip: typeof d.tooltip === 'string' ? d.tooltip : undefined, defaultMode: modeFromBannerShow(show) });
  if (!asset) return null;
  if (show === 'number' && (type === 'status' || type === 'counter')) return <WidgetNumber type={type} data={asset.data as StatusData} />;
  if (!ICONIC.has(type)) return <WidgetView type={type} id={id} host="banner" />;
  const tip = r.tooltip || undefined;
  if (type === 'badge') {
    const b = asset.data as BadgeData;
    return <BannerBadge data={{ ...b, icon: r.icon, shape: r.mode === 'icon' && b.shape === 'pill' ? 'icon' : r.mode !== 'icon' && b.shape === 'icon' ? 'pill' : b.shape, tooltip: b.tooltip ?? tip }} id={id} />;
  }
  if (type === 'status' || type === 'label') return r.mode === 'text' ? <WidgetView type={type} id={id} host="banner" /> : <IconicWidget type={type} d={d} r={r} />;
  // counter, action button, link: they draw their own icon; give them the resolved one and drop the words in icon mode
  const words = r.mode === 'icon' ? { label: type === 'counter' ? undefined : '' } : {};
  const patch = type === 'action-button'
    ? { icon: r.icon, show: r.mode === 'icon' ? 'icon' : r.mode === 'text' ? 'label' : 'both', tooltip: (d.tooltip as string | undefined) ?? tip }
    : { icon: r.mode === 'text' ? undefined : r.icon, ...words, tooltip: (d.tooltip as string | undefined) ?? tip };
  return <WidgetView type={type} id={id} host="banner" patch={patch} />;
}

function Attached({ a }: { a: PlacedAttachment }) {
  const rt = useRuntime();
  const state = useAxfState();
  if (!rt.registry.has(a.type as never, a.id)) return null;
  const pop = state.bannerPopup && state.bannerPopup.key === a.key ? state.bannerPopup : null;
  return (
    <>
      <BannerWidgetBody type={a.type} id={a.id} />
      {pop && <span className="fx-banner__pop" role="status" onClick={() => rt.dismissBannerPopup()}>{pop.text}</span>}
    </>
  );
}

/** The mark height the banner's brand slot draws at: 55% of the banner (same as the built-in mark's CSS size). */
function bannerMarkPx(data: { height?: number }): number {
  return Math.round(((data.height ?? 24) * 0.55));
}

/** logo.text that stands for the app's own name, for a banner every app can use (the Windows title bar). */
const BANNER_APP_NAME = '{app}';

/** `preview`: a look-only copy (the Widgets picker): nothing on it reacts, and nothing moves into the ⋯ menu. */
export function Banner({ preview = false }: { preview?: boolean }) {
  const rt = useRuntime();
  useAxfState();
  useBannerOverrides();
  const { data, placed } = rt.banner();
  const arrange = useArrange('banner', placed);
  const root = useRef<HTMLDivElement>(null);
  const all = BANNER_SIDES.flatMap((s) => placed[s]);
  const overflow = useBannerOverflow(root, all, !preview && !arrange.on);
  // branding@1: the banner's brand slot replaces the built-in mark (lockup by default); accent-edge / watermark mark the host
  const brand = useBrandPlace('banner');
  const host = brandHostProps(brand);
  if (!data) return null;
  // a banner that names the app draws its own name, never a lockup that carries the brand's
  const namesApp = data.logo?.text === BANNER_APP_NAME;
  const drawsMark = !!brand?.svg && (!namesApp || brand.mode === 'mark' || brand.mode === 'animated');
  // a lockup / wordmark already carries the brand name, so the asset's own logo text is only shown next to a plain mark
  const showText = data.logo?.text && (!drawsMark || brand?.mode === 'mark' || brand?.mode === 'animated');
  return (
    <div ref={root} className={`fx-banner is-${bannerSurface(data)}${data.divider === false ? '' : ' has-divider'}${arrange.on && !preview ? ' is-arranging' : ''} ${host.className}`.trim()} {...(preview ? { inert: '' as unknown as boolean, 'data-axf-banner-preview': '' } : { role: 'banner', 'data-fx-ctx-target': 'banner', 'data-axf-arrange-host': 'banner' })} data-axf-search="off" data-fx-brand-mode={host['data-fx-brand-mode']}>
      {BANNER_SIDES.map((side) => (
        <div key={side} className={`fx-banner__side is-${side}`} {...arrange.sideProps(side)}>
          {side === 'left' && data.logo?.show !== false && (
            <span className="fx-banner__logo">
              {drawsMark ? <BrandMark slot="banner" height={bannerMarkPx(data)} /> : <span className="fx-brand__mark" aria-hidden="true" />}
              {showText && <span className="fx-banner__name">{namesApp ? rt.manifest.app.name : data.logo?.text}</span>}
            </span>
          )}
          {arrangedSide(arrange, side, placed[side].filter((a) => !overflow.includes(a.key)), (a, i) => arrange.item(a, i, 'fx-banner__item', { 'data-axf-banner-item': a.key, 'data-axf-origin': a.origin, ...bannerItemAttrs(rt, a.key) }, <Attached a={a} />))}
          {side === 'right' && <BannerMore keys={overflow} draw={(k) => { const a = all.find((x) => x.key === k); return a ? <span data-axf-banner-item={k} {...bannerItemAttrs(rt, k)}><Attached a={a} /></span> : null; }} />}
        </div>
      ))}
      {!preview && <ArrangeBar host="banner" label="banner" />}
    </div>
  );
}
