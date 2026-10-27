/*
 * Widgets (asset types with "widget": true: clock, search bar, logo, action button, label, status, counter, progress,
 * avatar, link, theme switch, spacer, divider) and the hosts that hold them (banner, toolbar).
 * Placement is the engine's (core/engines/widgets.ts); this draws one placed widget. Widget renderers are an open
 * registry (`registerWidgetRenderer`): a library adds a new widget type by registering its renderer, no shell change.
 * Theme tokens only.
 */
import type { ComponentType, ReactNode } from 'react';
import { avatarInitials, avatarSize, counterText, imageSrc, linkHref, logoSize, progressPercent, progressWidth, searchBarConfig, spacerUnits, statusOn, themeSwitchNext, widgetTone } from '../../core/engines/widgets';
import type { ActionButtonData, AvatarData, ClockData, CounterData, DividerData, LabelData, LinkData, LogoData, ProgressData, SearchBarData, SpacerData, StatusData, ThemeSwitchData } from '../../core/types';
import { useAxfState, useRuntime } from '../AxfProvider';
import { BannerClock } from './Banner';
import { Icon } from './Icon';
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

/** Tap target shared by the widgets that take a `link` / `action`: a button when there is one, a span otherwise. */
function Tap({ action, className, title, children, pressed }: { action?: string; className: string; title?: string; children: ReactNode; pressed?: boolean }) {
  const rt = useRuntime();
  return action
    ? <button type="button" className={`${className} is-tap`} title={title} aria-label={title} aria-pressed={pressed} onClick={() => rt.dispatch(action)}>{children}</button>
    : <span className={className} title={title}>{children}</span>;
}

export function LogoWidget({ data }: WidgetRenderProps<LogoData>) {
  const size = logoSize(data.size);
  const img = data.kind === 'image' ? imageSrc(data.image) : null;
  const body = data.kind === 'image' && img ? <img src={img} alt={data.text} style={{ height: size.px }} />
    : data.kind === 'icon' && data.icon ? <Icon name={data.icon} size={Math.round(size.px * 0.8)} />
    : <span className="fx-widget-logo__text" style={{ fontSize: `${size.scale}em`, fontWeight: data.bold === false ? 500 : 700 }}>{data.text}</span>;
  return <Tap action={data.link} className="fx-widget-logo" title={data.tooltip ?? data.text}>{body}</Tap>;
}

export function ActionButtonWidget({ data }: WidgetRenderProps<ActionButtonData>) {
  const rt = useRuntime();
  const tone = data.tone === 'accent' || data.tone === 'danger' ? data.tone : 'neutral';
  return (
    <button type="button" className={`fx-btn fx-btn--${tone} fx-widget-button is-${data.show}`} title={data.tooltip ?? data.label} aria-label={data.label} onClick={() => rt.dispatch(data.action)}>
      {data.show !== 'label' && <Icon name={data.icon} size={14} />}
      {data.show !== 'icon' && <span>{data.label}</span>}
    </button>
  );
}

export function LabelWidget({ data }: WidgetRenderProps<LabelData>) {
  return <span className={`fx-widget-label${data.bold ? ' is-bold' : ''}${data.mono ? ' is-mono' : ''}`} data-tone={widgetTone(data.tone)} title={data.tooltip}>{data.text}</span>;
}

export function StatusWidget({ data }: WidgetRenderProps<StatusData>) {
  const rt = useRuntime();
  useAxfState();
  const on = statusOn(rt.badge(data.counter));
  const text = on ? data.onLabel : data.offLabel;
  return (
    <Tap action={data.link} className={`fx-widget-status${on ? ' is-on' : ''}`} title={text}>
      {data.dot !== false && <span className="fx-widget-status__dot" data-tone={widgetTone(on ? data.onTone : data.offTone)} />}
      <span data-tone={widgetTone(on ? data.onTone : data.offTone)}>{text}</span>
    </Tap>
  );
}

export function CounterWidget({ data }: WidgetRenderProps<CounterData>) {
  const rt = useRuntime();
  useAxfState();
  const n = rt.badge(data.counter);
  const text = counterText(n, data.max, data.hideAtZero);
  if (!text) return null;
  return (
    <Tap action={data.link} className="fx-widget-counter" title={`${n} ${data.label ?? data.counter}`}>
      {data.icon && <Icon name={data.icon} size={13} />}
      <span className="fx-widget-counter__num" data-tone={widgetTone(data.tone)}>{text}</span>
      {data.label && <span className="fx-widget-counter__label">{data.label}</span>}
    </Tap>
  );
}

export function ProgressWidget({ data }: WidgetRenderProps<ProgressData>) {
  const rt = useRuntime();
  useAxfState();
  const pct = progressPercent(rt.badge(data.counter), data.max);
  return (
    <span className="fx-widget-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={data.label ?? data.counter} data-tone={widgetTone(data.tone, 'accent')}>
      {data.label && <span className="fx-widget-progress__label">{data.label}</span>}
      <span className="fx-widget-progress__bar" style={{ width: `calc(var(--fx-space) * ${progressWidth(data.width)})` }}><span className="fx-widget-progress__fill" style={{ width: `${pct}%` }} /></span>
      {data.showValue && <span className="fx-widget-progress__value">{pct}%</span>}
    </span>
  );
}

export function AvatarWidget({ data }: WidgetRenderProps<AvatarData>) {
  const rt = useRuntime();
  useAxfState();
  const px = avatarSize(data.size);
  const who = rt.boundPrincipal();
  const name = data.source === 'account' && who ? who.label : (data.text ?? '');
  const img = data.source === 'image' ? imageSrc(data.image) : null;
  const style = { width: px, height: px, fontSize: `${Math.max(0.6, px / 30)}em` };
  return (
    <Tap action={data.link} className={`fx-widget-avatar is-${data.shape}`} title={data.tooltip ?? name}>
      {img ? <img src={img} alt={name} style={style} /> : <span className="fx-widget-avatar__initials" style={style}>{avatarInitials(name)}</span>}
    </Tap>
  );
}

export function LinkWidget({ data }: WidgetRenderProps<LinkData>) {
  const href = linkHref(data.href);
  if (!href) return null;
  const ext = data.external !== false;
  return (
    <a className="fx-widget-link" href={href} title={data.tooltip ?? href} target={ext ? '_blank' : undefined} rel={ext ? 'noopener noreferrer' : undefined}>
      {data.icon && <Icon name={data.icon} size={13} />}
      <span>{data.label}</span>
    </a>
  );
}

export function ThemeSwitchWidget({ data }: WidgetRenderProps<ThemeSwitchData>) {
  const rt = useRuntime();
  const state = useAxfState();
  const active = state.active['color-theme'];
  const dark = active === data.dark;
  const next = themeSwitchNext(active, data.light, data.dark);
  const label = dark ? (data.lightLabel ?? 'Light') : (data.darkLabel ?? 'Dark');
  return (
    <button type="button" className={`fx-widget-theme is-${data.show}`} title={data.tooltip ?? `Switch to ${label.toLowerCase()} theme`} aria-label={`Switch to ${label} theme`} aria-pressed={dark} disabled={rt.lockedByAppearance('assets.swap')} onClick={() => rt.swap('color-theme', next)}>
      {data.show !== 'label' && <Icon name={dark ? 'sun' : 'moon'} size={14} />}
      {data.show !== 'icon' && <span>{label}</span>}
    </button>
  );
}

export function SpacerWidget({ data }: WidgetRenderProps<SpacerData>) {
  const u = spacerUnits(data.size);
  return <span className={`fx-widget-spacer${u < 0 ? ' is-flex' : ''}`} style={u < 0 ? undefined : { width: `calc(var(--fx-space) * ${u})` }} aria-hidden="true" />;
}

export function DividerWidget({ data }: WidgetRenderProps<DividerData>) {
  return <span className={`fx-widget-divider${data.inset === false ? '' : ' is-inset'}`} role="separator" aria-orientation="vertical" />;
}

registerWidgetRenderer<ClockData>('clock', ({ data }) => <BannerClock data={data} />);
registerWidgetRenderer<SearchBarData>('search-bar', SearchBarWidget);
registerWidgetRenderer<LogoData>('logo', LogoWidget);
registerWidgetRenderer<ActionButtonData>('action-button', ActionButtonWidget);
registerWidgetRenderer<LabelData>('label', LabelWidget);
registerWidgetRenderer<StatusData>('status', StatusWidget);
registerWidgetRenderer<CounterData>('counter', CounterWidget);
registerWidgetRenderer<ProgressData>('progress', ProgressWidget);
registerWidgetRenderer<AvatarData>('avatar', AvatarWidget);
registerWidgetRenderer<LinkData>('link', LinkWidget);
registerWidgetRenderer<ThemeSwitchData>('theme-switch', ThemeSwitchWidget);
registerWidgetRenderer<SpacerData>('spacer', SpacerWidget);
registerWidgetRenderer<DividerData>('divider', DividerWidget);

/** Draw a widget asset by type + id (nothing if it's gone or no renderer is registered for its type). */
export function WidgetView({ type, id, host }: { type: string; id: string; host?: string }) {
  const rt = useRuntime();
  const a = rt.registry.get(type as never, id) as { data: unknown } | undefined;
  const R = renderers.get(type);
  if (!a || !R) return null;
  // A widget whose tap is a hook the host app took over (embed@1 takes): an action button goes, others lose the tap.
  const d = a.data as { action?: unknown; link?: unknown } | null;
  if (rt.embedded?.takes?.length && d && typeof d === 'object') {
    const taken = (v: unknown) => typeof v === 'string' && rt.takenByHost({ action: v });
    if (taken(d.action)) { if (type === 'action-button') return null; return <R data={{ ...d, action: undefined }} id={id} host={host} />; }
    if (taken(d.link)) return <R data={{ ...d, link: undefined }} id={id} host={host} />;
  }
  return <R data={a.data} id={id} host={host} />;
}
