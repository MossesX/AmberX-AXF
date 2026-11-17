/**
 * Live rows — live-change@1 (reference engine, web port). Spec: framework/spec/LIVE-CHANGES.md.
 *
 * Brett, Nov 17 2026: "Anytime something changes, like a drag and drop or something, it has to hot render." Every grid
 * and list sits on one keyed, ordered ROW SET and consumes one kind of CHANGE EVENT (upsert | delete | reorder) numbered
 * by a per-namespace rev that counts 1, 2, 3… with no gaps. This engine is the whole protocol, pure and UI-free:
 *
 *  - `applyLiveChanges(set, events)` applies a batch and returns ONLY the keys that changed (changed / removed / moved),
 *    so a grid re-renders those rows and keeps scroll, selection, sort, filters, expanded rows, columns, dialogs and
 *    focus (`KEEP_ON_CHANGE`). A rev gap or a new epoch applies nothing and says `resync`.
 *  - `LiveChangeLog` is the store side: a bounded log per namespace that numbers changes and answers `since(rev)` with a
 *    contiguous batch or a resync frame (history / epoch / behind).
 *  - the optimistic layer (optimistic@1): pending local ops by client op id, shown at once, confirmed by the store's echo
 *    (`origin.opId`), rolled back with a reason on reject, timeout, resync or supersede.
 *
 * No React, no DOM, no clock of its own (callers pass `now`). Fixture: spec/fixtures/live-rows.json; checker
 * spec/check-live-rows.mts. Kotlin twin deferred (PORTING.md, Android on hold).
 */

export const LIVE_CHANGE_CONTRACT = 'live-change@1';
export const LIVE_CHANGE_BATCH_FRAME = 'live-change-batch@1';
export const LIVE_CHANGE_RESYNC_FRAME = 'live-change-resync@1';
export const LIVE_ROWS_FRAME = 'live-rows@1';
export const OPTIMISTIC_FRAME = 'optimistic@1';
export const LIVE_CHANGE_FRAMES = [LIVE_CHANGE_CONTRACT, LIVE_CHANGE_BATCH_FRAME, LIVE_CHANGE_RESYNC_FRAME, LIVE_ROWS_FRAME, OPTIMISTIC_FRAME] as const;
/** Capability a store registers its emitter under (`plugin_services.get("axf.live-changes@1").emit(event)`). */
export const LIVE_CHANGES_CAPABILITY = 'axf.live-changes@1';

export const LIVE_CHANGE_OPS = ['upsert', 'delete', 'reorder'] as const;
export type LiveChangeOp = (typeof LIVE_CHANGE_OPS)[number];
/** The surfaces a change can come from. Open set: a surface not listed is accepted as long as it is a lower-case word. */
export const LIVE_CHANGE_SURFACES = ['console', 'cli', 'mcp', 'voice', 'api', 'orchestrator', 'hub', 'plugin', 'server'] as const;
/** gap / epoch: the consumer decides; history / behind: the store answers with a resync instead of events. */
export const RESYNC_REASONS = ['gap', 'epoch', 'history', 'behind'] as const;
export type ResyncReason = (typeof RESYNC_REASONS)[number];
export const ROLLBACK_REASONS = ['rejected', 'timeout', 'resync', 'superseded'] as const;
export type RollbackReason = (typeof ROLLBACK_REASONS)[number];
/** What a grid keeps across every batch and every resync; only the rows that changed are touched. */
export const KEEP_ON_CHANGE = ['scroll', 'selection', 'sort', 'filters', 'expanded', 'columns', 'dialogs', 'focus'] as const;
export const LIVE_CHANGE_LIMITS = Object.freeze({ ns: 160, key: 128, session: 64, batch: 1000, pending: 256 });
export const LIVE_CHANGE_PATTERNS = Object.freeze({ ns: /^[a-z0-9_-]+(\/[A-Za-z0-9._:-]+)*$/, key: /^[^/]{1,128}$/, surface: /^[a-z][a-z0-9-]*$/ });
/** A pending optimistic op not echoed within this many ms rolls back with reason `timeout` (a setting; this is the default). */
export const OPTIMISTIC_TIMEOUT_MS = 8000;
/** Default size of a store-side log: how many events `since` can replay before it answers with a resync. */
export const LIVE_LOG_LIMIT = 4000;
/** data-change@1 (data-store@1 watch) → live-change@1, field for field; `cursor` is the store-wide contiguous counter. */
export const DATA_STORE_MAP = Object.freeze({ ns: 'ns', path: 'key', put: 'upsert', delete: 'delete', cursor: 'rev', by: 'origin', at: 'ts' });

export type LiveRow = Record<string, unknown>;
export interface LiveOrigin { session: string; surface: string; client?: string; opId?: string }
export interface LiveChange {
  $axf?: typeof LIVE_CHANGE_CONTRACT;
  ns: string;
  key: string;
  op: LiveChangeOp;
  /** per-namespace, contiguous, never reused: the namespace's rev after this change */
  rev: number;
  /** a store that restarted its rev line carries a new epoch; a different epoch voids every rev */
  epoch?: string;
  /** upsert: the whole row, never a patch */
  row?: LiveRow;
  /** reorder: the key the row now sits before; null = the end */
  before?: string | null;
  origin: LiveOrigin;
  ts: number;
}
export interface LiveChangeBatch { $axf: typeof LIVE_CHANGE_BATCH_FRAME; ns: string; events: LiveChange[]; rev: number; epoch?: string }
export interface LiveChangeResync { $axf: typeof LIVE_CHANGE_RESYNC_FRAME; ns: string; reason: ResyncReason; rev: number; epoch?: string; rows: LiveRow[]; order: string[] }

/** One keyed, ordered row set at a rev. `order` is the store's order (the drag-and-drop order); sorting is the viewer's. */
export interface LiveRowSet { ns: string; rev: number; epoch?: string; order: string[]; rows: Record<string, LiveRow> }
export interface ResyncNeed { reason: ResyncReason; have: number; saw: number }
export interface ApplyResult {
  set: LiveRowSet;
  /** keys whose row is new or whose content differs (an upsert of an identical row is not a change) */
  changed: string[];
  /** keys that left the set */
  removed: string[];
  /** keys still present whose index in `order` differs */
  moved: string[];
  /** events applied (rev == have + 1) */
  applied: number;
  /** events with rev ≤ have (duplicates from a replay) */
  skipped: number;
  /** applied events that changed nothing (delete / reorder of an unknown key, reorder to the same place) */
  ignored: number;
  /** set when nothing was applied and the consumer must ask `since` again */
  resync: ResyncNeed | null;
}

// ─── Row sets ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function emptyRowSet(ns: string, epoch?: string): LiveRowSet {
  return { ns, rev: 0, ...(epoch ? { epoch } : {}), order: [], rows: {} };
}

/** A row set from rows in order (a first load, a store's snapshot). `keyOf` picks each row's key (default: `row.id`). */
export function rowSetFrom(ns: string, rows: LiveRow[], rev: number, keyOf: (row: LiveRow) => string = (r) => String(r.id ?? r.key ?? ''), epoch?: string): LiveRowSet {
  const set = emptyRowSet(ns, epoch);
  set.rev = Math.max(0, Math.floor(rev));
  for (const row of rows) {
    const key = keyOf(row);
    if (!key || key in set.rows) continue;
    set.order.push(key);
    set.rows[key] = row;
  }
  return set;
}

/** A row set from a resync frame (`live-change-resync@1`): rows in `order`; a row the order does not name goes last. */
export function rowSetFromResync(frame: LiveChangeResync, keyOf: (row: LiveRow) => string = (r) => String(r.id ?? r.key ?? '')): LiveRowSet {
  const byKey = new Map(frame.rows.map((r) => [keyOf(r), r] as const));
  const ordered: LiveRow[] = [];
  for (const k of frame.order) { const r = byKey.get(k); if (r) { ordered.push(r); byKey.delete(k); } }
  for (const r of byKey.values()) ordered.push(r);
  return rowSetFrom(frame.ns, ordered, frame.rev, keyOf, frame.epoch);
}

/** Canonical JSON (sorted keys) so two rows compare the same on every port. */
export function canonicalRow(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalRow).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalRow(o[k])}`).join(',')}}`;
}

export function sameRow(a: LiveRow | undefined, b: LiveRow | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return canonicalRow(a) === canonicalRow(b);
}

/** The keys that differ between two sets: changed (new or different content), removed, moved (same key, other index). */
export function diffRowSets(before: LiveRowSet, after: LiveRowSet): { changed: string[]; removed: string[]; moved: string[] } {
  const changed: string[] = []; const removed: string[] = []; const moved: string[] = [];
  const beforeIdx = new Map(before.order.map((k, i) => [k, i] as const));
  const afterIdx = new Map(after.order.map((k, i) => [k, i] as const));
  for (const k of after.order) {
    if (!(k in before.rows)) { changed.push(k); continue; }
    if (!sameRow(before.rows[k], after.rows[k])) changed.push(k);
  }
  for (const k of before.order) if (!(k in after.rows)) removed.push(k);
  // moved: the fewest surviving keys that left their place, i.e. the survivors outside the longest common subsequence
  // of the two orders. A drag of one row to the top reports that one row, not every row it passed; an insert or a
  // delete elsewhere reports nothing as moved.
  const sb = before.order.filter((k) => afterIdx.has(k));
  const sa = after.order.filter((k) => beforeIdx.has(k));
  const kept = longestCommonSubsequence(sb, sa);
  for (const k of sa) if (!kept.has(k)) moved.push(k);
  return { changed, removed, moved };
}

function longestCommonSubsequence(a: string[], b: string[]): Set<string> {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const keep = new Set<string>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { keep.add(a[i]!); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return keep;
}

// ─── Applying changes ────────────────────────────────────────────────────────────────────────────────────────────────

function cloneSet(set: LiveRowSet): LiveRowSet {
  return { ns: set.ns, rev: set.rev, ...(set.epoch ? { epoch: set.epoch } : {}), order: [...set.order], rows: { ...set.rows } };
}

/** One op on a set, no rev bookkeeping (the optimistic layer replays pending ops through this). Returns whether anything changed. */
export function applyOp(set: LiveRowSet, op: { key: string; op: LiveChangeOp; row?: LiveRow; before?: string | null }): boolean {
  const { key } = op;
  if (op.op === 'upsert') {
    const row = op.row ?? {};
    const had = key in set.rows;
    if (had && sameRow(set.rows[key], row)) return false;
    if (!had) set.order.push(key);
    set.rows[key] = row;
    return true;
  }
  if (op.op === 'delete') {
    if (!(key in set.rows)) return false;
    delete set.rows[key];
    set.order = set.order.filter((k) => k !== key);
    return true;
  }
  // reorder
  if (!(key in set.rows)) return false;
  const without = set.order.filter((k) => k !== key);
  const before = op.before ?? null;
  const at = before !== null && before !== key ? without.indexOf(before) : -1;
  const next = at < 0 ? [...without, key] : [...without.slice(0, at), key, ...without.slice(at)];
  if (next.every((k, i) => k === set.order[i]) && next.length === set.order.length) return false;
  set.order = next;
  return true;
}

/**
 * Apply a batch in rev order. Duplicates (rev ≤ have) are skipped; a gap (rev > have + 1) or a foreign epoch applies
 * NOTHING and asks for a resync, so a half-applied batch never exists. Returns the new set and only the keys that changed.
 */
export function applyLiveChanges(set: LiveRowSet, events: LiveChange[]): ApplyResult {
  const none = (resync: ResyncNeed | null, skipped = 0): ApplyResult => ({ set, changed: [], removed: [], moved: [], applied: 0, skipped, ignored: 0, resync });
  let have = set.rev;
  let skipped = 0;
  const toApply: LiveChange[] = [];
  for (const e of events) {
    if (e.ns !== set.ns) continue;
    if (e.epoch !== undefined && set.epoch !== undefined && e.epoch !== set.epoch) return none({ reason: 'epoch', have: set.rev, saw: e.rev });
    if (e.rev <= have) { skipped++; continue; }
    if (e.rev !== have + 1) return none({ reason: 'gap', have, saw: e.rev }, skipped);
    toApply.push(e);
    have = e.rev;
  }
  if (!toApply.length) return none(null, skipped);
  const next = cloneSet(set);
  let ignored = 0;
  for (const e of toApply) {
    if (!applyOp(next, e)) ignored++;
    next.rev = e.rev;
    if (e.epoch !== undefined) next.epoch = e.epoch;
  }
  const d = diffRowSets(set, next);
  return { set: next, ...d, applied: toApply.length, skipped, ignored, resync: null };
}

/** What a consumer asks the store next: the rev it holds (and its epoch when it has one). */
export function resumeQuery(set: LiveRowSet): { ns: string; since: number; epoch?: string } {
  return { ns: set.ns, since: set.rev, ...(set.epoch ? { epoch: set.epoch } : {}) };
}

/** Is this event this client's own echo? (Its optimistic layer confirms it by `opId`; the grid need not flash it.) */
export function isOwnChange(e: LiveChange, client: string | undefined): boolean {
  return !!client && e.origin?.client === client;
}

/** data-change@1 (data-store@1 watch) → live-change@1. The record body is not in the change frame; pass it as `row` for a put. */
export function fromDataChange(c: { cursor: number; ns: string; path: string; op: string; by?: string; at?: string | number }, row?: LiveRow): LiveChange | null {
  const op: LiveChangeOp | null = c.op === 'put' || c.op === 'append' ? 'upsert' : c.op === 'delete' ? 'delete' : null;
  if (!op) return null;
  const by = String(c.by || 'server');
  const surface = (LIVE_CHANGE_SURFACES as readonly string[]).includes(by) ? by : 'server';
  const ts = typeof c.at === 'number' ? c.at : (c.at ? Date.parse(String(c.at)) : 0);
  return { $axf: LIVE_CHANGE_CONTRACT, ns: c.ns, key: c.path, op, rev: c.cursor, ...(op === 'upsert' ? { row: row ?? {} } : {}), origin: { session: by, surface }, ts: Number.isFinite(ts) ? ts : 0 };
}

// ─── Validation ──────────────────────────────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Problems with one event, in plain words; empty when it is a valid live-change@1. */
export function liveChangeErrors(e: unknown): string[] {
  if (!isObj(e)) return ['a live change is an object'];
  const errors: string[] = [];
  if (e.$axf !== undefined && e.$axf !== LIVE_CHANGE_CONTRACT) errors.push(`$axf must be ${LIVE_CHANGE_CONTRACT}`);
  if (typeof e.ns !== 'string' || !LIVE_CHANGE_PATTERNS.ns.test(e.ns) || e.ns.length > LIVE_CHANGE_LIMITS.ns) errors.push('ns: a data-store namespace, optionally /<path>, at most 160 chars');
  if (typeof e.key !== 'string' || !LIVE_CHANGE_PATTERNS.key.test(e.key)) errors.push('key: 1–128 chars, no /');
  if (!(LIVE_CHANGE_OPS as readonly unknown[]).includes(e.op)) errors.push(`op: one of ${LIVE_CHANGE_OPS.join(' | ')}`);
  if (!isInt(e.rev) || e.rev < 1) errors.push('rev: an integer ≥ 1');
  if (e.epoch !== undefined && (typeof e.epoch !== 'string' || e.epoch.length > 64)) errors.push('epoch: a string of at most 64 chars');
  if (e.op === 'upsert' && !isObj(e.row)) errors.push('row: required with upsert, the whole row as an object');
  if (e.op !== 'upsert' && e.row !== undefined) errors.push('row: only with upsert');
  if (e.op === 'reorder' && !(e.before === null || typeof e.before === 'string')) errors.push('before: required with reorder, a key or null');
  if (e.op !== 'reorder' && e.before !== undefined) errors.push('before: only with reorder');
  if (!isObj(e.origin)) errors.push('origin: { session, surface } required');
  else {
    const o = e.origin;
    if (typeof o.session !== 'string' || !o.session || o.session.length > LIVE_CHANGE_LIMITS.session) errors.push('origin.session: 1–64 chars');
    if (typeof o.surface !== 'string' || !LIVE_CHANGE_PATTERNS.surface.test(o.surface)) errors.push('origin.surface: a lower-case word (console, cli, mcp, voice, api, orchestrator, hub, plugin, server, …)');
    if (o.client !== undefined && (typeof o.client !== 'string' || o.client.length > 64)) errors.push('origin.client: a string of at most 64 chars');
    if (o.opId !== undefined && (typeof o.opId !== 'string' || o.opId.length > 64)) errors.push('origin.opId: a string of at most 64 chars');
  }
  if (!isInt(e.ts) || e.ts < 0) errors.push('ts: ms since the epoch, an integer ≥ 0');
  return errors;
}

/** Problems with a batch: frame, ns, contiguous revs in order, the batch rev equals the last event's. */
export function liveBatchErrors(b: unknown): string[] {
  if (!isObj(b)) return ['a batch is an object'];
  const errors: string[] = [];
  if (b.$axf !== LIVE_CHANGE_BATCH_FRAME) errors.push(`$axf must be ${LIVE_CHANGE_BATCH_FRAME}`);
  if (typeof b.ns !== 'string') errors.push('ns: required');
  if (!isInt(b.rev) || b.rev < 0) errors.push('rev: an integer ≥ 0');
  if (!Array.isArray(b.events)) { errors.push('events: an array'); return errors; }
  if (b.events.length > LIVE_CHANGE_LIMITS.batch) errors.push(`events: at most ${LIVE_CHANGE_LIMITS.batch}`);
  let prev: number | null = null;
  b.events.forEach((e: unknown, i: number) => {
    const es = liveChangeErrors(e);
    if (es.length) errors.push(`events[${i}]: ${es.join('; ')}`);
    if (!isObj(e)) return;
    if (e.ns !== b.ns) errors.push(`events[${i}]: ns differs from the batch`);
    if (isInt(e.rev)) { if (prev !== null && e.rev !== prev + 1) errors.push(`events[${i}]: rev ${e.rev} does not follow ${prev}`); prev = e.rev; }
  });
  if (prev !== null && isInt(b.rev) && b.rev !== prev) errors.push(`rev ${b.rev} is not the last event's rev ${prev}`);
  return errors;
}

// ─── The store side: a bounded log per namespace ─────────────────────────────────────────────────────────────────────

export interface LiveLogAppend { key: string; op: LiveChangeOp; row?: LiveRow; before?: string | null; origin: LiveOrigin; ts: number }

/**
 * Numbers changes for one namespace and answers `since`. Keeps the current row set (so a resync can be answered) and the
 * newest `limit` events. Every append moves `rev` by one; an append that changes nothing is still an event (the rev line
 * is the log's, not the rows').
 */
export class LiveChangeLog {
  readonly ns: string;
  readonly limit: number;
  readonly epoch: string | undefined;
  private set: LiveRowSet;
  private events: LiveChange[] = [];

  constructor(ns: string, opts: { limit?: number; epoch?: string; rows?: LiveRow[]; rev?: number; keyOf?: (row: LiveRow) => string } = {}) {
    this.ns = ns;
    this.limit = Math.max(1, opts.limit ?? LIVE_LOG_LIMIT);
    this.epoch = opts.epoch;
    this.set = rowSetFrom(ns, opts.rows ?? [], opts.rev ?? 0, opts.keyOf, opts.epoch);
  }

  get rev(): number { return this.set.rev; }
  /** the oldest rev `since` can still replay from (the rev a consumer may hold); 0 when the log holds everything */
  get firstRev(): number { return this.events.length ? this.events[0]!.rev - 1 : this.set.rev; }
  rows(): LiveRowSet { return cloneSet(this.set); }

  append(a: LiveLogAppend): LiveChange {
    const rev = this.set.rev + 1;
    const e: LiveChange = { $axf: LIVE_CHANGE_CONTRACT, ns: this.ns, key: a.key, op: a.op, rev, ...(this.epoch ? { epoch: this.epoch } : {}), ...(a.op === 'upsert' ? { row: a.row ?? {} } : {}), ...(a.op === 'reorder' ? { before: a.before ?? null } : {}), origin: { ...a.origin }, ts: a.ts };
    const next = cloneSet(this.set);
    applyOp(next, e);
    next.rev = rev;
    this.set = next;
    this.events.push(e);
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
    return e;
  }

  /** The whole set at the current rev as a resync frame. */
  snapshot(reason: ResyncReason): LiveChangeResync {
    return { $axf: LIVE_CHANGE_RESYNC_FRAME, ns: this.ns, reason, rev: this.set.rev, ...(this.epoch ? { epoch: this.epoch } : {}), rows: this.set.order.map((k) => this.set.rows[k]!), order: [...this.set.order] };
  }

  /** Everything after `rev` (at most `max`), or a resync when the log cannot replay from there. */
  since(rev: number, opts: { epoch?: string; max?: number } = {}): LiveChangeBatch | LiveChangeResync {
    const max = Math.max(0, opts.max ?? LIVE_CHANGE_LIMITS.batch);
    if (opts.epoch !== undefined && this.epoch !== undefined && opts.epoch !== this.epoch) return this.snapshot('epoch');
    if (rev > this.set.rev) return this.snapshot('behind');
    if (rev < this.firstRev) return this.snapshot('history');
    const events = this.events.filter((e) => e.rev > rev).slice(0, max);
    const last = events.length ? events[events.length - 1]!.rev : rev;
    return { $axf: LIVE_CHANGE_BATCH_FRAME, ns: this.ns, events, rev: last, ...(this.epoch ? { epoch: this.epoch } : {}) };
  }
}

// ─── Registry snapshot + JSON Schemas (framework/schemas/live-change.json, schemas/json/live-change*.schema.json) ─────

export const LIVE_CHANGE_REGISTRY = Object.freeze({
  $axf: LIVE_CHANGE_CONTRACT,
  note: 'Snapshot of the live-change@1 contract (spec/LIVE-CHANGES.md): the one change event every row store emits and every grid consumes. Generated from framework/core/engines/live-rows.ts; spec/check-live-rows.mts fails when they drift.',
  frames: [...LIVE_CHANGE_FRAMES],
  ops: [...LIVE_CHANGE_OPS],
  surfaces: [...LIVE_CHANGE_SURFACES],
  surfacesOpen: true,
  resyncReasons: [...RESYNC_REASONS],
  rollbackReasons: [...ROLLBACK_REASONS],
  keepOnChange: [...KEEP_ON_CHANGE],
  limits: { ...LIVE_CHANGE_LIMITS },
  patterns: { ns: LIVE_CHANGE_PATTERNS.ns.source, key: LIVE_CHANGE_PATTERNS.key.source },
  optimisticTimeoutMs: OPTIMISTIC_TIMEOUT_MS,
  logLimit: LIVE_LOG_LIMIT,
  capability: LIVE_CHANGES_CAPABILITY,
  dataStoreMap: { ...DATA_STORE_MAP },
});

export function liveChangeJsonSchemas(): Record<string, unknown> {
  const event = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'axf/live-change.schema.json',
    title: 'AmberX AXF live change (live-change@1)',
    description: 'Generated from framework/core/engines/live-rows.ts (spec/LIVE-CHANGES.md). One change to one row of one keyed, ordered row set; revs are contiguous per namespace.',
    type: 'object',
    required: ['ns', 'key', 'op', 'rev', 'origin', 'ts'],
    properties: {
      $axf: { const: LIVE_CHANGE_CONTRACT },
      ns: { type: 'string', pattern: LIVE_CHANGE_PATTERNS.ns.source, maxLength: LIVE_CHANGE_LIMITS.ns },
      key: { type: 'string', pattern: LIVE_CHANGE_PATTERNS.key.source },
      op: { enum: [...LIVE_CHANGE_OPS] },
      rev: { type: 'integer', minimum: 1 },
      epoch: { type: 'string', maxLength: 64 },
      row: { type: 'object' },
      before: { type: ['string', 'null'] },
      origin: {
        type: 'object',
        required: ['session', 'surface'],
        properties: {
          session: { type: 'string', minLength: 1, maxLength: LIVE_CHANGE_LIMITS.session },
          surface: { type: 'string', pattern: LIVE_CHANGE_PATTERNS.surface.source },
          client: { type: 'string', maxLength: 64 },
          opId: { type: 'string', maxLength: 64 },
        },
      },
      ts: { type: 'integer', minimum: 0 },
    },
    allOf: [
      { if: { properties: { op: { const: 'upsert' } } }, then: { required: ['row'] } },
      { if: { properties: { op: { const: 'reorder' } } }, then: { required: ['before'] } },
    ],
  };
  const batch = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'axf/live-change-batch.schema.json',
    title: 'AmberX AXF live change batch and resync (live-change-batch@1, live-change-resync@1)',
    description: 'Generated from framework/core/engines/live-rows.ts (spec/LIVE-CHANGES.md). What a store answers to since(ns, rev): a batch of contiguous events, or the whole row set when the consumer must resync.',
    oneOf: [
      {
        type: 'object',
        required: ['$axf', 'ns', 'events', 'rev'],
        properties: {
          $axf: { const: LIVE_CHANGE_BATCH_FRAME },
          ns: { type: 'string' },
          events: { type: 'array', maxItems: LIVE_CHANGE_LIMITS.batch, items: { $ref: 'axf/live-change.schema.json' } },
          rev: { type: 'integer', minimum: 0 },
          epoch: { type: 'string' },
        },
      },
      {
        type: 'object',
        required: ['$axf', 'ns', 'reason', 'rev', 'rows', 'order'],
        properties: {
          $axf: { const: LIVE_CHANGE_RESYNC_FRAME },
          ns: { type: 'string' },
          reason: { enum: [...RESYNC_REASONS] },
          rev: { type: 'integer', minimum: 0 },
          epoch: { type: 'string' },
          rows: { type: 'array', items: { type: 'object' } },
          order: { type: 'array', items: { type: 'string' } },
        },
      },
    ],
  };
  return { 'live-change.schema.json': event, 'live-change-batch.schema.json': batch };
}
