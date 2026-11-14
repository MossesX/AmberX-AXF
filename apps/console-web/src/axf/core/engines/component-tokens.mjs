/**
 * component-tokens@1 (build own-token-sets-for-grids-and-tab-groups, Nov 13 2026). Brett: "how many tokens does a grid
 * have, colors, don't they need that to have hover colors; what about tab groups, are they the same way".
 *
 * Until now a grid had only layout tokens and a tab group only its padding: both borrowed the general colour tokens
 * (--fx-surface2 for a hovered row, --fx-accent for the active tab's line), so a skin could not style a hover, a
 * selected row or an active tab on its own. This file is the ONE schema of the two component token families:
 *
 *   grid  →  --fx-grid-<token>   every grid / table (framework .fx-table, lib-datagrid .axf-grid)
 *   tabs  →  --fx-tab-<token>    every tab row (page tabs .fx-tabs, the TabGroup control, window tab bars)
 *
 * Every token has a kind, a plain-English description, a level (basic / pro / advanced, for the experience-level views
 * that follow) and a DEFAULT that points at the general token the component read before, so every existing skin
 * looks exactly as it did with zero changes. axf.css carries the defaults in its :root block and every grid / tab
 * rule reads only these tokens (framework/spec/check-component-tokens.mjs fails on a general colour token or a
 * literal in those rules, and on a :root block that drifts from this schema).
 *
 * Where a value comes from, lowest to highest:
 *   1. the :root defaults in axf.css (this schema's `default` column)
 *   2. the style theme: `data.grid.<token>` / `data.tabs.<token>` (optional, skins set them; control@1 tokens.style
 *      paths `grid.<token>` / `tabs.<token>`, so every skin edit also works through REST, MCP, CLI and voice)
 *   3. one instance's own overrides: settings key `axf.tokens.instances` = { "<family>.<instance>": { values, previous } },
 *      an inline style on that one tab row / grid (control@1 target tokens.instances). `previous` is the values map
 *      before the last edit: "Restore previous edit" swaps it back; "Restore from axHub" drops the entry so the
 *      instance follows the shared look again. The key rides the axHub appearance document like every axf.tokens.* key.
 *
 * Values a token accepts (same everywhere):
 *   colour   a colour-theme token name (`accentSoft`, `surface2`, `accent-soft`) → var(--fx-accent-soft); a CSS colour
 *            (#rgb…, rgb(), hsl(), color-mix(…)); `transparent` / `currentColor` / `inherit`
 *   length   a number (px), a CSS length (`0.5em`, `2px`, `calc(var(--fx-space) * 2)`), a style token name
 *            (`radius.sm`, `dens-gap-md`, `space`) → var(--fx-radius-sm) …; `auto` / `none` / `0`
 *   shadow   a CSS shadow, `none`, or `shadow.sm` / `shadow.md` / `shadow.lg`
 *   opacity  a number 0..1 (1 = opaque; the component's background is mixed with transparent by it)
 *   number   a plain finite number (a weight)
 *
 * Pure: no IO, no DOM. Shared by the theme engine (styleThemeVars), the runtime, control-rules (paths + validation),
 * the TabGroup and DataGrid controls (per-instance vars), the CI check and gen-fixtures. Kotlin twin deferred
 * (framework/spec/PORTING.md).
 */

export const COMPONENT_TOKENS_CONTRACT = 'component-tokens@1';
export const COMPONENT_TOKEN_LEVELS = ['basic', 'pro', 'advanced'];
export const COMPONENT_TOKEN_KINDS = ['colour', 'length', 'shadow', 'opacity', 'number'];

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const t = (key, kind, def, level, description) => ({ key, kind, default: def, level, description });

/* ------------------------------------------------------------------ the two families */

export const COMPONENT_TOKEN_FAMILIES = {
  grid: {
    label: 'Grid',
    prefix: '--fx-grid-',
    doc: 'Every grid and table: the framework table (.fx-table) and lib-datagrid (.axf-grid).',
    tokens: [
      // header
      t('headerBg', 'colour', 'var(--fx-surface2)', 'basic', 'Background of the header row.'),
      t('tableHeaderBg', 'colour', 'transparent', 'pro', 'Background of a plain table\'s header row (.fx-table; the data grid uses headerBg).'),
      t('headerText', 'colour', 'var(--fx-muted)', 'basic', 'Text colour of the column headers (a data grid\'s header buttons follow the quiet button until this is set).'),
      t('headerActiveText', 'colour', 'var(--fx-accent)', 'pro', 'Text of the current / highlighted column header (matrix tables).'),
      t('headerBorder', 'colour', 'var(--fx-border)', 'pro', 'Line under the header row.'),
      t('headerWeight', 'number', '600', 'advanced', 'Font weight of the column headers.'),
      t('sortArrow', 'colour', 'currentColor', 'pro', 'The sort direction arrow on a sorted column (currentColor = the header text).'),
      // rows and states
      t('rowBg', 'colour', 'transparent', 'basic', 'Background of a plain row.'),
      t('rowAltBg', 'colour', 'transparent', 'pro', 'Background of every second row (zebra striping; same as rowBg = no stripes).'),
      t('rowText', 'colour', 'inherit', 'basic', 'Text colour of a row.'),
      t('hoverBg', 'colour', 'var(--fx-surface2)', 'basic', 'Background of the row under the pointer.'),
      t('hoverText', 'colour', 'inherit', 'advanced', 'Text colour of the row under the pointer.'),
      t('selectedBg', 'colour', 'var(--fx-accent-soft)', 'basic', 'Background of the selected row.'),
      t('selectedText', 'colour', 'inherit', 'advanced', 'Text colour of the selected row.'),
      t('selectedBorder', 'colour', 'var(--fx-accent)', 'pro', 'Outline of a row in a multi-selection.'),
      t('focusRing', 'colour', 'var(--fx-focus)', 'pro', 'Keyboard focus ring on a row or header cell.'),
      t('expandedBg', 'colour', 'var(--fx-surface2)', 'pro', 'Background of an expanded row\'s detail panel.'),
      t('disabledOpacity', 'opacity', '1', 'advanced', 'How faded a disabled row is (1 = not faded; set var(--fx-opacity-disabled) or a number below 1).'),
      // lines, frame, sizes
      t('lineColor', 'colour', 'var(--fx-border)', 'basic', 'Grid lines between rows and cells.'),
      t('outerBorder', 'colour', 'transparent', 'pro', 'Border around the whole grid.'),
      t('cellPadY', 'length', 'var(--fx-size-table-pad-y)', 'pro', 'Vertical cell padding (table cells).'),
      t('cellPadX', 'length', 'var(--fx-size-table-pad-x)', 'pro', 'Horizontal cell padding (table cells).'),
      t('rowHeight', 'length', 'auto', 'pro', 'Minimum row height; auto = as tall as the content.'),
      t('radius', 'length', '0', 'basic', 'Corner radius of the whole grid.'),
      // groups, sticky, empty
      t('groupHeaderBg', 'colour', 'var(--fx-surface3)', 'pro', 'Background of a top-level group header row.'),
      t('groupHeaderBgNested', 'colour', 'var(--fx-surface2)', 'advanced', 'Background of a second-level group header row.'),
      t('groupHeaderBgDeep', 'colour', 'var(--fx-surface)', 'advanced', 'Background of a third-level (or deeper) group header row.'),
      t('groupHeaderText', 'colour', 'inherit', 'advanced', 'Text colour of a group header row.'),
      t('groupSummaryText', 'colour', 'var(--fx-muted)', 'advanced', 'The summary text beside a group title.'),
      t('stickyShadow', 'shadow', 'none', 'advanced', 'Shadow under a sticky header / beside a sticky column.'),
      t('emptyText', 'colour', 'var(--fx-muted)', 'pro', 'Text colour of the empty state ("Nothing to show").'),
      t('opacity', 'opacity', '1', 'basic', 'Transparency of the grid\'s backgrounds (1 = opaque).'),
    ],
  },
  tabs: {
    label: 'Tab group',
    prefix: '--fx-tab-',
    doc: 'Every tab row: page tabs (.fx-tabs), the TabGroup control (.fx-tabs--group) and window tab bars (.fx-tabgroup__bar).',
    tokens: [
      // bar
      t('barBg', 'colour', 'transparent', 'basic', 'Background of the tab row.'),
      t('barBorder', 'colour', 'var(--fx-border)', 'basic', 'Rule under (or beside) the tab row.'),
      t('gap', 'length', 'var(--fx-dens-gap-md)', 'pro', 'Space between tabs.'),
      // idle
      t('text', 'colour', 'var(--fx-muted)', 'basic', 'Text of an idle tab.'),
      t('bg', 'colour', 'transparent', 'basic', 'Background of an idle tab.'),
      t('border', 'colour', 'transparent', 'pro', 'Border of an idle tab (boxed and chips styles).'),
      // hover
      t('hoverText', 'colour', 'var(--fx-text)', 'basic', 'Text of the tab under the pointer.'),
      t('hoverBg', 'colour', 'transparent', 'basic', 'Background of the tab under the pointer.'),
      t('hoverBorder', 'colour', 'var(--fx-tab-border)', 'advanced', 'Border of the tab under the pointer.'),
      // active / selected
      t('activeText', 'colour', 'var(--fx-text)', 'basic', 'Text of the active tab.'),
      t('activeBg', 'colour', 'transparent', 'basic', 'Background of the active tab (underline style).'),
      t('activeBorder', 'colour', 'transparent', 'pro', 'Border of the active tab (underline style).'),
      t('activeWeight', 'number', 'inherit', 'advanced', 'Font weight of the active tab.'),
      // pressed
      t('pressedText', 'colour', 'var(--fx-tab-hover-text)', 'advanced', 'Text of a tab while it is pressed.'),
      t('pressedBg', 'colour', 'var(--fx-tab-hover-bg)', 'advanced', 'Background of a tab while it is pressed.'),
      // disabled, focus
      t('disabledText', 'colour', 'var(--fx-tab-text)', 'pro', 'Text of a disabled tab.'),
      t('disabledOpacity', 'opacity', '1', 'advanced', 'How faded a disabled tab is (1 = not faded; set var(--fx-opacity-disabled) or a number below 1).'),
      t('focusRing', 'colour', 'var(--fx-focus)', 'pro', 'Keyboard focus ring on a tab.'),
      // indicator
      t('indicator', 'colour', 'var(--fx-accent)', 'basic', 'The active tab\'s line (underline style) and drop marker.'),
      t('indicatorSize', 'length', '2px', 'pro', 'Thickness of the active tab\'s line.'),
      // badge
      t('badgeBg', 'colour', 'var(--fx-surface3)', 'pro', 'Background of the count badge on an idle tab.'),
      t('badgeText', 'colour', 'var(--fx-muted)', 'pro', 'Text of the count badge on an idle tab.'),
      t('badgeActiveBg', 'colour', 'color-mix(in srgb, var(--fx-accent) calc(var(--fx-opacity-tint) * 100%), transparent)', 'advanced', 'Background of the count badge on the active tab.'),
      t('badgeActiveText', 'colour', 'var(--fx-text)', 'advanced', 'Text of the count badge on the active tab.'),
      // close, fold / overflow
      t('closeText', 'colour', 'var(--fx-muted)', 'advanced', 'The close (×) button on a closable tab.'),
      t('closeHoverText', 'colour', 'var(--fx-danger)', 'advanced', 'The close button under the pointer.'),
      t('closeHoverBg', 'colour', 'var(--fx-surface3)', 'advanced', 'Background of the close button under the pointer.'),
      t('foldBg', 'colour', 'var(--fx-surface)', 'pro', 'Background of the dropdown pick (overflow "dropdown": the one button that stands for the row).'),
      t('foldText', 'colour', 'var(--fx-text)', 'pro', 'Text of the dropdown pick.'),
      t('foldBorder', 'colour', 'var(--fx-border)', 'advanced', 'Border of the dropdown pick.'),
      t('foldRadius', 'length', 'var(--fx-radius-sm)', 'advanced', 'Corner radius of the dropdown pick.'),
      t('stickyBg', 'colour', 'var(--fx-surface)', 'pro', 'Background of a sticky tab row (so content scrolling under it stays hidden).'),
      // window tab bar (tab groups inside the windowing engine)
      t('windowBarBg', 'colour', 'var(--fx-surface2)', 'pro', 'Background of a window\'s tab bar.'),
      t('windowActiveBg', 'colour', 'var(--fx-surface)', 'pro', 'Background of the active tab in a window\'s tab bar.'),
      t('windowActiveShadow', 'shadow', 'var(--fx-shadow-sm)', 'advanced', 'Shadow of the active tab in a window\'s tab bar.'),
      // per style: radius and the colours each style draws differently
      t('radiusUnderline', 'length', '0', 'pro', 'Corner radius of a tab in the underline style.'),
      t('radiusPills', 'length', '999px', 'pro', 'Corner radius of a tab in the pills style.'),
      t('radiusBoxed', 'length', 'var(--fx-radius-sm)', 'pro', 'Corner radius (top corners) of a tab in the boxed style.'),
      t('radiusSegmented', 'length', 'var(--fx-radius-sm)', 'pro', 'Corner radius of a tab in the segmented style.'),
      t('radiusPlain', 'length', '0', 'pro', 'Corner radius of a tab in the plain style.'),
      t('radiusChips', 'length', '999px', 'pro', 'Corner radius of a tab in the chips style.'),
      t('radiusWindow', 'length', 'var(--fx-radius-sm)', 'advanced', 'Corner radius of a tab in a window\'s tab bar.'),
      t('pillsActiveBg', 'colour', 'var(--fx-accent)', 'basic', 'Background of the active pill.'),
      t('pillsActiveText', 'colour', 'var(--fx-accent-text)', 'basic', 'Text of the active pill.'),
      t('boxedActiveBg', 'colour', 'var(--fx-surface)', 'pro', 'Background of the active boxed tab.'),
      t('boxedActiveBorder', 'colour', 'var(--fx-border)', 'pro', 'Border of the active boxed tab.'),
      t('segmentedBg', 'colour', 'var(--fx-surface2)', 'pro', 'Background of the segmented control\'s track.'),
      t('segmentedBorder', 'colour', 'var(--fx-border)', 'advanced', 'Border of the segmented control\'s track.'),
      t('segmentedRadius', 'length', 'var(--fx-radius-md)', 'advanced', 'Corner radius of the segmented control\'s track.'),
      t('segmentedActiveBg', 'colour', 'var(--fx-surface)', 'pro', 'Background of the active segment.'),
      t('segmentedActiveShadow', 'shadow', 'var(--fx-shadow-sm)', 'advanced', 'Shadow of the active segment.'),
      t('plainActiveText', 'colour', 'var(--fx-accent)', 'pro', 'Text of the active tab in the plain style.'),
      t('plainActiveWeight', 'number', '600', 'advanced', 'Font weight of the active tab in the plain style.'),
      t('chipsBg', 'colour', 'var(--fx-surface)', 'pro', 'Background of an idle chip.'),
      t('chipsBorder', 'colour', 'var(--fx-border)', 'pro', 'Border of an idle chip.'),
      t('chipsActiveBg', 'colour', 'var(--fx-accent-soft)', 'pro', 'Background of the active chip.'),
      t('chipsActiveBorder', 'colour', 'var(--fx-accent)', 'pro', 'Border of the active chip.'),
      t('opacity', 'opacity', '1', 'basic', 'Transparency of the tab row\'s backgrounds (1 = opaque).'),
    ],
  },
};

export const COMPONENT_TOKEN_FAMILY_IDS = Object.keys(COMPONENT_TOKEN_FAMILIES);
export const isComponentTokenFamily = (f) => typeof f === 'string' && Object.hasOwn(COMPONENT_TOKEN_FAMILIES, f);

/** The CSS variable of one token: componentTokenVar('grid', 'headerBg') → '--fx-grid-header-bg'. */
export function componentTokenVar(family, key) {
  const fam = COMPONENT_TOKEN_FAMILIES[family];
  return fam ? `${fam.prefix}${kebab(key)}` : null;
}

/** One token's schema row, or null. */
export function componentToken(family, key) {
  return COMPONENT_TOKEN_FAMILIES[family]?.tokens.find((x) => x.key === key) ?? null;
}

/** Every token of every family, flat: { family, key, path: 'grid.headerBg', var, kind, default, level, description }. */
export function componentTokenList() {
  const out = [];
  for (const [family, fam] of Object.entries(COMPONENT_TOKEN_FAMILIES)) {
    for (const x of fam.tokens) out.push({ family, ...x, path: `${family}.${x.key}`, var: `${fam.prefix}${kebab(x.key)}` });
  }
  return out;
}

/** Every token → its default (the :root block axf.css carries; the CI check keeps them equal). */
export function componentTokenDefaults() {
  return Object.fromEntries(componentTokenList().map((x) => [x.var, x.default]));
}

/* ------------------------------------------------------------------ values */

const SAFE = /^[A-Za-z0-9#%(),.\s*/+-]{1,160}$/;
const COLOUR_LITERAL = /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgba?|hsla?|oklch|oklab|lab|lch|color|color-mix)\(.*\))$/;
const TOKEN_NAME = /^[a-z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)*$/;
/** The style / scale tokens a length may name: the space unit, border width, row height, a radius, a density gap / pad, a sizing or typography size. */
const LENGTH_TOKEN = /^(space|border-w|row-h|radius\.(sm|md|lg)|dens-[a-z0-9-]+|size-[a-z0-9-]+|type-[a-z0-9-]+)$/;
const LENGTH_LITERAL = /^(0|-?\d*\.?\d+(px|em|rem|%|vw|vh|ch|dvh|dvw))$/;
const KEYWORDS = { colour: ['transparent', 'currentColor', 'inherit'], length: ['auto', 'none', 'inherit', '0'], shadow: ['none', 'inherit'] };
/** A style token name as it appears in the style theme (`radius.sm`, `dens-gap-md`, `accentSoft`) → its variable. */
const tokenVar = (name) => `var(--fx-${name.split('.').map(kebab).join('-')})`;

/**
 * The CSS value a raw token value compiles to, or null when the value is not one this kind accepts (it is dropped,
 * never written into a stylesheet: the regexes keep `;`, `{`, `}` and `<` out of every value).
 */
export function componentTokenValue(kind, raw) {
  if (raw === undefined || raw === null) return null;
  if (kind === 'opacity') { const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d*\.?\d+$/.test(raw.trim()) ? Number(raw) : NaN; return Number.isFinite(n) ? String(Math.min(1, Math.max(0, n))) : null; }
  if (kind === 'number') { const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^-?\d*\.?\d+$/.test(raw.trim()) ? Number(raw) : NaN; return Number.isFinite(n) ? String(n) : typeof raw === 'string' && raw.trim() === 'inherit' ? 'inherit' : null; }
  if (kind === 'length' && typeof raw === 'number') return Number.isFinite(raw) ? `${raw}px` : null;
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || !SAFE.test(v)) return null;
  if ((KEYWORDS[kind] ?? []).includes(v)) return v;
  if (v.startsWith('var(--fx-') && v.endsWith(')') && /^var\(--fx-[a-z0-9-]+\)$/.test(v)) return v;
  if (kind === 'colour') return COLOUR_LITERAL.test(v) ? v : TOKEN_NAME.test(v) ? tokenVar(v) : null;
  if (kind === 'length') return LENGTH_LITERAL.test(v) || /^calc\(.*\)$/.test(v) ? v : LENGTH_TOKEN.test(v) ? tokenVar(v) : null;
  if (kind === 'shadow') return TOKEN_NAME.test(v) && /^shadow\.(sm|md|lg)$/.test(v) ? tokenVar(v) : /\d/.test(v) ? v : null;
  return null;
}

/** Why a value is refused for a token, or null when it is fine (what control@1 answers on a bad set). */
export function componentTokenError(family, key, raw) {
  const tok = componentToken(family, key);
  if (!tok) return `${family} has no token ${key}`;
  if (componentTokenValue(tok.kind, raw) !== null) return null;
  const want = {
    colour: 'a colour-theme token name (accent, surface2, accentSoft), a CSS colour (#rrggbb, rgb(), hsl(), color-mix()) or transparent',
    length: 'a number of px, a CSS length (0.5em, 2px), a style token (radius.sm, dens-gap-md, space) or auto',
    shadow: 'a CSS shadow, none, or shadow.sm / shadow.md / shadow.lg',
    opacity: 'a number from 0 to 1',
    number: 'a number',
  }[tok.kind];
  return `${family}.${key} wants ${want}`;
}

/* ------------------------------------------------------------------ the style theme */

/**
 * The variables a style theme's `grid` / `tabs` maps set (only the tokens it names, only values their kind accepts).
 * Spread into styleThemeVars: a theme that sets none emits nothing, and the :root defaults stand.
 */
export function componentTokenVars(style) {
  const out = {};
  if (!style || typeof style !== 'object') return out;
  for (const [family, fam] of Object.entries(COMPONENT_TOKEN_FAMILIES)) {
    const map = style[family];
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const tok of fam.tokens) {
      const v = componentTokenValue(tok.kind, map[tok.key]);
      if (v !== null) out[`${fam.prefix}${kebab(tok.key)}`] = v;
    }
  }
  return out;
}

/** The style-theme fields of every component token, for control@1 tokens.style: { 'grid.headerBg': 'string', … }. */
export function componentTokenFields() {
  return Object.fromEntries(componentTokenList().map((x) => [x.path, x.kind === 'opacity' || x.kind === 'number' ? 'number' : 'string']));
}

/** control@1 tokens.style path rows for the component tokens (id, token, kind, default, level, description, family). */
export function componentTokenPaths() {
  return componentTokenList().map((x) => ({ id: x.path, token: x.var, kind: x.kind === 'colour' ? 'color' : x.kind === 'opacity' || x.kind === 'number' ? 'number' : 'string', default: x.default, level: x.level, description: x.description, family: x.family }));
}

/* ------------------------------------------------------------------ per-instance overrides */

/** The one settings key every instance override lives under (rides the axHub look: an axf.tokens.* key). */
export const INSTANCE_TOKENS_KEY = 'axf.tokens.instances';
/** The appearance engine's per-setting cap (engines/appearance.ts APPEARANCE_SETTING_MAX_BYTES). */
export const INSTANCE_TOKENS_MAX_BYTES = 4 * 1024;
const INSTANCE = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i;
export const isInstanceId = (id) => typeof id === 'string' && INSTANCE.test(id);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The entry id of one instance's overrides: 'tabs.settings.main'. */
export const instanceTokenEntry = (family, instance) => `${family}.${instance}`;
/** 'tabs.settings.main' → { family: 'tabs', instance: 'settings.main' } or null. */
export function parseInstanceTokenEntry(id) {
  if (typeof id !== 'string') return null;
  const dot = id.indexOf('.');
  if (dot < 1) return null;
  const family = id.slice(0, dot);
  const instance = id.slice(dot + 1);
  return isComponentTokenFamily(family) && isInstanceId(instance) ? { family, instance } : null;
}
/** A control@1 tokens.instances path: '<family>.<instance>' (whole instance) or '<family>.<instance>.<token>' → parts or null. */
export function parseInstanceTokenPath(path) {
  if (typeof path !== 'string') return null;
  const dot = path.indexOf('.');
  if (dot < 1) return null;
  const family = path.slice(0, dot);
  if (!isComponentTokenFamily(family)) return null;
  const rest = path.slice(dot + 1);
  const last = rest.lastIndexOf('.');
  if (last > 0 && componentToken(family, rest.slice(last + 1))) {
    const instance = rest.slice(0, last);
    return isInstanceId(instance) ? { family, instance, key: rest.slice(last + 1) } : null;
  }
  return isInstanceId(rest) ? { family, instance: rest, key: null } : null;
}

const cleanValues = (family, raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  for (const tok of COMPONENT_TOKEN_FAMILIES[family].tokens) {
    const v = raw[tok.key];
    if ((typeof v === 'string' || typeof v === 'number') && componentTokenValue(tok.kind, v) !== null) out[tok.key] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
};

/** The saved setting shaped: { '<family>.<instance>': { values: {…}, previous?: {…} } }; unknown families, instances and values dropped. */
export function normalizeInstanceTokens(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [id, entry] of Object.entries(raw)) {
    const p = parseInstanceTokenEntry(id);
    if (!p || !isObj(entry)) continue;
    const values = cleanValues(p.family, entry.values);
    const previous = entry.previous === undefined ? undefined : cleanValues(p.family, entry.previous);
    if (!Object.keys(values).length && !(previous && Object.keys(previous).length)) continue;
    out[id] = previous === undefined ? { values } : { values, previous };
  }
  return out;
}

/** One instance's overrides (raw values by token key), {} when it has none. */
export function instanceTokenValues(raw, family, instance) {
  return normalizeInstanceTokens(raw)[instanceTokenEntry(family, instance)]?.values ?? {};
}

/** The inline-style variables one instance sets: { '--fx-tab-active-bg': 'var(--fx-accent)', … }. */
export function instanceTokenVars(raw, family, instance) {
  const out = {};
  const fam = COMPONENT_TOKEN_FAMILIES[family];
  if (!fam) return out;
  for (const [key, v] of Object.entries(instanceTokenValues(raw, family, instance))) {
    const css = componentTokenValue(componentToken(family, key).kind, v);
    if (css !== null) out[`${fam.prefix}${kebab(key)}`] = css;
  }
  return out;
}

const sizeOf = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');

/**
 * Set (or with value null: drop) one token of one instance. The values before the edit become `previous`, so the
 * edit can be taken back with restorePreviousInstanceTokens. Throws on a bad value or a map over the setting cap.
 */
export function setInstanceToken(raw, family, instance, key, value) {
  const err = isComponentTokenFamily(family) ? (isInstanceId(instance) ? (value === null ? null : componentTokenError(family, key, value)) : `bad instance id ${String(instance)}`) : `unknown family ${String(family)}`;
  if (err) throw new Error(err);
  if (!componentToken(family, key)) throw new Error(`${family} has no token ${key}`);
  const all = normalizeInstanceTokens(raw);
  const id = instanceTokenEntry(family, instance);
  const before = all[id]?.values ?? {};
  const values = { ...before };
  if (value === null) delete values[key]; else values[key] = typeof value === 'string' ? value.trim() : value;
  if (JSON.stringify(values) === JSON.stringify(before)) return all;
  const next = { ...all, [id]: { values, previous: before } };
  if (sizeOf(next) > INSTANCE_TOKENS_MAX_BYTES) throw new Error(`per-instance token overrides would exceed ${INSTANCE_TOKENS_MAX_BYTES} bytes; restore some instances first`);
  return next;
}

/** Restore previous edit: the instance goes back to the values before its last edit (and the undone values become `previous`, so a second press redoes). */
export function restorePreviousInstanceTokens(raw, family, instance) {
  const all = normalizeInstanceTokens(raw);
  const id = instanceTokenEntry(family, instance);
  const entry = all[id];
  if (!entry || entry.previous === undefined) return all;
  const next = { ...all };
  if (!Object.keys(entry.previous).length && !Object.keys(entry.values).length) delete next[id];
  else next[id] = { values: entry.previous, previous: entry.values };
  return next;
}

/** Restore from axHub: drop every override of the instance (values and history), so it follows the shared look again. */
export function restoreInstanceTokensFromHub(raw, family, instance) {
  const all = normalizeInstanceTokens(raw);
  const id = instanceTokenEntry(family, instance);
  if (!(id in all)) return all;
  const next = { ...all };
  delete next[id];
  return next;
}

/** Can "Restore previous edit" do anything for this instance? */
export function instanceHasPrevious(raw, family, instance) {
  return normalizeInstanceTokens(raw)[instanceTokenEntry(family, instance)]?.previous !== undefined;
}

/** Every instance with overrides: [{ id, family, instance, values, hasPrevious }], sorted. */
export function instanceTokenList(raw) {
  return Object.entries(normalizeInstanceTokens(raw))
    .map(([id, e]) => ({ id, ...parseInstanceTokenEntry(id), values: e.values, hasPrevious: e.previous !== undefined }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
