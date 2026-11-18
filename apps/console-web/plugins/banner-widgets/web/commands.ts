/**
 * Banner widgets: the actions that reach every widget from the API, MCP, the CLI and voice (control@1 console domain, picked
 * up by plugin-commands auto). A widget is named by its id, its key, its title, an alias or the plugin that used to own it
 * ("project", "ticker", "the bell", or a former owner's plugin id or folder); registry.ts findWidget.
 *
 *   banner-widgets.open                       the settings screen
 *   banner-widgets.show:<widget>              on (its switch on, the per-device hide cleared)
 *   banner-widgets.hide:<widget>              off on this kind of device
 *   banner-widgets.move:<widget>:<where>      up | down | first | last | left | right | center
 *   banner-widgets.size:<widget>:<size>       icon | compact | normal | wide | reset
 *   banner-widgets.shape:<widget>:<shape>     the framework's widget shapes, or reset
 *   banner-widgets.icon:<widget>:<icon>       an icon name, or reset (counters and buttons; badges have one per state)
 */
import type { AxfRuntime } from '@console/axf/core';
import { BADGES, ICONS, KINDS, keyOf } from './model';
import { ICON_TYPES, findWidget, iconKeyOf, widgetKey, type WidgetDef } from './registry';

const SIZES = ['icon', 'compact', 'normal', 'wide'];
const TITLE = 'Banner widgets';

function pick(rt: AxfRuntime, args: string[], take = 1): { w: WidgetDef; rest: string[] } | null {
  const rest = args.slice(args.length - take + 1);
  const q = decodeURIComponent(args.slice(0, args.length - take + 1).join(':'));
  const w = findWidget(q);
  if (!w) { rt.toast(`No banner widget called "${q}".`, 'warning', TITLE); return null; }
  return { w, rest };
}

function place(rt: AxfRuntime, w: WidgetDef): { side: string; index: number; total: number } | null {
  const { placed } = rt.banner({ all: true });
  for (const side of Object.keys(placed)) {
    const list = placed[side as keyof typeof placed];
    const i = list.findIndex((p) => p.key === widgetKey(w));
    if (i >= 0) return { side, index: i, total: list.length };
  }
  return null;
}

const badgeKind = (w: WidgetDef) => KINDS.find((k) => w.type === 'badge' && BADGES[k].id === w.asset) ?? null;

export function show(rt: AxfRuntime, w: WidgetDef, on: boolean): void {
  if (on) {
    const k = badgeKind(w);
    if (k) void rt.settings.set(keyOf(k, 'show'), true);
    else {
      if (w.showKey && rt.settings.get(w.showKey) === false) void rt.settings.set(w.showKey, true);
      if (w.when && rt.settings.get(w.when.key) === w.when.off) void rt.settings.set(w.when.key, w.when.default);
    }
  }
  rt.setBannerWidget(widgetKey(w), { hidden: on ? null : true });
}

export function registerCommands(rt: AxfRuntime): void {
  const a = rt.actions;
  a.register('banner-widgets.open', () => rt.dispatch('settings.open:banner-widgets'), { label: 'Banner widgets settings', effect: 'navigate' });
  a.register('banner-widgets.show', (args) => { const p = pick(rt, args); if (p) show(rt, p.w, true); }, { label: 'Show a banner widget', params: true, effect: 'write', requires: 'assets.swap' });
  a.register('banner-widgets.hide', (args) => { const p = pick(rt, args); if (p) show(rt, p.w, false); }, { label: 'Hide a banner widget', params: true, effect: 'write', requires: 'assets.swap' });
  a.register('banner-widgets.move', (args) => {
    const p = pick(rt, args, 2);
    if (!p) return;
    const to = (p.rest[0] ?? '').toLowerCase();
    const at = place(rt, p.w);
    if (!at) { rt.toast(`${p.w.title} isn't on the banner right now.`, 'warning', TITLE); return; }
    const key = widgetKey(p.w);
    if (to === 'left' || to === 'right' || to === 'center') rt.moveHostItem('banner', key, to, 999);
    else if (to === 'up') rt.moveHostItem('banner', key, at.side, Math.max(0, at.index - 1));
    else if (to === 'down') rt.moveHostItem('banner', key, at.side, at.index + 1);
    else if (to === 'first') rt.moveHostItem('banner', key, at.side, 0);
    else if (to === 'last') rt.moveHostItem('banner', key, at.side, 999);
    else rt.toast('Move it up, down, first, last, left, right or center.', 'warning', TITLE);
  }, { label: 'Move a banner widget', params: true, effect: 'write', requires: 'assets.swap' });
  a.register('banner-widgets.size', (args) => {
    const p = pick(rt, args, 2);
    if (!p) return;
    const v = (p.rest[0] ?? '').toLowerCase();
    if (v === 'reset') rt.setBannerWidget(widgetKey(p.w), { size: null });
    else if (SIZES.includes(v)) rt.setBannerWidget(widgetKey(p.w), { size: v });
    else rt.toast(`Sizes: ${SIZES.join(', ')} or reset.`, 'warning', TITLE);
  }, { label: 'Size a banner widget', params: true, effect: 'write', requires: 'assets.swap' });
  a.register('banner-widgets.shape', (args) => {
    const p = pick(rt, args, 2);
    if (!p) return;
    const v = (p.rest[0] ?? '').toLowerCase();
    rt.setBannerWidget(widgetKey(p.w), { shape: v === 'reset' || !v ? null : v });
  }, { label: 'Shape a banner widget', params: true, effect: 'write', requires: 'assets.swap' });
  a.register('banner-widgets.icon', (args) => {
    const p = pick(rt, args, 2);
    if (!p) return;
    const v = (p.rest[0] ?? '').toLowerCase();
    if (!ICON_TYPES.includes(p.w.type)) { rt.toast(badgeKind(p.w) ? `${p.w.title} has an icon per state: Settings → Plugins → Banner widgets.` : `${p.w.title} is a status light: it has no icon.`, 'info', TITLE); return; }
    if (v === 'reset' || !v) rt.settings.clear(iconKeyOf(p.w));
    else if (ICONS.includes(v)) void rt.settings.set(iconKeyOf(p.w), v);
    else rt.toast(`Icons: ${ICONS.join(', ')} or reset.`, 'warning', TITLE);
  }, { label: 'Change a banner widget\'s icon', params: true, effect: 'write', requires: 'assets.swap' });
}
