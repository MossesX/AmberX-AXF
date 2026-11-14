#!/usr/bin/env node
/**
 * Bake the framework's look for the public AmberX site.
 *
 * The site is a standalone page with no theme engine in the browser, so the engines run here, at build time:
 *   baked/axf.css     the framework base stylesheet (fx-btn, fx-input, fx-card, fx-table … read only --fx-* tokens)
 *   baked/themes.json every color-theme and style-theme asset compiled to its --fx-* variables, plus the scale
 *                     (typography / density / sizing) variables, so the server can switch themes per request.
 *
 *   node apps/amberx-site/bake.mjs [--framework <dir>] [--out <dir>]
 *
 * colorThemeVars / styleThemeVars mirror framework/core/engines/theme.ts at Spacing = 'regular' (theme.ts is
 * TypeScript and this runs on plain Node); scale variables come straight from framework/core/engines/scale-rules.mjs.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? resolve(process.argv[i + 1]) : dflt; };
const FRAMEWORK = arg('--framework', resolve(HERE, '../../framework'));
const OUT = arg('--out', join(HERE, 'baked'));

/** The scale assets the site uses: roomier than the console's compact defaults, it is a marketing page. */
export const SCALE_PICK = { typography: 'reader', density: 'roomy', sizing: 'touch' };

const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const DENSITY = { compact: 0.78, comfortable: 1, spacious: 1.22 };
const OPACITY_DEFAULTS = { disabled: 0.38, muted: 0.62, hover: 0.08, tint: 0.14, scrim: 0.5, glass: 0.72 };
const SURFACE_KINDS = ['dialog', 'settings', 'panel', 'menu', 'toolbar', 'banner'];

export function colorThemeVars(tokens) {
  const vars = {};
  for (const [k, v] of Object.entries(tokens ?? {})) vars[`--fx-${kebab(k)}`] = v;
  return vars;
}

export function styleThemeVars(s) {
  const d = DENSITY[s.density] ?? 1;
  const vars = {
    '--fx-font': s.fontFamily,
    '--fx-font-display': s.fontDisplay,
    '--fx-font-mono': s.fontMono,
    '--fx-font-size': `${s.fontSize}px`,
    '--fx-radius-sm': `${s.radius.sm}px`,
    '--fx-radius-md': `${s.radius.md}px`,
    '--fx-radius-lg': `${s.radius.lg}px`,
    '--fx-space': `${Math.round(s.space * d * 10) / 10}px`,
    '--fx-border-w': `${s.borderWidth}px`,
    '--fx-shadow-sm': s.shadow.sm,
    '--fx-shadow-md': s.shadow.md,
    '--fx-shadow-lg': s.shadow.lg,
    '--fx-motion': `${s.motion}ms`,
    '--fx-blur': `${s.blur}px`,
    '--fx-heading-weight': String(s.headingWeight),
    '--fx-tracking': `${s.tracking}em`,
    '--fx-row-h': `${Math.max(22, Math.round(34 * d))}px`,
    '--fx-density-k': String(d),
  };
  for (const k of Object.keys(OPACITY_DEFAULTS)) {
    vars[`--fx-opacity-${k}`] = String(s[`opacity${k[0].toUpperCase()}${k.slice(1)}`] ?? OPACITY_DEFAULTS[k]);
  }
  for (const k of SURFACE_KINDS) {
    const o = Math.min(1, Math.max(0, Number(s[`opacity${k[0].toUpperCase()}${k.slice(1)}`] ?? 1)));
    vars[`--fx-opacity-${k}`] = String(o);
    vars[`--fx-backdrop-${k}`] = o < 1 ? 'blur(var(--fx-blur))' : 'none';
  }
  return vars;
}

const readAssets = (type) => {
  const dir = join(FRAMEWORK, 'assets', type);
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
};

export async function bake() {
  const { scaleVars } = await import(pathToFileURL(join(FRAMEWORK, 'core/engines/scale-rules.mjs')).href);
  const color = {};
  for (const a of readAssets('color-theme')) color[a.id] = { name: a.name, scheme: a.data?.scheme ?? 'dark', vars: colorThemeVars(a.data?.tokens) };
  const style = {};
  for (const a of readAssets('style-theme')) style[a.id] = { name: a.name, vars: styleThemeVars(a.data) };
  const scale = {};
  for (const [type, id] of Object.entries(SCALE_PICK)) {
    const file = join(FRAMEWORK, 'assets', type, `${id}.json`);
    const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).data : undefined;
    Object.assign(scale, scaleVars(type, raw));
  }
  mkdirSync(OUT, { recursive: true });
  copyFileSync(join(FRAMEWORK, 'ui/axf.css'), join(OUT, 'axf.css'));
  writeFileSync(join(OUT, 'themes.json'), JSON.stringify({ $axf: 'amberx-site-themes@1', color, style, scale }, null, 1));
  return { color: Object.keys(color).length, style: Object.keys(style).length, scale: Object.keys(scale).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const n = await bake();
  console.log(`baked ${n.color} colour themes, ${n.style} style themes, ${n.scale} scale tokens → ${OUT}`);
}
