/**
 * Compiles the token set of every skin in framework/assets/skin through the real engines, so the staged designer mock
 * (build.mjs → ../../designer-mock.html) draws with the same --fx-* variables and data attributes the console would:
 * colour theme, style theme (surfaces, scrollbar), the scale assets (typography, density, sizing), the layout, and the
 * component styles the skin picks (button, container, toolbar, tab group). Nothing here is invented: a value the
 * runtime would not emit is not emitted.
 *
 *   npx -y tsx apps/amberx-droid/walkthrough/series/mock/tokens.mts        # writes tokens.json next to this file
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { colorThemeVars, scrollbarVars, styleThemeVars, surfaceThemeVars } from '../../../../../framework/core/engines/theme';
import { scaleThemeVars } from '../../../../../framework/core/engines/scale';
import { layoutVars } from '../../../../../framework/core/engines/layout';
import { buttonStyle, containerStyle, tabGroupStyle, toolbarStyle } from '../../../../../framework/core/engines/components';
import { normalizeSkin } from '../../../../../framework/core/engines/skin';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '../../../../../framework/assets');

const asset = (type: string, id: string | undefined): Record<string, unknown> | null => {
  if (!id) return null;
  try { return JSON.parse(readFileSync(join(assets, type, `${id}.json`), 'utf8')).data as Record<string, unknown>; } catch { return null; }
};

export interface SkinTokens {
  id: string;
  name: string;
  description: string;
  themes: { color: string; style: string; layout: string; typography: string; density: string; sizing: string };
  scheme: string;
  vars: Record<string, string>;
  attrs: Record<string, string>;
}

export function compileSkin(file: string): SkinTokens {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const skin = normalizeSkin(raw.data);
  const color = asset('color-theme', skin.colorTheme) as { scheme: string; tokens: Record<string, string> } | null;
  const style = asset('style-theme', skin.styleTheme);
  const layout = asset('layout', skin.layoutTheme) ?? {};
  if (!color || !style) throw new Error(`${raw.id}: colour theme ${skin.colorTheme} or style theme ${skin.styleTheme} is missing`);
  const pick = (type: string) => skin.assets?.[type];
  const parts = [
    buttonStyle(asset('button', pick('button')) as never),
    containerStyle(asset('container', pick('container')) as never),
    toolbarStyle(asset('toolbar', pick('toolbar')) as never),
    tabGroupStyle(asset('tab-group', pick('tab-group')) as never),
  ];
  const vars: Record<string, string> = {
    ...colorThemeVars(color),
    ...styleThemeVars(style as never),
    ...surfaceThemeVars(style as never),
    ...scrollbarVars(style as never),
    ...scaleThemeVars({ typography: asset('typography', pick('typography')) ?? undefined, density: asset('density', pick('density')) ?? undefined, sizing: asset('sizing', pick('sizing')) ?? undefined }),
    ...layoutVars(layout as never),
  };
  const attrs: Record<string, string> = { 'data-fx-scheme': color.scheme };
  for (const p of parts) { Object.assign(vars, p.vars); Object.assign(attrs, p.attrs); }
  return {
    id: raw.id, name: raw.name, description: raw.description ?? '',
    themes: { color: skin.colorTheme, style: skin.styleTheme, layout: skin.layoutTheme, typography: pick('typography') ?? '', density: pick('density') ?? '', sizing: pick('sizing') ?? '' },
    scheme: color.scheme, vars, attrs,
  };
}

const skins = readdirSync(join(assets, 'skin')).filter((f) => f.endsWith('.json')).sort().map((f) => compileSkin(join(assets, 'skin', f)));
const out = { $axf: 'walkthrough-mock-tokens@1', generatedAt: new Date().toISOString(), skins };
writeFileSync(join(here, 'tokens.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`✓ ${skins.length} skins compiled: ${skins.map((s) => `${s.id} (${Object.keys(s.vars).length} tokens)`).join(', ')}`);
