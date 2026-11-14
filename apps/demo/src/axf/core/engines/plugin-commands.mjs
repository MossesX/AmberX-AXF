/**
 * Plugin commands, automatically (build plugin-commands-auto, Brett Nov 3 2026: "every plugin, existing and new,
 * automatically exposes all of its commands and reads through control@1, so they appear in the REST API, the MCP
 * server and the CLI with no extra per-plugin work"). The `plugins` domain of control@1 (control-rules.mjs).
 *
 * ONE registry of every plugin's commands and reads, built from what a plugin already has, so nothing has to be
 * written twice:
 *   - its server routes (server/*.py, `@router.get|post|put|patch|delete("…")`): GET = a read, POST/PUT/PATCH = a
 *     command, DELETE = a destructive command (needs a confirm token);
 *   - its registered web actions (`rt.actions.register('<id>', …, { label })`, the action bus the menus, toolbars and
 *     search already use): commands run in the open console through the Console commands plugin (console.actions run);
 *   - its data folder (plugin-lifecycle@1 `lifecycle.dataDir`): the `data` read (list the files) and `data-file`
 *     (read one, JSON parsed, secrets redacted);
 *   - `info` (the plugin's manifest and this list), for every plugin;
 *   - plugin.json `commands` (plugin-commands@1): titles, descriptions, input schemas, output shapes, readOnly /
 *     destructive / confirm flags for any of the above, extra commands, and skips that say why.
 *
 * Pure (no IO): framework/cli/plugin-commands.mjs reads the files and hands their text
 * in. Every transport is a projection of the registry: `pluginCommandTools()` MCP tools `<plugin>_<command>`,
 * `pluginCommandRoutes()` REST `/api/control/<plugin>/<command>`, `pluginCommandCli()` `axf <plugin> <command>`.
 *
 * plugin.json:
 *   "commands": {
 *     "$axf": "plugin-commands@1",
 *     "auto": true,                       derive from routes, actions and data (default true)
 *     "items": [                          declared commands and overrides, matched by id, route or action
 *       { "id": "park", "title": "Park a plan", "description": "…", "route": "POST /plans/{id}/park",
 *         "input": { "type": "object", "properties": { … }, "required": [ … ] }, "output": "the plan",
 *         "readOnly": false, "destructive": false, "confirm": false },
 *       { "route": "GET /events", "skip": "server-sent events stream, not a command" }
 *     ],
 *     "noReads": "why this plugin has nothing to read"   (only when it truly has no data)
 *   }
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const PLUGIN_COMMANDS_FRAME = 'plugin-commands@1';
export const PLUGIN_COMMAND_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
/** How a command runs: a plugin server route, a web action in the open console, the plugin's data folder, its info. */
export const PLUGIN_COMMAND_RUNS = ['route', 'action', 'data', 'info'];
export const PLUGIN_COMMAND_EFFECTS = ['read', 'write', 'destructive', 'navigate'];
/** MCP tool names: [a-zA-Z0-9_-], at most 64 characters (the MCP spec's limit). */
export const PLUGIN_TOOL_MAX = 64;
/** The reads every plugin gets without declaring them. */
export const PLUGIN_AUTO_READS = ['info', 'data', 'data-file'];
/** The generic MCP tools (always there, whatever plugins are installed). */
export const PLUGIN_GENERIC_TOOLS = ['plugin_commands', 'plugin_read', 'plugin_run'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Words in a route or action id that mean it deletes or throws something away. */
const DESTRUCTIVE = /(^|[./:_-])(delete|remove|reset|restore|clear|wipe|purge|uninstall|discard|drop|kill|destroy|revoke|rollback)([./:_-]|$)/i;
/** Action ids that only open, show or move something (no data changes). */
const NAVIGATING = /(^|[.:_-])(open|show|settings|view|focus|toggle|accounts|wizard|help|pick|latest|stop|pause|resume)$/i;
/** GET routes that are endless streams (server-sent events): listed, never run as a read. */
const STREAMING = /(^|\/)(events|stream|sse|ws|socket|tail|live)(\/|$)/i;

/** A command or route id: lower case, digits and dashes. */
export const commandSlug = (s) => String(s ?? '').toLowerCase().replace(/\{([^}]+)\}/g, 'by-$1').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'root';

/* ================================================================== scanning (text in, facts out) */

/** Split on top-level commas (not inside brackets, parentheses or strings). */
function splitTop(s) {
  const out = []; let depth = 0; let cur = ''; let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q && s[i - 1] !== '\\') q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** The text between the bracket at `open` and its match. */
function balanced(src, open) {
  let depth = 0; let q = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === q && src[i - 1] !== '\\') q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') { depth--; if (depth === 0) return { text: src.slice(open + 1, i), end: i }; }
  }
  return { text: src.slice(open + 1), end: src.length };
}

const SCALAR = /^(str|int|float|bool|Optional\[(str|int|float|bool)\]|(str|int|float|bool) \| None|Literal\[.*\])$/;
const JSON_TYPE = { str: 'string', int: 'integer', float: 'number', bool: 'boolean' };

/**
 * The routes in a plugin's Python server source: [{ method, path, fn, doc, params, body, stream, line }]. `params` are
 * the handler's scalar parameters (path parameters, else query parameters); `body` = the handler reads a JSON body
 * (`request.json()`, a helper that does, or a dict / model parameter). Decorators the scanner can't read are counted
 * in `unread` so the lifecycle check can say so instead of silently missing a command.
 */
export function scanPythonRoutes(src, file = 'server/__init__.py') {
  const text = String(src ?? '');
  const routes = []; const unread = [];
  const re = /^[ \t]*@([A-Za-z_][\w]*)\.(get|post|put|patch|delete|websocket|api_route)\(/gm;
  let m;
  while ((m = re.exec(text))) {
    const line = text.slice(0, m.index).split('\n').length;
    const args = balanced(text, m.index + m[0].length - 1);
    const kind = m[2];
    const pm = /^\s*(?:path\s*=\s*)?(["'])(.*?)\1/.exec(args.text);
    if (!pm) { unread.push({ file, line, why: 'route path is not a string literal' }); continue; }
    const after = text.slice(args.end + 1);
    const dm = /^(?:\s*@[^\n]*\n)*\s*(async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(after);
    if (!dm) { unread.push({ file, line, why: 'no handler after the decorator' }); continue; }
    const sig = balanced(after, dm.index + dm[0].length - 1);
    const rest = after.slice(sig.end + 1);
    const docm = /^[^:]*:\s*\n?\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/.exec(rest);
    // the handler's body: up to the next line indented no deeper than the decorator
    const indent = /^[ \t]*/.exec(m[0])[0].length;
    const bodyEnd = rest.search(new RegExp(`\\n(?=[ \\t]{0,${indent}}[^ \\t\\n#)])`));
    const fnBody = bodyEnd < 0 ? rest : rest.slice(0, bodyEnd);
    const statusm = /status_code\s*=\s*(\d{3})/.exec(args.text);
    const methods = kind === 'api_route' ? ((/methods\s*=\s*\[([^\]]*)\]/.exec(args.text)?.[1] ?? '"GET"').match(/[A-Z]+/g) ?? ['GET']) : [kind === 'websocket' ? 'WEBSOCKET' : kind.toUpperCase()];
    const path = pm[2] || '/';
    const pathParams = [...path.matchAll(/\{([A-Za-z_]\w*)(?::[^}]*)?\}/g)].map((x) => x[1]);
    const params = []; let body = /\.json\(\)|_body\(|await\s+\w*body\w*\(/.test(fnBody);
    for (const p of splitTop(sig.text)) {
      const pmm = /^\*{0,2}([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*(?:=\s*([\s\S]+))?$/.exec(p);
      if (!pmm || p.startsWith('*')) continue;
      const [, name, typeRaw = '', defRaw] = pmm;
      const type = typeRaw.trim();
      if (/^(Request|HTTPConnection|WebSocket|BackgroundTasks|Response)$/.test(type) || /Depends\(/.test(defRaw ?? '')) continue;
      if (pathParams.includes(name)) { params.push({ name, in: 'path', type: JSON_TYPE[type] ?? 'string', required: true }); continue; }
      if (SCALAR.test(type) || (!type && defRaw !== undefined)) {
        const base = type.replace(/^Optional\[|\]$|\s*\|\s*None$/g, '');
        const enumm = /^Literal\[(.*)\]$/.exec(type);
        const def = defRaw === undefined ? undefined : defRaw.trim();
        params.push({ name, in: 'query', type: enumm ? 'string' : JSON_TYPE[base] ?? 'string', required: def === undefined,
          ...(enumm ? { enum: splitTop(enumm[1]).map((x) => x.replace(/^["']|["']$/g, '')) } : {}),
          ...(def !== undefined && /^(-?\d+(\.\d+)?|True|False|"[^"]*"|'[^']*')$/.test(def) ? { default: def === 'True' ? true : def === 'False' ? false : /^["']/.test(def) ? def.slice(1, -1) : Number(def) } : {}) });
        continue;
      }
      body = true; // a dict / list / model parameter is the JSON body
    }
    for (const method of methods) {
      routes.push({ method, path, fn: dm[2], doc: firstSentence(docm?.[1] ?? docm?.[2] ?? ''), params, body: method !== 'GET' && body, stream: method === 'WEBSOCKET' || (method === 'GET' && (STREAMING.test(path) || /EventSourceResponse|text\/event-stream/.test(fnBody))), status: statusm ? Number(statusm[1]) : undefined, file, line });
    }
  }
  return { routes, unread };
}

/** A handler name as a title: post_list → "Post list", list_ → "List". */
const humanize = (fn, method) => { const t = String(fn ?? '').replace(/_+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : method; };
const firstSentence = (s) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); const m = /^(.{1,240}?[.!?])(\s|$)/.exec(t); return (m ? m[1] : t.slice(0, 240)).trim(); };

/**
 * The actions a plugin's web sources register on the action bus: [{ id, label, context, file, line }]. `context` = the
 * handler reads a payload (a right-click row, a selection), so run from outside it needs input.args or does nothing.
 */
export function scanWebActions(src, file = 'web/index.tsx') {
  const text = String(src ?? '');
  const out = [];
  const re = /\b(?:rt|runtime|r)\.actions\.register\(\s*(['"`])([A-Za-z0-9_.:-]+)\1\s*,/g;
  let m;
  while ((m = re.exec(text))) {
    const line = text.slice(0, m.index).split('\n').length;
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 1200);
    const handler = /^\s*(async\s*)?\(([^)]*)\)/.exec(tail);
    const labelm = /\{\s*[^{}]*?\blabel:\s*(['"`])((?:\\.|(?!\1)[^\\]){1,160})\1/.exec(tail.split(/\n\s*rt\.actions\.register\(/)[0]);
    const searchable = !/searchable:\s*false/.test(tail.split('\n')[0] + (tail.split('\n')[1] ?? ''));
    out.push({ id: m[2], label: labelm ? labelm[2].replace(/\\(.)/g, '$1') : '', context: !!handler && /,\s*\w+/.test(handler[2]), searchable, file, line });
  }
  return out;
}

/* ================================================================== declarations */

/** plugin.json `commands`, cleaned. Unknown fields dropped; problems listed (the lifecycle check reports them). */
export function normalizeCommandsBlock(raw) {
  const errors = [];
  if (raw === undefined) return { block: { $axf: PLUGIN_COMMANDS_FRAME, auto: true, items: [] }, errors, declared: false };
  if (!isObj(raw)) return { block: { $axf: PLUGIN_COMMANDS_FRAME, auto: true, items: [] }, errors: ['commands must be an object ({ $axf: "plugin-commands@1", auto, items })'], declared: false };
  if (raw.$axf !== undefined && raw.$axf !== PLUGIN_COMMANDS_FRAME) errors.push(`commands.$axf must be ${PLUGIN_COMMANDS_FRAME}`);
  const items = [];
  (Array.isArray(raw.items) ? raw.items : []).forEach((it, i) => {
    if (!isObj(it)) { errors.push(`commands.items[${i}] must be an object`); return; }
    const n = {};
    for (const k of ['id', 'title', 'description', 'output', 'route', 'action', 'skip']) { const v = str(it[k], k === 'description' ? 800 : 300); if (v) n[k] = v; }
    for (const k of ['readOnly', 'destructive', 'confirm', 'navigate']) if (typeof it[k] === 'boolean') n[k] = it[k];
    if (it.input !== undefined) { if (isObj(it.input)) n.input = it.input; else errors.push(`commands.items[${i}].input must be a JSON Schema object`); }
    if (n.id && !ID.test(n.id)) errors.push(`commands.items[${i}].id "${n.id}" must be lower case letters, digits and dashes`);
    if (n.route) { const rm = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)$/.exec(n.route); if (!rm) errors.push(`commands.items[${i}].route must be "<METHOD> /path"`); }
    if (!n.id && !n.route && !n.action) errors.push(`commands.items[${i}] needs an id, a route or an action`);
    if (it.skip !== undefined && !n.skip) errors.push(`commands.items[${i}].skip must say why`);
    if (!n.skip && !n.route && !n.action && n.id && !PLUGIN_AUTO_READS.includes(n.id)) errors.push(`commands.items[${i}] (${n.id}) needs a route or an action to run`);
    items.push(n);
  });
  const noReads = str(raw.noReads, 300);
  return { block: { $axf: PLUGIN_COMMANDS_FRAME, auto: raw.auto !== false, items, ...(noReads ? { noReads } : {}) }, errors, declared: true };
}

/** A read or a command, with every field filled. */
function command(fields) {
  const effect = fields.effect;
  return {
    id: fields.id,
    title: fields.title || fields.id,
    description: fields.description || '',
    kind: effect === 'read' ? 'read' : 'command',
    effect,
    readOnly: effect === 'read',
    destructive: effect === 'destructive',
    confirm: effect === 'destructive' || fields.confirm === true,
    run: fields.run,
    input: fields.input ?? { type: 'object', properties: {}, additionalProperties: true },
    output: fields.output || '',
    source: fields.source,
    ...(fields.context ? { context: true } : {}),
  };
}

function routeInput(r) {
  const properties = {}; const required = [];
  for (const p of r.params) {
    properties[p.name] = { type: p.type, ...(p.enum ? { enum: p.enum } : {}), ...(p.default !== undefined ? { default: p.default } : {}), description: p.in === 'path' ? 'path parameter' : 'query parameter' };
    if (p.required) required.push(p.name);
  }
  if (r.body) properties.body = { type: 'object', description: 'the JSON body the route takes (fields as the plugin documents them); other unknown input fields are sent in it too' };
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: !!r.body };
}

/** Effect of a route by its method and words (DELETE, or a POST named delete/reset/… = destructive). */
export function routeEffect(method, path) {
  if (method === 'GET') return 'read';
  if (method === 'DELETE' || DESTRUCTIVE.test(path)) return 'destructive';
  return 'write';
}
/** Effect of a web action by its id. */
export function actionEffect(id) {
  if (DESTRUCTIVE.test(id)) return 'destructive';
  if (NAVIGATING.test(id)) return 'navigate';
  return 'write';
}

/** The id a route gets: its path as words; another method on the same path adds the verb (set, delete, run). */
function routeIds(routes) {
  const byPath = new Map();
  for (const r of routes) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r.method]);
  const verb = { POST: 'run', PUT: 'set', PATCH: 'update', DELETE: 'delete' };
  return routes.map((r) => {
    const base = commandSlug(r.path);
    const shared = (byPath.get(r.path) ?? []).length > 1;
    // a delete always says so in its id (its MCP tool name reads as one), unless the path already does
    const says = r.method === 'DELETE' && !DESTRUCTIVE.test(r.path);
    return (shared && r.method !== 'GET') || says ? `${base === 'root' ? '' : `${base}-`}${verb[r.method]}`.replace(/^-/, '') : base;
  });
}

/**
 * Every command and read of one plugin. `plugin` = { folder, app?, manifest, routes, unread?, actions, hasData }.
 * Declared items win over derived ones (matched by route, action or id); skips are kept in `skipped` with their why.
 */
export function derivePluginCommands(plugin) {
  const folder = plugin.folder;
  const manifest = isObj(plugin.manifest) ? plugin.manifest : {};
  const { block, errors } = normalizeCommandsBlock(manifest.commands);
  const out = []; const skipped = [];
  const declaredFor = (pred) => block.items.find(pred);
  const add = (c) => { if (!out.some((x) => x.id === c.id)) out.push(c); else errors.push(`two commands are called ${c.id}: give one an id in plugin.json commands.items`); };
  // one handler under two spellings of a path ("" and "/") is one route
  const routes = (plugin.routes ?? []).filter((r) => PLUGIN_COMMAND_METHODS.includes(r.method) || r.method === 'WEBSOCKET')
    .filter((r, i, all) => all.findIndex((x) => x.method === r.method && x.fn === r.fn && commandSlug(x.path) === commandSlug(r.path)) === i);
  const ids = routeIds(routes);
  // two routes that would get the same id: the handler's name tells them apart
  ids.forEach((id, i) => { if (ids.indexOf(id) !== i || ids.lastIndexOf(id) !== i) ids[i] = `${id}-${commandSlug(routes[i].fn)}`.slice(0, 63); });

  if (block.auto) {
    routes.forEach((r, i) => {
      const key = `${r.method} ${r.path}`;
      const d = declaredFor((x) => x.route === key);
      if (d?.skip) { skipped.push({ route: key, why: d.skip }); return; }
      if (r.method === 'WEBSOCKET') { skipped.push({ route: key, why: 'a WebSocket (live channel, not a command)' }); return; }
      if (r.stream && !d) { skipped.push({ route: key, why: 'a live stream (server-sent events), not a command' }); return; }
      const effect = d?.readOnly ? 'read' : d?.destructive ? 'destructive' : d?.navigate ? 'navigate' : d?.readOnly === false && r.method === 'GET' ? 'write' : routeEffect(r.method, r.path);
      add(command({ id: d?.id || ids[i], title: d?.title || (routes.filter((x) => x.fn === r.fn).length > 1 ? `${humanize(r.fn, r.method)}: ${r.path.replace(/^\//, '') || 'root'}` : humanize(r.fn, r.method)),  description: d?.description || r.doc || `${r.method} /api/plugins/${folder}${r.path === '/' ? '' : r.path}`,
        effect, confirm: d?.confirm, run: { route: { method: r.method, path: r.path, params: r.params.map((p) => ({ name: p.name, in: p.in })), body: r.body } },
        input: d?.input ?? routeInput(r), output: d?.output, source: d ? 'declared' : 'route' }));
    });
    for (const a of plugin.actions ?? []) {
      const d = declaredFor((x) => x.action === a.id);
      if (d?.skip) { skipped.push({ action: a.id, why: d.skip }); continue; }
      const id = d?.id || `action-${commandSlug(a.id.startsWith(`${folder}.`) ? a.id.slice(folder.length + 1) : a.id)}`;
      if (out.some((x) => x.id === id)) continue; // the same action registered twice (two hosts): one command
      const effect = d?.readOnly ? 'read' : d?.destructive ? 'destructive' : d?.navigate ? 'navigate' : actionEffect(a.id);
      add(command({ id, title: d?.title || a.label || a.id, description: d?.description || `Runs the ${a.id} action in the open console${a.context ? ' (it acts on the row or selection in input.args)' : ''}.`,
        effect, confirm: d?.confirm, run: { action: a.id }, input: d?.input ?? { type: 'object', properties: { args: { description: 'the action\'s arguments ("a:b" or a list)' }, to: { type: 'string', description: 'recent (default), all, or a console client id' } }, additionalProperties: false },
        output: d?.output || 'which consoles ran it', source: d ? 'declared' : 'action', context: a.context }));
    }
  }
  // declared items that name neither a scanned route nor a scanned action: extra commands (or stale ones)
  for (const d of block.items) {
    if (d.skip) { if (!skipped.some((s) => s.route === d.route || s.action === d.action)) skipped.push({ ...(d.route ? { route: d.route } : {}), ...(d.action ? { action: d.action } : {}), ...(d.id ? { id: d.id } : {}), why: d.skip }); continue; }
    if (d.route && routes.some((r) => `${r.method} ${r.path}` === d.route) && block.auto) continue;
    if (d.action && (plugin.actions ?? []).some((a) => a.id === d.action) && block.auto) continue;
    if (!d.route && !d.action) continue;
    if (d.route && !routes.some((r) => `${r.method} ${r.path}` === d.route)) { errors.push(`commands.items: route ${d.route} is not in the plugin's server`); continue; }
    const [method, path] = d.route ? d.route.split(/\s+/) : [];
    const r = d.route ? routes.find((x) => x.method === method && x.path === path) : null;
    const effect = d.readOnly ? 'read' : d.destructive ? 'destructive' : d.navigate ? 'navigate' : d.route ? routeEffect(method, path) : actionEffect(d.action);
    add(command({ id: d.id || (d.route ? commandSlug(path) : `action-${commandSlug(d.action)}`), title: d.title, description: d.description, effect, confirm: d.confirm,
      run: d.route ? { route: { method, path, params: (r?.params ?? []).map((p) => ({ name: p.name, in: p.in })), body: r?.body ?? method !== 'GET' } } : { action: d.action },
      input: d.input ?? (r ? routeInput(r) : undefined), output: d.output, source: 'declared' }));
  }
  // the reads every plugin gets
  const auto = (id, title, description, run, input) => { if (!out.some((x) => x.id === id)) out.push(command({ id, title, description, effect: 'read', run, input, source: 'auto' })); };
  auto('info', 'Plugin info', `What ${manifest.name || folder} is and does: its manifest (name, version, description, what it provides and needs) and every command and read it has.`, { info: true });
  if (plugin.hasData) {
    auto('data', 'Data files', `The files in ${manifest.name || folder}'s data folder (${manifest.lifecycle?.dataDir ?? 'lifecycle.dataDir'}): path, size, changed.`, { data: 'list' }, { type: 'object', properties: { dir: { type: 'string', description: 'a sub-folder (default: the whole data folder)' } }, additionalProperties: false });
    auto('data-file', 'Read a data file', `One file from ${manifest.name || folder}'s data folder: JSON parsed, text as text, secrets redacted.`, { data: 'get' }, { type: 'object', properties: { file: { type: 'string', description: 'its path in the data folder (data lists them)' } }, required: ['file'], additionalProperties: false });
  }
  return { folder, commands: out, skipped, errors, unread: plugin.unread ?? [], noReads: block.noReads ?? '', declared: manifest.commands !== undefined };
}

/* ================================================================== the registry */

/**
 * The registry: one entry per plugin, the console's first. `plugins` = [{ folder, app, manifest, routes, unread, actions, hasData, enabled }].
 * `app` names where the plugin runs (console-web, amberx-droid, axhub-web); only the console's plugins run here.
 */
export function pluginCommandRegistry(plugins) {
  const entries = (plugins ?? []).map((p) => {
    const d = derivePluginCommands(p);
    const m = isObj(p.manifest) ? p.manifest : {};
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 60) : []);
    return { folder: p.folder, app: p.app || 'console-web', id: str(m.id, 160), name: str(m.name, 120) || p.folder, version: str(m.version, 40), description: str(m.description, 2000),
      provides: list(m.provides), needs: [...list(m.needs), ...list(m.requires)], optional: list(m.optional), dataDir: str(m.lifecycle?.dataDir, 300), enabled: p.enabled !== false, ...d };
  }).sort((a, b) => (a.app === b.app ? a.folder.localeCompare(b.folder) : a.app === 'console-web' ? -1 : b.app === 'console-web' ? 1 : a.app.localeCompare(b.app)));
  return { $axf: PLUGIN_COMMANDS_FRAME, plugins: entries };
}

/** `<plugin>/<command>` → { plugin, command } in the registry, or null. App-qualified paths (`amberx-droid:notes/…`) too. */
export function resolvePluginCommand(registry, path) {
  const m = /^(?:([a-z0-9-]+):)?([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/.exec(String(path ?? '').trim());
  if (!m) return null;
  const [, app, folder, id] = m;
  const plugin = (registry?.plugins ?? []).find((p) => p.folder === folder && (!app || p.app === app) && (app || p.app === 'console-web'))
    ?? (registry?.plugins ?? []).find((p) => p.folder === folder && (!app || p.app === app));
  const cmd = plugin?.commands.find((c) => c.id === id);
  return plugin && cmd ? { plugin, command: cmd } : null;
}

/** Everything wrong with an input for a command (required fields, types of the declared properties). */
export function pluginInputErrors(cmd, input) {
  const errs = [];
  const v = input === undefined || input === null ? {} : input;
  if (!isObj(v)) return ['input must be an object'];
  const schema = isObj(cmd?.input) ? cmd.input : {};
  for (const k of Array.isArray(schema.required) ? schema.required : []) if (v[k] === undefined || v[k] === '') errs.push(`input.${k} is required`);
  const props = isObj(schema.properties) ? schema.properties : {};
  for (const [k, x] of Object.entries(v)) {
    const p = props[k];
    if (!p) { if (schema.additionalProperties === false) errs.push(`input.${k} is not an input of ${cmd.id} (it takes ${Object.keys(props).join(', ') || 'nothing'})`); continue; }
    const t = p.type;
    if (t === 'integer' && !(Number.isInteger(x) || (typeof x === 'string' && /^-?\d+$/.test(x)))) errs.push(`input.${k} must be a whole number`);
    else if (t === 'number' && !(typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))))) errs.push(`input.${k} must be a number`);
    else if (t === 'boolean' && !(typeof x === 'boolean' || x === 'true' || x === 'false')) errs.push(`input.${k} must be true or false`);
    else if (t === 'object' && !isObj(x)) errs.push(`input.${k} must be an object`);
    if (Array.isArray(p.enum) && !p.enum.includes(x)) errs.push(`input.${k} must be one of: ${p.enum.join(', ')}`);
  }
  return errs;
}

/**
 * The HTTP request a route command makes: { method, path, query, body } with path parameters filled in (URL-encoded)
 * and the plugin mount in front. Query parameters go in the query; for POST / PUT / PATCH everything else (and
 * input.body) is the JSON body.
 */
export function pluginRouteRequest(folder, cmd, input = {}) {
  const r = cmd.run.route;
  const v = isObj(input) ? { ...input } : {};
  let path = r.path;
  for (const p of r.params.filter((x) => x.in === 'path')) { path = path.replace(new RegExp(`\\{${p.name}(?::[^}]*)?\\}`), encodeURIComponent(String(v[p.name] ?? ''))); delete v[p.name]; }
  const query = {};
  for (const p of r.params.filter((x) => x.in === 'query')) if (v[p.name] !== undefined) { query[p.name] = typeof v[p.name] === 'object' ? JSON.stringify(v[p.name]) : String(v[p.name]); delete v[p.name]; }
  let body = null;
  if (r.method !== 'GET' && r.method !== 'DELETE') body = isObj(v.body) ? { ...v.body, ...Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'body')) } : (Object.keys(v).length ? v : (r.body ? {} : null));
  else if (r.method === 'DELETE' && isObj(v.body)) body = v.body;
  return { method: r.method, path: `/api/plugins/${folder}${path === '/' ? '' : path}`, query, body };
}

/* ================================================================== projections */

/** The MCP tool name of a command: `<plugin>_<command>`, dashes as underscores, at most 64 characters. */
export function commandToolName(folder, id, app = 'console-web') {
  const base = `${app === 'console-web' ? '' : `${app}_`}${folder}_${id}`.replace(/[^A-Za-z0-9_]+/g, '_');
  if (base.length <= PLUGIN_TOOL_MAX) return base;
  let h = 5381; for (let i = 0; i < base.length; i++) h = ((h * 33) ^ base.charCodeAt(i)) >>> 0;
  return `${base.slice(0, PLUGIN_TOOL_MAX - 7)}_${h.toString(36).padStart(6, '0').slice(-6)}`;
}

/** The control@1 command a plugin command is: a read = act read on plugins.reads, the rest = act run on plugins.commands. */
export function pluginControlCommand(folder, cmd, input = {}, extra = {}) {
  return { $axf: 'control@1', op: 'act', target: cmd.kind === 'read' ? 'plugins.reads' : 'plugins.commands', path: `${folder}/${cmd.id}`, action: cmd.kind === 'read' ? 'read' : 'run', input, ...extra };
}

/** MCP tools: one per command of every enabled console plugin (`<plugin>_<command>`), annotations from its effect. */
export function pluginCommandTools(registry) {
  const tools = [];
  for (const p of registry?.plugins ?? []) {
    if (p.app !== 'console-web' || p.enabled === false) continue;
    for (const c of p.commands) {
      tools.push({
        name: commandToolName(p.folder, c.id), title: `${p.name}: ${c.title}`.slice(0, 120),
        description: `${c.description || c.title}${c.confirm ? ' Needs a confirm token: the first call answers confirmation_required with one; call again with confirm set to it.' : ''}${c.context ? ' Acts on a row or selection: pass it in input.args.' : ''} (control@1 ${c.kind === 'read' ? 'plugins.reads read' : 'plugins.commands run'} ${p.folder}/${c.id})`.slice(0, 1000),
        inputSchema: { type: 'object', properties: { input: c.input, ...(c.kind === 'read' ? {} : { by: { type: 'string', description: 'who asks (audited)' }, reason: { type: 'string', description: 'why (audited)' } }), ...(c.confirm ? { confirm: { type: 'string', description: 'the confirm token from the first call' } } : {}) }, additionalProperties: false },
        annotations: { readOnlyHint: c.effect === 'read', destructiveHint: c.effect === 'destructive', idempotentHint: c.effect === 'read', openWorldHint: false },
        plugin: p.folder, command: c.id, kind: c.kind, effect: c.effect,
      });
    }
  }
  return tools;
}

/** REST: GET /api/control/<plugin>/<read> (input as query parameters), POST /api/control/<plugin>/<command> (input as the body). */
export function pluginCommandRoutes(registry) {
  const out = [];
  for (const p of registry?.plugins ?? []) {
    if (p.app !== 'console-web') continue;
    for (const c of p.commands) out.push({ plugin: p.folder, command: c.id, method: c.kind === 'read' ? 'GET' : c.effect === 'destructive' ? 'DELETE' : 'POST', path: `/api/control/${p.folder}/${c.id}`, ...(c.kind === 'read' ? { query: 'input fields' } : { body: '{ input?, by?, reason?, confirm? } or the input fields themselves' }) });
  }
  return out;
}

/** CLI: `axf <plugin> <command> [--field value]… [--json]` (also `axf plugin <plugin> <command>`). */
export function pluginCommandCli(registry) {
  const lines = [];
  for (const p of registry?.plugins ?? []) {
    if (p.app !== 'console-web') continue;
    for (const c of p.commands) {
      const props = Object.entries(c.input?.properties ?? {}).filter(([k]) => k !== 'to');
      const req = new Set(c.input?.required ?? []);
      lines.push({ plugin: p.folder, command: c.id, usage: `axf ${p.folder} ${c.id}${props.map(([k]) => (req.has(k) ? ` --${k} <${k}>` : ` [--${k} <${k}>]`)).join('')}${c.confirm ? ' [--confirm <token>]' : ''}`, help: c.title });
    }
  }
  return { usage: ['axf plugins [plugin]                      every plugin and its commands (or one plugin\'s)', 'axf <plugin> <command> [--field value]… run a command or a read (also: axf plugin <plugin> <command> …)', 'axf <plugin> <command> --help            what it does and what it takes'], commands: lines };
}

/** Help text for one plugin (CLI `axf <plugin> --help`, the docs page). */
export function pluginHelp(entry) {
  const lines = [`${entry.name} (${entry.folder}) — ${entry.commands.length} commands and reads${entry.enabled === false ? ' (turned off)' : ''}`];
  for (const kind of ['read', 'command']) {
    const cs = entry.commands.filter((c) => c.kind === kind);
    if (!cs.length) continue;
    lines.push('', kind === 'read' ? 'Reads:' : 'Commands:');
    for (const c of cs) lines.push(`  ${c.id.padEnd(28)} ${c.title}${c.confirm ? '  [confirm]' : ''}${c.effect === 'navigate' ? '  [opens]' : ''}`);
  }
  if (entry.skipped.length) { lines.push('', 'Not commands:'); for (const s of entry.skipped) lines.push(`  ${(s.route || s.action || s.id).padEnd(28)} ${s.why}`); }
  return lines.join('\n');
}

/* ================================================================== coverage (the lifecycle check, CI) */

/**
 * What a plugin is missing: errors fail the lifecycle check (a route or action the registry can't expose, a declaration
 * that names something gone, no reads at all without saying why, no commands block); warnings are shown.
 */
export function pluginCommandCoverage(entry, { requireBlock = true } = {}) {
  const errors = [...entry.errors];
  const warnings = [];
  for (const u of entry.unread ?? []) errors.push(`${u.file}:${u.line}: ${u.why}, so its route can't be exposed (give it a literal path, or declare it in plugin.json commands.items)`);
  const reads = entry.commands.filter((c) => c.kind === 'read' && c.id !== 'info');
  if (!reads.length && !entry.noReads) errors.push('no reads: add a GET route, a data folder (lifecycle.dataDir) or a declared read, or say why in plugin.json commands.noReads');
  if (requireBlock && !entry.declared) errors.push('plugin.json has no commands block (add "commands": { "$axf": "plugin-commands@1", "auto": true })');
  for (const s of entry.skipped) if (!s.why) errors.push(`${s.route || s.action || s.id} is skipped without saying why`);
  for (const c of entry.commands) if (c.context) warnings.push(`${c.id} acts on a row or selection in the console: it needs input.args from outside`);
  return { ok: errors.length === 0, errors, warnings, reads: reads.length, commands: entry.commands.filter((c) => c.kind === 'command').length };
}
