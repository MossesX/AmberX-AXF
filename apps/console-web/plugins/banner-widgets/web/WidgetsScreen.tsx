/*
 * Banner widgets: the one screen that lists every banner widget this plugin draws. Per widget: show or hide, move it up or
 * down (or to the other side), its size, its outline where the framework has widget shapes, and its icon. Every change is
 * saved at once and drawn at once. Sizes, outlines, hides and the order are the framework's widget choices (keyed
 * `type:id`), so this screen, the banner's own Widgets picker and voice can never disagree. Framework controls only.
 */
import * as bw from '@console/axf/core/engines/bannerwidgets';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Icon, IconButton, SelectField, Switch, useAxfState, useRuntime } from '@console/axf/react';
import { bannerData } from '@console/bannerData';
import { show } from './commands';
import { BADGES, ICONS, KINDS, iconOf, shownOf, type BadgeKind } from './model';
import { ICON_TYPES, WIDGETS, iconChoice, iconKeyOf, sideOf, switchedOn, widgetKey, type WidgetDef } from './registry';

const SIZE_LABEL: Record<string, string> = { icon: 'Icon only', compact: 'Compact', normal: 'Normal', wide: 'Wide' };
const SIDES = ['left', 'center', 'right'] as const;
const SIDE_LABEL: Record<string, string> = { left: 'Left', center: 'Centre', right: 'Right' };
/** widget-shape@1, when this framework has it (the outline a widget is clipped to); null on a framework without it. */
const SHAPES = ((bw as Record<string, unknown>).BANNER_WIDGET_SHAPES as readonly string[] | undefined)?.filter((s) => s !== 'custom') ?? null;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const P = 'axp-banner-widgets';

/** Where a widget is now: on the bar (side and place), or why it isn't. */
function where(rt: AxfRuntime, w: WidgetDef): { side: string; index: number; total: number } | null {
  const { placed } = rt.banner({ all: true });
  const key = widgetKey(w);
  for (const side of Object.keys(placed)) {
    const list = placed[side as keyof typeof placed];
    const i = list.findIndex((p) => p.key === key);
    if (i >= 0) return { side, index: i, total: list.length };
  }
  return null;
}

/** Shown, as the person sees it: its own switch and the framework's per-device hide. */
function isOn(rt: AxfRuntime, w: WidgetDef): boolean {
  const r = (k: string) => rt.settings.get(k);
  const own = w.source === 'own' ? shownOf(r, kindOf(w)!) : switchedOn(r, w);
  return own && !rt.bannerWidgetView(widgetKey(w)).hidden;
}
const kindOf = (w: WidgetDef): BadgeKind | null => KINDS.find((k) => BADGES[k].id === w.asset && w.type === 'badge') ?? null;

function status(rt: AxfRuntime, w: WidgetDef, at: ReturnType<typeof where>): string {
  if (at) return `${SIDE_LABEL[at.side] ?? at.side} · ${at.index + 1} of ${at.total}`;
  if (!isOn(rt, w)) return 'Hidden';
  if (w.source === 'supplied' && !bannerData(w.id)) return w.idle ?? 'Nothing to show yet';
  return 'Not on the bar right now';
}

function IconPick({ rt, w }: { rt: AxfRuntime; w: WidgetDef }) {
  const k = kindOf(w);
  if (k) return <Button size="sm" tone="ghost" icon={iconOf((x) => rt.settings.get(x), k, 'ok')} onClick={() => rt.dispatch(`settings.open:banner-widgets`)}>Icon per state below</Button>;
  if (!ICON_TYPES.includes(w.type)) return <span className="fx-small fx-muted">A status light: no icon</span>;
  const now = iconChoice((x) => rt.settings.get(x), w, ICONS) ?? '';
  return (
    <SelectField label="Icon" value={now} empty="Its own" options={ICONS.map((i) => ({ value: i, label: cap(i) }))}
      onChange={(v) => { if (v) void rt.settings.set(iconKeyOf(w), v); else rt.settings.clear(iconKeyOf(w)); }} />
  );
}

function Row({ rt, w }: { rt: AxfRuntime; w: WidgetDef }) {
  const key = widgetKey(w);
  const at = where(rt, w);
  const on = isOn(rt, w);
  const view = rt.bannerWidgetView(key);
  const pref = rt.bannerWidgetPrefs()[key] as Record<string, unknown> | undefined;
  const move = (side: string, index: number) => rt.moveHostItem('banner', key, side, index);
  return (
    <li className={`${P}__row`} data-axf-target={`widget:${w.id}`}>
      <div className={`${P}__head`}>
        <Icon name={w.hint.icon ?? (w.type === 'status' ? 'eye' : 'star')} size={16} />
        <span className={`${P}__name`}><b>{w.title}</b><span className="fx-small fx-muted">{status(rt, w, at)}{w.source === 'supplied' ? ' · data from its plugin' : ''}</span></span>
        {at && <IconButton icon="chevron-up" label={`Move ${w.title} up`} disabled={at.index === 0} onClick={() => move(at.side, at.index - 1)} />}
        {at && <IconButton icon="chevron-down" label={`Move ${w.title} down`} disabled={at.index === at.total - 1} onClick={() => move(at.side, at.index + 1)} />}
        <Switch label={`Show ${w.title}`} hideLabel checked={on} onChange={(v) => show(rt, w, v)} />
      </div>
      {on && (
        <div className={`${P}__fields`}>
          <SelectField label="Side" value={at?.side ?? sideOf((x) => rt.settings.get(x), w)} disabled={!at} options={SIDES.map((s) => ({ value: s, label: SIDE_LABEL[s] ?? s }))} onChange={(v) => move(v, 999)} />
          <SelectField label="Size" value={view.size} options={bw.BANNER_WIDGET_SIZES.map((s) => ({ value: s, label: SIZE_LABEL[s] ?? s }))} onChange={(v) => rt.setBannerWidget(key, { size: v })} />
          {SHAPES && <SelectField label="Shape" value={typeof pref?.shape === 'string' ? pref.shape : ''} empty="Its own" options={SHAPES.map((s) => ({ value: s, label: cap(s) }))} onChange={(v) => rt.setBannerWidget(key, { shape: v || null })} />}
          <IconPick rt={rt} w={w} />
          <Button size="sm" tone="ghost" icon="sliders" onClick={() => rt.dispatch(`banner.widgets:${key}`)}>More</Button>
        </div>
      )}
    </li>
  );
}

/** Every widget this plugin draws, left side first, each with its controls. */
export function WidgetsScreen() {
  useAxfState();
  const live = useRuntime();
  const rows = [...WIDGETS].sort((a, b) => (a.at === b.at ? a.order - b.order : a.at === 'left' ? -1 : 1));
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Every chip and badge this plugin puts on the banner. Other plugins only hand over their numbers; whether a widget shows, where, how big, its shape and its icon are set here. Hiding one here hides it on this kind of device (phone or desktop).</p>
      <ul className={`${P}__list`}>{rows.map((w) => <Row key={w.id} rt={live} w={w} />)}</ul>
      <div className="fx-row fx-row--wrap">
        <Button icon="layout" onClick={() => live.dispatch('banner.widgets')}>All banner widgets (clock, search…)</Button>
        <Chip tone="accent">{WIDGETS.filter((w) => isOn(live, w)).length} of {WIDGETS.length} on</Chip>
      </div>
    </div>
  );
}
