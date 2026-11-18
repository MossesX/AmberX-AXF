#!/usr/bin/env node
/**
 * auto-lander — the server runner of the auto-lander rule (auto-lander@1, framework/spec/AUTO-LANDER.md).
 *
 * Brett, Nov 16 2026: "We need the auto lander to bang shit out on its own. It needs to automatically fix it. We need a
 * server rule to do that. Make the server do it automatically without the console."
 *
 * Runs on the VPS host (deploy/systemd/axf-auto-lander.timer, every minute), never in the console. One tick:
 *   1. takes the one lock (<data>/auto-lander.lock; a second tick while one runs does nothing);
 *   2. reads the policy: the `auto-lander` gate rule's settings (gate-rules@1) with this runner's own settings on top;
 *   3. takes the finished builds from the orchestrator (builds store: status built, plus every build it is still
 *      fixing), one at a time, in the order they were built;
 *   4. for each: reads its PR as a pr-snapshot@1 (GitHub through the landing line's ETag-cached client: draft, fork,
 *      mergeable, CI on the head; UI Review and hand holds from the landing line's land.json), reconciles what happened
 *      since the last tick (reconcile.mjs: fix sessions that ended, lands that went through or were kicked out), asks
 *      decide() what to do and does it:
 *        merge-main   merge-main.mjs (a hand-written clash comes back `needs-fix` and goes straight to a fix session)
 *        fix-session  ci-status.mjs summary → fix-session.mjs (through the orchestrator pipeline)
 *        land         the merge queue: `land.mjs queue add <pr>`, the only way anything merges
 *        escalate     the build stops; escalate.mjs puts a systems-check item up and sends one push
 *        wait / none  nothing, the reason is recorded
 *   5. writes the state (<data>/auto-lander/state.json, auto-lander-state@1) the console, CLI, MCP and voice read.
 *
 *   node deploy/auto-lander/auto-lander.mjs tick [--dry-run] [--only <build>] [--json]   one tick
 *   … daemon [--every <sec>]          tick forever (default 60 s); SIGTERM ends it after the current tick
 *   … status [--json]                 service, current build, queue, per-build state and attempts
 *   … run [--request]                 one tick now (same as tick); --request asks the service for one (the console's way)
 *   … show <build>                    one build: its record and every attempt
 *   … retry <build> [--by who]        reset its attempts and escalation; the next tick tries again at once
 *   … fix <build> [--by who]          retry + start a fix session now (the escalation item's Fix button)
 *   … pause [--by who] | resume [--by who]
 *   … settings [--json] | set <key> <value> [--by who]   enabled, maxAttempts, backoffBaseMin, backoffFactor,
 *                                     backoffMaxMin, attemptTimeoutMin, pushOnEscalation
 * Environment: AXF_AUTO_LANDER_DIR (data folder), AXF_LAND_REPO (checkout), AXF_LAND_REPO_SLUG, AXF_PUSH_BANNER_DIR.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as AL from '../../framework/core/auto-lander.mjs';
import * as attempts from './attempts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../..');
export const LAND_CLI = join(REPO_ROOT, 'apps/console-web/plugins/push-banner/land/land.mjs'); // axf-plugin:push-banner
export const LOCK_STALE_MS = 30 * 60e3;
export const SETTINGS_DEFAULTS = Object.freeze({ enabled: true, maxAttempts: 3, backoffBaseMin: 5, backoffFactor: 3, backoffMaxMin: 60, attemptTimeoutMin: 45, pushOnEscalation: true });
export const SETTING_KEYS = Object.freeze(Object.keys(SETTINGS_DEFAULTS));

// ------------------------------------------------------------------ files

export const files = () => { const d = attempts.dataDir(); return { dir: d, state: join(d, 'state.json'), control: join(d, 'control.json'), lock: join(d, 'auto-lander.lock'), service: join(d, 'service.json') }; };
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }
const nowIso = () => new Date().toISOString();

/** The state (auto-lander-state@1) with the runner's extras kept: current, queue, paused and each build's `last`. */
export function readState() {
  const raw = readJson(files().state, null) || AL.emptyState();
  const n = AL.normState(raw);
  const last = new Map((Array.isArray(raw.builds) ? raw.builds : []).map((b) => [b?.build, b?.last || null]));
  return { ...n, current: String(raw.current || ''), queue: Array.isArray(raw.queue) ? raw.queue : [], paused: raw.paused === true, builds: n.builds.map((b) => ({ ...b, last: last.get(b.build) || null })) };
}
/** One build put into the state (normalised; extras kept). */
export function putBuild(state, b, at = nowIso()) {
  const nb = { ...AL.normBuild(b, at), last: b.last || null };
  const i = state.builds.findIndex((x) => x.build === nb.build);
  return { ...state, at, builds: i >= 0 ? state.builds.map((x, k) => (k === i ? nb : x)) : [...state.builds, nb].slice(-AL.BUILDS_MAX) };
}
export const writeState = (s) => writeJson(files().state, s);
/** The runner's control: { paused, pausedBy, pausedAt, settings: {…}, resets: { build: at } }. */
export function readControl() {
  const c = readJson(files().control, {}) || {};
  return { runRequested: String(c.runRequested || ''), paused: c.paused === true, pausedBy: String(c.pausedBy || ''), pausedAt: String(c.pausedAt || ''), settings: { ...SETTINGS_DEFAULTS, ...(c.settings || {}) }, resets: c.resets || {}, fixNow: Array.isArray(c.fixNow) ? c.fixNow : [] };
}
const writeControl = (c) => writeJson(files().control, { $axf: 'auto-lander-control@1', ...c });

/** The one lock: { ok, release } (a dead or stale holder is replaced). */
export function takeLock(f = files().lock, now = Date.now()) {
  mkdirSync(dirname(f), { recursive: true });
  const tryOpen = () => { try { const fd = openSync(f, 'wx'); writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() })); closeSync(fd); return true; } catch { return false; } };
  if (!tryOpen()) {
    const h = readJson(f, {}) || {};
    let alive = false; try { process.kill(h.pid, 0); alive = true; } catch { alive = false; }
    let age = Infinity; try { age = now - statSync(f).mtimeMs; } catch { /* gone */ }
    if (alive && age < LOCK_STALE_MS) return { ok: false, holder: h };
    rmSync(f, { force: true });
    if (!tryOpen()) return { ok: false, holder: readJson(f, {}) };
  }
  return { ok: true, release: () => { const h = readJson(f, {}); if (h?.pid === process.pid) rmSync(f, { force: true }); } };
}

// ------------------------------------------------------------------ policy and settings

/** The policy: the gate rule's settings with the runner's own settings on top. */
export function policyFrom(ruleSet, settings = readControl().settings) {
  const base = AL.policyFromRules(ruleSet);
  const s = { ...SETTINGS_DEFAULTS, ...settings };
  return AL.normPolicy({ ...base, enabled: base.enabled && s.enabled !== false, maxAttempts: s.maxAttempts ?? base.maxAttempts, attemptTimeoutMin: s.attemptTimeoutMin ?? base.attemptTimeoutMin, backoff: { baseMin: s.backoffBaseMin ?? base.backoff.baseMin, factor: s.backoffFactor ?? base.backoff.factor, maxMin: s.backoffMaxMin ?? base.backoff.maxMin } });
}

/** One setting changed (validated). */
export function setSetting(key, value, { by = 'cli' } = {}) {
  if (!SETTING_KEYS.includes(key)) throw Object.assign(new Error(`unknown setting ${key} (${SETTING_KEYS.join(', ')})`), { code: 'invalid' });
  const d = SETTINGS_DEFAULTS[key];
  let v = value;
  if (typeof d === 'boolean') { v = value === true || value === 'true' || value === 'on' || value === '1' ? true : value === false || value === 'false' || value === 'off' || value === '0' ? false : null; if (v === null) throw Object.assign(new Error(`${key} is on or off`), { code: 'invalid' }); }
  else { v = Number(value); if (!Number.isFinite(v) || v <= 0) throw Object.assign(new Error(`${key} is a number above 0`), { code: 'invalid' }); if (key === 'maxAttempts' && (!Number.isInteger(v) || v < 1 || v > 10)) throw Object.assign(new Error('maxAttempts is 1..10'), { code: 'invalid' }); }
  const c = readControl();
  writeControl({ ...c, settings: { ...c.settings, [key]: v }, settingsBy: by, settingsAt: nowIso() });
  return readControl().settings;
}

export function pause({ by = 'cli' } = {}) { const c = readControl(); writeControl({ ...c, paused: true, pausedBy: by, pausedAt: nowIso() }); return readControl(); }
export function resume({ by = 'cli' } = {}) { const c = readControl(); writeControl({ ...c, paused: false, pausedBy: by, pausedAt: nowIso() }); return readControl(); }

/** A hand reset: attempts skipped, escalation cleared; `fix` = a fix session is started on the next tick whatever CI says. */
export async function retry(build, { by = 'cli', fix = false, at = nowIso(), resolveEscalation = null } = {}) {
  if (!build) throw Object.assign(new Error('retry <build>'), { code: 'invalid' });
  const n = attempts.reset(build, { by, at });
  const st = readState(); const rec = st.builds.find((b) => b.build === build);
  if (rec) writeState(putBuild(st, { ...AL.resetEscalation(rec, { at, by }), attempts: attempts.list(build).slice(-AL.ATTEMPTS_MAX), state: 'waiting', escalation: null, reason: `Reset by ${by}: the lander tries again.` }, at));
  const c = readControl();
  writeControl({ ...c, resets: { ...c.resets, [build]: at }, fixNow: fix ? [...new Set([...c.fixNow, build])] : c.fixNow });
  // the banner item clears on the next status read; the phone alert resolves now
  const res = resolveEscalation || (await import('./escalate.mjs')).resolve;
  try { await res({ build }); } catch { /* the alert resolves on the next landing */ }
  return { ok: true, build, reset: n, fix };
}

// ------------------------------------------------------------------ the world (real dependencies)

const prNum = (v) => { const n = Number(String(v ?? '').replace(/^#/, '')); return Number.isInteger(n) && n > 0 ? n : 0; };

/** The real dependencies, loaded on first use (tests pass their own). */
export async function realDeps() {
  const land = await import('../../apps/console-web/plugins/push-banner/land/land.mjs'); // axf-plugin:push-banner
  const { loadStore } = await import('../../framework/cli/builds-store.mjs');
  const { createStore } = await import('../../apps/console-web/plugins/gate/gate-store.mjs'); // axf-plugin:gate
  const { ciStatus } = await import('./ci-status.mjs');
  const { mergeMainFor } = await import('./merge-main.mjs');
  const { launchFix } = await import('./fix-session.mjs');
  const esc = await import('./escalate.mjs').catch(() => null);
  const s = land.settings();
  const gh = land.makeGitHub(s);
  return {
    s, gh,
    builds: () => loadStore().builds.filter((b) => !b.deleted),
    ruleSet: () => { try { return createStore().readRules(); } catch { return null; } },
    landState: () => ({ land: land.readState(s), control: land.readControl(s) }),
    ciStatus: (o) => ciStatus({ ...o, gh, s }),
    mergeMain: (o) => mergeMainFor(o),
    launchFix: (o) => launchFix(o),
    queueAdd: (n) => { const r = spawnSync(process.execPath, [LAND_CLI, 'queue', 'add', String(n), '--json'], { encoding: 'utf8', timeout: 120000 }); return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-600) }; },
    live: async (id) => { const lock = await import('../../framework/cli/build-lock.mjs'); return lock.liveness(id, { dir: join(process.env.AXF_PIPELINE_WORKTREES || '/root/axf-builds', id) }); },
    startCi: ({ branch }) => gh('POST', `/repos/${s.slug}/actions/workflows/${s.workflow}/dispatches`, { ref: branch }),
    escalate: esc?.escalate || (() => ({ ok: false, why: 'escalate.mjs not installed' })),
    resolveEscalation: esc?.resolve || (() => ({ ok: false })),
    flushEscalations: esc?.flush || (() => ({ ok: true })),
  };
}

/** Which builds the lander looks at, oldest finished first: Built (awaiting merge) + every one it is still fixing. */
export function candidates(builds, state, { only = '' } = {}) {
  const tracked = new Map(state.builds.map((b) => [b.build, b]));
  const out = builds.filter((b) => b.branch && !b.hidden && b.status !== 'archived' && (b.status === 'built' || (tracked.has(b.id) && !AL.TERMINAL.includes(tracked.get(b.id).state) && ['queued', 'running', 'built'].includes(b.status))))
    .filter((b) => !only || b.id === only);
  return out.sort((a, b) => String(a.builtAt || a.updatedAt || '').localeCompare(String(b.builtAt || b.updatedAt || '')) || a.id.localeCompare(b.id));
}

/** The PR of a build as pr-snapshot@1 (+ merged, pull). */
export async function snapshotFor(b, d, ctx) {
  let n = prNum(b.pr);
  if (!n) {
    ctx.pulls ??= await d.gh('GET', `/repos/${d.s.slug}/pulls?state=open&per_page=100`).catch(() => []);
    const p = (Array.isArray(ctx.pulls) ? ctx.pulls : []).find((x) => x?.head?.ref === b.branch && x?.base?.ref === (d.s.base || 'main'));
    n = p?.number || 0;
  }
  if (!n) return { number: 0, branch: b.branch, build: b.id };
  const p = await d.gh('GET', `/repos/${d.s.slug}/pulls/${n}`);
  const merged = !!p?.merged_at || p?.merged === true;
  const head = p?.head?.sha || '';
  const fork = !!p?.head?.repo?.full_name && p.head.repo.full_name.toLowerCase() !== String(d.s.slug).toLowerCase();
  const closed = p?.state === 'closed' && !merged;
  const ci = merged || closed || !head ? { ci: 'none', jobs: [], text: '' } : await d.ciStatus({ head, branch: b.branch, pr: n });
  const li = (ctx.land?.land?.items || []).find((x) => x.id === b.id || x.pr === n) || {};
  const hold = ctx.land?.control?.holds?.[b.id];
  return {
    number: n, title: p?.title || b.title || '', build: b.id, branch: b.branch, head, draft: p?.draft === true, fork, merged, closed,
    ci: ci.ci, failing: (ci.jobs || []).map((j) => j.job), summary: ci.text || '',
    conflicts: p?.mergeable_state === 'dirty' || p?.mergeable === false ? ['code'] : [],
    ui: li?.reason?.kind === 'ui' ? 'waiting' : '', landHeld: hold ? String(hold.why || 'by hand') : closed ? 'the PR is closed' : '',
  };
}

// ------------------------------------------------------------------ one build

/** One build: reconcile, decide, act. Returns the new auto-lander-build@1. */
export async function stepBuild(b, d, ctx, { policy, dry = false, at = nowIso(), log = () => {} } = {}) {
  const prev = ctx.state.builds.find((x) => x.build === b.id) || AL.normBuild({ build: b.id, branch: b.branch, state: 'waiting', since: at }, at);
  const snap = await snapshotFor(b, d, ctx);
  let rec = { ...prev, pr: snap.number || prev.pr, branch: b.branch, head: snap.head || prev.head };
  if (ctx.reconcile) rec = await ctx.reconcile(rec, b, snap, d, { policy, at, dry, log }) || rec;
  rec.attempts = attempts.list(b.id).slice(-AL.ATTEMPTS_MAX);
  // a hand Fix: start a fix session now, whatever CI says
  const fixNow = ctx.control.fixNow.includes(b.id);
  let act = AL.decide(rec, snap, rec.attempts, policy, { at });
  if (fixNow && act.action !== 'none' && !(act.action === 'wait' && act.waitReason === 'in-flight')) act = { ...act, action: 'fix-session', state: 'fixing', kind: 'red-ci', attempt: AL.failuresOf(rec.attempts, 'red-ci', policy, at).length + 1, reason: 'Fix pressed: a fix session starts now.' };
  if (fixNow) ctx.fixed.push(b.id);
  log(`${b.id}: ${act.action}${act.waitReason ? ` (${act.waitReason})` : ''} — ${act.reason}`);
  if (dry) return { ...AL.apply({ ...rec, attempts: [] }, { ...act, action: act.action in AL.ACTION_KIND ? 'wait' : act.action }, { at }), attempts: rec.attempts, last: act };

  let reason = act.reason; let state = act.state;
  if (act.action === 'merge-main') {
    const r = await d.mergeMain({ build: b.id, branch: b.branch, pr: rec.pr, now: () => at });
    if (r.status === 'merged' || r.status === 'up-to-date') { state = 'ci-running'; reason = r.status === 'merged' ? `Merged main in (${r.sha.slice(0, 9)}); CI runs on the new head.` : 'Already has main; waiting for GitHub to see it.'; }
    else if (r.status === 'needs-fix') {
      const f = await d.launchFix({ id: b.id, head: snap.head, now: () => at, summary: `Merging main into ${b.branch} clashes in hand-written files:\n${r.conflicts.map((c) => `- ${c}`).join('\n')}\nMerge origin/main into the branch and resolve them by hand.` });
      state = f.status === 'launched' || f.status === 'running' || f.status === 'queued' ? 'fixing' : 'waiting';
      reason = `Main clashes in ${r.conflicts.slice(0, 3).join(', ')}: ${f.status === 'launched' ? `fix session on ${f.account}` : f.why || f.status}.`;
    } else { state = 'waiting'; reason = `Merging main failed: ${String(r.error || r.log || '').split('\n').pop()}`; }
  } else if (act.action === 'fix-session') {
    const f = await d.launchFix({ id: b.id, head: snap.head, now: () => at, summary: snap.summary || `CI is red on ${snap.head.slice(0, 9)}${snap.failing.length ? `: ${snap.failing.join(', ')}` : ''}.`, n: act.attempt });
    state = ['launched', 'running', 'queued'].includes(f.status) ? 'fixing' : 'waiting';
    reason = f.status === 'launched' ? `CI is red: fix attempt ${act.attempt} runs on ${f.account} (${f.session || 'starting'}).` : f.status === 'queued' ? `CI is red: fix attempt ${act.attempt} is Queued (${f.why}).` : f.status === 'running' ? `A fix session already runs: ${f.why}` : `Couldn't start a fix session: ${f.why}`;
  } else if (act.action === 'land') {
    const a = attempts.start(b.id, 'land', { n: act.attempt, branch: b.branch, head: snap.head, pr: snap.number, account: 'merge-queue', at });
    const q = await d.queueAdd(snap.number);
    if (q.ok) { state = 'landing'; reason = `CI is green: PR #${snap.number} is in the merge queue.`; }
    else { attempts.end(a, 'failed', { log: q.out, at }); state = 'waiting'; reason = `Couldn't add PR #${snap.number} to the merge queue: ${q.out.split('\n').pop()}`; }
  } else if (act.action === 'escalate') {
    const last = rec.attempts.filter((x) => x.kind === act.kind).slice(-1)[0];
    const e = await d.escalate({ build: b.id, title: b.title || b.id, kind: act.kind, attempts: act.attempt, why: act.reason, since: rec.attempts.find((x) => x.kind === act.kind)?.at || at, log: last?.log || '', pr: snap.number, policy, push: ctx.control.settings.pushOnEscalation !== false && policy.escalateTo === 'banner', banner: policy.escalateTo === 'banner' });
    if (e?.ok === false && e.why) log(`${b.id}: escalation: ${e.why}`);
  } else if (act.action === 'none' && act.state === 'landed' && prev.state !== 'landed') {
    const open = rec.attempts.filter((x) => x.kind === 'land' && x.result === 'started').slice(-1)[0];
    if (open) attempts.end(open, 'ok', { log: `PR #${snap.number} merged.`, at });
    else attempts.record(b.id, 'land', 'ok', { pr: snap.number, head: snap.head, branch: b.branch, account: 'merge-queue', at, log: `PR #${snap.number} merged.` });
    if (prev.state === 'escalated' || prev.escalation) await d.resolveEscalation?.({ build: b.id });
  }
  const next = AL.apply({ ...rec, attempts: [] }, { ...act, action: AL.ACTION_KIND[act.action] ? 'wait' : act.action, state, reason }, { at });
  return { ...next, attempts: attempts.list(b.id).slice(-AL.ATTEMPTS_MAX), last: { action: act.action, waitReason: act.waitReason, notBefore: act.notBefore, at } };
}

// ------------------------------------------------------------------ one tick

/** One tick. Returns the state document written (plus { skipped } when another tick holds the lock). */
export async function tick({ deps = null, dry = false, only = '', log = () => {}, now = nowIso, reconcile = null } = {}) {
  const at = now();
  const lk = takeLock();
  if (!lk.ok) return { skipped: `another tick runs (pid ${lk.holder?.pid || '?'})` };
  try {
    const d = deps || await realDeps();
    const control = readControl();
    const policy = policyFrom(d.ruleSet(), control.settings);
    let state = { ...readState(), policy };
    const svc = { pid: process.pid, lastTick: at, paused: control.paused, mode: process.env.AXF_AUTO_LANDER_MODE || 'tick' };
    writeJson(files().service, svc);
    if (control.paused) { state = { ...state, at, current: '', paused: true }; if (!dry) writeState(state); return { ...state, service: svc }; }
    const rec = reconcile || (await import('./reconcile.mjs').then((m) => m.reconcile).catch(() => null));
    const ctx = { state, control, land: (() => { try { return d.landState(); } catch { return null; } })(), fixed: [], reconcile: rec };
    const list = candidates(d.builds(), state, { only });
    const queue = list.map((b) => b.id);
    for (const b of list) {
      if (!dry) writeState({ ...state, at: now(), current: b.id, queue });
      try {
        const nb = await stepBuild(b, d, ctx, { policy, dry, at: now(), log });
        state = putBuild(state, nb, now());
      } catch (e) { log(`${b.id}: ${e.message}`); }
    }
    if (!dry) { try { await d.flushEscalations?.(); } catch (e) { log(`escalation push: ${e.message}`); } }
    if (ctx.fixed.length && !dry) { const c = readControl(); writeControl({ ...c, fixNow: c.fixNow.filter((x) => !ctx.fixed.includes(x)) }); }
    d.gh?.save?.();
    state = { ...state, at: now(), current: '', queue, paused: false };
    if (!dry) writeState(state);
    return { ...state, service: svc };
  } finally { lk.release(); }
}

/** Tick forever (every `everySec`); SIGTERM / SIGINT end it after the current tick. */
export async function daemon({ everySec = 60, log = (m) => process.stderr.write(`${m}\n`) } = {}) {
  let stop = false; const end = () => { stop = true; };
  process.on('SIGTERM', end); process.on('SIGINT', end);
  process.env.AXF_AUTO_LANDER_MODE = 'daemon';
  while (!stop) {
    try { const r = await tick({ log }); if (r.skipped) log(r.skipped); } catch (e) { log(`tick: ${e.message}`); }
    const asked = readControl().runRequested || '';
    for (let i = 0; i < everySec && !stop && (readControl().runRequested || '') === asked; i += 1) await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Status for the console, REST, MCP, CLI and voice. */
export function status({ at = nowIso() } = {}) {
  const st = readState(); const c = readControl(); const svc = readJson(files().service, {}) || {};
  const age = svc.lastTick ? (Date.parse(at) - Date.parse(svc.lastTick)) / 60000 : Infinity;
  const builds = st.builds.map((b) => ({ build: b.build, pr: b.pr, branch: b.branch, head: b.head, state: b.state, since: b.since, reason: b.reason, escalation: b.escalation, last: b.last || null, count: attempts.count(b.build), attempts: b.attempts.slice(-10) }));
  return {
    $axf: 'auto-lander-status@1', at,
    service: { up: age <= 3, lastTick: svc.lastTick || '', minutesSinceTick: Number.isFinite(age) ? Math.round(age * 10) / 10 : null, mode: svc.mode || '', paused: c.paused, pausedBy: c.pausedBy, pausedAt: c.pausedAt },
    current: st.current || '', queue: st.queue || [], policy: st.policy, settings: c.settings, builds,
    escalated: builds.filter((b) => b.state === 'escalated').map((b) => b.build),
    escalations: builds.filter((b) => b.state === 'escalated').map((b) => {
      const last = b.attempts.filter((x) => x.kind === b.escalation?.kind).slice(-1)[0];
      return { build: b.build, pr: b.pr, kind: b.escalation?.kind || '', attempts: b.escalation?.attempts || 0, why: b.escalation?.why || b.reason, since: b.attempts.find((x) => x.kind === b.escalation?.kind)?.at || b.escalation?.at || b.since, at: b.escalation?.at || b.since, log: last?.log || '' };
    }),
  };
}

// ------------------------------------------------------------------ CLI

export async function main(argv) {
  const a = argv; const json = a.includes('--json');
  const opt = (k) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : ''; };
  const pos = a.filter((x, i) => !x.startsWith('--') && !['--only', '--every', '--by'].includes(a[i - 1]));
  const [cmd = 'status', ...rest] = pos; const by = opt('by') || process.env.AXF_ACTOR || 'cli';
  const say = (obj, text) => process.stdout.write(`${json ? JSON.stringify(obj, null, 1) : text}\n`);
  const log = json ? () => {} : (m) => process.stderr.write(`${m}\n`);
  if (cmd === 'run' && a.includes('--request')) { const c = readControl(); writeControl({ ...c, runRequested: nowIso(), runRequestedBy: by }); return say({ ok: true, requested: true, by }, 'a tick runs within a minute'); }
  if (cmd === 'show') { const id = rest[0]; if (!id) throw Object.assign(new Error('show <build>'), { code: 'invalid' }); const b = status().builds.find((x) => x.build === id) || null; return say({ ok: true, build: id, record: b, attempts: attempts.list(id), count: attempts.count(id) }, attempts.list(id).map((x) => `${x.at}  ${x.kind} #${x.n}  ${x.result}  ${x.log.split('\n')[0].slice(0, 100)}`).join('\n') || '(no attempts)'); }
  if (cmd === 'tick' || cmd === 'run') { const r = await tick({ dry: a.includes('--dry-run'), only: opt('only'), log }); return say(r, r.skipped || `${r.builds.length} build(s) tracked${r.paused ? ' (paused)' : ''}`); }
  if (cmd === 'daemon') return daemon({ everySec: Number(opt('every')) || 60 });
  if (cmd === 'status') { const s = status(); return say(s, [`service: ${s.service.up ? 'up' : 'down'}${s.service.paused ? ' (paused)' : ''}, last tick ${s.service.lastTick || 'never'}`, `current: ${s.current || '—'}`, ...s.builds.map((b) => `${b.build}  ${b.state}  ${b.reason}`)].join('\n')); }
  if (cmd === 'retry' || cmd === 'fix') { const r = await retry(rest[0], { by, fix: cmd === 'fix' }); return say(r, `${r.build}: ${r.reset} attempt(s) reset${r.fix ? ', fix session on the next tick' : ''}`); }
  if (cmd === 'pause') { pause({ by }); return say({ ok: true, paused: true }, 'auto-lander paused'); }
  if (cmd === 'resume') { resume({ by }); return say({ ok: true, paused: false }, 'auto-lander resumed'); }
  if (cmd === 'settings') { const s = readControl().settings; return say({ ok: true, settings: s }, SETTING_KEYS.map((k) => `${k} = ${s[k]}`).join('\n')); }
  if (cmd === 'set') { const s = setSetting(rest[0], rest[1], { by }); return say({ ok: true, settings: s }, `${rest[0]} = ${s[rest[0]]}`); }
  throw Object.assign(new Error('usage: auto-lander.mjs tick|run [--dry-run] [--only b] | daemon [--every s] | status | retry <b> | fix <b> | pause | resume | settings | set <k> <v>'), { code: 'invalid' });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.message}\n`); process.exitCode = e.code === 'invalid' ? 2 : 1; });
