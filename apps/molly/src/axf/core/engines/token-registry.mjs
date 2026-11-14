/**
 * token-registry@1 + skin-snapshot@1 (build token-registry-skin-editor-live-sandbox, Brett Nov 13 2026: "list every
 * token in a registry; any time a new UI is made add its tokens to the registry; an editor that takes whatever UI you
 * pick and throws it in a sandbox with live preview, hot render as you edit; a default skin; every edit takes a snapshot,
 * you see the chain of edits like a disk snapshot and can revert to any point; at any point export current to a new skin").
 *
 * ONE registry of every `--fx-*` token the engines, the base stylesheet, the colour themes and the manifests define:
 * element type, area (layout / style / colour / behaviour), state, light / dark, level (basic / pro / advanced), a
 * plain-English description, the default and the source. The document is framework/schemas/token-registry.json, written
 * by framework/cli/token-registry.mjs (`sync`) from the same derivation check-theme.mjs uses, so a token the engines add
 * lands in the registry the next time it is synced, and the CI check (spec/check-token-registry.mjs) fails on a token
 * a UI reads that is not registered, and on a registered token nothing reads.
 *
 * A new UI, component or plugin registers its tokens through its manifest (plugin.json / axf.manifest.json):
 *   "tokens": { "$axf": "token-registry@1", "uses": [<the --fx-* ids its files read>], "defines": [{ "id": <a --fx-* id of its own>, "element": …, … }] }
 * `uses` = the tokens its own files read (the check compares it with what the files really read); `defines` = tokens of
 * its own, merged into the registry. The template carries the block.
 *
 * skin-snapshot@1 is the Skin Editor's history: every edit is a snapshot with a parent, the chain reads like disk
 * snapshots, a revert is a new snapshot whose state is the target's (nothing is ever lost), and any snapshot's state
 * exports as a skin asset (asset@1 `skin`): the mapped tokens ride the skin's `extras.settings` as control@1 token
 * overrides (engines/control-tokens.mjs), so applying the skin applies the edits everywhere.
 *
 * Pure (no IO, no DOM); the CLI, the CI check, the console plugin (web + Python twin for voice) and the tests share it.
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const TOKEN_REGISTRY_FRAME = 'token-registry@1';
export const SKIN_SNAPSHOT_FRAME = 'skin-snapshot@1';
export const TOKEN_MANIFEST_FRAME = TOKEN_REGISTRY_FRAME;

/** Where a token acts. Append-only. */
export const TOKEN_AREAS = ['layout', 'style', 'colour', 'behaviour'];
/** Who should see it: basic = the handful everyone changes, pro = per-element looks, advanced = the engine's knobs. */
export const TOKEN_LEVELS = ['basic', 'pro', 'advanced'];
export const LEVEL_RANK = { basic: 0, pro: 1, advanced: 2 };
/** The interaction state a token styles (`any` = not state-bound). Append-only. */
export const TOKEN_STATES = ['any', 'idle', 'hover', 'active', 'selected', 'focus', 'pressed', 'disabled', 'open', 'on', 'off', 'checked'];
/** Which scheme it is for: a colour theme is light or dark; most tokens are `both`. */
export const TOKEN_SCHEMES = ['both', 'light', 'dark'];
/** Snapshot kinds: the default skin at the root, an edit, a revert (a new snapshot that copies an old state), an import. */
export const SNAPSHOT_KINDS = ['default', 'edit', 'revert', 'import'];
export const SNAPSHOT_MAX = 1000;
export const TOKEN_ID = /^--fx-[a-z0-9]+(-[a-z0-9]+)*$/;
export const DEFAULT_SKIN_ID = 'default';
export const DEFAULT_SKIN_LABEL = 'Default skin';
/** The skin `extras.settings` key that keeps tokens no control@1 set can carry (component variables). */
export const SKIN_VARS_KEY = 'axf.skin-editor.vars';
export const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const SCALAR = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/* ================================================================== classifying a token by its name */

/** Component / element prefixes → the element type (the asset type or control the token belongs to). */
export const TOKEN_ELEMENTS = {
  btn: 'button', iconbtn: 'icon-button', slider: 'slider', seg: 'segmented', chip: 'chip', tab: 'tab-group', tabs: 'tab-group',
  grid: 'grid', table: 'grid', row: 'grid', card: 'container', container: 'container', dialog: 'dialog', popover: 'popup', popup: 'popup',
  menu: 'context-menu', menubar: 'app-menu', nav: 'nav-menu', navs: 'nav-style', toolbar: 'toolbar', banner: 'banner', window: 'window',
  input: 'field', field: 'field', select: 'field', badge: 'badge', gauge: 'gauge', meter: 'meter', avatar: 'avatar', progress: 'progress',
  status: 'status', clock: 'clock', counter: 'counter', link: 'link', label: 'label', divider: 'divider', spacer: 'spacer', note: 'note',
  layout: 'layout', type: 'typography', dens: 'density', size: 'sizing', opacity: 'transparency', backdrop: 'transparency', shadow: 'surface',
  radius: 'surface', font: 'typography', heading: 'typography', tracking: 'typography', motion: 'motion', scrim: 'transparency', icon: 'icon',
  search: 'search-bar', logo: 'logo', toast: 'toast', settings: 'settings', agent: 'agent-card', help: 'help', focus: 'focus-ring',
};
/** Plain words for the element types (the description reads "Button: …"). */
export const ELEMENT_LABELS = {
  button: 'Button', 'icon-button': 'Icon button', slider: 'Slider', segmented: 'Segmented control', chip: 'Chip', 'tab-group': 'Tab group', grid: 'Grid',
  container: 'Container', dialog: 'Dialog', popup: 'Popup', 'context-menu': 'Menu', 'app-menu': 'Menu bar', 'nav-menu': 'Navigation', 'nav-style': 'Navigation style',
  toolbar: 'Toolbar', banner: 'Banner', window: 'Window', field: 'Field', badge: 'Badge', gauge: 'Gauge', meter: 'Meter', avatar: 'Avatar', progress: 'Progress bar',
  status: 'Status', clock: 'Clock', counter: 'Counter', link: 'Link', label: 'Label', divider: 'Divider', spacer: 'Spacer', note: 'Note', layout: 'Layout',
  typography: 'Text', density: 'Density', sizing: 'Sizing', transparency: 'Transparency', surface: 'Surface', motion: 'Motion', icon: 'Icon', 'search-bar': 'Search bar',
  logo: 'Logo', toast: 'Toast', settings: 'Settings', 'agent-card': 'Agent card', help: 'Help', 'focus-ring': 'Focus ring', palette: 'Colour palette', page: 'Page',
};
const STATE_WORDS = { hover: 'hover', active: 'active', selected: 'selected', focus: 'focus', pressed: 'pressed', disabled: 'disabled', open: 'open', on: 'on', off: 'off', checked: 'checked', idle: 'idle' };
const COLOUR_WORDS = new Set(['bg', 'background', 'color', 'colour', 'text', 'ink', 'fill', 'stroke', 'border', 'accent', 'surface', 'surface2', 'surface3', 'muted', 'success', 'warning', 'danger', 'info', 'scrim', 'tint', 'glow', 'ring', 'line', 'lines', 'overlay', 'wash', 'soft', 'brand']);
/** Hand-written sentences for the tokens every skin touches (the name alone reads poorly for these). */
export const TOKEN_DESCRIPTIONS = {
  '--fx-bg': 'Page background behind everything.', '--fx-surface': 'Background of cards, panels and dialogs.', '--fx-surface2': 'Second surface level: raised rows, hover washes, inputs.',
  '--fx-surface3': 'Third surface level: menus and popovers above the panels.', '--fx-text': 'Main text colour.', '--fx-muted': 'Secondary text: captions, hints, de-emphasised labels.',
  '--fx-border': 'Border and divider colour.', '--fx-accent': 'Accent colour: primary buttons, links, selection.', '--fx-accent-text': 'Text drawn on the accent colour.',
  '--fx-accent-soft': 'Soft accent wash behind selected rows and chips.', '--fx-success': 'Success colour for done states and confirmations.', '--fx-warning': 'Warning colour for attention states.',
  '--fx-danger': 'Danger colour for errors and destructive actions.', '--fx-info': 'Information colour for neutral notices.', '--fx-font': 'Body font family.', '--fx-font-display': 'Display font for headings and brand text.',
  '--fx-font-mono': 'Monospace font for code and logs.', '--fx-font-size': 'Base text size everything scales from.', '--fx-space': 'Spacing unit every gap and padding multiplies.',
  '--fx-radius-sm': 'Small corner radius: chips, inputs, small buttons.', '--fx-radius-md': 'Medium corner radius: buttons, cards.', '--fx-radius-lg': 'Large corner radius: dialogs, windows.',
  '--fx-border-w': 'Border width of controls and frames.', '--fx-shadow-sm': 'Small shadow under raised controls.', '--fx-shadow-md': 'Medium shadow under cards and popovers.', '--fx-shadow-lg': 'Large shadow under dialogs and windows.',
  '--fx-motion': 'Duration of transitions and animations.', '--fx-ease': 'Easing curve of transitions.', '--fx-blur': 'Blur behind translucent surfaces.', '--fx-heading-weight': 'Font weight of headings.',
  '--fx-tracking': 'Letter spacing of text.', '--fx-row-h': 'Height of list and table rows.', '--fx-density-k': 'Density factor the spacing and row heights multiply.', '--fx-scrim': 'Dimming layer behind dialogs and sheets.',
  '--fx-content-max': 'Maximum width of page content.', '--fx-focus': 'Focus ring colour.', '--fx-opacity-disabled': 'Transparency of disabled controls.', '--fx-opacity-muted': 'Transparency of de-emphasised content.',
  '--fx-opacity-hover': 'Strength of the hover wash over a surface.', '--fx-opacity-tint': 'Strength of soft status and accent backgrounds.', '--fx-opacity-scrim': 'Darkness of the scrim behind dialogs.',
  '--fx-opacity-glass': 'How much surface colour a glass panel keeps.', '--fx-opacity-dialog': 'Transparency of dialogs, drawers and sheets.', '--fx-opacity-settings': 'Transparency of settings and tool windows.',
  '--fx-opacity-panel': 'Transparency of cards and panels.', '--fx-opacity-menu': 'Transparency of menus and popovers.', '--fx-opacity-toolbar': 'Transparency of toolbars and the menu bar.', '--fx-opacity-banner': 'Transparency of banners.',
  '--fx-backdrop-dialog': 'Backdrop blur behind translucent dialogs.', '--fx-backdrop-settings': 'Backdrop blur behind translucent settings windows.', '--fx-backdrop-panel': 'Backdrop blur behind translucent panels.',
  '--fx-backdrop-menu': 'Backdrop blur behind translucent menus.', '--fx-backdrop-toolbar': 'Backdrop blur behind translucent toolbars.', '--fx-backdrop-banner': 'Backdrop blur behind translucent banners.',
  '--fx-grid-areas': 'Layout grid areas of the app frame.', '--fx-grid-cols': 'Layout grid columns of the app frame.', '--fx-grid-rows': 'Layout grid rows of the app frame.',
  '--fx-grid-areas-m': 'Layout grid areas of the app frame on a phone.', '--fx-grid-rows-m': 'Layout grid rows of the app frame on a phone.',
};
const LAYOUT_WORDS = new Set(['areas', 'cols', 'rows', 'width', 'height', 'side', 'sides', 'max', 'min', 'content', 'nav', 'inspector', 'edge', 'cut', 'cutoff', 'region', 'orientation', 'per', 'columns', 'span', 'm']);
const BEHAVIOUR_WORDS = new Set(['motion', 'ease', 'easing', 'duration', 'transition', 'delay', 'speed', 'anim', 'animation', 'blur']);
const BASIC_TOKENS = new Set(['--fx-bg', '--fx-surface', '--fx-text', '--fx-muted', '--fx-border', '--fx-accent', '--fx-accent-text', '--fx-accent-soft', '--fx-success', '--fx-warning', '--fx-danger', '--fx-font', '--fx-font-size', '--fx-space', '--fx-radius-md', '--fx-border-w']);
const ADVANCED_RE = /^--fx-(layout-|backdrop-|density-k$|tracking$|shadow-|motion|type-scale-|dens-|size-|navs-|grid-areas|grid-cols|grid-rows|content-max)/;
const PLAIN = {
  bg: 'background', background: 'background', color: 'colour', colour: 'colour', text: 'text colour', fg: 'text colour', ink: 'ink colour', fill: 'fill', border: 'border', 'border-w': 'border width',
  radius: 'corner radius', pad: 'padding', padding: 'padding', px: 'horizontal padding', py: 'vertical padding', gap: 'gap', h: 'height', w: 'width', height: 'height', width: 'width',
  font: 'font', size: 'size', weight: 'font weight', shadow: 'shadow', opacity: 'transparency', backdrop: 'backdrop blur', blur: 'blur', motion: 'motion', ease: 'easing', duration: 'duration',
  areas: 'grid areas', cols: 'grid columns', rows: 'grid rows', sm: 'small', md: 'medium', lg: 'large', xl: 'extra large', xs: 'extra small', m: 'phone', scale: 'scale', line: 'line', k: 'factor',
  indicator: 'active indicator', ring: 'focus ring', surface: 'surface', surface2: 'second surface', surface3: 'third surface', muted: 'muted text', accent: 'accent', soft: 'soft wash', scrim: 'scrim',
  success: 'success colour', warning: 'warning colour', danger: 'danger colour', info: 'info colour', display: 'display font', mono: 'monospace font', tracking: 'letter spacing', heading: 'heading',
  row: 'row', per: 'per', max: 'maximum', min: 'minimum', content: 'content', nav: 'navigation', inspector: 'inspector', edge: 'edge', dens: 'density', type: 'type',
};

/** The part of a name after `--fx-`, split into words. */
export const tokenWords = (name) => String(name ?? '').replace(/^--fx-/, '').split('-').filter(Boolean);

/** What a token is for, read from its name alone. `colourKeys` = the colour theme token keys (kebab) so palette tokens are known. */
export function classifyToken(name, colourKeys = []) {
  const words = tokenWords(name);
  const [head, ...rest] = words;
  const paletteSet = new Set(colourKeys.map((k) => kebab(k)));
  const bare = words.join('-');
  let element = TOKEN_ELEMENTS[head] ?? (paletteSet.has(bare) || COLOUR_WORDS.has(head) ? 'palette' : 'page');
  if (head === 'opacity' || head === 'backdrop') element = 'transparency';
  if (head === 'grid' && (rest[0] === 'areas' || rest[0] === 'cols' || rest[0] === 'rows')) element = 'layout';
  // area
  let area = 'style';
  if (element === 'palette' || element === 'transparency' || words.some((w) => COLOUR_WORDS.has(w) && !['border', 'line', 'lines'].includes(w)) || /-(bg|text|color|colour|border-color|fill|ink|tint)$/.test(bare)) area = 'colour';
  if (element === 'layout' || (head === 'layout') || words.some((w) => LAYOUT_WORDS.has(w) && !['max', 'min', 'content', 'm'].includes(w)) && element !== 'palette') area = 'layout';
  if (words.some((w) => BEHAVIOUR_WORDS.has(w))) area = 'behaviour';
  if (/^--fx-(border|border-w)$/.test(name)) area = 'style';
  if (/-shadow(-|$)/.test(bare) && element !== 'palette') area = 'style';
  if (/^--fx-(grid-(cols|rows|areas)|layout-)/.test(name)) area = 'layout';
  // state and scheme
  const state = words.map((w) => STATE_WORDS[w]).find(Boolean) ?? 'any';
  const scheme = words.includes('light') ? 'light' : words.includes('dark') ? 'dark' : 'both';
  // level
  let level = 'pro';
  if (BASIC_TOKENS.has(name) || (element === 'palette' && paletteSet.has(bare) && !/-(hover|active|soft|2|3)$/.test(bare) && words.length === 1)) level = 'basic';
  if (ADVANCED_RE.test(name)) level = 'advanced';
  return { element, area, state, scheme, level, description: describeToken(name, element, state) };
}

/** A plain sentence for a token from its name: "Button: background on hover." */
export function describeToken(name, element, state = 'any') {
  if (TOKEN_DESCRIPTIONS[name]) return TOKEN_DESCRIPTIONS[name];
  const words = tokenWords(name);
  const el = ELEMENT_LABELS[element] ?? 'Page';
  let body = words.filter((w) => !(w in TOKEN_ELEMENTS && words[0] === w) && !STATE_WORDS[w]).map((w) => PLAIN[w] ?? w).join(' ');
  if (!body) body = PLAIN[words[0]] ?? words[0] ?? 'value';
  const when = state !== 'any' ? ` when ${state}` : '';
  return `${el}: ${body}${when}.`.replace(/\s+/g, ' ');
}

/* ================================================================== the registry document */

/** One registry entry, shaped and bounded; null when the id is not a token. `fallback` fills what `raw` leaves out. */
export function normalizeToken(raw, fallback = {}) {
  const id = str(raw?.id ?? raw?.token ?? fallback.id, 80);
  if (!TOKEN_ID.test(id)) return null;
  const guess = classifyToken(id, fallback.colourKeys ?? []);
  const pick = (k, list) => { const v = str(raw?.[k] ?? fallback[k], 40); return list.includes(v) ? v : guess[k]; };
  const out = {
    id,
    element: str(raw?.element ?? fallback.element, 40) || guess.element,
    area: pick('area', TOKEN_AREAS),
    state: pick('state', TOKEN_STATES),
    scheme: pick('scheme', TOKEN_SCHEMES),
    level: pick('level', TOKEN_LEVELS),
    description: str(raw?.description ?? fallback.description, 400) || guess.description,
    default: SCALAR(raw?.default) ? raw.default : SCALAR(fallback.default) ? fallback.default : '',
    source: str(raw?.source ?? fallback.source, 120) || 'unknown',
  };
  if (Array.isArray(raw?.sources ?? fallback.sources)) out.sources = [...new Set((raw?.sources ?? fallback.sources).map((s) => str(s, 200)).filter(Boolean))].slice(0, 50);
  if (raw?.set && typeof raw.set === 'object') out.set = { target: str(raw.set.target, 40), path: str(raw.set.path, 80) };
  if (raw?.deprecated === true) out.deprecated = true;
  return out;
}

/** The registry document, shaped: tokens sorted by id, duplicates merged (the later entry wins field by field). */
export function normalizeRegistry(raw) {
  const byId = new Map();
  for (const t of Array.isArray(raw?.tokens) ? raw.tokens : []) {
    const n = normalizeToken(t);
    if (!n) continue;
    byId.set(n.id, byId.has(n.id) ? { ...byId.get(n.id), ...n } : n);
  }
  return { $axf: TOKEN_REGISTRY_FRAME, version: Number.isInteger(raw?.version) && raw.version > 0 ? raw.version : 1, updatedAt: str(raw?.updatedAt, 40), tokens: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

/** What is wrong with a registry document (empty = valid). */
export function registryErrors(raw) {
  const errors = [];
  if (!isObj(raw)) return ['the registry must be an object'];
  if (raw.$axf !== TOKEN_REGISTRY_FRAME) errors.push(`$axf must be ${TOKEN_REGISTRY_FRAME}`);
  if (!Array.isArray(raw.tokens)) return [...errors, 'tokens must be an array'];
  const seen = new Set();
  raw.tokens.forEach((t, i) => {
    const at = `tokens[${i}]`;
    if (!isObj(t)) { errors.push(`${at}: not an object`); return; }
    if (!TOKEN_ID.test(t.id ?? '')) errors.push(`${at}: id "${t.id}" is not a --fx-* token`);
    else if (seen.has(t.id)) errors.push(`${at}: duplicate id ${t.id}`);
    seen.add(t.id);
    if (!TOKEN_AREAS.includes(t.area)) errors.push(`${at} ${t.id}: area must be one of ${TOKEN_AREAS.join(', ')}`);
    if (!TOKEN_LEVELS.includes(t.level)) errors.push(`${at} ${t.id}: level must be one of ${TOKEN_LEVELS.join(', ')}`);
    if (!TOKEN_STATES.includes(t.state)) errors.push(`${at} ${t.id}: state must be one of ${TOKEN_STATES.join(', ')}`);
    if (!TOKEN_SCHEMES.includes(t.scheme)) errors.push(`${at} ${t.id}: scheme must be light, dark or both`);
    if (!str(t.element)) errors.push(`${at} ${t.id}: element missing`);
    if (!str(t.description) || !/[.!?]$/.test(str(t.description))) errors.push(`${at} ${t.id}: description must be a plain sentence ending with a full stop`);
    if (!str(t.source)) errors.push(`${at} ${t.id}: source missing`);
  });
  return errors;
}

/** The tokens a level shows: basic = basic only; pro = basic + pro; advanced = everything. */
export const tokensAtLevel = (tokens, level) => tokens.filter((t) => (LEVEL_RANK[t.level] ?? 2) <= (LEVEL_RANK[level] ?? 2));

/** Search and filter: words match the id, element, description, area, state and source (every word must hit). */
export function searchTokens(tokens, { q = '', area = '', element = '', level = '', state = '', scheme = '', source = '' } = {}) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.filter((t) => {
    if (area && t.area !== area) return false;
    if (element && t.element !== element) return false;
    if (level && (LEVEL_RANK[t.level] ?? 2) > (LEVEL_RANK[level] ?? 2)) return false;
    if (state && t.state !== state) return false;
    if (scheme && t.scheme !== scheme && t.scheme !== 'both') return false;
    if (source && !String(t.source).includes(source) && !(t.sources ?? []).some((s) => s.includes(source))) return false;
    if (!words.length) return true;
    const hay = `${t.id} ${t.element} ${t.description} ${t.area} ${t.state} ${t.source} ${t.level}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Counts by element, area and level (the registry page's summary). */
export function registrySummary(tokens) {
  const count = (k) => tokens.reduce((m, t) => ((m[t[k]] = (m[t[k]] ?? 0) + 1), m), {});
  return { total: tokens.length, elements: count('element'), areas: count('area'), levels: count('level'), states: count('state') };
}

/* ================================================================== manifests (plugin.json / axf.manifest.json) */

/** The `tokens` block of a manifest, shaped: `uses` (ids the UI reads) and `defines` (its own registry entries). */
export function manifestTokens(manifest, source = 'manifest') {
  const b = manifest?.tokens;
  if (!isObj(b)) return null;
  const uses = [...new Set((Array.isArray(b.uses) ? b.uses : []).map((s) => str(s, 80)).filter((s) => TOKEN_ID.test(s)))].sort();
  const defines = (Array.isArray(b.defines) ? b.defines : []).map((d) => normalizeToken(d, { source })).filter(Boolean);
  return { uses, defines };
}

/** What is wrong with a manifest's `tokens` block (empty = valid; a missing block is reported only when `required`). */
export function manifestTokenErrors(manifest, { required = false } = {}) {
  const b = manifest?.tokens;
  if (b === undefined) return required ? [`no "tokens" block (${TOKEN_MANIFEST_FRAME}): list the --fx-* tokens the UI reads under "uses"`] : [];
  if (!isObj(b)) return ['"tokens" must be an object'];
  const errors = [];
  if (b.$axf !== TOKEN_MANIFEST_FRAME) errors.push(`tokens.$axf must be ${TOKEN_MANIFEST_FRAME}`);
  if (b.uses !== undefined && !Array.isArray(b.uses)) errors.push('tokens.uses must be an array of --fx-* ids');
  for (const u of Array.isArray(b.uses) ? b.uses : []) if (!TOKEN_ID.test(String(u))) errors.push(`tokens.uses: "${u}" is not a --fx-* token`);
  if (b.defines !== undefined && !Array.isArray(b.defines)) errors.push('tokens.defines must be an array of registry entries');
  for (const d of Array.isArray(b.defines) ? b.defines : []) {
    if (!isObj(d) || !TOKEN_ID.test(String(d.id))) { errors.push(`tokens.defines: "${d?.id}" is not a --fx-* token`); continue; }
    if (!str(d.description)) errors.push(`tokens.defines ${d.id}: a plain-English description is required`);
  }
  return errors;
}

/**
 * Coverage: `registered` = registry ids; `used` = { id → [files] } from the sources; `prefixes` = engine prefixes that
 * build names at run time (a used name under one is known even if not listed). Answers the two CI failures.
 */
export function registryCoverage(registered, used, prefixes = []) {
  const reg = new Set(registered);
  const under = (id) => prefixes.some((p) => id.startsWith(p));
  const unregistered = Object.entries(used).filter(([id]) => !reg.has(id) && !under(id)).map(([id, files]) => ({ id, files: [...files].slice(0, 5) })).sort((a, b) => a.id.localeCompare(b.id));
  const unused = [...reg].filter((id) => !used[id]).sort();
  return { unregistered, unused };
}

/** A manifest's `uses` against what its files read: tokens read but not listed, listed but not read. */
export function manifestUsesDiff(listed, read) {
  const l = new Set(listed); const r = new Set(read);
  return { missing: [...r].filter((x) => !l.has(x)).sort(), stale: [...l].filter((x) => !r.has(x)).sort() };
}

/* ================================================================== token → control@1 set (how an edit applies) */

/**
 * Which control@1 token set carries a token, and under which path (engines/control-tokens.mjs), or null for a variable
 * only the stylesheet reads. `colourKeys` = the colour theme's token keys; `styleFields` / `layoutFields` /
 * `scaleFields` = { kebab var suffix → field } maps the caller derives from the engines.
 */
export function tokenSet(name, { colourKeys = [], styleFields = {}, layoutFields = {}, scaleFields = {} } = {}) {
  const bare = String(name).replace(/^--fx-/, '');
  if (colourKeys.some((k) => kebab(k) === bare)) return { target: 'tokens.theme', path: camel(bare) };
  if (bare.startsWith('layout-')) return { target: 'tokens.layout', path: layoutFields[bare.slice(7)] ?? camel(bare.slice(7)) };
  if (styleFields[bare]) return { target: 'tokens.style', path: styleFields[bare] };
  const sc = scaleFields[bare];
  if (sc) return { target: `tokens.${sc.type}`, path: sc.path };
  return null;
}

/* ================================================================== skin-snapshot@1 */

/** The root of every chain: the default skin, no edits. */
export function rootSnapshot(ui, by = 'skin-editor', at = new Date().toISOString()) {
  return { $axf: SKIN_SNAPSHOT_FRAME, id: DEFAULT_SKIN_ID, parent: null, at, by, label: DEFAULT_SKIN_LABEL, kind: 'default', ui: normalizeUi(ui), edits: [], state: {} };
}

export function normalizeUi(ui) {
  const kind = ['view', 'dialog', 'plugin', 'element', 'screen'].includes(ui?.kind) ? ui.kind : 'view';
  return { kind, id: str(ui?.id, 80) || 'home', label: str(ui?.label, 120) };
}

const snapshotId = (at, n) => `s${Date.parse(at).toString(36)}${n.toString(36)}`;

/** One snapshot, shaped; null when unusable. */
export function normalizeSnapshot(raw) {
  if (!isObj(raw) || !str(raw.id, 80)) return null;
  const state = {};
  for (const [k, v] of Object.entries(isObj(raw.state) ? raw.state : {})) if (TOKEN_ID.test(k) && SCALAR(v)) state[k] = v;
  const edits = (Array.isArray(raw.edits) ? raw.edits : []).filter((e) => isObj(e) && TOKEN_ID.test(e.token ?? '')).map((e) => ({ token: e.token, from: SCALAR(e.from) ? e.from : null, to: SCALAR(e.to) ? e.to : null })).slice(0, 500);
  return {
    $axf: SKIN_SNAPSHOT_FRAME, id: str(raw.id, 80), parent: raw.parent === null || raw.parent === undefined ? null : str(raw.parent, 80),
    at: str(raw.at, 40) || new Date(0).toISOString(), by: str(raw.by, 80) || 'skin-editor', label: str(raw.label, 160),
    kind: SNAPSHOT_KINDS.includes(raw.kind) ? raw.kind : 'edit', ui: normalizeUi(raw.ui), edits, state,
  };
}

/** The state after `edits` on `state` (to = null drops the token back to the default skin). */
export function applyEdits(state, edits) {
  const out = { ...state };
  for (const e of edits) { if (e.to === null || e.to === undefined || e.to === '') delete out[e.token]; else out[e.token] = e.to; }
  return out;
}

/** The edits that turn state `a` into state `b`. */
export function diffStates(a, b) {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]).values()) if (a[k] !== b[k]) out.push({ token: k, from: a[k] ?? null, to: b[k] ?? null });
  return out.sort((x, y) => x.token.localeCompare(y.token));
}

/** The label of an edit snapshot: the token(s) changed. */
export const editLabel = (edits) => (edits.length === 1 ? `${edits[0].token} → ${edits[0].to === null ? 'default' : edits[0].to}` : `${edits.length} tokens changed`);

/**
 * A new snapshot after one edit (or a batch) on `head`. `chain` = every snapshot so far (for the id and the cap).
 * Edits that change nothing are dropped; no change = null.
 */
export function editSnapshot(chain, head, rawEdits, { by = 'skin-editor', at = new Date().toISOString(), label = '' } = {}) {
  const edits = (Array.isArray(rawEdits) ? rawEdits : [rawEdits]).filter((e) => isObj(e) && TOKEN_ID.test(e.token ?? '')).map((e) => ({ token: e.token, from: head.state[e.token] ?? null, to: SCALAR(e.to) && e.to !== '' ? e.to : null })).filter((e) => e.from !== e.to);
  if (!edits.length) return null;
  if (chain.length >= SNAPSHOT_MAX) throw new Error(`snapshot chain is full (${SNAPSHOT_MAX}): export a skin and start again`);
  return { $axf: SKIN_SNAPSHOT_FRAME, id: snapshotId(at, chain.length), parent: head.id, at, by, label: str(label, 160) || editLabel(edits), kind: 'edit', ui: head.ui, edits, state: applyEdits(head.state, edits) };
}

/** The snapshots from the root down to `id` (the visible chain), oldest first; [] when the id is unknown. */
export function chainTo(chain, id) {
  const byId = new Map(chain.map((s) => [s.id, s]));
  const out = []; let cur = byId.get(id); const seen = new Set();
  while (cur && !seen.has(cur.id)) { out.unshift(cur); seen.add(cur.id); cur = cur.parent ? byId.get(cur.parent) : null; }
  return out;
}

/** Every snapshot as a tree row (depth, whether it is on the head's chain), oldest first: what the history panel draws. */
export function snapshotRows(chain, headId) {
  const onPath = new Set(chainTo(chain, headId).map((s) => s.id));
  const byId = new Map(chain.map((s) => [s.id, s]));
  const depth = (s, seen = new Set()) => { let d = 0; let cur = s; while (cur?.parent && byId.has(cur.parent) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parent); d++; } return d; };
  return [...chain].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).map((s) => ({ id: s.id, parent: s.parent, at: s.at, by: s.by, label: s.label, kind: s.kind, edits: s.edits.length, tokens: Object.keys(s.state).length, depth: depth(s), onPath: onPath.has(s.id), head: s.id === headId }));
}

/**
 * Revert: a new snapshot (kind `revert`) whose state is `targetId`'s, as a child of `head`, so the history keeps
 * everything (like a disk snapshot you roll back to). Null when the target is the head's state already.
 */
export function revertSnapshot(chain, head, targetId, { by = 'skin-editor', at = new Date().toISOString() } = {}) {
  const target = chain.find((s) => s.id === targetId);
  if (!target) throw new Error(`no snapshot "${targetId}"`);
  const edits = diffStates(head.state, target.state);
  if (!edits.length) return null;
  return { $axf: SKIN_SNAPSHOT_FRAME, id: snapshotId(at, chain.length), parent: head.id, at, by, label: `Reverted to ${target.label || target.id}`, kind: 'revert', ui: head.ui, edits, state: { ...target.state } };
}

/** The last snapshot on the head's chain at or before `iso` ("the skin as it was 10 minutes ago"); the root when none. */
export function snapshotBefore(chain, headId, iso) {
  const path = chainTo(chain, headId);
  const t = Date.parse(iso);
  let pick = path[0] ?? null;
  for (const s of path) if (Date.parse(s.at) <= t) pick = s;
  return pick;
}

/** What is wrong with a stored chain (empty = valid): one root, no dangling parent, no duplicate id, bounded. */
export function chainErrors(chain) {
  const errors = [];
  if (!Array.isArray(chain)) return ['the chain must be an array'];
  const ids = new Set();
  const roots = chain.filter((s) => s.parent === null);
  if (chain.length && roots.length !== 1) errors.push(`a chain has exactly one root (found ${roots.length})`);
  if (roots[0] && roots[0].kind !== 'default') errors.push('the root snapshot is the default skin');
  for (const s of chain) {
    if (ids.has(s.id)) errors.push(`duplicate snapshot id ${s.id}`);
    ids.add(s.id);
  }
  for (const s of chain) if (s.parent !== null && !ids.has(s.parent)) errors.push(`snapshot ${s.id} has an unknown parent ${s.parent}`);
  if (chain.length > SNAPSHOT_MAX) errors.push(`more than ${SNAPSHOT_MAX} snapshots`);
  return errors;
}

/* ================================================================== export: a snapshot's state → a skin asset */

/**
 * A skin asset (asset@1 `skin`) that carries `state`. `base` = the skin data to start from (the app's skin in force or
 * a starter): its themes and asset slots are kept; the mapped tokens become control@1 overrides under
 * `extras.settings['axf.tokens.<set>']['*']`, the rest ride `extras.settings[SKIN_VARS_KEY]` so nothing is lost.
 */
export function exportSkin(state, { id, name, base, description = '', author = 'Skin editor', tags = [], sets = {} } = {}) {
  const sid = str(id, 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!SKIN_ID.test(sid)) throw new Error('a skin id is 1–60 lowercase letters, digits and dashes');
  if (!isObj(base) || !str(base.layoutTheme) || !str(base.colorTheme) || !str(base.styleTheme) || !isObj(base.assets)) throw new Error('a base skin with layoutTheme, colorTheme, styleTheme and assets is required');
  const settings = { ...(isObj(base.extras?.settings) ? base.extras.settings : {}) };
  const mapped = []; const unmapped = {};
  for (const [token, value] of Object.entries(state)) {
    const set = sets[token];
    if (set?.target && set?.path) {
      const key = `axf.tokens.${set.target.replace(/^tokens\./, '')}`;
      settings[key] = { ...(isObj(settings[key]) ? settings[key] : {}), '*': { ...(isObj(settings[key]?.['*']) ? settings[key]['*'] : {}), [set.path]: value } };
      mapped.push(token);
    } else unmapped[token] = value;
  }
  if (Object.keys(unmapped).length) settings[SKIN_VARS_KEY] = { ...(isObj(settings[SKIN_VARS_KEY]) ? settings[SKIN_VARS_KEY] : {}), ...unmapped };
  const data = {
    layoutTheme: base.layoutTheme, colorTheme: base.colorTheme, styleTheme: base.styleTheme,
    ...(str(base.behaviorTheme) ? { behaviorTheme: base.behaviorTheme } : {}),
    assets: { ...base.assets },
    preview: { caption: str(description, 160) || `${str(name, 120) || sid}: exported from the Skin editor.` },
    extras: { ...(isObj(base.extras) ? base.extras : {}), settings },
    ...(str(base.iconPack) ? { iconPack: base.iconPack } : {}),
    ...(isObj(base.parts) ? { parts: base.parts } : {}),
  };
  const asset = { $axf: 'asset@1', type: 'skin', id: sid, name: str(name, 120) || sid, version: '1.0.0', description: str(description, 500) || `Exported from the Skin editor with ${Object.keys(state).length} token edit(s).`, author: str(author, 80) || 'Skin editor', tags: [...new Set(['skin', 'exported', ...tags.map((t) => str(t, 40)).filter(Boolean)])], data };
  return { asset, mapped: mapped.sort(), unmapped: Object.keys(unmapped).sort() };
}

/** The state a skin asset carries (the inverse of exportSkin): the overrides under axf.tokens.* plus the raw vars. */
export function skinState(skinData, sets = {}) {
  const settings = isObj(skinData?.extras?.settings) ? skinData.extras.settings : {};
  const state = {};
  const byTarget = {};
  for (const [token, set] of Object.entries(sets)) if (set?.target && set?.path) byTarget[`axf.tokens.${set.target.replace(/^tokens\./, '')}|${set.path}`] = token;
  for (const [key, val] of Object.entries(settings)) {
    if (!key.startsWith('axf.tokens.') || !isObj(val?.['*'])) continue;
    for (const [path, v] of Object.entries(val['*'])) { const token = byTarget[`${key}|${path}`]; if (token && SCALAR(v)) state[token] = v; }
  }
  for (const [k, v] of Object.entries(isObj(settings[SKIN_VARS_KEY]) ? settings[SKIN_VARS_KEY] : {})) if (TOKEN_ID.test(k) && SCALAR(v)) state[k] = v;
  return state;
}

/* ================================================================== voice (AmberX) */

export const SKIN_VOICE_FRAME = 'skin-editor-voice@1';
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, half: 0.5 };
const UNIT_MIN = { second: 1 / 60, seconds: 1 / 60, minute: 1, minutes: 1, min: 1, mins: 1, hour: 60, hours: 60, day: 1440, days: 1440 };

/** Lower case, no punctuation or politeness, single spaces (the same shape AmberX hands over). */
export function cleanSkinPhrase(text) {
  return String(text ?? '').toLowerCase().replace(/[“”"'’,!?;:]+/g, ' ').replace(/^\s*(hey |ok |okay )?(amber|amberx)\b[\s,]*/, ' ').replace(/\b(please|can you|could you|would you|for me|now)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A phrase → a Skin editor intent, or null when it is not one:
 *   "revert the skin to 10 minutes ago" → { verb: 'revert', minutes: 10 }
 *   "revert the skin to the default" → { verb: 'revert', snapshot: 'default' }
 *   "revert the skin to snapshot s12" → { verb: 'revert', snapshot: 's12' }
 *   "export this as a new skin called Midnight" / "save this skin as Midnight" → { verb: 'export', name: 'Midnight' }
 *   "undo the last skin edit" → { verb: 'undo' }
 *   "open the skin editor" / "open plan studio in the skin editor" → { verb: 'open', ui? }
 *   "set the accent to #ff8800 in the skin" / "skin: set --fx-accent to red" → { verb: 'set', token, value }
 *   "show the token registry" / "search the token registry for hover" → { verb: 'registry', q? }
 */
export function skinVoiceIntent(text) {
  const p = cleanSkinPhrase(text);
  if (!p) return null;
  let m;
  const REVERT = '(?:revert|roll back|rollback|roll|go back|take|put|reset)(?: the)?(?: skin| look| theme)?(?: back)?';
  if ((m = p.match(new RegExp(`^${REVERT} to (?:about |around |roughly )?(\\d+(?:\\.\\d+)?|[a-z]+)(?: and a half)? (seconds?|minutes?|mins?|hours?|days?) ago$`)))) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : NUM[m[1]];
    if (n !== undefined && UNIT_MIN[m[2]]) return { verb: 'revert', minutes: Math.round(n * UNIT_MIN[m[2]] * 1000) / 1000 };
  }
  if ((m = p.match(new RegExp(`^${REVERT} to (?:the )?(default|start|beginning|original)(?: skin)?$`)))) return { verb: 'revert', snapshot: DEFAULT_SKIN_ID };
  if ((m = p.match(new RegExp(`^${REVERT} to (?:the )?(?:snapshot |point |edit )?([a-z0-9]+)$`)))) return { verb: 'revert', snapshot: m[1] };
  if ((m = p.match(/^(?:export|save)(?: this| the current| the| current)?(?: skin| look)?(?: as(?: a)?(?: new)?(?: skin)?)?(?: called| named| as)? ([a-z0-9][a-z0-9 -]{0,59})$/)) && !/^(skin|look)$/.test(m[1].trim())) {
    return { verb: 'export', name: m[1].trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') };
  }
  if (/^undo(?: the)?(?: last)?(?: skin)?(?: edit| change)?$/.test(p) || /^undo the last skin (edit|change)$/.test(p)) return { verb: 'undo' };
  if ((m = p.match(/^(?:open|show|load|put) (?:the )?(.+?) in the skin editor$/))) return { verb: 'open', ui: m[1].replace(/^(the|a|an) /, '').trim() };
  if (/^(?:open|show|go to|launch)(?: the)? skin editor$/.test(p)) return { verb: 'open' };
  if ((m = p.match(/^(?:in the skin editor )?(?:skin(?: editor)?[ :]+)?set (?:the )?(--fx-[a-z0-9-]+|[a-z][a-z0-9 -]*?) to (.+?)(?: in the skin(?: editor)?)?$/))) {
    const token = m[1].startsWith('--fx-') ? m[1] : `--fx-${m[1].trim().replace(/\s+/g, '-')}`;
    if (TOKEN_ID.test(token) && (p.includes('skin') || m[1].startsWith('--fx-'))) return { verb: 'set', token, value: m[2].trim() };
  }
  if ((m = p.match(/^(?:search|find|look up)(?: in)?(?: the)? token registry for (.+)$/))) return { verb: 'registry', q: m[1].trim() };
  if ((m = p.match(/^(?:find|search for|look up) (.+?) in the token registry$/))) return { verb: 'registry', q: m[1].trim() };
  if (/^(?:open|show|list|go to)(?: me)?(?: the)? token registry$/.test(p) || /^(?:list|show) (?:every|all)(?: the)? tokens$/.test(p)) return { verb: 'registry' };
  return null;
}
