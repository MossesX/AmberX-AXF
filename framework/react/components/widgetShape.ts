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
import { widgetShapeTokens, type ResolvedWidgetShape } from '../../core/engines/bannerwidgets';
import type { AxfRuntime } from '../../core/runtime';

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
