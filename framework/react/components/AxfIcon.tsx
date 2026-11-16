/**
 * <AxfIcon spot="<app>:<area>/<slot>" name="…"> — an icon drawn at a registered spot (icon-map@1, spec/ICON-MAP.md).
 *
 * The spot is registered with the runtime on mount (rt.registerIconSpot: an icon-map asset's entry wins over it), and
 * the glyph is resolved through the icon scope chain (icon-scope@1: per-spot overrides, the packs picked here, the
 * skins' packs, the branding's pack, the framework glyph set) — so swapping a pack or an override anywhere re-renders
 * every spot live. Size and tint are tokens only: `size` is a spot size token (`icon`, `icon-button`, `badge`,
 * `app-icon`, `inline`, or a `--fx-size-*` token name) and `tint` a colour token (`text` = inherit, `muted`, `accent`,
 * …); a number is accepted for legacy callers and treated as px. Without a runtime the framework glyph is drawn.
 *
 *   useIconSpot(spot, name)   the resolution for custom renderers: `{ resolved, markup, size, tint }`
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useOptionalRuntime } from '../AxfProvider';
import { markColor } from '../../core/engines/brand';
import { FRAMEWORK_GLYPH_GRID, FRAMEWORK_GLYPH_STROKE, frameworkGlyph } from '../../core/engines/icon-glyphs.mjs';
import { SIZE_TOKEN, SPOT_ID, TINT_TOKENS, type SpotKind } from '../../core/engines/icon-rules.mjs';
import type { ResolvedIcon } from '../../core/engines/icon-pack';

/** Spot size tokens → the CSS size they draw at (tokens only; the scale assets size them). */
export const ICON_SIZE_CSS: Record<string, string> = {
  icon: 'var(--fx-size-button-icon)',
  'icon-button': 'var(--fx-size-icon-button-size)',
  badge: 'var(--fx-size-chip-font)',
  'app-icon': 'calc(var(--fx-size-icon-button-size) * 2)',
  inline: '1em',
};

/** The CSS size for a spot size token (or a number of px for legacy callers). */
export function iconSizeCss(size: string | number | undefined): string {
  if (typeof size === 'number') return `${size}px`;
  if (!size) return ICON_SIZE_CSS.icon;
  if (size in ICON_SIZE_CSS) return ICON_SIZE_CSS[size];
  if (SIZE_TOKEN.test(size)) return `var(${size})`;
  return ICON_SIZE_CSS.icon;
}

/** The CSS colour for a tint token; '' for `text` / unknown (inherit, the icon follows its parent). */
export function iconTintCss(tint: string | undefined): string {
  if (!tint || tint === 'text' || tint === 'currentColor' || !TINT_TOKENS.includes(tint)) return '';
  return markColor(tint);
}

const noStore = { subscribe: () => () => {}, get: () => null };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The framework glyph as inline SVG (the floor every spot stands on). */
export function frameworkGlyphMarkup(name: string, size: string, title?: string): string {
  const d = frameworkGlyph(name) || frameworkGlyph('box');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAMEWORK_GLYPH_GRID} ${FRAMEWORK_GLYPH_GRID}" width="${esc(size)}" height="${esc(size)}" fill="none" stroke="currentColor" stroke-width="${FRAMEWORK_GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="${title ? 'false' : 'true'}"${title ? ` role="img" aria-label="${esc(title)}"` : ''}><path d="${esc(d)}"/></svg>`;
}

export interface IconSpotView {
  /** the resolution (null without a runtime) */
  resolved: ResolvedIcon | null;
  /** inline SVG to draw: the pack's glyph, or the framework glyph */
  markup: string;
  size: string;
  tint: string;
}

/**
 * Resolve a spot here and now; re-renders on every runtime change (pack / override / skin / scope). `name` is the glyph
 * name (the spot's default, or the run-time name of a dynamic spot).
 */
export function useIconSpot(spot: string, name = '', opts: { size?: string | number; tint?: string; title?: string; kind?: SpotKind; register?: boolean } = {}): IconSpotView {
  const rt = useOptionalRuntime();
  useSyncExternalStore(rt ? rt.subscribe : noStore.subscribe, rt ? rt.getState : noStore.get, rt ? rt.getState : noStore.get);
  const valid = SPOT_ID.test(spot);
  useEffect(() => {
    if (!rt || !valid || opts.register === false) return;
    return rt.registerIconSpot({ id: spot, kind: opts.kind ?? 'icon', glyph: name, ...(opts.size && typeof opts.size === 'string' ? { size: opts.size } : {}), ...(opts.tint ? { tint: opts.tint } : {}) });
  }, [rt, spot, name, valid, opts.kind, opts.size, opts.tint, opts.register]);
  const size = iconSizeCss(opts.size);
  const tint = iconTintCss(opts.tint);
  if (!rt) return { resolved: null, markup: frameworkGlyphMarkup(name, size, opts.title), size, tint };
  const resolved = rt.resolveIconSpot(valid ? spot : '', name);
  const markup = (resolved.glyph && resolved.packData ? rt.iconMarkup(valid ? spot : '', name, size, opts.title) : '') || frameworkGlyphMarkup(resolved.name || name, size, opts.title);
  return { resolved, markup, size, tint };
}

export interface AxfIconProps {
  /** `<app>:<area>/<slot>` (spec/ICON-MAP.md) */
  spot: string;
  /** the glyph name: the spot's default, or the run-time name of a dynamic spot */
  name?: string;
  kind?: SpotKind;
  /** a spot size token (icon | icon-button | badge | app-icon | inline | --fx-size-*), or px for legacy callers */
  size?: string | number;
  /** a colour token (text = inherit) */
  tint?: string;
  title?: string;
  className?: string;
  /** false: draw without registering the spot (previews in the designer) */
  register?: boolean;
}

export function AxfIcon({ spot, name = '', kind, size, tint, title, className, register }: AxfIconProps) {
  const v = useIconSpot(spot, name, { size, tint, title, kind, register });
  const style: Record<string, string> = { width: v.size, height: v.size };
  if (v.tint) style.color = v.tint;
  return (
    <span
      className={`fx-icon fx-icon--spot${v.resolved && v.resolved.by !== 'framework' ? ' fx-icon--pack' : ''} ${className ?? ''}`}
      style={style}
      data-fx-icon-spot={spot}
      data-fx-icon-by={v.resolved?.by ?? 'framework'}
      aria-hidden={title ? undefined : 'true'}
      dangerouslySetInnerHTML={{ __html: v.markup }}
    />
  );
}
