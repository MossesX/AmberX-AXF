#!/usr/bin/env node
/**
 * liveness.mjs — the 15-second liveness pass (build-live@1, framework/spec/BUILD-LIVE.md → The 15-second pass).
 *
 * Brett, Nov 17 2026: "The VPS checks every 15 seconds to make sure the jobs are running and updates the console."
 *
 * One pass: every build the store marks Building (build-watchdog@1 isMarkedRunning) is looked at the way the recovery
 * watchdog (#772, recovery-watchdog.mjs) looks: its own probeBuild (agent-slots: pid, tmux, heartbeat; the run-end and
 * session-end evidence) and causeOf. Nothing new is checked and nothing is decided here: what the recovery watchdog is
 * doing about a build comes from its state (build-watchdog.json → lastScan / recent), and the stale-row watchdog's (#780)
 * verdict on the row from its last run (watchdog/state.json). The pass never recovers, never writes the store, never
 * pushes a notification; it publishes on the console live channel (framework/cli/build-live-channel.mjs):
 *
 *   - a `liveness` event for a build only when what its row shows changes (alive → stale → dead, a new exit, a new
 *     watchdog action or stale verdict): a quiet pass publishes no event;
 *   - one heartbeat summary per pass (build-live-tick@1 on the channel and state.lastTick): { at, everySec, running,
 *     alive, stale, broke, published, ms }. The client marks the channel stale after 3 passes without one and the systems
 *     check goes red when the summary is older than that (server/routes_live.py → health item build-live).
 *
 *   node apps/console-web/plugins/build-orchestrator/liveness.mjs pass [--json]     one pass now
 *   node apps/console-web/plugins/build-orchestrator/liveness.mjs loop [--every 15]  pass every N seconds (the systemd unit)
 *   node apps/console-web/plugins/build-orchestrator/liveness.mjs status [--json]    the last tick and the channel state
 * Also `recovery-watchdog.mjs liveness …` (the word the spec names) and `axf builds live`.
 *
 * Env: AXF_LIVENESS_SEC (default 15, 5–300), AXF_BUILD_LIVE_DIR (the channel), AXF_WATCHDOG_PROBE (fake probes, tests),
 * AXF_WATCHDOG_DIR (the stale-row watchdog's folder), AXF_PIPELINE_DIR (the recovery watchdog's state).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from '../../../../framework/core/build-watchdog.mjs';
import * as L from '../../../../framework/core/engines/build-live.mjs';
import { loadStore } from '../../../../framework/cli/builds-store.mjs';
import { publish, readState } from '../../../../framework/cli/build-live-channel.mjs';
import { loadSettings as watchdogSettings, loadState as watchdogState, probeBuild } from './recovery-watchdog.mjs';
import { dataDir as staleDir } from './watchdog.mjs';

const SELF = fileURLToPath(import.meta.url);
export const TICK = 'build-live-tick@1';
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };

/** The pass interval: AXF_LIVENESS_SEC, else the Live status setting, else 15; clamped to 5–300. */
export function everySec(env = process.env, settings = null) {
  const [lo, hi] = L.EVERY_SEC_RANGE;
  const n = Number(env.AXF_LIVENESS_SEC || settings?.everySec || L.DEFAULT_EVERY_SEC);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : L.DEFAULT_EVERY_SEC;
}

/**
 * What the recovery watchdog (#772) is doing about each build, from its own state: the last scan's decision for the
 * same session when it planned an action, else its newest fix on the build since the launch. Map<build, decision>.
 */
export function recoveryView(env = process.env) {
  const st = watchdogState(env);
  const out = new Map();
  for (const x of st.lastScan?.builds ?? []) {
    if (x.stuck && x.action && x.action !== 'none') out.set(x.id, { action: x.action, attempt: x.attempt ?? 0, note: x.note ?? '', at: st.lastScan.at ?? '', session: x.session ?? '' });
  }
  for (const r of st.recent ?? []) {
    if (!r.buildId || !r.action) continue;
    const have = out.get(r.buildId);
    if (!have || (r.at ?? '') > (have.at ?? '')) out.set(r.buildId, { action: r.action, attempt: r.attempt ?? 0, note: r.note ?? '', at: r.at ?? '', session: '' });
  }
  return out;
}

/** The stale-row watchdog's (#780) verdicts from its last run: Map<build, { action, reason, at }>. */
export function staleView() {
  const last = readJson(join(staleDir(), 'state.json'), {})?.last;
  const out = new Map();
  for (const c of last?.changes ?? []) {
    const id = c.build || (c.kind === 'building' || c.kind === 'queued' || c.kind === 'pending' ? c.id : '');
    if (id && c.action) out.set(id, { action: c.action, reason: c.reason ?? '', at: last.at ?? '' });
  }
  return out;
}

/**
 * One pass. Returns { tick, events, changed }. `store`, `probe`, `now` are for tests (probe(b) → probe object).
 * A decision is attached only when it is newer than the build's launch (an old recovery is not this session's).
 */
export function pass({ env = process.env, store = null, probe = null, now = '', root = '' } = {}) {
  const started = Date.now();
  const at = now || new Date().toISOString();
  const every = everySec(env);
  const settings = watchdogSettings(env);
  const s = store ?? loadStore();
  const recov = recoveryView(env);
  const staleRows = staleView();
  const current = new Map(readState(root).builds.map((x) => [x.build, x]));
  const counts = { running: 0, alive: 0, stale: 0, broke: 0 };
  const makers = [];
  const looked = new Set();
  for (const b of s.builds ?? []) {
    if (!W.isMarkedRunning(b)) continue;
    looked.add(b.id);
    counts.running += 1;
    let p; try { p = probe ? probe(b) : probeBuild(b, env); } catch { p = W.normProbe({}, at); }
    const cause = W.causeOf(b, p, settings, at);
    const launched = b.pipeline?.launchedAt || b.pipeline?.dispatchedAt || '';
    const d = recov.get(b.id);
    const decision = d && (!launched || d.at >= launched) && (!d.session || !b.pipeline?.session || d.session === b.pipeline.session) ? d : null;
    const sv = staleRows.get(b.id) ?? null;
    const prev = current.get(b.id) ?? L.emptyState(b.id);
    const ev = L.livenessEvent(b, cause, { seq: (prev.seq || 0) + 1, at, decision, stale: sv, everySec: every });
    if (!ev) continue;
    const r = L.fold(prev, ev);
    const st = r.dropped ? prev.state : r.state.state;
    if (st === 'stale') counts.stale += 1; else if (st === 'broke') counts.broke += 1; else counts.alive += 1;
    // only a change is published: a quiet pass moves nothing on the channel but its heartbeat summary
    if (!r.dropped && r.changed) makers.push((seq) => L.livenessEvent(b, cause, { seq, at, decision, stale: sv, everySec: every }));
  }
  // a row the channel still shows as running while the store no longer marks it Building: one liveness event moves it
  for (const [id, st] of current) {
    if (looked.has(id) || (st.state !== 'running' && st.state !== 'stale')) continue;
    const b = (s.builds ?? []).find((x) => x.id === id);
    if (!b) continue;
    makers.push((seq) => L.livenessEvent(b, { cause: '' }, { seq, at, everySec: every, markedRunning: false }));
  }
  const tick = { $axf: TICK, at, everySec: every, ...counts, published: makers.length, ms: Date.now() - started };
  const r = publish(makers, { root, tick, everySec: every });
  tick.published = r.published?.length ?? 0;
  return { tick, events: r.published ?? [], changed: r.changed ?? [], transitions: r.transitions ?? [], off: !!r.off };
}

/** The last tick and how old it is (the systems check reads the same from state.json). */
export function status({ root = '', now = Date.now(), env = process.env } = {}) {
  const st = readState(root);
  const t = st.lastTick;
  const age = t?.at ? Math.round((now - Date.parse(t.at)) / 1000) : null;
  const every = t?.everySec || everySec(env);
  return { ok: true, lastTick: t ?? null, ageSec: age, everySec: every, silent: age == null || age > L.STALE_PASSES * every, seq: st.seq, builds: st.builds.filter((b) => b.state !== 'idle').map((b) => ({ build: b.build, state: b.state, line: b.line, checkedAt: b.checkedAt })) };
}

/** Pass every N seconds, forever (the systemd unit axf-liveness runs this). A failing pass never ends the loop. */
export async function loop({ every = 0, env = process.env, log = console.log } = {}) {
  const sec = every || everySec(env);
  for (;;) {
    const t0 = Date.now();
    try { const r = pass({ env }); if (r.tick.published) log(`${r.tick.at} liveness: ${r.tick.running} running · ${r.tick.published} changed${r.changed.length ? ` (${r.changed.join(', ')})` : ''}`); }
    catch (e) { log(`${new Date().toISOString()} liveness pass failed: ${String(e?.message ?? e).slice(0, 300)}`); }
    await new Promise((ok) => setTimeout(ok, Math.max(1000, sec * 1000 - (Date.now() - t0))));
  }
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd = 'pass', ...rest] = argv;
  const json = rest.includes('--json');
  if (cmd === 'pass') { const r = pass(); console.log(json ? JSON.stringify({ ok: true, ...r }) : `${r.tick.at}: ${r.tick.running} running · ${r.tick.alive} alive · ${r.tick.stale} stale · ${r.tick.broke} broke · ${r.tick.published} published${r.off ? ' (no live channel here)' : ''}`); return 0; }
  if (cmd === 'status') { const r = status(); console.log(json ? JSON.stringify(r) : [`last tick ${r.lastTick?.at || 'never'}${r.ageSec != null ? ` (${r.ageSec}s ago)` : ''} · every ${r.everySec}s${r.silent ? ' · SILENT' : ''}`, ...r.builds.map((b) => `  ${b.line || `${b.build} · ${b.state}`}`)].join('\n')); return 0; }
  if (cmd === 'loop') { const i = rest.indexOf('--every'); await loop({ every: i >= 0 ? Number(rest[i + 1]) || 0 : 0 }); return 0; }
  console.error('usage: liveness.mjs pass [--json] | loop [--every N] | status [--json]'); return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main().then((c) => { process.exitCode = c; }, (e) => { console.error(`liveness: ${e.message}`); process.exitCode = 1; });
