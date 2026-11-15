/**
 * axf-molly (axf-molly@1). Build axf-molly-container-orchestrator-gate, Brett Nov 15 2026: "Molly's gonna run the
 * orchestrator from now on, so let's name it AXF Molly."
 *
 * The final layout: the console is screens only; axf-molly does all the work (orchestrator, dispatcher tick, reconciler,
 * splitter, slots and account routing, gate rules, auto-lander and merge queue, the merge watch and Shipped features
 * sender); axHub is routes, credentials and approvals, no screens, no data; axf-data stores all data (data-store@1).
 *
 * This file is the pure contract the container, the host bridge, the console's screens, axHub's tools, the CLI and
 * voice all read. No IO, no git, no model.
 *
 * Records:
 *   molly-lease@1       who acts right now. `owner` is `console` (today's host crons and the console container) or
 *                       `axf-molly`. axf-molly owns only while `mode` is `cutover` and the lease is fresh (`until` in the
 *                       future): a container that dies hands the work back by itself when the lease expires, so builds
 *                       keep running during the switch. `undo` goes back to shadow at once.
 *   molly-shadow-diff@1 one line of the shadow log: what axf-molly computed next to what the console side did.
 *   host-bridge@1       one request to the host bridge (deploy/molly-bridge.mjs): a fixed command list, checked here.
 *                       The bridge is the only way out of the container; it is NOT the Docker socket.
 *
 * Tools: orchestrator.*, gate.*, lander.*, features.*, molly.* (TOOLS) are the one list axHub exposes, the container
 * serves over HTTP and the CLI (apps/axf-molly/molly.mjs) calls, so every action is reachable the same four ways.
 */

export const SCHEMA = 'axf-molly@1';
export const VERSION = 1;
export const SERVICE = 'axf-molly';
export const LEASE_FRAME = 'molly-lease@1';
export const DIFF_FRAME = 'molly-shadow-diff@1';
export const BRIDGE_FRAME = 'host-bridge@1';
export const STATUS_FRAME = 'molly-status@1';

/** Who may act: the console side (host crons + console container, today) or the axf-molly container. */
export const SIDES = Object.freeze(['console', 'axf-molly']);
/** shadow = axf-molly computes, the console acts, every difference is logged; cutover = axf-molly acts under a lease;
 *  undo = back to shadow, recorded as a step so History says who undid it and why. */
export const MODES = Object.freeze(['shadow', 'cutover', 'undo']);
/** How long a cutover lease lives without a renewal. The container renews every loop; a dead container hands back. */
export const LEASE_TTL_MIN = 30;
export const LEASE_TTL_MAX_MIN = 24 * 60;
export const TEXT_MAX = 600;
/** The internal port the container listens on (never published; reached over the Docker network only). */
export const PORT = 7510;
/** The bridge socket as the container sees it (mounted from the host's /run/axf-molly). */
export const BRIDGE_SOCKET = '/run/axf-molly/bridge.sock';
/** The job cadence inside the container (seconds). */
export const CADENCE = Object.freeze({ tick: 60, lander: 180, reconcile: 600, lease: 60, shadowKeep: 2000 });

const str = (v, max = TEXT_MAX) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const iso = (v, fallback) => { const t = Date.parse(str(v, 40)); return Number.isFinite(t) ? new Date(t).toISOString() : fallback; };
const ms = (v) => (typeof v === 'number' ? v : Date.parse(str(v, 40)));

// ------------------------------------------------------------------ the owner lease

export function initialLease(at = new Date().toISOString(), by = 'install') {
  return { $axf: LEASE_FRAME, rev: 1, owner: 'console', mode: 'shadow', since: at, until: '', by, reason: 'installed in shadow mode', prev: null, history: [{ at, mode: 'shadow', owner: 'console', by, reason: 'installed in shadow mode' }] };
}

export function normLease(v, at = new Date().toISOString()) {
  if (!v || typeof v !== 'object') return initialLease(at);
  const mode = MODES.includes(v.mode) ? v.mode : 'shadow';
  const owner = mode === 'cutover' && SIDES.includes(v.owner) ? v.owner : 'console';
  const history = Array.isArray(v.history) ? v.history.slice(-50).map((h) => ({ at: iso(h?.at, at), mode: MODES.includes(h?.mode) ? h.mode : 'shadow', owner: SIDES.includes(h?.owner) ? h.owner : 'console', by: str(h?.by, 80), reason: str(h?.reason) })) : [];
  return { $axf: LEASE_FRAME, rev: Number.isInteger(v.rev) && v.rev > 0 ? v.rev : 1, owner, mode, since: iso(v.since, at), until: mode === 'cutover' ? iso(v.until, at) : '', by: str(v.by, 80), reason: str(v.reason), prev: v.prev && typeof v.prev === 'object' ? { owner: SIDES.includes(v.prev.owner) ? v.prev.owner : 'console', mode: MODES.includes(v.prev.mode) ? v.prev.mode : 'shadow' } : null, history };
}

export function leaseErrors(v) {
  const e = [];
  if (!v || typeof v !== 'object') return ['lease: not an object'];
  if (v.$axf !== LEASE_FRAME) e.push(`lease.$axf: expected ${LEASE_FRAME}`);
  if (!SIDES.includes(v.owner)) e.push(`lease.owner: one of ${SIDES.join(', ')}`);
  if (!MODES.includes(v.mode)) e.push(`lease.mode: one of ${MODES.join(', ')}`);
  if (v.mode === 'cutover' && !Number.isFinite(ms(v.until))) e.push('lease.until: an ISO time while mode is cutover');
  if (v.mode !== 'cutover' && v.owner === 'axf-molly') e.push('lease.owner: axf-molly owns only in cutover');
  return e;
}

/** True while a cutover lease is fresh. */
export function leaseFresh(lease, now = Date.now()) {
  const l = normLease(lease);
  return l.mode === 'cutover' && Number.isFinite(ms(l.until)) && ms(l.until) > ms(now);
}

/** Who acts right now: axf-molly while its cutover lease is fresh, else the console side (the safe default). */
export function leaseOwner(lease, now = Date.now()) {
  const l = normLease(lease);
  return l.mode === 'cutover' && l.owner === 'axf-molly' && leaseFresh(l, now) ? 'axf-molly' : 'console';
}

/** May `side` launch, land or ship right now? Only the owner. */
export function canAct(lease, side, now = Date.now()) { return SIDES.includes(side) && leaseOwner(lease, now) === side; }

/** Why a side is not acting, in plain words (for the status line and refusals). */
export function actingWhy(lease, side, now = Date.now()) {
  const l = normLease(lease); const owner = leaseOwner(l, now);
  if (l.mode === 'cutover' && l.owner === 'axf-molly' && !leaseFresh(l, now)) return `the axf-molly lease expired at ${l.until}: the console side acts again until the container renews or Brett cuts over`;
  if (owner === side) return l.mode === 'cutover' ? `${side} owns the work (cutover lease until ${l.until})` : `${side} owns the work (shadow mode)`;
  return owner === 'axf-molly' ? `axf-molly owns the work (cutover until ${l.until}); ${side} computes only` : `shadow mode: the console side acts, axf-molly computes and logs differences`;
}

function step(lease, { at, by, reason, owner, mode, until = '' }) {
  const prev = { owner: lease.owner, mode: lease.mode };
  const entry = { at, mode, owner, by: str(by, 80), reason: str(reason) };
  return normLease({ ...lease, rev: lease.rev + 1, owner, mode, since: at, until, by: entry.by, reason: entry.reason, prev, history: [...lease.history, entry] }, at);
}

/** Shadow → cutover: axf-molly takes the work under a lease. `reason` is required (it is what History shows Brett). */
export function cutover(lease, { at = new Date().toISOString(), by = 'cli', reason = '', ttlMin = LEASE_TTL_MIN } = {}) {
  const l = normLease(lease, at);
  if (!str(reason).trim()) return { lease: l, error: 'cutover needs a reason' };
  if (l.mode === 'cutover' && l.owner === 'axf-molly' && leaseFresh(l, at)) return { lease: l, error: 'already cut over: renew the lease instead' };
  const ttl = Math.min(LEASE_TTL_MAX_MIN, Math.max(1, Number(ttlMin) || LEASE_TTL_MIN));
  const until = new Date(ms(at) + ttl * 60e3).toISOString();
  return { lease: step(l, { at, by, reason, owner: 'axf-molly', mode: 'cutover', until }), error: '' };
}

/** The container's heartbeat: pushes `until` out again. Not a history step. Refused unless axf-molly holds the lease. */
export function renew(lease, { at = new Date().toISOString(), ttlMin = LEASE_TTL_MIN } = {}) {
  const l = normLease(lease, at);
  if (l.mode !== 'cutover' || l.owner !== 'axf-molly') return { lease: l, error: 'nothing to renew: not in cutover' };
  const ttl = Math.min(LEASE_TTL_MAX_MIN, Math.max(1, Number(ttlMin) || LEASE_TTL_MIN));
  return { lease: { ...l, until: new Date(ms(at) + ttl * 60e3).toISOString() }, error: '' };
}

/** Cutover → shadow at once (Brett's undo, or the container stepping back). The console side acts from the next tick. */
export function undo(lease, { at = new Date().toISOString(), by = 'cli', reason = 'undo' } = {}) {
  const l = normLease(lease, at);
  if (l.mode !== 'cutover') return { lease: l, error: 'nothing to undo: already in shadow' };
  const back = step(l, { at, by, reason, owner: 'console', mode: 'undo' });
  return { lease: { ...back, mode: 'shadow', owner: 'console' }, error: '' };
}

// ------------------------------------------------------------------ the shadow log

/** Compare what axf-molly would do with what the console side did (two pipeline plans). Lists by build id. */
export function diffPlans(mine = {}, theirs = {}) {
  const diffs = [];
  const ids = (list) => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : str(x?.id, 80))).filter(Boolean) : []);
  const compare = (what, a, b, detail = () => '') => {
    const A = ids(a); const B = ids(b);
    for (const id of A) if (!B.includes(id)) diffs.push({ what, id, mine: detail(a, id) || 'yes', theirs: 'no' });
    for (const id of B) if (!A.includes(id)) diffs.push({ what, id, mine: 'no', theirs: detail(b, id) || 'yes' });
    for (const id of A) if (B.includes(id)) { const da = detail(a, id); const db = detail(b, id); if (da !== db) diffs.push({ what, id, mine: da, theirs: db }); }
  };
  const launchDetail = (list, id) => { const x = (list || []).find((l) => (typeof l === 'string' ? l : l?.id) === id); return x && typeof x === 'object' ? `${str(x.account, 60)}/${str(x.model, 20)}` : ''; };
  const waitDetail = (list, id) => { const x = (list || []).find((l) => (typeof l === 'string' ? l : l?.id) === id); return x && typeof x === 'object' ? str(x.why, 200) : ''; };
  compare('launch', mine.launches, theirs.launches, launchDetail);
  compare('wait', mine.waits, theirs.waits, waitDetail);
  compare('queue', mine.queue, theirs.queue);
  compare('running', mine.running, theirs.running);
  return { same: diffs.length === 0, diffs };
}

/** One shadow-log line. `kind` = tick | lander | reconcile | ship. */
export function diffEntry(kind, { at = new Date().toISOString(), diffs = [], mine = null, theirs = null, note = '' } = {}) {
  return { $axf: DIFF_FRAME, at, kind: str(kind, 20), same: diffs.length === 0, count: diffs.length, diffs: diffs.slice(0, 50), ...(mine != null ? { mine } : {}), ...(theirs != null ? { theirs } : {}), ...(note ? { note: str(note) } : {}) };
}

/** The shadow summary the status screen shows: how many lines, how many differ, since when. Cutover wants a clean streak. */
export function shadowSummary(entries = [], { now = Date.now(), cleanMin = 60 } = {}) {
  const list = entries.filter((e) => e && e.$axf === DIFF_FRAME);
  const differing = list.filter((e) => !e.same);
  const last = list.at(-1) ?? null;
  const lastDiff = differing.at(-1) ?? null;
  const cleanSince = lastDiff ? ms(lastDiff.at) : list.length ? ms(list[0].at) : NaN;
  const cleanForMin = Number.isFinite(cleanSince) ? Math.floor((ms(now) - cleanSince) / 60e3) : 0;
  return { lines: list.length, differing: differing.length, lastAt: last?.at ?? '', lastDiffAt: lastDiff?.at ?? '', cleanForMin, readyForCutover: list.length > 0 && cleanForMin >= cleanMin };
}

// ------------------------------------------------------------------ the host bridge

export const SESSION_RE = /^axf-[a-z0-9][a-z0-9._-]{0,120}$/;
export const BUILD_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{0,60}$/;
export const WORKTREES_ROOT = '/root/axf-builds';

/**
 * Every command the bridge runs, and nothing else. `args` names the positional arguments the request carries (`?` =
 * optional); the bridge checks each one against the pattern named here before anything runs. The command tells what
 * is touched on the host.
 */
export const BRIDGE_COMMANDS = Object.freeze({
  'tmux.has': { args: ['session'], touches: 'tmux has-session (read)' },
  'tmux.list': { args: [], touches: 'tmux list-panes (read)' },
  'tmux.capture': { args: ['session', 'lines?'], touches: 'tmux capture-pane of one axf-* session (read)' },
  'tmux.kill': { args: ['session'], touches: 'tmux kill-session of one axf-* session (the stale-session reaper only)' },
  'launch': { args: ['build', 'account', 'model', 'brief', 'log', 'token?', 'priority?'], touches: `deploy/claude-headless.sh in ${WORKTREES_ROOT}/<build> (starts one build session with the dispatcher's one-build token; the claude argv is built on the host, never taken from the request)` },
  'worktree.ensure': { args: ['build'], touches: `git worktree add under ${WORKTREES_ROOT} from the main checkout` },
  'git': { args: ['build', 'sub', 'rest*'], touches: `read-only git (status, log, rev-parse, diff, show, branch, fetch) inside ${WORKTREES_ROOT}/<build>` },
  'claude.probe': { args: ['account'], touches: 'pipeline.mjs probe <account>: one tiny headless call on that login' },
  'pipeline.health': { args: [], touches: 'pipeline.mjs health: the account sweep on the host logins (never a build)' },
  'accounts.list': { args: [], touches: '~/.claude-accounts names and states (never a token)' },
  'events.tail': { args: ['lines?'], touches: '/var/tmp/axf-headless/events.jsonl (read)' },
  'bridge.ping': { args: [], touches: 'nothing' },
});
export const GIT_SUBCOMMANDS = Object.freeze(['status', 'log', 'rev-parse', 'diff', 'show', 'branch', 'fetch', 'worktree', 'ls-files']);
/** What the bridge never does, spelled out so the doc and the test say the same thing. */
export const BRIDGE_NEVER = Object.freeze(['the Docker socket', 'docker, systemctl, apt or any package manager', 'files outside /root/axf-builds, /opt/axf (read) and /var/tmp/axf-headless (read)', 'a Claude token (accounts are listed by name only)', 'a shell: every command is an argv list, never a string']);

const PATTERNS = { session: SESSION_RE, build: BUILD_RE, account: ACCOUNT_RE, model: /^[a-z]{3,10}$/, brief: /^[A-Za-z0-9._-]{1,80}$/, log: /^[A-Za-z0-9._-]{1,80}$/, lines: /^[0-9]{1,4}$/, sub: /^[a-z-]{2,20}$/, token: /^[A-Za-z0-9._-]{8,300}$/, priority: /^(urgent|high|normal|low)$/ };

/** Check one bridge request: { cmd, args: [...] } → { ok, error, cmd, args, spec }. */
export function bridgeCheck(req) {
  if (!req || typeof req !== 'object') return { ok: false, error: 'request: not an object' };
  const cmd = str(req.cmd, 40); const spec = BRIDGE_COMMANDS[cmd];
  if (!spec) return { ok: false, error: `unknown bridge command "${cmd}"`, cmd };
  const args = Array.isArray(req.args) ? req.args.map((a) => str(a, 400)) : [];
  const out = [];
  for (let i = 0; i < spec.args.length; i += 1) {
    const name = spec.args[i];
    if (name.endsWith('*')) { out.push(...args.slice(i)); break; }
    const optional = name.endsWith('?'); const key = name.replace(/[?*]$/, '');
    const v = args[i];
    if (v == null || v === '') { if (optional) break; return { ok: false, error: `${cmd}: missing ${key}`, cmd }; }
    const p = PATTERNS[key];
    if (p && !p.test(v)) return { ok: false, error: `${cmd}: bad ${key} "${v.slice(0, 60)}"`, cmd };
    out.push(v);
  }
  if (args.length > out.length && !spec.args.some((a) => a.endsWith('*'))) return { ok: false, error: `${cmd}: too many arguments`, cmd };
  if (cmd === 'git') {
    if (!GIT_SUBCOMMANDS.includes(out[1])) return { ok: false, error: `git: "${out[1]}" is not allowed (${GIT_SUBCOMMANDS.join(', ')})`, cmd };
    if (out[1] === 'worktree' && out[2] !== 'list') return { ok: false, error: 'git worktree: only list', cmd };
    if (out.slice(2).some((a) => a.startsWith('--output') || a.startsWith('--exec') || a.includes('..') && a.startsWith('/'))) return { ok: false, error: 'git: an option that writes or runs is not allowed', cmd };
  }
  return { ok: true, error: '', cmd, args: out, spec };
}

/** The worktree a build request may touch: always directly under the root, never a path. */
export function worktreeFor(build, root = WORKTREES_ROOT) {
  if (!BUILD_RE.test(str(build, 80))) return '';
  return `${root}/${build}`;
}

/** host-bridge@1 frames. */
export const bridgeRequest = (cmd, args = [], id = '') => ({ $axf: BRIDGE_FRAME, id: str(id, 40), cmd: str(cmd, 40), args: args.map((a) => str(a, 400)) });
export const bridgeReply = (id, { ok, status = 0, stdout = '', stderr = '', error = '', ms: took = 0 } = {}) => ({ $axf: BRIDGE_FRAME, id: str(id, 40), ok: !!ok, status, stdout: str(stdout, 64_000), stderr: str(stderr, 8000), error: str(error), ms: took });

// ------------------------------------------------------------------ tools (axHub, HTTP, CLI, voice: one list)

/** Where each family's screen is in the console (console_show / console_open targets; alerts link the same way). */
export const CONSOLE_TARGETS = Object.freeze({ orchestrator: 'view:build-orchestrator', gate: 'view:gate-rules', lander: 'view:gate-rules', features: 'view:shipped-features', molly: 'view:build-orchestrator' });
/** The alert link the dispatcher uses (was `#/build-orchestrator`; the alerts bell navigates `view:` links). */
export const ALERT_LINK = CONSOLE_TARGETS.orchestrator;

/**
 * name → { method, path, cli, args, mutates, exclusive, says }. `cli` is the repo command that does it (what the
 * container and the CLI run), `exclusive` means only the lease owner may run it (launching, landing, shipping), `says`
 * is the voice line. Paths are under /v1 on the container and `/tools/axf-molly/<name>` on axHub.
 */
export const TOOLS = Object.freeze({
  'orchestrator.status': { method: 'GET', path: '/orchestrator/status', cli: ['pipeline', 'status'], args: [], mutates: false, exclusive: false, says: 'what is pending, queued and building' },
  'orchestrator.tab': { method: 'GET', path: '/orchestrator/tab/{tab}', cli: ['pipeline', 'tab'], args: ['tab'], mutates: false, exclusive: false, says: 'one orchestrator tab' },
  'orchestrator.show': { method: 'GET', path: '/orchestrator/builds/{id}', cli: ['pipeline', 'show'], args: ['id'], mutates: false, exclusive: false, says: 'one build' },
  'orchestrator.accounts': { method: 'GET', path: '/orchestrator/accounts', cli: ['pipeline', 'accounts'], args: [], mutates: false, exclusive: false, says: 'the Claude accounts as the dispatcher sees them' },
  'orchestrator.request': { method: 'POST', path: '/orchestrator/request', cli: ['pipeline', 'request'], args: ['title', 'detail?', 'said?', 'priority?', 'route?', 'queue?'], mutates: true, exclusive: false, says: 'file a build' },
  'orchestrator.queue': { method: 'POST', path: '/orchestrator/builds/{id}/queue', cli: ['pipeline', 'queue'], args: ['id'], mutates: true, exclusive: false, says: 'move a build to the Queue' },
  'orchestrator.unqueue': { method: 'POST', path: '/orchestrator/builds/{id}/unqueue', cli: ['pipeline', 'unqueue'], args: ['id'], mutates: true, exclusive: false, says: 'move a build back to Pending' },
  'orchestrator.hold': { method: 'POST', path: '/orchestrator/builds/{id}/hold', cli: ['pipeline', 'hold'], args: ['id', 'why?'], mutates: true, exclusive: false, says: 'hold a build' },
  'orchestrator.release': { method: 'POST', path: '/orchestrator/builds/{id}/release', cli: ['pipeline', 'release'], args: ['id'], mutates: true, exclusive: false, says: 'release a held build' },
  'orchestrator.split': { method: 'POST', path: '/orchestrator/builds/{id}/split', cli: ['pipeline', 'split'], args: ['id', 'provider?'], mutates: true, exclusive: false, says: 'split a build into steps' },
  'orchestrator.route': { method: 'POST', path: '/orchestrator/builds/{id}/route', cli: ['pipeline', 'route'], args: ['id', 'route'], mutates: true, exclusive: false, says: 'route a build to API or subscription accounts' },
  'orchestrator.step': { method: 'POST', path: '/orchestrator/builds/{id}/steps/{step}', cli: ['orchestrator', 'act', 'step'], args: ['id', 'step', 'state'], mutates: true, exclusive: false, says: 'tick a step' },
  'orchestrator.note': { method: 'POST', path: '/orchestrator/builds/{id}/note', cli: ['orchestrator', 'act', 'note'], args: ['id', 'text'], mutates: true, exclusive: false, says: 'add a build note' },
  'orchestrator.tick': { method: 'POST', path: '/orchestrator/tick', cli: ['pipeline', 'tick'], args: [], mutates: true, exclusive: true, says: 'run one dispatcher round now' },
  'orchestrator.selfcheck': { method: 'POST', path: '/orchestrator/selfcheck', cli: ['pipeline', 'selfcheck', '--request'], args: ['reason?'], mutates: true, exclusive: false, says: 'ask for a dispatcher self-check' },
  'gate.rules': { method: 'GET', path: '/gate/rules', cli: ['gate', 'rules'], args: [], mutates: false, exclusive: false, says: 'the gate rules' },
  'gate.set': { method: 'POST', path: '/gate/rules/{rule}', cli: ['gate', 'set'], args: ['rule', 'enabled?', 'severity?', 'settings?'], mutates: true, exclusive: false, says: 'change a gate rule' },
  'gate.state': { method: 'GET', path: '/gate/state', cli: ['gate', 'state'], args: [], mutates: false, exclusive: false, says: 'the lander state the gate reports' },
  'lander.status': { method: 'GET', path: '/lander/status', cli: ['land', 'list'], args: [], mutates: false, exclusive: false, says: 'what the lander is doing' },
  'lander.queue': { method: 'GET', path: '/lander/queue', cli: ['land', 'queue', 'list'], args: [], mutates: false, exclusive: false, says: 'the merge queue' },
  'lander.on': { method: 'POST', path: '/lander/on', cli: ['merge-queue', 'settings', '--on'], args: [], mutates: true, exclusive: false, says: 'switch the merge queue on' },
  'lander.off': { method: 'POST', path: '/lander/off', cli: ['merge-queue', 'settings', '--off'], args: [], mutates: true, exclusive: false, says: 'switch the merge queue off' },
  'lander.now': { method: 'POST', path: '/lander/builds/{id}/now', cli: ['land', 'now'], args: ['id'], mutates: true, exclusive: false, says: 'land a build next' },
  'lander.hold': { method: 'POST', path: '/lander/builds/{id}/hold', cli: ['land', 'hold'], args: ['id', 'why?'], mutates: true, exclusive: false, says: 'hold a build from landing' },
  'lander.release': { method: 'POST', path: '/lander/builds/{id}/release', cli: ['land', 'release'], args: ['id'], mutates: true, exclusive: false, says: 'release a held build' },
  'lander.run': { method: 'POST', path: '/lander/run', cli: ['land', 'run'], args: [], mutates: true, exclusive: true, says: 'run one landing round now' },
  'features.list': { method: 'GET', path: '/features', cli: ['shipped', 'list'], args: ['since?', 'q?'], mutates: false, exclusive: false, says: 'shipped features' },
  'features.show': { method: 'GET', path: '/features/{id}', cli: ['shipped', 'show'], args: ['id'], mutates: false, exclusive: false, says: 'one shipped feature' },
  'features.landed': { method: 'POST', path: '/features/landed', cli: ['shipped', 'landed'], args: ['since?', 'max?'], mutates: true, exclusive: true, says: 'send Shipped features for newly landed builds' },
  'features.ship': { method: 'POST', path: '/features/{id}/ship', cli: ['shipped', 'ship'], args: ['id', 'source?'], mutates: true, exclusive: true, says: 'send one build to Shipped features' },
  'molly.status': { method: 'GET', path: '/status', cli: ['molly', 'status'], args: [], mutates: false, exclusive: false, says: 'who runs the work, the lease, the shadow log' },
  'molly.shadow': { method: 'GET', path: '/shadow', cli: ['molly', 'shadow'], args: ['tail?'], mutates: false, exclusive: false, says: 'the shadow diff log' },
  'molly.cutover': { method: 'POST', path: '/mode/cutover', cli: ['molly', 'cutover'], args: ['reason', 'ttlMin?'], mutates: true, exclusive: false, says: 'axf-molly takes the work' },
  'molly.undo': { method: 'POST', path: '/mode/undo', cli: ['molly', 'undo'], args: ['reason?'], mutates: true, exclusive: false, says: 'back to shadow: the console side acts again' },
  'molly.renew': { method: 'POST', path: '/mode/renew', cli: ['molly', 'renew'], args: [], mutates: true, exclusive: false, says: 'renew the cutover lease' },
});
export const TOOL_FAMILIES = Object.freeze(['orchestrator', 'gate', 'lander', 'features', 'molly']);
export const toolFor = (name) => TOOLS[str(name, 60)] ?? null;
export const toolNames = (family = '') => Object.keys(TOOLS).filter((n) => !family || n.startsWith(`${family}.`));

/** Route an HTTP request to a tool: `GET /v1/orchestrator/builds/x` → { tool, params }. */
export function routeTool(method, path) {
  const p = str(path, 400).replace(/^\/v1/, '').replace(/\?.*$/, '').replace(/\/+$/, '') || '/';
  const parts = p.split('/').filter(Boolean);
  for (const [name, t] of Object.entries(TOOLS)) {
    if (t.method !== str(method, 10).toUpperCase()) continue;
    const tp = t.path.split('/').filter(Boolean);
    if (tp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < tp.length; i += 1) {
      if (tp[i].startsWith('{')) { const v = decodeURIComponent(parts[i]); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/.test(v)) { ok = false; break; } params[tp[i].slice(1, -1)] = v; }
      else if (tp[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { tool: name, params };
  }
  return null;
}

/** The axHub service record axf-molly registers as (what `axhub service add` takes). */
export function axhubService({ url = `http://${SERVICE}:${PORT}`, reason = 'axf-molly runs the orchestrator, gate, lander and Shipped sender' } = {}) {
  return { $axf: 'axhub-downstream@1', service: SERVICE, url: str(url, 200), tools: toolNames().map((n) => ({ name: n, method: TOOLS[n].method, path: `/v1${TOOLS[n].path}`, mutates: TOOLS[n].mutates, approval: TOOLS[n].mutates ? 'reason' : 'none', says: TOOLS[n].says })), equivalents: { 'axf-console.build_orchestrator_pipeline_request': 'orchestrator.request', 'planner.builds': 'orchestrator.status', 'vps.build_land': 'lander.now' }, reason: { title: 'Register axf-molly', description: str(reason) } };
}

// ------------------------------------------------------------------ the old standalone Molly app

/** What the retired standalone Molly app left on the VPS. Listed for retirement; nothing here is deleted by code. */
export const OLD_MOLLY = Object.freeze({ container: 'molly', image: 'molly:latest', cron: '/etc/cron.d/molly', script: '/usr/local/bin/molly-update', dir: '/opt/molly', domain: 'molly.amberxai.com', app: 'apps/molly' });

/** Does the new name clash with anything running? Exact match only; near names are listed so the retirement list is complete. */
export function nameClash(names = [], name = SERVICE) {
  const list = names.map((n) => str(n, 120)).filter(Boolean);
  return { clash: list.includes(name), near: list.filter((n) => n !== name && /molly/i.test(n)) };
}

/** The retirement list as plain lines (found = what the installer saw on the host). */
export function retirementList(found = {}) {
  const lines = [];
  const add = (label, items) => { for (const i of items || []) lines.push(`${label}: ${str(i, 200)}`); };
  add('container', found.containers); add('image', found.images); add('cron', found.crons); add('file', found.files); add('domain', found.domains); add('folder', found.dirs);
  return lines;
}

// ------------------------------------------------------------------ status

export function statusFrame({ at = new Date().toISOString(), lease, side = 'axf-molly', shadow = null, jobs = {}, data = {}, bridge = {}, version = '' } = {}) {
  const l = normLease(lease, at);
  return { $axf: STATUS_FRAME, at, side, owner: leaseOwner(l, at), acting: canAct(l, side, at), why: actingWhy(l, side, at), lease: l, shadow, jobs, data, bridge, version: str(version, 60) };
}
