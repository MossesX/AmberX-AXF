/**
 * Brand library — what a tile (and the preview) draws for each type. SVG comes from the brand engine (`markSvg`,
 * `glyphSvg`: path data + one text node, colours as tokens or the mark's own palette), so inserting it is safe by
 * construction. Animated marks use the engine's `animationFor` and the framework's `fx-brand-*` keyframes.
 */
import type { CSSProperties } from 'react';
import { animationFor, glyphSvg, markSvg } from '@console/axf/core';
import type { LibAsset } from './model';

export type MarkIndex = Map<string, LibAsset>;

/** A logo mark at `height` px (lockups and wordmarks draw their text). */
export function MarkArt({ mark, height, title }: { mark: LibAsset | undefined; height: number; title?: string }) {
  if (!mark) return <span className="axp-brand-library__missing">?</span>;
  return <span className="axp-brand-library__art" aria-hidden={title ? undefined : 'true'} dangerouslySetInnerHTML={{ __html: markSvg(mark.data, { height, title: title ?? '' }) }} />;
}

/** An animated logo: its mark with the engine's animation (`play` restarts it by remounting; reduced motion = still). */
export function AnimatedArt({ anim, marks, height, play, motion }: { anim: LibAsset; marks: MarkIndex; height: number; play: number; motion: boolean }) {
  const mark = marks.get(String(anim.data.mark ?? ''));
  const reduced = !motion || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const a = animationFor(anim.data, reduced);
  if (!mark) return <span className="axp-brand-library__missing">?</span>;
  // the tile plays on hover (the asset's own loop setting is kept for the preview)
  const style = a ? ({ ...a.vars, animationName: a.name, animationDuration: `${a.durationMs}ms`, animationDelay: `${a.delayMs}ms`, animationIterationCount: a.iteration } as CSSProperties) : undefined;
  return <span key={play} className={`axp-brand-library__art ${a?.className ?? ''}`} style={style} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markSvg(mark.data, { height, title: '' }) }} />;
}

/** The glyph names a pack tile shows first (most packs have all of them). */
export const SAMPLE_GLYPHS = ['home', 'search', 'settings', 'bell', 'star', 'check', 'plus', 'grid', 'layers', 'package', 'menu', 'x'];

/** A row (or block) of an icon pack's glyphs. */
export function PackArt({ pack, size, count }: { pack: LibAsset; size: number; count: number }) {
  const names = Object.keys((pack.data.glyphs as Record<string, unknown>) ?? {});
  const pick = [...SAMPLE_GLYPHS.filter((n) => names.includes(n)), ...names.filter((n) => !SAMPLE_GLYPHS.includes(n))].slice(0, count);
  return (
    <span className="axp-brand-library__glyphs" aria-hidden="true">
      {pick.map((n) => <span key={n} className="axp-brand-library__glyph" title={n} dangerouslySetInnerHTML={{ __html: glyphSvg(pack.data, n, size) ?? '' }} />)}
    </span>
  );
}

/** A branding package: its lockup (or mark) and its palette. */
export function BrandingArt({ brand, marks, height }: { brand: LibAsset; marks: MarkIndex; height: number }) {
  const m = (brand.data.marks as Record<string, string>) ?? {};
  const mark = marks.get(m.lockup ?? '') ?? marks.get(m.wordmark ?? '') ?? marks.get(m.mark ?? '');
  const palette = Object.values((brand.data.palette as Record<string, string>) ?? {}).slice(0, 4);
  return (
    <span className="axp-brand-library__branding">
      <MarkArt mark={mark} height={height} />
      {/* the package's own brand colours: data, shown as-is */}
      <span className="axp-brand-library__swatches" aria-hidden="true">{palette.map((c, i) => <span key={i} className="axp-brand-library__swatch" style={{ background: c }} />)}</span>
    </span>
  );
}

/** One tile's art at a given mark height. */
export function TileArt({ a, marks, height, motion }: { a: LibAsset; marks: MarkIndex; height: number; motion: boolean }) {
  if (a.type === 'logo-mark') return <MarkArt mark={a} height={height} />;
  if (a.type === 'animated-logo') return <AnimatedArt anim={a} marks={marks} height={height} play={0} motion={motion} />;
  if (a.type === 'icon-pack') return <PackArt pack={a} size={Math.round(height * 0.6)} count={6} />;
  return <BrandingArt brand={a} marks={marks} height={Math.round(height * 0.8)} />;
}
