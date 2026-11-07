/**
 * Icon map + icon source rules — icon-map@1 and icon-source@1 (build icon-browser-manager, Brett, Nov 7 2026: "Every UI
 * and plugin gets an icon map (icon slots/tags -> icon). All of AmberX, Console, axHub, everything." … "Inheritance:
 * assign a pack to the whole app (root), or per UI, or per plugin. The child overrides the parent.").
 *
 *   icon-map     one scope's icons: the scope (an app root, one UI / screen, or one plugin), an icon-pack applied to
 *                the whole scope, and slot -> icon ref overrides. Slots are the icon names a UI asks the Icon component
 *                for (`save`, `chevron-down`; dotted tags such as `nav.builds` are allowed). A ref is a glyph name
 *                (`floppy-disk`), a glyph in one pack (`pack:lucide-1/floppy-disk`) or `none`.
 *   icon-source  where icons come from (local folder, HTTP, REST, MCP, FTP / SFTP, Google Drive, Google Photos,
 *                Dropbox, a known online repository …): kind, label, root / path, auth mode + a secret REFERENCE.
 *                A source never carries a secret: passwords, tokens and API keys live in the plugin's private store
 *                and are named here by `auth.secretRef` only (validation refuses raw secret fields).
 *
 * Resolution (`resolveIcon`): the chain is most specific first (plugin -> UI -> app root -> global). The first map with
 * the slot set wins (an alias to another name is followed, depth-capped); otherwise the first map in the chain with a
 * `pack` whose pack has the glyph; otherwise the active branding's pack (the pre-existing behaviour); otherwise the
 * framework glyph. A child never needs to repeat its parent: it only states what it changes.
 *
 * Plain JS so the TypeScript engines, the build engine's validator, the console server's Python-free scripts and the
 * CLI share ONE copy (no JSON imports: the lists are hard-coded here and spec/check-icon-map.mjs pins them to
 * asset-types.json). Pure: data in -> errors / normalized data / resolutions out. Randomize and Generate are seeded,
 * so the fixture replays them. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const ICON_MAP_TYPE = 'icon-map';
export const ICON_SOURCE_TYPE = 'icon-source';
export const ICON_MAP_CONTRACT = 'icon-map@1';
export const ICON_SOURCE_CONTRACT = 'icon-source@1';
export const ICON_LIBRARY_CONTRACT = 'icon-library@1';

/** Settings keys the runtime uses (appearance settings: they ride the hub look to every app). */
export const ICON_SETTING_PREFIX = 'axf.icons.';
/** `axf.icons.map.<scopeKey>` = the icon-map asset id picked for a scope. */
export const ICON_MAP_KEY = (scopeKey) => `${ICON_SETTING_PREFIX}map.${scopeKey}`;
/** `axf.icons.slots.<scopeKey>` = { slot: ref } overrides applied on top of the picked map (Apply without saving). */
export const ICON_SLOTS_KEY = (scopeKey) => `${ICON_SETTING_PREFIX}slots.${scopeKey}`;
/** `axf.icons.pack.<scopeKey>` = an icon-pack id applied to a scope without a map. */
export const ICON_PACK_KEY = (scopeKey) => `${ICON_SETTING_PREFIX}pack.${scopeKey}`;

export const ICON_SCOPE_KINDS = ['app', 'ui', 'plugin'];
export const ICON_REF_KINDS = ['name', 'pack', 'none'];
export const ICON_MAP_LIMITS = { slots: 2000, slotChars: 64, refChars: 160, idChars: 64, aliasDepth: 4, tags: 12 };

export const SLOT_NAME = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;
export const GLYPH_NAME = /^[a-z][a-z0-9-]*$/;
export const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const APP_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/* ================================================================== icon sources: an open registry of kinds */

/** Field spec: { id, label, kind: text | number | password-ref | path | url | select, options?, required?, about? }. */
const BUILTIN_SOURCE_KINDS = [
  { id: 'local', label: 'Local folder', icon: 'folder', about: 'A folder on this machine (SVG files or icon-pack assets).', fields: [{ id: 'root', label: 'Folder', kind: 'path', required: true }], auth: ['none'] },
  { id: 'http', label: 'HTTP / online', icon: 'cloud', about: 'A URL that serves SVG files, an icon-pack asset or a zip of them.', fields: [{ id: 'root', label: 'URL', kind: 'url', required: true }], auth: ['none', 'basic', 'token', 'apikey'] },
  { id: 'rest', label: 'REST API', icon: 'code', about: 'An API that lists and serves icons (base URL + list and get paths).', fields: [{ id: 'root', label: 'Base URL', kind: 'url', required: true }, { id: 'listPath', label: 'List path', kind: 'text' }, { id: 'getPath', label: 'Icon path', kind: 'text', about: '{name} is replaced by the icon name' }], auth: ['none', 'basic', 'token', 'apikey'] },
  { id: 'mcp', label: 'MCP server', icon: 'terminal', about: 'An MCP server with an icon list / get tool.', fields: [{ id: 'root', label: 'Server URL or command', kind: 'text', required: true }, { id: 'listTool', label: 'List tool', kind: 'text' }, { id: 'getTool', label: 'Get tool', kind: 'text' }], auth: ['none', 'token'] },
  { id: 'ftp', label: 'FTP', icon: 'upload', about: 'An FTP server and the root folder to read.', fields: [{ id: 'host', label: 'Host', kind: 'text', required: true }, { id: 'port', label: 'Port', kind: 'number' }, { id: 'user', label: 'User', kind: 'text' }, { id: 'root', label: 'Root folder', kind: 'path', required: true }], auth: ['password'] },
  { id: 'sftp', label: 'SFTP', icon: 'lock', about: 'An SFTP server (password or key) and the root folder to read.', fields: [{ id: 'host', label: 'Host', kind: 'text', required: true }, { id: 'port', label: 'Port', kind: 'number' }, { id: 'user', label: 'User', kind: 'text', required: true }, { id: 'root', label: 'Root folder', kind: 'path', required: true }], auth: ['password', 'key'] },
  { id: 'gdrive', label: 'Google Drive folder', icon: 'cloud', about: 'A Google Drive folder (folder id or link).', fields: [{ id: 'root', label: 'Folder id or link', kind: 'text', required: true }], auth: ['oauth'] },
  { id: 'gphotos', label: 'Google Photos album', icon: 'eye', about: 'A Google Photos album (album id or link).', fields: [{ id: 'root', label: 'Album id or link', kind: 'text', required: true }], auth: ['oauth'] },
  { id: 'dropbox', label: 'Dropbox folder', icon: 'box', about: 'A Dropbox folder path.', fields: [{ id: 'root', label: 'Folder path', kind: 'path', required: true }], auth: ['oauth', 'token'] },
  { id: 'repo', label: 'Known icon repository', icon: 'package', about: 'One of the known online icon repositories (framework/schemas/icon-repos.json): what it needs is shown per repository.', fields: [{ id: 'root', label: 'Repository id', kind: 'text', required: true }], auth: ['none', 'token', 'apikey'] },
];
const sourceKinds = new Map(BUILTIN_SOURCE_KINDS.map((k) => [k.id, k]));

/** Add a source kind (a plugin's own connector). Built-ins never change; the list never shrinks. */
export function registerIconSourceKind(k) {
  if (!k || typeof k.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(k.id)) throw new Error('an icon source kind needs an id (lowercase, up to 40)');
  if (BUILTIN_SOURCE_KINDS.some((b) => b.id === k.id)) return sourceKinds.get(k.id);
  sourceKinds.set(k.id, { label: k.id, icon: 'box', about: '', fields: [], auth: ['none'], ...k, host: true });
  return sourceKinds.get(k.id);
}
export const iconSourceKinds = () => [...sourceKinds.values()];
export const iconSourceKindIds = () => [...sourceKinds.keys()];

export const ICON_AUTH_MODES = ['none', 'basic', 'password', 'key', 'token', 'apikey', 'oauth'];
/** Field names that are secrets wherever they appear in a source: refused, they belong in the secure store. */
export const SECRET_FIELD_NAMES = ['password', 'pass', 'passwd', 'token', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token', 'apikey', 'api_key', 'secret', 'clientsecret', 'client_secret', 'privatekey', 'private_key', 'key'];
export const ICON_SOURCE_LIMITS = { label: 80, root: 1000, options: 24, optionChars: 1000, secretRef: 120 };
export const ICON_SOURCE_FORMATS = ['auto', 'svg', 'icon-pack', 'zip'];

/* ================================================================== helpers */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const tagsOf = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string').slice(0, ICON_MAP_LIMITS.tags) : []);

/* ================================================================== icon refs */

/** Parse an icon ref: `name`, `pack:<packId>/<glyph>` or `none`. null = not a ref. */
export function parseIconRef(ref) {
  if (typeof ref !== 'string' || !ref || ref.length > ICON_MAP_LIMITS.refChars) return null;
  if (ref === 'none') return { kind: 'none', glyph: '', pack: '' };
  if (ref.startsWith('pack:')) {
    const body = ref.slice(5); const i = body.indexOf('/');
    if (i <= 0) return null;
    const pack = body.slice(0, i); const glyph = body.slice(i + 1);
    if (!ASSET_ID.test(pack) || !GLYPH_NAME.test(glyph)) return null;
    return { kind: 'pack', pack, glyph };
  }
  return GLYPH_NAME.test(ref) ? { kind: 'name', glyph: ref, pack: '' } : null;
}

/** The string form of a parsed ref. */
export function iconRef(r) {
  if (!r || r.kind === 'none') return 'none';
  return r.kind === 'pack' ? `pack:${r.pack}/${r.glyph}` : r.glyph;
}

/* ================================================================== icon-map@1 */

/** The settings scope key of a map's scope: `app`, `ui:<id>` or `plugin:<id>`. */
export function iconScopeKey(scope) {
  const s = normalizeScope(scope);
  if (s.plugin) return `plugin:${s.plugin}`;
  if (s.ui) return `ui:${s.ui}`;
  return 'app';
}

/** Which kind of scope a map has: plugin (most specific), ui, or app (the root). */
export function iconScopeKind(scope) {
  const s = normalizeScope(scope);
  return s.plugin ? 'plugin' : s.ui ? 'ui' : 'app';
}

/** The chain of scope keys from most specific to the root for one place in an app (`plugin` / `ui` may be empty). */
export function iconScopeChain(scope) {
  const s = normalizeScope(scope);
  const out = [];
  if (s.plugin) out.push(`plugin:${s.plugin}`);
  if (s.ui) out.push(`ui:${s.ui}`);
  out.push('app');
  return out;
}

export function normalizeScope(raw) {
  const o = isObj(raw) ? raw : {};
  return { app: APP_ID.test(str(o.app, 64)) ? str(o.app, 64) : '', ui: APP_ID.test(str(o.ui, 64)) ? str(o.ui, 64) : '', plugin: APP_ID.test(str(o.plugin, 120)) ? str(o.plugin, 120) : '' };
}

export function normalizeIconMap(raw) {
  const o = isObj(raw) ? raw : {};
  const slots = {};
  if (isObj(o.slots)) {
    for (const [slot, ref] of Object.entries(o.slots).slice(0, ICON_MAP_LIMITS.slots)) {
      if (!SLOT_NAME.test(slot) || slot.length > ICON_MAP_LIMITS.slotChars) continue;
      const r = parseIconRef(ref);
      if (r) slots[slot] = iconRef(r);
    }
  }
  return {
    scope: normalizeScope(o.scope),
    extends: ASSET_ID.test(str(o.extends, 64)) ? str(o.extends, 64) : '',
    pack: ASSET_ID.test(str(o.pack, 64)) ? str(o.pack, 64) : '',
    slots,
    tags: tagsOf(o.tags),
  };
}

/** Errors in an icon-map@1 data block (empty = valid). Other types answer []. */
export function iconMapErrors(type, data) {
  if (type !== ICON_MAP_TYPE) return [];
  const e = [];
  if (!isObj(data)) return ['data must be an object'];
  if (!isObj(data.scope)) e.push('data.scope must be an object { app, ui?, plugin? }');
  else {
    const s = data.scope;
    if (s.app !== undefined && (typeof s.app !== 'string' || (s.app && !APP_ID.test(s.app)))) e.push('data.scope.app must be an app id (lowercase, dots, dashes) or ""');
    if (s.ui !== undefined && (typeof s.ui !== 'string' || (s.ui && !APP_ID.test(s.ui)))) e.push('data.scope.ui must be a view / screen id or ""');
    if (s.plugin !== undefined && (typeof s.plugin !== 'string' || (s.plugin && !APP_ID.test(s.plugin)))) e.push('data.scope.plugin must be a plugin id or ""');
    for (const k of Object.keys(s)) if (!['app', 'ui', 'plugin'].includes(k)) e.push(`data.scope.${k}: unknown field (app, ui, plugin)`);
  }
  if (data.extends !== undefined && (typeof data.extends !== 'string' || (data.extends && !ASSET_ID.test(data.extends)))) e.push('data.extends must be an icon-map id or ""');
  if (data.pack !== undefined && (typeof data.pack !== 'string' || (data.pack && !ASSET_ID.test(data.pack)))) e.push('data.pack must be an icon-pack id or ""');
  if (data.slots === undefined) e.push('data.slots is required (an object of slot → icon ref; {} is fine)');
  else if (!isObj(data.slots)) e.push('data.slots must be an object of slot → icon ref');
  else {
    const names = Object.keys(data.slots);
    if (names.length > ICON_MAP_LIMITS.slots) e.push(`data.slots: at most ${ICON_MAP_LIMITS.slots} slots`);
    for (const slot of names) {
      if (!SLOT_NAME.test(slot) || slot.length > ICON_MAP_LIMITS.slotChars) e.push(`data.slots.${slot}: slots are lowercase words with dashes, dotted tags allowed`);
      const ref = data.slots[slot];
      if (!parseIconRef(ref)) e.push(`data.slots.${slot}: a ref is a glyph name, pack:<pack id>/<glyph> or none`);
    }
  }
  return e;
}

/* ================================================================== icon-source@1 */

export function normalizeIconSource(raw) {
  const o = isObj(raw) ? raw : {};
  const kind = sourceKinds.has(o.kind) ? o.kind : 'local';
  const spec = sourceKinds.get(kind);
  const a = isObj(o.auth) ? o.auth : {};
  const mode = ICON_AUTH_MODES.includes(a.mode) ? a.mode : (spec.auth[0] ?? 'none');
  const options = {};
  if (isObj(o.options)) for (const [k, v] of Object.entries(o.options).slice(0, ICON_SOURCE_LIMITS.options)) { if (isSecretName(k)) continue; options[k] = typeof v === 'string' ? v.slice(0, ICON_SOURCE_LIMITS.optionChars) : typeof v === 'number' || typeof v === 'boolean' ? v : ''; }
  return {
    kind,
    label: str(o.label, ICON_SOURCE_LIMITS.label),
    root: str(o.root, ICON_SOURCE_LIMITS.root),
    auth: { mode, secretRef: mode === 'none' ? '' : str(a.secretRef, ICON_SOURCE_LIMITS.secretRef) },
    options,
    format: ICON_SOURCE_FORMATS.includes(o.format) ? o.format : 'auto',
    enabled: o.enabled !== false,
    tags: tagsOf(o.tags),
  };
}

export const isSecretName = (k) => SECRET_FIELD_NAMES.includes(String(k).toLowerCase().replace(/[-\s]/g, ''));

/** Errors in an icon-source@1 data block (empty = valid). Other types answer []. */
export function iconSourceErrors(type, data) {
  if (type !== ICON_SOURCE_TYPE) return [];
  const e = [];
  if (!isObj(data)) return ['data must be an object'];
  if (!sourceKinds.has(data.kind)) e.push(`data.kind must be one of: ${iconSourceKindIds().join(', ')}`);
  const spec = sourceKinds.get(data.kind);
  if (typeof data.root !== 'string' || !data.root.trim()) e.push('data.root is required (folder, URL, id or path)');
  if (data.auth !== undefined) {
    if (!isObj(data.auth)) e.push('data.auth must be an object { mode, secretRef? }');
    else {
      if (!ICON_AUTH_MODES.includes(data.auth.mode)) e.push(`data.auth.mode must be one of: ${ICON_AUTH_MODES.join(', ')}`);
      else if (spec && !spec.auth.includes(data.auth.mode)) e.push(`data.auth.mode ${data.auth.mode} is not one a ${spec.label} source takes (${spec.auth.join(', ')})`);
      if (data.auth.mode && data.auth.mode !== 'none' && (typeof data.auth.secretRef !== 'string' || !data.auth.secretRef)) e.push('data.auth.secretRef is required when auth.mode is not none: the id of the secret in the secure store');
      for (const k of Object.keys(data.auth)) if (isSecretName(k)) e.push(`data.auth.${k}: secrets never go in an asset; save it in the secure store and name it by auth.secretRef`);
    }
  } else if (spec && !spec.auth.includes('none')) e.push(`data.auth is required: a ${spec.label} source needs ${spec.auth.join(' or ')} auth`);
  for (const k of Object.keys(data)) if (isSecretName(k)) e.push(`data.${k}: secrets never go in an asset; save it in the secure store and name it by auth.secretRef`);
  if (data.options !== undefined) {
    if (!isObj(data.options)) e.push('data.options must be an object');
    else for (const k of Object.keys(data.options)) if (isSecretName(k)) e.push(`data.options.${k}: secrets never go in an asset; save it in the secure store and name it by auth.secretRef`);
  }
  if (spec) for (const f of spec.fields) if (f.required && f.id !== 'root' && (data.options === undefined || !isObj(data.options) || data.options[f.id] === undefined || data.options[f.id] === '')) e.push(`data.options.${f.id} is required for a ${spec.label} source`);
  if (data.format !== undefined && !ICON_SOURCE_FORMATS.includes(data.format)) e.push(`data.format must be one of: ${ICON_SOURCE_FORMATS.join(', ')}`);
  return e;
}

/* ================================================================== resolution */

/**
 * Resolve one icon name through a chain of maps.
 *   chain    maps most specific first: [{ id, data: icon-map data, slots?: extra overrides (settings) }]
 *   lookup   { hasGlyph(packId, glyph) → boolean, brandingPack?: string }
 * Answers { glyph, pack, via, from } where via = slot | pack | branding | framework | none.
 */
export function resolveIcon(name, chain, lookup = {}) {
  const has = typeof lookup.hasGlyph === 'function' ? lookup.hasGlyph : () => false;
  const maps = (Array.isArray(chain) ? chain : []).map((m) => ({ id: str(m?.id, 64), data: normalizeIconMap(m?.data), extra: isObj(m?.slots) ? m.slots : {} }));
  let current = GLYPH_NAME.test(name) || SLOT_NAME.test(name) ? name : '';
  if (!current) return { glyph: '', pack: '', via: 'none', from: '' };
  const seen = new Set();
  for (let depth = 0; depth <= ICON_MAP_LIMITS.aliasDepth; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    let hit = null;
    for (const m of maps) {
      const raw = m.extra[current] !== undefined ? m.extra[current] : m.data.slots[current];
      const r = raw === undefined ? null : parseIconRef(raw);
      if (r) { hit = { r, from: m.id }; break; }
    }
    if (!hit) break;
    if (hit.r.kind === 'none') return { glyph: '', pack: '', via: 'none', from: hit.from };
    if (hit.r.kind === 'pack') return has(hit.r.pack, hit.r.glyph) ? { glyph: hit.r.glyph, pack: hit.r.pack, via: 'slot', from: hit.from } : { glyph: hit.r.glyph, pack: '', via: 'slot', from: hit.from };
    if (hit.r.glyph === current) return { glyph: current, pack: '', via: 'slot', from: hit.from }; // pinned to its own name: stop here
    current = hit.r.glyph; // an alias: resolve the new name through the chain again
  }
  if (!GLYPH_NAME.test(current)) return { glyph: '', pack: '', via: 'none', from: '' };
  for (const m of maps) if (m.data.pack && has(m.data.pack, current)) return { glyph: current, pack: m.data.pack, via: 'pack', from: m.id };
  if (lookup.brandingPack && has(lookup.brandingPack, current)) return { glyph: current, pack: lookup.brandingPack, via: 'branding', from: '' };
  return { glyph: current, pack: '', via: 'framework', from: '' };
}

/** Fold a map with everything it extends into one (child first, parents fill what it leaves unset). */
export function foldIconMap(id, byId, depth = 0) {
  const a = byId?.[id];
  if (!a || depth > 8) return null;
  const d = normalizeIconMap(a.data ?? a);
  if (!d.extends || d.extends === id) return d;
  const parent = foldIconMap(d.extends, byId, depth + 1);
  if (!parent) return d;
  return { ...d, pack: d.pack || parent.pack, slots: { ...parent.slots, ...d.slots }, extends: parent.extends };
}

/** Where each slot's icon comes from, for a whole set of names: a table the manager shows. */
export function explainIcons(names, chain, lookup) {
  const out = {};
  for (const n of names) out[n] = resolveIcon(n, chain, lookup);
  return out;
}

/* ================================================================== randomize + cohesive generation */

/** A small deterministic generator (mulberry32) so a seed replays the same shuffle in the fixture. */
export function seededRandom(seed) {
  let a = 0;
  const s = String(seed ?? '');
  for (let i = 0; i < s.length; i++) a = (a * 31 + s.charCodeAt(i)) >>> 0;
  a = (a || 0x9e3779b9) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Synonyms: what other sets call the framework's icon names. An open table (registerIconSynonyms adds; never shrinks).
 * Used by Generate (a cohesive pack) and Randomize (same meaning, another drawing).
 */
const SYNONYMS = {
  home: ['house', 'home-2'],
  settings: ['cog', 'gear', 'settings-2', 'sliders-horizontal'],
  save: ['floppy-disk', 'device-floppy', 'save-2'],
  trash: ['trash-2', 'delete', 'bin', 'trash-can'],
  search: ['magnifying-glass', 'zoom', 'search-2'],
  user: ['person', 'account', 'user-round', 'user-circle'],
  file: ['document', 'file-text', 'page'],
  folder: ['folder-open', 'directory'],
  edit: ['pencil', 'pen', 'edit-2', 'edit-3'],
  copy: ['duplicate', 'clipboard', 'files'],
  check: ['tick', 'checkmark', 'check-2'],
  x: ['close', 'cross', 'times', 'x-mark'],
  plus: ['add', 'plus-2'],
  minus: ['remove', 'subtract', 'dash'],
  info: ['info-circle', 'information', 'circle-info'],
  help: ['question', 'help-circle', 'circle-help', 'question-mark-circle'],
  alert: ['warning', 'alert-triangle', 'triangle-alert', 'exclamation-triangle'],
  bell: ['notification', 'notifications', 'bell-ring'],
  lock: ['padlock', 'lock-closed'],
  key: ['key-round', 'password'],
  eye: ['view', 'visibility', 'eye-open'],
  star: ['favorite', 'favourite', 'star-outline'],
  refresh: ['reload', 'rotate-cw', 'refresh-cw', 'arrow-path', 'arrows-clockwise'],
  download: ['arrow-down-tray', 'cloud-download', 'download-2'],
  upload: ['arrow-up-tray', 'cloud-upload', 'upload-2'],
  menu: ['hamburger', 'bars-3', 'menu-2', 'list'],
  more: ['ellipsis', 'dots', 'more-horizontal', 'dots-horizontal', 'ellipsis-horizontal'],
  grid: ['layout-grid', 'squares-2x2', 'grid-4x4', 'apps', 'grid-dots'],
  list: ['list-bullet', 'list-ul', 'list-details'],
  layers: ['stack', 'square-3-stack-3d', 'stack-2'],
  code: ['code-2', 'code-bracket', 'brackets'],
  terminal: ['command-line', 'console', 'terminal-2', 'terminal-window'],
  play: ['play-circle', 'player-play'],
  pause: ['pause-circle', 'player-pause'],
  clock: ['time', 'watch', 'clock-hour-4'],
  calendar: ['calendar-days', 'calendar-event'],
  mic: ['microphone', 'mic-2'],
  chart: ['bar-chart', 'chart-bar', 'bar-chart-2', 'analytics'],
  cloud: ['cloud-2', 'weather-cloud'],
  monitor: ['desktop', 'computer-desktop', 'device-desktop', 'screen'],
  smartphone: ['phone', 'device-phone-mobile', 'device-mobile', 'mobile'],
  package: ['box', 'archive', 'cube'],
  external: ['external-link', 'arrow-top-right-on-square', 'open-in-new'],
  shield: ['shield-check', 'security'],
  zap: ['bolt', 'lightning', 'flash'],
  palette: ['color-swatch', 'swatch', 'paint'],
  type: ['typography', 'text', 'font'],
  sun: ['light-mode', 'brightness'],
  moon: ['dark-mode', 'night'],
  shuffle: ['arrows-shuffle', 'random'],
  move: ['arrows-move', 'drag'],
  grip: ['grip-vertical', 'drag-handle', 'grip-horizontal'],
  rocket: ['launch', 'rocket-launch'],
  hammer: ['tool', 'build', 'wrench'],
  branch: ['git-branch', 'git-fork'],
  logout: ['log-out', 'sign-out', 'arrow-right-on-rectangle'],
  sparkles: ['sparkle', 'magic', 'wand'],
  keyboard: ['keyboard-2'],
  box: ['cube', 'package-2'],
  layout: ['layout-dashboard', 'template', 'layout-2'],
  sliders: ['adjustments', 'adjustments-horizontal', 'settings-sliders', 'sliders-horizontal'],
  'chevron-right': ['caret-right', 'angle-right'],
  'chevron-left': ['caret-left', 'angle-left'],
  'chevron-down': ['caret-down', 'angle-down'],
  'chevron-up': ['caret-up', 'angle-up'],
  'arrow-left': ['arrow-narrow-left', 'arrow-left-long'],
  'arrow-right': ['arrow-narrow-right', 'arrow-right-long'],
  'check-circle': ['circle-check', 'badge-check'],
  'x-circle': ['circle-x', 'close-circle'],
  minimize: ['minimize-2', 'window-minimize'],
  maximize: ['maximize-2', 'window-maximize', 'expand'],
  restore: ['copy', 'window-restore'],
  undo: ['undo-2', 'arrow-uturn-left', 'arrow-back-up'],
  redo: ['redo-2', 'arrow-uturn-right', 'arrow-forward-up'],
  cut: ['scissors'],
  paste: ['clipboard-paste', 'clipboard-document'],
  github: ['brand-github', 'git'],
};
const synonyms = new Map(Object.entries(SYNONYMS));
export function registerIconSynonyms(name, words) {
  if (!GLYPH_NAME.test(String(name))) throw new Error('a synonym entry needs an icon name');
  const cur = synonyms.get(name) ?? [];
  synonyms.set(name, [...new Set([...cur, ...(Array.isArray(words) ? words.filter((w) => GLYPH_NAME.test(String(w))) : [])])]);
  return synonyms.get(name);
}
export const iconSynonyms = (name) => [...(synonyms.get(name) ?? [])];
export const iconSynonymTable = () => Object.fromEntries([...synonyms.entries()].map(([k, v]) => [k, [...v]]));

/** The glyph a pack has for a name: the name itself, else the first synonym it has, else ''. */
export function matchGlyph(name, packId, has) {
  if (has(packId, name)) return name;
  for (const s of synonyms.get(name) ?? []) if (has(packId, s)) return s;
  return '';
}

/**
 * Generate a cohesive map: every name drawn from ONE pack (or an ordered list of packs of one style), by name or
 * synonym; names no pack covers stay unset (they fall back). Answers { data, covered, missing }.
 */
export function generateCohesiveMap(names, packIds, lookup, scope = {}) {
  const has = typeof lookup?.hasGlyph === 'function' ? lookup.hasGlyph : () => false;
  const packs = (Array.isArray(packIds) ? packIds : [packIds]).filter((p) => ASSET_ID.test(String(p)));
  const slots = {}; const covered = []; const missing = [];
  for (const n of [...new Set((names ?? []).filter((x) => GLYPH_NAME.test(String(x))))].sort()) {
    let done = false;
    for (const p of packs) { const g = matchGlyph(n, p, has); if (g) { slots[n] = `pack:${p}/${g}`; covered.push(n); done = true; break; } }
    if (!done) missing.push(n);
  }
  return { data: { scope: normalizeScope(scope), extends: '', pack: packs[0] ?? '', slots, tags: ['generated', 'cohesive'] }, covered, missing };
}

/**
 * Randomize: for each name pick a random drawing of the same meaning from any pack that has it (by name or synonym);
 * seeded so the fixture replays it. Names only the framework has stay unset. Answers { data, changed, kept }.
 */
export function randomizeMap(names, packIds, lookup, seed = 'axf', scope = {}) {
  const has = typeof lookup?.hasGlyph === 'function' ? lookup.hasGlyph : () => false;
  const packs = (Array.isArray(packIds) ? packIds : []).filter((p) => ASSET_ID.test(String(p)));
  const rnd = seededRandom(seed);
  const slots = {}; const changed = []; const kept = [];
  for (const n of [...new Set((names ?? []).filter((x) => GLYPH_NAME.test(String(x))))].sort()) {
    const choices = [];
    for (const p of packs) { if (has(p, n)) choices.push(`pack:${p}/${n}`); for (const s of synonyms.get(n) ?? []) if (has(p, s)) choices.push(`pack:${p}/${s}`); }
    if (!choices.length) { kept.push(n); continue; }
    slots[n] = choices[Math.floor(rnd() * choices.length)];
    changed.push(n);
  }
  return { data: { scope: normalizeScope(scope), extends: '', pack: '', slots, tags: ['generated', 'random', `seed:${String(seed).slice(0, 24)}`] }, changed, kept };
}

/* ================================================================== the global "every icon" pack */

/** Every glyph of every pack as one listing: [{ name, pack, ref }], sorted, for the manager's global pack view. */
export function allIcons(packs) {
  const out = [];
  for (const p of Array.isArray(packs) ? packs : []) {
    const id = str(p?.id, 64); const glyphs = isObj(p?.data?.glyphs) ? p.data.glyphs : {};
    if (!ASSET_ID.test(id)) continue;
    for (const name of Object.keys(glyphs)) if (GLYPH_NAME.test(name)) out.push({ name, pack: id, ref: `pack:${id}/${name}` });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : 0));
}

/* ================================================================== JSON Schema (the build engine's generated schemas) */

export function iconMapSchemaProperties() {
  return {
    scope: { type: 'object', properties: { app: { type: 'string' }, ui: { type: 'string' }, plugin: { type: 'string' } }, additionalProperties: false, description: 'app = the root scope; ui = one screen; plugin = one plugin (the most specific). A child overrides its parent.' },
    extends: { type: 'string', description: 'an icon-map id this one inherits from' },
    pack: { type: 'string', description: 'an icon-pack id applied to the whole scope: every name the pack has is drawn from it unless a slot says otherwise' },
    slots: { type: 'object', additionalProperties: { type: 'string', maxLength: ICON_MAP_LIMITS.refChars }, description: 'slot (icon name or dotted tag) → ref: a glyph name, pack:<pack id>/<glyph>, or none' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: ICON_MAP_LIMITS.tags },
  };
}

export function iconSourceSchemaProperties() {
  return {
    kind: { enum: iconSourceKindIds() },
    label: { type: 'string', maxLength: ICON_SOURCE_LIMITS.label },
    root: { type: 'string', maxLength: ICON_SOURCE_LIMITS.root, description: 'folder, URL, id or path, by kind' },
    auth: { type: 'object', required: ['mode'], properties: { mode: { enum: ICON_AUTH_MODES }, secretRef: { type: 'string', maxLength: ICON_SOURCE_LIMITS.secretRef, description: 'the id of the secret in the secure store; the secret itself never goes here' } }, additionalProperties: false },
    options: { type: 'object', description: 'kind-specific fields (host, port, user, listPath …); never a secret' },
    format: { enum: ICON_SOURCE_FORMATS },
    enabled: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: ICON_MAP_LIMITS.tags },
  };
}
