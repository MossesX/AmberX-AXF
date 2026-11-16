/**
 * Built-in icon set (24px grid, stroke-based; the paths live in core/engines/icon-glyphs.mjs, shared with the icon engines and the starter default pack). Assets reference icons by name. When the app's branding package names
 * an icon pack (icon-pack@1) that has a glyph of that name, the pack's glyph is drawn instead, in the pack's own
 * style (stroke / fill / duotone); names the pack lacks keep the framework icon, so a partial pack is fine.
 */
import { useSyncExternalStore } from 'react';
import { useOptionalRuntime } from '../AxfProvider';
import { FRAMEWORK_GLYPHS } from '../../core/engines/icon-glyphs.mjs';

const PATHS: Record<string, string> = FRAMEWORK_GLYPHS;

export const ICON_NAMES = Object.keys(PATHS);

const noStore = { subscribe: () => () => {}, get: () => null };

export function Icon({ name, size = 16, className }: { name?: string; size?: number; className?: string }) {
  const rt = useOptionalRuntime();
  useSyncExternalStore(rt ? rt.subscribe : noStore.subscribe, rt ? rt.getState : noStore.get, rt ? rt.getState : noStore.get);
  if (!name) return null;
  // the icon scope chain (icon-scope@1, spec/ICON-MAP.md): picks, skins' packs, the branding's pack; null = the framework glyph
  const svg = rt ? rt.iconMarkup('', name, size) : '';
  if (svg) return <span className={`fx-icon fx-icon--pack ${className ?? ''}`} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
  const d = PATHS[name] ?? PATHS.box;
  return (
    <svg
      className={`fx-icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
