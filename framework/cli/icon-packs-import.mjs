#!/usr/bin/env node
/**
 * icon-packs-import: turn open icon sets (npm tarballs, unpacked) into icon-pack@1 assets the icon map can apply.
 *
 *   node framework/cli/icon-packs-import.mjs <sets dir> [--out framework/assets/icon-pack] [--only id,id] [--json]
 *
 * <sets dir> holds the unpacked tarballs (`npm pack --ignore-scripts <pkg>` then `tar -xzf`), one folder per package
 * named like the tarball (lucide-static-1.72.0/package/…). The SVG files are read as data only: every shape (path,
 * circle, ellipse, rect, line, polyline, polygon) becomes path commands, scaled onto a 16-48 grid when the set uses
 * another (Phosphor 256, Ionicons 512); a glyph with transforms, masks, clip paths or even-odd fills is left out (the
 * framework glyph draws instead). Each framework glyph name is looked up through a synonym table (house for home,
 * gear for settings, …); a name a set lacks falls back to the framework glyph.
 *
 * Every pack declares `themable` (true = currentColor, follows the skin's colour and stroke tokens; false = fixed-colour
 * art, carried in glyph `layers` with a one-colour `d` fallback) and its licence; only sets whose licence allows
 * redistribution are listed (ISC, MIT, Apache-2.0, CC-BY-4.0 with attribution).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLYPHS, GLYPH_NAMES } from '../core/engines/glyphs.mjs';
import { iconPackErrors, ICON_LIMITS } from '../core/engines/brand-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/* ------------------------------------------------------------------ synonyms: framework glyph → names in the sets */

export const SYNONYMS = {
  home: ['home', 'house'],
  grid: ['grid', 'layout-grid', 'grid-four', 'squares-four', 'squares-2x2', 'grid-3x3-gap', 'grid-view', 'apps', 'view-grid'],
  layers: ['layers', 'stack', 'stack-2', 'square-stack', 'rectangle-stack', 'layers-outline'],
  user: ['user', 'person'],
  settings: ['settings', 'gear', 'cog', 'gear-six', 'cog-6-tooth'],
  file: ['file', 'file-text', 'document', 'file-earmark', 'description', 'document-text'],
  folder: ['folder'],
  save: ['save', 'floppy-disk', 'device-floppy', 'floppy', 'floppy2'],
  undo: ['undo', 'undo-2', 'arrow-counter-clockwise', 'arrow-uturn-left', 'arrow-back-up', 'arrow-counterclockwise'],
  redo: ['redo', 'redo-2', 'arrow-clockwise', 'arrow-uturn-right', 'arrow-forward-up'],
  copy: ['copy', 'files', 'document-duplicate', 'content-copy', 'copy-simple'],
  cut: ['cut', 'scissors', 'content-cut'],
  paste: ['clipboard-paste', 'clipboard', 'content-paste', 'clipboard-text', 'clipboard-document'],
  search: ['search', 'magnifying-glass'],
  plus: ['plus', 'add', 'plus-lg'],
  trash: ['trash', 'trash-2', 'trash-can', 'delete', 'trash3'],
  palette: ['palette', 'swatches', 'color-swatch', 'color-palette'],
  layout: ['layout', 'layout-dashboard', 'dashboard', 'panels-top-left', 'layout-template'],
  type: ['type', 'text-t', 'typography', 'text', 'title', 'letter-case', 'text-size'],
  sun: ['sun', 'light-mode', 'sunny', 'brightness-high'],
  moon: ['moon', 'dark-mode', 'moon-stars'],
  bell: ['bell', 'notifications', 'notification'],
  info: ['info', 'info-circle', 'information-circle', 'information', 'circle-info'],
  help: ['help', 'circle-help', 'help-circle', 'question', 'question-mark-circle', 'question-circle', 'help-outline'],
  lock: ['lock', 'lock-closed', 'lock-simple', 'lock-keyhole'],
  unlock: ['unlock', 'lock-open', 'lock-simple-open', 'lock-open-outline', 'lock-keyhole-open'],
  key: ['key', 'vpn-key'],
  shield: ['shield', 'security'],
  zap: ['zap', 'lightning', 'bolt', 'flash', 'lightning-charge'],
  sliders: ['sliders-horizontal', 'sliders', 'adjustments-horizontal', 'adjustments', 'tune', 'options', 'sliders2'],
  box: ['box', 'cube', 'package'],
  menu: ['menu', 'list', 'bars-3', 'menu-2', 'three-bars', 'reorder-three', 'hamburger'],
  x: ['x', 'close', 'x-mark', 'x-lg', 'xmark'],
  'chevron-right': ['chevron-right', 'caret-right', 'nav-arrow-right', 'keyboard-arrow-right', 'chevron-forward'],
  'chevron-left': ['chevron-left', 'caret-left', 'nav-arrow-left', 'keyboard-arrow-left', 'chevron-back'],
  'chevron-down': ['chevron-down', 'caret-down', 'nav-arrow-down', 'keyboard-arrow-down', 'expand-more'],
  'chevron-up': ['chevron-up', 'caret-up', 'nav-arrow-up', 'keyboard-arrow-up', 'expand-less'],
  check: ['check', 'checkmark', 'done', 'check-lg'],
  refresh: ['refresh-cw', 'refresh', 'rotate-cw', 'arrows-clockwise', 'arrow-path', 'arrow-clockwise', 'sync', 'refresh-double'],
  shuffle: ['shuffle', 'arrows-shuffle', 'shuffle-angular'],
  download: ['download', 'arrow-down-tray', 'download-simple', 'file-download'],
  upload: ['upload', 'arrow-up-tray', 'upload-simple', 'file-upload'],
  code: ['code', 'code-bracket', 'code-slash', 'code-brackets'],
  terminal: ['terminal', 'square-terminal', 'terminal-window', 'command-line', 'terminal-2'],
  play: ['play', 'play-arrow', 'play-fill'],
  pause: ['pause'],
  stop: ['square', 'stop'],
  star: ['star'],
  eye: ['eye', 'visibility'],
  keyboard: ['keyboard'],
  monitor: ['monitor', 'desktop', 'computer-desktop', 'display', 'desktop-windows', 'device-desktop'],
  smartphone: ['smartphone', 'device-mobile', 'device-phone-mobile', 'phone-portrait', 'mobile', 'phone'],
  cloud: ['cloud'],
  branch: ['git-branch', 'branch'],
  logout: ['log-out', 'logout', 'sign-out', 'arrow-right-on-rectangle', 'arrow-left-start-on-rectangle', 'box-arrow-right', 'exit'],
  sparkles: ['sparkles', 'sparkle', 'stars', 'auto-awesome'],
  alert: ['triangle-alert', 'alert-triangle', 'warning', 'exclamation-triangle', 'alert'],
  'check-circle': ['circle-check', 'check-circle', 'checkmark-circle', 'check-circle-2'],
  'x-circle': ['circle-x', 'x-circle', 'close-circle', 'x-mark-circle', 'xmark-circle', 'cancel'],
  package: ['package', 'archive', 'archive-box', 'box-seam', 'inventory-2', 'package-2'],
  external: ['external-link', 'arrow-square-out', 'arrow-top-right-on-square', 'open-in-new', 'box-arrow-up-right', 'link-external', 'open-new-window'],
  minus: ['minus', 'remove', 'dash', 'dash-lg'],
  minimize: ['minimize-2', 'minimize', 'arrows-in', 'arrows-pointing-in', 'fullscreen-exit', 'close-fullscreen', 'collapse'],
  maximize: ['maximize-2', 'maximize', 'arrows-out', 'arrows-pointing-out', 'fullscreen', 'open-in-full', 'expand'],
  restore: ['app-window', 'browsers', 'square-2-stack', 'filter-none', 'window-restore', 'copy'],
  more: ['ellipsis', 'more-horizontal', 'dots-three', 'ellipsis-horizontal', 'three-dots', 'more-horiz', 'dots', 'kebab-horizontal'],
  hammer: ['hammer', 'hardware', 'gavel'],
  list: ['list', 'list-bullets', 'list-bullet', 'list-ul', 'format-list-bulleted', 'view-list', 'list-unordered'],
  'arrow-left': ['arrow-left', 'arrow-back'],
  'arrow-right': ['arrow-right', 'arrow-forward'],
  'arrow-up': ['arrow-up', 'arrow-upward'],
  'arrow-down': ['arrow-down', 'arrow-downward'],
  edit: ['pencil', 'edit', 'pencil-simple', 'pencil-square', 'edit-2', 'pen', 'create'],
  clock: ['clock', 'time', 'schedule', 'access-time', 'clock-3'],
  mic: ['mic', 'microphone'],
  chart: ['chart-bar', 'bar-chart', 'bar-chart-2', 'chart-column', 'chart-bar-big', 'stats-chart', 'graph', 'insert-chart', 'bar-chart-line', 'analytics'],
  github: ['github', 'github-logo', 'brand-github', 'logo-github', 'mark-github'],
  grip: ['grip-vertical', 'dots-six-vertical', 'grip', 'drag-indicator', 'grabber', 'dots-six'],
  move: ['move', 'arrows-out-cardinal', 'arrows-move', 'open-with'],
  rocket: ['rocket', 'rocket-launch', 'rocket-takeoff'],
  activity: ['activity', 'pulse', 'heartbeat', 'monitor-heart'],
  radio: ['radio', 'broadcast', 'radio-tower', 'antenna'],
  square: ['square'],
  circle: ['circle'],
  dot: ['dot', 'circle-small', 'dot-outline', 'point', 'record', 'dot-filled'],
  image: ['image', 'photo', 'picture'],
  bot: ['bot', 'robot', 'smart-toy', 'hubot'],
  server: ['server', 'hard-drives', 'server-stack', 'dns', 'hdd-stack'],
  puzzle: ['puzzle', 'puzzle-piece', 'extension'],
  book: ['book', 'book-open', 'menu-book', 'book-2'],
  calendar: ['calendar', 'calendar-days', 'calendar-blank', 'calendar-month', 'calendar-today', 'calendar3', 'calendar-event'],
  'message-square': ['message-square', 'chat', 'chat-bubble', 'chat-square', 'message', 'chatbubble', 'chat-left', 'comment'],
  link: ['link', 'link-2', 'link-simple', 'link-45deg'],
  volume: ['volume-2', 'volume', 'speaker-high', 'speaker-wave', 'volume-up', 'volume-high', 'speaker'],
  'volume-x': ['volume-x', 'speaker-x', 'speaker-slash', 'volume-off', 'volume-mute', 'speaker-simple-x'],
  note: ['sticky-note', 'note', 'note-pencil', 'notebook'],
  map: ['map', 'map-trifold', 'map-2'],
  cpu: ['cpu', 'memory', 'chip', 'hardware-chip', 'cpu-chip'],
  globe: ['globe', 'world', 'language', 'public', 'globe-simple', 'earth'],
  history: ['history', 'clock-counter-clockwise', 'clock-rotate-left'],
  filter: ['filter', 'funnel', 'filter-alt'],
  tag: ['tag', 'label', 'pricetag', 'local-offer'],
  flag: ['flag'],
  pin: ['pin', 'push-pin', 'pushpin', 'map-pin', 'thumbtack'],
  inbox: ['inbox'],
  send: ['send', 'paper-plane', 'paper-airplane', 'paper-plane-tilt', 'paper-plane-right'],
  share: ['share-2', 'share', 'share-network', 'share-social'],
  database: ['database', 'circle-stack', 'storage'],
  wrench: ['wrench', 'build', 'construct', 'tool'],
  plug: ['plug', 'plug-connected', 'plugs', 'power-plug'],
  award: ['award', 'medal', 'trophy', 'military-tech'],
  bookmark: ['bookmark', 'bookmark-simple'],
  'thumbs-up': ['thumbs-up', 'thumb-up', 'hand-thumbs-up'],
  'thumbs-down': ['thumbs-down', 'thumb-down', 'hand-thumbs-down'],
  loader: ['loader', 'loader-circle', 'loader-2', 'spinner', 'spinner-gap', 'circle-notch', 'sync'],
};

/** Emoji-style: framework glyph → Twemoji code point file (fixed-colour art). */
export const EMOJI = {
  home: '1f3e0', settings: '2699', file: '1f4c4', folder: '1f4c1', save: '1f4be', search: '1f50d', plus: '2795', trash: '1f5d1', palette: '1f3a8',
  sun: '2600', moon: '1f319', bell: '1f514', info: '2139', help: '2753', lock: '1f512', unlock: '1f513', key: '1f511', shield: '1f6e1', zap: '26a1',
  box: '1f4e6', package: '1f4e6', x: '274c', check: '2714', refresh: '1f504', shuffle: '1f500', download: '1f4e5', upload: '1f4e4', terminal: '1f4bb',
  play: '25b6', pause: '23f8', stop: '23f9', star: '2b50', eye: '1f441', keyboard: '2328', monitor: '1f5a5', smartphone: '1f4f1', cloud: '2601',
  sparkles: '2728', alert: '26a0', 'check-circle': '2705', 'x-circle': '274e', clock: '1f552', mic: '1f3a4', chart: '1f4ca', rocket: '1f680',
  image: '1f5bc', bot: '1f916', puzzle: '1f9e9', book: '1f4d6', calendar: '1f4c5', 'message-square': '1f4ac', link: '1f517', volume: '1f50a',
  'volume-x': '1f507', note: '1f4dd', map: '1f5fa', globe: '1f310', flag: '1f6a9', pin: '1f4cc', inbox: '1f4e5', send: '1f4e8', database: '1f5c4',
  server: '1f5c4', wrench: '1f527', plug: '1f50c', award: '1f3c6', bookmark: '1f516', 'thumbs-up': '1f44d', 'thumbs-down': '1f44e', hammer: '1f528',
  edit: '270f', user: '1f464', cut: '2702', paste: '1f4cb', copy: '1f4cb', tag: '1f3f7', history: '23f3', loader: '23f3', cpu: '1f5a5', code: '1f4bb',
  layers: '1f4da', grid: '1f5c2', activity: '1f4c8', radio: '1f4fb', github: '1f419', branch: '1f33f', logout: '1f6aa', external: '1f517', filter: '1f50d',
  share: '1f4e4', more: '1f4ac', list: '1f4cb', move: '1f500', layout: '1f5c2', type: '1f524', sliders: '1f39b', restore: '1f5d7', minimize: '1f53d',
  maximize: '1f53c', 'arrow-left': '2b05', 'arrow-right': '27a1', 'arrow-up': '2b06', 'arrow-down': '2b07', 'chevron-right': '25b6', 'chevron-left': '25c0',
  'chevron-down': '1f53d', 'chevron-up': '1f53c', minus: '2796', square: '23f9', circle: '26aa', dot: '1f535', grip: '1f590', undo: '21a9', redo: '21aa',
};

/* ------------------------------------------------------------------ the sets */

const MIT = (name, url) => ({ name: `MIT (${name})`, url });
const sets = (dir) => {
  const at = (prefix) => (rel) => join(dir, prefix, rel);
  const phos = (w) => (n) => at('phosphor-icons-core-2.1.1/package/assets')(`${w}/${n}${w === 'regular' ? '' : `-${w}`}.svg`);
  return [
    { id: 'lucide', name: 'Lucide', style: 'outline', stroke: 2, file: (n) => at('lucide-static-1.72.0/package/icons')(`${n}.svg`), license: { name: 'ISC (Lucide)', url: 'https://lucide.dev/license' }, tags: ['open', 'lucide'] },
    { id: 'tabler-outline', name: 'Tabler outline', style: 'outline', stroke: 2, file: (n) => at('tabler-icons-3.51.0/package/icons/outline')(`${n}.svg`), license: MIT('Tabler Icons', 'https://github.com/tabler/tabler-icons/blob/main/LICENSE'), tags: ['open', 'tabler'] },
    { id: 'tabler-filled', name: 'Tabler filled', style: 'filled', fill: true, file: (n) => at('tabler-icons-3.51.0/package/icons/filled')(`${n}.svg`), license: MIT('Tabler Icons', 'https://github.com/tabler/tabler-icons/blob/main/LICENSE'), tags: ['open', 'tabler'] },
    { id: 'feather', name: 'Feather', style: 'outline', stroke: 2, file: (n) => at('feather-icons-4.29.2/package/dist/icons')(`${n}.svg`), license: MIT('Feather', 'https://github.com/feathericons/feather/blob/main/LICENSE'), tags: ['open', 'feather', 'thin'] },
    { id: 'iconoir-regular', name: 'Iconoir', style: 'rounded', stroke: 1.5, file: (n) => at('iconoir-7.12.2/package/icons/regular')(`${n}.svg`), license: MIT('Iconoir', 'https://github.com/iconoir-icons/iconoir/blob/main/LICENSE'), tags: ['open', 'iconoir', 'light'] },
    { id: 'iconoir-solid', name: 'Iconoir solid', style: 'filled', fill: true, file: (n) => at('iconoir-7.12.2/package/icons/solid')(`${n}.svg`), license: MIT('Iconoir', 'https://github.com/iconoir-icons/iconoir/blob/main/LICENSE'), tags: ['open', 'iconoir', 'solid'] },
    { id: 'heroicons-outline', name: 'Heroicons outline', style: 'outline', stroke: 1.5, file: (n) => at('heroicons-2.2.0/package/24/outline')(`${n}.svg`), license: MIT('Heroicons', 'https://github.com/tailwindlabs/heroicons/blob/master/LICENSE'), tags: ['open', 'heroicons'] },
    { id: 'heroicons-solid', name: 'Heroicons solid', style: 'filled', fill: true, file: (n) => at('heroicons-2.2.0/package/24/solid')(`${n}.svg`), license: MIT('Heroicons', 'https://github.com/tailwindlabs/heroicons/blob/master/LICENSE'), tags: ['open', 'heroicons', 'solid'] },
    { id: 'heroicons-mini', name: 'Heroicons mini', style: 'filled', fill: true, file: (n) => at('heroicons-2.2.0/package/20/solid')(`${n}.svg`), license: MIT('Heroicons', 'https://github.com/tailwindlabs/heroicons/blob/master/LICENSE'), tags: ['open', 'heroicons', 'mini', 'compact'] },
    { id: 'phosphor-regular', name: 'Phosphor', style: 'rounded', fill: true, file: phos('regular'), license: MIT('Phosphor Icons', 'https://github.com/phosphor-icons/core/blob/main/LICENSE'), tags: ['open', 'phosphor'] },
    { id: 'phosphor-thin', name: 'Phosphor thin', style: 'outline', fill: true, file: phos('thin'), license: MIT('Phosphor Icons', 'https://github.com/phosphor-icons/core/blob/main/LICENSE'), tags: ['open', 'phosphor', 'thin'] },
    { id: 'phosphor-light', name: 'Phosphor light', style: 'outline', fill: true, file: phos('light'), license: MIT('Phosphor Icons', 'https://github.com/phosphor-icons/core/blob/main/LICENSE'), tags: ['open', 'phosphor', 'light'] },
    { id: 'phosphor-bold', name: 'Phosphor bold', style: 'rounded', fill: true, file: phos('bold'), license: MIT('Phosphor Icons', 'https://github.com/phosphor-icons/core/blob/main/LICENSE'), tags: ['open', 'phosphor', 'bold'] },
    { id: 'phosphor-fill', name: 'Phosphor fill', style: 'filled', fill: true, file: phos('fill'), license: MIT('Phosphor Icons', 'https://github.com/phosphor-icons/core/blob/main/LICENSE'), tags: ['open', 'phosphor', 'solid'] },
    { id: 'phosphor-duotone', name: 'Phosphor duotone', style: 'duotone', fill: true, file: phos('duotone'), license: MIT('Phosphor Icons', 'https://github.com/phosphor-icons/core/blob/main/LICENSE'), tags: ['open', 'phosphor', 'two-tone'] },
    { id: 'bootstrap', name: 'Bootstrap Icons', style: 'outline', fill: true, file: (n) => at('bootstrap-icons-1.13.2/package/icons')(`${n}.svg`), license: MIT('Bootstrap Icons', 'https://github.com/twbs/icons/blob/main/LICENSE'), tags: ['open', 'bootstrap'] },
    { id: 'bootstrap-fill', name: 'Bootstrap Icons fill', style: 'filled', fill: true, file: (n) => at('bootstrap-icons-1.13.2/package/icons')(`${n}-fill.svg`), alt: (n) => at('bootstrap-icons-1.13.2/package/icons')(`${n}.svg`), license: MIT('Bootstrap Icons', 'https://github.com/twbs/icons/blob/main/LICENSE'), tags: ['open', 'bootstrap', 'solid'] },
    ...['filled', 'outlined', 'round', 'sharp', 'two-tone'].map((v) => ({
      id: `material-${v}`, name: `Material ${v === 'two-tone' ? 'two-tone' : v}`, style: { filled: 'filled', outlined: 'outline', round: 'rounded', sharp: 'sharp', 'two-tone': 'duotone' }[v], fill: true,
      file: (n) => at(`material-design-icons-svg-0.14.15/package/${v}`)(`${n.replace(/-/g, '_')}.svg`),
      license: { name: 'Apache-2.0 (Material Design Icons, Google)', url: 'https://github.com/google/material-design-icons/blob/master/LICENSE' }, tags: ['open', 'material', v],
    })),
    { id: 'octicons', name: 'Octicons', style: 'filled', fill: true, file: (n) => at('primer-octicons-19.42.0/package/build/svg')(`${n}-24.svg`), license: MIT('Primer Octicons, GitHub', 'https://github.com/primer/octicons/blob/main/LICENSE'), tags: ['open', 'octicons', 'glyph'] },
    { id: 'ionicons-filled', name: 'Ionicons glyph', style: 'filled', fill: true, file: (n) => at('ionicons-8.1.0/package/dist/svg')(`${n}.svg`), license: MIT('Ionicons', 'https://github.com/ionic-team/ionicons/blob/main/LICENSE'), tags: ['open', 'ionicons', 'glyph'] },
    { id: 'ionicons-sharp', name: 'Ionicons sharp', style: 'sharp', fill: true, file: (n) => at('ionicons-8.1.0/package/dist/svg')(`${n}-sharp.svg`), license: MIT('Ionicons', 'https://github.com/ionic-team/ionicons/blob/main/LICENSE'), tags: ['open', 'ionicons'] },
  ];
};

/* ------------------------------------------------------------------ SVG → path commands */

const attrs = (s) => { const o = {}; for (const m of s.matchAll(/([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]; return o; };
const n = (v) => Number.parseFloat(v ?? '0') || 0;

function shapeToPath(tag, a) {
  switch (tag) {
    case 'path': return a.d ?? '';
    case 'circle': { const cx = n(a.cx), cy = n(a.cy), r = n(a.r); return r ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z` : ''; }
    case 'ellipse': { const cx = n(a.cx), cy = n(a.cy), rx = n(a.rx), ry = n(a.ry); return rx && ry ? `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z` : ''; }
    case 'rect': {
      const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height);
      let rx = Math.min(n(a.rx ?? a.ry), w / 2), ry = Math.min(n(a.ry ?? a.rx), h / 2);
      if (!w || !h) return '';
      if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`;
    }
    case 'line': return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case 'polyline': case 'polygon': {
      const p = (a.points ?? '').trim().split(/[\s,]+/).map(Number);
      if (p.length < 4) return '';
      let d = `M${p[0]} ${p[1]}`; for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return tag === 'polygon' ? `${d}Z` : d;
    }
    default: return '';
  }
}

const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const fmt = (x, places) => { const r = Number(x.toFixed(places)); return Object.is(r, -0) ? '0' : String(r); };

/** Path data scaled by k (uniform), then moved by (tx, ty), with compact numbers; arcs keep rotation and flags. */
export function scalePath(d, k, places = 2, tx = 0, ty = 0) {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  let out = ''; let cmd = ''; let i = 0; let arg = 0;
  // a path's first moveto is absolute even when written `m`: make it `M` (its implicit pairs stay relative, as `l`),
  // so the path still draws in place once it is joined after another shape
  let first = toks[0] === 'm';
  while (i < toks.length) {
    const t = toks[i];
    if (/[a-zA-Z]/.test(t)) { cmd = i === 0 && first ? 'M' : t; out += cmd; arg = 0; i++; if (i > 1) first = false; continue; }
    if (first && arg === 2) { cmd = 'l'; out += 'l'; arg = 0; first = false; }
    const lc = cmd.toLowerCase();
    const per = ARGS[lc] ?? 2;
    const idx = per ? arg % per : 0;
    const isFlagOrRot = lc === 'a' && (idx === 2 || idx === 3 || idx === 4);
    // absolute commands move with the shape: which argument is an x, which a y
    const abs = cmd !== lc && (tx || ty);
    const axis = !abs || isFlagOrRot ? '' : lc === 'h' ? 'x' : lc === 'v' ? 'y' : lc === 'a' ? (idx === 5 ? 'x' : idx === 6 ? 'y' : '') : idx % 2 === 0 ? 'x' : 'y';
    const v = isFlagOrRot ? Number(t) : Number(t) * k + (axis === 'x' ? tx : axis === 'y' ? ty : 0);
    const s = isFlagOrRot ? String(v) : fmt(v, places);
    out += (/[0-9.]$/.test(out) && !s.startsWith('-') ? ' ' : '') + s;
    arg++; i++;
  }
  return out;
}

function viewBoxOf(svg) {
  const m = /viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*"/.exec(svg);
  return m ? { x: n(m[1]), y: n(m[2]), w: n(m[3]), h: n(m[4]) } : { x: 0, y: 0, w: 24, h: 24 };
}

/** One SVG file → { d, secondary, layers, grid } or null when it can't be drawn faithfully. */
export function svgGlyph(svg, { duotone = false, colours = false, fill = false } = {}) {
  if (/<(mask|clipPath|pattern|linearGradient|radialGradient|use|image|text)\b/.test(svg) || /\btransform=/.test(svg)) return null;
  if (/(fill|clip)-rule="evenodd"/.test(svg) && !colours) return null;
  const vb = viewBoxOf(svg);
  if (vb.x || vb.y || vb.w !== vb.h) return null;
  const grid = vb.w >= ICON_LIMITS.grid[0] && vb.w <= ICON_LIMITS.grid[1] ? vb.w : 24;
  const k = grid / vb.w;
  const main = []; const second = []; const layers = [];
  const rootFill = /<svg[^>]*\bfill="([^"]*)"/.exec(svg)?.[1] ?? '';
  for (const m of svg.matchAll(/<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*?)\/?>/g)) {
    const a = attrs(m[2]);
    if (a.fill === 'none' && (a.stroke === 'none' || !a.stroke) && rootFill !== 'currentColor' && !/stroke=/.test(svg.slice(0, svg.indexOf('>')))) continue;
    if (a.stroke === 'none' && a.fill === 'none') continue;
    if (fill && (a.fill === 'none' || /stroke/.test(a.class ?? '')) && a.stroke !== 'none') return null; // a stroked line in a fill set would fill into a blob
    let d = shapeToPath(m[1], a);
    if (!d) continue;
    d = scalePath(d, k);
    const op = a.opacity ?? a['fill-opacity'];
    if (colours) { const c = a.fill && /^#[0-9a-fA-F]{3,8}$/.test(a.fill) ? a.fill.toLowerCase() : '#000000'; layers.push({ d, color: c }); continue; }
    if (duotone && op !== undefined && Number(op) < 1) second.push(d); else main.push(d);
  }
  if (colours) {
    if (!layers.length) return null;
    let fallback = '';
    for (const l of layers) { if ((fallback + l.d).length > ICON_LIMITS.pathChars) break; fallback += l.d; }
    if (!fallback) return null;
    return { d: fallback, layers: layers.filter((l) => l.d.length <= ICON_LIMITS.pathChars), grid };
  }
  const d = main.join('');
  if (!d || d.length > ICON_LIMITS.pathChars) return null;
  const s = second.join('');
  return { d, secondary: s && s.length <= ICON_LIMITS.pathChars ? s : '', grid };
}

/* ------------------------------------------------------------------ own art: badge styles, logo marks, tiles */

const OWN_LICENSE = { name: 'MIT (AmberX AXF)', url: 'https://opensource.org/licenses/MIT' };
const circle = (cx, cy, r) => shapeToPath('circle', { cx, cy, r });
const rrect = (x, y, width, height, rx) => shapeToPath('rect', { x, y, width, height, rx });
const STAR = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8Z';
const SPARK = 'M12 2c.8 5 3.2 7.4 8 8-4.8.8-7.2 3.2-8 8-.8-4.8-3.2-7.2-8-8 4.8-.6 7.2-3 8-8Z';
const BADGE_ROLES = { 'badge-status': 'badge-dot', 'badge-count': 'badge-pill', 'badge-new': 'badge-new' };

/** Badge styles: the status dot, the count pill and the "new" mark in one shape family each. */
export function badgePacks() {
  const fam = [
    ['badges-dot', 'Badges: dot', 'filled', circle(12, 12, 6), rrect(3, 7, 18, 10, 5), STAR],
    ['badges-ring', 'Badges: ring', 'outline', circle(12, 12, 6), rrect(3, 7, 18, 10, 5), STAR],
    ['badges-square', 'Badges: square', 'filled', rrect(6, 6, 12, 12, 2.5), rrect(3, 7, 18, 10, 2), 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z'],
    ['badges-shield', 'Badges: shield', 'filled', 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6Z', 'M4 7h11l5 5-5 5H4Z', 'M8 3h8v18l-4-3-4 3Z'],
    ['badges-hex', 'Badges: hexagon', 'filled', 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9Z', 'M8 7h8l4 5-4 5H8l-4-5Z', SPARK],
    ['badges-diamond', 'Badges: diamond', 'sharp', 'M12 3l9 9-9 9-9-9Z', 'M3 12l4-5h10l4 5-4 5H7Z', 'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3Z'],
  ];
  const packs = fam.map(([id, name, style, dot, pill, neu]) => packOf({ id, name, style, covers: ['badges'], license: OWN_LICENSE, tags: ['badges', 'own'] }, {
    'badge-dot': { d: dot, ...(style !== 'outline' ? { fill: true } : {}) },
    'badge-pill': { d: pill, ...(style !== 'outline' ? { fill: true } : {}) },
    'badge-new': { d: neu, ...(style !== 'outline' ? { fill: true } : {}) },
  }, 24, { roles: BADGE_ROLES }));
  packs.push(packOf({ id: 'badges-traffic', name: 'Badges: traffic light', style: 'filled', themable: false, covers: ['badges'], license: OWN_LICENSE, tags: ['badges', 'own', 'colour'] }, {
    'badge-dot': { d: circle(12, 12, 6), fill: true, layers: [{ d: circle(12, 12, 6), color: '#22c55e' }, { d: circle(10, 10, 2), color: '#bbf7d0' }] },
    'badge-pill': { d: rrect(3, 7, 18, 10, 5), fill: true, layers: [{ d: rrect(3, 7, 18, 10, 5), color: '#ef4444' }] },
    'badge-new': { d: STAR, fill: true, layers: [{ d: STAR, color: '#f59e0b' }, { d: 'M12 6l1.6 3.4 3.7.4-2.8 2.6.8 3.7L12 14.3l-3.3 1.8.8-3.7-2.8-2.6 3.7-.4Z', color: '#fde68a' }] },
  }, 24, { roles: BADGE_ROLES }));
  return packs;
}

const LOGO_ROLES = { 'app-logo': 'logo-mark', 'app-mark': 'logo-mark' };

/** Logo marks: what the app-logo / app-mark slots draw (the wordmark stays text). */
export function logoPacks() {
  const marks = [
    ['logo-orbit', 'Logo: orbit', 'outline', circle(12, 12, 2) + shapeToPath('ellipse', { cx: 12, cy: 12, rx: 10, ry: 4 }) + shapeToPath('ellipse', { cx: 12, cy: 12, rx: 4, ry: 10 })],
    ['logo-hex-spark', 'Logo: hex spark', 'outline', 'M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5Z' + scalePath(SPARK, 0.5, 2, 6, 6)],
    ['logo-monogram', 'Logo: monogram A', 'outline', 'M5 20 12 4l7 16M8.2 14h7.6'],
    ['logo-bolt', 'Logo: bolt', 'outline', circle(12, 12, 10) + 'M13 5l-6 8h5l-1 6 6-8h-5Z'],
    ['logo-ring', 'Logo: ring', 'outline', circle(12, 12, 10) + circle(12, 12, 6) + circle(12, 12, 2)],
  ];
  const packs = marks.map(([id, name, style, d]) => packOf({ id, name, style, covers: ['logos'], license: OWN_LICENSE, tags: ['logos', 'own'] }, { 'logo-mark': { d, ...(style === 'filled' ? { fill: true } : {}) } }, 24, { roles: LOGO_ROLES }));
  const gem = [['M12 2 4 9h16Z', '#fbbf24'], ['M4 9l8 13L9 9Z', '#f59e0b'], ['M9 9l3 13 3-13Z', '#d97706'], ['M15 9l-3 13 8-13Z', '#b45309']];
  packs.push(packOf({ id: 'logo-amber-gem', name: 'Logo: amber gem', style: 'filled', themable: false, covers: ['logos'], license: OWN_LICENSE, tags: ['logos', 'own', 'colour', 'amberx'] },
    { 'logo-mark': { d: gem.map(([d]) => d).join(''), fill: true, layers: gem.map(([d, color]) => ({ d, color })) } }, 24, { roles: LOGO_ROLES }));
  return packs;
}

/** Tiles / circles: every framework glyph on a soft backdrop, for app and plugin logos (nav, launchers, cards). */
export function tilePacks() {
  const shapes = [
    ['tiles', 'Tiles (app and plugin logos)', 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z'],
    ['tiles-circle', 'Circles (app and plugin logos)', circle(12, 12, 10.5)],
  ];
  return shapes.map(([id, name, back]) => {
    const glyphs = {};
    for (const g of GLYPH_NAMES) glyphs[g] = { d: scalePath(GLYPHS[g], 0.6, 2, 4.8, 4.8), secondary: back };
    return packOf({ id, name, style: 'duotone', stroke: 1.4, covers: ['icons', 'logos'], license: OWN_LICENSE, tags: ['logos', 'tiles', 'own'] }, glyphs, 24);
  });
}

/* ------------------------------------------------------------------ build */

function packOf(set, glyphs, grid, extra = {}) {
  return {
    $axf: 'asset@1', type: 'icon-pack', id: set.id, name: set.name, version: '1.0.0',
    description: `${set.name}: ${set.license === OWN_LICENSE ? `${Object.keys(glyphs).length} glyph${Object.keys(glyphs).length === 1 ? '' : 's'} drawn for AXF` : `${Object.keys(glyphs).length} of the framework's ${GLYPH_NAMES.length} glyphs drawn from the open ${set.name.split(' ')[0]} set (${set.license.name})`}; anything it lacks falls back to the framework's. ${set.themable === false ? 'Fixed-colour art: keeps its own colours.' : 'Themable: takes its colour and stroke from the skin.'}`,
    author: 'icon-packs-import (framework/cli/icon-packs-import.mjs)',
    tags: [...new Set([set.style, set.themable === false ? 'fixed-colour' : 'themable', ...(set.tags ?? [])])].slice(0, 12),
    data: {
      style: set.style, grid, stroke: set.stroke ?? 1.75, linecap: 'round', fallback: 'framework',
      themable: set.themable !== false, covers: set.covers ?? ['icons'], license: set.license, ...extra, glyphs,
    },
  };
}

export function importSet(set) {
  const glyphs = {}; let grid = 0; const missing = [];
  for (const name of GLYPH_NAMES) {
    let found = null;
    for (const c of SYNONYMS[name] ?? [name]) {
      for (const f of [set.file(c), set.alt?.(c)].filter(Boolean)) {
        if (!existsSync(f)) continue;
        const g = svgGlyph(readFileSync(f, 'utf8'), { duotone: set.style === 'duotone', fill: !!set.fill });
        if (g && (!grid || g.grid === grid)) { found = g; break; }
      }
      if (found) break;
    }
    if (!found) { missing.push(name); continue; }
    grid = grid || found.grid;
    glyphs[name] = { d: found.d, ...(set.fill ? { fill: true } : {}), ...(found.secondary ? { secondary: found.secondary } : {}) };
  }
  return { pack: packOf(set, glyphs, grid || 24), missing };
}

export function importEmoji(dir) {
  const set = { id: 'twemoji', name: 'Twemoji emoji', style: 'filled', themable: false, covers: ['icons', 'badges'], license: { name: 'CC-BY-4.0 (Twemoji graphics, Copyright 2019 Twitter, Inc and other contributors; code MIT)', url: 'https://github.com/jdecked/twemoji/blob/main/LICENSE-GRAPHICS' }, tags: ['open', 'emoji', 'colour'] };
  const glyphs = {}; const missing = [];
  for (const name of GLYPH_NAMES) {
    const cp = EMOJI[name];
    const f = cp && [join(dir, 'twemoji-svg-15.0.0/package', `${cp}.svg`), join(dir, 'twemoji-svg-15.0.0/package', `${cp}-fe0f.svg`)].find(existsSync);
    const g = f ? svgGlyph(readFileSync(f, 'utf8'), { colours: true }) : null;
    if (!g) { missing.push(name); continue; }
    glyphs[name] = { d: g.d, fill: true, layers: g.layers };
  }
  return { pack: packOf(set, glyphs, 36), missing };
}

function main(argv = process.argv.slice(2)) {
  const dir = argv.find((a) => !a.startsWith('--'));
  const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (!dir || !existsSync(dir)) { console.error('usage: icon-packs-import.mjs <unpacked sets dir> [--out dir] [--only id,id] [--json]'); return 2; }
  const out = resolve(flag('out') ?? join(ROOT, 'framework/assets/icon-pack'));
  const only = flag('only')?.split(',');
  mkdirSync(out, { recursive: true });
  const report = [];
  const results = [...sets(dir).filter((s) => !only || only.includes(s.id)).map(importSet), ...(!only || only.includes('twemoji') ? [importEmoji(dir)] : [])];
  const own = [...badgePacks(), ...logoPacks(), ...tilePacks()].filter((p) => !only || only.includes(p.id)).map((pack) => ({ pack, missing: [], own: true }));
  for (const { pack, missing, own: mine } of [...results, ...own]) {
    const errs = iconPackErrors(pack.data);
    const count = Object.keys(pack.data.glyphs).length;
    if (errs.length || (!mine && count < 40)) { report.push({ id: pack.id, skipped: errs.join('; ') || `only ${count} glyphs` }); continue; }
    writeFileSync(join(out, `${pack.id}.json`), `${JSON.stringify(pack, null, 1)}\n`);
    report.push({ id: pack.id, glyphs: count, missing: missing.length });
  }
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else for (const r of report) console.log(r.skipped ? `- ${r.id}: skipped (${r.skipped})` : `✓ ${r.id.padEnd(20)} ${String(r.glyphs).padStart(3)} glyphs, ${r.missing} from the framework`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
