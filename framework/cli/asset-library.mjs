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
  { id: 'signature-dock', name: 'Signature Dock', tags: ['brand', 'desktop'], description: 'A labelled list navigation on the left, properties on the right, the toolbar docked at the bottom and a status bar: the AmberX signature frame.', data: L('left', 216, true, true, 'bottom', true, 'right', 280, 0) },
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
  console: ['console', 'Dev console', 'terminal', 'dev.console', 'Ctrl+`'],
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
  { id: 'developer-tools', name: 'Developer Tools', tags: ['developer'], description: 'Build, deploy and inspect from a right-click, with the dev console one step away.', data: { variant: 'compact', showIcons: true, showShortcuts: true, targets: { default: items([I.build, I.deploy, '-', I.console, '-', I.copy, I.paste, '-', I.keys, I.docs]), 'asset-card': assetCard, 'nav-item': navItem } } },
  { id: 'reader-minimal', name: 'Reader Minimal', tags: ['reading', 'minimal'], description: 'Copy, spacing and help: a quiet menu for reading apps that stays out of the way.', data: { variant: 'roomy', showIcons: false, showShortcuts: false, targets: { default: items([I.copy, '-', I.compact, I.regular, '-', I.docs]) } } },
  { id: 'asset-manager', name: 'Asset Manager', tags: ['designer', 'assets'], description: 'For asset browsers: use, inspect, copy and import assets, plus stepping through the look.', data: { variant: 'compact', showIcons: true, showShortcuts: true, targets: { default: items([I.import, '-', I.pkg, I.color, I.style, I.layout, '-', I.random, I.reset]), 'asset-card': items([I.activate, '-', I.json, I.copyJson, '-', I.import, I.pkg]) } } },
  { id: 'navigator', name: 'Navigator', tags: ['navigation'], description: 'Navigation first: open, go home, switch navigation menus and show or hide the bars.', data: { variant: 'compact', showIcons: true, showShortcuts: true, targets: { default: items([I.home, '-', I.nav, I.toolbar, I.nextNav, I.layout, '-', I.settings]), 'nav-item': navItem } } },
  { id: 'locked-down', name: 'Locked Down', tags: ['kiosk', 'secure'], description: 'Kiosk and shared-screen menu: copy and help only, and no plugin or everywhere items join it.', data: { variant: 'roomy', showIcons: true, showShortcuts: false, contributions: false, targets: { default: items([I.copy, '-', I.about]) } } },
];

/* ───────────────────────── seeds: toolbars (s17, s18) ───────────────────────── */

const tbItem = (x, extra = {}) => { const [id, label, icon, action, , requires] = x; return { id, icon, label, action, ...(requires ? { requires } : {}), ...extra }; };
const T = {
  ...Object.fromEntries(Object.entries(I).map(([k, v]) => [k, tbItem(v)])),
  new: tbItem(['new', 'New', 'plus', 'file.new']), openFile: tbItem(['open-file', 'Open', 'folder', 'file.open']),
  alerts: tbItem(['alerts', 'Alerts', 'bell', 'alerts.open'], { badge: 'alerts.unread' }),
  navOn: tbItem(I.nav, { checked: 'slot:nav-menu' }), bannerOn: tbItem(['toggle-banner', 'Show or hide the banner', 'monitor', 'slot.hide:banner:toggle'], { checked: 'slot:banner' }),
  menubarOn: tbItem(['toggle-menubar', 'Show or hide the menu bar', 'list', 'slot.hide:app-menu:toggle'], { checked: 'slot:app-menu' }),
};
const G = (id, items, more = {}) => ({ id, items, ...more });
const W = (type, id, at, order) => ({ type, id, at, ...(order != null ? { order } : {}) });
/** variant, align, groups, options (search, widgets, density, surface, divider, collapsible) + docs (providers, counters). */
const TB = (variant, align, groups, o = {}) => ({
  variant, align, showSearch: !!o.search, ...(o.search ? { search: o.search } : {}), groups,
  ...(o.widgets ? { widgets: o.widgets } : {}), ...(o.density ? { density: o.density } : {}), ...(o.surface ? { surface: o.surface } : {}),
  ...(o.divider === false ? { divider: false } : {}), ...(o.collapsible ? { collapsible: true } : {}),
});
const live = (placeholder, maxResults = 12, kinds) => ({ live: true, placeholder, maxResults, ...(kinds ? { kinds } : {}) });
const TOOLBAR = [
  // s17
  { id: 'enterprise-command', name: 'Enterprise Command', use: 'Line-of-business desktops', tags: ['enterprise', 'desktop'], description: 'File, edit and look commands with labels, a live search and the account and connection status at the end.', data: TB('icons-labels', 'start', [G('file', [T.new, T.openFile, T.save, T.exp]), G('edit', [T.undo, T.redo]), G('app', [T.alerts, T.settings])], { search: live('Search…  (Ctrl K)'), widgets: [W('status', 'online', 'end', 10), W('avatar', 'account', 'end', 20)], surface: 'raised', collapsible: true }) },
  { id: 'live-pages', name: 'Live Pages', use: 'Apps with many pages', tags: ['live', 'navigation'], description: 'Every page of the app as a button, straight from the views provider, so new pages appear by themselves.', data: TB('icons', 'start', [G('pages', [T.home], { provider: 'views', max: 10, label: 'Pages' })], { search: live('Find a page…', 10, ['view']) }) },
  { id: 'navigator-strip', name: 'Navigator Strip', use: 'Replacing the side navigation', tags: ['live', 'navigation'], description: 'The active navigation menu drawn as a labelled strip; swapping the nav menu changes the strip too.', data: TB('labels', 'start', [G('nav', [], { provider: 'nav', max: 12, label: 'Navigation' })], { density: 'compact', divider: false }) },
  { id: 'window-switcher', name: 'Window Switcher', use: 'Multi-window desktops', tags: ['live', 'windows'], description: 'One button per open floating window to bring it back, beside the window and layout commands.', data: TB('icons-labels', 'start', [G('windows', [], { provider: 'windows', max: 8, label: 'Open windows' }), G('layout', [T.layout, T.navOn])]) },
  { id: 'chrome-toggles', name: 'Chrome Toggles', use: 'Focus and presentation modes', tags: ['live', 'appearance'], description: 'Pressed-state toggles for every bar and menu (chrome provider), plus the spacing choices.', data: TB('icons', 'center', [G('chrome', [], { provider: 'chrome', max: 8, label: 'Bars and menus' }), G('spacing', [T.tight, T.compact, T.regular])], { surface: 'glass' }) },
  { id: 'settings-jump', name: 'Settings Jump', use: 'Settings and admin pages', tags: ['live', 'settings'], description: 'A tab for every settings page, from the settings provider; plugin settings join as they install.', data: TB('labels', 'start', [G('settings', [], { provider: 'settings', max: 10, label: 'Settings pages' })], { search: live('Search settings…', 12, ['setting', 'settings-tab']), density: 'compact' }) },
  { id: 'dialog-launcher', name: 'Dialog Launcher', use: 'Tool-heavy apps', tags: ['live', 'dialogs'], description: 'Every dialog the app and its plugins register, one tap away, with a search limited to dialogs and actions.', data: TB('icons-labels', 'start', [G('dialogs', [], { provider: 'dialogs', max: 8, label: 'Dialogs' })], { search: live('Open a dialog…', 10, ['dialog', 'action']) }) },
  { id: 'developer-ops', name: 'Developer Ops', use: 'Developer consoles', tags: ['developer'], description: 'Build, deploy and the dev console with a build progress bar, AI status and a 24 h clock (alerts stay on the banner).', data: TB('icons', 'start', [G('run', [T.build, T.deploy]), G('tools', [T.console])], { widgets: [W('progress', 'build', 'end', 10), W('status', 'ai', 'end', 20), W('clock', 'digital-24h', 'end', 30)], density: 'compact' }) },
  { id: 'ops-monitor', name: 'Ops Monitor', use: 'Monitoring dashboards', tags: ['ops', 'widgets'], description: 'A status board: connection, unread alerts, build progress and the clock, with settings and help at the start.', data: TB('icons', 'spread', [G('app', [T.settings, T.docs])], { widgets: [W('status', 'online', 'end', 10), W('counter', 'alerts', 'end', 20), W('progress', 'build', 'end', 30), W('clock', 'digital-24h', 'end', 40)], surface: 'raised' }) },
  { id: 'editor-classic', name: 'Editor Classic', use: 'Document and form editors', tags: ['editing'], description: 'The classic editing row: new, open, save, export, undo, redo and the clipboard.', data: TB('icons', 'start', [G('file', [T.new, T.openFile, T.save, T.exp]), G('history', [T.undo, T.redo]), G('clipboard', [T.cut, T.copy, T.paste, T.del])], { density: 'compact' }) },
  { id: 'appearance-studio', name: 'Appearance Studio', use: 'Theme and brand work', tags: ['appearance', 'designer'], description: 'Step design packages and every theme, roll or reset the look, with the day and night switch at the end.', data: TB('icons-labels', 'start', [G('package', [T.pkg]), G('themes', [T.color, T.style, T.layout]), G('roll', [T.random, T.reset, T.appearance])], { widgets: [W('theme-switch', 'day-night', 'end', 10)], surface: 'glass', collapsible: true }) },
  { id: 'minimal-glass', name: 'Minimal Glass', use: 'Consumer and marketing apps', tags: ['glass', 'minimal'], description: 'A centred frosted strip with search, alerts and settings only.', data: TB('icons', 'center', [G('app', [T.alerts, T.settings])], { search: live('Search', 8), surface: 'glass', divider: false }) },
  { id: 'touch-dock', name: 'Touch Dock', use: 'Tablets and phones', tags: ['touch'], description: 'Roomy labelled buttons spread across the width, sized for thumbs: home, pages, alerts and settings.', data: TB('icons-labels', 'spread', [G('go', [T.home]), G('pages', [], { provider: 'views', max: 3, label: 'Pages' }), G('app', [T.alerts, T.settings])], { density: 'roomy', divider: false }) },
  // s18
  { id: 'reader-bar', name: 'Reader Bar', use: 'Reading and documentation', tags: ['reading', 'minimal'], description: 'Quiet labels for reading apps: spacing choices and the documentation link.', data: TB('labels', 'spread', [G('spacing', [T.compact, T.regular]), G('help', [T.docs])], { density: 'compact', divider: false }) },
  { id: 'portal-header', name: 'Portal Header', use: 'Portals and admin sites', tags: ['portal', 'brand', 'live'], description: 'Wordmark at the start, the navigation as labels, and the account avatar at the end.', data: TB('labels', 'start', [G('nav', [], { provider: 'nav', max: 6, label: 'Navigation' })], { widgets: [W('logo', 'wordmark', 'start', 0), W('spacer', 'push', 'end', 0), W('avatar', 'account', 'end', 10)], surface: 'raised', divider: false }) },
  { id: 'approvals-desk', name: 'Approvals Desk', use: 'Review and approval queues', tags: ['review', 'widgets'], description: 'Waiting approvals and unread alerts as counters, with undo, redo and save for the reviewer.', data: TB('icons-labels', 'start', [G('review', [T.undo, T.redo, T.save]), G('inbox', [T.alerts])], { widgets: [W('counter', 'approvals', 'end', 10), W('counter', 'alerts', 'end', 20)] }) },
  { id: 'data-grid-tools', name: 'Data Grid Tools', use: 'Tables and grids', tags: ['data', 'compact'], description: 'Flat, dense tools for grids: new row, copy, delete, export, and the pages provider for quick jumps.', data: TB('icons', 'start', [G('rows', [T.new, T.copy, T.del, T.exp]), G('pages', [], { provider: 'views', max: 6, label: 'Pages' })], { density: 'compact', surface: 'flat' }) },
  { id: 'brand-bar', name: 'Brand Bar', use: 'Branded app frames', tags: ['brand'], description: 'Logo mark, the app version label and the day and night switch around a centred search.', data: TB('icons', 'center', [], { search: live('Search…', 10), widgets: [W('logo', 'mark', 'start', 0), W('label', 'version', 'start', 10), W('theme-switch', 'day-night', 'end', 10)], surface: 'raised', divider: false }) },
  { id: 'kiosk-lite', name: 'Kiosk Lite', use: 'Kiosks and wall displays', tags: ['kiosk', 'minimal'], description: 'A clock and a single help button; nothing that changes the app.', data: TB('icons', 'spread', [G('help', [T.docs])], { widgets: [W('clock', 'digital-12h', 'start', 0)], density: 'roomy', divider: false }) },
  { id: 'search-first', name: 'Search First', use: 'Command-palette workflows', tags: ['search'], description: 'A wide search-bar widget up front that finds anything, with the chrome toggles beside it.', data: TB('icons', 'start', [G('chrome', [], { provider: 'chrome', max: 4, label: 'Bars and menus' })], { widgets: [W('search-bar', 'everything', 'start', 0)] }) },
  { id: 'quick-create', name: 'Quick Create', use: 'Creation-first apps', tags: ['live', 'create'], description: 'New and open, followed by the first four dialogs the app registers (wizards, importers…).', data: TB('icons-labels', 'start', [G('file', [T.new, T.openFile]), G('dialogs', [], { provider: 'dialogs', max: 4, label: 'Create' })]) },
  { id: 'status-strip', name: 'Status Strip', use: 'A status bar on top', tags: ['widgets', 'status'], description: 'Widgets only: AI and connection status, build progress, unread alerts and the clock.', data: TB('icons', 'spread', [], { widgets: [W('status', 'ai', 'start', 0), W('status', 'online', 'start', 10), W('progress', 'build', 'end', 10), W('counter', 'alerts', 'end', 20), W('clock', 'digital-24h', 'end', 30)], density: 'compact', surface: 'flat' }) },
  { id: 'power-user', name: 'Power User', use: 'Experts who want everything', tags: ['dense', 'live'], description: 'Eleven icon commands, the pages provider and the bar toggles, folding away when not needed.', data: TB('icons', 'start', [G('file', [T.new, T.openFile, T.save]), G('edit', [T.undo, T.redo, T.cut, T.copy, T.paste]), G('app', [T.alerts, T.settings, T.keys]), G('pages', [], { provider: 'views', max: 6, label: 'Pages' }), G('chrome', [], { provider: 'chrome', max: 4, label: 'Bars' })], { density: 'compact', collapsible: true }) },
  { id: 'review-flow', name: 'Review Flow', use: 'Side-by-side review', tags: ['review', 'live'], description: 'Undo, redo and save with the open windows provider so reviewers jump between compared items.', data: TB('icons-labels', 'start', [G('history', [T.undo, T.redo, T.save]), G('windows', [], { provider: 'windows', max: 6, label: 'Open windows' }), G('inbox', [T.alerts])]) },
  { id: 'amberx-signature', name: 'AmberX Signature', use: 'The AmberX brand frame', tags: ['brand', 'amber', 'glass'], description: 'The AmberX house toolbar: live pages, a live search, the day and night switch and the account, on glass; the brand draws its own mark here.', data: TB('icons', 'start', [G('pages', [T.home], { provider: 'views', max: 6, label: 'Pages' }), G('app', [T.settings])], { search: live('Search AmberX…  (Ctrl K)'), widgets: [W('theme-switch', 'day-night', 'end', 10), W('avatar', 'account', 'end', 20)], surface: 'glass', collapsible: true }) },
];

/* ───────────────────────── seeds: style packages (s19, s20) ───────────────────────── */

// Each family = one matched control set (button, container, slider, dialog, popup, tab group, all with the family's
// id) + a gauge and a meter picked from the starters, wrapped in a style-package of the same id.
// btn: shape fill weight uppercase size elevation · card: variant header padding elevation · slider: track thumb size fill showValue ticks
// dialog: variant width backdrop animation header · popup: position variant duration icon max · tabs: style align density divider icons
const SP = (id, name, tone, btn, card, sl, dlg, pop, tabs, gauge, meter, description, tags = []) => ({ id, name, tone, btn, card, sl, dlg, pop, tabs, gauge, meter, description, tags });
const STYLE_PACKAGES = [
  // s19
  SP('enterprise-crisp', 'Enterprise Crisp', 'crisp', ['rounded', 'solid', 600, false, 'md', false], ['card', 'plain', 'md', 1], [4, 'circle', 16, 'solid', 'hover', false], ['modal', 520, 'dim', 'scale', 'plain'], ['top-right', 'solid', 4000, true, 4], ['underline', 'start', 'regular', true, true], 'classic-arc', 'hairline', 'Solid rounded buttons, quiet cards, centred modals and an underline tab row: the dependable business set.', ['enterprise']),
  SP('executive-soft', 'Executive Soft', 'soft', ['pill', 'soft', 600, false, 'md', false], ['card', 'divided', 'lg', 2], [6, 'circle', 18, 'solid', 'always', false], ['modal', 560, 'blur', 'fade', 'filled'], ['bottom-right', 'outline', 4500, true, 3], ['pills', 'start', 'roomy', false, true], 'ring', 'gradient-soft', 'Soft pills, generous divided cards and blurred modals for dashboards that get presented.', ['enterprise', 'spacious']),
  SP('dense-ops', 'Dense Ops', 'dense', ['square', 'outline', 600, false, 'sm', false], ['panel', 'divided', 'sm', 0], [3, 'bar', 12, 'solid', 'always', true], ['drawer', 440, 'none', 'slide', 'accent-bar'], ['bottom-center', 'minimal', 3000, true, 5], ['segmented', 'start', 'compact', true, false], 'digital', 'segments', 'Small outlined buttons, flat panels, ticked bar sliders and side drawers: built for operations screens.', ['compact', 'data']),
  SP('glass-air', 'Glass Air', 'glass', ['rounded', 'soft', 500, false, 'md', true], ['glass', 'plain', 'md', 2], [4, 'circle', 18, 'gradient', 'hover', false], ['modal', 540, 'blur', 'scale', 'plain'], ['top-center', 'minimal', 3500, true, 3], ['pills', 'center', 'regular', false, true], 'ring', 'gradient-soft', 'Frosted glass cards, gradient sliders and floating pill tabs for a light modern feel.', ['glass']),
  SP('swiss-grid', 'Swiss Grid', 'editorial', ['square', 'solid', 700, true, 'md', false], ['outline', 'divided', 'md', 0], [2, 'square', 14, 'solid', 'always', true], ['modal', 600, 'dim', 'fade', 'accent-bar'], ['top-right', 'outline', 4000, true, 4], ['plain', 'start', 'regular', true, false], 'level-bar', 'hairline', 'Hard-edged uppercase buttons, outlined panels and plain tabs on a strict grid.', ['editorial', 'flat']),
  SP('touch-friendly', 'Touch Friendly', 'friendly', ['pill', 'solid', 600, false, 'lg', true], ['card', 'plain', 'lg', 1], [8, 'circle', 24, 'solid', 'always', false], ['sheet', 640, 'dim', 'slide', 'filled'], ['bottom-center', 'solid', 3500, true, 2], ['segmented', 'stretch', 'roomy', false, true], 'classic-arc', 'striped-pill', 'Big pill buttons, chunky sliders and bottom sheets sized for thumbs on tablets and phones.', ['touch']),
  SP('terminal', 'Terminal', 'technical', ['square', 'outline', 500, false, 'sm', false], ['outline', 'divided', 'sm', 0], [2, 'bar', 10, 'none', 'always', true], ['drawer', 480, 'none', 'slide', 'plain'], ['bottom-right', 'outline', 3000, false, 6], ['boxed', 'start', 'compact', true, false], 'digital', 'steps', 'Outlined square controls, numeric sliders and boxed tabs for developer consoles.', ['developer']),
  SP('studio-pro', 'Studio Pro', 'pro', ['rounded', 'solid', 600, false, 'md', false], ['panel', 'accent', 'md', 1], [4, 'circle', 16, 'solid', 'hover', false], ['drawer', 420, 'dim', 'slide', 'accent-bar'], ['top-right', 'solid', 4000, true, 4], ['underline', 'start', 'compact', true, true], 'tick-arc', 'hairline', 'Accent-headed panels, inspector drawers and compact tabs for design and studio tools.', ['creative']),
  SP('gradient-pop', 'Gradient Pop', 'vivid', ['pill', 'gradient', 700, false, 'md', true], ['card', 'accent', 'md', 2], [6, 'circle', 20, 'gradient', 'always', false], ['modal', 520, 'blur', 'scale', 'filled'], ['top-center', 'solid', 3800, true, 3], ['pills', 'center', 'regular', false, true], 'ring', 'striped-pill', 'Gradient pills, raised accent cards and lively modals for consumer-facing apps.', ['vivid']),
  SP('calm-reader', 'Calm Reader', 'calm', ['rounded', 'soft', 500, false, 'md', false], ['outline', 'plain', 'lg', 0], [3, 'circle', 14, 'solid', 'never', false], ['modal', 600, 'dim', 'fade', 'plain'], ['bottom-center', 'minimal', 3000, false, 2], ['plain', 'center', 'regular', false, false], 'level-bar', 'hairline', 'Quiet soft buttons, outlined cards and fading modals that never compete with the text.', ['reading']),
  SP('boardroom', 'Boardroom', 'formal', ['rounded', 'solid', 600, false, 'lg', false], ['card', 'divided', 'lg', 2], [4, 'circle', 18, 'solid', 'always', false], ['modal', 640, 'dim', 'fade', 'filled'], ['top-right', 'solid', 5000, true, 3], ['underline', 'stretch', 'regular', true, true], 'tick-arc', 'gradient-soft', 'Large confident buttons, wide divided cards and full-width tabs for formal reporting.', ['enterprise', 'formal']),
  SP('compact-admin', 'Compact Admin', 'compact', ['rounded', 'outline', 600, false, 'sm', false], ['panel', 'divided', 'sm', 1], [3, 'circle', 14, 'solid', 'hover', false], ['drawer', 400, 'dim', 'slide', 'plain'], ['bottom-right', 'solid', 3500, true, 4], ['segmented', 'start', 'compact', true, false], 'classic-arc', 'segments', 'Small outlined buttons, tight panels and segmented tabs for admin back offices.', ['compact']),
  SP('material-flow', 'Material Flow', 'material', ['rounded', 'solid', 500, false, 'md', true], ['card', 'plain', 'md', 2], [4, 'circle', 20, 'solid', 'hover', false], ['sheet', 600, 'dim', 'slide', 'plain'], ['bottom-center', 'solid', 4000, true, 3], ['underline', 'stretch', 'regular', true, true], 'ring', 'striped-pill', 'Raised buttons and cards, bottom sheets and stretched underline tabs in a material rhythm.', ['material']),
  // s20
  SP('neon-edge', 'Neon Edge', 'neon', ['square', 'gradient', 700, true, 'md', true], ['outline', 'accent', 'md', 0], [3, 'bar', 14, 'gradient', 'always', true], ['modal', 520, 'blur', 'scale', 'accent-bar'], ['top-right', 'outline', 3500, true, 4], ['boxed', 'start', 'regular', true, true], 'digital', 'striped-pill', 'Uppercase gradient buttons, accent-edged outlines and boxed tabs for dark, vivid looks.', ['vivid', 'dark']),
  SP('paper-cut', 'Paper Cut', 'paper', ['rounded', 'outline', 600, false, 'md', false], ['outline', 'plain', 'md', 0], [2, 'circle', 14, 'none', 'hover', false], ['modal', 540, 'dim', 'fade', 'plain'], ['top-center', 'outline', 3500, true, 3], ['plain', 'start', 'regular', true, false], 'level-bar', 'hairline', 'Outlines on paper: line buttons, flat outlined cards and plain tabs with a hairline rule.', ['flat']),
  SP('frosted-dock', 'Frosted Dock', 'frosted', ['pill', 'soft', 600, false, 'md', false], ['glass', 'divided', 'md', 2], [5, 'circle', 18, 'gradient', 'hover', false], ['drawer', 420, 'blur', 'slide', 'plain'], ['bottom-right', 'minimal', 3800, true, 3], ['pills', 'start', 'regular', false, true], 'ring', 'gradient-soft', 'Glass panels with dividers, blurred side drawers and soft pills, docked and airy.', ['glass']),
  SP('command-deck', 'Command Deck', 'command', ['square', 'solid', 700, true, 'sm', false], ['panel', 'accent', 'sm', 1], [3, 'bar', 12, 'solid', 'always', true], ['drawer', 460, 'dim', 'slide', 'accent-bar'], ['top-right', 'solid', 3000, true, 6], ['boxed', 'start', 'compact', true, false], 'digital', 'segments', 'Tight uppercase command buttons, accent panels and ticked bar sliders for control rooms.', ['ops']),
  SP('warm-craft', 'Warm Craft', 'warm', ['rounded', 'soft', 600, false, 'md', false], ['card', 'accent', 'lg', 1], [5, 'circle', 18, 'solid', 'always', false], ['modal', 560, 'dim', 'scale', 'filled'], ['bottom-center', 'solid', 4000, true, 3], ['pills', 'start', 'roomy', false, true], 'classic-arc', 'gradient-soft', 'Soft rounded buttons, roomy accent cards and filled modals with a crafted, friendly warmth.', ['warm']),
  SP('minimal-line', 'Minimal Line', 'minimal', ['rounded', 'outline', 500, false, 'md', false], ['outline', 'plain', 'md', 0], [2, 'circle', 12, 'solid', 'hover', false], ['modal', 520, 'none', 'fade', 'plain'], ['top-center', 'minimal', 3000, false, 2], ['underline', 'start', 'regular', true, false], 'tick-arc', 'hairline', 'The least ink: thin outlines, no backdrop, minimal pop-ups and an underline row.', ['minimal']),
  SP('kiosk-bold', 'Kiosk Bold', 'bold', ['pill', 'solid', 700, true, 'lg', true], ['card', 'accent', 'lg', 2], [10, 'circle', 28, 'solid', 'always', false], ['sheet', 720, 'dim', 'slide', 'filled'], ['bottom-center', 'solid', 5000, true, 2], ['segmented', 'stretch', 'roomy', false, true], 'level-bar', 'steps', 'Huge high-contrast buttons, chunky sliders and full-width sheets readable across a room.', ['kiosk', 'touch']),
  SP('data-pro', 'Data Pro', 'analytical', ['rounded', 'outline', 600, false, 'sm', false], ['panel', 'plain', 'sm', 0], [3, 'bar', 12, 'solid', 'always', true], ['drawer', 520, 'none', 'slide', 'plain'], ['bottom-right', 'outline', 3000, true, 5], ['underline', 'start', 'compact', true, false], 'tick-arc', 'segments', 'Flat panels, precise ticked sliders and wide detail drawers for analytics and grids.', ['data']),
  SP('lounge', 'Lounge', 'relaxed', ['pill', 'soft', 500, false, 'md', false], ['glass', 'plain', 'lg', 2], [4, 'circle', 20, 'gradient', 'never', false], ['modal', 560, 'blur', 'fade', 'plain'], ['top-center', 'minimal', 4500, true, 2], ['pills', 'center', 'roomy', false, true], 'ring', 'gradient-soft', 'Relaxed glass cards, soft pills and slow fades for media and lifestyle apps.', ['relaxed']),
  SP('field-rugged', 'Field Rugged', 'rugged', ['square', 'solid', 700, false, 'lg', true], ['panel', 'divided', 'lg', 1], [8, 'square', 24, 'solid', 'always', true], ['sheet', 680, 'dim', 'slide', 'accent-bar'], ['bottom-center', 'solid', 5000, true, 2], ['boxed', 'stretch', 'roomy', true, true], 'level-bar', 'steps', 'Big square controls, chunky ticked sliders and bottom sheets for gloves and field tablets.', ['rugged', 'touch']),
  SP('amber-signature', 'Amber Signature', 'signature', ['rounded', 'gradient', 600, false, 'md', true], ['card', 'accent', 'md', 2], [5, 'circle', 18, 'gradient', 'always', false], ['modal', 560, 'blur', 'scale', 'accent-bar'], ['top-right', 'solid', 4000, true, 4], ['pills', 'start', 'regular', false, true], 'classic-arc', 'striped-pill', 'The AmberX house controls: gradient buttons, accent cards, blurred modals and pill tabs.', ['brand', 'amber']),
  SP('gizmo-console', 'GizmoX Console', 'developer', ['rounded', 'solid', 600, false, 'sm', false], ['panel', 'divided', 'md', 1], [4, 'circle', 16, 'solid', 'hover', false], ['drawer', 460, 'dim', 'slide', 'accent-bar'], ['bottom-right', 'solid', 3500, true, 4], ['underline', 'start', 'compact', true, true], 'digital', 'hairline', 'The GizmoX development console set: compact solid buttons, divided panels and inspector drawers.', ['brand', 'developer']),
];
function stylePackageAssets() {
  const out = [];
  for (const f of STYLE_PACKAGES) {
    const base = { id: f.id, tags: ['style-package', f.tone, ...f.tags] };
    const [shape, fill, weight, uppercase, size, elevation] = f.btn;
    out.push(env('button', { ...base, name: `${f.name} button`, description: `${f.name}: ${shape} ${fill} buttons.` }, { shape, fill, weight, uppercase, size, elevation }));
    const [variant, header, padding, cElev] = f.card;
    out.push(env('container', { ...base, name: `${f.name} container`, description: `${f.name}: ${variant} with a ${header} header.` }, { variant, header, padding, elevation: cElev, collapsible: false }));
    const [track, thumb, thumbSize, sFill, showValue, ticks] = f.sl;
    out.push(env('slider', { ...base, name: `${f.name} slider`, description: `${f.name}: ${thumb} thumb on a ${track} px track.` }, { track, thumb, thumbSize, fill: sFill, showValue, ticks }));
    const [dv, width, backdrop, animation, dh] = f.dlg;
    out.push(env('dialog', { ...base, name: `${f.name} dialog`, description: `${f.name}: ${dv}, ${backdrop} backdrop, ${animation} in.` }, { variant: dv, width, backdrop, animation, header: dh, closeOnBackdrop: true }));
    const [position, pv, duration, showIcon, maxVisible] = f.pop;
    out.push(env('popup', { ...base, name: `${f.name} pop-ups`, description: `${f.name}: ${pv} pop-ups at the ${position}.` }, { position, variant: pv, duration, showIcon, maxVisible }));
    const [style, align, density, divider, showIcons] = f.tabs;
    out.push(env('tab-group', { ...base, name: `${f.name} tabs`, description: `${f.name}: ${style} tabs, ${align}.` }, { style, align, position: 'top', density, overflow: 'scroll', showIcons, divider }));
    out.push(env('style-package', { id: f.id, name: f.name, description: f.description, tags: [f.tone, ...f.tags] }, {
      slots: { button: f.id, container: f.id, slider: f.id, dialog: f.id, popup: f.id, 'tab-group': f.id, gauge: f.gauge, meter: f.meter }, tone: f.tone,
    }));
  }
  return out;
}

/* ───────────────────────── seeds: navigation menus + paired behaviour themes (s21, s22) ───────────────────────── */

// Pages every web app on the framework may have; a nav menu lists a set and each app draws only the pages it has
// (NavMenu drops items whose view isn't registered), so one menu serves the console, axHub, Patches, AmberX ….
const P = {
  home: ['home', 'Home', 'home'], settings: ['settings', 'Settings', 'settings'], account: ['account', 'Account', 'user'],
  assets: ['assets', 'Assets', 'layers'], components: ['components', 'Components', 'grid'], demos: ['demos', 'Demos', 'play'],
  plan: ['plan', 'Plan', 'list'], pending: ['pending', 'Pending builds', 'clock'], build: ['build', 'Build queue', 'hammer'], tracker: ['tracker', 'Tracker', 'chart'],
  catalog: ['catalog', 'Features', 'check-circle'], libraries: ['libraries', 'Libraries', 'package'], modules: ['modules', 'Modules', 'box'], boilerplates: ['boilerplates', 'Boilerplates', 'file'],
  projects: ['standards-projects', 'Projects', 'folder'], rules: ['standards-rules', 'Manifest rules', 'shield'],
  hub: ['hub', 'Hub', 'cloud'], approvals: ['approvals-log', 'Approvals', 'check'], services: ['services', 'Services', 'zap'], jobs: ['jobs', 'Jobs', 'refresh'],
  audit: ['audit', 'Audit', 'eye'], vault: ['vault', 'Vault', 'key'], users: ['users', 'Users', 'user'], hubProjects: ['projects', 'Hub projects', 'folder'],
  devices: ['devices', 'Devices', 'smartphone'], apps: ['apps', 'Apps', 'download'], goPass: ['go-pass', 'Go pass', 'rocket'], handoff: ['handoff', 'Handoff', 'external'],
  console: ['console', 'Console', 'terminal'], pilot: ['pilot', 'Pilot', 'sparkles'], axhub: ['axhub', 'axHub', 'cloud'],
};
const navItems = (keys) => keys.map((k) => { const [view, label, icon] = P[k]; return { id: view, label, icon, view }; });
const NS = (label, keys) => ({ ...(label ? { label } : {}), items: navItems(keys) });
const NAV = (style, sections, o = {}) => ({ style, ...(o.header ? { header: o.header } : {}), sections, ...(o.density ? { density: o.density } : {}), ...(o.indicator ? { indicator: o.indicator } : {}), ...(o.showIcons === false ? { showIcons: false } : {}) });
const DEV = [NS('Overview', ['home']), NS('Build', ['plan', 'pending', 'build', 'tracker']), NS('Framework', ['catalog', 'libraries', 'modules', 'boilerplates', 'components', 'assets']), NS('Standards', ['projects', 'rules']), NS('You', ['account', 'settings'])];
const HUB = [NS('Hub', ['home', 'hub', 'approvals', 'handoff', 'goPass']), NS('Manage', ['services', 'jobs', 'audit', 'vault', 'users', 'hubProjects', 'devices']), NS('Get', ['apps']), NS(null, ['account', 'settings'])];

/** Behaviour theme shorthand: motion [speed easing entrance], interaction [hover press longPressMs doubleTapMs drag],
 *  windows [dialogOpen backdrop popupOpen drawerOpen snap snapGrid stack minimize], feedback [toastPosition toastMs sound vibration confirmDelete]. */
const BH = ([speed, easing, entrance], [hover, press, longPressMs, doubleTapMs, dragThreshold], [dialogOpen, backdrop, popupOpen, drawerOpen, snap, snapGrid, stack, minimize], [toastPosition, toastMs, sound, vibration, confirmDelete]) => ({
  motion: { speed, easing, reduced: 'system', entrance },
  interaction: { hover, press, focusRing: 'auto', cursor: 'pointer', longPressMs, doubleTapMs, dragThreshold },
  windows: { dialogOpen, backdrop, popupOpen, drawerOpen, snap, snapGrid, stack, minimize, closeOnBackdrop: true, closeOnEscape: true },
  feedback: { toastPosition, toastMs, sound, vibration, confirmDelete, busyCursor: true },
});
// [nav id, nav name, nav data, paired behaviour id, behaviour (null = an existing starter), behaviour name, use, behaviour description]
const NAVS = [
  // s21
  ['essentials-list', 'Essentials List', NAV('list', [NS(null, ['home', 'settings', 'account'])]), 'standard', null, null, 'small apps', ''],
  ['essentials-rail', 'Essentials Rail', NAV('rail', [NS(null, ['home']), NS(null, ['settings', 'account'])], { density: 'compact' }), 'snappy', null, null, 'small apps, desktop', ''],
  ['essentials-pills', 'Essentials Pills', NAV('pills', [NS(null, ['home', 'settings', 'account'])], { indicator: 'fill' }), 'calm', null, null, 'small apps, top bar', ''],
  ['developer-console', 'Developer Console', NAV('list', DEV, { header: 'Develop' }), 'precise', BH(['fast', 'standard', 'fade'], ['tint', 'darken', 500, 280, 6], ['fade', 'dim', 'fade', 'slide', true, 8, 'remember', 'dock'], ['bottom-right', 3500, 'off', 'off', 'risky']), 'Precise', 'developer consoles', 'Fast, exact and quiet: short fades, tinted hovers, snapping windows that remember where they were, minimise to a dock, confirm only risky deletes.'],
  ['developer-rail', 'Developer Rail', NAV('rail', DEV, { density: 'compact', indicator: 'bar' }), 'swift', BH(['fast', 'emphasized', 'none'], ['tint', 'shrink', 450, 250, 6], ['scale', 'none', 'fade', 'slide', true, 8, 'cascade', 'cursor'], ['top-right', 3000, 'off', 'off', 'risky']), 'Swift', 'developer consoles, rail', 'Swift and direct: no page entrance, quick scale-in dialogs without a backdrop, shrink on press.'],
  ['hub-admin', 'Hub Admin', NAV('list', HUB, { header: 'axHub' }), 'steady', BH(['normal', 'standard', 'fade'], ['tint', 'darken', 600, 300, 10], ['fade', 'dim', 'fade', 'slide', false, 8, 'center', 'dock'], ['top-right', 6000, 'subtle', 'off', 'always']), 'Steady', 'admin consoles', 'Calm, deliberate administration: centred windows, long readable toasts with a subtle sound, always confirm deletes.'],
  ['hub-rail', 'Hub Rail', NAV('rail', HUB, { density: 'compact' }), 'brisk', BH(['fast', 'standard', 'fade'], ['lift', 'shrink', 500, 260, 8], ['slide-up', 'dim', 'slide', 'slide', true, 8, 'cascade', 'dock'], ['top-right', 4000, 'off', 'light', 'risky']), 'Brisk', 'admin consoles, rail', 'Brisk admin work: dialogs slide up, buttons lift and shrink, light haptics on phones.'],
  ['wrapper-tabs', 'Wrapper Tabs', NAV('pills', [NS(null, ['console', 'pilot', 'axhub', 'settings'])], { indicator: 'fill', density: 'compact' }), 'fluid', BH(['normal', 'spring', 'scale'], ['lift', 'shrink', 500, 280, 8], ['scale', 'blur', 'scale', 'slide', false, 8, 'cascade', 'cursor'], ['top', 4000, 'off', 'light', 'risky']), 'Fluid', 'app wrappers with tabs', 'Fluid and springy: pages scale in, frosted dialogs, toasts at the top.'],
  ['design-studio', 'Design Studio', NAV('list', [NS('Design', ['home', 'components', 'assets', 'demos']), NS(null, ['settings'])], { indicator: 'fill' }), 'playful', null, null, 'design tools', ''],
  ['build-tracker', 'Build Tracker', NAV('list', [NS('Builds', ['plan', 'pending', 'build', 'tracker']), NS(null, ['home', 'settings'])], { density: 'compact' }), 'focused', BH(['fast', 'standard', 'none'], ['tint', 'darken', 550, 300, 8], ['fade', 'dim', 'fade', 'slide', true, 8, 'remember', 'dock'], ['bottom-right', 4000, 'off', 'off', 'risky']), 'Focused', 'build and task tracking', 'Nothing moves that doesn\'t need to: no page entrance, quick fades, toasts in the corner.'],
  ['framework-browser', 'Framework Browser', NAV('list', [NS('Browse', ['catalog', 'libraries', 'modules', 'boilerplates']), NS('Look', ['components', 'assets'])]), 'gentle', BH(['slow', 'standard', 'rise'], ['tint', 'none', 650, 320, 10], ['fade', 'dim', 'fade', 'slide', false, 8, 'center', 'cursor'], ['bottom', 5000, 'off', 'off', 'risky']), 'Gentle', 'catalog browsing', 'Gentle browsing: pages rise in slowly, soft fades, nothing jumps.'],
  ['compact-rail-all', 'Compact Rail (every page)', NAV('rail', [NS(null, ['home', 'plan', 'pending', 'build', 'catalog', 'libraries', 'hub', 'approvals', 'apps', 'console', 'pilot', 'axhub', 'components', 'assets']), NS(null, ['account', 'settings'])], { density: 'compact', indicator: 'bar' }), 'minimal-motion', null, null, 'any app: every page it has', ''],
  ['roomy-touch', 'Roomy Touch', NAV('list', [NS(null, ['home', 'apps', 'approvals', 'settings', 'account'])], { density: 'roomy', indicator: 'fill' }), 'touch', BH(['normal', 'standard', 'rise'], ['none', 'ripple', 400, 300, 14], ['slide-up', 'dim', 'slide', 'slide', false, 8, 'center', 'none'], ['bottom', 4000, 'off', 'light', 'risky']), 'Touch', 'phones and tablets', 'Made for fingers: no hover, ripple on press, dialogs slide up from the bottom, light haptics.'],
  // s22
  ['text-only', 'Text Only', NAV('list', [NS(null, ['home', 'plan', 'pending', 'catalog', 'components', 'assets', 'settings'])], { showIcons: false, indicator: 'bar' }), 'quiet', BH(['normal', 'linear', 'none'], ['underline', 'none', 600, 300, 10], ['fade', 'dim', 'fade', 'fade', false, 8, 'center', 'cursor'], ['bottom', 4000, 'off', 'off', 'risky']), 'Quiet', 'reading-first apps', 'Quiet text: underline on hover, linear fades, no page entrance or sound.'],
  ['executive-overview', 'Executive Overview', NAV('list', [NS('Overview', ['home', 'tracker', 'plan']), NS('Detail', ['pending', 'build', 'catalog']), NS(null, ['settings'])], { header: 'Overview', density: 'roomy' }), 'executive', BH(['slow', 'standard', 'fade'], ['lift', 'none', 650, 320, 10], ['fade', 'blur', 'fade', 'slide', false, 8, 'center', 'dock'], ['top-right', 7000, 'subtle', 'off', 'always']), 'Executive', 'reporting and dashboards', 'Unhurried and polished: slow fades, lifted cards, frosted dialogs, long toasts.'],
  ['ops-monitor', 'Ops Monitor', NAV('rail', [NS(null, ['home', 'jobs', 'services', 'audit', 'devices']), NS(null, ['settings'])], { density: 'compact', indicator: 'fill' }), 'alert', BH(['fast', 'emphasized', 'none'], ['tint', 'darken', 500, 260, 8], ['scale', 'dim', 'slide', 'slide', true, 8, 'cascade', 'dock'], ['top-right', 8000, 'full', 'strong', 'always']), 'Alert', 'monitoring and on-call', 'Built to get attention: full sound and strong haptics on notices, long-lived toasts, always confirm.'],
  ['security-center', 'Security Center', NAV('list', [NS('Security', ['vault', 'users', 'audit', 'goPass']), NS(null, ['account', 'settings'])], { header: 'Security' }), 'secure', BH(['normal', 'standard', 'fade'], ['tint', 'darken', 800, 300, 12], ['fade', 'blur', 'fade', 'slide', false, 8, 'center', 'none'], ['top', 6000, 'subtle', 'light', 'always']), 'Secure', 'security and access screens', 'Careful by default: long-press takes longer, windows never minimise, every delete is confirmed.'],
  ['approvals-flow', 'Approvals Flow', NAV('pills', [NS(null, ['home', 'approvals', 'handoff', 'apps'])], { indicator: 'fill' }), 'review', BH(['normal', 'standard', 'fade'], ['tint', 'darken', 600, 300, 10], ['slide-up', 'dim', 'slide', 'slide', false, 8, 'center', 'dock'], ['bottom', 5000, 'subtle', 'light', 'always']), 'Review', 'approval queues', 'For reviewers: dialogs slide up centred, a subtle sound on each result, always confirm.'],
  ['project-hub', 'Project Hub', NAV('list', [NS('Projects', ['projects', 'hubProjects', 'rules']), NS('Plan', ['plan', 'tracker'])]), 'organized', BH(['normal', 'standard', 'rise'], ['tint', 'darken', 550, 300, 8], ['scale', 'dim', 'fade', 'slide', true, 12, 'remember', 'dock'], ['top-right', 5000, 'off', 'off', 'risky']), 'Organized', 'project management', 'Tidy: a 12 px snap grid, windows that remember their places, a dock for minimised ones.'],
  ['kiosk-strip', 'Kiosk Strip', NAV('pills', [NS(null, ['home', 'apps'])], { density: 'roomy', indicator: 'fill' }), 'kiosk', BH(['slow', 'standard', 'fade'], ['none', 'darken', 900, 400, 20], ['fade', 'dim', 'fade', 'fade', false, 0, 'center', 'none'], ['bottom', 6000, 'off', 'off', 'always']), 'Kiosk', 'kiosks and shared screens', 'Forgiving for strangers: no hover, slow long-press, large drag threshold, nothing minimises.'],
  ['learning-path', 'Learning Path', NAV('list', [NS('Start', ['home', 'demos']), NS('Learn', ['components', 'catalog', 'libraries'])], { density: 'roomy' }), 'guided', BH(['slow', 'spring', 'rise'], ['glow', 'shrink', 600, 320, 10], ['scale', 'blur', 'scale', 'slide', false, 8, 'center', 'cursor'], ['top', 6000, 'subtle', 'light', 'risky']), 'Guided', 'onboarding and learning', 'Encouraging and clear: springy pages rise in, glowing hovers, a subtle sound on success.'],
  ['power-rail', 'Power Rail', NAV('rail', [NS(null, ['home', 'plan', 'pending', 'build', 'tracker', 'catalog', 'libraries', 'modules', 'components', 'assets']), NS(null, ['settings'])], { density: 'compact', indicator: 'fill', showIcons: true }), 'instant', BH(['instant', 'linear', 'none'], ['tint', 'none', 400, 220, 4], ['none', 'none', 'none', 'none', true, 4, 'remember', 'dock'], ['bottom-right', 2500, 'off', 'off', 'never']), 'Instant', 'power users', 'No animation at all, short toasts, a 4 px snap, and no delete confirmations: for people who know what they\'re doing.'],
  ['cinematic', 'Cinematic', NAV('list', [NS(null, ['home', 'demos', 'assets', 'components'])], { density: 'roomy', indicator: 'none' }), 'cinematic', BH(['relaxed', 'spring', 'scale'], ['glow', 'shrink', 650, 320, 10], ['scale', 'blur', 'scale', 'slide', false, 8, 'center', 'cursor'], ['bottom', 5000, 'subtle', 'light', 'risky']), 'Cinematic', 'showcases and demos', 'Showcase motion: relaxed spring scaling, glow on hover, frosted backdrops.'],
  ['amber-signature', 'AmberX Signature', NAV('list', [NS(null, ['home', 'approvals', 'apps']), NS('Make', ['components', 'assets', 'demos']), NS(null, ['settings'])], { header: 'AmberX', indicator: 'fill' }), 'amber', BH(['normal', 'emphasized', 'rise'], ['lift', 'shrink', 500, 280, 8], ['scale', 'blur', 'scale', 'slide', true, 8, 'cascade', 'cursor'], ['top-right', 4500, 'subtle', 'light', 'risky']), 'AmberX', 'the AmberX house behaviour', 'The AmberX house feel: emphasized motion, lifting hovers, frosted dialogs, a subtle sound.'],
  ['gizmo-console', 'GizmoX Console', NAV('list', DEV, { header: 'GizmoX', density: 'compact', indicator: 'bar' }), 'gizmo', BH(['fast', 'emphasized', 'fade'], ['tint', 'darken', 500, 260, 6], ['fade', 'dim', 'fade', 'slide', true, 8, 'remember', 'dock'], ['bottom-right', 3500, 'off', 'off', 'risky']), 'GizmoX', 'the GizmoX development console', 'The GizmoX console feel: fast emphasized fades, docked windows that remember their places, quiet notices.'],
];
function navAssets() {
  const out = [];
  for (const [id, name, data, bid, bdata, bname, use, bdesc] of NAVS) {
    out.push(env('nav-menu', { id, name, tags: ['pairs:' + bid], description: `${name}: ${use}. Lists the pages it can; each app shows the ones it has. Pairs with the ${bname ?? bid} behaviour theme.` }, data));
    if (bdata) out.push(env('behavior-theme', { id: bid, name: bname, tags: ['pairs:' + id], description: bdesc }, bdata));
  }
  return out;
}

/* ───────────────────────── seeds: design packages (s23) ───────────────────────── */

// [id, name, style, colour, layout, behaviour, extras slots, spacing?, tags, description]
const DP = [
  ['enterprise-day', 'Enterprise Day', 'enterprise', 'porcelain', 'enterprise-shell', 'steady', { 'style-package': 'enterprise-crisp', toolbar: 'enterprise-command', 'context-menu': 'enterprise-standard' }, null, ['light', 'enterprise'], 'The dependable business look by day: Inter on porcelain, the full enterprise frame, crisp controls and steady behaviour.'],
  ['enterprise-night', 'Enterprise Night', 'enterprise', 'obsidian', 'enterprise-shell', 'steady', { 'style-package': 'enterprise-crisp', toolbar: 'enterprise-command', 'context-menu': 'enterprise-standard' }, null, ['dark', 'enterprise'], 'The same enterprise frame and controls on Obsidian for long evenings.'],
  ['executive-suite', 'Executive Suite', 'executive', 'harbor', 'portal-top', 'executive', { 'style-package': 'executive-soft', toolbar: 'brand-bar', 'nav-menu': 'executive-overview' }, 'regular', ['light', 'presentation'], 'IBM Plex on harbour navy, a centred portal page, soft controls and unhurried motion for presenting.'],
  ['data-desk', 'Data Desk', 'dense-grid', 'slate-steel', 'data-grid', 'precise', { 'style-package': 'data-pro', toolbar: 'data-grid-tools' }, 'tight', ['dark', 'data'], 'Dense 13 px type on brushed steel, every pixel for grids, precise controls and quick, exact motion.'],
  ['ops-center', 'Ops Center', 'industrial', 'graphite-mint', 'command-center', 'alert', { 'style-package': 'command-deck', toolbar: 'ops-monitor', 'nav-menu': 'ops-monitor' }, null, ['dark', 'ops'], 'Condensed industrial type, mint on graphite, a command-center frame and attention-getting notices.'],
  ['swiss-editorial', 'Swiss Editorial', 'swiss', 'mono-paper', 'document-reader', 'quiet', { 'style-package': 'swiss-grid', toolbar: 'reader-bar', 'nav-menu': 'text-only' }, 'regular', ['light', 'editorial'], 'Swiss typography on near-monochrome paper in a reading column, with quiet text-only navigation.'],
  ['glass-studio', 'Glass Studio', 'glass-pro', 'aurora-night', 'canvas-studio', 'fluid', { 'style-package': 'glass-air', toolbar: 'appearance-studio' }, null, ['dark', 'glass', 'creative'], 'Frosted glass panels under an aurora sky, a design-tool frame and fluid, springy motion.'],
  ['touch-tablet', 'Touch Tablet', 'soft-touch', 'meadow', 'right-handed', 'touch', { 'style-package': 'touch-friendly', toolbar: 'touch-dock', 'nav-menu': 'roomy-touch', 'context-menu': 'touch-large' }, 'regular', ['light', 'touch'], 'Rounded, roomy and thumb-friendly on soft sage, with navigation on the right and haptic feedback.'],
  ['humanist-reader', 'Humanist Reader', 'humanist', 'linen-slate', 'document-reader', 'gentle', { 'style-package': 'calm-reader', 'nav-menu': 'text-only', 'context-menu': 'reader-minimal' }, 'regular', ['light', 'reading'], 'Serif headings on warm linen in a focused reading column; gentle motion and a minimal menu.'],
  ['creative-plum', 'Creative Plum', 'geometric', 'plum-noir', 'canvas-studio', 'cinematic', { 'style-package': 'gradient-pop', toolbar: 'appearance-studio', 'context-menu': 'appearance-quick' }, null, ['dark', 'creative'], 'Geometric type on plum-black, gradient controls and cinematic motion for creative suites.'],
  ['kiosk-display', 'Kiosk Display', 'soft-touch', 'saffron-day', 'kiosk', 'kiosk', { 'style-package': 'kiosk-bold', toolbar: 'kiosk-lite', 'context-menu': 'locked-down' }, 'regular', ['light', 'kiosk'], 'Chrome-free, big-target and forgiving: for kiosks, wall displays and shared screens.'],
  ['amberx-signature-day', 'AmberX Signature Day', 'geometric', 'saffron-day', 'signature-dock', 'amber', { 'style-package': 'amber-signature', toolbar: 'amberx-signature', 'nav-menu': 'amber-signature' }, null, ['light', 'brand', 'amber'], 'The AmberX house look by day: gold on cream, signature controls, the AmberX toolbar and behaviour.'],
  ['amberx-signature-night', 'AmberX Signature Night', 'geometric', 'carbon-amber', 'signature-dock', 'amber', { 'style-package': 'amber-signature', toolbar: 'amberx-signature', 'nav-menu': 'amber-signature' }, null, ['dark', 'brand', 'amber'], 'The AmberX house look after dark: molten gold on carbon, with the same signature set.'],
  ['gizmox-console', 'GizmoX Console', 'terminal-pro', 'obsidian', 'console-pro', 'gizmo', { 'style-package': 'gizmo-console', toolbar: 'developer-ops', 'nav-menu': 'gizmo-console', 'context-menu': 'developer-tools' }, 'tight', ['dark', 'brand', 'developer'], 'The GizmoX development console: monospace headings on Obsidian, the console frame, developer toolbar and menus.'],
];
// The scale assets every package names (Angel build ui-all-assets, Oct 31 2026): compact unless the package's look needs more room.
const DP_SCALE = {
  'kiosk-display': { typography: 'standard', density: 'roomy', sizing: 'touch' },
  'touch-tablet': { density: 'roomy', sizing: 'touch' },
  'data-desk': { density: 'dense' },
  'humanist-reader': { typography: 'reader', density: 'standard', sizing: 'standard' },
  'swiss-editorial': { typography: 'reader' },
  'executive-suite': { typography: 'standard', density: 'standard', sizing: 'standard' },
};
const scaleSlots = (id) => ({ typography: 'compact', density: 'compact', sizing: 'compact', ...(DP_SCALE[id] ?? {}) });
const designPackageAssets = () => DP.map(([id, name, style, color, layout, behavior, slots, spacing, tags, description]) => env('design-package', { id, name, tags, description },
  { 'style-theme': style, 'color-theme': color, layout, 'behavior-theme': behavior, extras: { slots: { ...slots, ...scaleSlots(id) }, ...(spacing ? { spacing } : {}) } }));

function toolbarDoc() {
  const PROVIDERS = { views: 'every page the app registers (`nav:<view>`)', nav: 'the active navigation menu’s items', settings: 'every settings tab, plugins’ included (`settings.open:<tab>`)', windows: 'every open floating window (`windows.restore:<id>`)', dialogs: 'every registered dialog (`dialog:<id>`)', chrome: 'show/hide toggles for every bar and menu, drawn pressed while shown' };
  const lines = [
    '# Toolbar library', '',
    'Generated by `node framework/cli/asset-library.mjs` from its toolbar seeds — edit the seeds, not this file',
    '(`--check` in CI fails when they drift). 25 starter toolbars in `framework/assets/toolbar/`; any app picks one in',
    'Settings → Appearance → Toolbar, a design package or an interface.', '',
    '## What makes a toolbar dynamic', '',
    '- **Live groups** — a group with `provider: "<id>"` gets its buttons from the application menu’s provider registry',
    '  (`rt.registerAppMenuProvider`), after any fixed items, capped by `max` (1–24, default 8) and reloaded shortly',
    '  after the app’s state changes. Built-in providers:', '',
    ...Object.entries(PROVIDERS).map(([k, v]) => `  - \`${k}\` — ${v}`), '',
    '  Apps and plugins register more (the console adds `console.pending`, `console.plugins`, …); a group whose provider',
    '  isn’t registered and has no fixed items isn’t drawn.',
    '- **Badges** — `items[].badge: "<counter>"` shows a runtime counter (`rt.setBadge`) on the button, hidden at 0.',
    '- **Toggles** — `items[].checked: "setting:<key>" | "counter:<name>" | "slot:<type>" | "hidden:<type>"` draws the',
    '  button pressed (`aria-pressed`) while the binding is on (same bindings as the application menu).',
    '- **Widgets** — `widgets: [{type, id, at: start|end, order}]` places clock, status, counter, progress, logo,',
    '  label, avatar, theme switch, spacer, divider, search bar … widgets; status/counter/progress follow runtime counters.',
    '- **Live search** — `search: { live: true, placeholder, maxResults, kinds }` finds pages, actions, settings,',
    '  dialogs, assets, windows and words as you type (Ctrl/Cmd+K or /).',
    '- **Look** — `density` compact/regular/roomy, `surface` flat/raised/glass, `divider`, `collapsible` (fold, per device).', '',
    'Every button is gated by UAC (`requires`), and a host app (embed@1) can take or lock an action. Android twin of',
    'live groups and toggles: deferred (port on hold, `framework/spec/PORTING.md`).', '',
    '## The toolbars', '',
    '| Toolbar | For | Look | Live groups | Counters & toggles | Widgets |', '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const s of TOOLBAR) {
    const d = s.data;
    const provs = d.groups.filter((g) => g.provider).map((g) => `\`${g.provider}\` ×${g.max ?? 8}`).join(', ') || '—';
    const items = d.groups.flatMap((g) => g.items);
    const ct = [...new Set(items.flatMap((it) => [it.badge && `badge \`${it.badge}\``, it.checked && `\`${it.checked}\``]).filter(Boolean))].join(', ') || '—';
    const wid = (d.widgets ?? []).map((w) => `${w.type}/${w.id} (${w.at})`).join(', ') || (d.search?.live ? 'live search' : '—');
    const look = [d.variant, d.align, d.density ?? 'regular', d.surface ?? 'flat', d.collapsible ? 'folds' : ''].filter(Boolean).join(' · ');
    lines.push(`| **${s.name}** \`${s.id}\` | ${s.use} | ${look} | ${provs} | ${ct} | ${wid}${d.search?.live && d.widgets ? ', live search' : ''} |`);
  }
  lines.push('', '## Each toolbar', '');
  for (const s of TOOLBAR) {
    lines.push(`### ${s.name} (\`${s.id}\`)`, '', s.description, '');
    for (const g of s.data.groups) {
      const fixed = g.items.map((it) => `${it.label} (\`${it.action}\`${it.badge ? `, badge ${it.badge}` : ''}${it.checked ? `, ${it.checked}` : ''})`).join('; ');
      lines.push(`- **${g.label ?? g.id}**: ${[fixed, g.provider ? `live \`${g.provider}\` up to ${g.max ?? 8}` : ''].filter(Boolean).join(' + ')}`);
    }
    if (!s.data.groups.length) lines.push('- No buttons: widgets only.');
    lines.push('');
  }
  return lines.join('\n');
}

const env = (type, s, data, extra = {}) => ({
  $axf: 'asset@1', type, id: s.id, name: s.name, version: '1.0.0', description: s.description, author: AUTHOR,
  tags: s.tags ?? [], ...extra, data,
});

const BUILD = {
  'color-theme': () => COLOR.map((s) => env('color-theme', s, { scheme: s.scheme, tokens: deriveColor(s) })),
  layout: () => LAYOUT.map((s) => env('layout', s, s.data)),
  'style-theme': () => STYLE.map((s) => env('style-theme', s, s.data)),
  'context-menu': () => CM.map((s) => env('context-menu', s, s.data)),
  toolbar: () => TOOLBAR.map((s) => env('toolbar', s, s.data)),
  'style-package': () => stylePackageAssets(),
  'nav-menu': () => navAssets(),
  'design-package': () => designPackageAssets(),
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
  // documents generated from the same seeds
  const docs = types.includes('toolbar') ? [[join(ROOT, '..', 'spec', 'TOOLBARS.md'), toolbarDoc() + '\n']] : [];
  for (const [file, text] of docs) {
    if (check) { if (!existsSync(file) || readFileSync(file, 'utf8') !== text) drift.push(file.split('/').slice(-2).join('/')); }
    else writeFileSync(file, text);
  }
  const counts = assets.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] ?? 0) + 1 }), {});
  if (args.includes('--json')) console.log(JSON.stringify({ counts, drift }));
  else console.log(check ? (drift.length ? `drift: ${drift.join(', ')}` : 'asset library in sync') : `wrote ${JSON.stringify(counts)}`);
  if (check && drift.length) process.exit(1);
}
