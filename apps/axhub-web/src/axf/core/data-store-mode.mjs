/**
 * data-store-mode@1 — how the console moves its data onto axf-data without losing a write (pure, IO-free).
 *
 *   local ──start shadow──▶ shadow ──cut over──▶ cutover
 *     ▲                       │                    │
 *     └──────back to local────┘        roll back ──▼
 *     ◀────────finish rollback─────────────────  rollback ──cancel──▶ cutover
 *
 * One mode per namespace (`plugins/<folder>` counts as one), with a store-wide default; the document is
 * data-store-mode@1, kept at `_meta/mode` on axf-data and as `<data>/data-store/mode.json` locally, and every client
 * reads it before a write.
 *
 *   local     reads and writes go to the local store; axf-data is not touched.
 *   shadow    every write goes to local first, then to axf-data; reads come from local, and each read also asks axf-data
 *             and logs a drift entry (data-drift@1) when the two differ. A failed shadow write is drift, never an error
 *             for the caller.
 *   cutover   axf-data is the only store. The local copy is the read-only backup made at the cut (writes to it are
 *             `read_only`).
 *   rollback  in flight: writes are refused on both sides (`read_only`), reads still come from axf-data; the local copy
 *             is being brought up to date from the change feed since the cutover cursor. Ends in `local` (finished) or
 *             back in `cutover` (cancelled).
 *
 * Guards: shadow needs equal manifests (the migration copy checked out); cutover needs equal manifests at the cut and a
 * drift-free shadow for `DRIFT_FREE_MS` (30 min) with no drift at all unless `ctx.acceptDrift` lists each entry; a
 * rollback finishes only when the replay is done and manifests are equal again. Nothing here does IO: the host passes
 * manifests, clocks and replay results in `ctx`.
 */
import { DataStoreError, NAMESPACES, parseNamespace, sameManifest } from './data-store.mjs';

export const SCHEMA = 'data-store-mode@1';
export const DRIFT_RECORD = 'data-drift@1';
export const VERSION = 1;
export const MODES = ['local', 'shadow', 'cutover', 'rollback'];
export const EVENTS = ['start-shadow', 'back-to-local', 'cut-over', 'roll-back', 'finish-rollback', 'cancel-rollback'];
/** event → [from, to]. */
export const TRANSITIONS = Object.freeze({
  'start-shadow': ['local', 'shadow'],
  'back-to-local': ['shadow', 'local'],
  'cut-over': ['shadow', 'cutover'],
  'roll-back': ['cutover', 'rollback'],
  'finish-rollback': ['rollback', 'local'],
  'cancel-rollback': ['rollback', 'cutover'],
});
export const DRIFT_FREE_MS = 30 * 60 * 1000;
export const DRIFT_KINDS = ['missing-remote', 'missing-local', 'etag', 'entries', 'write-failed', 'append-failed'];
/** What each mode does with a read and a write. */
export const ROUTES = Object.freeze({
  local: { read: 'local', write: ['local'], diff: false, localWritable: true, remoteRequired: false },
  shadow: { read: 'local', write: ['local', 'remote'], diff: true, localWritable: true, remoteRequired: false },
  cutover: { read: 'remote', write: ['remote'], diff: false, localWritable: false, remoteRequired: true },
  rollback: { read: 'remote', write: [], diff: false, localWritable: false, remoteRequired: true },
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const iso = (v, fallback) => (typeof v === 'string' && ISO.test(v) ? v : fallback);
const bad = (m, extra) => { throw new DataStoreError('invalid_body', m, extra); };
const nsId = (ns) => { const { ns: head, prefix } = parseNamespace(ns); if (NAMESPACES[head].open && !prefix) bad(`${head} needs a folder: ${head}/<folder>`, { ns }); return prefix ? `${head}/${prefix.slice(0, -1)}` : head; };

/** A fresh document: everything local. */
export function initialState(at, by = 'svc:cli') {
  return { $axf: SCHEMA, mode: 'local', since: iso(at, '1970-01-01T00:00:00.000Z'), by, cursor: 0, manifest: '', namespaces: {} };
}
/** A document from disk, with every field in shape (unknown modes fall back to local; a bad document is refused). */
export function normState(v, at) {
  if (!isObj(v) || (v.$axf && v.$axf !== SCHEMA)) bad(`not a ${SCHEMA} document`);
  const s = initialState(at);
  s.mode = MODES.includes(v.mode) ? v.mode : 'local';
  s.since = iso(v.since, s.since); s.by = typeof v.by === 'string' ? v.by : s.by;
  s.cursor = Number.isInteger(v.cursor) && v.cursor >= 0 ? v.cursor : 0; s.manifest = typeof v.manifest === 'string' ? v.manifest : '';
  for (const [ns, e] of Object.entries(isObj(v.namespaces) ? v.namespaces : {})) {
    if (!isObj(e)) continue;
    const id = nsId(ns);
    s.namespaces[id] = { mode: MODES.includes(e.mode) ? e.mode : 'local', since: iso(e.since, s.since), cursor: Number.isInteger(e.cursor) && e.cursor >= 0 ? e.cursor : 0, manifest: typeof e.manifest === 'string' ? e.manifest : '', drift: Number.isInteger(e.drift) && e.drift >= 0 ? e.drift : 0, lastDriftAt: iso(e.lastDriftAt, '') };
  }
  return s;
}
/** The mode of one namespace: its own entry, else the store default. */
export function modeOf(state, ns) { const e = state?.namespaces?.[nsId(ns)]; return e ? e.mode : MODES.includes(state?.mode) ? state.mode : 'local'; }
export const route = (mode) => ROUTES[MODES.includes(mode) ? mode : 'local'];
/** Where a read of `ns` goes, and whether to compare with the other side. */
export function readPlan(state, ns) { const mode = modeOf(state, ns); const r = route(mode); return { mode, from: r.read, compare: r.diff ? 'remote' : '' }; }
/**
 * Where a write of `ns` goes: `targets` in order, `required` ones fail the caller, the rest only log drift; `[]` with
 * `refused` = the caller gets `read_only`.
 */
export function writePlan(state, ns) {
  const mode = modeOf(state, ns); const r = route(mode);
  if (!r.write.length) return { mode, targets: [], required: [], refused: 'read_only', reason: `${nsId(ns)} is in ${mode}: writes are held until it ends` };
  return { mode, targets: r.write, required: [r.write[0]], refused: '', reason: '' };
}

/**
 * May `ns` go `to`? ctx = { manifests: { local, remote } (namespace blocks or whole data-manifest@1), now (ISO),
 * remoteOk, replayed (rollback replay finished), acceptDrift: [entry ids…] }. Answers { ok, event, reason }.
 */
export function canTransition(state, ns, to, ctx = {}) {
  const id = nsId(ns);
  const from = modeOf(state, id);
  if (!MODES.includes(to)) return { ok: false, event: '', reason: `unknown mode "${to}"` };
  const event = Object.keys(TRANSITIONS).find((e) => TRANSITIONS[e][0] === from && TRANSITIONS[e][1] === to) || '';
  if (!event) return { ok: false, event, reason: from === to ? `${id} is already ${to}` : `no way from ${from} to ${to}${from === 'local' && to === 'cutover' ? ': shadow first' : ''}` };
  const e = state.namespaces?.[id] || { drift: 0, lastDriftAt: '', since: state.since };
  const manifests = ctx.manifests || {};
  const equal = () => { if (!manifests.local || !manifests.remote) return { ok: false, reason: 'both manifests (local, remote) are needed' }; const r = sameManifest(manifests.local, manifests.remote); return r.equal ? { ok: true } : { ok: false, reason: `manifests differ: ${r.diffs.map((d) => d.ns || id).join(', ')}` }; };
  if (event === 'start-shadow' || event === 'cut-over' || event === 'finish-rollback') {
    if (ctx.remoteOk === false) return { ok: false, event, reason: 'axf-data is not reachable' };
    const m = equal(); if (!m.ok) return { ok: false, event, reason: m.reason };
  }
  if (event === 'cut-over') {
    const now = Date.parse(iso(ctx.now, '')) || 0;
    const since = Date.parse(e.since) || 0;
    const minMs = Number.isFinite(ctx.minDriftFreeMs) ? ctx.minDriftFreeMs : DRIFT_FREE_MS;
    const accepted = Array.isArray(ctx.acceptDrift) ? ctx.acceptDrift.length : 0;
    if (e.drift > accepted) return { ok: false, event, reason: `${e.drift} drift entr${e.drift === 1 ? 'y' : 'ies'} in shadow (accepted ${accepted}): read the drift log first` };
    const quietFrom = Math.max(since, Date.parse(e.lastDriftAt) || 0);
    if (!now || now - quietFrom < minMs) return { ok: false, event, reason: `shadow has been quiet for ${Math.max(0, Math.round((now - quietFrom) / 60000))} min, needs ${Math.round(minMs / 60000)}` };
  }
  if (event === 'finish-rollback' && ctx.replayed !== true) return { ok: false, event, reason: 'the change feed since the cutover cursor is not replayed onto local yet' };
  return { ok: true, event, reason: '' };
}
/**
 * Move `ns` (or every namespace in `namespaces`, or the whole store when ns is '*') to `to`. Returns the new document
 * and the changes made; throws invalid_body when a guard refuses (message = the reason).
 */
export function transition(state, { ns = '*', to, at, by = 'svc:cli', cursor, manifest, ctx = {} }) {
  const when = iso(at, '') || bad('transition needs `at` (ISO UTC)');
  const next = JSON.parse(JSON.stringify(state));
  const ids = ns === '*' ? [...new Set([...Object.keys(next.namespaces), ...Object.keys(NAMESPACES).filter((n) => !NAMESPACES[n].internal && !NAMESPACES[n].open)])] : (Array.isArray(ns) ? ns : [ns]).map(nsId);
  const changes = [];
  for (const id of ids) {
    const can = canTransition(next, id, to, { ...ctx, now: ctx.now || when, manifests: ctx.manifests?.[id] || ctx.manifests });
    if (!can.ok) bad(`${id}: ${can.reason}`, { ns: id });
    const from = modeOf(next, id);
    const prev = next.namespaces[id] || { drift: 0, lastDriftAt: '' };
    next.namespaces[id] = { mode: to, since: when, cursor: Number.isInteger(cursor) ? cursor : (to === 'cutover' || to === 'rollback' ? prev.cursor || 0 : 0), manifest: typeof manifest === 'string' ? manifest : (to === 'local' ? '' : prev.manifest || ''), drift: to === 'local' || to === 'shadow' ? 0 : prev.drift || 0, lastDriftAt: to === 'local' || to === 'shadow' ? '' : prev.lastDriftAt || '' };
    changes.push({ ns: id, from, to, event: can.event, at: when, by });
  }
  if (ns === '*') { next.mode = to; next.since = when; next.by = by; if (Number.isInteger(cursor)) next.cursor = cursor; if (typeof manifest === 'string') next.manifest = manifest; }
  return { state: next, changes };
}

/**
 * data-drift@1: what shadow logs when the two sides differ. `local` / `remote` are data-record@1 metas (or null for
 * missing, or { error } for a failed write); null when they agree.
 */
export function driftEntry(op, key, local, remote, at) {
  const base = { $axf: DRIFT_RECORD, at: iso(at, '') || bad('drift needs `at`'), op, key };
  const meta = (m) => (m && !m.error ? { rev: m.rev ?? 0, etag: m.etag ?? '', entries: m.entries } : null);
  if (remote && remote.error) return { ...base, kind: op === 'append' ? 'append-failed' : 'write-failed', local: meta(local), remote: null, error: String(remote.error).slice(0, 300) };
  if (op === 'append') { const a = meta(local), b = meta(remote); if (!b) return { ...base, kind: 'missing-remote', local: a, remote: null }; if (a && b && a.entries !== b.entries) return { ...base, kind: 'entries', local: a, remote: b }; return null; }
  const a = meta(local), b = meta(remote);
  if (a && !b) return { ...base, kind: 'missing-remote', local: a, remote: null };
  if (!a && b) return { ...base, kind: 'missing-local', local: null, remote: b };
  if (a && b && a.etag !== b.etag) return { ...base, kind: 'etag', local: a, remote: b };
  return null;
}
/** Count a drift entry on its namespace. */
export function applyDrift(state, entry) {
  if (!entry) return state;
  const id = nsId(entry.key.split('/')[0] === 'plugins' ? entry.key.split('/').slice(0, 2).join('/') : entry.key.split('/')[0]);
  const next = JSON.parse(JSON.stringify(state));
  const e = next.namespaces[id] || { mode: modeOf(next, id), since: next.since, cursor: 0, manifest: '', drift: 0, lastDriftAt: '' };
  next.namespaces[id] = { ...e, drift: (e.drift || 0) + 1, lastDriftAt: entry.at };
  return next;
}
/** The next sensible step per namespace, in migration order: what the CLI / console offers. */
export function nextStep(state, ns, ctx = {}) {
  const id = nsId(ns);
  const mode = modeOf(state, id);
  if (mode === 'local') return { ns: id, mode, next: 'shadow', event: 'start-shadow', ...canTransition(state, id, 'shadow', ctx) };
  if (mode === 'shadow') { const c = canTransition(state, id, 'cutover', ctx); return { ns: id, mode, next: c.ok ? 'cutover' : 'wait', event: c.event, ...c }; }
  if (mode === 'rollback') { const c = canTransition(state, id, 'local', ctx); return { ns: id, mode, next: c.ok ? 'local' : 'replay', event: c.event, ...c }; }
  return { ns: id, mode, next: 'done', event: '', ok: true, reason: '' };
}
/** One plain line per namespace for Amber, the CLI and the banner. */
export function summary(state) {
  const ids = [...new Set([...Object.keys(NAMESPACES).filter((n) => !NAMESPACES[n].internal && !NAMESPACES[n].open), ...Object.keys(state.namespaces || {})])];
  return ids.map((id) => { const e = state.namespaces?.[id]; const mode = modeOf(state, id); return `${id}: ${mode}${e ? ` since ${e.since}` : ' (store default)'}${e?.drift ? `, ${e.drift} drift` : ''}${mode === 'cutover' && e?.cursor ? `, cursor ${e.cursor}` : ''}`; });
}
