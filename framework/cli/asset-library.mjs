#!/usr/bin/env node
/**
 * AmberX asset library generator (enterprise-branding phase 2, Opus, Oct 27 2026).
 *
 *   node framework/cli/asset-library.mjs [--only color-theme,style-theme,…] [--check] [--json]
 *
 * Writes the starter library into framework/assets/<type>/ from hand-picked seeds kept in this file, so the library
 * is reproducible and every asset meets framework/spec/DESIGN-LANGUAGE.md by construction (colour themes are
 * derived and then nudged until each contrast pair passes; numbers stay inside the ranges the checker enforces).
 * `--check` writes nothing and fails when a file on disk differs from what the seeds give (CI drift guard).
 * Existing hand-made starters are never touched: the generator owns only the ids it lists.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const AUTHOR = 'AmberX AXF';

/* ───────────────────────── colour maths ───────────────────────── */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
const rgba = (hex, alpha) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${alpha})`; };

/** Move lightness toward `dir` (-1 darker, +1 lighter) until `fg` on `bg` reaches `min`. */
function fit(h, s, l, bg, min, dir) {
  let hex = hslToHex(h, s, l);
  for (let i = 0; i < 100 && contrast(hex, bg) < min; i += 1) { l = clamp(l + dir, 0, 100); hex = hslToHex(h, s, l); }
  return hex;
}

/**
 * Seed → colour-theme tokens. Seed: { hue (neutral tint), tint (neutral saturation), accent: [h, s], scheme }.
 * Light: tinted near-white page, white cards, near-black text. Dark: surfaces step up in lightness with
 * elevation (§6: dark is not inverted light), lightened accent with dark accent text.
 */
export function deriveColor(seed) {
  const { hue, tint = 12, scheme } = seed;
  const [ah, as] = seed.accent;
  const status = seed.status ?? {};
  if (scheme === 'light') {
    const bg = hslToHex(hue, tint, 96.5);
    const surface = seed.paper ?? hslToHex(hue, Math.min(tint, 30), 99.5);
    const surface2 = hslToHex(hue, tint, 98);
    const surface3 = hslToHex(hue, tint, 92.5);
    const text = fit(hue, Math.min(tint * 2, 35), 13, bg, 12, -1);
    const muted = fit(hue, Math.min(tint, 18), 44, surface, 4.6, -1);
    const border = fit(hue, tint, 87, surface, 1.3, -0.5);
    const accent = fit(ah, as, 46, '#ffffff', 4.6, -1);
    const st = (h, s, l) => fit(h, s, l, surface, 3.2, -1);
    return {
      bg, surface, surface2, surface3, text, muted, border,
      accent, accentText: '#ffffff', accentSoft: rgba(accent, 0.1),
      danger: st(...(status.danger ?? [356, 68, 48])), success: st(...(status.success ?? [152, 62, 34])),
      warning: st(...(status.warning ?? [36, 80, 40])), info: st(...(status.info ?? [198, 78, 40])),
      focus: accent, shadow: rgba(hslToHex(hue, 40, 14), 0.12),
    };
  }
  const bg = hslToHex(hue, tint, 6.5);
  const surface = hslToHex(hue, tint, 9.5);
  const surface2 = hslToHex(hue, tint, 12.5);
  const surface3 = hslToHex(hue, tint, 16.5);
  const text = fit(hue, Math.min(tint, 25), 91, surface3, 11, 1);
  const muted = fit(hue, Math.min(tint, 16), 62, surface, 5, 1);
  const border = fit(hue, tint, 19, surface, 1.35, 0.5);
  const accent = fit(ah, as, 60, surface, 6, 1);
  const accentText = fit(ah, Math.min(as, 60), 9, accent, 6, -1);
  const st = (h, s, l) => fit(h, s, l, surface, 5, 1);
  return {
    bg, surface, surface2, surface3, text, muted, border,
    accent, accentText, accentSoft: rgba(accent, 0.14),
    danger: st(...(status.danger ?? [352, 82, 66])), success: st(...(status.success ?? [152, 58, 52])),
    warning: st(...(status.warning ?? [38, 86, 60])), info: st(...(status.info ?? [212, 92, 70])),
    focus: accent, shadow: 'rgba(0,0,0,0.55)',
  };
}

/* ───────────────────────── seeds: colour themes (s13) ───────────────────────── */

const COLOR = [
  // light
  { id: 'porcelain', name: 'Porcelain', scheme: 'light', hue: 220, tint: 14, accent: [221, 83], tags: ['light', 'cool', 'enterprise'], description: 'Clean blue-grey neutrals and a confident royal blue; the safe enterprise default.' },
  { id: 'linen-slate', name: 'Linen Slate', scheme: 'light', hue: 36, tint: 18, accent: [205, 64], tags: ['light', 'warm'], description: 'Warm linen paper with slate-blue actions, for documents and long reading.' },
  { id: 'glacier', name: 'Glacier', scheme: 'light', hue: 196, tint: 26, accent: [192, 90], tags: ['light', 'cool'], description: 'Icy cyan surfaces with a deep teal accent; airy and technical.' },
  { id: 'meadow', name: 'Meadow', scheme: 'light', hue: 120, tint: 10, accent: [152, 70], tags: ['light', 'natural'], description: 'Soft sage neutrals and an evergreen accent for calm operational tools.' },
  { id: 'sandstone', name: 'Sandstone', scheme: 'light', hue: 30, tint: 22, accent: [16, 72], tags: ['light', 'warm'], description: 'Sun-baked sand with a terracotta accent; friendly without being loud.' },
  { id: 'orchid-mist', name: 'Orchid Mist', scheme: 'light', hue: 270, tint: 18, accent: [268, 62], tags: ['light', 'creative'], description: 'Lavender-tinted greys with a violet accent for design and creative suites.' },
  { id: 'harbor', name: 'Harbor', scheme: 'light', hue: 210, tint: 20, accent: [212, 68], tags: ['light', 'cool', 'enterprise'], description: 'Navy-on-fog harbour palette; formal, high-trust, finance-ready.' },
  { id: 'saffron-day', name: 'Saffron Day', scheme: 'light', hue: 44, tint: 30, accent: [32, 92], tags: ['light', 'warm', 'amber'], description: 'AmberX gold on cream; the brand look in daylight.' },
  { id: 'rosewood-light', name: 'Rosewood Light', scheme: 'light', hue: 350, tint: 14, accent: [345, 64], tags: ['light', 'warm'], description: 'Blush neutrals with a rosewood accent, refined and editorial.' },
  { id: 'mono-paper', name: 'Mono Paper', scheme: 'light', hue: 220, tint: 3, accent: [220, 8], tags: ['light', 'mono'], description: 'Ink on paper: near-monochrome greys with a graphite accent, colour only for status.' },
  // dark
  { id: 'obsidian', name: 'Obsidian', scheme: 'dark', hue: 228, tint: 18, accent: [224, 92], tags: ['dark', 'cool', 'enterprise'], description: 'Deep blue-black glass with an electric blue accent; the enterprise dark default.' },
  { id: 'deep-ocean', name: 'Deep Ocean', scheme: 'dark', hue: 205, tint: 42, accent: [186, 84], tags: ['dark', 'cool'], description: 'Abyssal navy with a bioluminescent cyan accent.' },
  { id: 'aurora-night', name: 'Aurora Night', scheme: 'dark', hue: 250, tint: 26, accent: [160, 72], tags: ['dark', 'vivid'], description: 'Indigo night sky lit by an aurora-green accent.' },
  { id: 'carbon-amber', name: 'Carbon Amber', scheme: 'dark', hue: 30, tint: 6, accent: [36, 96], tags: ['dark', 'warm', 'amber'], description: 'Carbon fibre greys and molten AmberX gold; the brand look after dark.' },
  { id: 'plum-noir', name: 'Plum Noir', scheme: 'dark', hue: 285, tint: 22, accent: [292, 70], tags: ['dark', 'creative'], description: 'Plum-black surfaces with an orchid accent for creative work at night.' },
  { id: 'forest-night', name: 'Forest Night', scheme: 'dark', hue: 150, tint: 22, accent: [140, 56], tags: ['dark', 'natural'], description: 'Pine-dark greens with a fresh leaf accent; easy on the eyes.' },
  { id: 'slate-steel', name: 'Slate Steel', scheme: 'dark', hue: 215, tint: 10, accent: [205, 46], tags: ['dark', 'neutral', 'enterprise'], description: 'Brushed steel greys with a restrained steel-blue accent for dense dashboards.' },
  { id: 'crimson-dusk', name: 'Crimson Dusk', scheme: 'dark', hue: 350, tint: 14, accent: [352, 84], tags: ['dark', 'warm'], description: 'Smoky dusk with a crimson accent; status colours tuned to stay distinct from it.', status: { danger: [8, 90, 64] } },
  { id: 'nebula', name: 'Nebula', scheme: 'dark', hue: 262, tint: 34, accent: [318, 80], tags: ['dark', 'vivid', 'creative'], description: 'Violet nebula depths with a magenta accent; bold but legible.' },
  { id: 'graphite-mint', name: 'Graphite Mint', scheme: 'dark', hue: 200, tint: 6, accent: [166, 64], tags: ['dark', 'neutral'], description: 'Neutral graphite with a cool mint accent for developer tools.' },
];

/* ───────────────────────── seeds: layouts (s14) ───────────────────────── */

const L = (nav, navWidth, menubar, toolbar, toolbarPosition, status, inspector, inspectorWidth, contentMaxWidth) =>
  ({ nav, navWidth, showMenubar: menubar, showToolbar: toolbar, toolbarPosition, showStatusbar: status, inspector, inspectorWidth, contentMaxWidth });
const LAYOUT = [
  { id: 'enterprise-shell', name: 'Enterprise Shell', tags: ['desktop', 'enterprise'], description: 'Menu bar, toolbar, a full side navigation, an inspector on the right and a status bar: the classic line-of-business frame.', data: L('left', 248, true, true, 'top', true, 'right', 300, 0) },
  { id: 'command-center', name: 'Command Center', tags: ['desktop', 'ops'], description: 'Compact rail, wide canvas, status bar and a right inspector for monitoring and operations dashboards.', data: L('left', 72, true, true, 'top', true, 'right', 320, 0) },
  { id: 'document-reader', name: 'Document Reader', tags: ['reading', 'focus'], description: 'Top navigation and a centred 760 px column: nothing competes with the text.', data: L('top', 0, false, false, 'top', false, 'none', 0, 760) },
  { id: 'split-review', name: 'Split Review', tags: ['desktop', 'review'], description: 'Side navigation with a wide inspector on the right for side-by-side review and approvals.', data: L('left', 220, false, true, 'top', false, 'right', 420, 0) },
  { id: 'right-handed', name: 'Right Handed', tags: ['tablet', 'touch'], description: 'Navigation on the right and the toolbar at the bottom, in reach of the thumb on tablets and big phones.', data: L('right', 220, false, true, 'bottom', false, 'none', 0, 0) },
  { id: 'canvas-studio', name: 'Canvas Studio', tags: ['creative', 'desktop'], description: 'Tools rail on the left, properties on the right, toolbar at the bottom: a design-tool frame around a full-bleed canvas.', data: L('left', 64, true, true, 'bottom', true, 'right', 280, 0) },
  { id: 'portal-top', name: 'Portal Top', tags: ['web', 'portal'], description: 'Top navigation, toolbar and a centred 1200 px page: customer portals and admin sites.', data: L('top', 0, false, true, 'top', false, 'none', 0, 1200) },
  { id: 'data-grid', name: 'Data Grid', tags: ['desktop', 'data'], description: 'Narrow rail, toolbar, status bar and no inspector: every pixel for tables and grids.', data: L('left', 64, false, true, 'top', true, 'none', 0, 0) },
  { id: 'console-pro', name: 'Console Pro', tags: ['developer', 'desktop'], description: 'Developer console frame: menu bar, side navigation, an inspector docked left beside it and a status bar.', data: L('left', 200, true, true, 'top', true, 'left', 260, 0) },
  { id: 'kiosk', name: 'Kiosk', tags: ['kiosk', 'focus'], description: 'No chrome at all: a single full-screen surface for kiosks, wall displays and embedded views.', data: { ...L('top', 0, false, false, 'top', false, 'none', 0, 0), slots: { menubar: [], toolbar: [], nav: [] } } },
];

const env = (type, s, data, extra = {}) => ({
  $axf: 'asset@1', type, id: s.id, name: s.name, version: '1.0.0', description: s.description, author: AUTHOR,
  tags: s.tags ?? [], ...extra, data,
});

const BUILD = {
  'color-theme': () => COLOR.map((s) => env('color-theme', s, { scheme: s.scheme, tokens: deriveColor(s) })),
  layout: () => LAYOUT.map((s) => env('layout', s, s.data)),
};

/* ───────────────────────── runner ───────────────────────── */

export function build(types = Object.keys(BUILD)) {
  const out = [];
  for (const t of types) { if (!BUILD[t]) throw new Error(`unknown type ${t}`); out.push(...BUILD[t]()); }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const onlyArg = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const types = onlyArg ? onlyArg.split(',') : Object.keys(BUILD);
  const check = args.includes('--check');
  const assets = build(types);
  const drift = [];
  for (const a of assets) {
    const file = join(ROOT, a.type, `${a.id}.json`);
    const text = JSON.stringify(a, null, 2) + '\n';
    if (check) { if (!existsSync(file) || readFileSync(file, 'utf8') !== text) drift.push(`${a.type}/${a.id}`); continue; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const counts = assets.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] ?? 0) + 1 }), {});
  if (args.includes('--json')) console.log(JSON.stringify({ counts, drift }));
  else console.log(check ? (drift.length ? `drift: ${drift.join(', ')}` : 'asset library in sync') : `wrote ${JSON.stringify(counts)}`);
  if (check && drift.length) process.exit(1);
}
