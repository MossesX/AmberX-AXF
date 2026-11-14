/** Theme stylesheet from the baked framework themes (bake.mjs): one :root block per colour + style theme pair. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadThemes(bakedDir) {
  return JSON.parse(readFileSync(join(bakedDir, 'themes.json'), 'utf8'));
}

export function themeList(themes) {
  return {
    color: Object.entries(themes.color).map(([id, t]) => ({ id, name: t.name, scheme: t.scheme })),
    style: Object.entries(themes.style).map(([id, t]) => ({ id, name: t.name })),
  };
}

/** The :root variables for a colour theme + style theme (unknown ids fall back to the given defaults). */
export function themeCss(themes, colorId, styleId, fallback) {
  const color = themes.color[colorId] ?? themes.color[fallback.colorTheme];
  const style = themes.style[styleId] ?? themes.style[fallback.styleTheme];
  const vars = { ...(style?.vars ?? {}), ...themes.scale, ...(color?.vars ?? {}) };
  const body = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `:root {\n  color-scheme: ${color?.scheme === 'light' ? 'light' : 'dark'};\n${body}\n}\n`;
}
