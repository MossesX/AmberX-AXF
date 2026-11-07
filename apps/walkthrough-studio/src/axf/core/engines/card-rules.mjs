/**
 * card rules — card@1 (Brett, Nov 3 2026: "I shouldn't need to build cards. I should draw dynamic data."). A card is a
 * data binding, not a design: which read it draws (any plugin read command from the plugin-commands@1 registry, which
 * control@1 already exposes as REST, MCP and CLI, or a read the host app provides), the arguments, a path into the
 * result, an optional filter and reduction, the view that draws it (number, list, meter, chart, feed, table, status,
 * and whatever views a host registers), how it refreshes (live, every N seconds, by hand), and its title, icon and
 * size. Every colour and size comes from the theme through the view's tokens; a card carries none.
 *
 * ONE registry (CARD_ENUMS, CARD_DEFAULTS, the view registry) drives both validators (core/validate.ts and the build
 * engine), the normaliser, the smart view pick, the view models, the suggestions and the Home layout every driver
 * uses (the console's Home, any app that shows cards). Pure, no I/O, no network and no language model: a card costs
 * zero tokens to make, show or refresh (spec/check-card.mjs fails CI on any LLM import here).
 */

export const CARD_TYPE = 'card';
export const HOME_LAYOUT = 'home-layout@1';
/** What a dragged hook or data element carries (drop-target contract for Home; JSON of a card draft). */
export const CARD_DROP_MIME = 'application/x-axf-card+json';

/* ================================================================== registry */

/** Built-in views. The registry is open: hosts add views with registerCardView (the list below never shrinks). */
const BUILTIN_VIEWS = [
  { id: 'number', label: 'Number', icon: 'chart', fields: ['label', 'unit'], about: 'One big value (a count, a total, a single reading).' },
  { id: 'list', label: 'List', icon: 'list', fields: ['title', 'subtitle', 'badge'], about: 'One line per item.' },
  { id: 'meter', label: 'Meter', icon: 'sliders', fields: ['label', 'value', 'max'], about: 'A bar per item (or one), value out of max.' },
  { id: 'chart', label: 'Chart', icon: 'chart', fields: ['x', 'y'], about: 'A line, bar or spark chart of a series.' },
  { id: 'feed', label: 'Feed', icon: 'clock', fields: ['title', 'at', 'subtitle'], about: 'Newest first, with the time.' },
  { id: 'table', label: 'Table', icon: 'grid', fields: ['columns'], about: 'Rows and columns (or key and value).' },
  { id: 'status', label: 'Status', icon: 'check-circle', fields: ['state', 'label'], about: 'One state, coloured by the theme (ok, waiting, failed).' },
  { id: 'panel', label: 'Panel', icon: 'box', fields: [], about: 'The host app\'s own renderer for one of its reads (never picked automatically).' },
];
const views = new Map(BUILTIN_VIEWS.map((v) => [v.id, v]));

/** Add a view to the open registry (a host's own renderer draws it; the engine only validates and lists it). */
export function registerCardView(v) {
  if (!v || typeof v.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(v.id)) throw new Error('a card view needs an id (lowercase, up to 40)');
  if (BUILTIN_VIEWS.some((b) => b.id === v.id)) return views.get(v.id);
  views.set(v.id, { label: v.id, icon: 'box', fields: [], about: '', ...v, host: true });
  return views.get(v.id);
}
export const cardViews = () => [...views.values()];
export const cardViewIds = () => [...views.keys()];

export const CARD_ENUMS = {
  source: ['command', 'console'],
  refresh: ['live', 'every', 'manual'],
  size: ['s', 'm', 'l', 'wide'],
  chart: ['line', 'bar', 'spark'],
  reduce: ['none', 'count', 'sum', 'avg', 'min', 'max', 'first', 'last'],
};

export const CARD_LIMITS = { title: 60, path: 200, args: 20, fields: 12, every: [5, 86400], items: [1, 200], channels: 8 };

export const CARD_DEFAULTS = {
  title: '',
  icon: 'box',
  source: { kind: 'command', plugin: '', command: '', id: '' },
  args: {},
  path: '',
  where: {},
  reduce: 'none',
  view: 'auto',
  chart: 'line',
  fields: {},
  refresh: { kind: 'every', every: 60, channels: [] },
  size: 'm',
  limit: 8,
  unit: '',
};

/* ================================================================== validation + normalising */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Errors in a card@1 data block (empty = valid). Other types answer []. */
export function cardErrors(type, data) {
  if (type !== CARD_TYPE) return [];
  const e = [];
  if (!isObj(data)) return ['data must be an object'];
  const s = data.source;
  if (!isObj(s)) e.push('data.source must be an object { kind, plugin, command } or { kind: "console", id }');
  else {
    if (!CARD_ENUMS.source.includes(s.kind)) e.push(`data.source.kind must be one of ${CARD_ENUMS.source.join(', ')}`);
    if (s.kind === 'command') {
      if (!SLUG.test(String(s.plugin ?? ''))) e.push('data.source.plugin must be a plugin folder');
      if (!SLUG.test(String(s.command ?? ''))) e.push('data.source.command must be one of the plugin\'s read commands');
    }
    if (s.kind === 'console' && !SLUG.test(String(s.id ?? ''))) e.push('data.source.id must name a host read (e.g. tracker.coverage)');
  }
  if (data.title !== undefined && (typeof data.title !== 'string' || data.title.length > CARD_LIMITS.title)) e.push(`data.title must be a string up to ${CARD_LIMITS.title}`);
  if (data.args !== undefined && (!isObj(data.args) || Object.keys(data.args).length > CARD_LIMITS.args)) e.push(`data.args must be an object (up to ${CARD_LIMITS.args} keys)`);
  if (data.path !== undefined && (typeof data.path !== 'string' || data.path.length > CARD_LIMITS.path)) e.push('data.path must be a dotted path string');
  if (data.where !== undefined && !isObj(data.where)) e.push('data.where must be an object { field: value }');
  if (data.reduce !== undefined && !CARD_ENUMS.reduce.includes(data.reduce)) e.push(`data.reduce must be one of ${CARD_ENUMS.reduce.join(', ')}`);
  if (data.view !== undefined && data.view !== 'auto' && !views.has(data.view)) e.push(`data.view must be auto or one of ${cardViewIds().join(', ')}`);
  if (data.chart !== undefined && !CARD_ENUMS.chart.includes(data.chart)) e.push(`data.chart must be one of ${CARD_ENUMS.chart.join(', ')}`);
  if (data.fields !== undefined && (!isObj(data.fields) || Object.keys(data.fields).length > CARD_LIMITS.fields)) e.push('data.fields must be an object { role: field path }');
  if (data.size !== undefined && !CARD_ENUMS.size.includes(data.size)) e.push(`data.size must be one of ${CARD_ENUMS.size.join(', ')}`);
  if (data.limit !== undefined && !(Number.isInteger(data.limit) && data.limit >= CARD_LIMITS.items[0] && data.limit <= CARD_LIMITS.items[1])) e.push(`data.limit must be ${CARD_LIMITS.items[0]}–${CARD_LIMITS.items[1]}`);
  const r = data.refresh;
  if (r !== undefined) {
    if (!isObj(r) || !CARD_ENUMS.refresh.includes(r.kind)) e.push(`data.refresh.kind must be one of ${CARD_ENUMS.refresh.join(', ')}`);
    else if (r.kind === 'every' && !(Number.isFinite(r.every) && r.every >= CARD_LIMITS.every[0] && r.every <= CARD_LIMITS.every[1])) e.push(`data.refresh.every must be ${CARD_LIMITS.every[0]}–${CARD_LIMITS.every[1]} seconds`);
  }
  return e;
}

/** A card with every field filled (defaults for anything missing, unknown fields dropped, values clamped). */
export function normalizeCard(raw) {
  const d = isObj(raw) ? raw : {};
  const s = isObj(d.source) ? d.source : {};
  const kind = CARD_ENUMS.source.includes(s.kind) ? s.kind : 'command';
  const r = isObj(d.refresh) ? d.refresh : {};
  const rk = CARD_ENUMS.refresh.includes(r.kind) ? r.kind : CARD_DEFAULTS.refresh.kind;
  const every = Math.min(CARD_LIMITS.every[1], Math.max(CARD_LIMITS.every[0], Number.isFinite(r.every) ? Math.round(r.every) : CARD_DEFAULTS.refresh.every));
  const fields = {};
  if (isObj(d.fields)) for (const [k, v] of Object.entries(d.fields).slice(0, CARD_LIMITS.fields)) if (typeof v === 'string' || Array.isArray(v)) fields[k] = Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, CARD_LIMITS.fields) : v.slice(0, CARD_LIMITS.path);
  return {
    title: str(d.title, CARD_LIMITS.title),
    icon: str(d.icon, 40) || CARD_DEFAULTS.icon,
    source: kind === 'command' ? { kind, plugin: str(s.plugin, 64), command: str(s.command, 64) } : { kind, id: str(s.id, 64) },
    args: isObj(d.args) ? Object.fromEntries(Object.entries(d.args).slice(0, CARD_LIMITS.args)) : {},
    path: str(d.path, CARD_LIMITS.path),
    where: isObj(d.where) ? { ...d.where } : {},
    reduce: CARD_ENUMS.reduce.includes(d.reduce) ? d.reduce : 'none',
    view: d.view === 'auto' || views.has(d.view) ? d.view : 'auto',
    chart: CARD_ENUMS.chart.includes(d.chart) ? d.chart : CARD_DEFAULTS.chart,
    fields,
    refresh: { kind: rk, every, channels: Array.isArray(r.channels) ? r.channels.filter((c) => typeof c === 'string').slice(0, CARD_LIMITS.channels) : [] },
    size: CARD_ENUMS.size.includes(d.size) ? d.size : CARD_DEFAULTS.size,
    limit: Number.isInteger(d.limit) ? Math.min(CARD_LIMITS.items[1], Math.max(CARD_LIMITS.items[0], d.limit)) : CARD_DEFAULTS.limit,
    unit: str(d.unit, 16),
  };
}

/** JSON Schema properties for the generated card.schema.json (the build engine adds the envelope). */
export function cardSchemaProperties() {
  return {
    title: { type: 'string', maxLength: CARD_LIMITS.title },
    icon: { type: 'string' },
    source: {
      type: 'object', required: ['kind'],
      properties: { kind: { enum: CARD_ENUMS.source }, plugin: { type: 'string' }, command: { type: 'string' }, id: { type: 'string' } },
    },
    args: { type: 'object' },
    path: { type: 'string', maxLength: CARD_LIMITS.path, description: 'dotted path into the result; * maps over a list or object' },
    where: { type: 'object', description: '{ field: value } keeps the items whose field equals the value' },
    reduce: { enum: CARD_ENUMS.reduce },
    view: { type: 'string', description: `auto or a registered view (${BUILTIN_VIEWS.map((v) => v.id).join(', ')}, …)` },
    chart: { enum: CARD_ENUMS.chart },
    fields: { type: 'object', description: '{ role: field path } for the view (title, subtitle, badge, label, value, max, x, y, at, state, columns)' },
    refresh: { type: 'object', properties: { kind: { enum: CARD_ENUMS.refresh }, every: { type: 'number', minimum: CARD_LIMITS.every[0], maximum: CARD_LIMITS.every[1] }, channels: { type: 'array', items: { type: 'string' } } } },
    size: { enum: CARD_ENUMS.size },
    limit: { type: 'integer', minimum: CARD_LIMITS.items[0], maximum: CARD_LIMITS.items[1] },
    unit: { type: 'string', maxLength: 16 },
  };
}

/* ================================================================== reading the result */

/** The value at a dotted path (`a.b.0.c`; `*` maps over a list or an object's values; '' = the whole value). */
export function pathGet(value, path) {
  const parts = String(path ?? '').split('.').filter(Boolean);
  let cur = [value];
  let mapped = false;
  for (const p of parts) {
    const next = [];
    for (const v of cur) {
      if (p === '*') { if (Array.isArray(v)) next.push(...v); else if (isObj(v)) next.push(...Object.values(v)); continue; }
      if (Array.isArray(v) && /^-?\d+$/.test(p)) { const i = Number(p); const x = v[i < 0 ? v.length + i : i]; if (x !== undefined) next.push(x); continue; }
      if (Array.isArray(v) && mapped) { for (const x of v) if (isObj(x) && p in x) next.push(x[p]); continue; }
      if (isObj(v) && p in v) next.push(v[p]);
    }
    if (p === '*') mapped = true;
    cur = next;
  }
  return mapped ? cur : cur[0];
}

/** Keep the items whose fields equal the `where` values (a value list = any of them). */
export function applyWhere(value, where) {
  if (!Array.isArray(value) || !isObj(where) || !Object.keys(where).length) return value;
  return value.filter((it) => Object.entries(where).every(([k, want]) => { const got = pathGet(it, k); return Array.isArray(want) ? want.includes(got) : got === want; }));
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Fold a list to one value. */
export function reduceValue(value, how) {
  if (!how || how === 'none') return value;
  const list = Array.isArray(value) ? value : isObj(value) ? Object.values(value) : [value];
  if (how === 'count') return list.length;
  if (how === 'first') return list[0];
  if (how === 'last') return list[list.length - 1];
  const ns = list.map(num).filter((n) => n !== null);
  if (!ns.length) return 0;
  if (how === 'sum') return round(ns.reduce((a, b) => a + b, 0));
  if (how === 'avg') return round(ns.reduce((a, b) => a + b, 0) / ns.length);
  if (how === 'min') return Math.min(...ns);
  if (how === 'max') return Math.max(...ns);
  return value;
}
const round = (n) => Math.round(n * 1000) / 1000;

const STATUS_FIELDS = ['status', 'state', 'health', 'result', 'conclusion'];
const TIME_FIELDS = ['at', 'createdAt', 'updatedAt', 'time', 'date', 'when', 'startedAt', 'lastSeenAt', 'ts'];
const TITLE_FIELDS = ['title', 'name', 'label', 'id', 'text', 'summary'];
const SUB_FIELDS = ['description', 'detail', 'kind', 'type', 'path', 'by', 'note'];
const isTime = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\d([T ]\d\d:\d\d)?/.test(v);

/**
 * The shape of a value, for the smart view pick: empty · number · boolean · text · status · series · rows · list ·
 * record. `series` = numbers, or rows with a numeric field over a time or x field; `status` = a short state word, or
 * an object with a status field and not much else.
 */
export function shapeOf(v) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length)) return 'empty';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return num(v) !== null ? 'number' : STATUS_WORDS.has(v.toLowerCase()) ? 'status' : 'text';
  if (Array.isArray(v)) {
    if (v.every((x) => num(x) !== null)) return 'series';
    const objs = v.filter(isObj);
    if (objs.length === v.length) {
      const keys = keysOf(objs);
      const numeric = keys.filter((k) => objs.every((o) => num(o[k]) !== null));
      const timeKey = keys.find((k) => objs.every((o) => isTime(o[k])));
      if (numeric.length && (timeKey || keys.includes('x')) && v.length > 2) return 'series';
      return 'rows';
    }
    return 'list';
  }
  if (isObj(v)) {
    const keys = Object.keys(v);
    const st = STATUS_FIELDS.find((k) => typeof v[k] === 'string');
    if (st && keys.length <= 4) return 'status';
    return 'record';
  }
  return 'text';
}
const keysOf = (objs) => [...new Set(objs.slice(0, 20).flatMap((o) => Object.keys(o)))];
const STATUS_WORDS = new Set(['ok', 'okay', 'up', 'down', 'online', 'offline', 'green', 'red', 'amber', 'yellow', 'running', 'waiting', 'pending', 'queued', 'done', 'complete', 'completed', 'built', 'failed', 'failure', 'error', 'success', 'passing', 'passed', 'broken', 'blocked', 'idle', 'busy', 'live', 'stopped', 'approved', 'rejected', 'changes', 'none', 'warning', 'healthy', 'unhealthy']);

/** The view a value is drawn with when the card says `auto`. */
export function pickView(v) {
  const s = shapeOf(v);
  if (s === 'number' || s === 'boolean') return 'number';
  if (s === 'status') return 'status';
  if (s === 'series') return 'chart';
  if (s === 'rows') {
    const objs = v.filter(isObj);
    const keys = keysOf(objs);
    if (keys.some((k) => TIME_FIELDS.includes(k))) return 'feed';
    return keys.length > 3 ? 'table' : 'list';
  }
  if (s === 'list') return 'list';
  if (s === 'record') return Object.values(v).every((x) => num(x) !== null) && Object.keys(v).length <= 12 ? 'meter' : 'table';
  return 'number';
}

/** Fields a picker offers for a value: every key of its rows (or of the record), numeric ones marked. */
export function fieldsOf(v) {
  const rows = Array.isArray(v) ? v.filter(isObj) : isObj(v) ? [v] : [];
  return keysOf(rows).map((k) => ({ id: k, numeric: rows.every((o) => num(o[k]) !== null), time: rows.every((o) => isTime(o[k])) }));
}

const firstKey = (keys, list) => list.find((k) => keys.includes(k));

/** The roles a view needs, filled from the value's keys (what the Add card dialog preselects). */
export function defaultFields(view, v) {
  const fs = fieldsOf(v);
  const keys = fs.map((f) => f.id);
  const numeric = fs.filter((f) => f.numeric).map((f) => f.id);
  const text = keys.filter((k) => !numeric.includes(k));
  const title = firstKey(keys, TITLE_FIELDS) ?? text[0];
  switch (view) {
    case 'list': return compact({ title, subtitle: firstKey(keys.filter((k) => k !== title), SUB_FIELDS), badge: firstKey(keys, STATUS_FIELDS) });
    case 'feed': return compact({ title, at: firstKey(keys, TIME_FIELDS), subtitle: firstKey(keys.filter((k) => k !== title), SUB_FIELDS) });
    case 'meter': return Array.isArray(v) ? compact({ label: title, value: numeric[0], max: numeric.find((k) => /max|total|of|limit|cap/i.test(k)) }) : {};
    case 'chart': return Array.isArray(v) && v.every(isObj) ? compact({ x: firstKey(keys, TIME_FIELDS) ?? (keys.includes('x') ? 'x' : text[0]), y: numeric.find((k) => k !== 'x') }) : {};
    case 'table': return Array.isArray(v) ? { columns: keys.slice(0, 6) } : {};
    case 'status': return isObj(v) ? compact({ state: firstKey(keys, STATUS_FIELDS), label: firstKey(keys, ['label', 'message', 'summary', 'title', 'name']) }) : {};
    default: return {};
  }
}
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Theme tone for a state word (the renderer maps tones to theme tokens: success, warning, danger, accent). */
export function statusTone(state) {
  const s = String(state ?? '').toLowerCase();
  if (/^(ok|okay|up|online|green|done|complete|completed|built|success|passing|passed|approved|healthy|live|true)$/.test(s)) return 'success';
  if (/^(waiting|pending|queued|amber|yellow|warning|changes|busy|blocked)$/.test(s)) return 'warning';
  if (/^(down|offline|red|failed|failure|error|broken|rejected|unhealthy|false)$/.test(s)) return 'danger';
  if (/^(running|in-progress|active)$/.test(s)) return 'accent';
  return '';
}

/* ================================================================== view models (what a renderer draws) */

const text = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(round(n)));
const field = (o, f) => (f ? pathGet(o, f) : undefined);

/**
 * Draw a card's result: pick out the value (path → where → reduce), choose the view (the card's, or the smart pick),
 * and return the plain model the renderer draws. Never throws: a value that doesn't fit gives `{ ok: false, message }`.
 */
export function cardModel(card, result) {
  const c = normalizeCard(card);
  let v = pathGet(result, c.path);
  if (c.path && v === undefined) return { ok: false, view: c.view, message: `Nothing at ${c.path} in the result.` };
  v = applyWhere(v, c.where);
  v = reduceValue(v, c.reduce);
  const view = c.view === 'auto' ? pickView(v) : c.view;
  const f = { ...defaultFields(view, v), ...c.fields };
  const out = { ok: true, view, shape: shapeOf(v), size: c.size };
  if (shapeOf(v) === 'empty') return { ...out, empty: true };
  const rows = Array.isArray(v) ? v : isObj(v) ? Object.entries(v).map(([k, x]) => (isObj(x) ? { key: k, ...x } : { key: k, value: x })) : [v];
  switch (view) {
    case 'number': {
      const n = typeof v === 'boolean' ? null : num(Array.isArray(v) || isObj(v) ? reduceValue(v, 'count') : v);
      return { ...out, value: n === null ? text(v) : fmt(n), raw: n, unit: c.unit, label: f.label ? text(field(result, f.label)) : '' };
    }
    case 'status': {
      const state = isObj(v) ? text(field(v, f.state ?? 'status')) : text(v);
      return { ...out, state, tone: statusTone(state), label: isObj(v) && f.label ? text(field(v, f.label)) : '' };
    }
    case 'list':
    case 'feed': {
      let items = rows.map((r) => (isObj(r)
        ? { title: text(field(r, f.title ?? 'key') ?? ''), subtitle: text(field(r, f.subtitle)), badge: text(field(r, f.badge)), at: text(field(r, f.at)) }
        : { title: text(r), subtitle: '', badge: '', at: '' }));
      if (view === 'feed') items = items.sort((a, b) => b.at.localeCompare(a.at));
      return { ...out, items: items.slice(0, c.limit).map((it) => ({ ...it, tone: statusTone(it.badge) })), more: Math.max(0, items.length - c.limit) };
    }
    case 'meter': {
      const one = isObj(v) && !Array.isArray(v) && c.fields.value;
      const list = (one ? [v] : rows).map((r) => {
        const value = num(isObj(r) ? field(r, f.value ?? 'value') : r) ?? 0;
        const max = num(isObj(r) && f.max ? field(r, f.max) : null);
        return { label: one ? c.fields.label ?? '' : text(isObj(r) ? field(r, f.label ?? 'key') : ''), value, max };
      });
      const top = Math.max(1, ...list.map((r) => r.max ?? r.value));
      return { ...out, rows: list.slice(0, c.limit).map((r) => { const m = r.max ?? top; return { ...r, max: m, pct: m > 0 ? Math.max(0, Math.min(100, Math.round((r.value / m) * 100))) : 0, text: r.max !== null ? `${fmt(r.value)}/${fmt(r.max)}` : fmt(r.value) }; }) };
    }
    case 'chart': {
      const pts = (Array.isArray(v) ? v : rows).map((r, i) => (isObj(r) ? { x: text(field(r, f.x) ?? i), y: num(field(r, f.y ?? 'value')) ?? 0 } : { x: String(i), y: num(r) ?? 0 }));
      const last = pts.slice(-Math.max(c.limit, 2) * 6);
      const ys = last.map((p) => p.y);
      const min = Math.min(0, ...ys);
      const max = Math.max(min + 1, ...ys);
      return { ...out, kind: c.chart, points: last.map((p) => ({ ...p, h: Math.round(((p.y - min) / (max - min)) * 1000) / 10 })), min, max, last: ys.length ? fmt(ys[ys.length - 1]) : '' };
    }
    case 'table': {
      if (!Array.isArray(v)) return { ...out, columns: ['key', 'value'], rows: rows.slice(0, c.limit * 3).map((r) => [text(r.key), text('value' in r && Object.keys(r).length === 2 ? r.value : omit(r, 'key'))]) };
      const cols = Array.isArray(f.columns) && f.columns.length ? f.columns : fieldsOf(v).map((x) => x.id).slice(0, 6);
      return { ...out, columns: cols, rows: v.slice(0, c.limit).map((r) => cols.map((k) => text(isObj(r) ? field(r, k) : r))), more: Math.max(0, v.length - c.limit) };
    }
    default:
      return { ...out, value: v, fields: f };
  }
}
const omit = (o, k) => { const { [k]: _, ...rest } = o; return rest; };

/* ================================================================== refresh */

/** How often the host re-reads the card, in ms (0 = only on a live event or by hand). */
export function refreshMs(card) {
  const r = normalizeCard(card).refresh;
  return r.kind === 'every' ? r.every * 1000 : r.kind === 'live' ? 0 : 0;
}

/** Live-feed channels that should re-read the card (its plugin, plus any it names). */
export function liveChannels(card) {
  const c = normalizeCard(card);
  if (c.refresh.kind !== 'live') return [];
  return [...new Set([c.source.kind === 'command' ? c.source.plugin : c.source.id.split('.')[0], ...c.refresh.channels].filter(Boolean))];
}

/** True when a live-feed line (its channel) should re-read the card. */
export const liveHit = (card, channel) => liveChannels(card).some((ch) => String(channel ?? '') === ch || String(channel ?? '').startsWith(`${ch}:`) || String(channel ?? '').endsWith(`:${ch}`));

/** A live card still re-reads at this slow pace when no event arrives (a feed can drop lines). */
export const LIVE_FALLBACK_MS = 120_000;

/* ================================================================== sources from the plugin-commands@1 registry */

/** Every read command a card can bind to: [{ plugin, name, command, title, description }], data-folder reads last. */
export function cardSources(registry) {
  const out = [];
  for (const p of registry?.plugins ?? []) {
    if (p.app && p.app !== 'console-web') continue;
    if (p.enabled === false) continue;
    for (const c of p.commands ?? []) {
      if (c.kind !== 'read' || c.id === 'data-file') continue;
      out.push({ plugin: p.folder, name: p.name || p.folder, command: c.id, title: c.title || c.id, description: c.description || '', params: Object.keys(c.input?.properties ?? {}), generic: ['info', 'data'].includes(c.id) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || Number(a.generic) - Number(b.generic) || a.command.localeCompare(b.command));
}

/** A new card draft for a source (what Add card starts from). */
export function cardForSource(src, extra = {}) {
  return normalizeCard({ title: src.title && src.title !== src.command ? `${src.name}: ${src.title}` : src.name, icon: 'chart', source: { kind: 'command', plugin: src.plugin, command: src.command }, view: 'auto', ...extra });
}

/* ================================================================== suggestions (made from what exists, never hand-built) */

/**
 * The starter set: each suggestion names candidate reads in order; the first one the registry has is offered, and a
 * suggestion with none is left out. Open list: add words here, never a card per plugin.
 */
export const CARD_SUGGESTIONS = [
  { id: 'builds-running', title: 'Builds running', icon: 'layers', candidates: [
    { plugin: 'builds-page', command: 'progress', path: 'active', reduce: 'count', view: 'number', refresh: 'live' },
    { plugin: 'build-orchestrator', command: 'state', path: 'builds', where: { status: 'running' }, reduce: 'count', view: 'number', refresh: 'live' },
  ] },
  { id: 'build-progress', title: 'Build progress', icon: 'chart', candidates: [
    { plugin: 'builds-page', command: 'progress', path: 'progress', view: 'meter', fields: { value: 'done', max: 'total', label: 'Steps done' }, refresh: 'live' },
  ] },
  { id: 'cost-today', title: 'Agent spend today', icon: 'zap', unit: 'USD', candidates: [
    { plugin: 'agent-swarm', command: 'state', path: 'state.spend.*.today.usd', reduce: 'sum', view: 'number', refresh: 'every', every: 300 },
    { plugin: 'ai-assistant', command: 'usage', path: 'today.usd', view: 'number', refresh: 'every', every: 300 },
  ] },
  { id: 'agents-working', title: 'Agents working', icon: 'user', candidates: [
    { plugin: 'agent-swarm', command: 'state', path: 'state.runs', reduce: 'count', view: 'number', refresh: 'live' },
    { plugin: 'agent-manager', command: 'runs', reduce: 'count', view: 'number', refresh: 'live' },
  ] },
  { id: 'approvals-waiting', title: 'Approvals waiting', icon: 'bell', candidates: [
    { plugin: 'approvals-banner', command: 'pending', path: 'items', view: 'list', fields: { title: 'title', subtitle: 'service', badge: 'state' }, refresh: 'live' },
    { plugin: 'approvals', command: 'pending', path: 'items', view: 'list', fields: { title: 'title', subtitle: 'service', badge: 'state' }, refresh: 'live' },
  ] },
  { id: 'ui-review-waiting', title: 'UI Review waiting', icon: 'eye', candidates: [
    { plugin: 'ui-review', command: 'items', path: 'items', where: { status: 'waiting' }, view: 'list', fields: { title: 'name', subtitle: 'app', badge: 'status' }, refresh: 'live' },
  ] },
  { id: 'notes-recent', title: 'Recent notes', icon: 'file', candidates: [
    { plugin: 'notes-browser', command: 'notes', path: 'notes', view: 'feed', limit: 6, refresh: 'every', every: 300 },
  ] },
  { id: 'server-disk', title: 'Server disk', icon: 'monitor', unit: '%', candidates: [ // axf-plugin:maintenance
    { plugin: 'maintenance', command: 'summary', path: 'disk', view: 'meter', fields: { value: 'pct', max: 'max', label: 'Disk used' }, refresh: 'every', every: 120 },
  ] },
  { id: 'changes-live', title: 'Codebase changes', icon: 'clock', candidates: [
    { plugin: 'codebase-changes', command: 'entries', path: 'items', view: 'feed', fields: { title: 'title', at: 'updatedAt', subtitle: 'state' }, limit: 6, refresh: 'live' },
  ] },
];

/** The suggestions the registry can back, as card drafts with ids (cards already on Home are left out). */
export function suggestCards(registry, have = []) {
  const reads = new Set(cardSources(registry).map((s) => `${s.plugin}/${s.command}`));
  const taken = new Set(have.map((c) => cardKey(c)));
  const out = [];
  for (const s of CARD_SUGGESTIONS) {
    const pick = s.candidates.find((x) => reads.has(`${x.plugin}/${x.command}`));
    if (!pick) continue;
    const card = normalizeCard({
      title: s.title, icon: s.icon, unit: s.unit, source: { kind: 'command', plugin: pick.plugin, command: pick.command }, args: pick.args, path: pick.path,
      where: pick.where, reduce: pick.reduce, view: pick.view, fields: pick.fields, limit: pick.limit,
      refresh: pick.refresh === 'live' ? { kind: 'live' } : { kind: 'every', every: pick.every ?? 60 },
    });
    if (taken.has(cardKey(card))) continue;
    out.push({ id: `suggested-${s.id}`, card });
  }
  return out;
}

/** What makes two cards the same binding (source, args, path, filter, reduction). */
export function cardKey(c) {
  const n = normalizeCard(c);
  return JSON.stringify([n.source, n.args, n.path, n.where, n.reduce]);
}

/* ================================================================== drag and drop onto Home */

/**
 * A card draft from what was dropped: a card draft itself (CARD_DROP_MIME), a plugin read reference
 * `{ plugin, command, args?, path?, title? }`, a grid row hook `{ kind, id }` (grid-hook@1), or a control@1 path
 * `plugins.reads <plugin>/<command>`. Null = nothing a card can draw.
 */
export function cardFromDrop(payload) {
  let p = payload;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { const m = /^(?:plugins\.reads\s+)?([a-z0-9._-]+)\/([a-z0-9._-]+)$/.exec(p.trim()); p = m ? { plugin: m[1], command: m[2] } : null; } }
  if (!isObj(p)) return null;
  if (isObj(p.source)) return cardErrors(CARD_TYPE, normalizeCard(p)).length ? null : normalizeCard(p);
  if (typeof p.plugin === 'string' && typeof p.command === 'string') return normalizeCard({ title: p.title || `${p.plugin}: ${p.command}`, icon: p.icon || 'chart', source: { kind: 'command', plugin: p.plugin, command: p.command }, args: p.args, path: p.path, view: p.view || 'auto' });
  if (typeof p.kind === 'string' && typeof p.id === 'string') return normalizeCard({ title: p.title || `${p.kind} ${p.id}`, icon: 'box', source: { kind: 'console', id: `row.${p.kind}` }, args: { id: p.id }, view: 'auto' });
  return null;
}

/* ================================================================== the Home layout (home-layout@1, saved per user) */

const LAYOUT_DEFAULTS = { $axf: HOME_LAYOUT, cards: [], order: [], hidden: [], sizes: {}, dismissed: [] };

/** A layout with every field filled; `starters` (asset ids → card data) are placed first when the layout is new. */
export function normalizeLayout(raw, starters = []) {
  const d = isObj(raw) ? raw : {};
  const own = Array.isArray(d.cards) ? d.cards.filter((c) => isObj(c) && typeof c.id === 'string' && SLUG.test(c.id)).map((c) => ({ id: c.id, ...normalizeCard(c) })) : [];
  const starterIds = starters.map((s) => s.id);
  const ids = [...starterIds, ...own.map((c) => c.id)];
  const order = [...new Set([...(Array.isArray(d.order) ? d.order : []).filter((x) => ids.includes(x)), ...ids])];
  const sizes = {};
  if (isObj(d.sizes)) for (const [k, v] of Object.entries(d.sizes)) if (ids.includes(k) && CARD_ENUMS.size.includes(v)) sizes[k] = v;
  return {
    ...LAYOUT_DEFAULTS,
    cards: own,
    order,
    hidden: (Array.isArray(d.hidden) ? d.hidden : []).filter((x) => ids.includes(x)),
    sizes,
    dismissed: (Array.isArray(d.dismissed) ? d.dismissed : []).filter((x) => typeof x === 'string').slice(0, 100),
  };
}

/** Every card on Home in order, starters and own, each `{ id, card, hidden, size, starter }` (hidden ones included). */
export function homeCards(layout, starters = []) {
  const L = normalizeLayout(layout, starters);
  const byId = new Map([...starters.map((s) => [s.id, { card: normalizeCard(s.data ?? s.card ?? s), starter: true }]), ...L.cards.map((c) => [c.id, { card: normalizeCard(c), starter: false }])]);
  return L.order.filter((id) => byId.has(id)).map((id) => { const x = byId.get(id); return { id, card: x.card, starter: x.starter, hidden: L.hidden.includes(id), size: L.sizes[id] ?? x.card.size }; });
}

let seq = 0;
const newId = (title, taken) => {
  const base = (String(title || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'card');
  let id = base; while (taken.has(id)) id = `${base}-${++seq}`;
  return id;
};

/**
 * One change to the layout → the new layout (pure). Ops: add {card, id?, at?} · update {id, card} · remove {id} ·
 * move {id, to} · size {id, size} · hide {id} · show {id} · showAll · hideAll · dismiss {suggestion} · reset.
 * Starters can't be removed (only hidden); removing an own card drops it everywhere.
 */
export function applyLayout(layout, op, starters = []) {
  const L = normalizeLayout(layout, starters);
  const starterIds = new Set(starters.map((s) => s.id));
  const all = new Set(L.order);
  const has = (id) => all.has(id);
  switch (op?.op) {
    case 'add': {
      const card = normalizeCard(op.card);
      const errs = cardErrors(CARD_TYPE, card);
      if (errs.length) throw new Error(errs[0]);
      const id = op.id && SLUG.test(op.id) && !has(op.id) ? op.id : newId(card.title, all);
      const order = [...L.order];
      order.splice(Number.isInteger(op.at) ? Math.max(0, Math.min(order.length, op.at)) : order.length, 0, id);
      return normalizeLayout({ ...L, cards: [...L.cards, { id, ...card }], order }, starters);
    }
    case 'update': {
      if (starterIds.has(op.id)) throw new Error('a starter card is changed by copying it: Edit card saves a copy');
      const errs = cardErrors(CARD_TYPE, normalizeCard(op.card));
      if (errs.length) throw new Error(errs[0]);
      return normalizeLayout({ ...L, cards: L.cards.map((c) => (c.id === op.id ? { id: c.id, ...normalizeCard(op.card) } : c)) }, starters);
    }
    case 'remove':
      if (starterIds.has(op.id)) return normalizeLayout({ ...L, hidden: [...new Set([...L.hidden, op.id])] }, starters);
      return normalizeLayout({ ...L, cards: L.cards.filter((c) => c.id !== op.id), order: L.order.filter((x) => x !== op.id), hidden: L.hidden.filter((x) => x !== op.id) }, starters);
    case 'move': {
      if (!has(op.id)) return L;
      const order = L.order.filter((x) => x !== op.id);
      order.splice(Math.max(0, Math.min(order.length, Number(op.to) || 0)), 0, op.id);
      return normalizeLayout({ ...L, order }, starters);
    }
    case 'size':
      if (!has(op.id) || !CARD_ENUMS.size.includes(op.size)) return L;
      return normalizeLayout({ ...L, sizes: { ...L.sizes, [op.id]: op.size } }, starters);
    case 'hide': return normalizeLayout({ ...L, hidden: [...new Set([...L.hidden, op.id])] }, starters);
    case 'show': return normalizeLayout({ ...L, hidden: L.hidden.filter((x) => x !== op.id) }, starters);
    case 'showAll': return normalizeLayout({ ...L, hidden: [] }, starters);
    case 'hideAll': return normalizeLayout({ ...L, hidden: [...L.order] }, starters);
    case 'dismiss': return normalizeLayout({ ...L, dismissed: [...new Set([...L.dismissed, String(op.suggestion ?? '')])] }, starters);
    case 'reset': return normalizeLayout({}, starters);
    default: throw new Error(`unknown layout op ${op?.op}`);
  }
}
