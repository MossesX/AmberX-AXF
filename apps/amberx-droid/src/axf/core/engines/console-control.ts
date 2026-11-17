/**
 * console-control@1 reference engine (spec/CONSOLE-CONTROL.md; build full-api-and-voice-control, Nov 13 2026).
 *
 * One address names anything the console shows (`view:builds/tab:pipeline/grid:queue/row:<id>/step:s3`); ten verbs read or
 * drive it (open, state, press, set, scroll, focus, search, list, plugin.enable, plugin.disable). This file is the pure
 * half every transport and every port shares: parse and format addresses, validate a command, resolve an address against a
 * snapshot of the open console's target registry (full or trailing form; `ambiguous` when several match; `not_found` with
 * the nearest labels), the scroll maths, and the answer envelopes with stable wire codes. The DOM half (the registry, the
 * scroll container, the highlight) is framework/react/controlTargets.ts and scrollControl.ts.
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md). Fixture: spec/fixtures/console-control.json.
 */
import {
  CONSOLE_CONTROL_ADDRESS_MAX_DEPTH, CONSOLE_CONTROL_ADDRESS_REQUIRED, CONSOLE_CONTROL_DEFAULT_CAN, CONSOLE_CONTROL_FRAME, CONSOLE_CONTROL_HIGHLIGHT_MS, CONSOLE_CONTROL_ID_MAX,
  CONSOLE_CONTROL_KINDS, CONSOLE_CONTROL_NEAREST_MAX, CONSOLE_CONTROL_PARENTS, CONSOLE_CONTROL_SCROLL_DEFAULT, CONSOLE_CONTROL_SCROLL_DIRS, CONSOLE_CONTROL_SEARCH_LIMIT, CONSOLE_CONTROL_SEARCH_MAX,
  CONSOLE_CONTROL_TARGETS_FRAME, CONSOLE_CONTROL_VALUED_KINDS, CONSOLE_CONTROL_VERBS, CONSOLE_CONTROL_WIRE, isConsoleControlKind, isConsoleControlVerb,
  type ConsoleControlCode, type ConsoleControlKind, type ConsoleControlScrollDir, type ConsoleControlVerb,
} from './console-control-rules.mjs';
import { scoreEntry } from './search';

export {
  CONSOLE_CONTROL_FRAME, CONSOLE_CONTROL_TARGETS_FRAME, CONSOLE_CONTROL_KINDS, CONSOLE_CONTROL_PARENTS, CONSOLE_CONTROL_VERBS, CONSOLE_CONTROL_VERB_IDS, CONSOLE_CONTROL_WIRE, CONSOLE_CONTROL_CODES,
  CONSOLE_CONTROL_DEFAULT_CAN, CONSOLE_CONTROL_SCROLL_DIRS, CONSOLE_CONTROL_SCROLL_DEFAULT, CONSOLE_CONTROL_HIGHLIGHT_MS, consoleControlEffect, consoleControlPermission, consoleControlRegistry, isConsoleControlKind, isConsoleControlVerb,
  type ConsoleControlCode, type ConsoleControlKind, type ConsoleControlVerb, type ConsoleControlEffect, type ConsoleControlScrollDir,
} from './console-control-rules.mjs';

/* ================================================================== types */

export interface AddressSegment { kind: ConsoleControlKind; id: string }
/** A parsed address: segments outermost first. */
export type Address = AddressSegment[];

export interface ControlTarget {
  /** full text address */
  address: string;
  kind: ConsoleControlKind;
  label: string;
  detail?: string;
  icon?: string;
  keywords?: string[];
  requires?: string;
  /** the verbs it answers (default: CONSOLE_CONTROL_DEFAULT_CAN[kind]) */
  can?: ConsoleControlVerb[];
  parent?: string;
  value?: unknown;
  disabled?: boolean;
  destructive?: boolean;
  virtual?: boolean;
}

export interface TargetSnapshot {
  $axf: typeof CONSOLE_CONTROL_TARGETS_FRAME;
  app?: string;
  view: string;
  at?: string;
  scroll?: ScrollState;
  targets: ControlTarget[];
}

export interface ScrollSpec { dir: ConsoleControlScrollDir; amount?: number; to?: string | { path: AddressSegment[] } }
export interface ScrollState { container: string; top: number; left: number; height: number; extent: number; atTop: boolean; atBottom: boolean; fraction: number }
export interface FocusOptions { select?: boolean; expand?: boolean; highlight?: boolean; highlightMs?: number }
export interface SearchQuery { q: string; kinds?: ConsoleControlKind[]; limit?: number }

export interface ConsoleControlCommand {
  $axf?: string;
  verb: ConsoleControlVerb;
  address?: string | { path: AddressSegment[] };
  value?: unknown;
  scroll?: ScrollSpec;
  query?: SearchQuery;
  options?: FocusOptions;
  confirm?: string;
  by?: string;
  reason?: string;
}

export interface ConsoleControlFailure { $axf: typeof CONSOLE_CONTROL_FRAME; ok: false; code: ConsoleControlCode; message: string; [k: string]: unknown }
export interface ConsoleControlSuccess { $axf: typeof CONSOLE_CONTROL_FRAME; ok: true; verb: ConsoleControlVerb; address?: string; audit?: { by: string; reason: string; at: string }; [k: string]: unknown }
export type ConsoleControlResult = ConsoleControlSuccess | ConsoleControlFailure;

/** A typed error with a stable wire code; `toFailure()` is the envelope. */
export class ConsoleControlError extends Error {
  constructor(public readonly code: ConsoleControlCode, message: string, public readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ConsoleControlError';
  }
  toFailure(): ConsoleControlFailure { return consoleControlFailure(this.code, this.message, this.extra); }
}

/* ================================================================== addresses */

const KIND_SET = new Set<string>(CONSOLE_CONTROL_KINDS);
const encodeId = (id: string) => id.replace(/%/g, '%25').replace(/\//g, '%2F');
const decodeId = (id: string) => id.replace(/%2F/gi, '/').replace(/%25/g, '%');

/** Parse a text or object address. Throws ConsoleControlError(invalid) naming the bad segment. */
export function parseAddress(input: unknown): Address {
  if (input === null || input === undefined) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, 'address is missing', { field: 'address' });
  let segs: AddressSegment[];
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, 'address is empty', { field: 'address' });
    segs = text.split('/').map((raw, i) => {
      const at = raw.indexOf(':');
      if (at <= 0) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, `segment ${i + 1} "${raw}" is not kind:id`, { field: 'address', segment: raw });
      const kind = raw.slice(0, at).toLowerCase();
      const id = decodeId(raw.slice(at + 1));
      if (!KIND_SET.has(kind)) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, `segment ${i + 1} "${raw}": kind must be one of ${CONSOLE_CONTROL_KINDS.join(', ')}`, { field: 'address', segment: raw });
      return { kind: kind as ConsoleControlKind, id };
    });
  } else if (typeof input === 'object' && Array.isArray((input as { path?: unknown }).path)) {
    segs = (input as { path: unknown[] }).path.map((s, i) => {
      const o = (typeof s === 'object' && s !== null ? s : {}) as { kind?: unknown; id?: unknown };
      const kind = typeof o.kind === 'string' ? o.kind.toLowerCase() : '';
      if (!KIND_SET.has(kind)) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, `segment ${i + 1}: kind must be one of ${CONSOLE_CONTROL_KINDS.join(', ')}`, { field: 'address', segment: `${String(o.kind)}:${String(o.id ?? '')}` });
      if (typeof o.id !== 'string') throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, `segment ${i + 1} (${kind}): id must be a string`, { field: 'address', segment: `${kind}:` });
      return { kind: kind as ConsoleControlKind, id: o.id };
    });
  } else {
    throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, 'address must be text (kind:id/…) or { path: [{ kind, id }] }', { field: 'address' });
  }
  if (!segs.length) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, 'address is empty', { field: 'address' });
  if (segs.length > CONSOLE_CONTROL_ADDRESS_MAX_DEPTH) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, `address has ${segs.length} segments; at most ${CONSOLE_CONTROL_ADDRESS_MAX_DEPTH}`, { field: 'address' });
  let prev: ConsoleControlKind | null = null;
  for (const [i, s] of segs.entries()) {
    const seg = `${s.kind}:${encodeId(s.id)}`;
    if (!s.id.trim()) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, `segment ${i + 1} (${s.kind}) has an empty id`, { field: 'address', segment: seg });
    if (s.id.length > CONSOLE_CONTROL_ID_MAX) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, `segment ${i + 1} (${s.kind}): id longer than ${CONSOLE_CONTROL_ID_MAX}`, { field: 'address', segment: seg });
    const allowed = CONSOLE_CONTROL_PARENTS[s.kind];
    if (i === 0 ? !allowed.includes(null) : !allowed.includes(prev)) {
      const after = allowed.filter((p): p is ConsoleControlKind => p !== null);
      throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, i === 0 ? `${s.kind} cannot open an address; it follows ${after.join(' or ')}` : `${s.kind} cannot follow ${prev}; it follows ${[...(allowed.includes(null) ? ['the start'] : []), ...after].join(' or ')}`, { field: 'address', segment: seg });
    }
    s.id = s.id.trim();
    prev = s.kind;
  }
  return segs;
}

/** Text form of an address (ids encoded). `formatAddress(parseAddress(t)) === canonical t`. */
export function formatAddress(parts: Address): string {
  return parts.map((s) => `${s.kind}:${encodeId(s.id)}`).join('/');
}

/** A tab segment's row and value: `tab:row=value` → { row, value }; `tab:row` → { row, value: null }. Other kinds never split. */
export function splitTabId(id: string, kind: ConsoleControlKind = 'tab'): { row: string; value: string | null } {
  const at = CONSOLE_CONTROL_VALUED_KINDS.includes(kind) ? id.indexOf('=') : -1;
  return at < 0 ? { row: id, value: null } : { row: id.slice(0, at), value: id.slice(at + 1) };
}

/** The address's last segment. */
export const addressLeaf = (a: Address): AddressSegment => a[a.length - 1]!;
/** The address without its last segment (text), or null at the top. */
export const addressParent = (a: Address): string | null => (a.length > 1 ? formatAddress(a.slice(0, -1)) : null);

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const sameSeg = (a: AddressSegment, b: AddressSegment) => a.kind === b.kind && fold(a.id) === fold(b.id);

/** Does `full` end with `tail` (trailing-segment match: a short address against a registered one)? */
export function addressEndsWith(full: Address, tail: Address): boolean {
  if (tail.length > full.length) return false;
  const off = full.length - tail.length;
  return tail.every((s, i) => sameSeg(full[off + i]!, s));
}

/** Does `full` start with `prefix` (everything under an address)? */
export function addressStartsWith(full: Address, prefix: Address): boolean {
  return prefix.length <= full.length && prefix.every((s, i) => sameSeg(full[i]!, s));
}

/* ================================================================== commands */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const COMMAND_FIELDS = ['$axf', 'verb', 'address', 'value', 'scroll', 'query', 'options', 'confirm', 'by', 'reason'];

/** Every problem with a command, named; [] when it is good. Pure shape + grammar checks (what the JSON Schema says, plus the address grammar). */
export function consoleControlErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['command must be an object'];
  const out: string[] = [];
  if (raw.$axf !== undefined && raw.$axf !== CONSOLE_CONTROL_FRAME) out.push(`$axf must be ${CONSOLE_CONTROL_FRAME}`);
  for (const k of Object.keys(raw)) if (!COMMAND_FIELDS.includes(k)) out.push(`no field ${k}`);
  const verb = raw.verb;
  if (!isConsoleControlVerb(verb)) { out.push(`verb must be one of ${Object.keys(CONSOLE_CONTROL_VERBS).join(', ')}`); return out; }
  const spec = CONSOLE_CONTROL_VERBS[verb];
  for (const k of ['address', 'value', 'scroll', 'query', 'options'] as const) if (raw[k] !== undefined && !spec.takes.includes(k)) out.push(`${verb} does not take ${k}`);
  if (CONSOLE_CONTROL_ADDRESS_REQUIRED.includes(verb) && raw.address === undefined) out.push(`${verb} needs an address`);
  if (raw.address !== undefined) {
    try { parseAddress(raw.address); } catch (e) { out.push(e instanceof ConsoleControlError ? `address: ${e.message}` : 'address: invalid'); }
  }
  if (verb === 'set' && raw.value === undefined) out.push('set needs a value');
  if (verb === 'search') {
    if (!isObj(raw.query)) out.push('search needs query { q, kinds?, limit? }');
    else {
      const q = raw.query;
      if (typeof q.q !== 'string' || !q.q.trim()) out.push('query.q must be words');
      if (q.kinds !== undefined && (!Array.isArray(q.kinds) || !q.kinds.every(isConsoleControlKind))) out.push(`query.kinds must be kinds from ${CONSOLE_CONTROL_KINDS.join(', ')}`);
      if (q.limit !== undefined && (typeof q.limit !== 'number' || !Number.isInteger(q.limit) || q.limit < 1 || q.limit > CONSOLE_CONTROL_SEARCH_MAX)) out.push(`query.limit must be 1 to ${CONSOLE_CONTROL_SEARCH_MAX}`);
      for (const k of Object.keys(q)) if (!['q', 'kinds', 'limit'].includes(k)) out.push(`query: no field ${k}`);
    }
  }
  if (verb === 'scroll') {
    if (!isObj(raw.scroll)) out.push('scroll needs scroll { dir, amount?, to? }');
    else {
      const s = raw.scroll;
      if (!CONSOLE_CONTROL_SCROLL_DIRS.includes(s.dir as ConsoleControlScrollDir)) out.push(`scroll.dir must be one of ${CONSOLE_CONTROL_SCROLL_DIRS.join(', ')}`);
      if (s.amount !== undefined && (typeof s.amount !== 'number' || !(s.amount > 0) || s.amount > 100000)) out.push('scroll.amount must be a number above 0 (px, or a fraction of the view when 1 or less)');
      if (s.dir === 'to' && s.to === undefined) out.push('scroll to needs scroll.to (an address inside the container)');
      if (s.to !== undefined) { try { parseAddress(s.to); } catch (e) { out.push(e instanceof ConsoleControlError ? `scroll.to: ${e.message}` : 'scroll.to: invalid'); } }
      for (const k of Object.keys(s)) if (!['dir', 'amount', 'to'].includes(k)) out.push(`scroll: no field ${k}`);
    }
  }
  if (raw.options !== undefined) {
    if (!isObj(raw.options)) out.push('options must be an object');
    else {
      const o = raw.options;
      for (const k of ['select', 'expand', 'highlight']) if (o[k] !== undefined && typeof o[k] !== 'boolean') out.push(`options.${k} must be true or false`);
      if (o.highlightMs !== undefined && (typeof o.highlightMs !== 'number' || !Number.isInteger(o.highlightMs) || o.highlightMs < 0 || o.highlightMs > 60000)) out.push('options.highlightMs must be 0 to 60000');
      for (const k of Object.keys(o)) if (!['select', 'expand', 'highlight', 'highlightMs'].includes(k)) out.push(`options: no field ${k}`);
    }
  }
  for (const k of ['confirm', 'by', 'reason'] as const) if (raw[k] !== undefined && typeof raw[k] !== 'string') out.push(`${k} must be text`);
  return out;
}

/** Trim, fold, drop unknown fields; the address in canonical text form. Throws ConsoleControlError(invalid) listing every problem. */
export function normalizeConsoleControl(raw: unknown): ConsoleControlCommand & { $axf: typeof CONSOLE_CONTROL_FRAME; address?: string } {
  const errors = consoleControlErrors(raw);
  if (errors.length) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, errors.join('; '), { problems: errors });
  const r = raw as Record<string, unknown>;
  const out: ConsoleControlCommand & { $axf: typeof CONSOLE_CONTROL_FRAME; address?: string } = { $axf: CONSOLE_CONTROL_FRAME, verb: r.verb as ConsoleControlVerb };
  if (r.address !== undefined) out.address = formatAddress(parseAddress(r.address));
  if (r.value !== undefined) out.value = r.value;
  if (isObj(r.scroll)) {
    const s = r.scroll as unknown as ScrollSpec;
    out.scroll = { dir: s.dir, ...(s.amount !== undefined ? { amount: s.amount } : {}), ...(s.to !== undefined ? { to: formatAddress(parseAddress(s.to)) } : {}) };
  }
  if (isObj(r.query)) {
    const q = r.query as unknown as SearchQuery;
    out.query = { q: q.q.trim(), ...(q.kinds ? { kinds: [...new Set(q.kinds)] } : {}), limit: q.limit ?? CONSOLE_CONTROL_SEARCH_LIMIT };
  }
  if (isObj(r.options)) out.options = { ...(r.options as FocusOptions) };
  for (const k of ['confirm', 'by', 'reason'] as const) { const v = r[k]; if (typeof v === 'string' && v.trim()) out[k] = v.trim(); }
  return out;
}

/* ================================================================== resolving */

export interface Resolved { target: ControlTarget; address: Address; can: ConsoleControlVerb[] }

/** The verbs a target answers: its own `can`, else the kind's default. */
export function targetCan(t: ControlTarget): ConsoleControlVerb[] {
  return t.can ?? [...(CONSOLE_CONTROL_DEFAULT_CAN[t.kind] ?? [])];
}

/** Levenshtein similarity in [0, 1] of two folded strings (nearest-label hints). */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) * 0.9 + 0.1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n]! / Math.max(m, n);
}

/** Up to CONSOLE_CONTROL_NEAREST_MAX addresses whose leaf id or label is closest to the one asked for (same kind first). */
export function nearestTargets(snapshot: Pick<TargetSnapshot, 'targets'>, wanted: Address): string[] {
  const leaf = addressLeaf(wanted);
  const want = fold(splitTabId(leaf.id, leaf.kind).value ?? leaf.id);
  return snapshot.targets
    .map((t) => {
      let parsed: Address;
      try { parsed = parseAddress(t.address); } catch { return null; }
      const l = addressLeaf(parsed);
      const idSim = similarity(fold(splitTabId(l.id, l.kind).value ?? l.id), want);
      const score = Math.max(idSim, similarity(fold(t.label), want)) + (l.kind === leaf.kind ? 0.25 : 0);
      return { address: t.address, score };
    })
    .filter((x): x is { address: string; score: number } => !!x && x.score > 0.45)
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
    .slice(0, CONSOLE_CONTROL_NEAREST_MAX)
    .map((x) => x.address);
}

/**
 * Find the one target an address names. A full address matches exactly; a short one matches as the trailing segments of a
 * registered address (so `button:save` = the Save button on this screen). Throws not_found (with `nearest`) or ambiguous
 * (with `candidates`). A `tab:row=value` address matches the tab target itself, else the row target when the row knows the value.
 */
export function resolveAddress(snapshot: Pick<TargetSnapshot, 'targets'>, address: Address | string): Resolved {
  const wanted = typeof address === 'string' ? parseAddress(address) : address;
  const parsed: { t: ControlTarget; a: Address }[] = [];
  for (const t of snapshot.targets) { try { parsed.push({ t, a: parseAddress(t.address) }); } catch { /* a bad registered address never matches */ } }
  const exact = parsed.filter((p) => p.a.length === wanted.length && addressEndsWith(p.a, wanted));
  const pool = exact.length ? exact : parsed.filter((p) => addressEndsWith(p.a, wanted));
  if (pool.length === 1) { const { t, a } = pool[0]!; return { target: t, address: a, can: targetCan(t) }; }
  if (pool.length > 1) {
    // several: the tab row vs its tabs is not ambiguous when the value picks one
    throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.AMBIGUOUS, `${formatAddress(wanted)} names ${pool.length} targets; say which`, { candidates: pool.map((p) => p.t.address).sort() });
  }
  // a tab value the row knows but no tab target was registered for
  const leaf = addressLeaf(wanted);
  if (splitTabId(leaf.id, leaf.kind).value !== null) {
    const { row } = splitTabId(leaf.id, leaf.kind);
    const rowWanted: Address = [...wanted.slice(0, -1), { kind: leaf.kind, id: row }];
    const rows = parsed.filter((p) => addressEndsWith(p.a, rowWanted));
    if (rows.length === 1) { const { t, a } = rows[0]!; return { target: t, address: a, can: targetCan(t) }; }
  }
  throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.NOT_FOUND, `nothing on this screen is ${formatAddress(wanted)}`, { nearest: nearestTargets(snapshot, wanted) });
}

/** Resolve and check the verb: not_found / ambiguous / not_implemented (`can`) / unavailable (disabled) in that order. */
export function resolveForVerb(snapshot: Pick<TargetSnapshot, 'targets'>, address: Address | string, verb: ConsoleControlVerb): Resolved {
  const r = resolveAddress(snapshot, address);
  if (!r.can.includes(verb)) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.NOT_IMPLEMENTED, `${r.target.address} does not answer ${verb}`, { can: r.can });
  if (r.target.disabled && (verb === 'press' || verb === 'set')) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, `${r.target.address} is disabled right now`, { because: 'disabled' });
  return r;
}

/**
 * Every target under an address (the address itself included), or every target when `under` is null. A short `under`
 * is resolved first (trailing match), so `grid:queue` lists the grid and its rows. Throws not_found / ambiguous.
 */
export function listTargets(snapshot: Pick<TargetSnapshot, 'targets'>, under: Address | string | null = null): ControlTarget[] {
  if (!under) return [...snapshot.targets];
  const prefix = resolveAddress(snapshot, under).address;
  return snapshot.targets.filter((t) => { try { return addressStartsWith(parseAddress(t.address), prefix); } catch { return false; } });
}

export interface SearchHitOut { address: string; kind: ConsoleControlKind; label: string; detail?: string; score: number }

/** Rank targets for words (the search engine's scoring over label, detail, keywords, kind and the address's ids). */
export function searchTargets(snapshot: Pick<TargetSnapshot, 'targets'>, query: SearchQuery): SearchHitOut[] {
  const q = query.q.trim();
  if (!q) return [];
  const limit = Math.min(Math.max(1, query.limit ?? CONSOLE_CONTROL_SEARCH_LIMIT), CONSOLE_CONTROL_SEARCH_MAX);
  const hits: SearchHitOut[] = [];
  for (const t of snapshot.targets) {
    if (query.kinds?.length && !query.kinds.includes(t.kind)) continue;
    let ids: string[] = [];
    try { ids = parseAddress(t.address).map((s) => s.id.replace(/[-_.=]/g, ' ')); } catch { /* keep going */ }
    const score = scoreEntry({ label: t.label, detail: t.detail, keywords: [...(t.keywords ?? []), ...ids], kind: t.kind }, q);
    if (score > 0) hits.push({ address: t.address, kind: t.kind, label: t.label, ...(t.detail ? { detail: t.detail } : {}), score: Math.round(score * 1000) / 1000 });
  }
  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label) || a.address.localeCompare(b.address));
  return hits.slice(0, limit);
}

/* ================================================================== scroll maths */

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The state of a container from its raw numbers (what the DOM half reports). */
export function scrollState(container: string, top: number, height: number, extent: number, left = 0): ScrollState {
  const max = Math.max(0, extent - height);
  const t = Math.min(Math.max(0, top), max);
  return { container, top: t, left: Math.max(0, left), height, extent, atTop: t <= 0, atBottom: t >= max - 0.5, fraction: round3(max > 0 ? t / max : 0) };
}

/**
 * The new scroll top for a direction. `up` / `down` move `amount` px (a fraction of the visible height when <= 1; default
 * CONSOLE_CONTROL_SCROLL_DEFAULT of it); `page-*` move the visible height less one `line`; `top` / `bottom` go to the ends;
 * `to` goes to `targetTop` (its offset inside the content), centred when `center`. Clamped to [0, extent - height].
 */
export function scrollStep(state: Pick<ScrollState, 'top' | 'height' | 'extent'>, spec: { dir: ConsoleControlScrollDir; amount?: number }, line = 0, targetTop: number | null = null, center = true): number {
  const max = Math.max(0, state.extent - state.height);
  const px = spec.amount === undefined ? state.height * CONSOLE_CONTROL_SCROLL_DEFAULT : spec.amount <= 1 ? state.height * spec.amount : spec.amount;
  const page = Math.max(1, state.height - Math.max(0, line));
  let next: number;
  switch (spec.dir) {
    case 'up': next = state.top - px; break;
    case 'down': next = state.top + px; break;
    case 'page-up': next = state.top - page; break;
    case 'page-down': next = state.top + page; break;
    case 'top': next = 0; break;
    case 'bottom': next = max; break;
    case 'to':
      if (targetTop === null) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.VALIDATION, 'scroll to: the address is not inside this container', { problems: ['scroll.to is outside the container'] });
      next = center ? targetTop - state.height / 2 : targetTop;
      break;
    default: throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, `scroll.dir must be one of ${CONSOLE_CONTROL_SCROLL_DIRS.join(', ')}`, { field: 'scroll.dir' });
  }
  return Math.round(Math.min(Math.max(0, next), max));
}

/** Focus options with defaults applied. */
export function focusOptions(o: FocusOptions | undefined): Required<FocusOptions> {
  return { select: o?.select ?? true, expand: o?.expand ?? false, highlight: o?.highlight ?? true, highlightMs: o?.highlightMs ?? CONSOLE_CONTROL_HIGHLIGHT_MS };
}

/* ================================================================== answers */

const CODES = new Set<string>(Object.values(CONSOLE_CONTROL_WIRE));

export function consoleControlFailure(code: string, message: string, extra: Record<string, unknown> = {}): ConsoleControlFailure {
  return { $axf: CONSOLE_CONTROL_FRAME, ok: false, code: (CODES.has(code) ? code : CONSOLE_CONTROL_WIRE.UNEXPECTED) as ConsoleControlCode, message, ...extra };
}

/** A success envelope; writes (press, set, plugin.*) carry the audit when `by` is known. */
export function consoleControlResult(cmd: Pick<ConsoleControlCommand, 'verb' | 'address' | 'by' | 'reason'>, data: Record<string, unknown>, opts: { at?: string } = {}): ConsoleControlSuccess {
  const out: ConsoleControlSuccess = { $axf: CONSOLE_CONTROL_FRAME, ok: true, verb: cmd.verb };
  if (cmd.address !== undefined) out.address = typeof cmd.address === 'string' ? cmd.address : formatAddress(cmd.address.path);
  Object.assign(out, data);
  if (CONSOLE_CONTROL_VERBS[cmd.verb].effect === 'write') out.audit = { by: cmd.by ?? '', reason: cmd.reason ?? '', at: opts.at ?? new Date().toISOString() };
  return out;
}

/** Any thrown value as a failure envelope (unknown errors never leak their text: `unexpected`). */
export function failureOf(err: unknown): ConsoleControlFailure {
  if (err instanceof ConsoleControlError) return err.toFailure();
  return consoleControlFailure(CONSOLE_CONTROL_WIRE.UNEXPECTED, 'the command failed');
}

/** A tab segment for a row and (optionally) one tab of it. */
export const tabAddressId = (row: string, value?: string | null) => (value === undefined || value === null ? row : `${row}=${value}`);

/** Builds the address of a child under a parent (text), e.g. `child(parent, 'row', id)`. */
export function childAddress(parent: string | null | undefined, kind: ConsoleControlKind, id: string): string {
  const seg = formatAddress([{ kind, id }]);
  return parent ? `${parent}/${seg}` : seg;
}

/** The nearest registered ancestor address for a DOM-side registry: the longest registered prefix of `address`. */
export function nearestRegisteredParent(snapshot: Pick<TargetSnapshot, 'targets'>, address: Address): string | null {
  const have = new Set(snapshot.targets.map((t) => t.address));
  for (let n = address.length - 1; n >= 1; n--) { const p = formatAddress(address.slice(0, n)); if (have.has(p)) return p; }
  return null;
}
