/**
 * widget-shape@1 on a widget's host item (banner items, the banner strip, the ⋯ menu, toolbar widget slots): the one
 * place the React port turns the engine's resolved shape (rt.bannerWidgetShape → core/engines/bannerwidgets.ts) into
 * attributes on the item around a widget. The body inside is left alone, so its role, aria and data-axf-target stay
 * what the widget draws, and the SkinScope around the shell still reaches it.
 *
 *   data-fx-wshape   the shape it resolved to (always; CSS hooks the per-shape room for pill / hexagon / custom)
 *   data-fx-shaped   set when the shape was chosen (a pick or a hint): ui/axf.css clips the item's body to the tokens
 *   style            the compiled tokens inline (--fx-widget-shape-radius / -clip / --fx-widget-icon) for a chosen shape;
 *                    a default leaves the host's own widget shape (customize widgetShape) in force
 *
 * The icon override is not an attribute: the host wraps the body in <IconOverride icon={shape.icon}> so every Icon the
 * widget draws swaps its glyph (components/Icon.tsx).
 */
import { BANNER_WIDGET_CUSTOM_PATH, BANNER_WIDGET_SHAPES, WIDGET_ICON_OWN, WIDGET_SHAPE_PRESETS, customPathClip, widgetShapeTokens, type ResolvedWidgetShape } from '../../core/engines/bannerwidgets';
import type { AxfRuntime } from '../../core/runtime';
import { addDerivedTargets, type ControlTargetDef } from '../controlTargets';

export function widgetShapeAttrs(shape: ResolvedWidgetShape): { attrs: Record<string, string | undefined>; style: Record<string, string> } {
  return {
    attrs: { 'data-fx-wshape': shape.shape, 'data-fx-shaped': shape.explicit ? '' : undefined },
    style: shape.explicit ? widgetShapeTokens(shape) : {},
  };
}

/** The resolved shape of a widget by its `type:id` key (the same per-widget choice wherever it is attached). */
export function widgetShapeOf(rt: AxfRuntime, key: string): ResolvedWidgetShape {
  return rt.bannerWidgetShape(key);
}

/** Item props for a widget slot that has no other inline style (toolbar widgets): attributes + the token style. */
export function widgetShapeItemProps(rt: AxfRuntime, key: string): Record<string, unknown> {
  const { attrs, style } = widgetShapeAttrs(widgetShapeOf(rt, key));
  return { ...attrs, ...(Object.keys(style).length ? { style } : {}) };
}

/* ---------------- console-control@1 targets (REST, MCP, CLI, voice, Ctrl+K) ---------------- */

/**
 * Every banner widget's shape, icon and custom outline as console-control targets, derived from state (not mounted
 * elements), appended after the chrome instance settings in the control registry:
 *
 *   setting:banner.widget.<widget>.shape          circle | square | rounded | pill | hexagon (custom: set .path)
 *   setting:banner.widget.<widget>.icon           <icon pack>/<glyph> | own
 *   setting:banner.widget.<widget>.path           an SVG outline (shape custom), empty = back to circle
 *   function:banner.widget.<widget>.reset         every choice of that widget back to its default
 *   function:banner.widget.<widget>.change-icon   opens the Change icon dialog (panel:axf.banner.widget-icon)
 *   function:banner.widget.<widget>.custom-shape  opens the custom shape editor (panel:axf.banner.widget-shape)
 *   function:banner.widget.shape-menu             the right-click Shape ▸ submenu: press with "<widget>:<shape>"
 *
 * Each runs the same banner.widget… action as the UI, so every surface agrees.
 */
export const WIDGET_SHAPE_TARGET_PREFIX = 'banner.widget.';

export function widgetShapeTargets(rt: AxfRuntime): ControlTargetDef[] {
  const out: ControlTargetDef[] = [];
  const errorOf = (before: string, after: string, what: string) => (before === after ? what : undefined);
  for (const w of rt.bannerWidgets()) {
    const id = `${WIDGET_SHAPE_TARGET_PREFIX}${w.key}`;
    const detail = `Banner widget · ${w.label}`;
    const keywords = [w.label, w.type, w.id, 'banner', 'widget', ...w.aliases];
    const open = () => rt.dispatch(`banner.widgets:${w.key}`);
    const shapeNow = () => rt.bannerWidgetShape(w.key);
    const prefs = () => rt.bannerWidgetPrefs()[w.key] ?? {};
    out.push(
      { address: `setting:${id}.shape`, kind: 'setting', label: `${w.label} · Shape`, detail, icon: 'box', keywords: [...keywords, 'shape'], requires: 'assets.swap', can: ['open', 'state', 'set'], open,
        get: () => rt.bannerWidgetView(w.key).shape,
        set: (v) => {
          const s = String(v ?? '').trim().toLowerCase();
          if (s === 'custom') return 'Set a custom outline through setting …path (an SVG outline in a 0..100 square)';
          if (!(BANNER_WIDGET_SHAPES as readonly string[]).includes(s)) return `${w.label} Shape takes ${BANNER_WIDGET_SHAPES.filter((x) => x !== 'custom').join(', ')} (not "${s}")`;
          rt.dispatch(`banner.widget:${w.key}:${s}`);
          return undefined;
        },
        state: () => { const r = shapeNow(); return { type: 'choice', options: [...BANNER_WIDGET_SHAPES], shape: r.shape, explicit: r.explicit, fell: r.fell, radius: r.radius, clip: r.clip }; } },
      { address: `setting:${id}.icon`, kind: 'setting', label: `${w.label} · Icon`, detail, icon: 'palette', keywords: [...keywords, 'icon'], requires: 'assets.swap', can: ['open', 'state', 'set'], open: () => rt.dispatch(`banner.widget.icon-picker:${w.key}`),
        get: () => { const o = prefs().iconOverride ?? w.view.iconOverride; return o ? `${o.pack}/${o.id}` : WIDGET_ICON_OWN; },
        set: (v) => {
          const s = String(v ?? '').trim();
          const before = JSON.stringify(prefs().iconOverride ?? null);
          rt.dispatch(`banner.widget:${w.key}:icon=${s || WIDGET_ICON_OWN}`);
          return s && s !== WIDGET_ICON_OWN ? errorOf(before, JSON.stringify(prefs().iconOverride ?? null), `"${s}" is not <icon pack id>/<glyph> of a registered pack (or own)`) : undefined;
        },
        state: () => ({ type: 'icon', icon: shapeNow().icon, own: w.icon ?? null }) },
      { address: `setting:${id}.path`, kind: 'setting', label: `${w.label} · Custom outline`, detail, icon: 'edit', keywords: [...keywords, 'custom', 'outline', 'path'], requires: 'assets.swap', can: ['open', 'state', 'set'], open: () => rt.dispatch(`banner.widget.custom-shape:${w.key}`),
        get: () => prefs().customPath ?? w.view.customPath ?? '',
        set: (v) => {
          const d = String(v ?? '').trim();
          if (!d) { rt.dispatch(`banner.widget:${w.key}:circle`); return undefined; }
          if (!customPathClip(d)) return 'A custom shape is one closed SVG outline (M L H V C S Q T Z) inside a 0..100 square, e.g. M50 0 L100 50 L50 100 L0 50 Z';
          rt.dispatch(`banner.widget:${w.key}:path=${d}`);
          return undefined;
        },
        state: () => ({ type: 'path', max: BANNER_WIDGET_CUSTOM_PATH.max, presets: WIDGET_SHAPE_PRESETS.map((p) => p.id) }) },
      { address: `function:${id}.reset`, kind: 'function', label: `${w.label} · Back to default`, detail, icon: 'undo', keywords: [...keywords, 'reset'], requires: 'assets.swap', invoke: () => rt.dispatch(`banner.widget:${w.key}:reset`) },
      { address: `function:${id}.change-icon`, kind: 'function', label: `${w.label} · Change icon…`, detail, icon: 'palette', keywords: [...keywords, 'change icon', 'icon picker'], requires: 'assets.swap', invoke: () => rt.dispatch(`banner.widget.icon-picker:${w.key}`) },
      { address: `function:${id}.custom-shape`, kind: 'function', label: `${w.label} · Custom shape…`, detail, icon: 'box', keywords: [...keywords, 'custom shape', 'outline editor'], requires: 'assets.swap', invoke: () => rt.dispatch(`banner.widget.custom-shape:${w.key}`) },
    );
  }
  out.push({
    address: `function:${WIDGET_SHAPE_TARGET_PREFIX}shape-menu`, kind: 'function', label: 'Banner widget · Shape ▸', detail: 'The Shape submenu on a widget’s right-click menu: press with "<widget>:<shape>"', icon: 'box', keywords: ['shape', 'banner', 'widget', 'menu'], requires: 'assets.swap',
    invoke: (v) => { const s = String(v ?? ''); const at = s.lastIndexOf(':'); if (at > 0) rt.dispatch(`banner.widget:${s}`); return at > 0 ? undefined : 'Press with "<widget>:<shape>", e.g. clock:hexagon'; },
  });
  return out;
}

/** Register the widget shape targets once per runtime (BannerSettings installs it with the banner actions). */
const installed = new WeakSet<AxfRuntime>();
export function installWidgetShapeTargets(rt: AxfRuntime): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  addDerivedTargets(rt, () => widgetShapeTargets(rt));
}
