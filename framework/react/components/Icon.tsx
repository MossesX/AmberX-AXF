/**
 * The framework's icon (icon-map@1). Draws a glyph by name from the framework glyph set (core/engines/glyphs.mjs, one
 * list shared with the icon map engine and the CI check) or, when the app's branding or skin names an icon pack
 * (icon-pack@1) that has that glyph, the pack's glyph in the pack's own style (stroke / fill / duotone). Names the pack
 * lacks keep the framework icon, so a partial pack is fine.
 *
 * `slot` / `role` tie a place to the icon map: a saved per-slot pick (`axf.icons.slot.<id>`) wins, then the active
 * pack's role mapping (`roles[role]`), then the name itself (runtime.iconGlyph). Code that gives neither still takes
 * part through the pack's role mapping of the glyph's own name.
 */
import { useSyncExternalStore } from 'react';
import { useOptionalRuntime } from '../AxfProvider';
import { glyphSvg } from '../../core/engines/brand';
import { GLYPHS, GLYPH_FALLBACK, GLYPH_NAMES, GLYPH_STROKE, glyphPath } from '../../core/engines/glyphs.mjs';

/** The framework glyph names (icon pickers list them). */
export const ICON_NAMES: string[] = [...GLYPH_NAMES];
export { GLYPHS as ICON_PATHS };

const noStore = { subscribe: () => () => {}, get: () => null };

export function Icon({ name, size = 16, className, slot, role }: { name?: string; size?: number; className?: string; slot?: string; role?: string }) {
  const rt = useOptionalRuntime();
  useSyncExternalStore(rt ? rt.subscribe : noStore.subscribe, rt ? rt.getState : noStore.get, rt ? rt.getState : noStore.get);
  if (!name && !role && !slot) return null;
  const drawn = rt ? rt.iconGlyph(name ?? '', slot, role) : (name ?? GLYPH_FALLBACK);
  const packed = rt?.brandGlyph(drawn);
  if (packed) {
    const svg = glyphSvg(packed.pack, drawn, size);
    if (svg) return <span className={`fx-icon fx-icon--pack ${className ?? ''}`} style={{ width: size, height: size }} data-fx-icon={drawn} data-fx-slot={slot} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  const d = glyphPath(drawn);
  return (
    <svg
      className={`fx-icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={GLYPH_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-fx-icon={drawn}
      data-fx-slot={slot}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
