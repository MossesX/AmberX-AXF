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

/* ───────────────────────── seeds: style themes (s15) ───────────────────────── */

const SANS = (f) => `'${f}', system-ui, -apple-system, 'Segoe UI', sans-serif`;
const MONO = (f) => `'${f}', ui-monospace, 'SFMono-Regular', Menlo, monospace`;
const shadow = (k) => ({
  none: { sm: 'none', md: '0 0 0 1px var(--fx-border)', lg: '0 0 0 1px var(--fx-border)' },
  hair: { sm: '0 1px 2px var(--fx-shadow)', md: '0 4px 12px var(--fx-shadow)', lg: '0 12px 32px var(--fx-shadow)' },
  soft: { sm: '0 1px 3px var(--fx-shadow)', md: '0 8px 24px var(--fx-shadow)', lg: '0 20px 56px var(--fx-shadow)' },
  deep: { sm: '0 2px 6px var(--fx-shadow)', md: '0 14px 36px var(--fx-shadow)', lg: '0 32px 88px var(--fx-shadow)' },
}[k]);
/** fontSize, space, radii, density, motion, blur, heading weight, tracking, shadow kind, glass opacity. */
const S = (font, display, mono, fontSize, space, [sm, md, lg], density, motion, blur, headingWeight, tracking, sh, glass = 0.7, borderWidth = 1) => ({
  fontFamily: SANS(font), fontDisplay: SANS(display), fontMono: MONO(mono), fontSize,
  radius: { sm, md, lg }, space, borderWidth, shadow: shadow(sh), density, motion, blur, headingWeight, tracking,
  opacityDisabled: 0.4, opacityMuted: 0.62, opacityHover: 0.08, opacityTint: 0.14, opacityScrim: 0.5, opacityGlass: glass,
  wrapGroups: false,
});
const STYLE = [
  { id: 'enterprise', name: 'Enterprise', tags: ['enterprise', 'balanced'], description: 'Inter at 14 px, an 8 px rhythm, modest radii and hairline shadows: the dependable business default.', data: S('Inter', 'Inter', 'JetBrains Mono', 14, 8, [4, 8, 12], 'comfortable', 160, 12, 650, -0.01, 'hair') },
  { id: 'executive', name: 'Executive', tags: ['enterprise', 'spacious'], description: 'Generous spacing, IBM Plex type and soft depth for dashboards that get presented upstairs.', data: S('IBM Plex Sans', 'IBM Plex Sans', 'IBM Plex Mono', 15, 10, [6, 10, 16], 'spacious', 200, 16, 600, -0.015, 'soft') },
  { id: 'dense-grid', name: 'Dense Grid', tags: ['compact', 'data'], description: '13 px type on a 6 px rhythm with square corners: the most rows on screen for data-heavy tools.', data: S('Inter', 'Inter', 'JetBrains Mono', 13, 6, [2, 3, 4], 'compact', 100, 0, 600, 0, 'none', 0.9) },
  { id: 'soft-touch', name: 'Soft Touch', tags: ['touch', 'friendly'], description: 'Rounded 12–24 px corners, roomy targets and gentle motion for tablets and touch screens.', data: S('Nunito Sans', 'Nunito Sans', 'Fira Code', 16, 11, [12, 18, 24], 'spacious', 240, 18, 700, -0.01, 'soft') },
  { id: 'swiss', name: 'Swiss', tags: ['editorial', 'flat'], description: 'Grid-true Swiss typography: flat surfaces, hard edges, outlines instead of shadows and bold headings.', data: S('Helvetica Neue', 'Helvetica Neue', 'IBM Plex Mono', 14, 8, [0, 0, 2], 'comfortable', 120, 0, 800, -0.02, 'none', 0.95, 1) },
  { id: 'glass-pro', name: 'Glass Pro', tags: ['glass', 'modern'], description: 'Frosted glass panels with 22 px blur, deep floating shadows and Sora headings for a premium modern feel.', data: S('Manrope', 'Sora', 'Fira Code', 14, 9, [8, 14, 20], 'comfortable', 220, 22, 700, -0.025, 'deep', 0.58) },
  { id: 'terminal-pro', name: 'Terminal Pro', tags: ['developer', 'mono'], description: 'Monospace headings, tight corners and fast motion for developer consoles and log-heavy tools.', data: S('IBM Plex Sans', 'JetBrains Mono', 'JetBrains Mono', 13, 7, [2, 4, 6], 'compact', 90, 0, 600, 0, 'hair', 0.92) },
  { id: 'humanist', name: 'Humanist', tags: ['reading', 'warm'], description: 'Source Sans text with Source Serif headings, relaxed rhythm and soft corners for reading-heavy apps.', data: S('Source Sans 3', 'Source Serif 4', 'Source Code Pro', 15, 9, [6, 10, 14], 'comfortable', 200, 10, 600, 0, 'soft') },
  { id: 'geometric', name: 'Geometric', tags: ['brand', 'modern'], description: 'Outfit display over DM Sans with pill-like 10–20 px radii: confident, product-marketing polish.', data: S('DM Sans', 'Outfit', 'DM Mono', 14, 8, [10, 14, 20], 'comfortable', 180, 14, 700, -0.02, 'soft') },
  { id: 'industrial', name: 'Industrial', tags: ['ops', 'rugged'], description: 'Condensed Barlow headings, 2 px borders and square corners built for control rooms and field tablets.', data: S('Barlow', 'Barlow Semi Condensed', 'Roboto Mono', 15, 8, [2, 3, 4], 'comfortable', 120, 0, 700, 0.01, 'hair', 0.9, 2) },
];

/* ───────────────────────── seeds: context menus (s16) ───────────────────────── */

/** Item shorthand: [id, label, icon, action, shortcut?, requires?] or '-' for a separator. */
const items = (list) => {
  let n = 0;
  return list.map((x) => {
    if (x === '-') { n += 1; return { id: `s${n}`, separator: true }; }
    const [id, label, icon, action, shortcut, requires] = x;
    return { id, label, icon, action, ...(shortcut ? { shortcut } : {}), ...(requires ? { requires } : {}) };
  });
};
const I = {
  undo: ['undo', 'Undo', 'undo', 'edit.undo', 'Ctrl+Z'], redo: ['redo', 'Redo', 'redo', 'edit.redo', 'Ctrl+Shift+Z'],
  cut: ['cut', 'Cut', 'cut', 'edit.cut', 'Ctrl+X'], copy: ['copy', 'Copy', 'copy', 'edit.copy', 'Ctrl+C'],
  paste: ['paste', 'Paste', 'paste', 'edit.paste', 'Ctrl+V'], del: ['delete', 'Delete', 'trash', 'edit.delete', 'Del'],
  save: ['save', 'Save', 'save', 'file.save', 'Ctrl+S'], exp: ['export', 'Export…', 'download', 'file.export'],
  settings: ['settings', 'Settings', 'settings', 'app.settings', 'Ctrl+,'], keys: ['shortcuts', 'Keyboard shortcuts', 'keyboard', 'view.shortcuts', 'Alt+K'],
  docs: ['docs', 'Documentation', 'help', 'help.docs', 'F1'], about: ['about', 'About', 'info', 'help.about'],
  color: ['next-color', 'Next colour theme', 'palette', 'swap:color-theme:next', 'Alt+C', 'assets.swap'],
  style: ['next-style', 'Next style theme', 'type', 'swap:style-theme:next', 'Alt+S', 'assets.swap'],
  layout: ['next-layout', 'Next layout', 'layout', 'swap:layout:next', 'Alt+L', 'assets.swap'],
  pkg: ['next-package', 'Next design package', 'package', 'design.package:next', 'Alt+P', 'assets.swap'],
  random: ['random', 'Randomize the look', 'shuffle', 'assets.random', 'Alt+R', 'assets.swap'],
  reset: ['reset', 'Reset the look', 'refresh', 'assets.reset', null, 'assets.swap'],
  tight: ['spacing-tight', 'Super tight spacing', 'minimize', 'spacing:tight', null, 'assets.swap'],
  compact: ['spacing-compact', 'Compact spacing', 'list', 'spacing:compact', null, 'assets.swap'],
  regular: ['spacing-regular', 'Regular spacing', 'grid', 'spacing:regular', null, 'assets.swap'],
  appearance: ['appearance', 'Appearance settings…', 'sliders', 'settings.open:appearance'],
  build: ['build', 'Build', 'hammer', 'run.build', 'Ctrl+B'], deploy: ['deploy', 'Deploy', 'rocket', 'run.deploy'],
  devtools: ['devtools', 'Developer tools', 'code', 'dev.tools', 'F12'], console: ['console', 'Dev console', 'terminal', 'dev.console', 'Ctrl+`'],
  toolbar: ['toggle-toolbar', 'Show or hide the toolbar', 'menu', 'slot.hide:toolbar:toggle'],
  nav: ['toggle-nav', 'Show or hide navigation', 'list', 'slot.hide:nav-menu:toggle'],
  nextNav: ['next-nav', 'Next navigation menu', 'grid', 'swap:nav-menu:next', null, 'assets.swap'],
  open: ['open', 'Open', 'chevron-right', 'nav:{payload}'], home: ['home', 'Go home', 'home', 'nav:home'],
  activate: ['activate', 'Use this', 'zap', 'swap:{payload}', null, 'assets.swap'],
  json: ['json', 'View JSON', 'code', 'asset.json:{payload}'], copyJson: ['copy-json', 'Copy JSON', 'copy', 'asset.copy:{payload}'],
  import: ['import', 'Import asset…', 'upload', 'dialog:import-asset', null, 'assets.import'],
};
const assetCard = items([I.activate, '-', I.json, I.copyJson, '-', I.import]);
const navItem = items([I.open, '-', I.nextNav, I.layout, '-', I.nav]);
const CM = [
  { id: 'enterprise-standard', name: 'Enterprise Standard', tags: ['desktop', 'enterprise'], description: 'The complete desktop menu: edit commands with shortcuts, settings and help, grouped by intent.', data: { variant: 'compact', showIcons: true, showShortcuts: true, targets: { default: items([I.undo, I.redo, '-', I.cut, I.copy, I.paste, I.del, '-', I.settings, I.keys, I.docs]), 'asset-card': assetCard, 'nav-item': navItem } } },
  { id: 'editor-pro', name: 'Editor Pro', tags: ['desktop', 'editing'], description: 'Built for editors: clipboard first, then save and export, with every shortcut shown.', data: { variant: 'compact', showIcons: true, showShortcuts: true, targets: { default: items([I.cut, I.copy, I.paste, I.del, '-', I.undo, I.redo, '-', I.save, I.exp]), 'asset-card': assetCard } } },
  { id: 'appearance-quick', name: 'Appearance Quick', tags: ['appearance', 'designer'], description: 'Restyle from anywhere: step colour, style, layout and design package, pick spacing, randomize or reset.', data: { variant: 'glass', showIcons: true, showShortcuts: true, targets: { default: items([I.pkg, I.color, I.style, I.layout, '-', I.tight, I.compact, I.regular, '-', I.random, I.reset, I.appearance]), 'asset-card': assetCard, 'nav-item': navItem } } },
  { id: 'touch-large', name: 'Touch Large', tags: ['touch', 'tablet'], description: 'Roomy rows for fingers, no shortcut hints, only the commands people reach for on a tablet.', data: { variant: 'roomy', showIcons: true, showShortcuts: false, targets: { default: items([I.copy, I.paste, '-', I.home, I.settings, '-', I.docs]), 'nav-item': items([I.open, I.home]) } } },
  { id: 'glass-flyout', name: 'Glass Flyout', tags: ['glass', 'modern'], description: 'Frosted glass flyout with icons only where they help: clipboard, look and settings.', data: { variant: 'glass', showIcons: true, showShortcuts: false, targets: { default: items([I.cut, I.copy, I.paste, '-', I.color, I.layout, '-', I.settings]), 'asset-card': assetCard } } },
  { id: 'developer-tools', name: 'Developer Tools', tags: ['developer'], description: 'Build, deploy and inspect from a right-click, with the dev console and tools one step away.', data: { variant: 'compact', showIcons: true, showShortcuts: true, targets: { default: items([I.build, I.deploy, '-', I.console, I.devtools, '-', I.copy, I.paste, '-', I.keys, I.docs]), 'asset-card': assetCard, 'nav-item': navItem } } },
  { id: 'reader-minimal', name: 'Reader Minimal', tags: ['reading', 'minimal'], description: 'Copy, spacing and help: a quiet menu for reading apps that stays out of the way.', data: { variant: 'roomy', showIcons: false, showShortcuts: false, targets: { default: items([I.copy, '-', I.compact, I.regular, '-', I.docs]) } } },
  { id: 'asset-manager', name: 'Asset Manager', tags: ['designer', 'assets'], description: 'For asset browsers: use, inspect, copy and import assets, plus stepping through the look.', data: { variant: 'compact', showIcons: true, showShortcuts: true, targets: { default: items([I.import, '-', I.pkg, I.color, I.style, I.layout, '-', I.random, I.reset]), 'asset-card': items([I.activate, '-', I.json, I.copyJson, '-', I.import, I.pkg]) } } },
  { id: 'navigator', name: 'Navigator', tags: ['navigation'], description: 'Navigation first: open, go home, switch navigation menus and show or hide the bars.', data: { variant: 'compact', showIcons: true, showShortcuts: true, targets: { default: items([I.home, '-', I.nav, I.toolbar, I.nextNav, I.layout, '-', I.settings]), 'nav-item': navItem } } },
  { id: 'locked-down', name: 'Locked Down', tags: ['kiosk', 'secure'], description: 'Kiosk and shared-screen menu: copy and help only, and no plugin or everywhere items join it.', data: { variant: 'roomy', showIcons: true, showShortcuts: false, contributions: false, targets: { default: items([I.copy, '-', I.about]) } } },
];

const env = (type, s, data, extra = {}) => ({
  $axf: 'asset@1', type, id: s.id, name: s.name, version: '1.0.0', description: s.description, author: AUTHOR,
  tags: s.tags ?? [], ...extra, data,
});

const BUILD = {
  'color-theme': () => COLOR.map((s) => env('color-theme', s, { scheme: s.scheme, tokens: deriveColor(s) })),
  layout: () => LAYOUT.map((s) => env('layout', s, s.data)),
  'style-theme': () => STYLE.map((s) => env('style-theme', s, s.data)),
  'context-menu': () => CM.map((s) => env('context-menu', s, s.data)),
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
