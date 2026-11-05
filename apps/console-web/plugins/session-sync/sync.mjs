#!/usr/bin/env node
/**
 * Session sync — the CLI of the Session sync plugin (handoff@1 + session-link@1, framework/spec/HANDOFF.md; Brett,
 * Nov 4 2026: "when I type /sync ses or /sync amberx, it will automatically write a file on the repo that each project
 * can read and jump in"). Two Claude sessions on one project talk, claim areas and split the work without conflicts.
 *
 *   node sync.mjs sync [project] [--no-publish]        write _claude/sync/<project>.{json,md} (handoff@1), publish to main
 *   … join [project] [--account a] [--agent x] [--client code|chat|voice|headless] [--session id]   join (or refresh) the link
 *   … status | state [--for <session>]                 the link (a secondary sees only its own work)
 *   … snapshot                                          the join dialog's detail (working on, done, attention, offers)
 *   … heartbeat [--build b] [--step s] [--note n] [--pause "reason" [--until iso]] [--resume]
 *   … claim --area <name> | --paths a,b [--reason r] [--build b] [--step s]     a lease; 409 when another session holds it
 *   … release [--claim id]                              one claim or all of this session's
 *   … send "<text>" [--kind session|handover|claim|report] [--build b] [--step s]   a line in the Breakroom's Sessions channel
 *   … inbox [--peek]                                    unread channel lines + claim changes (moves the cursor unless --peek)
 *   … request-work [--minutes n] [--areas a,b] [--model Opus|Fable]   a helper asks; the orchestrator offers
 *   … offer <build> [--steps s1,s2] [--to session|account] [--reason r]   primary: offer a build, or steps as a new build
 *   … offers                                            open offers for this session
 *   … respond <offer|assignment> accept|reject|hold|release [--reason r] [--back iso]
 *   … step <assignment> <step> started|done|blocked [--reason r]
 *   … take-back <assignment|build> [--steps s1,s2] [--confirm] [--reason r]
 *   … replan [--dry-run]                                re-order the whole picture (both sides), say why
 *   … claim-job <id or title> [--branch b]              register a job before work starts (dedupe across accounts)
 *   … end [--summary "…"]                               release claims, give work back, closing line
 *   … approve-account <account>                         Brett only (the console passes his click)
 *   … settings [key value]                              read / change (owner-only keys need Brett)
 *   … consistency [--fix]                               every store that tracks a handover agrees with the link
 *   … check-commit [--staged | --files a,b | --range a..b] [--ci]   fail on files outside this session's claims
 *   … hook                                              Claude Code hook (stdin event): join on start, inbox at each step, claim guard on edits
 *   … hooks install|remove|status [--settings <file>]   the hook in ~/.claude/settings.json
 *   … events [--after n]                                typed change events (SSE resume)
 *   … op <name> '<json>'                                one op on the link file (the console server's path)
 *   … pair                                              helper: a one-time link for the page that takes this account's token
 *   … pair-ingest                                       (console server) stdin {code, token}: verify, seal, answer labels only
 *   … creds-init                                        on the VPS host: make the sealing key once
 *   … launch-gate --build b [--step s] [--env]          may this run start? exit 0 main or helper, 4 = it waits (never falls back)
 *   … token-limited [--account a] [--resets iso]        a helper's login hit its limit: its jobs wait
 *   … token-revoke <account>                            Brett only: drop the sealed token
 *   … check-models [--models opus,fable]                real check of this account's models, reported on the link
 *   … desk-sweep                                        run Brownie's timers once
 *   --json on any command prints JSON.
 *
 * Where the link lives: AXF_SESSION_LINK_FILE, else the console's data folder (AXF_CONSOLE_ROOT, default /opt/axf, when
 * it has one; the console container mounts it live), else this checkout's. One file, one lock, every write journaled
 * (`link.journal.jsonl`) and audited (`audit.jsonl`). The console server is the only Breakroom poster: it watches the
 * link's events and posts each one's channel line (handoff.mjs channelLine) through axf.crew@1, so this CLI never
 * names another plugin. Identity: AXF_SESSION / AXF_ACCOUNT / AXF_AGENT / AXF_CLIENT, else `.axf-console/session-sync/me.json`
 * in this checkout (made once). No model is ever called.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { hostname, homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../../../../framework/core/engines/handoff.mjs';
import { PROJECT_NAME, REPO_ROOT, activeProfile } from '../../../../framework/cli/persist.mjs';
import * as bstore from '../../../../framework/cli/builds-store.mjs';
import * as bcore from '../../../../framework/plan/builds-store-core.mjs';
import { publishFiles } from '../../../../framework/cli/builds-live.mjs';
import { accountId, accountsDir, credsApi, scrub, TOKEN_LIFE_MS, TOKEN_RE, verifyToken, probeModel } from './creds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FOLDER = 'session-sync';
export const SYNC_DIR = '_claude/sync';
const env = (k, d = '') => process.env[k] ?? d;
const nowIso = () => new Date().toISOString();
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

/* ------------------------------------------------------------------ where things live */

export function consoleRoot() {
  const r = env('AXF_CONSOLE_ROOT', '/opt/axf');
  if (r && r !== 'off' && existsSync(join(r, '.axf-console'))) return r;
  return REPO_ROOT;
}
export const dataDir = () => (env('AXF_SESSION_LINK_FILE') ? dirname(env('AXF_SESSION_LINK_FILE')) : env('AXF_SESSION_SYNC_DIR') || join(consoleRoot(), '.axf-console', 'plugins', FOLDER));
export const linkFile = () => env('AXF_SESSION_LINK_FILE') || join(dataDir(), 'link.json');
const journalFile = () => join(dataDir(), 'link.journal.jsonl');
const auditFile = () => join(dataDir(), 'audit.jsonl');
const meFile = () => env('AXF_SESSION_ME_FILE') || join(REPO_ROOT, '.axf-console', FOLDER, 'me.json');
const projectName = () => PROJECT_NAME;

function readJson(f, d) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } }
function writeJsonAtomic(f, data) { mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`, { mode: 0o600 }); renameSync(tmp, f); }
function lock(f, staleMs = 30000) {
  const lf = `${f}.lock`; mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  const until = Date.now() + 15000;
  for (;;) {
    try { const fd = openSync(lf, 'wx'); writeFileSync(fd, `${process.pid} ${nowIso()}`); closeSync(fd); return () => { try { unlinkSync(lf); } catch { /* gone */ } }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(lf).mtimeMs > staleMs) { unlinkSync(lf); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error(`the session link is locked (${lf})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
export const creds = credsApi(dataDir);
export const readLink = () => H.normLink({ ...readJson(linkFile(), {}), project: readJson(linkFile(), {}).project || projectName() });
const audit = (line) => { try { mkdirSync(dataDir(), { recursive: true, mode: 0o700 }); appendFileSync(auditFile(), `${JSON.stringify({ at: nowIso(), ...line })}\n`, { mode: 0o600 }); } catch { /* audit is best effort */ } };

/** Read, change, save the link under its lock; returns { result, events (new), link }. */
export function withLink(fn, { by = 'cli', action = 'write' } = {}) {
  const unlock = lock(linkFile());
  try {
    const link = readLink(); const seqBefore = link.seq; const before = JSON.stringify(link);
    const result = fn(link, nowIso());
    if (JSON.stringify(link) !== before) {
      if (link.events.length && link.events[link.events.length - 1].seq === seqBefore) { link.rev++; link.updatedAt = nowIso(); }
      writeJsonAtomic(linkFile(), link);
      const events = link.events.filter((e) => e.seq > seqBefore);
      try { appendFileSync(journalFile(), `${JSON.stringify({ at: nowIso(), by, action, rev: link.rev, events })}\n`, { mode: 0o600 }); } catch { /* best effort */ }
      return { result, events, link };
    }
    return { result, events: [], link };
  } finally { unlock(); }
}

/* ------------------------------------------------------------------ who am I */

const gitOut = (args, cwd = REPO_ROOT) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
export function accountName() {
  return env('AXF_ACCOUNT') || env('CLAUDE_ACCOUNT') || gitOut(['config', '--get', 'user.email']).toLowerCase() || `${(() => { try { return userInfo().username; } catch { return 'user'; } })()}@${hostname()}`;
}
/** This checkout's session identity (made once; env overrides). */
export function me({ create = true } = {}) {
  const saved = readJson(meFile(), {});
  const account = env('AXF_ACCOUNT') || env('CLAUDE_ACCOUNT') || saved.account || accountName();
  const id = env('AXF_SESSION') || saved.session || (create ? `${account.replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}-${randomBytes(3).toString('hex')}` : '');
  const out = { session: id, account, agent: env('AXF_AGENT') || saved.agent || '', client: env('AXF_CLIENT') || (env('AXF_SURFACE') === 'headless' ? 'headless' : saved.client || 'code'), machine: hostname(), branch: gitOut(['rev-parse', '--abbrev-ref', 'HEAD']) };
  if (create && (saved.session !== out.session || saved.account !== out.account || saved.agent !== out.agent)) { try { writeJsonAtomic(meFile(), { session: out.session, account: out.account, agent: out.agent, client: out.client, since: saved.since || nowIso() }); } catch { /* read-only checkout */ } }
  return out;
}
/** The crew, for the desk: the server passes it; a bare CLI reads any plugin's agents/roster.json (never by folder name). */
export function crewNow() {
  try { const c = JSON.parse(env('AXF_SESSION_SYNC_CREW') || 'null'); if (Array.isArray(c)) return c; } catch { /* fall through */ }
  const root = join(REPO_ROOT, 'apps/console-web/plugins');
  try { return readdirSync(root).flatMap((d) => readJson(join(root, d, 'agents/roster.json'), { agents: [] }).agents ?? []).map((a) => ({ id: a.id, name: a.name, models: a.models })); } catch { return []; }
}
const brettClick = () => !!env('AXF_APPROVER') && env('AXF_APPROVER_VIA') === 'console' && !env('CLAUDECODE') && !env('AXF_SESSION_SYNC_CALLER');

/* ------------------------------------------------------------------ the builds store (the orchestrator's record) */

const profileId = () => activeProfile().id;
export function buildsNow(profile = profileId()) { try { const s = bstore.readStoreNow(); return bcore.buildsOf(s, profile); } catch { return []; } }
export function allBuildsNow() { try { return bstore.readStoreNow().builds.filter((b) => !b.deleted); } catch { return []; } }
/** One handover transaction, store side: assignedTo on builds and steps, child builds for steps handed over as a new build, touches. */
export function syncStore(link, { by = 'session-sync' } = {}) {
  let changed = [];
  try {
    bstore.withStore((s) => {
      const builds = s.builds.filter((b) => !b.deleted);
      // child builds for steps-new-build assignments that have none yet
      for (const a of Object.values(link.assignments)) {
        if (!a.parent || !['queued', 'working', 'held', 'blocked'].includes(a.status) || builds.some((b) => b.id === a.build)) continue;
        const parent = builds.find((b) => b.id === a.parent); if (!parent) continue;
        const steps = parent.steps.filter((st) => (a.steps ?? []).includes(st.id)).map((st) => ({ ...st, done: false, doneAt: '', origin: { build: parent.id, step: st.id, how: 'helper' } }));
        const child = bcore.normBuild({ id: a.build, title: `${parent.title}: ${steps.map((st) => st.id).join(', ')} (helper)`, category: parent.category, detail: `Steps ${steps.map((st) => st.id).join(', ')} of ${parent.id}, handed to ${a.agent || a.session} by the orchestrator (session-link@1 assignment ${a.id}).`, status: 'running', source: 'session-sync', steps, profiles: parent.profiles, order: Object.fromEntries(parent.profiles.map((p) => [p, (parent.order?.[p] ?? 0) + 0.5])), parent: parent.id, touches: parent.touches, origin: parent.origin, createdAt: a.since });
        s.builds.push(child); builds.push(child); changed.push(child.id);
      }
      for (const p of H.assignmentPatches(builds, link)) {
        const b = s.builds.find((x) => x.id === p.id); if (!b) continue;
        if (p.assignedTo) b.assignedTo = p.assignedTo; else delete b.assignedTo;
        for (const st of b.steps) { const v = p.steps[st.id]; if (v) { st.assignedTo = { assignment: v.assignment, session: v.session, agent: v.agent, status: v.status }; if (v.withHelper) st.withHelper = v.withHelper; else delete st.withHelper; } else { delete st.assignedTo; delete st.withHelper; } }
        b.updatedAt = nowIso(); changed.push(b.id);
      }
      return s;
    }, { by, action: 'session-sync', note: changed.join(', ') });
  } catch (e) { return { ok: false, error: e.message, changed }; }
  return { ok: true, changed: [...new Set(changed)] };
}

/* ------------------------------------------------------------------ ops (one table; the server, the CLI and the hook all go through it) */

const refuse = (ctx, gate, action) => { audit({ kind: 'refused', action, session: ctx.session, account: ctx.account, role: ctx.role, code: gate.code, message: gate.message }); return { ok: false, code: gate.code, message: gate.message }; };
function ctxOf(link, who) {
  const w = who ?? {};
  const role = H.roleOf(link, w.session ? { id: w.session, account: w.account } : { account: w.account });
  return { ...w, role, brett: w.brett === true };
}
const gated = (action, fn) => (link, args, ctx, now) => {
  const g = H.gate(ctx.role, action, { brett: ctx.brett });
  if (!g.ok) return refuse(ctx, g, action);
  const r = fn(link, args, ctx, now);
  audit({ kind: 'op', action, session: ctx.session, account: ctx.account, role: ctx.role, by: ctx.brett ? 'brett' : ctx.agent || ctx.session, ok: r?.ok !== false, args: JSON.stringify(args).slice(0, 600) });
  return r;
};
const mustSession = (link, ctx) => { const s = link.sessions[ctx.session]; if (!s) throw new Error('join first (session-sync join)'); if (s.approved === false && !ctx.brett) throw new Error('this account is waiting for Brett\'s approval'); return s; };

export const OPS = {
  state: gated('state', (link, args, ctx, now) => stateFor(link, ctx, args?.for || (ctx.role === 'secondary' ? ctx.session : ''), now)),
  snapshot: gated('snapshot', (link, args, ctx, now) => snapshotFor(link, ctx, now)),
  claims: gated('claims', (link, _a, _c, now) => { H.expireClaims(link, now); return { ok: true, claims: Object.values(link.claims) }; }),
  offers: gated('offers', (link, _a, ctx) => ({ ok: true, offers: ctx.role === 'secondary' ? H.openOffers(link, ctx.session) : Object.values(link.offers).filter((o) => o.status === 'offered') })),
  events: gated('state', (link, args) => ({ ok: true, ...H.eventsSince(link, Number(args?.after) || 0, Number(args?.max) || 200) })),
  audit: gated('audit', (_l, args) => ({ ok: true, lines: readAudit(Number(args?.limit) || 200) })),
  join: (link, args, ctx, now) => {
    const r = H.join(link, { id: ctx.session, account: ctx.account, agent: args?.agent || ctx.agent, client: args?.client || ctx.client, machine: ctx.machine, branch: ctx.branch }, now);
    audit({ kind: 'op', action: 'join', session: ctx.session, account: ctx.account, role: r.session.role, ok: true });
    return { ok: true, session: r.session, role: r.session.role, becamePrimary: r.becamePrimary, needsApproval: r.needsApproval, primary: link.primary };
  },
  heartbeat: gated('heartbeat', (link, args, ctx, now) => { mustSession(link, ctx); const s = H.heartbeat(link, ctx.session, args?.doing, now, { branch: args?.branch || ctx.branch, ...(args?.pause !== undefined ? { pause: args.pause } : {}) }); return { ok: true, session: s, status: H.sessionStatus(s, now, H.settingsOf(link)) }; }),
  end: gated('end', (link, args, ctx, now) => { mustSession(link, ctx); const r = H.endSession(link, ctx.session, now, args?.summary || ''); return { ok: true, ...r }; }),
  claim: gated('claim', (link, args, ctx, now) => {
    const s = mustSession(link, ctx);
    if (ctx.role === 'secondary' && args?.build && !Object.values(link.assignments).some((a) => a.session === s.id && (a.build === args.build || a.parent === args.build))) return { ok: false, code: 'secondary', message: `secondary sessions claim only for their assigned work (${args.build} isn't yours)` };
    return H.claim(link, { ...args, session: s.id }, now);
  }),
  release: gated('release', (link, args, ctx, now) => { mustSession(link, ctx); return { ok: true, released: H.release(link, ctx.session, args?.claim || null, now) }; }),
  send: gated('send', (link, args, ctx, now) => {
    const s = mustSession(link, ctx); const text = str(args?.text, 1000).trim(); if (!text) throw new Error('nothing to say');
    const kind = H.MESSAGE_KINDS.includes(args?.kind) ? args.kind : 'session';
    const ev = H.pushEvent(link, 'message', { text, kind, build: str(args?.build, 120), step: str(args?.step, 40), files: list(args?.files).slice(0, 20), agent: s.agent }, now, { id: str(args?.build, 120), session: s.id });
    return { ok: true, seq: ev.seq };
  }),
  inbox: gated('inbox', (link, args, ctx, now) => {
    const s = mustSession(link, ctx); const after = Number(s.cursor) || 0;
    const { events, next } = H.eventsSince(link, after, 500);
    const names = namesOf(link);
    const lines = events.filter((e) => e.session !== s.id || e.type === 'offer' || e.type === 'handover').map((e) => ({ seq: e.seq, at: e.at, type: e.type, ...(H.channelLine(e, names) ?? { kind: e.type, text: '' }) })).filter((l) => l.text);
    if (!args?.peek) { s.cursor = String(next); link.rev++; link.updatedAt = now; }
    return { ok: true, lines, next, claims: Object.values(link.claims).filter((c) => c.session !== s.id).map((c) => ({ id: c.id, by: names[c.session] || c.session, kind: c.kind, area: c.area, paths: c.paths, until: c.expiresAt })), offers: H.openOffers(link, s.id).map((o) => ({ id: o.id, build: o.build, steps: o.steps, mode: o.mode, reason: o.reason })) };
  }),
  'request-work': gated('request-work', (link, args, ctx, now) => {
    const s = mustSession(link, ctx);
    s.capacity = { minutes: Number(args?.minutes) || 0, areas: list(args?.areas), model: str(args?.model, 20) };
    const picks = H.pickOffers(allBuildsNow(), link, { session: s.id, minutes: s.capacity.minutes, areas: s.capacity.areas, model: s.capacity.model, max: Number(args?.max) || 3 }, now);
    const offers = picks.map((p) => H.makeOffer(link, { build: p.build, steps: p.steps, mode: p.mode, to: s.id, from: link.primary?.session ?? 'orchestrator', reason: p.why }, now).offer);
    H.pushEvent(link, 'handover', { action: 'request-work', agent: s.agent, minutes: s.capacity.minutes, areas: s.capacity.areas, model: s.capacity.model, offered: offers.map((o) => o.id) }, now, { session: s.id });
    return { ok: true, offers, picks };
  }),
  offer: gated('offer', (link, args, ctx, now) => {
    const build = str(args?.build, 120); if (!build) throw new Error('offer needs a build');
    const steps = list(args?.steps); const mode = steps.length ? 'steps-new-build' : 'whole';
    const r = H.makeOffer(link, { build, steps: steps.length ? steps : null, mode, to: str(args?.to, 120), from: ctx.session || 'orchestrator', reason: str(args?.reason, 500) }, now);
    return { ok: true, offer: r.offer, duplicate: r.duplicate === true };
  }),
  respond: gated('respond', (link, args, ctx, now) => {
    mustSession(link, ctx);
    const id = str(args?.id, 60); const key = link.assignments[id] ? 'assignment' : 'offer';
    const r = H.respond(link, { session: ctx.session, [key]: id, response: args?.response, reason: args?.reason, backAt: args?.backAt }, now);
    let bounce = null;
    if (args?.response === 'accept' && r.assignment) { const b = allBuildsNow().find((x) => x.id === (r.assignment.parent || r.assignment.build)); if (b) bounce = H.bounceGaps(link, r.assignment, b, crewNow(), now, namesOf(link)); }
    return { ok: true, assignment: r.assignment, offer: r.offer, reaction: r.reaction, bounce };
  }),
  step: gated('step', (link, args, ctx, now) => { mustSession(link, ctx); const r = H.stepState(link, { session: ctx.session, assignment: args?.assignment, step: args?.step, state: args?.state, reason: args?.reason }, now);
    if (r.assignment.status === 'done') { const a = r.assignment; const sg = H.settingsOf(link); H.pushEvent(link, 'desk', { kind: 'landed', from: sg.deskAgent, build: a.parent || a.build, assignment: a.id, line: H.deskLine('landed', { ref: a.parent || a.build, helper: namesOf(link)[a.agent] || a.agent || a.session }, sg.sass, link.seq) }, now, { id: a.id }); }
    return { ok: true, ...r }; }),
  'take-back': gated('take-back', (link, args, _ctx, now) => H.takeBack(link, args ?? {}, now)),
  undo: gated('take-back', (link, args, _ctx, now) => H.undoHandover(link, Number(args?.seq) || 0, now)),
  replan: gated('replan', (link, args, _ctx, now) => {
    const profile = str(args?.profile, 40) || profileId();
    const r = H.replan(buildsNow(profile), link, { profile, dryRun: args?.dryRun === true, maxAgents: Number(args?.maxAgents) || 6 }, now);
    if (!r.dryRun && r.moves.length) { try { bstore.withStore((s) => { r.order.forEach((id, i) => { const b = s.builds.find((x) => x.id === id); if (b) { b.order = { ...(b.order ?? {}), [profile]: i + 1 }; } }); return s; }, { by: 'session-sync', action: 'replan', note: r.summary.join('; ') }); } catch (e) { r.storeError = e.message; } }
    return { ok: true, ...r };
  }),
  'claim-job': gated('claim-job', (link, args, ctx, now) => claimJob(link, args, ctx, now)),
  'approve-account': gated('approve-account', (link, args, _ctx, now) => ({ ok: true, sessions: H.approveAccount(link, str(args?.account, 120), now) })),
  settings: (link, args, ctx, now) => {
    if (!args || !Object.keys(args).length) return { ok: true, settings: H.settingsOf(link), ownerOnly: H.OWNER_SETTINGS };
    const g = H.gate(ctx.role, 'settings', { brett: ctx.brett });
    const keys = Object.keys(args).filter((k) => k in H.DEFAULT_SETTINGS);
    if (keys.some((k) => H.OWNER_SETTINGS.includes(k)) && !ctx.brett) return refuse(ctx, { code: 'owner', message: `only Brett changes ${keys.filter((k) => H.OWNER_SETTINGS.includes(k)).join(', ')}` }, 'settings');
    if (!g.ok && !(ctx.role === 'primary' && keys.every((k) => !H.OWNER_SETTINGS.includes(k)))) return refuse(ctx, g, 'settings');
    for (const k of keys) link.settings[k] = args[k];
    H.pushEvent(link, 'link', { action: 'settings', keys }, now, { session: ctx.session });
    audit({ kind: 'op', action: 'settings', session: ctx.session, account: ctx.account, role: ctx.role, keys });
    return { ok: true, settings: H.settingsOf(link) };
  },
  'make-primary': gated('make-primary', (link, args, _ctx, now) => { const s = link.sessions[str(args?.session, 120)]; if (!s) throw new Error('unknown session'); link.primary = { session: s.id, account: s.account, agent: s.agent, since: now }; for (const x of Object.values(link.sessions)) x.role = H.roleOf(link, x.id) === 'primary' ? 'primary' : 'secondary'; H.pushEvent(link, 'link', { action: 'make-primary', session: s.id, account: s.account }, now, { session: s.id }); return { ok: true, primary: link.primary }; }),
  // a session's own account: which models it can run, and that it hit a limit. It can only say this about itself.
  'account-report': gated('account-report', (link, args, ctx, now) => {
    const x = H.ensureAccount(link, ctx.account);
    if (args?.models && typeof args.models === 'object') { x.models = H.normAccount({ models: { can: { ...x.models.can, ...args.models }, checkedAt: now } }).models; }
    if (args?.limited) { x.credential.state = 'limited'; x.credential.resetsAt = str(args.limited.resetsAt, 40); }
    if (Number.isFinite(args?.usagePct)) x.credential.usagePct = args.usagePct;
    H.pushEvent(link, 'session', { action: 'account', account: ctx.account, models: x.models.can }, now, { id: ctx.account, session: ctx.session });
    return { ok: true, account: x };
  }),
  // the console server, after a verified pairing (labels only: the token is sealed and gone)
  'account-credential': gated('revoke', (link, args, _ctx, now) => {
    const x = H.ensureAccount(link, str(args?.account, 120)); const c = args?.credential ?? {};
    link.accounts[x.id] = H.normAccount({ ...x, credential: { ...x.credential, ...c, checkedAt: now }, models: args?.models ? { can: args.models, checkedAt: now } : x.models });
    H.pushEvent(link, 'session', { action: 'credential', account: x.id, credentialState: link.accounts[x.id].credential.state, email: link.accounts[x.id].credential.email }, now, { id: x.id });
    return { ok: true, account: link.accounts[x.id] };
  }),
  'pair-start': gated('pair-start', (link, _a, ctx) => pairStart(link, ctx)),
  'accounts-read': gated('accounts-read', (link, _a, ctx, now) => {
    const rows = Object.values(link.accounts).filter((x) => ctx.role !== 'secondary' || x.id === ctx.account).map((x) => ({ ...x, id: x.id, label: `Helper ${x.helperNo || '?'}`, problem: H.credentialProblem(x, now), expiringSoon: H.expiresSoon(x, now), hasToken: (() => { try { return creds.hasToken(accountId(x.id)); } catch { return false; } })(), sessions: Object.values(link.sessions).filter((s) => s.account === x.id && !s.endedAt).map((s) => ({ id: s.id, agent: s.agent })), writeups: link.writeups.filter((w) => w.account === x.id).slice(-5) }));
    return { ok: true, accounts: rows, canSeal: creds.canSeal(), desk: H.HELPER_DESK };
  }),
  'desk-sweep': gated('desk-sweep', (link, _a, _c, now) => ({ ok: true, fired: H.deskSweep(link, allBuildsNow(), crewNow(), now, namesOf(link)) })),
  'desk-wait': gated('account-report', (link, args, _c, now) => {
    const build = str(args?.build, 120); const why = str(args?.why, 200); const sg = H.settingsOf(link);
    if (link.events.slice(-50).some((e) => e.type === 'desk' && e.data.kind === 'waiting' && e.data.build === build && e.data.why === why)) return { ok: true, posted: false };
    H.pushEvent(link, 'desk', { kind: 'waiting', from: sg.deskAgent, build, why, line: H.deskLine('waiting', { ref: build, why }, sg.sass, link.seq) }, now, { id: build });
    return { ok: true, posted: true };
  }),
  sync: gated('sync', (link, args, ctx, now) => writeSyncFile(link, ctx, now, args ?? {})),
};

function namesOf(link) { const names = {}; for (const s of Object.values(link.sessions)) { names[s.id] = s.agent ? agentName(s.agent) : s.id; if (s.agent) names[s.agent] = agentName(s.agent); } return names; }
/** Display names: AXF_SESSION_SYNC_NAMES ('{"rio":"Rio React"}', the server passes the crew's names), else the id. */
const NAMES = (() => { try { return JSON.parse(env('AXF_SESSION_SYNC_NAMES') || '{}'); } catch { return {}; } })();
const agentName = (id) => NAMES[id] || id;
function readAudit(limit) { try { return readFileSync(auditFile(), 'utf8').trim().split('\n').slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }

function stateFor(link, ctx, forSession, now) {
  H.expireClaims(link, now);
  const settings = H.settingsOf(link);
  const sessions = Object.values(link.sessions).map((s) => ({ ...s, status: H.sessionStatus(s, now, settings), helper: H.helperStatus(s, now, settings), role: H.roleOf(link, s.id) }));
  const base = { ok: true, project: link.project, rev: link.rev, seq: link.seq, updatedAt: link.updatedAt, primary: link.primary, me: { session: ctx.session, account: ctx.account, agent: ctx.agent, role: ctx.role }, sessions, claims: Object.values(link.claims), settings, caps: H.slotSplit(Number(env('AXF_MAX_AGENTS')) || 6, Object.values(link.sessions).filter((s) => !s.endedAt), settings.slotSplit), stats: link.stats };
  if (forSession && H.roleOf(link, forSession) === 'secondary') return { ...base, scoped: true, managedBy: 'orchestrator', offers: H.openOffers(link, forSession), assignments: Object.values(link.assignments).filter((a) => a.session === forSession), builds: H.scopedBuilds(allBuildsNow(), link, forSession) };
  return { ...base, scoped: false, offers: Object.values(link.offers).filter((o) => o.status === 'offered'), assignments: Object.values(link.assignments), helpers: sessions.filter((s) => s.role === 'secondary') };
}
function snapshotFor(link, ctx, now) {
  const settings = H.settingsOf(link); const builds = allBuildsNow(); const today = now.slice(0, 10);
  const prog = (b) => { const open = b.steps.filter((s) => !s.skip); const done = open.filter((s) => s.done).length; return { done, total: open.length, next: open.find((s) => !s.done)?.id ?? '' }; };
  const working = Object.values(link.sessions).filter((s) => !s.endedAt).map((s) => { const b = builds.find((x) => x.id === s.doing.build); return { session: s.id, agent: s.agent, account: s.account, role: H.roleOf(link, s.id), status: H.sessionStatus(s, now, settings), build: s.doing.build, step: s.doing.step, note: s.doing.note, model: b?.steps.find((x) => x.id === s.doing.step)?.model ?? '', progress: b ? prog(b) : null, since: s.startedAt, lastSeenAt: s.lastSeenAt, branch: s.branch }; });
  const running = builds.filter((b) => b.status === 'running' && !b.hidden).map((b) => ({ id: b.id, title: b.title, branch: b.branch, pr: b.pr, progress: prog(b), assignedTo: H.assignedBadge(link, b.id, '', now, settings, b), steps: b.steps.map((s) => ({ id: s.id, text: s.text, model: s.model, done: s.done, estimate: s.estimate, assignedTo: s.assignedTo ?? null, withHelper: s.withHelper ?? '' })) }));
  const done = builds.filter((b) => (b.mergedAt || b.builtAt || b.updatedAt || '').slice(0, 10) === today && ['built', 'complete'].includes(b.status)).map((b) => ({ id: b.id, title: b.title, status: b.status, pr: b.pr, mergedAt: b.mergedAt ?? '', report: existsSync(join(REPO_ROOT, '_claude/builds/reports', `${b.id}.md`)) ? `_claude/builds/reports/${b.id}.md` : '' }));
  const attention = [...builds.filter((b) => ['blocked', 'failed', 'waiting'].includes(b.status) && !b.hidden).map((b) => ({ kind: b.status, ref: b.id, text: `${b.title} is ${b.status}${b.notes?.length ? `: ${b.notes[b.notes.length - 1].text.slice(0, 160)}` : ''}` })), ...Object.values(link.assignments).filter((a) => ['blocked', 'held', 'rejected'].includes(a.status)).map((a) => ({ kind: a.status, ref: a.build, text: `${a.agent || a.session} ${a.status} ${a.build}${a.reason ? `: ${a.reason}` : ''}` }))];
  const queued = ctx.role === 'secondary' ? [] : builds.filter((b) => ['pending'].includes(b.status) && !b.hidden && !H.assignmentsOf(link, b.id).length).map((b) => ({ id: b.id, title: b.title, estimate: b.steps.filter((s) => !s.done).map((s) => s.estimate).filter(Boolean).join(' + '), touches: b.touches ?? [], steps: b.steps.length, createdAt: b.createdAt }));
  return { ok: true, at: now, me: { session: ctx.session, account: ctx.account, agent: ctx.agent, role: ctx.role }, primary: link.primary, working, running, done, attention, queued, offers: ctx.role === 'secondary' ? H.openOffers(link, ctx.session) : Object.values(link.offers).filter((o) => o.status === 'offered'), assignments: Object.values(link.assignments).filter((a) => ctx.role !== 'secondary' || a.session === ctx.session), caps: H.slotSplit(Number(env('AXF_MAX_AGENTS')) || 6, Object.values(link.sessions).filter((s) => !s.endedAt), settings.slotSplit), decisions: recentDecisions(5) };
}
function claimJob(link, args, ctx, now) {
  const job = { id: str(args?.id, 120), title: str(args?.title || args?.id, 300), detail: str(args?.detail, 2000), steps: list(args?.steps) };
  const builds = allBuildsNow(); const m = H.matchJob(job, builds);
  const who = { session: ctx.session, account: ctx.account, agent: ctx.agent };
  if (m.match) {
    const b = m.match; const a = H.normAssignment({ id: `a-${link.seq + 1}`, build: b.id, steps: null, session: ctx.session || `${ctx.account}`, account: ctx.account, agent: ctx.agent, status: 'working', since: now, updatedAt: now, reason: `claimed from ${str(args?.branch, 200) || 'a session'} (${m.how})` });
    const dup = Object.values(link.assignments).find((x) => x.build === b.id && ['queued', 'working'].includes(x.status));
    if (dup && dup.session !== a.session) return { ok: false, code: 'taken', message: `${b.id} is already being done by ${dup.agent || dup.session}`, match: b.id };
    if (!dup) link.assignments[a.id] = a;
    H.pushEvent(link, 'handover', { action: 'claim-job', build: b.id, how: m.how, score: m.score, branch: str(args?.branch, 200), agent: ctx.agent, wasQueued: ['pending'].includes(b.status), reaction: { decision: 'replan', why: `${ctx.agent || ctx.account} is doing ${b.id} (matched by ${m.how}): removed from the main queue and linked` } }, now, { id: b.id, session: ctx.session });
    try { bstore.withStore((s) => { const x = s.builds.find((y) => y.id === b.id); if (x && x.status === 'pending') x.status = 'running'; if (x) { x.notes.push({ text: `Being done by ${ctx.agent || ctx.account}${args?.branch ? ` on ${args.branch}` : ''} (session sync, matched by ${m.how})`, at: now }); if (args?.branch && !x.branch) x.branch = str(args.branch, 200); } return s; }, { by: 'session-sync', action: 'claim-job', note: b.id }); } catch { /* store unavailable */ }
    return { ok: true, match: b.id, how: m.how, score: m.score, assignment: dup?.id ?? a.id, who };
  }
  const id = bcore.slug(job.id || job.title);
  try { bstore.withStore((s) => { if (!s.builds.some((b) => b.id === id)) s.builds.push(bcore.normBuild({ id, title: job.title, detail: job.detail || `Auto-registered from ${str(args?.branch, 200) || 'a session'} by session sync (unregistered work).`, status: 'running', source: 'session-sync', branch: str(args?.branch, 200), profiles: [profileId()], steps: job.steps.map((t) => ({ text: t })) })); return s; }, { by: 'session-sync', action: 'claim-job', note: id }); } catch (e) { return { ok: false, error: e.message }; }
  H.pushEvent(link, 'handover', { action: 'claim-job', build: id, how: 'new', branch: str(args?.branch, 200), agent: ctx.agent, warning: 'unregistered work: registered now', reaction: { decision: 'none', why: `${ctx.agent || ctx.account} started ${id} without a build; registered it (warning)` } }, now, { id, session: ctx.session });
  return { ok: true, match: null, registered: id, warning: 'unregistered work was registered with a warning', who };
}
function recentDecisions(n) {
  try { return readFileSync(join(REPO_ROOT, '_claude/memory/decisions.md'), 'utf8').split('\n').filter((l) => /^- /.test(l)).slice(-n).map((l) => { const m = /\((\w+ \d+,? \d{4})/.exec(l); return { at: m?.[1] ?? '', text: l.replace(/^- /, '').slice(0, 300) }; }); } catch { return []; }
}

/* ------------------------------------------------------------------ the sync file (handoff@1) */

export const syncPaths = (project = projectName()) => ({ json: join(REPO_ROOT, SYNC_DIR, `${project}.json`), md: join(REPO_ROOT, SYNC_DIR, `${project}.md`), relJson: `${SYNC_DIR}/${project}.json`, relMd: `${SYNC_DIR}/${project}.md` });
export function readSyncFile(project = projectName()) { const p = syncPaths(project); return readJson(p.json, null) ?? H.parseSync((() => { try { return readFileSync(p.md, 'utf8'); } catch { return ''; } })()); }
function writeSyncFile(link, ctx, now, { publish = true, console: consoleUrl = env('AXF_CONSOLE_URL') || 'https://console.amberxai.com' } = {}) {
  const builds = allBuildsNow();
  const prs = builds.filter((b) => b.pr && b.status !== 'complete' && b.status !== 'archived').map((b) => ({ number: Number(String(b.pr).replace(/\D/g, '')) || 0, title: b.title, branch: b.branch, state: b.status === 'built' ? 'open' : b.status, ci: '' }));
  const snap = snapshotFor(link, ctx, now);
  const next = snap.running.map((b) => b.progress.next ? `${b.id}: ${b.steps.find((s) => s.id === b.progress.next)?.text ?? b.progress.next}` : '').filter(Boolean);
  const doc = H.makeSync(link, { builds, console: consoleUrl, prs, attention: snap.attention, decisions: snap.decisions, rules: ['CLAUDE.md', '_claude/shared/rules/RULES.md', '_claude/rules/RULES.md', 'framework/spec/HANDOFF.md'], next }, { session: ctx.session, account: ctx.account, agent: ctx.agent, client: ctx.client }, now);
  const errs = H.syncErrors(doc); if (errs.length) throw new Error(`sync file: ${errs.map((e) => e.message).join('; ')}`);
  const p = syncPaths(link.project); const json = `${JSON.stringify(doc, null, 1)}\n`; const md = H.renderSync(doc);
  mkdirSync(dirname(p.json), { recursive: true }); writeFileSync(p.json, json); writeFileSync(p.md, md);
  H.pushEvent(link, 'sync', { path: p.relJson, agent: ctx.agent }, now, { session: ctx.session });
  let published = null;
  if (publish && env('AXF_SYNC_PUBLISH') !== '0') published = publishFiles({ [p.relJson]: json, [p.relMd]: md }, `Session sync: ${link.project} by ${ctx.agent || ctx.account} [skip ci]\n\nStatus-only commit from apps/console-web/plugins/session-sync/sync.mjs (handoff@1 sync file: who is on, claims, work, offers).`);
  return { ok: true, path: p.relJson, md: p.relMd, fresh: true, published, sessions: doc.sessions.length, claims: doc.claims.length };
}

/* ------------------------------------------------------------------ running an op */

export function runOp(name, args = {}, who = null) {
  const op = OPS[name]; if (!op) return { ok: false, code: 'unknown-op', message: `unknown op ${name} (${Object.keys(OPS).join(', ')})` };
  const w = who ?? { ...me(), brett: brettClick() };
  try {
    const { result, events } = withLink((link, now) => op(link, args, ctxOf(link, w), now), { by: w.session || w.account || 'cli', action: name });
    const r = result ?? { ok: true };
    if (events.some((e) => ['handover', 'assignment', 'offer', 'session', 'desk'].includes(e.type)) && !env('AXF_SESSION_SYNC_NO_STORE')) r.store = syncStore(readLink());
    return { ...r, events };
  } catch (e) { return { ok: false, code: 'error', message: e.message }; }
}

/* ------------------------------------------------------------------ helper logins (spec § 14; creds.mjs keeps them sealed) */

function pairStart(link, my) {
  if (!link.sessions[my.session]) return { ok: false, code: 'no-session', message: 'join first (session-sync join)' };
  if (H.roleOf(link, my.session) !== 'secondary') return { ok: false, code: 'primary', message: 'the main account needs no pairing: only helpers bring their own login' };
  if (!creds.canSeal()) return { ok: false, code: 'not-ready', message: 'the VPS has no sealing key yet: run session-sync creds-init on the host' };
  const { code, expiresAt } = creds.pairStart({ account: my.account, session: my.session, agent: my.agent });
  return { ok: true, url: `${env('AXF_CONSOLE_URL') || 'https://console.amberxai.com'}/#/session-sync?pair=${code}`, expiresAt };
}
export const pairLink = (my) => pairStart(readLink(), my);
/** The console server pipes `{code, token}` here on stdin (never argv). Verifies before anything is kept; answers labels only. */
export async function pairIngest(raw) {
  let body; try { body = JSON.parse(raw); } catch { return { ok: false, message: 'bad request' }; }
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!TOKEN_RE.test(token)) return { ok: false, message: 'that is not a subscription token: run `claude setup-token` and paste what it prints' };
  if (!creds.pairPeek(body?.code)) return { ok: false, message: 'this pairing link has expired or was already used: run session-sync pair again' };
  try {
    const v = await verifyToken(token); if (!v.ok) return { ok: false, message: v.why };
    const p = creds.pairConsume(body.code); if (!p) return { ok: false, message: 'this pairing link was already used' };
    const id = accountId(p.account); creds.seal(id, token);
    const at = nowIso();
    const credential = { state: v.limited ? 'limited' : 'ok', email: v.email, plan: v.plan, last4: token.slice(-4), addedAt: at, expiresAt: new Date(Date.now() + TOKEN_LIFE_MS).toISOString(), resetsAt: v.limited?.resetsAt ?? '' };
    return { ok: true, account: p.account, session: p.session, agent: p.agent, credential, models: v.can };
  } catch (e) { return { ok: false, message: scrub(e.message) }; }
}
export function revokeToken(account, my) {
  if (!my.brett && !brettClick()) return { ok: false, code: 'owner', message: 'only Brett can do that: revoke' };
  creds.drop(accountId(account));
  return runOp('account-credential', { account, credential: { state: 'revoked', last4: '', expiresAt: '', resetsAt: '' } }, { ...my, brett: true });
}
/** The real check of the session's own account: its token when it has one here, else its logged-in Claude Code (one tiny call per model). */
export async function checkModels(models, my) {
  const token = env('CLAUDE_CODE_OAUTH_TOKEN'); const can = {};
  for (const m of models) {
    if (token) { const p = await probeModel(token, m); if (p.result === 'yes') can[m] = true; if (p.result === 'no') can[m] = false; continue; }
    const r = spawnSync('claude', ['-p', 'ok', '--model', m, '--max-turns', '1'], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status === 0) can[m] = true; else if (/model|access|not available|not found|upgrade/i.test(`${r.stdout}${r.stderr}`) && !/limit|credit/i.test(`${r.stdout}${r.stderr}`)) can[m] = false;
  }
  const r = runOp('account-report', { models: can }, { ...my, brett: false });
  return r.ok === false ? r : { ok: true, can };
}
/**
 * The launcher's question. Fails closed: if the owner of a build can't be read, or a helper's token can't be opened, the run waits.
 * `wantEnv` answers shell lines for the run's private env file; the variables stay unexported until the one `claude` that needs them.
 */
export function launchGate({ build, step = '', wantEnv = false, now = nowIso() }) {
  const link = readLink();
  const g = H.launchGate(link, build, now, step);
  if (g.ok && g.owner === 'main') return g;
  const wait = (reason) => { try { runOp('desk-wait', { build, why: reason }, { session: 'launcher', account: g.account, brett: false }); } catch { /* the wait still holds */ } return { ok: false, wait: true, owner: 'helper', account: g.account, reason }; };
  if (!g.ok) return wait(g.reason);
  const id = accountId(g.account);
  let token = ''; try { token = creds.unseal(id); } catch (e) { return wait(`Helper ${g.helperNo}: login needed (${scrub(e.message)})`); }
  if (!TOKEN_RE.test(token)) return wait(`Helper ${g.helperNo}: login needed`);
  const cfg = join(accountsDir(), id); mkdirSync(cfg, { recursive: true, mode: 0o700 });
  if (!wantEnv) return g;
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  return { ...g, env: `AXF_HELPER_ACCOUNT=${q(g.account)}\nAXF_HELPER_DIR=${q(cfg)}\nAXF_HELPER_TOKEN=${q(token)}\n` };
}

/* ------------------------------------------------------------------ checks: commits and consistency */

export function changedFiles({ staged = false, range = '', files = [] } = {}) {
  if (files.length) return files;
  const args = staged ? ['diff', '--cached', '--name-only'] : range ? ['diff', '--name-only', range] : ['diff', '--name-only', 'HEAD'];
  return gitOut(args).split('\n').filter(Boolean);
}
/** Files outside this session's claims: `{ ok, enforce, outside, claimedBy, why }`; ok when nobody else is live or the plugin is off. */
export function checkCommit({ staged = false, range = '', files = [], ci = false, session = '' } = {}) {
  const paths = changedFiles({ staged, range, files });
  if (ci) {
    const doc = readSyncFile(); if (!doc) return { ok: true, enforce: false, outside: [], claimedBy: [], why: 'no sync file: nothing to enforce' };
    const branch = env('GITHUB_HEAD_REF') || gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
    const s = (doc.sessions ?? []).find((x) => x.branch && x.branch === branch); if (!s) return { ok: true, enforce: false, outside: [], claimedBy: [], why: `branch ${branch} belongs to no synced session` };
    const link = H.normLink({ $axf: H.FRAMES.link, project: doc.project, sessions: Object.fromEntries((doc.sessions ?? []).map((x) => [x.id, { ...x, lastSeenAt: x.lastSeenAt || doc.writtenAt }])), claims: Object.fromEntries((doc.claims ?? []).map((c) => [c.id, c])), primary: doc.primary, settings: { enforce: true } });
    const r = H.checkPaths(link, s.id, paths, doc.writtenAt);
    return { ...r, session: s.id, why: r.ok ? 'every file is inside the session\'s claims' : `files outside ${s.agent || s.id}'s claims` };
  }
  const link = readLink(); const settings = H.settingsOf(link); const now = nowIso(); const sid = session || me({ create: false }).session;
  const others = Object.values(link.sessions).filter((s) => s.id !== sid && !s.endedAt && H.sessionStatus(s, now, settings) !== 'offline');
  if (!settings.enforce || !env('AXF_SESSION_SYNC_ON', '1') || env('AXF_SESSION_SYNC_ON') === '0') return { ok: true, enforce: false, outside: [], claimedBy: [], why: 'claims are not enforced (plugin off or enforce: false): builds run unrestricted' };
  if (!others.length) return { ok: true, enforce: true, outside: [], claimedBy: [], why: 'no other live session: nothing to clash with' };
  const r = H.checkPaths(link, sid, paths, now);
  return { ...r, session: sid, why: r.ok ? 'every file is inside this session\'s claims' : `${r.outside.length} file(s) outside this session's claims${r.claimedBy.length ? `, ${r.claimedBy.length} held by another session` : ''}: claim first (session-sync claim --paths …)` };
}
/** Every place that tracks a handover agrees with the link (the link wins); `fix` applies the patches. */
export function consistency({ fix = false } = {}) {
  const link = readLink(); const builds = allBuildsNow();
  const patches = H.assignmentPatches(builds, link);
  const missingChildren = Object.values(link.assignments).filter((a) => a.parent && ['queued', 'working', 'held', 'blocked'].includes(a.status) && !builds.some((b) => b.id === a.build)).map((a) => a.build);
  const staleStore = builds.filter((b) => b.assignedTo && !H.assignmentsOf(link, b.id).length).map((b) => b.id);
  const drift = patches.length + missingChildren.length + staleStore.length;
  let fixed = null;
  if (fix && drift) fixed = syncStore(link);
  return { ok: drift === 0 || fixed?.ok === true, drift, patches: patches.map((p) => p.id), missingChildren, staleStore, fixed };
}

/* ------------------------------------------------------------------ the Claude Code hook */

const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
export function hookHandle(ev) {
  const name = String(ev?.hook_event_name ?? '');
  const my = me();
  const link = readLink(); const settings = H.settingsOf(link); const now = nowIso();
  const on = env('AXF_SESSION_SYNC_ON', '1') !== '0';
  if (!on) return { stdout: name === 'SessionStart' ? 'Session sync is off: claims are not enforced, builds run unrestricted.' : '' };
  if (name === 'SessionStart') {
    const doc = readSyncFile();
    const joined = runOp('join', {}, { ...my, brett: false });
    const lines = [`Session sync: you are ${my.agent || my.session} (${my.account}), ${joined.role ?? 'secondary'}${joined.becamePrimary ? ' — first in, you own the orchestrator' : ''}${joined.needsApproval ? ' — this account waits for Brett\'s approval before it can claim or take work' : ''}.`];
    if (doc) lines.push(`Sync file ${syncPaths(doc.project).relMd} (${H.isFresh(doc, now) ? 'fresh' : 'stale: run /sync to refresh'}): ${doc.sessions?.length ?? 0} session(s) on, ${doc.claims?.length ?? 0} claim(s), ${doc.work?.running?.length ?? 0} running, ${doc.work?.queued?.length ?? 0} queued. Read it before touching anything.`);
    else lines.push(`No sync file yet (${SYNC_DIR}/): run /sync ${projectName()} to write it.`);
    lines.push(`Claim an area before editing (session-sync claim --area <name> | --paths <globs>); talk in the Breakroom's Sessions channel (session-sync send "…"); unread lines arrive here at your next step.`);
    return { stdout: lines.join('\n') };
  }
  if (name === 'SessionEnd' || name === 'Stop') { if (name === 'SessionEnd' && link.sessions[my.session]) runOp('end', { summary: env('AXF_SESSION_SUMMARY') }, { ...my, brett: false }); return { stdout: '' }; }
  if (!link.sessions[my.session]) return { stdout: '' };
  const doing = { build: env('AXF_BUILD') || link.sessions[my.session].doing.build, step: env('AXF_STEP') || link.sessions[my.session].doing.step, note: link.sessions[my.session].doing.note };
  const inbox = runOp('inbox', {}, { ...my, brett: false }); runOp('heartbeat', { doing }, { ...my, brett: false });
  const unread = (inbox.lines ?? []).map((l) => `- ${l.at.slice(11, 16)} ${l.text}`);
  const offers = (inbox.offers ?? []).map((o) => `- offer ${o.id}: ${o.build}${o.steps ? ` steps ${o.steps.join(', ')}` : ''} — ${o.reason} (session-sync respond ${o.id} accept|reject|hold --reason …)`);
  const context = [unread.length ? `Sessions channel (${unread.length} new):\n${unread.join('\n')}` : '', offers.length ? `Work offered to you:\n${offers.join('\n')}` : ''].filter(Boolean).join('\n');
  if (name === 'UserPromptSubmit') return { stdout: context };
  if (name === 'PreToolUse') {
    const tool = String(ev?.tool_name ?? ''); const file = String(ev?.tool_input?.file_path ?? ev?.tool_input?.notebook_path ?? '');
    const out = {};
    if (context) out.hookSpecificOutput = { hookEventName: 'PreToolUse', additionalContext: context };
    if (EDIT_TOOLS.test(tool) && file && settings.enforce) {
      const rel = file.startsWith(REPO_ROOT) ? file.slice(REPO_ROOT.length + 1) : file;
      const others = Object.values(link.sessions).filter((s) => s.id !== my.session && !s.endedAt && H.sessionStatus(s, now, settings) !== 'offline');
      if (others.length && !rel.startsWith('/')) {
        const r = H.checkPaths(link, my.session, [rel], now);
        if (!r.ok) { const by = r.claimedBy[0]; out.decision = 'block'; out.reason = by ? `${rel} is claimed by ${by.agent || by.session} (claim ${by.claim}). Wait, ask over the Sessions channel (session-sync send), or take another task.` : `${rel} is outside your claims. Claim it first: session-sync claim --paths "${dirname(rel)}/**" --reason "…" (another session is live, so claims are enforced).`; }
      }
    }
    return { stdout: Object.keys(out).length ? JSON.stringify(out) : '' };
  }
  return { stdout: '' };
}
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'SessionEnd'];
export const SCRIPT = fileURLToPath(import.meta.url);
export const claudeSettings = () => join(homedir(), '.claude', 'settings.json');
export function hookConfig(script = SCRIPT) { return Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ ...(e === 'PreToolUse' ? { matcher: 'Edit|Write|MultiEdit|NotebookEdit' } : {}), hooks: [{ type: 'command', command: `node "${script}" hook`, timeout: 20 }] }]])); }
export function installHooks(file = claudeSettings(), script = SCRIPT) {
  const s = readJson(file, {}); s.hooks = s.hooks && typeof s.hooks === 'object' ? s.hooks : {};
  const mine = (h) => (h?.hooks ?? []).some((x) => String(x?.command ?? '').includes(`${FOLDER}/sync.mjs`) || String(x?.command ?? '').includes(script));
  for (const [e, defs] of Object.entries(hookConfig(script))) s.hooks[e] = [...(Array.isArray(s.hooks[e]) ? s.hooks[e] : []).filter((h) => !mine(h)), ...defs];
  writeJsonAtomic(file, s); return { ok: true, file, events: HOOK_EVENTS };
}
export function removeHooks(file = claudeSettings()) {
  const s = readJson(file, null); if (!s?.hooks) return { ok: true, file, removed: 0 }; let removed = 0;
  for (const e of Object.keys(s.hooks)) { const before = s.hooks[e].length; s.hooks[e] = s.hooks[e].filter((h) => !(h?.hooks ?? []).some((x) => String(x?.command ?? '').includes(`${FOLDER}/sync.mjs`))); removed += before - s.hooks[e].length; if (!s.hooks[e].length) delete s.hooks[e]; }
  writeJsonAtomic(file, s); return { ok: true, file, removed };
}
export function hooksStatus(file = claudeSettings()) { const s = readJson(file, {}); const on = HOOK_EVENTS.filter((e) => (s.hooks?.[e] ?? []).some((h) => (h?.hooks ?? []).some((x) => String(x?.command ?? '').includes(`${FOLDER}/sync.mjs`)))); return { ok: true, file, installed: on.length === HOOK_EVENTS.length, events: on }; }

/* ------------------------------------------------------------------ CLI */

function parse(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v !== undefined && !v.startsWith('--')) { opt[k] = v; i++; } else opt[k] = true; } else pos.push(a); }
  return { pos, opt };
}
const fmt = (r, text) => { if (process.argv.includes('--json')) console.log(JSON.stringify(r)); else console.log(text ?? JSON.stringify(r, null, 1)); return r?.ok === false ? 1 : 0; };
export async function main(argv = process.argv.slice(2)) {
  const { pos, opt } = parse(argv.filter((a) => a !== '--json'));
  const [cmd, ...rest] = pos;
  const my = me();
  if (!cmd || cmd === 'help') { console.log(readFileSync(SCRIPT, 'utf8').split('\n').slice(1, 32).map((l) => l.replace(/^ \*\s?/, '')).join('\n')); return 0; }
  if (cmd === 'op') { const who = env('AXF_SESSION_SYNC_CALLER') ? JSON.parse(env('AXF_SESSION_SYNC_CALLER')) : null; const r = runOp(rest[0], rest[1] ? JSON.parse(rest[1]) : {}, who); console.log(JSON.stringify(r)); return r.ok === false ? 1 : 0; }
  if (cmd === 'sync') {
    const project = rest[0] && !/^(ses|session)$/i.test(rest[0]) ? rest[0] : projectName();
    if (project !== projectName()) return fmt({ ok: false, message: `this checkout is ${projectName()}, not ${project}: run /sync in that project` });
    if (!readLink().sessions[my.session]) runOp('join', { agent: my.agent }, my);
    const r = runOp('sync', { publish: !opt['no-publish'] }, my);
    return fmt(r, r.ok ? `wrote ${r.path} + ${r.md} (${r.sessions} session(s), ${r.claims} claim(s))${r.published ? r.published.ok ? ` · on main ${r.published.sha ? r.published.sha.slice(0, 8) : '(unchanged)'}` : ` · not on main: ${r.published.error}` : ''}` : r.message);
  }
  if (cmd === 'join') { const r = runOp('join', { agent: opt.agent || my.agent, client: opt.client }, { ...my, account: opt.account || my.account, session: opt.session || my.session, agent: opt.agent || my.agent }); return fmt(r, r.ok ? `joined as ${r.session.agent || r.session.id} (${r.role}${r.becamePrimary ? ', primary: you own the orchestrator' : ''}${r.needsApproval ? '; waiting for Brett to approve this account' : ''})` : r.message); }
  if (cmd === 'status' || cmd === 'state') { const r = runOp('state', { for: opt.for || '' }, my); if (!r.ok) return fmt(r, r.message); const lines = r.sessions.map((s) => `${s.role === 'primary' ? '★' : '·'} ${s.agent || s.id} (${s.account}) ${s.status}${s.doing.build ? `: ${s.doing.build} ${s.doing.step}` : ''}`); return fmt(r, `${r.project} rev ${r.rev} · primary ${r.primary?.agent || r.primary?.session || 'none'}${r.scoped ? ' · managed by orchestrator' : ''}\n${lines.join('\n') || 'nobody on'}\nclaims: ${r.claims.map((c) => `${c.session}:${c.kind === 'area' ? c.area : c.paths.join(',')}`).join(' ') || 'none'}\noffers: ${r.offers.length} · assignments: ${r.assignments.length}`); }
  if (cmd === 'snapshot') return fmt(runOp('snapshot', {}, my));
  if (cmd === 'heartbeat') { const pause = opt.resume ? null : opt.pause ? { reason: String(opt.pause), until: opt.until || '' } : undefined; return fmt(runOp('heartbeat', { doing: { build: opt.build, step: opt.step, note: opt.note }, ...(pause !== undefined ? { pause } : {}) }, my)); }
  if (cmd === 'claim') { const r = runOp('claim', { kind: opt.area ? 'area' : 'path', area: opt.area, paths: list(opt.paths), reason: opt.reason, build: opt.build, step: opt.step, ttlSec: opt.ttl ? Number(opt.ttl) : undefined }, my); return fmt(r, r.ok ? `claimed ${r.claim.id} until ${r.claim.expiresAt}${r.renewed ? ' (renewed)' : ''}` : r.code === 'claimed' ? `claimed by ${r.by.agent || r.by.session} until ${r.until}: wait, ask over the channel, or take another task` : r.message); }
  if (cmd === 'release') return fmt(runOp('release', { claim: opt.claim }, my));
  if (cmd === 'send') return fmt(runOp('send', { text: rest.join(' '), kind: opt.kind, build: opt.build, step: opt.step, files: list(opt.files) }, my));
  if (cmd === 'inbox') { const r = runOp('inbox', { peek: !!opt.peek }, my); return fmt(r, r.ok ? [...r.lines.map((l) => `${l.at.slice(11, 16)} ${l.text}`), ...r.offers.map((o) => `offer ${o.id}: ${o.build}${o.steps ? ` ${o.steps.join(',')}` : ''} — ${o.reason}`)].join('\n') || 'nothing new' : r.message); }
  if (cmd === 'request-work') return fmt(runOp('request-work', { minutes: opt.minutes, areas: list(opt.areas), model: opt.model, max: opt.max }, my));
  if (cmd === 'offer') return fmt(runOp('offer', { build: rest[0], steps: list(opt.steps), to: opt.to, reason: opt.reason }, my));
  if (cmd === 'offers') return fmt(runOp('offers', {}, my));
  if (cmd === 'respond') return fmt(runOp('respond', { id: rest[0], response: rest[1], reason: opt.reason, backAt: opt.back }, my));
  if (cmd === 'step') return fmt(runOp('step', { assignment: rest[0], step: rest[1], state: rest[2], reason: opt.reason }, my));
  if (cmd === 'take-back') return fmt(runOp('take-back', { assignment: readLink().assignments[rest[0]] ? rest[0] : '', build: readLink().assignments[rest[0]] ? '' : rest[0], steps: list(opt.steps), confirm: !!opt.confirm, reason: opt.reason }, my));
  if (cmd === 'undo') return fmt(runOp('undo', { seq: Number(rest[0]) }, my));
  if (cmd === 'replan') { const r = runOp('replan', { dryRun: !!opt['dry-run'], profile: opt.profile }, my); return fmt(r, r.ok ? `${r.dryRun ? 'would move' : 'moved'}: ${r.summary.join('; ') || 'nothing'}\norder: ${r.order.join(' > ')}` : r.message); }
  if (cmd === 'claim-job') return fmt(runOp('claim-job', { id: rest[0], title: rest.join(' '), branch: opt.branch || my.branch }, my));
  if (cmd === 'end') return fmt(runOp('end', { summary: opt.summary || rest.join(' ') }, my));
  if (cmd === 'approve-account') return fmt(runOp('approve-account', { account: rest[0] }, my));
  if (cmd === 'settings') return fmt(runOp('settings', rest[0] ? { [rest[0]]: rest[1] === 'true' ? true : rest[1] === 'false' ? false : Number.isFinite(Number(rest[1])) && rest[1] !== '' ? Number(rest[1]) : rest[1] } : {}, my));
  if (cmd === 'make-primary') return fmt(runOp('make-primary', { session: rest[0] }, my));
  if (cmd === 'consistency') { const r = consistency({ fix: !!opt.fix }); return fmt(r, r.drift ? `${r.drift} place(s) disagree with the link${r.fixed ? ` → fixed ${r.fixed.changed.length}` : ' (run with --fix)'}` : 'every store agrees with the link'); }
  if (cmd === 'check-commit') { const r = checkCommit({ staged: !!opt.staged, range: opt.range || '', files: list(opt.files), ci: !!opt.ci, session: opt.session || '' }); return fmt(r, r.ok ? `ok: ${r.why}` : `${r.why}\n${r.outside.map((p) => `  ${p}${r.claimedBy.find((c) => c.path === p) ? ` (held by ${r.claimedBy.find((c) => c.path === p).agent || r.claimedBy.find((c) => c.path === p).session})` : ''}`).join('\n')}`); }
  if (cmd === 'hook') { let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ } let ev = {}; try { ev = JSON.parse(raw || '{}'); } catch { ev = {}; } const r = hookHandle(ev); if (r.stdout) process.stdout.write(r.stdout); return 0; }
  if (cmd === 'hook-config') { console.log(JSON.stringify({ hooks: hookConfig() }, null, 2)); return 0; }
  if (cmd === 'hooks') { const r = rest[0] === 'install' ? installHooks(opt.settings) : rest[0] === 'remove' ? removeHooks(opt.settings) : hooksStatus(opt.settings); return fmt(r); }
  if (cmd === 'events') return fmt(runOp('events', { after: opt.after }, my));
  if (cmd === 'creds-init') return fmt(creds.initKeys(), 'sealing key ready');
  if (cmd === 'pair') { const r = pairLink(my); return fmt(r, r.ok ? `Open this once, signed in, and paste the token from \`claude setup-token\` there (never here, never in chat):\n${r.url}\nIt works for 10 minutes.` : r.message); }
  if (cmd === 'pair-ingest') { let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ } const r = await pairIngest(raw); console.log(JSON.stringify(r)); return r.ok ? 0 : 1; }
  if (cmd === 'launch-gate') { const r = launchGate({ build: opt.build || rest[0] || '', step: opt.step || '', wantEnv: !!opt.env }); if (r.env) { process.stdout.write(r.env); return 0; } if (r.ok) { if (!opt.env) console.log(r.owner === 'helper' ? `helper ${r.account}` : 'main'); return 0; } console.log(r.reason); return 4; }
  if (cmd === 'token-limited') { const account = String(opt.account || my.account); return fmt(runOp('account-report', { limited: { resetsAt: opt.resets || '' } }, { session: my.session, account, brett: false })); }
  if (cmd === 'token-revoke') return fmt(revokeToken(rest[0] || '', my));
  if (cmd === 'check-models') { const r = await checkModels(list(opt.models).length ? list(opt.models) : ['opus', 'fable'], my); return fmt(r, r.ok ? Object.entries(r.can).map(([m, ok]) => `${m}: ${ok ? 'yes' : 'no'}`).join(', ') || 'nothing could be checked' : r.message); }
  if (cmd === 'desk-sweep') return fmt(runOp('desk-sweep', {}, my));
  if (cmd === 'where') return fmt({ ok: true, link: linkFile(), me: meFile(), sync: syncPaths().json, consoleRoot: consoleRoot() });
  return fmt({ ok: false, message: `unknown command ${cmd}` });
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1); });
