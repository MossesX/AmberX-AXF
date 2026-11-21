/**
 * data-store@1 — the reference client for axf-data, the container that holds all console data.
 *
 * Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
 * builds keep running. That's what I need."
 *
 * One API (get / put / update / delete / list / append / read / watch / snapshot / manifest) over three backends:
 *   httpBackend({ url, token })   axf-data over the internal network (spec: framework/spec/DATA-STORE.md)
 *   fileBackend({ dir })          the same contract on local files, so code moves onto this API before the cutover
 *   memoryBackend()               tests and fixtures
 * The file and memory backends share one engine (`engineBackend`) so they answer byte-for-byte alike: the fixture
 * framework/spec/fixtures/data-store.json is replayed on both.
 *
 * Keys are `<namespace>/<path>` (registry below, mirrored in framework/schemas/data-store.json). A record is a JSON
 * document ≤ 1 MiB; a blob is bytes; a journal is append-only with a per-key `seq`. Every write of a record or blob
 * carries a precondition (`ifMatch` etag / rev, or `create`): a mismatch is a `conflict` and `update(key, fn)` re-reads,
 * applies and retries. Every change moves the store-wide `cursor`; `watch` follows it.
 *
 * Pure parts (parseKey, etagOf, manifestOf, sameManifest, backoffMs, errorFrame) have no IO; `fileBackend` is the one
 * place that touches a disk, and `httpBackend` the one that touches a network.
 */
import { createHash } from 'node:crypto';

export const SCHEMA = 'data-store@1';
export const VERSION = 1;
export const FRAMES = ['data-record@1', 'data-entry@1', 'data-entries@1', 'data-append@1', 'data-list@1', 'data-change@1', 'data-manifest@1', 'data-error@1', 'data-health@1', 'data-token@1', 'data-store-mode@1', 'data-drift@1'];
export const KINDS = ['record', 'blob', 'journal'];
export const OPS = ['get', 'put', 'delete', 'list', 'append', 'read', 'watch', 'snapshot', 'manifest', 'health'];
export const CHANGE_OPS = ['put', 'delete', 'append'];
export const GRANTS = ['read', 'write', 'append', 'admin'];
export const SERVICES = ['console', 'orchestrator', 'axhub', 'cli', 'plugin'];
export const MODES = ['local', 'shadow', 'cutover', 'rollback'];
/** The namespace registry: what each holds today and which kinds a key in it may be. `plugins` is open (`plugins/<folder>`). */
export const NAMESPACES = Object.freeze({
  notes: { label: 'Notes', kinds: ['blob', 'journal'], today: '/projects/_shared/_claude/notes' },
  builds: { label: 'Builds store, journal and history', kinds: ['record', 'journal', 'blob'], today: '_claude/builds' },
  settings: { label: 'Settings documents', kinds: ['record'], today: '/projects/_shared/_data/settings' },
  planner: { label: 'Planner items', kinds: ['record', 'journal'], today: '/projects/amberx-axf/_data/plan-studio' },
  'ui-review': { label: 'UI reviews', kinds: ['record', 'blob'], pluginFolder: 'ui-review', today: '.axf-console/plugins/ui-review' }, // a core namespace kept in that folder today: axf-not-plugin:ui-review
  plugins: { label: 'Plugin data folders', kinds: ['record', 'blob', 'journal'], open: true, today: '.axf-console/plugins/<folder>' },
  changes: { label: 'Codebase changes log', kinds: ['record'], today: '/projects/amberx-axf/_data/changes' },
  sessions: { label: 'Session archives', kinds: ['record', 'blob', 'journal'], today: '/projects/amberx-axf/_data/sessions' },
  console: { label: 'Console hub data', kinds: ['record', 'journal', 'blob'], today: '/projects/amberx-axf/_data/<folder>' },
  _meta: { label: 'Store state', kinds: ['record', 'journal'], internal: true, today: '' },
});
export const LIMITS = Object.freeze({
  recordBytes: 33554432, blobBytes: 268435456, entryBytes: 262144, appendBytes: 4194304, keyChars: 512, segmentChars: 80,
  listPage: 1000, journalPage: 5000, feedDays: 30, tombstoneDays: 30, watchPerToken: 32, tokenTtlSeconds: 86400,
});
/** code → HTTP status and what a client does about it. */
export const ERRORS = Object.freeze({
  invalid_key: { status: 400, retry: 'never' }, invalid_body: { status: 400, retry: 'never' }, too_large: { status: 413, retry: 'never' },
  precondition_required: { status: 428, retry: 'never' }, unauthorized: { status: 401, retry: 'reissue' }, forbidden: { status: 403, retry: 'never' },
  not_found: { status: 404, retry: 'never' }, conflict: { status: 409, retry: 'reread' }, exists: { status: 409, retry: 'never' },
  read_only: { status: 423, retry: 'mode' }, cursor_expired: { status: 410, retry: 'list' }, rate_limited: { status: 429, retry: 'backoff' },
  unavailable: { status: 503, retry: 'backoff' }, internal: { status: 500, retry: 'once' },
});
export const RETRY = Object.freeze({ baseMs: 250, factor: 2, tries: 5, maxMs: 8000, conflictTries: 5 });
export const TOKEN = Object.freeze({ alg: 'EdDSA', typ: 'axf-data+jwt', iss: 'axhub', aud: 'axf-data', keys: '/.well-known/axf-keys.json', subPrefix: 'svc:' });
export const PATTERNS = Object.freeze({
  segment: '^[A-Za-z0-9_][A-Za-z0-9._-]{0,79}$',
  pluginFolder: '^[a-z0-9][a-z0-9-]*$',
  etag: '^[0-9]+-[0-9a-f]{16}$',
  by: '^svc:(console|orchestrator|axhub|cli|plugin:[a-z0-9][a-z0-9-]*)(/.+)?$',
});
const SEGMENT = new RegExp(PATTERNS.segment);
const FOLDER = new RegExp(PATTERNS.pluginFolder);
const ETAG = new RegExp(PATTERNS.etag);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isBytes = (v) => v instanceof Uint8Array;
const utf8 = (s) => new TextEncoder().encode(s);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nowIso = () => new Date().toISOString();

export class DataStoreError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'DataStoreError';
    this.code = ERRORS[code] ? code : 'internal';
    this.status = ERRORS[this.code].status;
    for (const k of ['ns', 'path', 'rev', 'etag', 'retryAfterMs']) if (extra[k] !== undefined) this[k] = extra[k];
  }
  frame() { return errorFrame(this.code, this.message, this); }
}
/** data-error@1 body. */
export function errorFrame(code, message, extra = {}) {
  const f = { $axf: 'data-error@1', code: ERRORS[code] ? code : 'internal', message: String(message || code) };
  for (const k of ['ns', 'path', 'rev', 'etag', 'retryAfterMs']) if (extra[k] !== undefined && extra[k] !== null) f[k] = extra[k];
  return f;
}
const fail = (code, message, extra) => { throw new DataStoreError(code, message, extra); };

/** `<ns>/<path>` → { ns, path, folder? }; a plugin key carries its folder. Throws invalid_key. */
export function parseKey(key) {
  const s = typeof key === 'string' ? key : '';
  if (!s || s.length > LIMITS.keyChars) fail('invalid_key', `key must be <namespace>/<path>, ≤ ${LIMITS.keyChars} chars`);
  const i = s.indexOf('/');
  const ns = i < 0 ? s : s.slice(0, i);
  const path = i < 0 ? '' : s.slice(i + 1);
  if (!NAMESPACES[ns]) fail('invalid_key', `unknown namespace "${ns}"`, { ns });
  if (!path) fail('invalid_key', 'a key needs a path after the namespace', { ns });
  const segs = path.split('/');
  for (const seg of segs) if (!SEGMENT.test(seg) || seg === '.' || seg === '..') fail('invalid_key', `bad path segment "${seg}"`, { ns, path });
  const out = { ns, path };
  if (NAMESPACES[ns].open) {
    if (!FOLDER.test(segs[0]) || segs.length < 2) fail('invalid_key', `${ns} keys are ${ns}/<folder>/<path>`, { ns, path });
    out.folder = segs[0];
  }
  return out;
}
/** Namespace ids a prefix list may name: `plugins/<folder>` counts as a namespace for grants and manifests. */
export function parseNamespace(ns) {
  const s = typeof ns === 'string' ? ns : '';
  const [head, folder, ...rest] = s.split('/');
  if (!NAMESPACES[head]) fail('invalid_key', `unknown namespace "${s}"`, { ns: s });
  if (folder !== undefined && (!NAMESPACES[head].open || rest.length || !FOLDER.test(folder))) fail('invalid_key', `"${s}" is not a namespace`, { ns: s });
  return { ns: head, prefix: folder ? `${folder}/` : '' };
}
/** `<rev>-<sha256 of the body, first 16 hex>`. */
export function etagOf(rev, body) {
  const bytes = isBytes(body) ? body : utf8(typeof body === 'string' ? body : canonical(body));
  return `${rev}-${sha(bytes).slice(0, 16)}`;
}
/** An If-Match value: an etag, or a bare rev; '' when neither. */
export function normIfMatch(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return String(v);
  const s = typeof v === 'string' ? v.trim().replace(/^W\//, '').replace(/^"|"$/g, '') : '';
  return ETAG.test(s) || /^\d+$/.test(s) ? s : '';
}
const matches = (ifMatch, meta) => ifMatch === meta.etag || ifMatch === String(meta.rev);
/** Canonical JSON for a record body: stable key order so equal documents hash alike on every port. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return v === undefined ? 'null' : JSON.stringify(v);
}
/** The journal etag: `<entries>-<sha256 of all entry lines, first 16 hex>`. */
export function journalEtag(lines) {
  return `${lines.length}-${sha(utf8(lines.map((l) => (typeof l === 'string' ? l : canonical(l))).join('\n') + (lines.length ? '\n' : ''))).slice(0, 16)}`;
}
/**
 * One namespace of data-manifest@1 from its live keys: sorted by path (bytewise), one line `<path>\t<etag>\n`, SHA-256.
 * `items`: [{ path, etag, size, kind }]; journals carry their journal etag and `entries`.
 */
export function manifestOf(items) {
  const live = (Array.isArray(items) ? items : []).filter((i) => i && typeof i.path === 'string' && !i.deleted).slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const text = live.map((i) => `${i.path}\t${i.etag}\n`).join('');
  const out = { count: live.length, bytes: live.reduce((n, i) => n + (Number(i.size) || 0), 0), hash: sha(utf8(text)) };
  const journals = live.filter((i) => i.kind === 'journal');
  if (journals.length) out.journals = Object.fromEntries(journals.map((j) => [j.path, { entries: Number(j.entries) || Number(String(j.etag).split('-')[0]) || 0, hash: String(j.etag).split('-')[1] || '' }]));
  return out;
}
/** Two manifests (whole or one namespace) side by side: equal, and every namespace that differs with both counts / hashes. */
export function sameManifest(a, b) {
  const na = isObj(a?.namespaces) ? a.namespaces : { '': a || {} };
  const nb = isObj(b?.namespaces) ? b.namespaces : { '': b || {} };
  const diffs = [];
  for (const ns of [...new Set([...Object.keys(na), ...Object.keys(nb)])].sort()) {
    const x = na[ns], y = nb[ns];
    if (!x || !y) { diffs.push({ ns, missing: !x ? 'a' : 'b' }); continue; }
    if (x.count !== y.count || x.hash !== y.hash || x.bytes !== y.bytes) diffs.push({ ns, a: { count: x.count, bytes: x.bytes, hash: x.hash }, b: { count: y.count, bytes: y.bytes, hash: y.hash } });
  }
  return { equal: diffs.length === 0, diffs };
}
/** Backoff for try n (0-based): base × factor^n with ±25 % jitter, capped. */
export function backoffMs(attempt, rnd = Math.random, retry = RETRY) {
  const raw = Math.min(retry.maxMs, retry.baseMs * retry.factor ** Math.max(0, attempt | 0));
  return Math.round(raw * (0.75 + 0.5 * Math.min(1, Math.max(0, rnd()))));
}
/** The registry framework/schemas/data-store.json mirrors (without the JSON schemas, which are authored in the file). */
export function registry() {
  return { schema: SCHEMA, version: VERSION, frames: FRAMES, kinds: KINDS, ops: OPS, changeOps: CHANGE_OPS, grants: GRANTS, services: SERVICES, namespaces: NAMESPACES, limits: LIMITS, errors: ERRORS, retry: RETRY, token: TOKEN, patterns: PATTERNS, modes: MODES };
}

// ─── Engine: the contract on top of a tiny storage interface (memory, files) ─────────────────────────────────────────
//
// storage = {
//   readMeta(ns, path) → meta | null         writeMeta(ns, path, meta)
//   readBody(ns, path) → bytes | null         writeBody(ns, path, bytes)      removeBody(ns, path)
//   listMeta(ns) → [meta…]                     appendLines(ns, path, lines[])  readLines(ns, path) → [string…]
//   appendChange(changeLine)  readChanges() → [string…]     idem(key) → value | null   setIdem(key, value)
// }
// meta = { ns, path, kind, rev, etag, at, by, size, contentType, deleted, entries? }

const recordFrame = (m) => ({ $axf: 'data-record@1', ns: m.ns, path: m.path, kind: m.kind, rev: m.rev, etag: m.etag, at: m.at, by: m.by, size: m.size, contentType: m.contentType, deleted: !!m.deleted });
const bodyOf = (data, contentType) => {
  if (isBytes(data)) return { kind: 'blob', bytes: data, contentType: contentType || 'application/octet-stream' };
  if (typeof data === 'string' && contentType) return { kind: 'blob', bytes: utf8(data), contentType };
  if (data === undefined || typeof data === 'function' || typeof data === 'symbol') fail('invalid_body', 'a record is a JSON document');
  return { kind: 'record', bytes: utf8(canonical(data)), contentType: 'application/json' };
};

export function engineBackend(storage, opts = {}) {
  const now = opts.now || nowIso;
  const svc = opts.by || 'svc:cli';
  const lock = new Map(); // per-key serialisation inside one process
  const serial = async (k, fn) => { const prev = lock.get(k) || Promise.resolve(); let release; const next = new Promise((r) => { release = r; }); lock.set(k, prev.then(() => next)); await prev; try { return await fn(); } finally { release(); if (lock.get(k) === next) lock.delete(k); } };
  const change = async (m, op, seq) => {
    const lines = await storage.readChanges();
    const cursor = lines.length + 1;
    const c = { $axf: 'data-change@1', cursor, ns: m.ns, path: m.path, kind: m.kind, op, rev: m.rev, etag: m.etag, at: m.at, by: m.by };
    if (seq) c.seq = seq;
    await storage.appendChange(JSON.stringify(c));
    return c;
  };
  const kindOk = (ns, kind, path) => { if (!NAMESPACES[ns].kinds.includes(kind)) fail('invalid_key', `${ns} does not hold ${kind}s`, { ns, path }); };

  return {
    name: opts.name || 'engine',
    async get(ns, path, o = {}) {
      const m = await storage.readMeta(ns, path);
      if (!m || (m.deleted && !o.deleted)) fail('not_found', `${ns}/${path} not found`, { ns, path });
      if (m.kind === 'journal') fail('invalid_key', `${ns}/${path} is a journal: read it`, { ns, path });
      return { meta: m, bytes: m.deleted ? null : await storage.readBody(ns, path) };
    },
    async put(ns, path, data, o = {}) {
      const { kind, bytes, contentType } = bodyOf(data, o.contentType);
      kindOk(ns, kind, path);
      const limit = kind === 'blob' ? LIMITS.blobBytes : LIMITS.recordBytes;
      if (bytes.length > limit) fail('too_large', `${ns}/${path}: ${bytes.length} bytes, the ${kind} limit is ${limit}`, { ns, path });
      const ifMatch = normIfMatch(o.ifMatch);
      if (!ifMatch && !o.create && !(kind === 'blob' && o.force)) fail('precondition_required', `${ns}/${path}: pass ifMatch (the etag read) or create: true`, { ns, path });
      return serial(`${ns}/${path}`, async () => {
        const cur = await storage.readMeta(ns, path);
        if (cur && cur.kind === 'journal') fail('invalid_key', `${ns}/${path} is a journal`, { ns, path });
        const live = cur && !cur.deleted;
        if (o.create && live) fail('exists', `${ns}/${path} exists`, { ns, path, rev: cur.rev, etag: cur.etag });
        if (ifMatch && !live) fail('conflict', `${ns}/${path} ${cur ? 'was deleted' : 'does not exist'}`, { ns, path, rev: cur ? cur.rev : 0, etag: cur ? cur.etag : '' });
        if (ifMatch && !matches(ifMatch, cur)) fail('conflict', `${ns}/${path} is at rev ${cur.rev}`, { ns, path, rev: cur.rev, etag: cur.etag });
        if (live && cur.kind !== kind) fail('invalid_key', `${ns}/${path} is a ${cur.kind}`, { ns, path });
        const rev = (cur ? cur.rev : 0) + 1;
        const m = { ns, path, kind, rev, etag: etagOf(rev, bytes), at: now(), by: o.by || svc, size: bytes.length, contentType, deleted: false };
        await storage.writeBody(ns, path, bytes);
        await storage.writeMeta(ns, path, m);
        await change(m, 'put');
        return recordFrame(m);
      });
    },
    async delete(ns, path, o = {}) {
      const ifMatch = normIfMatch(o.ifMatch);
      if (!ifMatch && !o.force) fail('precondition_required', `${ns}/${path}: pass ifMatch (the etag read)`, { ns, path });
      return serial(`${ns}/${path}`, async () => {
        const cur = await storage.readMeta(ns, path);
        if (!cur || cur.deleted) fail('not_found', `${ns}/${path} not found`, { ns, path });
        if (cur.kind === 'journal') fail('read_only', `${ns}/${path} is a journal: journals are never removed`, { ns, path });
        if (ifMatch && !matches(ifMatch, cur)) fail('conflict', `${ns}/${path} is at rev ${cur.rev}`, { ns, path, rev: cur.rev, etag: cur.etag });
        const rev = cur.rev + 1;
        const m = { ...cur, rev, etag: `${rev}-${'0'.repeat(16)}`, at: now(), by: o.by || svc, size: 0, deleted: true };
        await storage.removeBody(ns, path);
        await storage.writeMeta(ns, path, m);
        await change(m, 'delete');
        return recordFrame(m);
      });
    },
    async list(ns, o = {}) {
      const prefix = typeof o.prefix === 'string' ? o.prefix : '';
      const after = typeof o.after === 'string' ? o.after : '';
      const limit = Math.max(1, Math.min(LIMITS.listPage, Number(o.limit) || LIMITS.listPage));
      const all = (await storage.listMeta(ns)).filter((m) => m.path.startsWith(prefix) && (o.deleted || !m.deleted)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const from = after ? all.filter((m) => m.path > after) : all;
      const page = from.slice(0, limit);
      return { $axf: 'data-list@1', ns, prefix, items: page.map(recordFrame), next: from.length > limit ? page[page.length - 1].path : '', total: all.length };
    },
    async append(ns, path, entries, o = {}) {
      kindOk(ns, 'journal', path);
      if (!Array.isArray(entries) || !entries.length) fail('invalid_body', 'append needs { entries: [ … ] } with at least one entry', { ns, path });
      const lines = entries.map((e) => canonical(e));
      for (const l of lines) if (utf8(l).length > LIMITS.entryBytes) fail('too_large', `a journal entry is over ${LIMITS.entryBytes} bytes`, { ns, path });
      if (lines.reduce((n, l) => n + l.length + 1, 0) > LIMITS.appendBytes) fail('too_large', `one append is over ${LIMITS.appendBytes} bytes`, { ns, path });
      return serial(`${ns}/${path}`, async () => {
        const idem = o.idempotencyKey ? `${ns}/${path}#${o.idempotencyKey}` : '';
        if (idem) { const seen = await storage.idem(idem); if (seen) return seen; }
        const cur = await storage.readMeta(ns, path);
        if (cur && cur.kind !== 'journal') fail('invalid_key', `${ns}/${path} is a ${cur.kind}`, { ns, path });
        const have = cur ? cur.entries : 0;
        const at = now(), by = o.by || svc;
        const stamped = lines.map((l, i) => JSON.stringify({ seq: have + i + 1, at, by, entry: JSON.parse(l) }));
        await storage.appendLines(ns, path, stamped);
        const all = await storage.readLines(ns, path);
        const m = { ns, path, kind: 'journal', rev: (cur ? cur.rev : 0) + 1, etag: journalEtag(all), at, by, size: all.reduce((n, l) => n + utf8(l).length + 1, 0), contentType: 'application/x-ndjson', deleted: false, entries: have + lines.length };
        await storage.writeMeta(ns, path, m);
        await change(m, 'append', m.entries);
        const out = { $axf: 'data-append@1', ns, path, first: have + 1, last: m.entries, count: lines.length };
        if (idem) await storage.setIdem(idem, out);
        return out;
      });
    },
    async read(ns, path, o = {}) {
      const m = await storage.readMeta(ns, path);
      if (!m) fail('not_found', `${ns}/${path} not found`, { ns, path });
      if (m.kind !== 'journal') fail('invalid_key', `${ns}/${path} is a ${m.kind}: get it`, { ns, path });
      const all = (await storage.readLines(ns, path)).map((l) => JSON.parse(l));
      const limit = Math.max(1, Math.min(LIMITS.journalPage, Number(o.limit) || LIMITS.journalPage));
      let picked;
      if (o.tail) picked = all.slice(-Math.max(1, Number(o.tail) | 0));
      else { const since = Math.max(0, Number(o.since) || 0); picked = all.filter((e) => e.seq > since).slice(0, limit); }
      const entries = picked.map((e) => ({ $axf: 'data-entry@1', ns, path, seq: e.seq, at: e.at, by: e.by, entry: e.entry }));
      const last = entries.length ? entries[entries.length - 1].seq : Number(o.since) || 0;
      return { $axf: 'data-entries@1', ns, path, entries, next: last < m.entries ? last : 0 };
    },
    async changes(o = {}) {
      const lines = await storage.readChanges();
      const since = Math.max(0, Number(o.since) || 0);
      const cursor = lines.length;
      const nss = o.ns ? (Array.isArray(o.ns) ? o.ns : String(o.ns).split(',')).map((s) => s.trim()).filter(Boolean) : [];
      const prefix = typeof o.prefix === 'string' ? o.prefix : '';
      const limit = Math.max(1, Math.min(LIMITS.journalPage, Number(o.limit) || LIMITS.journalPage));
      const out = [];
      for (let i = since; i < lines.length && out.length < limit; i += 1) {
        const c = JSON.parse(lines[i]);
        if (nss.length && !nss.some((n) => n === c.ns || (`${c.ns}/${c.path}`).startsWith(`${n}/`))) continue;
        if (prefix && !c.path.startsWith(prefix)) continue;
        out.push(c);
      }
      return { changes: out, cursor };
    },
    async manifest(ns) {
      const { ns: head, prefix } = parseNamespace(ns);
      const items = (await storage.listMeta(head)).filter((m) => m.path.startsWith(prefix)).map((m) => ({ path: m.path.slice(prefix.length), etag: m.etag, size: m.size, kind: m.kind, entries: m.entries, deleted: m.deleted }));
      return manifestOf(items);
    },
    async snapshot(namespaces, o = {}) {
      const nss = Array.isArray(namespaces) && namespaces.length ? namespaces : Object.keys(NAMESPACES).filter((n) => !NAMESPACES[n].internal);
      const out = {};
      for (const ns of nss) out[ns] = await this.manifest(ns);
      const at = now();
      const id = `m-${at.replace(/[-:.TZ]/g, '').slice(0, 14)}-${sha(utf8(canonical(out))).slice(0, 8)}`;
      const man = { $axf: 'data-manifest@1', id, at, by: o.by || svc, mode: o.mode || 'local', namespaces: out };
      await storage.writeBody('_meta', `manifests/${id}`, utf8(canonical(man)));
      await storage.writeMeta('_meta', `manifests/${id}`, { ns: '_meta', path: `manifests/${id}`, kind: 'record', rev: 1, etag: etagOf(1, canonical(man)), at, by: man.by, size: utf8(canonical(man)).length, contentType: 'application/json', deleted: false });
      return man;
    },
    async health() {
      const lines = await storage.readChanges();
      return { $axf: 'data-health@1', ok: true, cursor: lines.length, uptimeMs: 0, volume: { freeBytes: -1, totalBytes: -1 }, keys: { verified: false, fetchedAt: '' } };
    },
  };
}

/** Everything in memory: fixtures and tests. */
export function memoryBackend(opts = {}) {
  const meta = new Map(), body = new Map(), lines = new Map(), changes = [], idem = new Map();
  const k = (ns, p) => `${ns}\u0000${p}`;
  return engineBackend({
    async readMeta(ns, p) { return meta.get(k(ns, p)) || null; },
    async writeMeta(ns, p, m) { meta.set(k(ns, p), m); },
    async readBody(ns, p) { return body.get(k(ns, p)) || null; },
    async writeBody(ns, p, b) { body.set(k(ns, p), b); },
    async removeBody(ns, p) { body.delete(k(ns, p)); },
    async listMeta(ns) { return [...meta.values()].filter((m) => m.ns === ns); },
    async appendLines(ns, p, ls) { const key = k(ns, p); lines.set(key, [...(lines.get(key) || []), ...ls]); },
    async readLines(ns, p) { return lines.get(k(ns, p)) || []; },
    async appendChange(l) { changes.push(l); },
    async readChanges() { return changes; },
    async idem(key) { return idem.get(key) || null; },
    async setIdem(key, v) { idem.set(key, v); },
  }, { ...opts, name: 'memory' });
}

/**
 * The same contract on a local folder, so code can use this API before the cutover:
 *   <dir>/data/<ns>/<path>            the body (a journal is NDJSON)
 *   <dir>/meta/<ns>/<path>.json       data-record@1 metadata (+ `entries` for a journal)
 *   <dir>/_changes.jsonl              the change feed (cursor = line number)
 *   <dir>/_idem/<sha>.json            idempotent appends
 * Writes go to a temp file then rename, so a half-written body is never seen.
 */
export async function fileBackend(opts = {}) {
  const fs = await import('node:fs/promises');
  const pathMod = await import('node:path');
  const dir = pathMod.resolve(String(opts.dir || '.axf-console/data-store'));
  const P = (...p) => pathMod.join(dir, ...p);
  const ensure = (f) => fs.mkdir(pathMod.dirname(f), { recursive: true });
  const writeAtomic = async (f, data) => { await ensure(f); const tmp = `${f}.${process.pid}.${Date.now()}.tmp`; await fs.writeFile(tmp, data); await fs.rename(tmp, f); };
  const readOr = async (f, fallback) => { try { return await fs.readFile(f); } catch (e) { if (e.code === 'ENOENT') return fallback; throw new DataStoreError('unavailable', `${f}: ${e.message}`); } };
  const walk = async (root) => { const out = []; let ents; try { ents = await fs.readdir(root, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return out; throw e; } for (const e of ents) { const f = pathMod.join(root, e.name); if (e.isDirectory()) out.push(...(await walk(f))); else out.push(f); } return out; };
  const idemFile = (key) => P('_idem', `${sha(utf8(key))}.json`);
  return engineBackend({
    async readMeta(ns, p) { const b = await readOr(P('meta', ns, `${p}.json`), null); return b ? JSON.parse(b.toString('utf8')) : null; },
    async writeMeta(ns, p, m) { await writeAtomic(P('meta', ns, `${p}.json`), JSON.stringify(m)); },
    async readBody(ns, p) { const b = await readOr(P('data', ns, p), null); return b ? new Uint8Array(b) : null; },
    async writeBody(ns, p, b) { await writeAtomic(P('data', ns, p), b); },
    async removeBody(ns, p) { await fs.rm(P('data', ns, p), { force: true }); },
    async listMeta(ns) { const files = await walk(P('meta', ns)); const out = []; for (const f of files) if (f.endsWith('.json')) out.push(JSON.parse((await fs.readFile(f)).toString('utf8'))); return out; },
    async appendLines(ns, p, ls) { const f = P('data', ns, p); await ensure(f); await fs.appendFile(f, ls.map((l) => `${l}\n`).join('')); },
    async readLines(ns, p) { return (await readOr(P('data', ns, p), Buffer.alloc(0))).toString('utf8').split('\n').filter(Boolean); },
    async appendChange(l) { const f = P('_changes.jsonl'); await ensure(f); await fs.appendFile(f, `${l}\n`); },
    async readChanges() { return (await readOr(P('_changes.jsonl'), Buffer.alloc(0))).toString('utf8').split('\n').filter(Boolean); },
    async idem(key) { const b = await readOr(idemFile(key), null); return b ? JSON.parse(b.toString('utf8')) : null; },
    async setIdem(key, v) { await writeAtomic(idemFile(key), JSON.stringify(v)); },
  }, { ...opts, name: 'file', dir });
}

// ─── HTTP backend: axf-data over the internal network ────────────────────────────────────────────────────────────────

/** `url` = the axf-data origin (http inside the docker network), `token` = a data-token@1 (string or () => string). */
export function httpBackend(opts = {}) {
  const base = String(opts.url || '').replace(/\/+$/, '');
  if (!base) throw new DataStoreError('invalid_body', 'httpBackend needs the axf-data url');
  const f = opts.fetch || ((i, n) => fetch(i, n));
  const token = () => (typeof opts.token === 'function' ? opts.token() : opts.token) || '';
  const hdr = (extra = {}) => ({ authorization: `Bearer ${token()}`, accept: 'application/json', ...(opts.actor ? { 'x-axf-actor': opts.actor } : {}), ...extra });
  const url = (ns, path, q = {}) => { const u = new URL(`${base}/v1/${ns}${path ? `/${path}` : ''}`); for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== false && v !== null) u.searchParams.set(k, String(v)); return u.toString(); };
  const send = async (u, init = {}) => {
    let r;
    try { r = await f(u, { ...init, redirect: 'error', headers: hdr(init.headers) }); }
    catch (e) { throw new DataStoreError('unavailable', `axf-data can't be reached (${e.message})`, { retryAfterMs: RETRY.baseMs }); }
    if (r.ok) return r;
    let body = null; try { body = await r.json(); } catch { /* not JSON */ }
    const code = body && ERRORS[body.code] ? body.code : (Object.entries(ERRORS).find(([, e]) => e.status === r.status) || ['internal'])[0];
    throw new DataStoreError(code, (body && body.message) || `axf-data answered ${r.status}`, { ...(body || {}), retryAfterMs: body?.retryAfterMs ?? (r.headers.get('retry-after') ? Number(r.headers.get('retry-after')) * 1000 : undefined) });
  };
  return {
    name: 'http',
    async get(ns, path, o = {}) {
      const r = await send(url(ns, path, { deleted: o.deleted ? 1 : '' }));
      const meta = { ns, path, kind: r.headers.get('x-axf-kind') || 'record', rev: Number(r.headers.get('x-axf-rev')) || 0, etag: (r.headers.get('etag') || '').replace(/"/g, ''), at: r.headers.get('x-axf-at') || '', by: r.headers.get('x-axf-by') || '', contentType: r.headers.get('content-type') || '', deleted: r.headers.get('x-axf-deleted') === '1' };
      const bytes = new Uint8Array(await r.arrayBuffer());
      meta.size = bytes.length;
      return { meta, bytes: meta.deleted ? null : bytes };
    },
    async put(ns, path, data, o = {}) {
      const { kind, bytes, contentType } = bodyOf(data, o.contentType);
      const ifMatch = normIfMatch(o.ifMatch);
      const headers = { 'content-type': contentType, ...(ifMatch ? { 'if-match': ifMatch } : {}), ...(o.create ? { 'if-none-match': '*' } : {}) };
      return (await send(url(ns, path, { force: kind === 'blob' && o.force ? 1 : '' }), { method: 'PUT', headers, body: bytes })).json();
    },
    async delete(ns, path, o = {}) { const ifMatch = normIfMatch(o.ifMatch); return (await send(url(ns, path, { force: o.force ? 1 : '' }), { method: 'DELETE', headers: ifMatch ? { 'if-match': ifMatch } : {} })).json(); },
    async list(ns, o = {}) { return (await send(url(ns, '', { prefix: o.prefix, after: o.after, limit: o.limit, deleted: o.deleted ? 1 : '' }))).json(); },
    async append(ns, path, entries, o = {}) { return (await send(`${url(ns, path)}:append`, { method: 'POST', headers: { 'content-type': 'application/json', ...(o.idempotencyKey ? { 'idempotency-key': o.idempotencyKey } : {}) }, body: JSON.stringify({ entries }) })).json(); },
    async read(ns, path, o = {}) { return (await send(url(ns, path, { since: o.tail ? undefined : Math.max(0, Number(o.since) || 0), limit: o.limit, tail: o.tail }))).json(); }, // `since` always rides along: a GET without it is a get, refused on a journal
    async changes(o = {}) { const r = await (await send(url('watch', '', { ns: Array.isArray(o.ns) ? o.ns.join(',') : o.ns, prefix: o.prefix, since: o.since, limit: o.limit, poll: 1 }))).json(); return { changes: r.changes || [], cursor: r.cursor || 0 }; },
    async manifest(ns) { return (await send(`${url(ns, '')}:manifest`)).json(); },
    async snapshot(namespaces, o = {}) { return (await send(`${base}/v1/snapshot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ namespaces: namespaces || [], mode: o.mode }) })).json(); },
    async health() { return (await send(`${base}/v1/health`)).json(); },
  };
}

// ─── The client: keys, retries, conflicts, watch ─────────────────────────────────────────────────────────────────────

const decode = (meta, bytes) => {
  if (!bytes) return null;
  if (meta.kind === 'blob') return bytes;
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new DataStoreError('invalid_body', `${meta.ns}/${meta.path} is not JSON`, { ns: meta.ns, path: meta.path }); }
};

/**
 * createDataStore({ backend, by, onUnauthorized, sleep, rnd })
 *   get(key, { deleted })            → data-record@1 with `data` (parsed JSON, or bytes for a blob), or null when missing
 *   put(key, data, { ifMatch | create | force, contentType })  → data-record@1 (no data)
 *   update(key, fn, { create, tries })  read → fn(data, record) → put with ifMatch; re-reads and retries on conflict
 *   delete(key, { ifMatch | force })  list(ns, { prefix, after, limit, deleted })
 *   append(key, entries, { idempotencyKey })  read(key, { since, limit, tail })
 *   watch({ ns, prefix, since, intervalMs }, onChange) → { close(), cursor() }
 *   snapshot(namespaces) · manifest(ns) · health()
 */
export function createDataStore(o = {}) {
  const backend = o.backend;
  if (!backend) throw new DataStoreError('invalid_body', 'createDataStore needs a backend');
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rnd = o.rnd || Math.random;
  const by = o.by;
  const retrying = async (fn) => {
    let reissued = false;
    for (let attempt = 0; ; attempt += 1) {
      try { return await fn(); } catch (e) {
        if (!(e instanceof DataStoreError)) throw e;
        const how = ERRORS[e.code].retry;
        if (how === 'reissue' && !reissued && o.onUnauthorized) { reissued = true; await o.onUnauthorized(e); continue; }
        if ((how === 'backoff' || (how === 'once' && attempt === 0)) && attempt < RETRY.tries - 1) { await sleep(e.retryAfterMs || backoffMs(attempt, rnd)); continue; }
        throw e;
      }
    }
  };
  const withBy = (opts) => (by && !opts.by ? { ...opts, by } : opts);
  const api = {
    backend,
    async get(key, opts = {}) {
      const { ns, path } = parseKey(key);
      try { const { meta, bytes } = await retrying(() => backend.get(ns, path, opts)); return { ...recordFrame(meta), data: decode(meta, bytes) }; }
      catch (e) { if (e instanceof DataStoreError && e.code === 'not_found') return null; throw e; }
    },
    async put(key, data, opts = {}) { const { ns, path } = parseKey(key); return retrying(() => backend.put(ns, path, data, withBy(opts))); },
    async update(key, fn, opts = {}) {
      const tries = Math.max(1, Number(opts.tries) || RETRY.conflictTries);
      for (let i = 0; ; i += 1) {
        const cur = await api.get(key);
        if (!cur && !opts.create) throw new DataStoreError('not_found', `${key} not found (pass create: true to make it)`, parseKey(key));
        const next = await fn(cur ? cur.data : undefined, cur);
        if (next === undefined) return cur;
        try { return await api.put(key, next, { ...opts, ...(cur ? { ifMatch: cur.etag, create: false } : { create: true }) }); }
        catch (e) { if (e instanceof DataStoreError && (e.code === 'conflict' || e.code === 'exists') && i < tries - 1) { await sleep(backoffMs(i, rnd)); continue; } throw e; }
      }
    },
    async delete(key, opts = {}) { const { ns, path } = parseKey(key); return retrying(() => backend.delete(ns, path, withBy(opts))); },
    async list(ns, opts = {}) { const { ns: head, prefix } = parseNamespace(ns); return retrying(() => backend.list(head, { ...opts, prefix: prefix + (opts.prefix || '') })); },
    async append(key, entries, opts = {}) { const { ns, path } = parseKey(key); return retrying(() => backend.append(ns, path, entries, withBy(opts))); },
    async read(key, opts = {}) { const { ns, path } = parseKey(key); return retrying(() => backend.read(ns, path, opts)); },
    async changes(opts = {}) { return retrying(() => backend.changes(opts)); },
    watch(opts = {}, onChange) {
      let cursor = Math.max(0, Number(opts.since) || 0), open = true, timer = null;
      const interval = Math.max(50, Number(opts.intervalMs) || 1000);
      const tick = async () => {
        if (!open) return;
        try { const r = await api.changes({ ns: opts.ns, prefix: opts.prefix, since: cursor }); for (const c of r.changes) { cursor = c.cursor; if (open) await onChange(c); } cursor = Math.max(cursor, r.cursor); }
        catch (e) { if (opts.onError) opts.onError(e); else if (!(e instanceof DataStoreError)) throw e; }
        if (open) timer = setTimeout(tick, interval);
      };
      const first = tick();
      return { close() { open = false; if (timer) clearTimeout(timer); }, cursor: () => cursor, ready: first };
    },
    async snapshot(namespaces, opts = {}) { return retrying(() => backend.snapshot(namespaces, withBy(opts))); },
    async manifest(ns) { return retrying(() => backend.manifest(ns)); },
    async health() { return retrying(() => backend.health()); },
  };
  return api;
}

/**
 * The key a plugin's data file maps to: plugin-lifecycle@1 dataDir `.axf-console/plugins/<folder>/<rel>` →
 * `plugins/<folder>/<rel>`, unless a registry namespace names that folder as its own (`ui-review`).
 */
export function pluginKey(folder, rel) {
  if (!FOLDER.test(String(folder || ''))) fail('invalid_key', `bad plugin folder "${folder}"`);
  const p = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const own = Object.keys(NAMESPACES).find((ns) => NAMESPACES[ns].pluginFolder === folder);
  const key = own ? `${own}/${p}` : `plugins/${folder}/${p}`;
  return parseKey(key) && key;
}
/** The kind a migrated file becomes: `.json` → record, `.jsonl` / `.ndjson` → journal, anything else → blob. */
export function kindOfFile(rel) {
  const s = String(rel || '').toLowerCase();
  return /\.json$/.test(s) ? 'record' : /\.(jsonl|ndjson)$/.test(s) ? 'journal' : 'blob';
}
