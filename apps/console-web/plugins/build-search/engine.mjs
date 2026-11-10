/**
 * Build search engine (build-search@1). Pure: no IO, no DOM, no model calls. The CLI (search.mjs), the server part and
 * the web view all run the same rules, so a search typed in the console, sent over REST / MCP or run from a terminal
 * returns the same hits.
 *
 *   doc       { id, type, title, build?, path?, at?, lines: string[] }   one searchable document (a session log, a
 *             session's messages, a build, a build note, a report, a file from a user source)
 *   query     words (every word must be on the line), "a phrase", /regex/, -exclude, type:<t>[,<t>], build:<id part>
 *   result    { $axf: 'build-search-result@1', q, total, docs, truncated, groups: [{ doc, type, icon, title, build,
 *             count, hits: [{ id, n, line, text, ranges }] }] }   every hit of a document is an instance (n = 1, 2, 3…)
 *   command   a query that starts with '>' is a typed command: add source / remove source / add action / remove
 *             action / ai on|off / set <key> <value> / sources / actions / help
 *
 * AI: nothing here uses a model. The settings carry `ai.enabled` (false by default); the server refuses every AI route
 * while it is off, and turning it on is always an explicit call (never automatic, even with an AI connection).
 */

export const FRAME = 'build-search@1';
export const RESULT_FRAME = 'build-search-result@1';

/** Document types, their icon and label. Open list: a user source may name any other type (icon `file`). */
export const TYPES = {
  build: { icon: 'hammer', label: 'Build' },
  note: { icon: 'edit', label: 'Build note' },
  report: { icon: 'file', label: 'Build report' },
  log: { icon: 'terminal', label: 'Session log' },
  session: { icon: 'user', label: 'Session message' },
  file: { icon: 'folder', label: 'File' },
};
export const typeIcon = (t) => TYPES[t]?.icon ?? 'file';
export const typeLabel = (t) => TYPES[t]?.label ?? (t ? t[0].toUpperCase() + t.slice(1) : 'File');

/** Built-in hit actions (ids are stable: they are the API's `action` values). */
export const BUILTIN_ACTIONS = [
  { id: 'open', label: 'Open at this spot', icon: 'arrow-right', builtin: true },
  { id: 'copy-link', label: 'Copy link', icon: 'external', builtin: true },
  { id: 'copy-text', label: 'Copy line', icon: 'copy', builtin: true },
  { id: 'open-build', label: 'Open the build', icon: 'hammer', builtin: true, when: 'build' },
  { id: 'filter-build', label: 'Only this build', icon: 'sliders', builtin: true, when: 'build' },
];

export const DEFAULT_SETTINGS = Object.freeze({
  $axf: FRAME,
  types: Object.keys(TYPES),
  maxHits: 600,
  maxPerDoc: 60,
  context: 3,
  snippet: 220,
  sources: [],
  actions: [],
  ai: { enabled: false },
});

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const clampInt = (v, lo, hi, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** A user source: { id, name, path (file, folder or glob), type }. */
export function normalizeSource(raw) {
  if (!isObj(raw)) return null;
  const path = str(raw.path, 500).trim();
  const name = str(raw.name, 80).trim() || path.split('/').filter(Boolean).pop() || '';
  const id = slug(raw.id || name);
  if (!id || !path) return null;
  const type = slug(raw.type) || 'file';
  return { id, name, path, type };
}

/**
 * A user action: { id, label, icon, run } where run is a console action spec (`build-manager.open:{build}`), a
 * `nav:<view>` or an https URL; {build} {line} {doc} {type} {n} {q} {text} {path} are filled in from the hit.
 */
export function normalizeAction(raw) {
  if (!isObj(raw)) return null;
  const label = str(raw.label, 80).trim();
  const run = str(raw.run, 500).trim();
  const id = slug(raw.id || label);
  if (!id || !label || !run) return null;
  if (BUILTIN_ACTIONS.some((a) => a.id === id)) return null;
  if (/^(javascript|data|file|vbscript):/i.test(run)) return null;
  if (/^[a-z]+:\/\//i.test(run) && !/^https:\/\//i.test(run)) return null;
  const types = Array.isArray(raw.types) ? raw.types.map(slug).filter(Boolean) : [];
  return { id, label, icon: slug(raw.icon) || 'zap', run, ...(types.length ? { types } : {}) };
}

export function normalizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const uniq = (list, key) => { const seen = new Set(); return list.filter((x) => x && !seen.has(x[key]) && seen.add(x[key])); };
  const types = Array.isArray(r.types) ? r.types.map(slug).filter(Boolean) : [...DEFAULT_SETTINGS.types];
  return {
    $axf: FRAME,
    types: types.length ? [...new Set(types)] : [...DEFAULT_SETTINGS.types],
    maxHits: clampInt(r.maxHits, 10, 5000, DEFAULT_SETTINGS.maxHits),
    maxPerDoc: clampInt(r.maxPerDoc, 1, 1000, DEFAULT_SETTINGS.maxPerDoc),
    context: clampInt(r.context, 0, 30, DEFAULT_SETTINGS.context),
    snippet: clampInt(r.snippet, 40, 2000, DEFAULT_SETTINGS.snippet),
    sources: uniq((Array.isArray(r.sources) ? r.sources : []).map(normalizeSource), 'id').slice(0, 50),
    actions: uniq((Array.isArray(r.actions) ? r.actions : []).map(normalizeAction), 'id').slice(0, 50),
    ai: { enabled: r.ai?.enabled === true },
  };
}

/* ================================================================== query */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parse a query into { terms: RegExp[], exclude: RegExp[], types: string[], builds: string[], text }. */
export function parseQuery(q) {
  const out = { terms: [], exclude: [], types: [], builds: [], text: String(q ?? '').trim(), error: '' };
  const re = /(-?)(?:"([^"]*)"|\/((?:\\.|[^/])+)\/|(\S+))/g;
  let m;
  while ((m = re.exec(out.text))) {
    const neg = m[1] === '-';
    let rx = null;
    if (m[2] !== undefined) { if (!m[2].trim()) continue; rx = new RegExp(escapeRe(m[2]), 'i'); }
    else if (m[3] !== undefined) {
      try { rx = new RegExp(m[3], 'i'); } catch (e) { out.error = `bad pattern /${m[3]}/: ${e.message}`; continue; }
    } else {
      const w = m[4];
      const kv = /^(type|in|build|b):(.+)$/i.exec(w);
      if (kv && !neg) {
        const vals = kv[2].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
        if (/^(type|in)$/i.test(kv[1])) out.types.push(...vals.map((v) => (v.endsWith('s') && !TYPES[v] && TYPES[v.slice(0, -1)] ? v.slice(0, -1) : v)));
        else out.builds.push(...vals);
        continue;
      }
      rx = new RegExp(escapeRe(w), 'i');
    }
    (neg ? out.exclude : out.terms).push(rx);
  }
  return out;
}

/** Where every term matches on a line ([start, end] pairs, merged), or null when the line doesn't match. */
export function matchLine(line, pq) {
  if (!pq.terms.length) return null;
  for (const x of pq.exclude) if (x.test(line)) return null;
  const ranges = [];
  for (const t of pq.terms) {
    const g = new RegExp(t.source, 'gi');
    let m, any = false;
    while ((m = g.exec(line))) {
      if (m[0].length === 0) { g.lastIndex++; continue; }
      ranges.push([m.index, m.index + m[0].length]);
      any = true;
      if (ranges.length > 40) break;
    }
    if (!any) return null;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
  return merged;
}

/** A line cut to `width` around its first match, with the ranges moved to fit. */
export function snippet(line, ranges, width) {
  if (line.length <= width) return { text: line, ranges };
  const first = ranges[0]?.[0] ?? 0;
  let start = Math.max(0, first - Math.floor(width / 3));
  const end = Math.min(line.length, start + width);
  start = Math.max(0, end - width);
  const pre = start > 0 ? '…' : '';
  const text = pre + line.slice(start, end) + (end < line.length ? '…' : '');
  const shift = pre.length - start;
  return { text, ranges: ranges.filter(([a]) => a >= start && a < end).map(([a, b]) => [a + shift, Math.min(b, end) + shift]) };
}

export const hitId = (docId, line) => `${docId}#${line}`;
export function parseHitId(id) {
  const s = String(id ?? '');
  const i = s.lastIndexOf('#');
  if (i < 0) return { doc: s, line: 0 };
  const line = Number.parseInt(s.slice(i + 1), 10);
  return { doc: s.slice(0, i), line: Number.isFinite(line) && line > 0 ? line : 0 };
}

/**
 * Search documents. Every matching line is a hit; the hits of one document are its instances 1, 2, 3… in line order.
 * Groups are ordered by hit count (most first), then newest, then title. Lines are 1-based.
 */
export function search(docs, q, opts = {}) {
  const pq = parseQuery(q);
  const settings = normalizeSettings(opts.settings);
  const types = new Set((opts.types?.length ? opts.types : pq.types.length ? pq.types : settings.types).map((t) => String(t).toLowerCase()));
  const builds = [...pq.builds, ...(opts.build ? [String(opts.build).toLowerCase()] : [])];
  const maxHits = clampInt(opts.limit, 1, 20000, settings.maxHits);
  const maxPerDoc = clampInt(opts.perDoc, 1, 5000, settings.maxPerDoc);
  const groups = [];
  let total = 0, shown = 0, truncated = false, searched = 0;
  if (pq.terms.length) {
    for (const doc of docs) {
      if (!types.has(doc.type) && !(doc.type && !TYPES[doc.type] && types.has('file'))) continue;
      if (builds.length && !builds.some((b) => String(doc.build ?? '').toLowerCase().includes(b))) continue;
      searched++;
      const hits = [];
      let count = 0;
      const lines = doc.lines ?? [];
      for (let i = 0; i < lines.length; i++) {
        const ranges = matchLine(lines[i], pq);
        if (!ranges) continue;
        count++;
        if (hits.length < maxPerDoc && shown < maxHits) {
          const s = snippet(lines[i], ranges, settings.snippet);
          hits.push({ id: hitId(doc.id, i + 1), n: count, line: i + 1, text: s.text, ranges: s.ranges });
          shown++;
        } else truncated = true;
      }
      if (!count) continue;
      total += count;
      groups.push({ doc: doc.id, type: doc.type, icon: typeIcon(doc.type), typeLabel: typeLabel(doc.type), title: doc.title, build: doc.build ?? '', path: doc.path ?? '', at: doc.at ?? '', count, hits });
    }
  }
  groups.sort((a, b) => b.count - a.count || String(b.at).localeCompare(String(a.at)) || a.title.localeCompare(b.title));
  return { $axf: RESULT_FRAME, q: pq.text, error: pq.error, total, shown, docs: groups.length, searched, truncated, groups };
}

/** Lines around a hit, for the log viewer: { start, end, lines } (1-based, inclusive). */
export function around(doc, line, context = 200) {
  const n = doc.lines?.length ?? 0;
  const at = Math.min(Math.max(1, line || 1), Math.max(1, n));
  const start = Math.max(1, at - context);
  const end = Math.min(n, at + context);
  return { start, end, line: at, total: n, lines: (doc.lines ?? []).slice(start - 1, end) };
}

/* ================================================================== actions */

/** The actions offered on a hit: the built-ins that apply, then the user's own (filtered by type). */
export function actionsFor(group, settings) {
  const s = normalizeSettings(settings);
  return [
    ...BUILTIN_ACTIONS.filter((a) => a.when !== 'build' || group?.build),
    ...s.actions.filter((a) => !a.types || a.types.includes(group?.type)),
  ];
}

/** A user action's `run` with the hit filled in (values URI-encoded inside URLs and action arguments). */
export function fillAction(run, ctx) {
  const url = /^https:\/\//i.test(run);
  return String(run).replace(/\{(build|line|doc|type|n|q|text|path)\}/g, (_, k) => {
    const v = String(ctx?.[k] ?? '');
    return url || run.includes(':') ? encodeURIComponent(v) : v;
  });
}

/* ================================================================== typed commands */

export const COMMAND_HELP = [
  '>add source <name> <path or glob> [as <type>]   search more files (a folder, a file or a glob)',
  '>remove source <name>',
  '>add action <label> = <console action, nav:<view> or https URL>   with {build} {line} {doc} {type} {n} {q} {text} {path}',
  '>remove action <label>',
  '>ai on | >ai off   the AI switch (off by default; nothing uses AI unless it is on)',
  '>set <maxHits|maxPerDoc|context|snippet> <number>',
  '>types <type,type,…>   which kinds are searched by default',
  '>sources   >actions   >help',
];

/**
 * Parse a typed command (the text after '>'). Returns { op, … } or { op: 'error', error }. Pure: the caller applies it
 * with applyCommand and saves the settings.
 */
export function parseCommand(text) {
  const t = String(text ?? '').replace(/^\s*>\s*/, '').trim();
  let m;
  if (!t || /^(help|\?)$/i.test(t)) return { op: 'help' };
  if (/^sources?$/i.test(t)) return { op: 'sources' };
  if (/^actions?$/i.test(t)) return { op: 'actions' };
  if ((m = /^add\s+source\s+(\S+)\s+(.+?)(?:\s+as\s+(\S+))?$/i.exec(t))) return { op: 'add-source', source: { name: m[1], path: m[2].trim(), type: m[3] || 'file' } };
  if ((m = /^(?:remove|delete)\s+source\s+(.+)$/i.exec(t))) return { op: 'remove-source', id: slug(m[1]) };
  if ((m = /^add\s+action\s+(.+?)\s*=\s*(.+)$/i.exec(t))) return { op: 'add-action', action: { label: m[1].trim(), run: m[2].trim() } };
  if ((m = /^(?:remove|delete)\s+action\s+(.+)$/i.exec(t))) return { op: 'remove-action', id: slug(m[1]) };
  if ((m = /^ai\s+(on|off|enable|disable|true|false)$/i.exec(t))) return { op: 'ai', enabled: /^(on|enable|true)$/i.test(m[1]) };
  if ((m = /^set\s+(maxHits|maxPerDoc|context|snippet)\s+(\d+)$/i.exec(t))) {
    const key = ['maxHits', 'maxPerDoc', 'context', 'snippet'].find((k) => k.toLowerCase() === m[1].toLowerCase());
    return { op: 'set', key, value: Number(m[2]) };
  }
  if ((m = /^types?\s+(.+)$/i.exec(t))) return { op: 'types', types: m[1].split(/[\s,]+/).map(slug).filter(Boolean) };
  return { op: 'error', error: `unknown command "${t}". Type >help for the list.` };
}

/** Apply a parsed command to settings. Returns { settings, changed, message, error? }. */
export function applyCommand(settings, cmd) {
  const s = normalizeSettings(settings);
  const done = (next, message) => ({ settings: normalizeSettings(next), changed: true, message });
  switch (cmd?.op) {
    case 'help': return { settings: s, changed: false, message: COMMAND_HELP.join('\n') };
    case 'sources': return { settings: s, changed: false, message: s.sources.length ? s.sources.map((x) => `${x.id}: ${x.path} (${x.type})`).join('\n') : 'No sources of your own yet. Built in: builds, build notes, reports, session logs, session messages.' };
    case 'actions': return { settings: s, changed: false, message: [...BUILTIN_ACTIONS.map((a) => `${a.id} (built in)`), ...s.actions.map((a) => `${a.id}: ${a.run}`)].join('\n') };
    case 'add-source': {
      const src = normalizeSource(cmd.source);
      if (!src) return { settings: s, changed: false, error: 'a source needs a name and a path' };
      return done({ ...s, sources: [...s.sources.filter((x) => x.id !== src.id), src] }, `Source ${src.id} added: ${src.path}`);
    }
    case 'remove-source':
      if (!s.sources.some((x) => x.id === cmd.id)) return { settings: s, changed: false, error: `no source ${cmd.id}` };
      return done({ ...s, sources: s.sources.filter((x) => x.id !== cmd.id) }, `Source ${cmd.id} removed`);
    case 'add-action': {
      const a = normalizeAction(cmd.action);
      if (!a) return { settings: s, changed: false, error: 'an action needs a label and a console action, nav:<view> or https URL (not a built-in id)' };
      return done({ ...s, actions: [...s.actions.filter((x) => x.id !== a.id), a] }, `Action ${a.id} added`);
    }
    case 'remove-action':
      if (!s.actions.some((x) => x.id === cmd.id)) return { settings: s, changed: false, error: `no action ${cmd.id}` };
      return done({ ...s, actions: s.actions.filter((x) => x.id !== cmd.id) }, `Action ${cmd.id} removed`);
    case 'ai': return done({ ...s, ai: { enabled: cmd.enabled === true } }, `AI ${cmd.enabled ? 'on' : 'off'}`);
    case 'set': return done({ ...s, [cmd.key]: cmd.value }, `${cmd.key} = ${cmd.value}`);
    case 'types': return done({ ...s, types: cmd.types }, `Searching ${cmd.types.join(', ')}`);
    default: return { settings: s, changed: false, error: cmd?.error || 'unknown command' };
  }
}
