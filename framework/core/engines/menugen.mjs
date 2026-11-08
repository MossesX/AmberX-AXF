/**
 * Nested menu generator (nested-menu@1; Brett, Nov 8 2026: "navigation and application menu for console with
 * subcategories. That's just way too long… generate new nested menus the same exact way [for AmberX, Molly, the
 * console] and override the shared [menus]").
 *
 * ONE pure function turns an app's UI registry (every page, dialog, settings tab, menu action, live list and the
 * plugin that brought it) into slim nested menus: categories → sub categories → items, at most `maxPerLevel` rows on
 * any level (default 12), favourites and recents on top, and a flat index for search / jump-to. The same engine
 * produces the application menu (`app-menu` asset data) and the navigation (`nav-menu` asset data, nav-style@1 sub
 * menus that slide open), so the Dev Console, AmberX and Molly get their menus generated the same exact way; a new
 * plugin shows up in the right category the moment it is installed, because the registry is read at run time
 * (framework/react/generatedMenus.tsx) or from the app's files (framework/cli/menu-gen.mjs).
 *
 * How an entry finds its category: an explicit `category` on the source wins (a plugin may declare one), else the
 * words of its id, label, keywords, module and the menu or nav section it came from are matched against every
 * category's word list (MENU_CATEGORIES); the category with most hits wins, ties go to the earlier category, nothing
 * matched lands in "More". Sub categories: an explicit `subcategory`, else (only when a level is over the cap) the
 * plugin that brought several entries becomes a sub menu, then kinds (Pages / Dialogs / Settings / Actions), then the
 * tail is chunked into "More…" sub menus, never deeper than `maxDepth`.
 *
 * Pure (no IO, no DOM). Fixture: spec/fixtures/nested-menu.json (spec/check-nested-menu.mjs replays it). Kotlin twin
 * deferred (Android on hold, spec/PORTING.md).
 */

export const NESTED_MENU_FRAME = 'nested-menu@1';
/** Suffix of the generated assets' ids (`<app>-generated`), both the app-menu and the nav-menu. */
export const GENERATED_SUFFIX = '-generated';
/** Kinds of registry entries. `list` = a live list (app-menu `provider`), `app` = another app (Molly's frames). */
export const MENU_SOURCE_KINDS = ['page', 'dialog', 'settings', 'action', 'list', 'app'];
export const KIND_LABELS = { page: 'Pages', dialog: 'Dialogs', settings: 'Settings', action: 'Actions', list: 'Lists', app: 'Apps' };
export const KIND_ICONS = { page: 'layout', dialog: 'box', settings: 'settings', action: 'zap', list: 'list', app: 'grid' };

/** Settings every app's generated menus read (one registry, so commands, settings panels and tests agree). */
export const NESTED_MENU_KEYS = {
  override: 'axf.menus.override',
  maxPerLevel: 'axf.menus.maxPerLevel',
  recentsMax: 'axf.menus.recentsMax',
  favorites: 'axf.menus.favorites',
  recents: 'axf.menus.recents',
  hidden: 'axf.menus.hidden',
  style: 'axf.menus.style',
  showFavorites: 'axf.menus.showFavorites',
  showRecents: 'axf.menus.showRecents',
  groupByPlugin: 'axf.menus.groupByPlugin',
  previous: 'axf.menus.previous',
};

/** The fields a command may set (`menus.set <field> <value>`), their kinds, bounds and defaults. */
export const NESTED_MENU_FIELDS = {
  override: { kind: 'boolean', default: true, title: 'Override the shared menus', text: 'Show the generated menus instead of the app’s shared app-menu and nav-menu assets.' },
  maxPerLevel: { kind: 'number', min: 4, max: 30, default: 12, title: 'Rows per level', text: 'The most rows a menu or sub menu shows before the rest goes into sub menus.' },
  recentsMax: { kind: 'number', min: 0, max: 24, default: 8, title: 'Recents kept', text: 'How many recently opened pages and dialogs the Recent list keeps (0 hides it).' },
  showFavorites: { kind: 'boolean', default: true, title: 'Favourites on top', text: 'A Favourites list first in the navigation and in the Start menu.' },
  showRecents: { kind: 'boolean', default: true, title: 'Recent on top', text: 'A Recent list after Favourites.' },
  groupByPlugin: { kind: 'boolean', default: true, title: 'Group by plugin', text: 'When a category is over the cap, a plugin with several entries becomes its own sub menu.' },
  style: { kind: 'enum', options: ['list', 'rail', 'pills'], default: 'list', title: 'Navigation style', text: 'How the generated navigation is drawn.' },
  hidden: { kind: 'list', default: [], title: 'Hidden', text: 'Category ids or entry ids left out of the generated menus.' },
  favorites: { kind: 'list', default: [], title: 'Favourites', text: 'Entry ids pinned to the Favourites list, in order.' },
};
export const NESTED_MENU_DEFAULTS = Object.freeze({ maxPerLevel: 12, maxDepth: 4, recentsMax: 8, showFavorites: true, showRecents: true, groupByPlugin: true, style: 'list' });
/** Deepest level a generated tree uses (app-menu items are depth 1; the app-menu engine caps at 4). */
export const NESTED_MENU_MAX_DEPTH = 4;

/**
 * The categories, in menu order. `words` match whole words of an entry's id, label, keywords, module label and the
 * menu / section it came from; `aliases` match the id of the menu or section it came from (a hint, weaker than words).
 */
export const MENU_CATEGORIES = [
  { id: 'start', label: 'Start', icon: 'home', words: ['home', 'start', 'dashboard', 'overview', 'search', 'alert', 'alerts', 'inbox', 'reload', 'refresh', 'save', 'exit', 'quit', 'settings', 'preferences'], aliases: ['console', 'file', 'molly', 'axhub', 'amberx', 'main'] },
  { id: 'work', label: 'Work', icon: 'check-circle', words: ['approval', 'approvals', 'approve', 'waiting', 'monitor', 'monitoring', 'task', 'tasks', 'notice', 'notices', 'alarm', 'todo', 'todos', 'note', 'notes', 'reminder', 'veto'], aliases: ['approvals', 'work'] },
  { id: 'builds', label: 'Builds', icon: 'play', words: ['build', 'builds', 'building', 'plan', 'plans', 'pending', 'queue', 'tracker', 'orchestrator', 'ship', 'shipped', 'feature', 'features', 'change', 'changes', 'release', 'rebuild', 'rebuilds', 'profile', 'profiles', 'breaker', 'codebase', 'snapshot', 'snapshots', 'project', 'projects', 'wizard', 'step', 'steps', 'export', 'status'], aliases: ['builds', 'build'] },
  { id: 'ai', label: 'AI & agents', icon: 'sparkles', words: ['ai', 'agent', 'agents', 'claude', 'assistant', 'voice', 'mcp', 'swarm', 'crew', 'handoff', 'session', 'sessions', 'token', 'tokens', 'model', 'models', 'key', 'keys', 'dictation', 'listener', 'listeners', 'companion', 'chat', 'recorder', 'audio', 'transcript', 'glossary', 'md', 'markdown', 'amber', 'follow', 'checkin', 'accounts', 'command', 'commands'], aliases: ['ai', 'agents'] },
  { id: 'plugins', label: 'Plugins', icon: 'package', words: ['plugin', 'plugins', 'install', 'installer', 'uninstall', 'extension', 'extensions', 'switch', 'switches', 'update', 'updates'], aliases: ['plugins'] },
  { id: 'framework', label: 'Framework', icon: 'layers', words: ['framework', 'module', 'modules', 'package', 'packages', 'library', 'libraries', 'boilerplate', 'boilerplates', 'component', 'components', 'asset', 'assets', 'demo', 'demos', 'standard', 'standards', 'catalog', 'template', 'templates', 'manifest', 'rules', 'spec', 'kit', 'kits'], aliases: ['framework'] },
  { id: 'look', label: 'Look & layout', icon: 'palette', words: ['appearance', 'theme', 'themes', 'brand', 'branding', 'design', 'style', 'styles', 'look', 'layout', 'layouts', 'toolbar', 'toolbars', 'banner', 'banners', 'nav', 'navigation', 'menu', 'menus', 'context', 'chrome', 'spacing', 'density', 'window', 'windows', 'dialog', 'dialogs', 'tab', 'tabs', 'icon', 'icons', 'font', 'fonts', 'colour', 'colours', 'color', 'colors', 'widget', 'widgets', 'bars', 'pages', 'view', 'shortcut', 'shortcuts', 'collapse'], aliases: ['view', 'look'] },
  { id: 'apps', label: 'Apps', icon: 'grid', words: ['app', 'apps', 'expenses', 'walkthrough', 'studio', 'hub', 'web', 'browser', 'tab'], aliases: ['apps'] },
  { id: 'system', label: 'System', icon: 'terminal', words: ['system', 'systems', 'maintenance', 'container', 'terminal', 'deploy', 'deploys', 'server', 'servers', 'slot', 'slots', 'health', 'notify', 'notifications', 'push', 'output', 'cli', 'console', 'developer', 'log', 'logs', 'data', 'sync', 'github', 'git'], aliases: ['system', 'tools'] },
  { id: 'account', label: 'Account', icon: 'shield', words: ['account', 'accounts', 'sign', 'signin', 'login', 'logout', 'access', 'uac', 'role', 'roles', 'security', 'secure', 'user', 'users', 'lock', 'password', 'biometric', 'permission', 'permissions', 'policy'], aliases: ['account'] },
  { id: 'help', label: 'Help', icon: 'help', words: ['help', 'doc', 'docs', 'documentation', 'about', 'guide', 'guides', 'learn', 'tour', 'tours', 'faq', 'support', 'tip', 'tips'], aliases: ['help'] },
  { id: 'more', label: 'More', icon: 'more', words: [], aliases: ['more'] },
];
export const FAVORITES_ID = 'favorites';
export const RECENTS_ID = 'recents';
/** The action the generated Start menu offers for search / jump-to (the app registers it; see generatedMenus.tsx). */
export const JUMP_ACTION = 'menus.jump';

/* ---------------- helpers ---------------- */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const slug = (v) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
const words = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const byLabel = (a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
const byOrder = (a, b) => (a.order ?? 100) - (b.order ?? 100) || byLabel(a, b);
/** `title-case` for a slug: `pending-builds` → `Pending builds`. */
export const titleOf = (id) => { const s = String(id).replace(/[-_.:]+/g, ' ').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(id); };

/** The canonical id of a source from its action: `nav:x` → `page:x`, `dialog:x`, `settings.open:x` → `settings:x`. */
export function sourceIdOf(src) {
  if (str(src.provider)) return `list:${str(src.provider)}`;
  const a = str(src.action, 400);
  let m;
  if ((m = /^nav:([^:]+)$/.exec(a))) return `page:${m[1]}`;
  if ((m = /^dialog:([^:]+)$/.exec(a))) return `dialog:${m[1]}`;
  if ((m = /^settings\.open:([^:]+)$/.exec(a))) return `settings:${m[1]}`;
  if (a === 'app.settings') return 'settings:settings';
  if (a) return `action:${a}`;
  if (str(src.view) && (src.kind === 'page' || src.kind === 'app' || !src.kind)) return `${src.kind === 'app' ? 'app' : 'page'}:${str(src.view)}`;
  return str(src.id) ? `${str(src.kind) || 'action'}:${str(src.id)}` : '';
}
const kindOfId = (id) => { const k = id.slice(0, id.indexOf(':')); return MENU_SOURCE_KINDS.includes(k) ? k : 'action'; };

/**
 * Clean one registry entry. Returns null when it can't be a menu entry (no action, no provider, or no label).
 * Fields: id?, label, icon?, action? | provider?, kind?, module?, moduleLabel?, category?, subcategory?, keywords?,
 * hint? (the menu / section it came from), hintId?, requires?, badge?, shortcut?, order?, view? (pages).
 */
export function normalizeSource(raw) {
  if (!isObj(raw)) return null;
  const id = sourceIdOf(raw);
  if (!id) return null;
  const label = str(raw.label, 120) || titleOf(id.slice(id.indexOf(':') + 1));
  const out = { id, kind: MENU_SOURCE_KINDS.includes(raw.kind) ? raw.kind : kindOfId(id), label, module: str(raw.module, 120) || 'app', moduleLabel: str(raw.moduleLabel, 120) || '', keywords: [] };
  if (out.kind === 'list') out.provider = str(raw.provider); else out.action = str(raw.action, 400) || (out.kind === 'page' ? `nav:${id.slice(5)}` : out.kind === 'dialog' ? `dialog:${id.slice(7)}` : out.kind === 'settings' ? `settings.open:${id.slice(9)}` : '');
  if (out.kind === 'page') out.view = str(raw.view) || id.slice(5);
  if (!out.action && !out.provider) return null;
  if (str(raw.icon, 60)) out.icon = str(raw.icon, 60);
  if (str(raw.category, 40)) out.category = slug(raw.category);
  if (str(raw.subcategory, 60)) out.subcategory = str(raw.subcategory, 60);
  if (str(raw.hint, 120)) out.hint = str(raw.hint, 120);
  if (str(raw.hintId, 60)) out.hintId = slug(raw.hintId);
  if (str(raw.requires, 80)) out.requires = str(raw.requires, 80);
  if (str(raw.badge, 80)) out.badge = str(raw.badge, 80);
  if (str(raw.shortcut, 40)) out.shortcut = str(raw.shortcut, 40);
  if (typeof raw.order === 'number' && Number.isFinite(raw.order)) out.order = raw.order;
  const kw = Array.isArray(raw.keywords) ? raw.keywords : [];
  out.keywords = [...new Set(kw.map((k) => str(k, 60)).filter(Boolean))].slice(0, 24);
  return out;
}

/** Normalize, then merge duplicates (same id: first label and icon win, keywords and hints join, missing fields fill). */
export function normalizeSources(list) {
  const out = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const s = normalizeSource(raw);
    if (!s) continue;
    const prev = out.get(s.id);
    if (!prev) { out.set(s.id, s); continue; }
    for (const k of ['icon', 'category', 'subcategory', 'requires', 'badge', 'shortcut', 'order', 'moduleLabel']) if (prev[k] === undefined || prev[k] === '') { if (s[k] !== undefined && s[k] !== '') prev[k] = s[k]; }
    if (prev.module === 'app' && s.module !== 'app') { prev.module = s.module; if (s.moduleLabel) prev.moduleLabel = s.moduleLabel; }
    prev.keywords = [...new Set([...prev.keywords, ...s.keywords, ...(s.hint ? [s.hint] : []), ...(s.hintId ? [s.hintId] : [])])].slice(0, 32);
    if (!prev.hint && s.hint) prev.hint = s.hint;
    if (!prev.hintId && s.hintId) prev.hintId = s.hintId;
  }
  // the same label twice from one module as a page and as its settings entry (Settings / app.settings): the page stays
  const all = [...out.values()];
  const pages = new Set(all.filter((s) => s.kind === 'page').map((s) => `${s.module}|${s.label.toLowerCase()}`));
  return all.filter((s) => !((s.kind === 'settings' || s.kind === 'action') && pages.has(`${s.module}|${s.label.toLowerCase()}`)));
}

/* ---------------- categories ---------------- */

/** The categories in force: the built-in list with `opts.categories` overrides (label, icon, words, order, off). */
export function categoriesFor(opts = {}) {
  const over = isObj(opts.categories) ? opts.categories : {};
  const list = MENU_CATEGORIES.map((c, i) => {
    const o = isObj(over[c.id]) ? over[c.id] : {};
    return { ...c, label: str(o.label, 40) || c.label, icon: str(o.icon, 40) || c.icon, words: Array.isArray(o.words) ? [...new Set([...c.words, ...o.words.map((w) => str(w, 40).toLowerCase()).filter(Boolean)])] : c.words, order: num(o.order, (i + 1) * 10), off: o.off === true };
  });
  for (const [id, o] of Object.entries(over)) {
    if (list.some((c) => c.id === id) || !isObj(o)) continue;
    list.push({ id: slug(id), label: str(o.label, 40) || titleOf(id), icon: str(o.icon, 40) || 'folder', words: (Array.isArray(o.words) ? o.words : []).map((w) => str(w, 40).toLowerCase()).filter(Boolean), aliases: [slug(id)], order: num(o.order, 115), off: o.off === true });
  }
  return list.sort((a, b) => a.order - b.order);
}

/** Which category an entry belongs to. Explicit category first, then word hits, then the hint alias, else `more`. */
export function categorize(src, categories = MENU_CATEGORIES) {
  const live = categories.filter((c) => !c.off);
  const fallback = (live.find((c) => c.id === 'more') ?? live[live.length - 1])?.id ?? 'more';
  if (src.category && live.some((c) => c.id === src.category)) return src.category;
  if (src.kind === 'app' && live.some((c) => c.id === 'apps')) return 'apps';
  let labelWords = words(src.label);
  if (labelWords.length > 1 && labelWords[labelWords.length - 1] === 'settings') labelWords = labelWords.slice(0, -1); // "X settings" is about X
  const strong = new Set([...labelWords, ...src.keywords.flatMap(words), ...words(src.moduleLabel)]);
  const idPart = src.id.slice(src.id.indexOf(':') + 1);
  const weak = new Set(words(src.kind === 'action' && idPart.includes(':') ? idPart.slice(idPart.indexOf(':') + 1) : idPart));
  const hintWords = new Set([...words(src.hint), ...words(src.hintId)]);
  let best = null;
  for (const c of live) {
    const score = c.words.reduce((n, w) => n + (strong.has(w) ? 10 : 0) + (weak.has(w) ? 3 : 0) + (hintWords.has(w) ? 1 : 0), 0) + ((c.aliases ?? []).some((a) => a === src.hintId) ? 1 : 0);
    if (score > 0 && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best?.id ?? fallback;
}

/* ---------------- the tree ---------------- */

/**
 * Lay `items` (already categorised, sorted) out within `max` rows per level and `depth` levels left:
 *   1. explicit sub categories always become sub menus;
 *   2. over the cap: plugins (modules) with 2+ entries become sub menus (when groupByPlugin);
 *   3. still over: group the rest by kind;
 *   4. still over: the tail goes into a "More…" sub menu (chained while depth allows).
 * Returns nodes: leaves `{ src }` and groups `{ group: { id, label, icon }, items }`. Pure.
 */
export function layout(items, { max, depthLeft, groupByPlugin = true, prefix, sort = 'rank' }) {
  const canNest = depthLeft > 1;
  // the last level allowed holds leaves only: declared sub categories flatten into it
  const leaves = (canNest ? items.filter((s) => !s.subcategory) : items.map((s) => (s.subcategory ? { ...s, subcategory: undefined } : s))).sort(sort === 'label' ? byLabel : byRank);
  const groups = new Map();
  const addGroup = (key, label, icon, list) => {
    if (!groups.has(key)) groups.set(key, { group: { id: `${prefix}/${key}`, label, icon }, items: [] });
    groups.get(key).items.push(...list);
  };
  if (canNest) for (const s of items.filter((s) => s.subcategory)) addGroup(slug(s.subcategory), s.subcategory, s.icon ?? 'folder', [{ ...s, subcategory: undefined }]);
  let flat = leaves;
  const fits = () => flat.length + groups.size <= max;
  const take = (list) => { const gone = new Set(list.map((s) => s.id)); flat = flat.filter((s) => !gone.has(s.id)); };
  // 1. settings tabs are secondary: over the cap they share one Settings sub menu
  if (!fits() && canNest) {
    const settings = flat.filter((s) => s.kind === 'settings');
    if (settings.length >= 2 && settings.length < flat.length) { addGroup('kind-settings', KIND_LABELS.settings, KIND_ICONS.settings, settings); take(settings); }
  }
  // 2. a plugin with several entries becomes its own sub menu (largest first, until the level fits)
  if (!fits() && canNest && groupByPlugin) {
    const byModule = new Map();
    for (const s of flat) { if (s.module === 'app') continue; if (!byModule.has(s.module)) byModule.set(s.module, []); byModule.get(s.module).push(s); }
    for (const [mod, list] of [...byModule.entries()].filter(([, l]) => l.length >= 3).sort((a, b) => b[1].length - a[1].length)) {
      if (fits()) break;
      addGroup(`plugin-${slug(mod)}`, list.find((s) => s.moduleLabel)?.moduleLabel || titleOf(mod.split('.').pop()), list[0].icon ?? 'package', list);
      take(list);
    }
  }
  // 3. then by kind (the biggest kind stays flat), only when that alone makes the level fit
  if (!fits() && canNest) {
    const byKind = new Map();
    for (const s of flat) { if (!byKind.has(s.kind)) byKind.set(s.kind, []); byKind.get(s.kind).push(s); }
    const kinds = [...byKind.entries()].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length);
    const rest = kinds.slice(1);
    const after = flat.length - rest.reduce((n, [, l]) => n + l.length, 0) + groups.size + rest.length;
    if (after <= max) for (const [kind, list] of rest) { addGroup(`kind-${kind}`, KIND_LABELS[kind] ?? titleOf(kind), KIND_ICONS[kind] ?? 'folder', list); take(list); }
  }
  const groupRank = (g) => (g.group.id.endsWith('/kind-settings') ? 1 : 0);
  const sub = (g, order = 'rank') => ({ group: g.group, items: layout(g.items, { max, depthLeft: depthLeft - 1, groupByPlugin, prefix: g.group.id, sort: order }) });
  const groupNodes = [...groups.values()].sort((a, b) => groupRank(a) - groupRank(b) || byLabel(a.group, b.group)).map(sub);
  let nodes = [...flat.map((src) => ({ src })), ...groupNodes];
  // 4. still over: the app's own entries stay flat, the other leaves split into alphabetical sub menus (A–F, G–M…);
  //    when even those don't fit, everything beyond the cap goes under one More… (while depth allows)
  if (nodes.length > max && canNest) {
    const own = flat.filter((s) => s.module === 'app');
    const others = flat.filter((s) => s.module !== 'app');
    // keep as many of the app's own rows flat as leaves room for the chunks and the groups
    let keepN = 0;
    for (let k = Math.min(own.length, max - 1); k >= 0; k--) {
      const chunkN = Math.ceil((others.length + own.length - k) / max);
      if (k + chunkN + groupNodes.length <= max) { keepN = k; break; }
    }
    const keep = own.slice(0, keepN);
    const rest = [...own.slice(keepN), ...others];
    const chunks = alphaChunks(rest.sort(byLabel), max, prefix).map((g) => sub(g, 'label'));
    nodes = [...keep.map((src) => ({ src })), ...chunks, ...groupNodes];
    if (nodes.length > max) {
      const head = nodes.slice(0, max - 1);
      const tail = nodes.slice(max - 1);
      // with room for one more level only, More… holds leaves (the tail's groups flattened, the cap wins)
      const flatten = (ns) => ns.flatMap((n) => (n.group ? flatten(n.items) : [n]));
      nodes = [...head, { group: { id: `${prefix}/more`, label: 'More…', icon: 'more' }, items: depthLeft > 2 ? tail : flatten(tail).slice(0, max) }];
    }
  } else if (nodes.length > max) {
    nodes = nodes.slice(0, max); // depth exhausted: the cap wins, the rest is only in the index
  }
  return nodes;
}

/** Split sorted leaves into groups of at most `max`, labelled by their first letters (`A–F`). */
function alphaChunks(list, max, prefix) {
  if (!list.length) return [];
  const n = Math.ceil(list.length / max);
  const size = Math.ceil(list.length / n);
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    const part = list.slice(i, i + size);
    const first = (part[0].label[0] ?? '').toUpperCase();
    const last = (part[part.length - 1].label[0] ?? '').toUpperCase();
    const label = n === 1 ? 'More…' : first === last ? `${first}…` : `${first}–${last}`;
    out.push({ group: { id: `${prefix}/${n === 1 ? 'more' : `az-${out.length + 1}`}`, label, icon: 'more' }, items: part });
  }
  return out;
}

/** The app's own entries first, then pages, dialogs, actions, lists, settings; `order` and the label settle ties. */
const KIND_RANK = { page: 0, app: 0, dialog: 1, action: 2, list: 3, settings: 4 };
const byRank = (a, b) => (a.module === 'app' ? 0 : 1) - (b.module === 'app' ? 0 : 1) || (KIND_RANK[a.kind] ?? 2) - (KIND_RANK[b.kind] ?? 2) || byOrder(a, b);

/** Normalize the options every generator call takes. */
export function normalizeOptions(opts = {}) {
  const o = isObj(opts) ? opts : {};
  const app = slug(o.app) || 'app';
  return {
    app,
    appLabel: str(o.appLabel, 60) || titleOf(app),
    maxPerLevel: clamp(Math.floor(num(o.maxPerLevel, NESTED_MENU_DEFAULTS.maxPerLevel)), NESTED_MENU_FIELDS.maxPerLevel.min, NESTED_MENU_FIELDS.maxPerLevel.max),
    maxDepth: clamp(Math.floor(num(o.maxDepth, NESTED_MENU_DEFAULTS.maxDepth)), 2, NESTED_MENU_MAX_DEPTH),
    recentsMax: clamp(Math.floor(num(o.recentsMax, NESTED_MENU_DEFAULTS.recentsMax)), NESTED_MENU_FIELDS.recentsMax.min, NESTED_MENU_FIELDS.recentsMax.max),
    showFavorites: o.showFavorites !== false,
    showRecents: o.showRecents !== false,
    groupByPlugin: o.groupByPlugin !== false,
    style: NESTED_MENU_FIELDS.style.options.includes(o.style) ? o.style : NESTED_MENU_DEFAULTS.style,
    favorites: (Array.isArray(o.favorites) ? o.favorites : []).map((x) => str(x, 200)).filter(Boolean),
    recents: (Array.isArray(o.recents) ? o.recents : []).map((x) => str(x, 200)).filter(Boolean),
    hidden: new Set((Array.isArray(o.hidden) ? o.hidden : []).map((x) => str(x, 200)).filter(Boolean)),
    categories: categoriesFor(o),
    jumpAction: str(o.jumpAction, 120) || JUMP_ACTION,
    header: str(o.header, 60) || str(o.appLabel, 60) || titleOf(app),
  };
}

/**
 * The generated tree: `{ categories: [{ id, label, icon, nodes }], favorites: [src], recents: [src], index, stats, notes }`.
 * `index` lists every entry shown anywhere with its path (for search / jump-to); `stats` is what the report prints.
 */
export function buildNestedMenu(sources, opts = {}) {
  const o = normalizeOptions(opts);
  const notes = [];
  const all = normalizeSources(sources);
  const shown = all.filter((s) => !o.hidden.has(s.id));
  const byId = new Map(shown.map((s) => [s.id, s]));
  const buckets = new Map();
  for (const s of shown) {
    const cat = categorize(s, o.categories);
    if (o.hidden.has(cat)) continue;
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat).push(s);
  }
  const categories = [];
  for (const c of o.categories) {
    const items = buckets.get(c.id);
    if (!items?.length || c.off) continue;
    categories.push({ id: c.id, label: c.label, icon: c.icon, nodes: layout(items, { max: o.maxPerLevel, depthLeft: o.maxDepth, groupByPlugin: o.groupByPlugin, prefix: `group:${c.id}` }), count: items.length });
  }
  // too many categories for one level: the smallest beyond the cap fold into More
  if (categories.length > o.maxPerLevel) {
    const keep = categories.slice(0, o.maxPerLevel - 1);
    const fold = categories.slice(o.maxPerLevel - 1);
    const more = keep.find((c) => c.id === 'more') ?? (() => { const m = { id: 'more', label: 'More', icon: 'more', nodes: [], count: 0 }; keep.push(m); return m; })();
    for (const c of fold) { if (c === more) continue; more.nodes.push({ group: { id: `group:more/${c.id}`, label: c.label, icon: c.icon }, items: c.nodes }); more.count += c.count; }
    notes.push(`${fold.length} categories folded into More (cap ${o.maxPerLevel})`);
    categories.length = 0; categories.push(...keep);
  }
  const favorites = o.showFavorites ? o.favorites.map((id) => byId.get(id)).filter(Boolean) : [];
  const recents = o.showRecents && o.recentsMax > 0 ? o.recents.map((id) => byId.get(id)).filter((s) => s && !favorites.includes(s)).slice(0, o.recentsMax) : [];
  const index = [];
  const seen = new Set();
  let deepest = 0;
  let widest = 0;
  let groups = 0;
  const walk = (nodes, trail, depth) => {
    widest = Math.max(widest, nodes.length);
    deepest = Math.max(deepest, depth);
    for (const n of nodes) {
      if (n.group) { groups++; walk(n.items, [...trail, n.group.label], depth + 1); continue; }
      if (seen.has(n.src.id)) continue;
      seen.add(n.src.id);
      index.push(indexEntry(n.src, trail));
    }
  };
  for (const c of categories) walk(c.nodes, [c.label], 1);
  const missing = shown.filter((s) => !seen.has(s.id));
  for (const s of missing) index.push(indexEntry(s, ['Not in a menu']));
  if (missing.length) notes.push(`${missing.length} entries over the cap are only reachable through search`);
  const stats = { sources: all.length, hidden: all.length - shown.length, shown: shown.length, placed: seen.size, unplaced: missing.length, categories: categories.length, groups, deepest, widest, maxPerLevel: o.maxPerLevel, favorites: favorites.length, recents: recents.length, perCategory: Object.fromEntries(categories.map((c) => [c.id, c.count])) };
  return { $axf: NESTED_MENU_FRAME, app: o.app, categories, favorites, recents, index, stats, notes, options: { ...o, hidden: [...o.hidden], categories: undefined } };
}

function indexEntry(s, trail) {
  const e = { id: s.id, kind: s.kind, label: s.label, path: trail, keywords: [...new Set([...s.keywords, s.moduleLabel, s.hint].filter(Boolean))] };
  if (s.icon) e.icon = s.icon;
  if (s.action) e.action = s.action;
  if (s.provider) e.provider = s.provider;
  if (s.view) e.view = s.view;
  if (s.requires) e.requires = s.requires;
  if (s.module !== 'app') e.module = s.module;
  return e;
}

/* ---------------- app-menu and nav-menu data ---------------- */

function menuItemOf(src) {
  const it = { id: src.id, label: src.label };
  if (src.icon) it.icon = src.icon;
  if (src.provider) it.provider = src.provider; else it.action = src.action;
  if (src.requires) it.requires = src.requires;
  if (src.badge) it.badge = src.badge;
  if (src.shortcut) it.shortcut = src.shortcut;
  return it;
}
function menuItemsOf(nodes) {
  return nodes.map((n) => (n.group ? { id: n.group.id, label: n.group.label, icon: n.group.icon, items: menuItemsOf(n.items) } : menuItemOf(n.src))).filter((it) => !it.items || it.items.length);
}

/** `app-menu` asset data: Start (favourites, recents, jump-to, the Start category) then one menu per category. */
export function toAppMenu(tree, opts = {}) {
  const o = normalizeOptions({ ...tree.options, ...opts, app: tree.app });
  const start = tree.categories.find((c) => c.id === 'start');
  const startItems = [];
  if (o.showFavorites) startItems.push({ id: FAVORITES_ID, label: 'Favourites', icon: 'star', items: tree.favorites.map(menuItemOf) });
  if (o.showRecents && o.recentsMax > 0) startItems.push({ id: RECENTS_ID, label: 'Recent', icon: 'clock', items: tree.recents.map(menuItemOf) });
  startItems.push({ id: 'jump', label: 'Jump to…', icon: 'search', action: o.jumpAction, shortcut: 'Ctrl+Shift+K' });
  const own = start ? menuItemsOf(start.nodes) : [];
  if (own.length) startItems.push({ id: 'start-sep', separator: true }, ...own);
  const menus = [{ id: 'start', label: start?.label ?? 'Start', order: 10, items: startItems.filter((it) => !it.items || it.items.length || it.id === FAVORITES_ID || it.id === RECENTS_ID) }];
  // an empty Favourites / Recent sub menu would be pruned by the app-menu engine: give it one explaining row
  for (const it of menus[0].items) if (it.items && !it.items.length) it.items = [{ id: `${it.id}-empty`, label: it.id === FAVORITES_ID ? 'Nothing pinned yet: right-click an item → Add to favourites' : 'Nothing opened yet', icon: 'info', action: 'menus.settings' }];
  let order = 20;
  for (const c of tree.categories) {
    if (c.id === 'start') continue;
    const items = menuItemsOf(c.nodes);
    if (!items.length) continue;
    menus.push({ id: c.id, label: c.label, order, items });
    order += 10;
  }
  return { menus, density: 'compact' };
}

const pageNodes = (nodes) => nodes.map((n) => (n.group ? { ...n, items: pageNodes(n.items) } : n)).filter((n) => (n.group ? n.items.length > 0 : n.src.kind === 'page'));
function navItemsOf(nodes) {
  return nodes.map((n) => {
    if (n.group) return { id: n.group.id, label: n.group.label, icon: n.group.icon, view: '', items: navItemsOf(n.items) };
    const it = { id: n.src.id, label: n.src.label, icon: n.src.icon ?? 'layout', view: n.src.view };
    if (n.src.requires) it.requires = n.src.requires;
    if (n.src.badge) it.badge = n.src.badge;
    return it;
  });
}

/**
 * `nav-menu` asset data (nav-style@1 sub menus): Favourites and Recent sections (pages only), then one row per
 * category that slides open; the Start pages stay flat on top; a category with one page is that page.
 */
export function toNavMenu(tree, opts = {}) {
  const o = normalizeOptions({ ...tree.options, ...opts, app: tree.app });
  const sections = [];
  const favs = tree.favorites.filter((s) => s.kind === 'page');
  const recs = tree.recents.filter((s) => s.kind === 'page');
  if (o.showFavorites && favs.length) sections.push({ label: 'Favourites', items: navItemsOf(favs.map((src) => ({ src }))) });
  if (o.showRecents && recs.length) sections.push({ label: 'Recent', items: navItemsOf(recs.map((src) => ({ src }))) });
  const top = [];
  const start = tree.categories.find((c) => c.id === 'start');
  if (start) top.push(...navItemsOf(pageNodes(start.nodes)));
  for (const c of tree.categories) {
    if (c.id === 'start') continue;
    const nodes = pageNodes(c.nodes);
    if (!nodes.length) continue;
    const items = navItemsOf(nodes);
    if (items.length === 1 && !items[0].items) { top.push(items[0]); continue; }
    top.push({ id: `group:${c.id}`, label: c.label, icon: c.icon, view: '', items });
  }
  if (top.length) sections.push({ items: top });
  return { style: o.style, header: o.header, sections, navStyle: true, density: 'compact' };
}

/** Both assets (asset@1 envelopes, ids `<app>-generated`) plus the index and stats, from raw sources in one call. */
export function generateMenuAssets(sources, opts = {}) {
  const tree = buildNestedMenu(sources, opts);
  const o = normalizeOptions({ ...opts, app: tree.app });
  const id = `${o.app}${GENERATED_SUFFIX}`.slice(0, 48);
  const version = '1.0.0';
  const tags = ['generated', o.app];
  const appMenu = { $axf: 'asset@1', type: 'app-menu', id, name: `${o.appLabel} (generated)`, version, description: `Generated nested application menu for ${o.appLabel}: ${tree.stats.placed} entries in ${tree.stats.categories} categories, at most ${o.maxPerLevel} rows per level (nested-menu@1).`, author: 'AmberX AXF', tags, data: toAppMenu(tree, o) };
  const navMenu = { $axf: 'asset@1', type: 'nav-menu', id, name: `${o.appLabel} navigation (generated)`, version, description: `Generated nested navigation for ${o.appLabel}: categories that slide open, favourites and recents on top (nested-menu@1).`, author: 'AmberX AXF', tags, data: toNavMenu(tree, o) };
  return { tree, appMenu, navMenu, index: tree.index, stats: tree.stats, notes: tree.notes };
}

/* ---------------- search / jump-to, favourites, recents ---------------- */

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
/** Score one index entry for a query (label exact > prefix > word > substring > path / keywords); 0 = no match. */
export function scoreIndexEntry(e, query) {
  const ws = norm(query).split(/\s+/).filter(Boolean);
  if (!ws.length) return 0;
  const label = norm(e.label);
  const rest = norm([...(e.path ?? []), ...(e.keywords ?? []), e.kind, e.id].join(' '));
  let score = 0;
  for (const w of ws) {
    let s = 0;
    if (label === w) s = 100;
    else if (label.startsWith(w)) s = 60;
    else if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)) s = 40;
    else if (label.includes(w)) s = 25;
    else if (rest.includes(w)) s = 10;
    if (!s) return 0;
    score += s;
  }
  if (ws.length > 1 && label.includes(norm(query).trim())) score += 30;
  return score - Math.min(label.length, 60) / 60;
}

/** Ranked hits over the index (favourites and recents rank first among equals). */
export function searchMenuIndex(index, query, { max = 12, favorites = [], recents = [] } = {}) {
  const boost = (id) => (favorites.includes(id) ? 8 : 0) + (recents.includes(id) ? Math.max(0, 6 - recents.indexOf(id)) : 0);
  return index.map((e) => ({ e, s: scoreIndexEntry(e, query) })).filter((x) => x.s > 0).map((x) => ({ ...x, s: x.s + boost(x.e.id) })).sort((a, b) => b.s - a.s || a.e.label.localeCompare(b.e.label)).slice(0, Math.max(1, max)).map((x) => x.e);
}

/** A new recents list with `id` moved to the front (never a favourite, never twice), capped. */
export function pushRecent(recents, id, max = NESTED_MENU_DEFAULTS.recentsMax) {
  const list = (Array.isArray(recents) ? recents : []).filter((x) => x !== id);
  return [id, ...list].slice(0, Math.max(0, max));
}

/** Toggle (or set with `on`) a favourite; the order is the order of pinning. */
export function toggleFavorite(favorites, id, on) {
  const list = Array.isArray(favorites) ? favorites.filter(Boolean) : [];
  const has = list.includes(id);
  const want = on === undefined ? !has : !!on;
  if (want && !has) return [...list, id];
  if (!want && has) return list.filter((x) => x !== id);
  return list;
}

/** Validate one field for `menus.set`; [] = fine. */
export function menuFieldErrors(field, value) {
  const f = NESTED_MENU_FIELDS[field];
  if (!f) return [`unknown field "${field}" (one of ${Object.keys(NESTED_MENU_FIELDS).join(', ')})`];
  if (f.kind === 'boolean') return typeof value === 'boolean' ? [] : [`${field} must be true or false`];
  if (f.kind === 'number') return typeof value === 'number' && Number.isInteger(value) && value >= f.min && value <= f.max ? [] : [`${field} must be a whole number from ${f.min} to ${f.max}`];
  if (f.kind === 'enum') return f.options.includes(value) ? [] : [`${field} must be one of ${f.options.join(', ')}`];
  if (f.kind === 'list') return Array.isArray(value) && value.every((x) => typeof x === 'string') ? [] : [`${field} must be a list of ids`];
  return [];
}

/** Parse a field value given as text (CLI / voice / MCP): `on`/`off`, numbers, comma lists. */
export function parseFieldValue(field, raw) {
  const f = NESTED_MENU_FIELDS[field];
  if (!f) return raw;
  const t = typeof raw === 'string' ? raw.trim() : raw;
  if (f.kind === 'boolean') return typeof t === 'boolean' ? t : /^(true|on|yes|1)$/i.test(String(t)) ? true : /^(false|off|no|0)$/i.test(String(t)) ? false : t;
  if (f.kind === 'number') return typeof t === 'number' ? t : Number.isFinite(Number(t)) && String(t) !== '' ? Number(t) : t;
  if (f.kind === 'list') return Array.isArray(t) ? t : String(t ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return t;
}

/** The generated tree as indented text (the report, the CLI, the settings preview). */
export function treeOutline(tree, { nav = false } = {}) {
  const lines = [];
  const walk = (nodes, indent) => {
    for (const n of nodes) {
      if (n.group) { lines.push(`${indent}${n.group.label} ▸`); walk(n.items, `${indent}  `); continue; }
      if (nav && n.src.kind !== 'page') continue;
      lines.push(`${indent}${n.src.label}${n.src.kind === 'list' ? ' (live list)' : ''}`);
    }
  };
  if (tree.favorites.length) lines.push(`Favourites ▸ ${tree.favorites.map((s) => s.label).join(', ')}`);
  if (tree.recents.length) lines.push(`Recent ▸ ${tree.recents.map((s) => s.label).join(', ')}`);
  for (const c of tree.categories) { lines.push(`${c.label} (${c.count})`); walk(nav ? pageNodes(c.nodes) : c.nodes, '  '); }
  return lines.join('\n');
}
