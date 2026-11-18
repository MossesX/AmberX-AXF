/**
 * hub-console@1 — every axHub web page as a console screen (build move-everything-axhub-web-console, Nov 17 2026, Fable).
 * Pure, IO-free: the table comes in (framework/schemas/hub-console.json), facts come out. Spec framework/spec/HUB-CONSOLE.md,
 * fixture framework/spec/fixtures/hub-console.json, check framework/spec/check-hub-console.mjs. Kotlin twin deferred (PORTING.md).
 *
 * Brett (Nov 17 2026): "I really need to get this axHub and AmberX over the console. I really need that done. With the phone app."
 *
 * One route table, five projections. The table lists every hub screen once (id, gate, the hub call behind its state, its
 * rows, its actions with who may run each, its settings); from it this module derives
 *   - the console-control address of a screen, a row, an action or a setting (`screenAddress`, `rowAddress`, `actionAddress`,
 *     `settingAddress`), so the hub-admin plugin, the deep links and the parity check agree on one spelling;
 *   - the reaches of anything (`reachesOf`): REST path, MCP tool, CLI line, voice action, deep link — none of the last four
 *     for a `person` action, which is Brett's own tap and never a command;
 *   - where a retired axHub web hash route lands (`routeToScreen`), for the deploy redirect and the Phone Connect links;
 *   - what a command may run (`catalogActions`: never a person action), what must be registered personOnly
 *     (`personActions`), what the hub still lacks (`hubMissing`), every setting with its address (`settingsOf`), every MCP
 *     tool (`toolsOf`).
 * `validateHubConsole` refuses a table that breaks any rule, naming a code from CODES and the path.
 */

export const FRAME = 'hub-console@1';
export const FIXTURE_FRAME = 'hub-console-fixture@1';
/** Every refusal names one of these (append-only). */
export const CODES = ['frame', 'view', 'tab_row', 'home', 'plugin', 'screen_id', 'screen_dup', 'order_dup', 'replaces_dup', 'gate', 'read_channel', 'read_tool', 'read_shape', 'read_fields', 'tool_dup', 'grid_dup', 'action_id', 'action_dup', 'who', 'effect', 'person_tool', 'command_tool', 'hub_or_missing', 'missing_shape', 'nav_opens', 'setting_key', 'setting_dup', 'deferred_dup', 'deferred_screen'];
export const WHO = ['person', 'confirm', 'command'];
export const EFFECTS = ['read', 'write', 'destructive', 'navigate'];
export const CHANNELS = ['bearer', 'session', 'console'];
export const GATES = ['none', 'user', 'admin'];
export const SETTING_KINDS = ['toggle', 'number', 'text', 'choice', 'json'];
export const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
/** An MCP tool of the hub-admin plugin: `hub_` + plugin-commands@1's name rule, within the MCP 64-character limit. */
export const TOOL_RE = /^hub_[a-z0-9_]{2,59}$/;
export const TAB_ROW_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
export const SHAPE_RE = /^[a-z][a-z0-9-]*@[0-9]+$/;
export const SETTING_KEY_RE = /^axf\.hub\.[a-zA-Z0-9.]+$/;
/** The REST root of the plugin's routes and the settings sub-tab address root. */
export const REST_ROOT = '/api/plugins';
export const SETTINGS_ROOT = 'view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=';
/** The wire code the API answers for an action whose hub route does not exist yet. */
export const HUB_MISSING = 'hub_missing';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const camel = (id) => str(id).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/* ================================================================== validation */

/** → { ok, errors: [{ code, path, message }] }. Never throws on a strange table. */
export function validateHubConsole(table) {
  const errors = [];
  const err = (code, path, message) => errors.push({ code, path, message });
  const t = isObj(table) ? table : {};
  if (t.$axf !== FRAME) err('frame', '$axf', `$axf must be ${FRAME}`);
  if (!ID_RE.test(str(t.view))) err('view', 'view', 'view is a slug (the console view id)');
  if (!TAB_ROW_RE.test(str(t.tabRow))) err('tab_row', 'tabRow', 'tabRow is <view>.<row> (the TabGroup settings id)');
  if (!ID_RE.test(str(t.plugin))) err('plugin', 'plugin', 'plugin is a slug (the console plugin id)');
  if (!ID_RE.test(str(t.settingsSubtab))) err('plugin', 'settingsSubtab', 'settingsSubtab is a slug');
  const screens = Array.isArray(t.screens) ? t.screens : [];
  if (!screens.length) err('screen_id', 'screens', 'at least one screen');
  const ids = new Map(); const orders = new Map(); const replaces = new Map(); const tools = new Map(); const grids = new Map(); const keys = new Map();
  const read = (r, path) => {
    if (!isObj(r)) { err('read_channel', path, 'a read is an object'); return; }
    if (!CHANNELS.includes(r.channel)) err('read_channel', `${path}.channel`, `channel is one of ${CHANNELS.join(', ')}`);
    if (!TOOL_RE.test(str(r.tool))) err('read_tool', `${path}.tool`, 'tool is hub_<name> (MCP name rules)');
    else if (tools.has(r.tool)) err('tool_dup', `${path}.tool`, `tool ${r.tool} is also ${tools.get(r.tool)}`); else tools.set(r.tool, path);
    if (!SHAPE_RE.test(str(r.shape))) err('read_shape', `${path}.shape`, 'shape is a named frame (<name>@<n>)');
    const fields = Array.isArray(r.fields) ? r.fields : [];
    if (!fields.length || fields.some((f) => !str(f)) || new Set(fields).size !== fields.length) err('read_fields', `${path}.fields`, 'fields: at least one, strings, unique');
    if (typeof r.hub !== 'string' || !r.hub) err('read_channel', `${path}.hub`, 'a read names its hub call');
  };
  screens.forEach((s, i) => {
    const p = `screens.${i}`;
    if (!isObj(s)) { err('screen_id', p, 'a screen is an object'); return; }
    if (!ID_RE.test(str(s.id))) err('screen_id', `${p}.id`, 'screen id is a slug');
    else if (ids.has(s.id)) err('screen_dup', `${p}.id`, `screen ${s.id} is also ${ids.get(s.id)}`); else ids.set(s.id, p);
    if (!Number.isInteger(s.order) || s.order < 0) err('order_dup', `${p}.order`, 'order is an integer ≥ 0');
    else if (orders.has(s.order)) err('order_dup', `${p}.order`, `order ${s.order} is also ${orders.get(s.order)}`); else orders.set(s.order, p);
    for (const al of Array.isArray(s.aliases) ? s.aliases : []) {
      if (!ID_RE.test(str(al))) err('screen_id', `${p}.aliases`, 'an alias is a slug');
      else if (ids.has(al)) err('screen_dup', `${p}.aliases`, `alias ${al} is also ${ids.get(al)}`); else ids.set(al, `${p}.aliases`);
    }
    if (!GATES.includes(s.gate)) err('gate', `${p}.gate`, `gate is one of ${GATES.join(', ')}`);
    for (const r of Array.isArray(s.replaces) ? s.replaces : []) {
      if (!/^#\//.test(str(r))) err('replaces_dup', `${p}.replaces`, 'a replaced route starts with #/');
      else if (replaces.has(r)) err('replaces_dup', `${p}.replaces`, `${r} is also replaced by ${replaces.get(r)}`); else replaces.set(r, p);
    }
    read(s.state, `${p}.state`);
    if (s.rows !== undefined) {
      if (!isObj(s.rows) || !/^hub\.[a-z][a-z0-9-]*$/.test(str(s.rows.grid)) || !str(s.rows.idField) || !str(s.rows.path)) err('grid_dup', `${p}.rows`, 'rows: grid hub.<id>, idField, path');
      else if (grids.has(s.rows.grid)) err('grid_dup', `${p}.rows.grid`, `grid ${s.rows.grid} is also ${grids.get(s.rows.grid)}`); else grids.set(s.rows.grid, p);
      if (isObj(s.rows) && s.rows.read !== undefined) read(s.rows.read, `${p}.rows.read`);
    }
    const aids = new Set();
    (Array.isArray(s.actions) ? s.actions : []).forEach((a, j) => {
      const q = `${p}.actions.${j}`;
      if (!isObj(a)) { err('action_id', q, 'an action is an object'); return; }
      if (!ID_RE.test(str(a.id))) err('action_id', `${q}.id`, 'action id is a slug');
      else if (aids.has(a.id)) err('action_dup', `${q}.id`, `action ${a.id} twice on ${s.id}`); else aids.add(a.id);
      if (!WHO.includes(a.who)) err('who', `${q}.who`, `who is one of ${WHO.join(', ')}`);
      if (!EFFECTS.includes(a.effect)) err('effect', `${q}.effect`, `effect is one of ${EFFECTS.join(', ')}`);
      if (a.who === 'person' && a.tool !== undefined && a.tool !== null) err('person_tool', `${q}.tool`, "a person action is Brett's tap: never a tool, CLI line or voice action");
      if (a.who !== 'person' && WHO.includes(a.who)) {
        if (!TOOL_RE.test(str(a.tool))) err('command_tool', `${q}.tool`, 'a command needs a hub_<name> tool');
        else if (tools.has(a.tool)) err('tool_dup', `${q}.tool`, `tool ${a.tool} is also ${tools.get(a.tool)}`); else tools.set(a.tool, q);
      }
      if (a.missing !== undefined && (!isObj(a.missing) || str(a.missing.why).length < 10 || str(a.missing.proposed).length < 5)) err('missing_shape', `${q}.missing`, 'missing: { why (≥ 10 chars), proposed (the hub route to grow), cli? }');
      const noHub = a.hub === null || a.hub === undefined || a.hub === '';
      if (noHub && !isObj(a.missing) && a.channel !== 'console' && !['read', 'navigate'].includes(a.effect)) err('hub_or_missing', `${q}.hub`, 'a write names its hub call, or says what the hub lacks (missing), or is console-only (channel: console)');
      if (a.effect === 'navigate' && noHub && !str(a.opens)) err('nav_opens', `${q}.opens`, 'a navigate with no hub call names the console address it opens');
      if (a.method !== undefined && !(a.method === 'POST' || (a.method === 'DELETE' && a.effect === 'destructive' && a.row === true))) err('effect', `${q}.method`, 'method is POST, or DELETE on a destructive row action that removes the row');
    });
    (Array.isArray(s.settings) ? s.settings : []).forEach((st, j) => {
      const q = `${p}.settings.${j}`;
      if (!isObj(st) || !SETTING_KEY_RE.test(str(st.key))) { err('setting_key', `${q}.key`, 'a setting key is axf.hub.<…>'); return; }
      if (keys.has(st.key)) err('setting_dup', `${q}.key`, `setting ${st.key} is also ${keys.get(st.key)}`); else keys.set(st.key, q);
      if (!SETTING_KINDS.includes(st.kind) || !str(st.label) || st.default === undefined) err('setting_key', q, 'a setting has kind, label and default');
      if (st.who !== undefined && !WHO.includes(st.who)) err('who', `${q}.who`, `who is one of ${WHO.join(', ')}`);
    });
  });
  if (t.home !== undefined && !ids.has(t.home)) err('home', 'home', 'home is a screen id');
  const dids = new Set();
  (Array.isArray(t.deferred) ? t.deferred : []).forEach((d, i) => {
    const p = `deferred.${i}`;
    if (!isObj(d) || !ID_RE.test(str(d.id)) || str(d.why).length < 10) { err('deferred_dup', p, 'a deferred area has id, title and why'); return; }
    if (dids.has(d.id)) err('deferred_dup', `${p}.id`, `deferred ${d.id} twice`); else dids.add(d.id);
    if (ids.has(d.id)) err('deferred_screen', `${p}.id`, `${d.id} is a screen, not deferred`);
  });
  return { ok: errors.length === 0, errors };
}

/** Throws on an invalid table (the message lists every problem); returns the table. */
export function assertHubConsole(table) {
  const r = validateHubConsole(table);
  if (!r.ok) throw new Error(`${FRAME}: ${r.errors.map((e) => `${e.path}: ${e.message} [${e.code}]`).join('; ')}`);
  return table;
}

/* ================================================================== lookups */

export const screensOf = (table) => (Array.isArray(table?.screens) ? [...table.screens].sort((a, b) => a.order - b.order) : []);
/** A screen by id, or by one of its `aliases` (the CLI's and voice's other words for it). */
export const screenOf = (table, id) => screensOf(table).find((s) => s.id === id) ?? screensOf(table).find((s) => Array.isArray(s.aliases) && s.aliases.includes(id)) ?? null;
/** Every word that names a screen: its id and its aliases. */
export const screenWords = (table) => screensOf(table).flatMap((s) => [s.id, ...(Array.isArray(s.aliases) ? s.aliases : [])]);
export const actionOf = (table, screen, id) => (screenOf(table, screen)?.actions ?? []).find((a) => a.id === id) ?? null;
/** The screen an empty route opens: `home`, else the lowest order. */
export const homeScreen = (table) => screenOf(table, table?.home) ?? screensOf(table)[0] ?? null;

/** True when `row` may name a row of the screen (its idPattern when it has one; never empty, never a path). */
export function rowIdOk(screen, row) {
  const r = str(row);
  if (!r || !screen?.rows || /[/\\]/.test(r) || r === '.' || r === '..' || r.length > 200) return false;
  return screen.rows.idPattern ? new RegExp(screen.rows.idPattern).test(r) : true;
}

/* ================================================================== addresses (console-control@1) */

export const screenAddress = (table, screen) => { const s = screenOf(table, screen); return s ? `view:${table.view}/tab:${table.tabRow}=${s.id}` : null; };

export function rowAddress(table, screen, row) {
  const s = screenOf(table, screen);
  if (!s || !rowIdOk(s, row)) return null;
  return `${screenAddress(table, s.id)}/grid:${s.rows.grid}/row:${row}`;
}

export function actionAddress(table, screen, action, row = null) {
  const a = actionOf(table, screen, action);
  if (!a) return null;
  const base = row === null || row === undefined || row === '' ? screenAddress(table, screen) : rowAddress(table, screen, row);
  return base ? `${base}/button:${action}` : null;
}

export function settingAddress(table, key) {
  const found = screensOf(table).some((s) => (s.settings ?? []).some((st) => st.key === key));
  return found ? `${SETTINGS_ROOT}${table.settingsSubtab}/setting:${key}` : null;
}

/* ================================================================== reaches */

const restRoot = (table) => `${REST_ROOT}/${table.plugin}`;
export const toolOf = (table, screen, action) => {
  const s = screenOf(table, screen);
  const a = actionOf(table, screen, action);
  if (!s || !a || a.who === 'person') return null;
  return str(a.tool) || `hub_${s.id.replace(/-/g, '_')}_${action.replace(/-/g, '_')}`;
};

/**
 * How one thing is reached on every transport: `{ rest, tool, cli, voice, deepLink, who, missing?, opens? }`.
 * A screen (no row, no action) is its read; a row is the row read; an action is the press. `person` actions keep their
 * REST route (the browser's own tap uses it, and it refuses anything but a wall admin's same-origin request) and have no
 * tool, CLI line or voice action. Null when the screen, row or action is not in the table.
 */
export function reachesOf(table, screen, { row = null, action = null } = {}) {
  const s = screenOf(table, screen);
  if (!s) return null;
  screen = s.id; // an alias is the screen's own word on the wire
  const root = restRoot(table);
  const hasRow = row !== null && row !== undefined && row !== '';
  if (hasRow && !rowIdOk(s, row)) return null;
  if (!action) {
    if (hasRow) return { rest: `GET ${root}/${screen}/${row}`, tool: str(s.rows?.read?.tool) || null, cli: `axf hub ${screen} ${row}`, voice: `hub.${screen}`, deepLink: rowAddress(table, screen, row), who: null };
    return { rest: `GET ${root}/${screen}`, tool: str(s.state?.tool) || null, cli: `axf hub ${screen}`, voice: `hub.${screen}`, deepLink: screenAddress(table, screen), who: null };
  }
  const a = actionOf(table, screen, action);
  if (!a) return null;
  const person = a.who === 'person';
  const rest = a.method === 'DELETE' && hasRow ? `DELETE ${root}/${screen}/${row}` : `POST ${root}/${screen}${hasRow ? `/${row}` : ''}/${action}`;
  const out = {
    rest,
    tool: toolOf(table, screen, action),
    cli: person ? null : `axf hub ${screen} ${action}${hasRow ? ` ${row}` : ''}${a.who === 'confirm' ? ' --confirm' : ''}`,
    voice: person ? null : `hub.${screen}.${camel(action)}`,
    deepLink: actionAddress(table, screen, action, hasRow ? row : null),
    who: a.who,
  };
  if (isObj(a.missing)) out.missing = str(a.missing.proposed);
  if (str(a.opens)) out.opens = a.opens;
  return out;
}

/* ================================================================== hash routes (the retired axHub web addresses) */

function parseReplaces(entry) {
  const [path, query = ''] = str(entry).replace(/^#\//, '').split('?');
  const segments = path.split('/').filter(Boolean);
  const keys = query.split('&').map((kv) => kv.split('=')[0]).filter(Boolean);
  return { segments, keys, literals: segments.filter((x) => !/^<.*>$/.test(x)).length };
}

/**
 * Where `#/<route>` of axHub web lands: `{ screen, params }` (params: `row` when it matches the screen's idPattern,
 * query values the route accepts, choice values checked against the read's params), `{ screen: null, deferred }` for an
 * area with no screen on either side, `null` when nothing matches. `#/`, `#` and '' open `home`.
 */
export function routeToScreen(table, hash) {
  const raw = str(hash).replace(/^#/, '').replace(/^\/+/, '');
  const [path, query = ''] = raw.split('?');
  const segs = path.split('/').filter(Boolean);
  if (!segs.length) { const h = homeScreen(table); return h ? { screen: h.id, params: {} } : null; }
  const candidates = [];
  for (const s of screensOf(table)) for (const entry of s.replaces ?? []) {
    const r = parseReplaces(entry);
    if (r.segments.length !== segs.length) continue;
    let ok = true; let row = null;
    for (let i = 0; i < segs.length; i++) {
      if (/^<.*>$/.test(r.segments[i])) { if (rowIdOk(s, segs[i])) row = segs[i]; continue; }
      if (r.segments[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) candidates.push({ s, r, row });
  }
  if (!candidates.length) {
    const d = (Array.isArray(table?.deferred) ? table.deferred : []).find((x) => x.id === segs[0]);
    return d && segs.length === 1 ? { screen: null, deferred: d.id } : null;
  }
  candidates.sort((a, b) => b.r.literals - a.r.literals);
  const { s } = candidates[0];
  const keys = new Set(); let row = null;
  for (const c of candidates) if (c.s === s) { c.r.keys.forEach((k) => keys.add(k)); if (c.row) row = c.row; }
  const params = {};
  if (row) params.row = row;
  for (const kv of query.split('&')) {
    const [k, v = ''] = kv.split('=').map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
    if (!k || !keys.has(k) || !v || v.length > 200) continue;
    const allowed = s.state?.params?.[k];
    if (Array.isArray(allowed) && !allowed.includes(v)) continue;
    if (/[\\]|\.\./.test(v)) continue;
    params[k] = v;
  }
  return { screen: s.id, params };
}

/* ================================================================== projections */

/** Everything a command may run: every action that is not a person's tap, with its tool and whether it needs a confirm. */
export function catalogActions(table) {
  const out = [];
  for (const s of screensOf(table)) for (const a of s.actions ?? []) {
    if (a.who === 'person') continue;
    out.push({ screen: s.id, action: a.id, tool: toolOf(table, s.id, a.id), who: a.who, effect: a.effect, confirm: a.who === 'confirm', row: a.row === true, label: a.label, ...(isObj(a.missing) ? { missing: a.missing.proposed } : {}), ...(str(a.opens) ? { opens: a.opens } : {}) });
  }
  return out;
}

/** `screen/action` of every person action: registered personOnly, absent from every command catalog. */
export const personActions = (table) => screensOf(table).flatMap((s) => (s.actions ?? []).filter((a) => a.who === 'person').map((a) => `${s.id}/${a.id}`));

/** What the hub still lacks: the follow-up item for the axHub repo and the parity check's `hubMissing` rows. */
export const hubMissing = (table) => screensOf(table).flatMap((s) => (s.actions ?? []).filter((a) => isObj(a.missing)).map((a) => ({ screen: s.id, action: a.id, proposed: a.missing.proposed, why: a.missing.why, ...(str(a.missing.cli) ? { cli: a.missing.cli } : {}) })));

/** Every registered setting with its screen and console address. */
export const settingsOf = (table) => screensOf(table).flatMap((s) => (s.settings ?? []).map((st) => ({ ...st, screen: s.id, address: settingAddress(table, st.key) })));

/** Every MCP tool the plugin registers: reads first, then commands; `{ tool, screen, kind: read|row|action, action?, who?, effect, confirm }`. */
export function toolsOf(table) {
  const out = [];
  for (const s of screensOf(table)) {
    if (str(s.state?.tool)) out.push({ tool: s.state.tool, screen: s.id, kind: 'read', effect: 'read', confirm: false });
    if (str(s.rows?.read?.tool)) out.push({ tool: s.rows.read.tool, screen: s.id, kind: 'row', effect: 'read', confirm: false });
  }
  for (const c of catalogActions(table)) out.push({ tool: c.tool, screen: c.screen, kind: 'action', action: c.action, who: c.who, effect: c.effect, confirm: c.confirm });
  return out;
}

/** The counts the fixture pins (so a table edit is a deliberate fixture edit too). */
export function countsOf(table) {
  const screens = screensOf(table);
  const actions = screens.flatMap((s) => s.actions ?? []);
  return {
    screens: screens.length, actions: actions.length, person: actions.filter((a) => a.who === 'person').length, commands: actions.filter((a) => a.who !== 'person').length,
    missing: hubMissing(table).length, tools: toolsOf(table).length, settings: settingsOf(table).length, deferred: (table?.deferred ?? []).length,
  };
}
