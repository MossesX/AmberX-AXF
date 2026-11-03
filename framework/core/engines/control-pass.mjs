/**
 * control-pass@1 — timed veto passes for control@1 (Brett, Nov 3 2026, build theme-veto-pass): "allow theme changes
 * for the next 30 minutes". While a pass is active for a scope, the token changes that fall in it (set / reset of the
 * scope's targets) run without axHub's veto countdown; nothing else does.
 *
 * Rules (pure; no IO, no clock of its own: every function takes `now`):
 *   - A scope names the targets and ops it covers (PASS_SCOPES, append-only; later e.g. `amberx.notes`). `tokens.*`
 *     covers the three token scopes. Deletes and every other destructive op are NEVER covered: they still confirm.
 *   - One pass per scope. Granting a scope that already has an active pass replaces it once approved: the new length
 *     runs from the approval, so "another 30 minutes" means 30 minutes from then. The change log carries over, so
 *     undo still rolls back everything since the first grant.
 *   - A grant is a request until the owner approves it (Brett's console click, or his approval in axHub; the transport
 *     says which, never the command). Requests nobody approves lapse after PASS_REQUEST_TTL_MS.
 *   - Expiry is the server's clock: `passActive(p, now)` is the only answer to "is it on?".
 *   - Minutes 1..max (default 30; max PASS_MAX_MINUTES, lowered by the console's setting, never raised).
 *
 * The record (control-pass@1):
 *   { id, scope, state: pending | active | revoked | expired | lapsed | denied, minutes, reason, requestedBy,
 *     requestedAt, approvedBy?, approvedVia?, grantedAt?, expiresAt?, endedAt?, endedBy?, undoneAt?, changes: [change…] }
 *   change = { at, by, target, path, op, before: { overridden, value }, after: { overridden, value } }
 */

export const PASS_FRAME = 'control-pass@1';
export const PASS_TARGET = 'pass.scopes';
export const PASS_MAX_MINUTES = 240;
export const PASS_DEFAULT_MINUTES = 30;
export const PASS_REQUEST_TTL_MS = 15 * 60 * 1000;
/** The warning chip shows this long before a pass ends. */
export const PASS_WARN_MS = 2 * 60 * 1000;
/** Changes kept per pass (the oldest first-touch of every token is always kept, so undo stays exact). */
export const PASS_CHANGES_MAX = 400;
/** The ops a pass may cover: writes that change a value and can be put back. Never remove (destructive), add or act. */
export const PASS_COVERABLE_OPS = ['set', 'reset'];

/**
 * The scopes. `targets`: the control@1 targets it covers; `ops`: which ops on them; `includes`: other scopes it stands
 * for (`tokens.*`). Append-only: a new scope (amberx.notes, planner.steps…) is a new entry here.
 */
export const PASS_SCOPES = {
  'tokens.theme': { label: 'Theme', plain: 'Theme', targets: ['tokens.theme'], ops: PASS_COVERABLE_OPS, doc: 'Colour theme tokens (accent, bg, surface, text…).' },
  'tokens.style': { label: 'Style', plain: 'Style', targets: ['tokens.style'], ops: PASS_COVERABLE_OPS, doc: 'Style theme tokens (fonts, radii, spacing, shadows, transparencies).' },
  'tokens.layout': { label: 'Layout', plain: 'Layout', targets: ['tokens.layout'], ops: PASS_COVERABLE_OPS, doc: 'Layout tokens (nav and inspector sides and widths, paddings, gaps, chrome switches).' },
  'tokens.*': { label: 'All tokens', plain: 'Theme, style and layout', targets: ['tokens.theme', 'tokens.style', 'tokens.layout'], ops: PASS_COVERABLE_OPS, includes: ['tokens.theme', 'tokens.style', 'tokens.layout'], doc: 'Theme, style and layout tokens together.' },
};
export const PASS_SCOPE_IDS = Object.keys(PASS_SCOPES);
/** Short words people say → scope ids (`axf token pass grant theme 30`). */
export const PASS_SCOPE_WORDS = { theme: 'tokens.theme', colour: 'tokens.theme', color: 'tokens.theme', colours: 'tokens.theme', colors: 'tokens.theme', style: 'tokens.style', layout: 'tokens.layout', all: 'tokens.*', tokens: 'tokens.*', '*': 'tokens.*' };
/** The verbs of the pass.scopes target (control@1 `act`), with the input each one takes. */
export const PASS_ACTS = { grant: { minutes: 'number', reason: 'string' }, approve: { request: 'string' }, deny: { request: 'string' }, revoke: {}, undo: {} };
/** How an owner approval arrived (the transport sets it; a command can't). */
export const PASS_APPROVED_VIA = ['console', 'axhub', 'local', 'cli-tty'];

export const PASS_STATES = ['pending', 'active', 'revoked', 'expired', 'lapsed', 'denied'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A word or id → the scope id, or null. */
export function passScopeId(word) {
  if (typeof word !== 'string') return null;
  const w = word.trim();
  if (w in PASS_SCOPES) return w;
  const low = w.toLowerCase();
  return PASS_SCOPE_WORDS[low] ?? (`tokens.${low}` in PASS_SCOPES ? `tokens.${low}` : null);
}

/** The narrowest scope a control@1 command falls in (null = no pass can ever cover it). Destructive ops: always null. */
export function passScopeOf(command) {
  const c = isObj(command) ? command : {};
  if (!PASS_COVERABLE_OPS.includes(c.op)) return null;
  for (const [id, s] of Object.entries(PASS_SCOPES)) if (!s.includes && s.targets.includes(c.target) && s.ops.includes(c.op)) return id;
  return null;
}

/** Every scope whose pass would cover this command (its own scope and the wider ones that include it). */
export function passScopesFor(command) {
  const own = passScopeOf(command);
  if (!own) return [];
  return PASS_SCOPE_IDS.filter((id) => id === own || PASS_SCOPES[id].includes?.includes(own));
}

/** The minutes a grant asks for, clamped: 1..max, whole minutes, default 30. `max` is the console's setting (≤ 240). */
export function passMinutes(v, max = PASS_MAX_MINUTES) {
  const cap = Math.max(1, Math.min(PASS_MAX_MINUTES, Math.floor(Number(max) || PASS_MAX_MINUTES)));
  if (v === undefined || v === null || v === '') return Math.min(PASS_DEFAULT_MINUTES, cap);
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(cap, n));
}

/** Problems with a grant's input, by name (empty = fine). */
export function passGrantErrors(scope, input, max = PASS_MAX_MINUTES) {
  const errors = [];
  if (!passScopeId(scope)) errors.push(`no pass scope ${String(scope)} (${PASS_SCOPE_IDS.join(', ')})`);
  const i = isObj(input) ? input : {};
  if (i.minutes !== undefined && (typeof i.minutes !== 'number' || !Number.isFinite(i.minutes) || i.minutes < 1)) errors.push(`minutes must be a number from 1 to ${Math.min(PASS_MAX_MINUTES, max)}`);
  if (i.reason !== undefined && typeof i.reason !== 'string') errors.push('reason must be a string');
  return errors;
}

/** Is this pass in force right now? (server clock) */
export const passActive = (p, now = Date.now()) => !!p && p.state === 'active' && typeof p.expiresAt === 'string' && Date.parse(p.expiresAt) > now;
/** Is this request still waiting for the owner? */
export const passPending = (p, now = Date.now()) => !!p && p.state === 'pending' && Date.parse(p.requestedAt) + PASS_REQUEST_TTL_MS > now;
/** Milliseconds left (0 when not active). */
export const passRemainingMs = (p, now = Date.now()) => (passActive(p, now) ? Date.parse(p.expiresAt) - now : 0);

/** The state a stored record is in at `now` (an active pass past its end reads expired; an old request reads lapsed). */
export function passStateAt(p, now = Date.now()) {
  if (!p) return null;
  if (p.state === 'active' && !passActive(p, now)) return 'expired';
  if (p.state === 'pending' && !passPending(p, now)) return 'lapsed';
  return p.state;
}

/** The active pass covering this command at `now`, or null. Destructive and unknown commands: always null. */
export function passCovering(passes, command, now = Date.now()) {
  const scopes = passScopesFor(command);
  if (!scopes.length) return null;
  return (Array.isArray(passes) ? passes : []).find((p) => scopes.includes(p.scope) && passActive(p, now)) ?? null;
}

/** "10:42 AM" in Brett's time (America/New_York unless the console says otherwise). */
export function passClock(iso, timeZone = 'America/New_York') {
  try { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso)); } catch { return String(iso).slice(11, 16); }
}

/** "29 min" / "1 h 5 min" / "40 s". */
export function passLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** One plain sentence for a pass at `now` (what the API, MCP and CLI answer with). */
export function passSentence(p, now = Date.now(), timeZone) {
  if (!p) return 'No pass.';
  const what = `${PASS_SCOPES[p.scope]?.plain ?? p.scope} changes`;
  switch (passStateAt(p, now)) {
    case 'active': return `${what} run without veto until ${passClock(p.expiresAt, timeZone)} (${passLeft(passRemainingMs(p, now))} left).`;
    case 'pending': return `${what} without veto for ${p.minutes} min: waiting for Brett to approve (console banner → Token pass, or axHub).`;
    case 'expired': return `The ${what.toLowerCase()} pass ended at ${passClock(p.expiresAt, timeZone)}; changes need the veto again.`;
    case 'lapsed': return `The request for a ${what.toLowerCase()} pass lapsed: nobody approved it within ${PASS_REQUEST_TTL_MS / 60000} minutes.`;
    case 'revoked': return `The ${what.toLowerCase()} pass was revoked${p.endedBy ? ` by ${p.endedBy}` : ''}; changes need the veto again.`;
    case 'denied': return `The request for a ${what.toLowerCase()} pass was denied.`;
    default: return `${what}: ${p.state}.`;
  }
}

/**
 * The changes to make to put back everything a pass changed: per (target, path), the value before the pass first
 * touched it. Newest first so a later override never re-applies over an earlier one.
 */
export function passUndoPlan(p) {
  const first = new Map();
  for (const ch of Array.isArray(p?.changes) ? p.changes : []) {
    const k = `${ch.target}\u0000${ch.path ?? ''}`;
    if (!first.has(k)) first.set(k, ch);
  }
  return [...first.values()].reverse().map((ch) => (ch.before?.overridden
    ? { op: 'set', target: ch.target, path: ch.path, value: ch.before.value }
    : { op: 'reset', target: ch.target, ...(ch.path ? { path: ch.path } : {}) }));
}

/** Add a change to a pass's log, keeping it bounded (the first touch of every token always stays, so undo is exact). */
export function passWithChange(p, change) {
  const changes = [...(Array.isArray(p.changes) ? p.changes : []), change];
  if (changes.length <= PASS_CHANGES_MAX) return { ...p, changes };
  const seen = new Set();
  const keep = changes.filter((ch) => { const k = `${ch.target}\u0000${ch.path ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { ...p, changes: [...keep, ...changes.slice(-(PASS_CHANGES_MAX - keep.length))].slice(-PASS_CHANGES_MAX), trimmed: true };
}

/** The public view of a pass (what GET /pass publishes and the banner reads): no change bodies, the state at `now`. */
export function passPublic(p, now = Date.now(), timeZone) {
  const state = passStateAt(p, now);
  return {
    id: p.id, scope: p.scope, state, minutes: p.minutes, reason: p.reason ?? '', requestedBy: p.requestedBy ?? '', requestedAt: p.requestedAt,
    ...(p.approvedBy ? { approvedBy: p.approvedBy, approvedVia: p.approvedVia } : {}),
    ...(p.grantedAt ? { grantedAt: p.grantedAt } : {}), ...(p.expiresAt ? { expiresAt: p.expiresAt } : {}),
    ...(p.endedAt ? { endedAt: p.endedAt, endedBy: p.endedBy ?? '' } : {}),
    remainingMs: passRemainingMs(p, now), warn: state === 'active' && passRemainingMs(p, now) <= PASS_WARN_MS,
    changes: Array.isArray(p.changes) ? p.changes.length : 0, covers: PASS_SCOPES[p.scope]?.targets ?? [], ops: PASS_SCOPES[p.scope]?.ops ?? [],
    text: passSentence(p, now, timeZone),
  };
}

/** What axHub reads to decide whether a held call skips the veto (framework/spec/CONTROL.md → Veto passes). */
export function passPublication(passes, now = Date.now(), timeZone) {
  const list = Array.isArray(passes) ? passes : [];
  return {
    $axf: PASS_FRAME,
    at: new Date(now).toISOString(),
    active: list.filter((p) => passActive(p, now)).map((p) => passPublic(p, now, timeZone)),
    pending: list.filter((p) => passPending(p, now)).map((p) => passPublic(p, now, timeZone)),
    scopes: Object.fromEntries(Object.entries(PASS_SCOPES).map(([id, s]) => [id, { label: s.label, targets: s.targets, ops: s.ops, ...(s.includes ? { includes: s.includes } : {}) }])),
    never: ['remove', 'add', 'act'],
  };
}
