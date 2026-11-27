/**
 * check-theme rule *surface* (build transparency-token-works-every-dialog, Nov 13 2026): a CSS rule that sets the
 * background of a surface root without reading a transparency token (--fx-opacity-*) fails. Every surface's
 * see-through is a style-theme token (opacityDialog … opacityBanner, framework/core/engines/theme.ts SURFACE_KINDS).
 * Pure: imported by check-theme.mjs and framework/spec/check-surface-opacity.mts.
 */
export const SURFACE_ROOTS = ['fx-dialog', 'fx-window', 'fx-window__title', 'fx-popover', 'fx-dropdown', 'fx-ctx', 'fx-card', 'fx-toolbar', 'fx-menubar', 'fx-banner', 'fx-tabgroup', 'fx-tabgroup__bar'];
export const SURFACE_MSG = 'surface background ignores its transparency token; mix it with calc(var(--fx-opacity-<dialog|settings|panel|menu|toolbar|banner>) * 100%) and read var(--fx-backdrop-<kind>) (engines/theme.ts SURFACE_KINDS)';
const surfaceRoot = (selector) => selector.split(',').some((part) => {
  const last = part.trim().split(/[\s>+~]+/).pop() ?? '';
  if (/::/.test(last)) return false; // a pseudo-element is decoration, not the surface
  return SURFACE_ROOTS.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(last));
});
/** [line index, declaration] for each surface-root background that reads no --fx-opacity-* token. */
export function surfaceFindings(text) {
  const out = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!surfaceRoot(m[1].replace(/@[^{]*$/, ''))) continue;
    const bodyAt = m.index + m[0].indexOf('{') + 1;
    for (const d of m[2].matchAll(/(?<![\w-])background(?:-color)?\s*:\s*([^;]+)/g)) {
      const v = d[1].trim();
      if (/--fx-opacity-/.test(v) || /^(transparent|none|inherit|initial|unset)\b/.test(v)) continue;
      out.push([clean.slice(0, bodyAt + d.index).split('\n').length - 1, d[0].trim()]);
    }
  }
  return out;
}

