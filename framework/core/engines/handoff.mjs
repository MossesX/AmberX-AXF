/**
 * Session sync — handoff@1 (the sync file) and session-link@1 (the live link between Claude sessions).
 * Spec: framework/spec/HANDOFF.md. Brett, Nov 4 2026: two Claude sessions (any accounts, Claude Code or claude.ai)
 * work on one project side by side, talk in the Breakroom's Sessions channel, and never build the same thing or touch
 * the same files: area / path claims are leases, the orchestrator hands work to helpers (whole builds or steps), a
 * helper accepts / rejects / holds / releases and the orchestrator reacts, replans and dedupes. Primary = the session
 * that synced first (Brett's main account) and owns the orchestrator; every joiner is a secondary with a scoped view.
 *
 * Pure: no IO, no clock (every function takes `now` as an ISO string), zero tokens. The console's Session sync plugin
 * owns the link document and calls these; the fixture spec/fixtures/handoff.json replays every rule (check-handoff.mjs).
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
/** Secret patterns = session@1's `redact` rules (framework/schemas/session.json; check-handoff keeps them equal). */
export const REDACT_RULES = [
  { id: 'private-key', pattern: '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----', flags: '' },
  { id: 'anthropic-key', pattern: '\\bsk-ant-[A-Za-z0-9_-]{20,}', flags: '' },
  { id: 'openai-key', pattern: '\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}', flags: '' },
  { id: 'github-token', pattern: '\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\\bgithub_pat_[A-Za-z0-9_]{30,}', flags: '' },
  { id: 'aws-key', pattern: '\\bAKIA[0-9A-Z]{16}', flags: '' },
  { id: 'slack-token', pattern: '\\bxox[abposr]-[A-Za-z0-9-]{10,}', flags: '' },
  { id: 'google-key', pattern: '\\bAIza[0-9A-Za-z_-]{35}', flags: '' },
  { id: 'jwt', pattern: '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}', flags: '' },
  { id: 'bearer', pattern: '(Bearer\\s+)(?!\\[redacted)[A-Za-z0-9._~+/=-]{16,}', flags: 'i' },
  { id: 'url-credentials', pattern: '(://[^/\\s:@]{1,64}:)[^@\\s/]{3,}(@)', flags: '' },
  { id: 'secret-value', pattern: '((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)["\']?\\s*[:=]\\s*["\']?)(?![\\[$<{(])[^\\s"\'&,;]{6,}', flags: 'i' },
];

export const FRAMES = { link: 'session-link@1', sync: 'handoff@1', event: 'session-event@1' };
export const ROLES = ['primary', 'secondary'];
export const CLIENTS = ['code', 'chat', 'voice', 'headless', 'console'];
export const SESSION_STATUSES = ['pending', 'working', 'idle', 'lunch', 'offline', 'ended'];
export const CLAIM_KINDS = ['area', 'path'];
export const OFFER_MODES = ['whole', 'steps-new-build'];
export const OFFER_STATUSES = ['offered', 'accepted', 'rejected', 'held', 'withdrawn', 'expired'];
export const ASSIGNMENT_STATUSES = ['queued', 'working', 'done', 'blocked', 'held', 'rejected', 'released', 'taken-back'];
export const RESPONSES = ['accept', 'reject', 'hold', 'release'];
export const STEP_STATES = ['done', 'blocked', 'started'];
export const REACTIONS = ['take-back', 're-offer', 're-split', 'reassign', 'wait', 'replan', 'none'];
export const EVENT_TYPES = ['link', 'session', 'claim', 'offer', 'assignment', 'message', 'build', 'replan', 'handover', 'sync', 'audit'];
export const HELPER_STATES = ['none', 'idle', 'working', 'lunch'];
/** Message kinds the Sessions channel adds to the Breakroom chat (swarm-chat@1 `channel: "sessions"`). */
export const CHANNEL = 'sessions';
export const MESSAGE_KINDS = ['session', 'handover', 'claim', 'report'];
export const CHAT_FILTERS = ['all', 'handovers', 'blockers', 'mine'];

/** Named areas → path globs (open registry; a project's sync settings may add more). */
export const AREAS = {
  terminal: ['apps/console-web/plugins/console-terminal/**'],
  banner: ['framework/react/components/Banner*.tsx', 'apps/console-web/plugins/*-banner/**'],
  kernel: ['framework/core/**', 'framework/android/axf-kernel/**'],
  plugins: ['apps/console-web/plugins/**'],
  builds: ['_claude/builds/**'],
  spec: ['framework/spec/**', 'framework/schemas/**'],
  console: ['apps/console-web/src/**'],
};

export const DEFAULT_SETTINGS = {
  enforce: true, claimTtlSec: 1200, heartbeatSec: 60, idleSec: 600, lunchSec: 1800, offlineSec: 3600,
  slotSplit: {}, sendDefault: 'ask', askOnSend: true, hideDisconnected: false, eventLimit: 2000, freshForSec: 1800,
  approveNewAccounts: true, offerTtlSec: 3600,
};
/** Settings only Brett changes (his console click or an axHub approval). */
export const OWNER_SETTINGS = ['enforce', 'approveNewAccounts', 'slotSplit'];

/** The role gate (spec § 7): what each role may do. Brett's own click is always allowed (checked by the server). */
export const ACTIONS = {
  state: { primary: true, secondary: true }, snapshot: { primary: true, secondary: true }, claims: { primary: true, secondary: true },
  messages: { primary: true, secondary: true }, audit: { primary: true, secondary: true }, offers: { primary: true, secondary: true },
  join: { primary: true, secondary: true }, heartbeat: { primary: true, secondary: true }, end: { primary: true, secondary: true },
  sync: { primary: true, secondary: true }, claim: { primary: true, secondary: true }, release: { primary: true, secondary: true },
  send: { primary: true, secondary: true }, inbox: { primary: true, secondary: true },
  'request-work': { primary: false, secondary: true }, respond: { primary: false, secondary: true },
  step: { primary: true, secondary: true },
  'build-add': { primary: true, secondary: false }, 'build-queue': { primary: true, secondary: false }, 'build-start': { primary: true, secondary: false },
  'build-edit': { primary: true, secondary: false }, 'build-reorder': { primary: true, secondary: false }, 'build-cancel': { primary: true, secondary: false },
  'build-model': { primary: true, secondary: false }, 'plan-edit': { primary: true, secondary: false }, 'profile-edit': { primary: true, secondary: false },
  offer: { primary: true, secondary: false }, assign: { primary: true, secondary: false }, 'take-back': { primary: true, secondary: false },
  replan: { primary: true, secondary: false }, 'claim-job': { primary: true, secondary: false },
  settings: { primary: false, secondary: false }, 'make-primary': { primary: false, secondary: false }, 'approve-account': { primary: false, secondary: false },
  revoke: { primary: false, secondary: false },
};

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v, d) => (Number.isFinite(v) ? v : d);
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
const plus = (iso, sec) => new Date(ms(iso) + sec * 1000).toISOString();
const slug = (s) => str(s, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const settingsOf = (link) => ({ ...DEFAULT_SETTINGS, ...(isObj(link?.settings) ? link.settings : {}) });

/* ------------------------------------------------------------------ */
/* The link document                                                    */
/* ------------------------------------------------------------------ */

export function emptyLink(project = '') {
  return { $axf: FRAMES.link, project: str(project, 80), rev: 0, updatedAt: '', seq: 0, primary: null, sessions: {}, claims: {}, offers: {}, assignments: {}, events: [], stats: {}, settings: {} };
}

export const normSession = (s) => ({
  id: str(s?.id, 120), account: str(s?.account, 120), agent: str(s?.agent, 40), client: CLIENTS.includes(s?.client) ? s.client : 'code',
  role: ROLES.includes(s?.role) ? s.role : 'secondary', approved: s?.approved !== false,
  doing: { build: str(s?.doing?.build, 120), step: str(s?.doing?.step, 40), note: str(s?.doing?.note, 300) },
  startedAt: str(s?.startedAt, 40), lastSeenAt: str(s?.lastSeenAt, 40), endedAt: str(s?.endedAt, 40),
  pause: isObj(s?.pause) ? { reason: str(s.pause.reason, 200), until: str(s.pause.until, 40) } : null,
  cursor: str(s?.cursor, 60), machine: str(s?.machine, 120), branch: str(s?.branch, 200), capacity: isObj(s?.capacity) ? { minutes: num(s.capacity.minutes, 0), areas: arr(s.capacity.areas).map((a) => str(a, 120)), model: str(s.capacity.model, 20) } : null,
  summary: str(s?.summary, 500),
});
export const normClaim = (c) => ({
  id: str(c?.id, 60), session: str(c?.session, 120), kind: CLAIM_KINDS.includes(c?.kind) ? c.kind : 'path', area: str(c?.area, 60),
  paths: arr(c?.paths).map((p) => str(p, 300)).filter(Boolean), reason: str(c?.reason, 300), build: str(c?.build, 120), step: str(c?.step, 40),
  since: str(c?.since, 40), expiresAt: str(c?.expiresAt, 40), heartbeatAt: str(c?.heartbeatAt, 40),
});
export const normOffer = (o) => ({
  id: str(o?.id, 60), build: str(o?.build, 120), steps: Array.isArray(o?.steps) ? o.steps.map((s) => str(s, 40)) : null,
  mode: OFFER_MODES.includes(o?.mode) ? o.mode : 'whole', childBuild: str(o?.childBuild, 120), to: str(o?.to, 120), from: str(o?.from, 120),
  reason: str(o?.reason, 500), at: str(o?.at, 40), expiresAt: str(o?.expiresAt, 40), status: OFFER_STATUSES.includes(o?.status) ? o.status : 'offered',
  response: isObj(o?.response) ? { by: str(o.response.by, 120), at: str(o.response.at, 40), response: str(o.response.response, 20), reason: str(o.response.reason, 500), backAt: str(o.response.backAt, 40) } : null,
  assignment: str(o?.assignment, 60),
});
export const normAssignment = (a) => ({
  id: str(a?.id, 60), build: str(a?.build, 120), steps: Array.isArray(a?.steps) ? a.steps.map((s) => str(s, 40)) : null,
  session: str(a?.session, 120), account: str(a?.account, 120), agent: str(a?.agent, 40), offer: str(a?.offer, 60),
  status: ASSIGNMENT_STATUSES.includes(a?.status) ? a.status : 'queued', order: num(a?.order, 0), since: str(a?.since, 40), updatedAt: str(a?.updatedAt, 40),
  claims: arr(a?.claims).map((c) => str(c, 60)), backAt: str(a?.backAt, 40), reason: str(a?.reason, 500),
  stepStates: isObj(a?.stepStates) ? Object.fromEntries(Object.entries(a.stepStates).map(([k, v]) => [str(k, 40), { state: STEP_STATES.includes(v?.state) ? v.state : 'started', at: str(v?.at, 40), reason: str(v?.reason, 300) }])) : {},
  parent: str(a?.parent, 120),
});
const normEvent = (e) => ({ seq: num(e?.seq, 0), at: str(e?.at, 40), type: EVENT_TYPES.includes(e?.type) ? e.type : 'link', id: str(e?.id, 120), session: str(e?.session, 120), data: isObj(e?.data) ? e.data : {} });
const normStats = (s) => ({ offers: num(s?.offers, 0), accepts: num(s?.accepts, 0), rejects: num(s?.rejects, 0), holds: num(s?.holds, 0), released: num(s?.released, 0), stepsDone: num(s?.stepsDone, 0), msPerStep: arr(s?.msPerStep).filter((n) => Number.isFinite(n)).slice(-50) });
const mapOf = (o, norm) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).map(([k, v]) => [k, norm({ ...v, id: v?.id || k })]).filter(([, v]) => v.id));

export function normLink(raw) {
  const l = emptyLink(raw?.project);
  l.rev = num(raw?.rev, 0); l.updatedAt = str(raw?.updatedAt, 40); l.seq = num(raw?.seq, 0);
  l.primary = isObj(raw?.primary) && str(raw.primary.session) ? { session: str(raw.primary.session, 120), account: str(raw.primary.account, 120), agent: str(raw.primary.agent, 40), since: str(raw.primary.since, 40) } : null;
  l.sessions = mapOf(raw?.sessions, normSession); l.claims = mapOf(raw?.claims, normClaim); l.offers = mapOf(raw?.offers, normOffer); l.assignments = mapOf(raw?.assignments, normAssignment);
  l.events = arr(raw?.events).map(normEvent).filter((e) => e.seq > 0);
  l.stats = Object.fromEntries(Object.entries(isObj(raw?.stats) ? raw.stats : {}).map(([k, v]) => [str(k, 120), normStats(v)]));
  l.settings = isObj(raw?.settings) ? Object.fromEntries(Object.entries(raw.settings).filter(([k]) => k in DEFAULT_SETTINGS)) : {};
  return l;
}

/** Problems with a link document (field, code, message); empty = valid. */
export function linkErrors(raw) {
  const out = []; const err = (field, code, message) => out.push({ field, code, message });
  if (!isObj(raw)) return [{ field: 'link', code: 'invalid', message: 'the link must be an object' }];
  if (raw.$axf !== FRAMES.link) err('$axf', 'invalid', `$axf must be ${FRAMES.link}`);
  if (!str(raw.project)) err('project', 'missing', 'project is missing');
  for (const [id, s] of Object.entries(isObj(raw.sessions) ? raw.sessions : {})) { if (!str(s?.account)) err(`sessions.${id}.account`, 'missing', 'a session names its account'); if (s?.client && !CLIENTS.includes(s.client)) err(`sessions.${id}.client`, 'invalid', `client must be one of ${CLIENTS.join(', ')}`); }
  for (const [id, c] of Object.entries(isObj(raw.claims) ? raw.claims : {})) { if (!str(c?.session)) err(`claims.${id}.session`, 'missing', 'a claim names its session'); if (c?.kind === 'area' ? !str(c?.area) : !arr(c?.paths).length) err(`claims.${id}`, 'missing', 'a claim names an area or paths'); }
  for (const [id, o] of Object.entries(isObj(raw.offers) ? raw.offers : {})) { if (!str(o?.build)) err(`offers.${id}.build`, 'missing', 'an offer names its build'); if (o?.mode && !OFFER_MODES.includes(o.mode)) err(`offers.${id}.mode`, 'invalid', `mode must be one of ${OFFER_MODES.join(', ')}`); }
  for (const [id, a] of Object.entries(isObj(raw.assignments) ? raw.assignments : {})) { if (!str(a?.build) || !str(a?.session)) err(`assignments.${id}`, 'missing', 'an assignment names its build and session'); if (a?.status && !ASSIGNMENT_STATUSES.includes(a.status)) err(`assignments.${id}.status`, 'invalid', `status must be one of ${ASSIGNMENT_STATUSES.join(', ')}`); }
  if (raw.primary !== undefined && raw.primary !== null && !str(raw.primary?.session)) err('primary', 'invalid', 'primary names a session or is null');
  return out;
}

/* ------------------------------------------------------------------ */
/* Events                                                               */
/* ------------------------------------------------------------------ */

/** Append one typed event, bump rev. Returns the event. */
export function pushEvent(link, type, data = {}, now = '', extra = {}) {
  const seq = (link.seq = num(link.seq, 0) + 1);
  const ev = { seq, at: now, type: EVENT_TYPES.includes(type) ? type : 'link', id: str(extra.id, 120), session: str(extra.session, 120), data };
  link.events.push(ev);
  const limit = settingsOf(link).eventLimit;
  if (link.events.length > limit) link.events = link.events.slice(-limit);
  link.rev = num(link.rev, 0) + 1; link.updatedAt = now;
  return ev;
}
/** Events after `after` (max `max`); `gap` when older ones were trimmed; `next` = what to ask for next time. */
export function eventsSince(link, after = 0, max = 200) {
  const evs = link.events; const oldest = evs[0]?.seq ?? (link.seq + 1);
  const gap = after > 0 && after + 1 < oldest;
  const out = evs.filter((e) => e.seq > after).slice(0, max);
  return { events: out, next: out.length ? out[out.length - 1].seq : Math.max(after, link.seq), gap, more: evs.filter((e) => e.seq > after).length > out.length };
}

/* ------------------------------------------------------------------ */
/* Roles and the gate                                                   */
/* ------------------------------------------------------------------ */

/** 'primary' | 'secondary' | 'none' for a session id or `{ id?, account? }`. Same account as the primary = primary. */
export function roleOf(link, who) {
  const id = typeof who === 'string' ? who : str(who?.id, 120); const s = link.sessions[id];
  const account = s?.account || (typeof who === 'object' ? str(who?.account, 120) : '');
  if (!link.primary) return s ? 'primary' : (account ? 'primary' : 'none');
  if (link.primary.session === id) return 'primary';
  if (account && link.primary.account && account === link.primary.account) return 'primary';
  if (!s && !account) return 'none';
  return 'secondary';
}
/** The gate: `{ ok }` or `{ ok: false, code: 'secondary' | 'unknown-action' | 'owner', message }`. `brett: true` = his own click. */
export function gate(role, action, { brett = false } = {}) {
  const row = ACTIONS[action];
  if (!row) return { ok: false, code: 'unknown-action', message: `unknown action "${action}"` };
  if (brett) return { ok: true };
  if (role === 'primary' && row.primary) return { ok: true };
  if (role === 'secondary' && row.secondary) return { ok: true };
  if (!row.primary && !row.secondary) return { ok: false, code: 'owner', message: `only Brett can do that: ${action}` };
  if (role === 'secondary') return { ok: false, code: 'secondary', message: `secondary sessions can't do that: ${action}` };
  if (role === 'primary') return { ok: false, code: 'primary', message: `the primary session doesn't ${action}; a helper does` };
  return { ok: false, code: 'no-session', message: `no session: join first (${action})` };
}

/* ------------------------------------------------------------------ */
/* Sessions                                                             */
/* ------------------------------------------------------------------ */

/** Derived status (spec § 3): working · idle · lunch · offline · ended · pending. */
export function sessionStatus(s, now, settings = DEFAULT_SETTINGS) {
  if (!s) return 'offline';
  if (s.endedAt) return 'ended';
  if (s.approved === false) return 'pending';
  if (s.pause && (!s.pause.until || ms(s.pause.until) > ms(now))) return 'lunch';
  const quiet = (ms(now) - ms(s.lastSeenAt)) / 1000;
  if (!s.lastSeenAt || quiet > settings.offlineSec) return 'offline';
  if (quiet > settings.lunchSec) return 'lunch';
  if (quiet <= settings.heartbeatSec * 2 && s.doing?.step) return 'working';
  return 'idle';
}
/** The helper widget's icon + tooltip (spec § 6). */
export function helperStatus(s, now, settings = DEFAULT_SETTINGS) {
  const st = sessionStatus(s, now, settings);
  if (st === 'offline' || st === 'ended' || st === 'pending') return { state: 'none', tooltip: s ? `${st === 'pending' ? 'waiting for approval' : 'not connected'}` : 'no helper connected' };
  if (st === 'working') return { state: 'working', tooltip: `${s.doing.build}${s.doing.step ? ` · ${s.doing.step}` : ''}${s.doing.note ? ` — ${s.doing.note}` : ''}` };
  if (st === 'lunch') { const why = s.pause?.reason || (s.pause ? 'paused' : 'quiet for a while'); const back = s.pause?.until ? `, back ${s.pause.until}` : ''; return { state: 'lunch', tooltip: `on lunch: ${why}${back}` }; }
  return { state: 'idle', tooltip: 'connected, idle' };
}

/** Join (create or refresh) a session. The first join with no primary becomes primary; a new account needs approval. */
export function join(link, who, now) {
  const id = str(who?.id, 120); if (!id) throw new Error('a session needs an id');
  const account = str(who?.account, 120); if (!account) throw new Error('a session names its account');
  const settings = settingsOf(link);
  const known = Object.values(link.sessions).some((s) => s.account === account && s.approved !== false) || (link.primary && link.primary.account === account);
  const prev = link.sessions[id];
  const s = normSession({ ...(prev ?? {}), ...who, id, account, startedAt: prev?.startedAt || now, lastSeenAt: now, endedAt: '', approved: prev ? prev.approved : (!link.primary || known || !settings.approveNewAccounts) });
  let becamePrimary = false;
  if (!link.primary) { link.primary = { session: id, account, agent: s.agent, since: now }; becamePrimary = true; }
  s.role = roleOf({ ...link, sessions: { ...link.sessions, [id]: s } }, id) === 'primary' ? 'primary' : 'secondary';
  link.sessions[id] = s;
  pushEvent(link, 'session', { action: 'join', role: s.role, agent: s.agent, account, approved: s.approved, becamePrimary }, now, { id, session: id });
  return { session: s, becamePrimary, needsApproval: s.approved === false };
}
/** Brett approves a pending account's session(s). */
export function approveAccount(link, account, now, by = 'brett') {
  const ids = Object.values(link.sessions).filter((s) => s.account === account && s.approved === false).map((s) => s.id);
  for (const id of ids) link.sessions[id].approved = true;
  if (ids.length) pushEvent(link, 'session', { action: 'approve-account', account, sessions: ids, by }, now, { id: account });
  return ids;
}
/** Heartbeat: last seen, what it's doing, renew its claims. */
export function heartbeat(link, id, doing, now, extra = {}) {
  const s = link.sessions[id]; if (!s) throw new Error(`unknown session ${id}`);
  const settings = settingsOf(link);
  s.lastSeenAt = now; if (s.endedAt) s.endedAt = '';
  if (isObj(doing)) s.doing = { build: str(doing.build, 120), step: str(doing.step, 40), note: str(doing.note, 300) };
  if (extra.branch) s.branch = str(extra.branch, 200);
  if (extra.pause !== undefined) s.pause = isObj(extra.pause) ? { reason: str(extra.pause.reason, 200), until: str(extra.pause.until, 40) } : null;
  for (const c of Object.values(link.claims)) if (c.session === id) { c.heartbeatAt = now; c.expiresAt = plus(now, settings.claimTtlSec); }
  link.rev++; link.updatedAt = now;
  return s;
}
/** End a session: release claims, give assignments back, hand primary on. */
export function endSession(link, id, now, summary = '') {
  const s = link.sessions[id]; if (!s) throw new Error(`unknown session ${id}`);
  const released = Object.values(link.claims).filter((c) => c.session === id).map((c) => c.id);
  for (const cid of released) delete link.claims[cid];
  const givenBack = [];
  for (const a of Object.values(link.assignments)) if (a.session === id && !['done', 'released', 'taken-back', 'rejected'].includes(a.status)) { a.status = 'released'; a.updatedAt = now; a.reason = 'session ended'; a.claims = []; givenBack.push(a.id); }
  s.endedAt = now; s.doing = { build: '', step: '', note: '' }; if (summary) s.summary = str(summary, 500);
  let primaryTo = '';
  if (link.primary?.session === id) {
    const next = Object.values(link.sessions).filter((x) => x.id !== id && !x.endedAt && x.account === link.primary.account && x.approved !== false).sort((a, b) => ms(a.startedAt) - ms(b.startedAt))[0];
    link.primary = next ? { session: next.id, account: next.account, agent: next.agent, since: now } : null; primaryTo = next?.id ?? '';
    if (next) next.role = 'primary';
  }
  pushEvent(link, 'session', { action: 'end', released, givenBack, primaryTo, summary: s.summary }, now, { id, session: id });
  return { released, givenBack, primaryTo };
}

/* ------------------------------------------------------------------ */
/* Claims                                                               */
/* ------------------------------------------------------------------ */

/** Literal prefix of a glob (up to the first `*` / `?` / `[`), trimmed to the last slash when the wildcard sits inside a segment. */
export function globPrefix(glob) {
  const g = str(glob, 300).replace(/^\.\//, ''); const i = g.search(/[*?[]/);
  if (i < 0) return g.replace(/\/+$/, '');
  const head = g.slice(0, i); const j = head.lastIndexOf('/');
  return j >= 0 ? head.slice(0, j) : '';
}
const reOf = (glob) => new RegExp('^' + str(glob, 300).replace(/^\.\//, '').replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?').replace(/\(\?:\.\*\/\)\?$/, '.*') + '$');
/** Does a path fall under a glob (`a/**` takes `a/b/c.ts`; `a/*.ts` takes `a/b.ts` only; a plain folder takes everything under it)? */
export function pathMatches(glob, path) {
  const p = str(path, 400).replace(/^\.\//, ''); const g = str(glob, 300).replace(/^\.\//, '').replace(/\/+$/, '');
  if (!g) return false;
  if (!/[*?[]/.test(g)) return p === g || p.startsWith(g + '/');
  return reOf(g).test(p);
}
/** Two globs overlap when one's literal prefix falls under the other (so `a/b/**` ~ `a/**`, `a/b/**` !~ `a/c/**`). */
export function globOverlap(a, b) {
  const pa = globPrefix(a), pb = globPrefix(b);
  if (pathMatches(a, pb) || pathMatches(b, pa)) return true;
  if (!/[*?[]/.test(a) && !/[*?[]/.test(b)) return pa === pb || pa.startsWith(pb + '/') || pb.startsWith(pa + '/');
  return pa === pb || pa.startsWith(pb + '/') || pb.startsWith(pa + '/');
}
export const claimPaths = (c, areas = AREAS) => (c.kind === 'area' ? arr(areas[c.area]) : arr(c.paths));
export function claimOverlap(a, b, areas = AREAS) {
  if (a.kind === 'area' && b.kind === 'area') return a.area === b.area || claimPaths(a, areas).some((x) => claimPaths(b, areas).some((y) => globOverlap(x, y)));
  return claimPaths(a, areas).some((x) => claimPaths(b, areas).some((y) => globOverlap(x, y)));
}
/** Drop expired claims and claims of ended sessions. Returns the ids dropped. */
export function expireClaims(link, now) {
  const gone = [];
  for (const c of Object.values(link.claims)) { const s = link.sessions[c.session]; if (!s || s.endedAt || (c.expiresAt && ms(c.expiresAt) <= ms(now))) { gone.push(c.id); delete link.claims[c.id]; } }
  return gone;
}
/** Take a claim: `{ ok, claim }` or `{ ok: false, code: 'claimed', by: { session, agent, account }, until, claim }`. */
export function claim(link, req, now, areas = AREAS) {
  const settings = settingsOf(link);
  expireClaims(link, now);
  const session = link.sessions[str(req?.session, 120)]; if (!session) return { ok: false, code: 'no-session', message: 'join first' };
  const c = normClaim({ ...req, id: req?.id || `c-${link.seq + 1}`, since: now, heartbeatAt: now, expiresAt: plus(now, num(req?.ttlSec, settings.claimTtlSec)) });
  if (!(c.kind === 'area' ? areas[c.area] : c.paths.length)) return { ok: false, code: 'invalid', message: c.kind === 'area' ? `unknown area "${c.area}" (${Object.keys(areas).join(', ')})` : 'a path claim needs paths' };
  const other = Object.values(link.claims).find((x) => x.session !== c.session && claimOverlap(x, c, areas));
  if (other) { const by = link.sessions[other.session]; return { ok: false, code: 'claimed', message: `claimed by ${by?.agent || other.session}`, by: { session: other.session, agent: by?.agent ?? '', account: by?.account ?? '' }, until: other.expiresAt, claim: other }; }
  const same = Object.values(link.claims).find((x) => x.session === c.session && x.kind === c.kind && (c.kind === 'area' ? x.area === c.area : x.paths.join() === c.paths.join()));
  if (same) { same.expiresAt = c.expiresAt; same.heartbeatAt = now; if (c.reason) same.reason = c.reason; if (c.build) same.build = c.build; if (c.step) same.step = c.step; link.rev++; link.updatedAt = now; return { ok: true, claim: same, renewed: true }; }
  link.claims[c.id] = c;
  pushEvent(link, 'claim', { action: 'claim', kind: c.kind, area: c.area, paths: c.paths, build: c.build, step: c.step, agent: session.agent }, now, { id: c.id, session: c.session });
  return { ok: true, claim: c };
}
/** Release one claim (by id) or every claim of a session. */
export function release(link, sessionId, claimId, now) {
  const ids = Object.values(link.claims).filter((c) => c.session === sessionId && (!claimId || c.id === claimId)).map((c) => c.id);
  for (const id of ids) delete link.claims[id];
  if (ids.length) pushEvent(link, 'claim', { action: 'release', claims: ids }, now, { session: sessionId });
  return ids;
}
/** The claim of `session` that covers `path`, or null. */
export function coveringClaim(link, sessionId, path, areas = AREAS) {
  return Object.values(link.claims).find((c) => c.session === sessionId && claimPaths(c, areas).some((g) => pathMatches(g, path))) ?? null;
}
/** Are these paths all inside the session's claims? `outside` = uncovered paths; `claimedBy` = who holds one of them. */
export function checkPaths(link, sessionId, paths, now, areas = AREAS) {
  expireClaims(link, now);
  const settings = settingsOf(link);
  const outside = []; const claimedBy = [];
  for (const p of arr(paths)) {
    if (coveringClaim(link, sessionId, p, areas)) continue;
    outside.push(p);
    const other = Object.values(link.claims).find((c) => c.session !== sessionId && claimPaths(c, areas).some((g) => pathMatches(g, p)));
    if (other) claimedBy.push({ path: p, session: other.session, agent: link.sessions[other.session]?.agent ?? '', claim: other.id });
  }
  return { ok: !settings.enforce || outside.length === 0, enforce: settings.enforce, outside, claimedBy };
}

/* ------------------------------------------------------------------ */
/* Offers, assignments, reactions                                       */
/* ------------------------------------------------------------------ */

const statsOf = (link, account) => (link.stats[account] ??= normStats({}));
const activeHelpers = (link, now) => Object.values(link.sessions).filter((s) => roleOf(link, s.id) === 'secondary' && s.approved !== false && !['offline', 'ended', 'pending'].includes(sessionStatus(s, now, settingsOf(link))));

/** The primary offers work: a whole build or steps as a new child build. `to` = a session or account, or '' for any helper. */
export function makeOffer(link, req, now) {
  const settings = settingsOf(link);
  const o = normOffer({ ...req, id: req?.id || `o-${link.seq + 1}`, at: now, status: 'offered', expiresAt: req?.expiresAt || plus(now, settings.offerTtlSec) });
  if (!o.build) throw new Error('an offer names its build');
  if (o.mode === 'steps-new-build' && !(o.steps && o.steps.length)) throw new Error('steps-new-build needs steps');
  if (o.mode === 'steps-new-build' && !o.childBuild) o.childBuild = `${o.build}-${slug(o.to || 'helper')}-${o.steps.map((s) => s.replace(/^s/, '')).join('-')}`.slice(0, 120);
  const dup = Object.values(link.offers).find((x) => x.status === 'offered' && x.build === o.build && (x.steps?.join() ?? '') === (o.steps?.join() ?? ''));
  if (dup) return { offer: dup, duplicate: true };
  link.offers[o.id] = o;
  if (o.to) { const acct = link.sessions[o.to]?.account || o.to; statsOf(link, acct).offers++; }
  pushEvent(link, 'offer', { action: 'offer', build: o.build, steps: o.steps, mode: o.mode, childBuild: o.childBuild, to: o.to, reason: o.reason }, now, { id: o.id, session: o.from });
  return { offer: o };
}
const offerFor = (link, o, s) => !o.to || o.to === s.id || o.to === s.account;
/** Offers a session may see (its own, or open to any helper), still open. */
export const openOffers = (link, sessionId) => { const s = link.sessions[sessionId]; return Object.values(link.offers).filter((o) => o.status === 'offered' && (!s || offerFor(link, o, s))); };

/** A helper answers an offer (accept / reject / hold) or an assignment (hold / release). Returns the orchestrator's reaction too. */
export function respond(link, req, now) {
  const s = link.sessions[str(req?.session, 120)]; if (!s) throw new Error('join first');
  const response = str(req?.response, 20); if (!RESPONSES.includes(response)) throw new Error(`response must be one of ${RESPONSES.join(', ')}`);
  const reason = str(req?.reason, 500); const backAt = str(req?.backAt, 40);
  if ((response === 'reject' || response === 'hold') && !reason) throw new Error(`${response} needs a reason`);
  const stats = statsOf(link, s.account);
  let a = req?.assignment ? link.assignments[str(req.assignment, 60)] : null;
  const o = req?.offer ? link.offers[str(req.offer, 60)] : (a ? link.offers[a.offer] : null);
  if (!a && !o) throw new Error('name an offer or an assignment');
  if (a && a.session !== s.id) throw new Error('not your assignment');
  if (o && !a && (o.status !== 'offered' || !offerFor(link, o, s))) throw new Error(`offer ${o.id} is ${o.status === 'offered' ? 'not for you' : o.status}`);
  if (o && !a) o.response = { by: s.id, at: now, response, reason, backAt };
  if (response === 'accept') {
    if (a) throw new Error('already accepted');
    o.status = 'accepted'; stats.accepts++;
    const order = Object.values(link.assignments).filter((x) => x.session === s.id && ['queued', 'working'].includes(x.status)).length + 1;
    a = normAssignment({ id: `a-${link.seq + 1}`, build: o.mode === 'steps-new-build' ? o.childBuild : o.build, steps: o.steps, session: s.id, account: s.account, agent: s.agent, offer: o.id, status: 'queued', order, since: now, updatedAt: now, parent: o.mode === 'steps-new-build' ? o.build : '' });
    link.assignments[a.id] = a; o.assignment = a.id;
    pushEvent(link, 'handover', { action: 'accept', offer: o.id, assignment: a.id, build: a.build, steps: a.steps, agent: s.agent, parent: a.parent }, now, { id: a.id, session: s.id });
    return { assignment: a, offer: o, reaction: { decision: 'replan', why: `${s.agent || s.id} took ${a.build}${a.steps ? ` (${a.steps.join(', ')})` : ''}: re-planning around its claims` } };
  }
  if (response === 'reject') { if (a) { a.status = 'rejected'; a.reason = reason; a.updatedAt = now; } else o.status = 'rejected'; stats.rejects++; }
  if (response === 'hold') { if (a) { a.status = 'held'; a.reason = reason; a.backAt = backAt; a.updatedAt = now; } else { o.status = 'held'; } stats.holds++; }
  if (response === 'release') { if (!a) throw new Error('release needs an assignment'); a.status = 'released'; a.reason = reason; a.updatedAt = now; stats.released++; }
  const reaction = react(link, { response, assignment: a, offer: o, backAt, reason }, now);
  pushEvent(link, 'handover', { action: response, offer: o?.id ?? '', assignment: a?.id ?? '', build: a?.build || o?.build, reason, backAt, agent: s.agent, reaction }, now, { id: a?.id || o?.id, session: s.id });
  if (a) applyReaction(link, a, reaction, now);
  return { assignment: a, offer: o, reaction };
}
/** The orchestrator's decision for a helper's status change (spec § 6), with one line of why. */
export function react(link, change, now) {
  const r = str(change?.response || change?.state, 20); const a = change?.assignment; const name = a?.agent || change?.offer?.to || 'the helper';
  if (r === 'reject') return { decision: 'take-back', why: `${name} rejected it (${str(change?.reason, 200) || 'no reason'}): back to the primary's queue` };
  if (r === 'hold') { const back = str(change?.backAt, 40) || plus(now, 3600); return { decision: 'wait', why: `${name} put it on hold (${str(change?.reason, 200) || 'no reason'}): waiting until ${back}`, until: back }; }
  if (r === 'release') { const next = a ? activeHelpers(link, now).find((s) => s.id !== a.session) : null; return next ? { decision: 're-offer', why: `${name} released it: offering it to ${next.agent || next.id}`, to: next.id } : { decision: 'take-back', why: `${name} released it and no other helper is on: back to the primary's queue` }; }
  if (r === 'blocked') return { decision: 'take-back', why: `${name} is blocked on ${str(change?.step, 40) || 'a step'} (${str(change?.reason, 200) || 'no reason'}): taking that step back`, step: str(change?.step, 40) };
  if (r === 'done') return { decision: 'replan', why: `${name} finished ${str(change?.step, 40) || 'a step'}: re-planning what's left` };
  if (r === 'accept') return { decision: 'replan', why: `${name} took it: re-planning around its claims` };
  return { decision: 'none', why: '' };
}
/** Apply a reaction to an assignment: claims move back on take-back, a re-offer makes a new offer. */
export function applyReaction(link, a, reaction, now) {
  if (!a || !reaction) return null;
  if (reaction.decision === 'take-back') {
    if (reaction.step && a.steps && a.steps.length > 1) { a.steps = a.steps.filter((s) => s !== reaction.step); a.stepStates[reaction.step] = { state: 'blocked', at: now, reason: str(reaction.why, 300) }; }
    else { if (!['rejected', 'released'].includes(a.status)) a.status = 'taken-back'; a.updatedAt = now; }
    for (const cid of a.claims) delete link.claims[cid]; a.claims = [];
    return { takenBack: a.id };
  }
  if (reaction.decision === 're-offer' && reaction.to) {
    for (const cid of a.claims) delete link.claims[cid]; a.claims = [];
    const { offer } = makeOffer(link, { build: a.parent || a.build, steps: a.steps, mode: a.parent ? 'steps-new-build' : 'whole', childBuild: a.parent ? a.build : '', to: reaction.to, from: link.primary?.session ?? '', reason: reaction.why }, now);
    return { reOffered: offer.id };
  }
  if (reaction.decision === 'wait') { a.backAt = reaction.until || a.backAt; return { waitUntil: a.backAt }; }
  return null;
}
/** A helper marks one of its assigned steps started / done / blocked. */
export function stepState(link, req, now) {
  const s = link.sessions[str(req?.session, 120)]; if (!s) throw new Error('join first');
  const a = link.assignments[str(req?.assignment, 60)]; if (!a) throw new Error('unknown assignment');
  if (a.session !== s.id) throw new Error('not your assignment');
  const step = str(req?.step, 40); if (a.steps && !a.steps.includes(step)) throw new Error(`${step} is not on this assignment`);
  const state = str(req?.state, 20); if (!STEP_STATES.includes(state)) throw new Error(`state must be one of ${STEP_STATES.join(', ')}`);
  const prev = a.stepStates[step];
  a.stepStates[step] = { state, at: now, reason: str(req?.reason, 300) }; a.updatedAt = now;
  if (state === 'started' && a.status === 'queued') a.status = 'working';
  if (state === 'done') { const st = statsOf(link, s.account); st.stepsDone++; if (prev?.state === 'started' && prev.at) st.msPerStep.push(ms(now) - ms(prev.at)); if (a.steps && a.steps.every((x) => a.stepStates[x]?.state === 'done')) a.status = 'done'; }
  // blocked on one step of several: that step goes back, the rest stays; blocked on the only (or a whole-build) step: the assignment is blocked
  if (state === 'blocked' && !(a.steps && a.steps.length > 1)) a.status = 'blocked';
  const reaction = react(link, { state, assignment: a, step, reason: req?.reason }, now);
  pushEvent(link, 'assignment', { action: 'step', step, state, reason: str(req?.reason, 300), build: a.build, agent: s.agent, reaction, status: a.status }, now, { id: a.id, session: s.id });
  if (state === 'blocked') applyReaction(link, a, reaction, now);
  return { assignment: a, reaction };
}
/** The primary takes work back: queued any time; working only with `confirm`. */
export function takeBack(link, req, now) {
  const a = link.assignments[str(req?.assignment, 60)] ?? Object.values(link.assignments).find((x) => x.build === str(req?.build, 120) && ['queued', 'working', 'held', 'blocked'].includes(x.status));
  if (!a) return { ok: false, code: 'not-found', message: 'nothing assigned to take back' };
  if (a.status === 'working' && !req?.confirm) return { ok: false, code: 'confirm', message: `${a.agent || a.session} is working on ${a.build}: confirm to take it back (its WIP stays on its branch)` };
  const steps = Array.isArray(req?.steps) && a.steps ? req.steps.map((s) => str(s, 40)).filter((s) => a.steps.includes(s)) : null;
  if (steps && steps.length && steps.length < a.steps.length) { a.steps = a.steps.filter((s) => !steps.includes(s)); a.updatedAt = now; }
  else { a.status = 'taken-back'; a.updatedAt = now; a.reason = str(req?.reason, 300) || 'taken back by the primary'; for (const cid of a.claims) delete link.claims[cid]; a.claims = []; }
  pushEvent(link, 'handover', { action: 'take-back', assignment: a.id, build: a.build, steps: steps && steps.length ? steps : a.steps, agent: a.agent, reason: a.reason, wasWorking: req?.confirm === true }, now, { id: a.id, session: a.session });
  return { ok: true, assignment: a, steps: steps && steps.length ? steps : null };
}
/** Undo the last handover event that can be undone (take-back ↔ re-assign; accept ↔ un-accept). Returns what was undone. */
export function undoHandover(link, seq, now) {
  const ev = link.events.find((e) => e.seq === seq && e.type === 'handover'); if (!ev) return { ok: false, message: 'no handover event with that seq' };
  const a = link.assignments[ev.data.assignment]; if (!a) return { ok: false, message: 'its assignment is gone' };
  if (ev.data.action === 'take-back') { a.status = ev.data.wasWorking ? 'working' : 'queued'; if (Array.isArray(ev.data.steps) && a.steps) a.steps = [...new Set([...a.steps, ...ev.data.steps])]; a.updatedAt = now; }
  else if (ev.data.action === 'accept') { a.status = 'taken-back'; a.updatedAt = now; const o = link.offers[a.offer]; if (o) o.status = 'offered'; }
  else return { ok: false, message: `can't undo a ${ev.data.action}` };
  pushEvent(link, 'handover', { action: 'undo', of: seq, assignment: a.id, status: a.status }, now, { id: a.id });
  return { ok: true, assignment: a };
}

/* ------------------------------------------------------------------ */
/* Builds: scoping, badges, what to offer, replan, dedupe               */
/* ------------------------------------------------------------------ */

const live = (a) => ['queued', 'working', 'held', 'blocked'].includes(a.status);
/** Assignments that still hold a build (or one of its steps). */
export const assignmentsOf = (link, buildId) => Object.values(link.assignments).filter((a) => live(a) && (a.build === buildId || a.parent === buildId));
/** The badge for a build or a step (spec addendum 16): null when nobody else has it. */
export function assignedBadge(link, buildId, stepId = '', now = '', settings = DEFAULT_SETTINGS, build = null) {
  const as = assignmentsOf(link, buildId).filter((a) => !stepId || !a.steps || a.steps.includes(stepId) || a.build === buildId && !a.steps);
  const a = as.find((x) => x.status === 'working') ?? as[0]; if (!a) return null;
  const s = link.sessions[a.session]; const st = s && now ? sessionStatus(s, now, settings) : '';
  const stepIds = a.steps ?? arr(build?.steps).filter((x) => !x.skip).map((x) => x.id);
  const total = stepIds.length; const done = stepIds.filter((x) => a.stepStates[x]?.state === 'done' || (!a.steps && arr(build?.steps).find((y) => y.id === x)?.done)).length;
  const idx = Object.values(link.assignments).filter((x) => x.session === a.session && live(x)).sort((x, y) => x.order - y.order).findIndex((x) => x.id === a.id) + 1;
  const name = `${a.agent || a.session} (helper)`;
  if (a.status === 'working') return { kind: 'working', animated: st === 'working', agent: a.agent, session: a.session, account: a.account, text: `${name}${total ? ` · step ${Math.min(done + 1, total)}/${total}` : ''}`, since: a.since, updatedAt: a.updatedAt, assignment: a.id, status: a.status };
  if (a.status === 'queued') return { kind: 'queued', animated: false, agent: a.agent, session: a.session, account: a.account, text: `In ${a.agent || a.session}'s queue (#${idx})`, since: a.since, updatedAt: a.updatedAt, assignment: a.id, status: a.status };
  return { kind: a.status, animated: false, agent: a.agent, session: a.session, account: a.account, text: `${a.status === 'held' ? 'On hold at' : a.status === 'blocked' ? 'Blocked at' : 'Rejected by'} ${a.agent || a.session}${a.reason ? `: ${a.reason}` : ''}`, since: a.since, updatedAt: a.updatedAt, assignment: a.id, status: a.status };
}
/** What a secondary sees: builds assigned to it (whole or some steps) and builds with an open offer to it. */
export function scopedBuilds(builds, link, sessionId) {
  const s = link.sessions[sessionId]; if (!s) return [];
  const mine = new Map();
  for (const a of Object.values(link.assignments)) if (a.session === sessionId && live(a)) mine.set(a.build, a);
  const offered = new Set(openOffers(link, sessionId).map((o) => (o.mode === 'steps-new-build' ? o.childBuild : o.build)));
  const out = [];
  for (const b of arr(builds)) {
    const a = mine.get(b.id); const o = openOffers(link, sessionId).find((x) => x.build === b.id || x.childBuild === b.id);
    if (!a && !o) continue;
    const steps = arr(b.steps).filter((st) => (a ? !a.steps || a.steps.includes(st.id) : !o.steps || o.steps.includes(st.id)));
    out.push({ ...b, steps, assignedTo: a ? { assignment: a.id, session: a.session, agent: a.agent, status: a.status } : null, offer: o ? { id: o.id, mode: o.mode, status: o.status } : null, managedBy: 'orchestrator' });
  }
  for (const id of offered) if (!out.some((b) => b.id === id) && !arr(builds).some((b) => b.id === id)) out.push({ id, title: id, steps: [], assignedTo: null, offer: openOffers(link, sessionId).find((o) => o.childBuild === id || o.build === id) ?? null, managedBy: 'orchestrator', pending: true });
  for (const [id, a] of mine) if (!out.some((b) => b.id === id)) out.push({ id, title: a.parent ? `${a.parent}: ${(a.steps ?? []).join(', ')}` : id, parent: a.parent, steps: (a.steps ?? []).map((sid) => ({ id: sid, text: sid, done: a.stepStates[sid]?.state === 'done' })), assignedTo: { assignment: a.id, session: a.session, agent: a.agent, status: a.status }, offer: null, managedBy: 'orchestrator', pending: true });
  return out;
}
/** `assignedTo` / `withHelper` patches for the builds store, from the link (the link wins). */
export function assignmentPatches(builds, link) {
  const patches = [];
  for (const b of arr(builds)) {
    const as = assignmentsOf(link, b.id);
    const whole = as.find((a) => a.build === b.id && !a.steps);
    const assignedTo = whole ? { assignment: whole.id, session: whole.session, account: whole.account, agent: whole.agent, status: whole.status, since: whole.since } : null;
    const steps = {};
    for (const st of arr(b.steps)) {
      const a = as.find((x) => (x.build === b.id && x.steps?.includes(st.id)) || (x.parent === b.id && x.steps?.includes(st.id)));
      steps[st.id] = a ? { assignment: a.id, session: a.session, agent: a.agent, status: a.stepStates[st.id]?.state || a.status, withHelper: a.parent === b.id ? a.build : '' } : null;
    }
    const before = JSON.stringify({ a: b.assignedTo ?? null, s: Object.fromEntries(arr(b.steps).map((st) => [st.id, st.assignedTo ?? null])) });
    const after = JSON.stringify({ a: assignedTo, s: steps });
    if (before !== after) patches.push({ id: b.id, assignedTo, steps });
  }
  return patches;
}
const stepTouches = (st) => arr(st?.files).map((f) => str(f, 300)).filter(Boolean);
const buildTouches = (b) => [...new Set([...arr(b?.touches).map((t) => str(t, 300)), ...arr(b?.steps).flatMap(stepTouches)])].filter(Boolean);
const touchesOverlap = (ta, tb, areas = AREAS) => ta.some((x) => tb.some((y) => globOverlap(areas[x]?.[0] ?? x, areas[y]?.[0] ?? y)));
const isRunning = (b) => ['running', 'testing', 'review'].includes(b?.status);
const isQueued = (b) => ['pending', 'queued', 'paused', 'blocked'].includes(b?.status);
const modelOk = (want, has) => !want || !has || want.toLowerCase() === String(has).toLowerCase();
const minutesOf = (est) => { const m = /(\d+(?:\.\d+)?)\s*(h|hr|hour|min|m)/i.exec(str(est, 40)); return m ? Math.round(Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1)) : 0; };

/** What to offer a helper that asked (spec § 6): queued builds first, then steps split out of running builds. */
export function pickOffers(builds, link, request = {}, now = '', areas = AREAS) {
  const want = { minutes: num(request?.minutes, 0), areas: arr(request?.areas).map((a) => str(a, 120)), model: str(request?.model, 20), max: num(request?.max, 3), session: str(request?.session, 120) };
  const held = Object.values(link.claims).filter((c) => c.session !== want.session).map((c) => claimPaths(c, areas)).flat();
  const taken = new Set(Object.values(link.assignments).filter(live).map((a) => a.build));
  const finished = new Set(arr(builds).filter((b) => ['complete', 'built', 'archived'].includes(b.status) || (arr(b.steps).length && arr(b.steps).every((s) => s.done || s.skip))).map((b) => b.id));
  const out = []; let left = want.minutes || Infinity;
  const fits = (touches, mins, model) => (!want.areas.length || !touches.length || touchesOverlap(touches, want.areas, areas)) && modelOk(want.model, model) && (mins === 0 || mins <= left + 5) && !touches.some((t) => held.some((h) => globOverlap(areas[t]?.[0] ?? t, h)));
  const queued = arr(builds).filter((b) => isQueued(b) && !b.hidden && !taken.has(b.id) && !Object.values(link.offers).some((o) => o.status === 'offered' && o.build === b.id)).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  for (const b of queued) {
    if (out.length >= want.max) break;
    if (arr(b.after).some((d) => !finished.has(str(d, 120)))) continue; // waits on another build: not offerable alone
    const open = arr(b.steps).filter((s) => !s.done && !s.skip); const mins = open.reduce((n, s) => n + minutesOf(s.estimate), 0);
    const models = [...new Set(open.map((s) => s.model))]; const model = models.length === 1 ? models[0] : '';
    if (!fits(buildTouches(b), mins, model)) continue;
    out.push({ build: b.id, steps: null, mode: 'whole', minutes: mins, touches: buildTouches(b), why: `queued since ${b.createdAt || '?'}, ${open.length} step(s), ${mins || '?'} min, touches nothing the primary holds` });
    left -= mins;
  }
  for (const b of arr(builds).filter((x) => isRunning(x) && !x.hidden)) {
    if (out.length >= want.max) break;
    const steps = arr(b.steps); const doneIds = new Set(steps.filter((s) => s.done).map((s) => s.id));
    const running = new Set(Object.values(link.sessions).filter((s) => s.doing.build === b.id).map((s) => s.doing.step));
    const assigned = new Set(assignmentsOf(link, b.id).flatMap((a) => a.steps ?? []));
    const free = steps.filter((s) => !s.done && !s.skip && !running.has(s.id) && !assigned.has(s.id) && arr(s.after).every((d) => doneIds.has(d)) && fits(stepTouches(s), minutesOf(s.estimate), s.model));
    if (!free.length) continue;
    const pick = []; let mins = 0;
    for (const s of free) { const m = minutesOf(s.estimate); if (mins + m > left + 5) break; pick.push(s.id); mins += m; if (pick.length >= 3) break; }
    if (!pick.length) continue;
    out.push({ build: b.id, steps: pick, mode: 'steps-new-build', minutes: mins, touches: [...new Set(steps.filter((s) => pick.includes(s.id)).flatMap(stepTouches))], why: `${b.id} is in progress; ${pick.join(', ')} don't depend on an undone step the primary keeps and touch nothing it holds` });
    left -= mins;
  }
  return out;
}
/** Replan the whole picture (spec § 6). Never moves a running step; pinned builds keep their place. */
export function replan(builds, link, opts = {}, now = '', areas = AREAS) {
  const settings = settingsOf(link);
  const list = arr(builds).filter((b) => !b.hidden && (isRunning(b) || isQueued(b)));
  const profile = str(opts?.profile, 40);
  const orderOf = (b) => num(b.order?.[profile], num(b.order, Infinity));
  const before = [...list].sort((a, b) => orderOf(a) - orderOf(b) || ms(a.createdAt) - ms(b.createdAt)).map((b) => b.id);
  const byId = new Map(list.map((b) => [b.id, b]));
  const helperClaims = Object.values(link.claims).filter((c) => roleOf(link, c.session) === 'secondary').flatMap((c) => claimPaths(c, areas));
  const moves = []; const reasons = new Map();
  const undone = (id) => { const b = byId.get(id); return b && arr(b.steps).some((s) => !s.done && !s.skip); };
  const deps = (b) => [...new Set([...arr(b.after).map((d) => str(d, 120)), ...arr(b.steps).flatMap((s) => arr(s.after).map((d) => str(d, 120).split('.')[0]).filter((d) => d !== b.id))])].filter((d) => byId.has(d) && undone(d));
  const running = (b) => isRunning(b) || arr(b.steps).some((s) => Object.values(link.sessions).some((x) => x.doing.build === b.id && x.doing.step === s.id));
  // running builds first, in their current order, and never moved after that
  const placed = before.filter((id) => running(byId.get(id)));
  let remaining = before.filter((id) => !placed.includes(id)); let guard = 0; let stuck = 0;
  while (remaining.length && guard++ < 10000) {
    const id = remaining[0]; const b = byId.get(id);
    let why = '';
    if (b.pinned !== true) {
      const dep = deps(b).find((d) => remaining.includes(d) && d !== id);
      if (dep) why = `${dep} must finish first (${id} depends on it)`;
      const touches = buildTouches(b);
      const conflict = !why && placed.find((p) => { const pb = byId.get(p); return (running(pb) || assignmentsOf(link, p).length) && touchesOverlap(touches, buildTouches(pb), areas); });
      if (!why && conflict) why = `${conflict} holds the same files (${id} waits)`;
      if (!why && touches.length && touches.some((t) => helperClaims.some((h) => globOverlap(areas[t]?.[0] ?? t, h)))) why = `a helper holds files ${id} touches`;
    }
    if (why) reasons.set(id, why);
    if (why && remaining.length > 1 && stuck < remaining.length) { remaining.shift(); remaining.push(id); stuck++; continue; }
    placed.push(id); remaining.shift(); stuck = 0;
  }
  for (const id of placed) { const from = before.indexOf(id), to = placed.indexOf(id); if (from !== to && reasons.has(id)) moves.push({ id, from, to, why: reasons.get(id) }); }
  const helperOrder = {};
  for (const a of Object.values(link.assignments).filter(live)) (helperOrder[a.session] ??= []).push(a);
  for (const k of Object.keys(helperOrder)) helperOrder[k] = helperOrder[k].sort((x, y) => (x.status === 'working' ? -1 : y.status === 'working' ? 1 : 0) || x.order - y.order).map((a) => a.id);
  const caps = slotSplit(num(opts?.maxAgents, 6), Object.values(link.sessions).filter((s) => !s.endedAt && s.approved !== false), settings.slotSplit);
  const ev = opts?.dryRun ? null : pushEvent(link, 'replan', { moves, order: placed, helperOrder, caps }, now);
  return { order: placed, before, moves, helperOrder, caps, dryRun: opts?.dryRun === true, seq: ev?.seq ?? 0, summary: moves.map((m) => `moved ${m.id} ${m.to < m.from ? 'up' : 'down'} because ${m.why}`) };
}
const normTitle = (t) => str(t, 300).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => new Set(normTitle(s).split(' ').filter((w) => w.length > 2));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n); };
/** The dedupe match (spec § 4.5): same id, same normalized title, or step / brief similarity ≥ 0.6. */
export function matchJob(job, builds) {
  const id = slug(job?.id || job?.title); const title = normTitle(job?.title);
  for (const b of arr(builds)) if (b.id === id && id) return { match: b, score: 1, how: 'id' };
  for (const b of arr(builds)) if (title && normTitle(b.title) === title) return { match: b, score: 1, how: 'title' };
  const mine = words([job?.title, job?.detail, ...arr(job?.steps).map((s) => s?.text ?? s)].join(' '));
  let best = null;
  for (const b of arr(builds)) { if (['complete', 'archived'].includes(b.status)) continue; const score = jaccard(mine, words([b.title, b.detail, ...arr(b.steps).map((s) => s.text)].join(' '))); if (score >= 0.6 && (!best || score > best.score)) best = { match: b, score: Math.round(score * 100) / 100, how: 'similar' }; }
  return best ?? { match: null, score: 0, how: 'none' };
}
/** Fair share of the agent cap per session (`split` = { session|account: fraction }); the primary never gets less than one. */
export function slotSplit(maxAgents, sessions, split = {}) {
  const list = arr(sessions).filter((s) => s && !s.endedAt); if (!list.length) return {};
  const out = {}; let used = 0;
  const fixed = list.filter((s) => Number.isFinite(split[s.id]) || Number.isFinite(split[s.account]));
  for (const s of fixed) { out[s.id] = Math.max(1, Math.round(maxAgents * (split[s.id] ?? split[s.account]))); used += out[s.id]; }
  const rest = list.filter((s) => !(s.id in out)); const share = rest.length ? Math.max(1, Math.floor(Math.max(0, maxAgents - used) / rest.length)) : 0;
  for (const s of rest) out[s.id] = share;
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (total > maxAgents) { const prim = list.find((s) => s.role === 'primary') ?? list[0]; for (const s of list) if (s.id !== prim.id && total > maxAgents && out[s.id] > 1) out[s.id]--; }
  return out;
}

/* ------------------------------------------------------------------ */
/* The sync file (handoff@1)                                            */
/* ------------------------------------------------------------------ */

const REDACT = REDACT_RULES.map((r) => ({ id: r.id, re: new RegExp(r.pattern, (r.flags || '') + 'g'), groups: /\(/.test(r.pattern.replace(/\(\?/g, '')) }));
/** Secrets out of any text (session@1's redact rules; a rule with a prefix group keeps the prefix). */
export function redactText(text) {
  let t = String(text ?? '');
  for (const r of REDACT) t = t.replace(r.re, (m, g1, g2) => (r.groups && typeof g1 === 'string' ? `${g1}[redacted ${r.id}]${typeof g2 === 'string' ? g2 : ''}` : `[redacted ${r.id}]`));
  return t;
}
export const hasSecret = (text) => REDACT.some((r) => new RegExp(r.re.source, r.re.flags.replace('g', '')).test(String(text ?? '')));

/** Build the sync document from the link and what the writer knows. */
export function makeSync(link, input = {}, writer = {}, now = '') {
  const settings = settingsOf(link);
  const sessions = Object.values(link.sessions).filter((s) => !s.endedAt).map((s) => ({ id: s.id, account: s.account, agent: s.agent, client: s.client, role: roleOf(link, s.id), status: sessionStatus(s, now, settings), doing: s.doing, lastSeenAt: s.lastSeenAt, branch: s.branch }));
  const claims = Object.values(link.claims).map((c) => ({ id: c.id, session: c.session, kind: c.kind, area: c.area, paths: c.paths, build: c.build, step: c.step, expiresAt: c.expiresAt }));
  const builds = arr(input.builds);
  const slim = (b) => ({ id: b.id, title: str(b.title, 300), status: b.status, estimate: str(b.estimate, 40), touches: buildTouches(b), steps: arr(b.steps).map((s) => ({ id: s.id, text: str(s.text, 300), model: s.model, done: s.done === true, estimate: str(s.estimate, 40) })), assignedTo: assignedBadge(link, b.id, '', now, settings), branch: str(b.branch, 200), pr: str(b.pr, 40) });
  const doc = {
    $axf: FRAMES.sync, project: link.project, writtenAt: now, writtenBy: { session: str(writer.session, 120), account: str(writer.account, 120), agent: str(writer.agent, 40), client: str(writer.client, 20) },
    freshForSec: settings.freshForSec, link: { console: str(input.console, 300), channel: CHANNEL, join: 'session-sync_join' },
    primary: link.primary ? { ...link.primary } : null, sessions, claims,
    work: { running: builds.filter(isRunning).map(slim), queued: builds.filter(isQueued).map(slim), offers: Object.values(link.offers).filter((o) => o.status === 'offered').map((o) => ({ id: o.id, build: o.build, steps: o.steps, mode: o.mode, to: o.to, status: o.status, reason: o.reason })), assigned: Object.values(link.assignments).filter(live).map((a) => ({ id: a.id, build: a.build, steps: a.steps, session: a.session, agent: a.agent, status: a.status })) },
    prs: arr(input.prs).map((p) => ({ number: num(p.number, 0), title: str(p.title, 300), branch: str(p.branch, 200), state: str(p.state, 20), ci: str(p.ci, 20) })),
    attention: arr(input.attention).map((a) => ({ kind: str(a.kind, 40), ref: str(a.ref, 200), text: str(a.text, 500) })),
    decisions: arr(input.decisions).map((d) => ({ at: str(d.at, 40), text: str(d.text, 500) })),
    rules: arr(input.rules).map((r) => str(r, 200)), next: arr(input.next).map((n) => str(n, 500)),
  };
  return JSON.parse(redactText(JSON.stringify(doc)));
}
export const isFresh = (doc, now) => !!doc?.writtenAt && (ms(now) - ms(doc.writtenAt)) / 1000 <= num(doc.freshForSec, DEFAULT_SETTINGS.freshForSec);
/** The `.md` rendering: JSON block first (so parseSync reads it back), then what a human reads on the phone. */
export function renderSync(doc) {
  const L = []; const p = (s = '') => L.push(s);
  p(`# Session sync — ${doc.project}`); p();
  p(`Written ${doc.writtenAt} by ${doc.writtenBy?.agent || doc.writtenBy?.session || '?'} (${doc.writtenBy?.account || '?'}, ${doc.writtenBy?.client || '?'}). Fresh for ${Math.round(num(doc.freshForSec, 1800) / 60)} min.`);
  p(`Join: \`/sync ${doc.project}\` in Claude Code, \`axf session-sync join --project ${doc.project}\`, MCP \`${doc.link?.join || 'session-sync_join'}\`, or say "sync ${doc.project}". Talk in the Breakroom's **${doc.link?.channel || CHANNEL}** channel.`); p();
  p('```json'); p(JSON.stringify(doc, null, 1)); p('```'); p();
  p('## Who is on'); p();
  if (!doc.sessions?.length) p('Nobody yet.');
  for (const s of doc.sessions ?? []) p(`- **${s.agent || s.id}** (${s.role}, ${s.account}, ${s.client}) — ${s.status}${s.doing?.build ? `: ${s.doing.build}${s.doing.step ? ` ${s.doing.step}` : ''}${s.doing.note ? ` — ${s.doing.note}` : ''}` : ''}${s.branch ? ` · branch \`${s.branch}\`` : ''}`);
  p(); p('## Claims'); p();
  if (!doc.claims?.length) p('None.');
  for (const c of doc.claims ?? []) p(`- ${c.session}: ${c.kind === 'area' ? `area **${c.area}**` : c.paths.map((x) => `\`${x}\``).join(', ')}${c.build ? ` (${c.build}${c.step ? ` ${c.step}` : ''})` : ''} until ${c.expiresAt}`);
  const w = doc.work ?? {};
  const bl = (b) => `- **${b.id}** ${b.title}${b.assignedTo ? ` · ${b.assignedTo.text}` : ''}${b.branch ? ` · \`${b.branch}\`` : ''}${b.pr ? ` · ${b.pr}` : ''}: ${b.steps.filter((s) => s.done).length}/${b.steps.length} steps${b.steps.filter((s) => !s.done).length ? `; next ${b.steps.find((s) => !s.done)?.id} ${b.steps.find((s) => !s.done)?.text}` : ''}`;
  p(); p('## Running'); p(); if (!w.running?.length) p('Nothing running.'); for (const b of w.running ?? []) p(bl(b));
  p(); p('## Queued'); p(); if (!w.queued?.length) p('Queue empty.'); for (const b of w.queued ?? []) p(bl(b));
  p(); p('## Offers and assigned work'); p();
  if (!w.offers?.length && !w.assigned?.length) p('None.');
  for (const o of w.offers ?? []) p(`- offer ${o.id}: ${o.build}${o.steps ? ` (${o.steps.join(', ')})` : ''} → ${o.to || 'any helper'} (${o.status})${o.reason ? ` — ${o.reason}` : ''}`);
  for (const a of w.assigned ?? []) p(`- ${a.agent || a.session} has ${a.build}${a.steps ? ` (${a.steps.join(', ')})` : ''}: ${a.status}`);
  p(); p('## Pull requests'); p(); if (!doc.prs?.length) p('None open.'); for (const pr of doc.prs ?? []) p(`- #${pr.number} ${pr.title} (\`${pr.branch}\`, ${pr.state}${pr.ci ? `, CI ${pr.ci}` : ''})`);
  p(); p('## Needs attention'); p(); if (!doc.attention?.length) p('Nothing.'); for (const a of doc.attention ?? []) p(`- ${a.kind}${a.ref ? ` ${a.ref}` : ''}: ${a.text}`);
  if (doc.decisions?.length) { p(); p('## Recent decisions'); p(); for (const d of doc.decisions) p(`- ${d.at ? `${d.at}: ` : ''}${d.text}`); }
  p(); p('## Rules to read first'); p(); for (const r of doc.rules ?? []) p(`- \`${r}\``);
  p(); p('## Next'); p(); if (!doc.next?.length) p('Ask in the channel.'); for (const n of doc.next ?? []) p(`- ${n}`);
  p();
  return L.join('\n');
}
/** Read the document back out of the `.md` (its JSON block). Null when there is none. */
export function parseSync(md) {
  const m = /```json\n([\s\S]*?)\n```/.exec(String(md ?? '')); if (!m) return null;
  try { const d = JSON.parse(m[1]); return d?.$axf === FRAMES.sync ? d : null; } catch { return null; }
}
/** Problems with a sync document. */
export function syncErrors(doc) {
  const out = []; const err = (field, code, message) => out.push({ field, code, message });
  if (!isObj(doc)) return [{ field: 'sync', code: 'invalid', message: 'the sync file must be an object' }];
  if (doc.$axf !== FRAMES.sync) err('$axf', 'invalid', `$axf must be ${FRAMES.sync}`);
  if (!str(doc.project)) err('project', 'missing', 'project is missing');
  if (!ms(doc.writtenAt)) err('writtenAt', 'missing', 'writtenAt must be an ISO date');
  if (!isObj(doc.writtenBy) || !str(doc.writtenBy.account)) err('writtenBy', 'missing', 'writtenBy names the account');
  if (!isObj(doc.work)) err('work', 'missing', 'work is missing');
  if (hasSecret(JSON.stringify(doc))) err('secret', 'invalid', 'the sync file carries a secret');
  return out;
}

/* ------------------------------------------------------------------ */
/* Channel lines (what the Breakroom's Sessions channel shows)          */
/* ------------------------------------------------------------------ */

/** The one line an event becomes in the Sessions channel: `{ kind, text, jobId, channel }` or null for silent events. */
export function channelLine(ev, names = {}) {
  const d = ev?.data ?? {}; const who = (id) => names[id] || id || 'someone';
  const agent = d.agent ? who(d.agent) : who(ev.session);
  switch (ev?.type) {
    case 'session': {
      if (d.action === 'join') return { kind: 'session', channel: CHANNEL, text: `${agent} joined as ${d.role}${d.becamePrimary ? ' (primary: owns the orchestrator)' : ''}${d.approved === false ? ' — waiting for Brett to approve the new account' : ''}`, jobId: '' };
      if (d.action === 'end') return { kind: 'session', channel: CHANNEL, text: `${agent} signed off${d.summary ? `: ${d.summary}` : ''}${d.givenBack?.length ? ` · gave back ${d.givenBack.length} assignment(s)` : ''}${d.primaryTo ? ` · primary → ${who(d.primaryTo)}` : ''}`, jobId: '' };
      if (d.action === 'approve-account') return { kind: 'session', channel: CHANNEL, text: `Brett approved account ${d.account}`, jobId: '' };
      return null;
    }
    case 'claim': return d.action === 'claim' ? { kind: 'claim', channel: CHANNEL, text: `${agent} claimed ${d.kind === 'area' ? `area ${d.area}` : (d.paths ?? []).join(', ')}${d.build ? ` for ${d.build}${d.step ? ` ${d.step}` : ''}` : ''}`, jobId: d.build ? `${d.build}${d.step ? `.${d.step}` : ''}` : '' } : { kind: 'claim', channel: CHANNEL, text: `${agent} released ${(d.claims ?? []).length} claim(s)`, jobId: '' };
    case 'offer': return { kind: 'handover', channel: CHANNEL, text: `Orchestrator offers ${d.build}${d.steps ? ` steps ${d.steps.join(', ')} as ${d.childBuild}` : ' (whole build)'} to ${d.to ? who(d.to) : 'any helper'}${d.reason ? ` — ${d.reason}` : ''}`, jobId: d.build };
    case 'handover': {
      if (d.action === 'accept') return { kind: 'handover', channel: CHANNEL, text: `${agent} took ${d.build}${d.steps ? ` (${d.steps.join(', ')})` : ''}${d.parent ? ` from ${d.parent}` : ''} — ${d.reaction?.why ?? ''}`.trim(), jobId: d.build };
      if (d.action === 'take-back') return { kind: 'handover', channel: CHANNEL, text: `Orchestrator took ${d.build}${d.steps ? ` (${d.steps.join(', ')})` : ''} back from ${agent}${d.reason ? `: ${d.reason}` : ''}`, jobId: d.build };
      if (d.action === 'undo') return { kind: 'handover', channel: CHANNEL, text: `Undid handover event ${d.of}: ${d.assignment} is ${d.status}`, jobId: '' };
      return { kind: 'handover', channel: CHANNEL, text: `${agent} ${d.action === 'hold' ? 'put on hold' : d.action === 'reject' ? 'rejected' : 'released'} ${d.build}${d.reason ? ` (${d.reason})` : ''}${d.backAt ? `, back ${d.backAt}` : ''} — ${d.reaction?.why ?? ''}`.trim(), jobId: d.build };
    }
    case 'assignment': return { kind: d.state === 'blocked' ? 'report' : 'report', channel: CHANNEL, text: `${agent} ${d.state === 'done' ? 'finished' : d.state === 'blocked' ? 'is blocked on' : 'started'} ${d.build} ${d.step}${d.reason ? ` (${d.reason})` : ''}${d.reaction?.why && d.state !== 'started' ? ` — ${d.reaction.why}` : ''}`, jobId: `${d.build}.${d.step}` };
    case 'replan': return d.moves?.length ? { kind: 'handover', channel: CHANNEL, text: `Replanned: ${d.moves.map((m) => `moved ${m.id} ${m.to < m.from ? 'above' : 'below'} ${m.why ? `because ${m.why}` : ''}`).join('; ')}`, jobId: '' } : null;
    case 'sync': return { kind: 'session', channel: CHANNEL, text: `${agent} wrote the sync file${d.path ? ` ${d.path}` : ''}`, jobId: '' };
    case 'build': return d.text ? { kind: 'report', channel: CHANNEL, text: `${agent}: ${d.text}`, jobId: str(d.build, 120) } : null;
    default: return null;
  }
}
/** Chat filter (all / handovers / blockers / mine) over channel messages. */
export function filterChannel(messages, filter, sessionAgent = '', myJobs = []) {
  const list = arr(messages).filter((m) => m.channel === CHANNEL);
  if (filter === 'handovers') return list.filter((m) => m.kind === 'handover');
  if (filter === 'blockers') return list.filter((m) => /blocked|rejected|on hold|claimed by/i.test(m.text));
  if (filter === 'mine') return list.filter((m) => m.from === sessionAgent || myJobs.some((j) => m.jobId === j || m.jobId?.startsWith(`${j}.`)));
  return list;
}

/** The registry snapshot (framework/schemas/handoff.json). */
export function registrySnapshot() {
  return { $axf: 'handoff-registry@1', frames: FRAMES, roles: ROLES, clients: CLIENTS, sessionStatuses: SESSION_STATUSES, claimKinds: CLAIM_KINDS, offerModes: OFFER_MODES, offerStatuses: OFFER_STATUSES, assignmentStatuses: ASSIGNMENT_STATUSES, responses: RESPONSES, stepStates: STEP_STATES, reactions: REACTIONS, eventTypes: EVENT_TYPES, helperStates: HELPER_STATES, channel: CHANNEL, messageKinds: MESSAGE_KINDS, chatFilters: CHAT_FILTERS, areas: AREAS, defaultSettings: DEFAULT_SETTINGS, ownerSettings: OWNER_SETTINGS, actions: ACTIONS };
}
