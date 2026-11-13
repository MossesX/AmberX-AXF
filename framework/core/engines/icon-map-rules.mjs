/**
 * icon-map@1 (build icon-map-icon-packs-every-icon-badge-app, Brett Nov 13 2026: "a map of every single icon and
 * badge for the whole entire app, every plugin, every screen, every UI; a template so I can change every single one
 * with a click").
 *
 * ONE registry of every icon, badge and logo SLOT in every app: each place that shows an icon gets a stable id, where
 * it is (app, owner, surface, screen, file:line) and a ROLE ('save', 'approve', 'build-running', …). Roles are the join
 * between the map and the icon packs (icon-pack@1 `roles`: role → glyph), so applying a pack changes every slot of a
 * role at once, and a per-slot override (`axf.icons.slot.<id>`) changes one place.
 *
 * The map is BUILT, never written by hand: from every plugin's plugin.json (an optional `icons` block declares slots
 * and roles; everything else is derived), its web code (`<Icon name="x">`, `icon: 'x'`, `icon="x"`), the app's own
 * code and assets (nav-menu, app-menu, toolbar, context-menu, badge, logo, logo-mark, branding), and the framework's
 * React layer. A new plugin appears in the map the moment it has an icon anywhere: no registration call.
 *
 * Pure (text and data in, slots out): framework/cli/icon-map.mjs reads the files; framework/spec/check-icon-map.mjs
 * replays spec/fixtures/icon-map.json; the console's Icon map plugin serves the same result. Kotlin twin deferred
 * (Android on hold, spec/PORTING.md).
 *
 * Slot id: `<app>/<owner>/<surface>/<name>` (app = app folder, `framework` for the shared chrome; owner = the plugin
 * folder, `app` for the app's own UI, `framework`; surface = where it shows; name = the item id, label slug or glyph).
 *
 * Resolution (runtime.iconGlyph / Icon component), first hit wins:
 *   1. the slot's override (`axf.icons.slot.<id>` = a glyph name)
 *   2. the active pack's role mapping (pack.roles[role])
 *   3. the pack's glyph of that name (pack.glyphs[name]), else the framework glyph (glyphs.mjs), else the box.
 */
import { GLYPH_ALIASES, GLYPH_FALLBACK, GLYPH_NAMES, glyphName, isGlyph } from './glyphs.mjs';

export const ICON_MAP_FRAME = 'icon-map@1';

/** What a slot shows. Append-only. */
export const ICON_SLOT_KINDS = ['icon', 'badge', 'logo'];
/** Where a slot shows. Append-only; `inline` = an icon inside content with no chrome around it. */
export const ICON_SURFACES = ['nav', 'toolbar', 'tab', 'menu', 'context-menu', 'dialog', 'banner', 'widget', 'button', 'badge', 'logo', 'settings', 'view', 'status', 'empty-state', 'card', 'grid', 'step', 'inline'];
/** Where a slot was found. */
export const ICON_SOURCES = ['manifest', 'code', 'asset', 'framework'];
export const ICON_OWNER_KINDS = ['framework', 'app', 'plugin'];
/** Role groups (the Icon map screen's categories). */
export const ICON_ROLE_GROUPS = ['action', 'state', 'place', 'object', 'brand', 'badge', 'glyph'];

export const ICON_LIMITS = { slots: 20000, idChars: 160, labelChars: 80, roleChars: 48, declaredSlots: 400, declaredRoles: 200 };
export const SLOT_ID = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9_.-]*$/;
export const ROLE_ID = /^[a-z][a-z0-9-]*$/;
/** The settings key of a slot's override (a glyph name) and of the app's active pack (the skin engine's own key). */
export const ICON_SLOT_KEY = (slotId) => `axf.icons.slot.${slotId}`;
export const ICON_PACK_KEY = 'axf.icons.pack.app';
/** Put `icon-ok` in a comment on a line to allow a deliberate raw icon (an inline SVG or an emoji used as one). */
export const ICON_OK = 'icon-ok';

/**
 * The semantic role vocabulary: what a place MEANS, with the framework glyph it draws by default. Every framework glyph
 * is also a role of its own name (group `glyph`), so a pack that only maps glyph names still covers the whole map.
 * Append-only; a plugin adds roles in its `icons.roles`.
 */
export const ICON_ROLES = Object.freeze({
  // actions
  save: { glyph: 'save', group: 'action', label: 'Save' },
  approve: { glyph: 'check-circle', group: 'action', label: 'Approve' },
  reject: { glyph: 'x-circle', group: 'action', label: 'Reject' },
  add: { glyph: 'plus', group: 'action', label: 'Add' },
  remove: { glyph: 'trash', group: 'action', label: 'Remove' },
  edit: { glyph: 'edit', group: 'action', label: 'Edit' },
  copy: { glyph: 'copy', group: 'action', label: 'Copy' },
  refresh: { glyph: 'refresh', group: 'action', label: 'Refresh' },
  search: { glyph: 'search', group: 'action', label: 'Search' },
  close: { glyph: 'x', group: 'action', label: 'Close' },
  back: { glyph: 'arrow-left', group: 'action', label: 'Back' },
  forward: { glyph: 'arrow-right', group: 'action', label: 'Forward' },
  undo: { glyph: 'undo', group: 'action', label: 'Undo' },
  redo: { glyph: 'redo', group: 'action', label: 'Redo' },
  download: { glyph: 'download', group: 'action', label: 'Download' },
  upload: { glyph: 'upload', group: 'action', label: 'Upload' },
  run: { glyph: 'play', group: 'action', label: 'Run' },
  pause: { glyph: 'pause', group: 'action', label: 'Pause' },
  stop: { glyph: 'stop', group: 'action', label: 'Stop' },
  settings: { glyph: 'settings', group: 'action', label: 'Settings' },
  help: { glyph: 'help', group: 'action', label: 'Help' },
  info: { glyph: 'info', group: 'action', label: 'Info' },
  more: { glyph: 'more', group: 'action', label: 'More' },
  menu: { glyph: 'menu', group: 'action', label: 'Menu' },
  filter: { glyph: 'filter', group: 'action', label: 'Filter' },
  'open-external': { glyph: 'external', group: 'action', label: 'Open elsewhere' },
  pin: { glyph: 'pin', group: 'action', label: 'Pin' },
  lock: { glyph: 'lock', group: 'action', label: 'Lock' },
  unlock: { glyph: 'unlock', group: 'action', label: 'Unlock' },
  maximize: { glyph: 'maximize', group: 'action', label: 'Maximize' },
  minimize: { glyph: 'minimize', group: 'action', label: 'Minimize' },
  restore: { glyph: 'restore', group: 'action', label: 'Restore' },
  drag: { glyph: 'grip', group: 'action', label: 'Drag' },
  expand: { glyph: 'chevron-down', group: 'action', label: 'Expand' },
  collapse: { glyph: 'chevron-up', group: 'action', label: 'Collapse' },
  send: { glyph: 'send', group: 'action', label: 'Send' },
  share: { glyph: 'share', group: 'action', label: 'Share' },
  speak: { glyph: 'mic', group: 'action', label: 'Speak' },
  // states
  'build-running': { glyph: 'refresh', group: 'state', label: 'Build running' },
  'build-done': { glyph: 'check-circle', group: 'state', label: 'Build done' },
  'build-failed': { glyph: 'x-circle', group: 'state', label: 'Build failed' },
  'build-queued': { glyph: 'clock', group: 'state', label: 'Build queued' },
  pending: { glyph: 'clock', group: 'state', label: 'Pending' },
  approved: { glyph: 'check-circle', group: 'state', label: 'Approved' },
  warning: { glyph: 'alert', group: 'state', label: 'Warning' },
  error: { glyph: 'x-circle', group: 'state', label: 'Error' },
  ok: { glyph: 'check-circle', group: 'state', label: 'OK' },
  online: { glyph: 'zap', group: 'state', label: 'Online' },
  offline: { glyph: 'x-circle', group: 'state', label: 'Offline' },
  busy: { glyph: 'loader', group: 'state', label: 'Busy' },
  idle: { glyph: 'circle', group: 'state', label: 'Idle' },
  new: { glyph: 'sparkles', group: 'state', label: 'New' },
  // places
  home: { glyph: 'home', group: 'place', label: 'Home' },
  builds: { glyph: 'hammer', group: 'place', label: 'Builds' },
  plugins: { glyph: 'package', group: 'place', label: 'Plugins' },
  terminal: { glyph: 'terminal', group: 'place', label: 'Terminal' },
  chat: { glyph: 'message-square', group: 'place', label: 'Chat' },
  notes: { glyph: 'note', group: 'place', label: 'Notes' },
  tasks: { glyph: 'list', group: 'place', label: 'Tasks' },
  review: { glyph: 'eye', group: 'place', label: 'Review' },
  agents: { glyph: 'bot', group: 'place', label: 'Agents' },
  library: { glyph: 'book', group: 'place', label: 'Library' },
  framework: { glyph: 'layers', group: 'place', label: 'Framework' },
  apps: { glyph: 'grid', group: 'place', label: 'Apps' },
  appearance: { glyph: 'palette', group: 'place', label: 'Appearance' },
  // objects
  file: { glyph: 'file', group: 'object', label: 'File' },
  folder: { glyph: 'folder', group: 'object', label: 'Folder' },
  user: { glyph: 'user', group: 'object', label: 'Person' },
  key: { glyph: 'key', group: 'object', label: 'Key' },
  cloud: { glyph: 'cloud', group: 'object', label: 'Cloud' },
  device: { glyph: 'monitor', group: 'object', label: 'Device' },
  phone: { glyph: 'smartphone', group: 'object', label: 'Phone' },
  branch: { glyph: 'branch', group: 'object', label: 'Branch' },
  github: { glyph: 'github', group: 'object', label: 'GitHub' },
  time: { glyph: 'clock', group: 'object', label: 'Time' },
  calendar: { glyph: 'calendar', group: 'object', label: 'Calendar' },
  notification: { glyph: 'bell', group: 'object', label: 'Notification' },
  // brand
  'app-logo': { glyph: 'sparkles', group: 'brand', label: 'App logo' },
  'app-mark': { glyph: 'sparkles', group: 'brand', label: 'App mark' },
  'app-wordmark': { glyph: 'type', group: 'brand', label: 'App wordmark' },
  'plugin-logo': { glyph: 'package', group: 'brand', label: 'Plugin logo' },
  // badges
  'badge-status': { glyph: 'badge-dot', group: 'badge', label: 'Status badge' },
  'badge-count': { glyph: 'badge-pill', group: 'badge', label: 'Count badge' },
  'badge-new': { glyph: 'star', group: 'badge', label: 'New badge' },
});

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/* ================================================================== roles */

/** Every role: the semantic vocabulary, the extra roles given, then every framework glyph as a role of its own name. */
export function allRoles(extra = {}) {
  const out = {};
  for (const n of GLYPH_NAMES) out[n] = { glyph: n, group: 'glyph', label: n.replace(/-/g, ' ') };
  for (const [id, r] of Object.entries(ICON_ROLES)) out[id] = { ...r };
  for (const [id, r] of Object.entries(isObj(extra) ? extra : {})) {
    if (!ROLE_ID.test(id) || id.length > ICON_LIMITS.roleChars) continue;
    const q = isObj(r) ? r : typeof r === 'string' ? { glyph: r } : {};
    out[id] = { glyph: isGlyph(q.glyph) ? glyphName(q.glyph) : out[id]?.glyph ?? GLYPH_FALLBACK, group: ICON_ROLE_GROUPS.includes(q.group) ? q.group : out[id]?.group ?? 'object', label: str(q.label, ICON_LIMITS.labelChars) || out[id]?.label || id.replace(/-/g, ' ') };
  }
  return out;
}

/** The role a glyph name stands for when nothing declares one: the glyph's own name (aliases resolved), '' if unknown. */
export function roleForGlyph(name) {
  return glyphName(name) ?? '';
}

/** The glyph a role draws under a pack: the pack's role mapping, else the role's default, else the box. */
export function roleGlyph(role, roles = allRoles(), pack = null) {
  const mapped = isObj(pack?.roles) ? pack.roles[role] : undefined;
  if (typeof mapped === 'string' && mapped) return mapped;
  return roles[role]?.glyph ?? (isGlyph(role) ? glyphName(role) : GLYPH_FALLBACK);
}

/**
 * Which glyph name a place draws. `name` = what the code asked for; `slot` / `role` = the place; `overrides` = the
 * saved per-slot picks ({ slotId: glyph }); `pack` = the active icon-pack@1 data (its `roles` and `glyphs`).
 * Answers { glyph, via }: via = override | pack-role | pack-glyph | framework | fallback.
 */
export function resolveIcon({ name = '', slot = '', role = '', overrides = {}, pack = null, roles = null } = {}) {
  const ov = slot && isObj(overrides) ? overrides[slot] : undefined;
  if (typeof ov === 'string' && ov) return { glyph: ov, via: 'override' };
  const r = role || roleForGlyph(name);
  if (r && isObj(pack?.roles) && typeof pack.roles[r] === 'string' && pack.roles[r]) return { glyph: pack.roles[r], via: 'pack-role' };
  if (r && roles && roles[r] && !isGlyph(name) && !GLYPH_NAMES.includes(r)) return { glyph: roles[r].glyph, via: 'role' };
  if (name && isObj(pack?.glyphs) && pack.glyphs[name]) return { glyph: name, via: 'pack-glyph' };
  if (isGlyph(name)) return { glyph: glyphName(name), via: 'framework' };
  if (r && roles && roles[r]) return { glyph: roles[r].glyph, via: 'role' };
  return { glyph: GLYPH_FALLBACK, via: 'fallback' };
}

/* ================================================================== slots */

export const slotId = ({ app, owner, surface, name }) => `${slug(app)}/${slug(owner)}/${slug(surface)}/${String(name ?? '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)}`;

/** A slot, cleaned. `defaults` supply app / owner / ownerKind / source for declared ones. */
export function normalizeSlot(raw, defaults = {}) {
  const o = isObj(raw) ? raw : {};
  const app = slug(o.app ?? defaults.app ?? 'framework') || 'framework';
  const owner = slug(o.owner ?? defaults.owner ?? 'framework') || 'framework';
  const surface = ICON_SURFACES.includes(o.surface) ? o.surface : 'inline';
  const glyph = str(o.glyph ?? o.icon, 64);
  const name = str(o.name, 64) || slug(o.label) || glyph || 'icon';
  const id = SLOT_ID.test(str(o.id, ICON_LIMITS.idChars)) ? o.id : slotId({ app, owner, surface, name });
  const kind = ICON_SLOT_KINDS.includes(o.kind) ? o.kind : surface === 'badge' ? 'badge' : surface === 'logo' ? 'logo' : 'icon';
  const role = ROLE_ID.test(str(o.role, ICON_LIMITS.roleChars)) ? o.role : roleForGlyph(glyph) || (kind === 'badge' ? 'badge-status' : kind === 'logo' ? 'app-logo' : '');
  return {
    id, kind, role, glyph, surface,
    label: str(o.label, ICON_LIMITS.labelChars),
    app, owner,
    ownerKind: ICON_OWNER_KINDS.includes(o.ownerKind ?? defaults.ownerKind) ? (o.ownerKind ?? defaults.ownerKind) : owner === 'framework' ? 'framework' : owner === 'app' ? 'app' : 'plugin',
    screen: str(o.screen, 64),
    source: ICON_SOURCES.includes(o.source ?? defaults.source) ? (o.source ?? defaults.source) : 'code',
    file: str(o.file, 240),
    line: Number.isInteger(o.line) && o.line > 0 ? o.line : 0,
  };
}

export function slotErrors(raw, path = 'slot') {
  const e = [];
  if (!isObj(raw)) return [`${path} must be an object`];
  if (raw.id !== undefined && !SLOT_ID.test(String(raw.id))) e.push(`${path}.id "${raw.id}" must be <app>/<owner>/<surface>/<name> in lowercase words`);
  if (raw.surface !== undefined && !ICON_SURFACES.includes(raw.surface)) e.push(`${path}.surface must be one of: ${ICON_SURFACES.join(', ')}`);
  if (raw.kind !== undefined && !ICON_SLOT_KINDS.includes(raw.kind)) e.push(`${path}.kind must be one of: ${ICON_SLOT_KINDS.join(', ')}`);
  if (raw.role !== undefined && !ROLE_ID.test(String(raw.role))) e.push(`${path}.role "${raw.role}" must be lowercase words with dashes`);
  const glyph = raw.glyph ?? raw.icon;
  if (glyph !== undefined && typeof glyph !== 'string') e.push(`${path}.glyph must be a glyph name`);
  if (!raw.name && !raw.label && !glyph && !raw.id) e.push(`${path} needs a name, a label, a glyph or an id`);
  return e;
}

/**
 * plugin.json `icons` (icon-map@1), cleaned:
 *   "icons": { "$axf": "icon-map@1",
 *     "roles": { "sync-now": { "glyph": "refresh", "group": "action", "label": "Sync now" } },
 *     "slots": [ { "name": "sync", "surface": "toolbar", "role": "sync-now", "glyph": "refresh", "label": "Sync" } ],
 *     "pins":  { "refresh": "sync-now" } }        a glyph name the plugin's code uses → the role it means
 * Problems are listed (the lifecycle check reports them); unknown fields are dropped.
 */
export function normalizeIconsBlock(raw) {
  const errors = [];
  const block = { $axf: ICON_MAP_FRAME, roles: {}, slots: [], pins: {} };
  if (raw === undefined) return { block, errors, declared: false };
  if (!isObj(raw)) return { block, errors: ['icons must be an object ({ $axf: "icon-map@1", roles, slots, pins })'], declared: false };
  if (raw.$axf !== undefined && raw.$axf !== ICON_MAP_FRAME) errors.push(`icons.$axf must be ${ICON_MAP_FRAME}`);
  if (raw.roles !== undefined) {
    if (!isObj(raw.roles)) errors.push('icons.roles must be an object of role → { glyph, group, label }');
    else for (const [id, r] of Object.entries(raw.roles).slice(0, ICON_LIMITS.declaredRoles)) {
      if (!ROLE_ID.test(id)) { errors.push(`icons.roles.${id}: role ids are lowercase words with dashes`); continue; }
      const q = isObj(r) ? r : typeof r === 'string' ? { glyph: r } : null;
      if (!q) { errors.push(`icons.roles.${id} must be { glyph, group?, label? } or a glyph name`); continue; }
      if (!isGlyph(q.glyph)) errors.push(`icons.roles.${id}.glyph "${q.glyph}" is not a framework glyph`);
      if (q.group !== undefined && !ICON_ROLE_GROUPS.includes(q.group)) errors.push(`icons.roles.${id}.group must be one of: ${ICON_ROLE_GROUPS.join(', ')}`);
      block.roles[id] = { glyph: isGlyph(q.glyph) ? glyphName(q.glyph) : GLYPH_FALLBACK, group: ICON_ROLE_GROUPS.includes(q.group) ? q.group : 'object', label: str(q.label, ICON_LIMITS.labelChars) || id.replace(/-/g, ' ') };
    }
  }
  if (raw.slots !== undefined) {
    if (!Array.isArray(raw.slots)) errors.push('icons.slots must be an array');
    else raw.slots.slice(0, ICON_LIMITS.declaredSlots).forEach((s, i) => {
      const e = slotErrors(s, `icons.slots[${i}]`);
      errors.push(...e);
      if (!e.length) block.slots.push(s);
    });
  }
  if (raw.pins !== undefined) {
    if (!isObj(raw.pins)) errors.push('icons.pins must be an object of glyph name → role');
    else for (const [g, role] of Object.entries(raw.pins)) {
      if (!ROLE_ID.test(String(role))) { errors.push(`icons.pins.${g}: "${role}" is not a role id`); continue; }
      block.pins[g] = role;
    }
  }
  return { block, errors, declared: true };
}

/* ================================================================== scanning (text in, facts out) */

/** Surface words in code, nearest-first: the key or component the icon sits in → the surface it shows on. */
const SURFACE_HINTS = [
  [/\bcontextMenu\b|context-menu|ContextMenu/, 'context-menu'],
  [/\bsettingsTabs\b|\bsettingsPanels\b|\bsettings\b|SettingsTab|Settings →/, 'settings'],
  [/\bappMenu\b|\bmenu\b|menuLabel|MenuEntry|\bmenus?:/, 'menu'],
  [/\bnav\b|\bnav:|NavItem|nav-menu|navItems/, 'nav'],
  [/\btoolbar\b|Toolbar|toolbtn|ToolButton/, 'toolbar'],
  [/\bviews?\b\s*[:=]|\bviews?:|registerView|\bview:/, 'view'],
  [/\btabs?\b|TabGroup|\btab:/, 'tab'],
  [/\bbanner\b|Banner/, 'banner'],
  [/\bbadge\b|Badge/, 'badge'],
  [/\bwidget\b|Widget/, 'widget'],
  [/\bdialog\b|Dialog/, 'dialog'],
  [/EmptyState|\bempty\b/, 'empty-state'],
  [/\bstatus\b|\btone\b|Status/, 'status'],
  [/\bsteps?\b|Step/, 'step'],
  [/\bcolumns?\b|DataGrid|\bgrid\b/, 'grid'],
  [/<Container\b|\bCard\b|\bcard\b/, 'card'],
  [/<(?:Icon)?Button\b|IconButton|fx-btn|fx-iconbtn/, 'button'],
  [/<Icon\b/, 'inline'],
];

/** The surface word nearest BEFORE the icon (same line first, then the lines above): the key or component it sits in. */
function surfaceFor(before, line, col) {
  const near = `${before.slice(-220)}\n${line.slice(0, col)}`;
  let best = null;
  for (const [re, s] of SURFACE_HINTS) {
    let last = -1; const g = new RegExp(re.source, 'g'); let m;
    while ((m = g.exec(near))) last = m.index;
    if (last >= 0 && (!best || last > best.at)) best = { at: last, s };
  }
  return best?.s ?? 'inline';
}

const ID_RE = /\bid:\s*(['"`])([A-Za-z0-9_.:-]{1,64})\1/;
const LABEL_RE = /\b(?:label|title)(?::\s*|=)(['"`])((?:\\.|(?!\1)[^\\\n]){1,80})\1/;

/**
 * What the icon belongs to: the `id:` / `label:` / `title` of the object literal or JSX element it sits in (the segment
 * from the last `{` or `<` before it), the element's own text (`<Button icon="x">Save</Button>`), else an id or label
 * anywhere on the line or the line before.
 */
function nameNear(line, before, col) {
  const start = Math.max(line.lastIndexOf('{', col), line.lastIndexOf('<', col), 0);
  const seg = line.slice(start, col);
  const after = line.slice(col);
  const end = after.search(/[}>]/);
  const segAll = seg + (end >= 0 ? after.slice(0, end) : after);
  let m;
  if ((m = ID_RE.exec(segAll))) return { name: m[2].replace(/:/g, '-'), label: '' };
  if ((m = LABEL_RE.exec(segAll))) return { name: slug(m[2]), label: m[2] };
  if (line[start] === '<' && (m = /^[^<>]*>\s*([^<{}\n]{1,60}?)\s*</.exec(after)) && /[A-Za-z]/.test(m[1])) return { name: slug(m[1]), label: m[1].trim() };
  const win = `${before.split('\n').slice(-2).join('\n')}\n${line}`;
  if ((m = ID_RE.exec(line)) ?? (m = ID_RE.exec(win))) return { name: m[2].replace(/:/g, '-'), label: '' };
  if ((m = LABEL_RE.exec(line))) return { name: slug(m[2]), label: m[2] };
  return { name: '', label: '' };
}

/** A string-literal icon in code: `<Icon name="x">`, `icon: 'x'`, `icon="x"`, `iconName: 'x'`, `"icon": "x"`. */
const LITERAL = /(?:<Icon\b[^>]*?\bname=|\bicon(?:Name|Off|On|Ok|Warn|Error)?\s*[:=]\s*|"icon"\s*:\s*)(['"`])([a-z0-9][a-z0-9-]*)\1/g;

/**
 * Every literal icon name in a source file, with its line, the surface it sits on and the item it belongs to.
 * Lines with `icon-ok` are still listed (they are in the map) but marked `ok`.
 */
export function scanIconLiterals(text, file = '') {
  const src = String(text ?? '');
  const out = [];
  const lines = src.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    LITERAL.lastIndex = 0;
    let m;
    while ((m = LITERAL.exec(line))) {
      const before = src.slice(Math.max(0, offset - 600), offset);
      const { name, label } = nameNear(line, before, m.index);
      out.push({ glyph: m[2], line: i + 1, file, surface: surfaceFor(before, line, m.index + m[0].length), name, label, ok: line.includes(ICON_OK), known: isGlyph(m[2]) });
    }
    offset += line.length + 1;
  }
  return out;
}

/** An icon drawn without the Icon component: an inline `<svg` in JSX, or an emoji / dingbat used as a glyph. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F2FF}]/u;
export function scanRawIcons(text, file = '') {
  const src = String(text ?? '');
  const out = [];
  src.split('\n').forEach((line, i) => {
    if (line.includes(ICON_OK)) return;
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; // comments
    if (/<svg\b/.test(line)) out.push({ kind: 'svg', line: i + 1, file, text: t.slice(0, 100) });
    else if (EMOJI.test(line)) out.push({ kind: 'emoji', line: i + 1, file, text: t.slice(0, 100) });
  });
  return out;
}

/* ================================================================== deriving slots */

/** Icons inside an asset's data (menu items, toolbar buttons, badges, marks), by asset type. */
export function assetIconSlots(asset, defaults) {
  const type = String(asset?.type ?? '');
  const d = isObj(asset?.data) ? asset.data : {};
  const base = { ...defaults, source: 'asset', file: asset.file ?? '' };
  const out = [];
  const push = (o) => out.push(normalizeSlot({ ...base, ...o, screen: asset.id }, base));
  // items live under `items`, or grouped under sections / groups / menus / tabs (nav-menu, toolbar, app-menu, settings)
  const itemsOf = (o) => [...(Array.isArray(o?.items) ? o.items : []), ...['sections', 'groups', 'menus', 'tabs', 'buttons'].flatMap((k) => (Array.isArray(o?.[k]) ? o[k] : []))];
  const walkItems = (items, surface, depth = 0) => {
    if (!Array.isArray(items) || depth > 5) return;
    for (const it of items) {
      if (!isObj(it)) continue;
      if (typeof it.icon === 'string' && it.icon) push({ surface, glyph: it.icon, name: `${asset.id}.${it.id ?? slug(it.label) ?? it.icon}`, label: it.label ?? '' });
      walkItems([...itemsOf(it), ...(Array.isArray(it.children) ? it.children : [])], surface, depth + 1);
    }
  };
  switch (type) {
    case 'badge': push({ kind: 'badge', surface: 'badge', glyph: d.icon ?? 'star', name: asset.id, label: d.label ?? '', role: 'badge-status' }); break;
    case 'logo': case 'logo-mark': case 'animated-logo': push({ kind: 'logo', surface: 'logo', glyph: '', name: asset.id, label: d.brand ?? asset.name ?? '', role: d.form === 'wordmark' ? 'app-wordmark' : d.form === 'lockup' ? 'app-logo' : 'app-mark' }); break;
    case 'branding': for (const [k, v] of Object.entries(isObj(d.marks) ? d.marks : {})) if (typeof v === 'string' && v) push({ kind: 'logo', surface: 'logo', glyph: '', name: `${asset.id}.${k}`, label: `${d.brand?.name ?? asset.id} ${k}`, role: k === 'wordmark' ? 'app-wordmark' : k === 'mark' ? 'app-mark' : 'app-logo' }); break;
    case 'nav-menu': walkItems(itemsOf(d), 'nav'); break;
    case 'app-menu': walkItems(itemsOf(d), 'menu'); break;
    case 'context-menu': walkItems(itemsOf(d), 'context-menu'); break;
    case 'toolbar': walkItems(itemsOf(d), 'toolbar'); break;
    case 'settings': walkItems(itemsOf(d), 'settings'); break;
    case 'action-button': case 'link': case 'status': case 'counter': case 'label': case 'theme-switch':
      if (typeof d.icon === 'string' && d.icon) push({ surface: 'banner', glyph: d.icon, name: asset.id, label: d.label ?? asset.name ?? '' }); break;
    default: {
      // any other asset with an `icon` field (the attachables on banners and toolbars)
      if (typeof d.icon === 'string' && d.icon) push({ surface: 'widget', glyph: d.icon, name: asset.id, label: d.label ?? asset.name ?? '' });
      walkItems(itemsOf(d), 'widget');
    }
  }
  return out;
}

/** Icons a plugin.json itself names (tabable page icon, declared slots) and its `icons` block. */
export function manifestIconSlots(manifest, defaults) {
  const m = isObj(manifest) ? manifest : {};
  const { block } = normalizeIconsBlock(m.icons);
  const base = { ...defaults, source: 'manifest', file: defaults.manifestFile ?? 'plugin.json' };
  const out = block.slots.map((s) => normalizeSlot({ ...s, app: base.app, owner: base.owner, source: 'manifest', file: base.file }, base));
  if (isObj(m.tabable) && typeof m.tabable.icon === 'string') out.push(normalizeSlot({ surface: 'tab', glyph: m.tabable.icon, name: m.tabable.view ?? 'tab', label: m.tabable.label ?? m.name ?? '' }, base));
  return { slots: out, roles: block.roles, pins: block.pins };
}

/**
 * Every slot of one owner (a plugin, an app's own UI, or the framework): declared ones first (they pin ids and roles),
 * then the code's literals, then the assets. A declared slot whose `glyph` + `surface` (or `name`) matches a code
 * literal takes it over (one slot, the declared id); the rest are derived with ids from the code's own ids / labels.
 */
export function deriveSlots({ app, owner, ownerKind, manifest = null, manifestFile = '', sources = [], assets = [], roles = null } = {}) {
  const defaults = { app, owner, ownerKind, source: 'code', ...(manifestFile ? { manifestFile } : {}) };
  const declared = manifest ? manifestIconSlots(manifest, defaults) : { slots: [], roles: {}, pins: {} };
  const allR = roles ?? allRoles(declared.roles);
  const out = [...declared.slots];
  const taken = new Set(out.map((s) => s.id));
  const unknown = [];
  const claim = (s) => { let id = s.id; let n = 2; while (taken.has(id)) id = `${s.id}-${n++}`; taken.add(id); return { ...s, id }; };
  for (const src of sources) {
    for (const lit of scanIconLiterals(src.text, src.file)) {
      if (!lit.known) unknown.push({ glyph: lit.glyph, file: lit.file, line: lit.line, ok: lit.ok });
      const pinned = declared.pins[lit.glyph];
      // a declared slot on the same surface claims the first literal with its glyph or its name (then points at the code)
      const decl = out.find((d) => d.source === 'manifest' && d.line === 0 && d.surface === lit.surface && (d.glyph === lit.glyph || (lit.name && d.id.endsWith(`/${lit.name}`))));
      if (decl) { decl.file = lit.file; decl.line = lit.line; decl.screen = decl.screen || src.screen || ''; continue; }
      const role = pinned ?? (allR[lit.glyph] ? lit.glyph : roleForGlyph(lit.glyph)) ?? '';
      out.push(claim(normalizeSlot({ surface: lit.surface, glyph: lit.glyph, name: lit.name || lit.glyph, label: lit.label, role: role || undefined, file: lit.file, line: lit.line, screen: src.screen ?? '' }, defaults)));
    }
  }
  for (const a of assets) for (const s of assetIconSlots(a, defaults)) out.push(claim(s));
  return { slots: out.slice(0, ICON_LIMITS.slots), roles: declared.roles, unknown };
}

/* ================================================================== the map */

/**
 * The whole map from every owner's facts. `owners` = [{ app, owner, ownerKind, manifest?, sources, assets }].
 * Deterministic: the same files give the same map (no timestamps), so the snapshot in framework/schemas/icon-map.json
 * only changes when an icon does.
 */
export function buildIconMap(owners = []) {
  const roles = {};
  const slots = [];
  const problems = [];
  const unknown = [];
  for (const o of owners) {
    const { block, errors } = normalizeIconsBlock(o.manifest?.icons);
    for (const e of errors) problems.push(`${o.app}/${o.owner}: ${e}`);
    Object.assign(roles, block.roles);
  }
  const all = allRoles(roles);
  for (const o of owners) {
    const r = deriveSlots({ ...o, roles: all });
    slots.push(...r.slots);
    unknown.push(...r.unknown.map((u) => ({ ...u, app: o.app, owner: o.owner })));
  }
  slots.sort((a, b) => a.id.localeCompare(b.id));
  const counts = { slots: slots.length, byKind: {}, bySurface: {}, byApp: {}, byOwner: {}, roles: Object.keys(all).length, glyphs: GLYPH_NAMES.length };
  for (const s of slots) {
    counts.byKind[s.kind] = (counts.byKind[s.kind] ?? 0) + 1;
    counts.bySurface[s.surface] = (counts.bySurface[s.surface] ?? 0) + 1;
    counts.byApp[s.app] = (counts.byApp[s.app] ?? 0) + 1;
    counts.byOwner[`${s.app}/${s.owner}`] = (counts.byOwner[`${s.app}/${s.owner}`] ?? 0) + 1;
  }
  return {
    $axf: ICON_MAP_FRAME,
    kinds: [...ICON_SLOT_KINDS], surfaces: [...ICON_SURFACES], sources: [...ICON_SOURCES], groups: [...ICON_ROLE_GROUPS],
    glyphs: { names: [...GLYPH_NAMES], aliases: { ...GLYPH_ALIASES }, fallback: GLYPH_FALLBACK },
    roles: all,
    slots, counts, unknown, problems,
  };
}

export function iconMapErrors(map) {
  const e = [];
  if (!isObj(map)) return ['map must be an object'];
  if (map.$axf !== ICON_MAP_FRAME) e.push(`$axf must be ${ICON_MAP_FRAME}`);
  if (!Array.isArray(map.slots)) e.push('slots must be an array');
  else {
    const ids = new Set();
    map.slots.forEach((s, i) => {
      if (!SLOT_ID.test(String(s?.id))) e.push(`slots[${i}].id "${s?.id}" is not <app>/<owner>/<surface>/<name>`);
      if (ids.has(s?.id)) e.push(`slots[${i}].id "${s.id}" repeats`);
      ids.add(s?.id);
      if (!ICON_SURFACES.includes(s?.surface)) e.push(`slots[${i}].surface "${s?.surface}" unknown`);
      if (!ICON_SLOT_KINDS.includes(s?.kind)) e.push(`slots[${i}].kind "${s?.kind}" unknown`);
      if (s?.role && !ROLE_ID.test(s.role)) e.push(`slots[${i}].role "${s.role}" invalid`);
    });
  }
  if (!isObj(map.roles)) e.push('roles must be an object');
  return e;
}

/* ================================================================== the CI check */

/**
 * What fails CI (framework/cli/check-icons.mjs):
 *  - a literal icon name that is neither a framework glyph (or alias) nor a declared role: it draws the box; add the
 *    glyph to glyphs.mjs, declare the role in the plugin's `icons.roles`, or use a known name;
 *  - a raw icon (inline <svg>, emoji as a glyph) in UI code beyond the ratchet baseline (file → count, may only
 *    shrink; `--update-baseline` rewrites it after a fix); `icon-ok` on the line allows a deliberate one;
 *  - an `icons` block that does not validate.
 * `raws` = [{ file, kind, line }] from scanRawIcons over the UI files; `baseline` = { files: { file: count },
 * unknown: { file: count } }. `frozen` = patterns of files held to the baseline for unknown names too (vendored code
 * that is not being moved onto the framework's icons; check-theme's FROZEN list has the same idea).
 */
export function iconMapCheck(map, raws = [], baseline = { files: {}, unknown: {} }, { frozen = [] } = {}) {
  const failures = [];
  const warnings = [];
  const roles = isObj(map?.roles) ? map.roles : allRoles();
  const isFrozen = (file) => frozen.some((re) => (re instanceof RegExp ? re.test(file) : String(file).startsWith(String(re))));
  const unknownCounts = {};
  for (const u of map?.unknown ?? []) {
    if (u.ok || roles[u.glyph]) continue;
    if (isFrozen(u.file)) { unknownCounts[u.file] = (unknownCounts[u.file] ?? 0) + 1; continue; }
    failures.push(`${u.file}:${u.line}: icon "${u.glyph}" is not in the map (no framework glyph, alias or declared role): it draws the fallback box. Add it to framework/core/engines/glyphs.mjs, declare it in the plugin's icons.roles, or use a known name.`);
  }
  for (const p of map?.problems ?? []) failures.push(p);
  const counts = {};
  for (const r of raws) counts[r.file] = (counts[r.file] ?? 0) + 1;
  const base = isObj(baseline?.files) ? baseline.files : {};
  for (const [file, n] of Object.entries(counts)) {
    const allowed = base[file] ?? 0;
    if (n > allowed) {
      const examples = raws.filter((r) => r.file === file).slice(0, 3).map((r) => `${r.line} (${r.kind})`).join(', ');
      failures.push(`${file}: ${n} raw icon${n === 1 ? '' : 's'} (inline <svg> or emoji used as a glyph), baseline allows ${allowed}: lines ${examples}. Draw it with <Icon name="…"> (a slot in the map) or put icon-ok on the line with a reason.`);
    }
  }
  for (const [file, allowed] of Object.entries(base)) if ((counts[file] ?? 0) < allowed) warnings.push(`${file}: raw icons fell from ${allowed} to ${counts[file] ?? 0}; run --update-baseline to lock it in`);
  const baseU = isObj(baseline?.unknown) ? baseline.unknown : {};
  for (const [file, n] of Object.entries(unknownCounts)) if (n > (baseU[file] ?? 0)) failures.push(`${file}: ${n} unknown icon name${n === 1 ? '' : 's'} in frozen code, baseline allows ${baseU[file] ?? 0}`);
  for (const [file, allowed] of Object.entries(baseU)) if ((unknownCounts[file] ?? 0) < allowed) warnings.push(`${file}: unknown icon names fell from ${allowed} to ${unknownCounts[file] ?? 0}; run --update-baseline to lock it in`);
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const next = { $axf: 'icon-map-baseline@1', _doc: 'Ratchet for framework/cli/check-icons.mjs: raw icons (inline <svg>, emoji as glyphs) per UI file, and unknown icon names per frozen file. May only shrink; `node framework/cli/check-icons.mjs --update-baseline` rewrites it after a fix.', files: sorted(counts), unknown: sorted(unknownCounts) };
  return { ok: failures.length === 0, failures, warnings, baseline: next };
}

/* ================================================================== projections */

/** app → owner → surface → slots (the Icon map screen's tree). */
export function iconMapTree(map) {
  const apps = new Map();
  for (const s of map?.slots ?? []) {
    const a = apps.get(s.app) ?? { app: s.app, count: 0, owners: new Map() };
    apps.set(s.app, a);
    a.count++;
    const o = a.owners.get(s.owner) ?? { owner: s.owner, ownerKind: s.ownerKind, count: 0, surfaces: new Map() };
    a.owners.set(s.owner, o);
    o.count++;
    const su = o.surfaces.get(s.surface) ?? { surface: s.surface, slots: [] };
    o.surfaces.set(s.surface, su);
    su.slots.push(s);
  }
  return [...apps.values()].map((a) => ({ app: a.app, count: a.count, owners: [...a.owners.values()].map((o) => ({ owner: o.owner, ownerKind: o.ownerKind, count: o.count, surfaces: [...o.surfaces.values()] })) }));
}

/** Slots matching words and filters (app, owner, surface, kind, role, glyph). */
export function iconMapSearch(map, q = '', filters = {}) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return (map?.slots ?? []).filter((s) => {
    for (const k of ['app', 'owner', 'surface', 'kind', 'role', 'glyph', 'screen']) if (filters[k] && s[k] !== filters[k]) return false;
    if (!words.length) return true;
    const hay = `${s.id} ${s.label} ${s.role} ${s.glyph} ${s.screen} ${s.file}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The JSON Schemas of the contract (snapshotted in framework/schemas/icon-map.json). */
export function iconMapSchemas() {
  const id = { type: 'string', pattern: SLOT_ID.source };
  const role = { type: 'string', pattern: ROLE_ID.source };
  const roleDef = { type: 'object', properties: { glyph: { type: 'string' }, group: { enum: [...ICON_ROLE_GROUPS] }, label: { type: 'string' } }, required: ['glyph'], additionalProperties: false };
  const slot = {
    $id: 'icon-slot@1', type: 'object',
    properties: { id, kind: { enum: [...ICON_SLOT_KINDS] }, role, glyph: { type: 'string' }, surface: { enum: [...ICON_SURFACES] }, label: { type: 'string' }, app: { type: 'string' }, owner: { type: 'string' }, ownerKind: { enum: [...ICON_OWNER_KINDS] }, screen: { type: 'string' }, source: { enum: [...ICON_SOURCES] }, file: { type: 'string' }, line: { type: 'integer', minimum: 0 } },
    required: ['id', 'kind', 'surface', 'app', 'owner', 'ownerKind', 'source'], additionalProperties: false,
  };
  const icons = {
    $id: 'icon-map-manifest@1', type: 'object', description: 'plugin.json `icons`: the roles a plugin adds, the slots it declares (stable ids and roles for places the scan would otherwise name by glyph), and pins (glyph name → role).',
    properties: { $axf: { const: ICON_MAP_FRAME }, roles: { type: 'object', additionalProperties: roleDef }, slots: { type: 'array', items: { type: 'object', properties: { id, name: { type: 'string' }, label: { type: 'string' }, surface: { enum: [...ICON_SURFACES] }, kind: { enum: [...ICON_SLOT_KINDS] }, role, glyph: { type: 'string' }, screen: { type: 'string' } }, additionalProperties: false } }, pins: { type: 'object', additionalProperties: role } },
    additionalProperties: false,
  };
  const map = {
    $id: ICON_MAP_FRAME, type: 'object',
    properties: { $axf: { const: ICON_MAP_FRAME }, kinds: { type: 'array' }, surfaces: { type: 'array' }, sources: { type: 'array' }, groups: { type: 'array' }, glyphs: { type: 'object' }, roles: { type: 'object', additionalProperties: roleDef }, slots: { type: 'array', items: { $ref: 'icon-slot@1' } }, counts: { type: 'object' }, unknown: { type: 'array' }, problems: { type: 'array' } },
    required: ['$axf', 'roles', 'slots'],
  };
  const packRoles = { $id: 'icon-pack-roles@1', type: 'object', description: 'icon-pack@1 `roles`: role → the glyph name the pack draws for it (its own glyph or a framework one).', additionalProperties: { type: 'string' } };
  return { 'icon-slot.schema.json': slot, 'icon-map-manifest.schema.json': icons, 'icon-map.schema.json': map, 'icon-pack-roles.schema.json': packRoles };
}
