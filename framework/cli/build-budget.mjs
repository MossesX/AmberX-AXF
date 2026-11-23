#!/usr/bin/env node
/**
 * build-budget — the VPS side of the build budgets (build-budget@1, framework/core/build-budget.mjs). The dispatcher's
 * tick calls enforce() every minute, on the host: it reads the caps (Claude settings), the spend (the headless
 * meters), and for every build over a cap stops its sessions, marks it on its record (`budgetStop`), and hands back
 * one alert for Brett. A stop is released by itself once the cap allows it again.
 *
 *   node framework/cli/build-budget.mjs status [--json]    the caps in force, today's spend, every build's spend and stop
 *   node framework/cli/build-budget.mjs check  [--json]    what an enforce pass would do now (nothing changes)
 *   node framework/cli/build-budget.mjs enforce [--json]   one pass (the dispatcher runs this; by hand it is the same pass)
 *
 * Environment: AXF_CLAUDE_SETTINGS_FILE (the Claude settings document), AXF_HEADLESS_DIR (the meters, default
 * /var/tmp/axf-headless), AXF_BUDGET=off (no pass at all: tests of other things), AXF_BUDGET_KILL=off (tests: sessions
 * are not touched).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as B from '../core/build-budget.mjs';
import * as P2 from '../core/pipeline-status.mjs';
import * as core from '../plan/builds-store-core.mjs';
import { settingsFile } from './upgrade-policy.mjs';
import { loadStore, setFlowStatus, withStore } from './builds-store.mjs';
import { crewSay } from './crew-say.mjs';
import { release as releaseLock } from './build-lock.mjs';

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const nowIso = () => new Date().toISOString();
const hdir = (env) => env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless';

/** The caps in force (stored value, else the registry default). */
export function readCaps(env = process.env) {
  let values = {};
  try { values = JSON.parse(readFileSync(settingsFile(env), 'utf8'))?.values ?? {}; } catch { /* no document: the defaults */ }
  return B.capsOf(values);
}

/** Every headless meter on the host (one small file per session). */
export function readMeters(env = process.env) {
  const dir = hdir(env); const out = [];
  let names = []; try { names = readdirSync(dir).filter((f) => f.endsWith('.meter.json')); } catch { return out; }
  for (const f of names) {
    try { const m = JSON.parse(readFileSync(join(dir, f), 'utf8')); out.push({ session: str(m.session || f.replace(/\.meter\.json$/, ''), 200), name: str(m.name, 200), build: str(m.build, 120), cwd: str(m.cwd, 400), costUsd: Number(m.costUsd) || 0, startedAt: str(m.startedAt, 40) }); }
    catch { /* a meter being written: read on the next pass */ }
  }
  return out;
}

/** The start of the VPS's local day, in ms. */
export const dayStart = (now = Date.now()) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Caps, spend and the decision for the builds on record. Reads only. */
export function look({ env = process.env, store = loadStore(), now = Date.now() } = {}) {
  const builds = store.builds.filter((b) => !b.deleted);
  const caps = readCaps(env);
  const spend = B.spendOf(readMeters(env), { ids: new Set(builds.map((b) => b.id)), dayStart: dayStart(now) });
  const live = builds.filter((b) => b.budgetStop || B.hasSessionOut(b));
  return { caps, spend, ...B.decide({ builds: live, caps, spend }) };
}

function killSession(session, env) {
  if (!session || env.AXF_BUDGET_KILL === 'off') return false;
  return spawnSync('tmux', ['kill-session', '-t', `=${session}`], { encoding: 'utf8', timeout: 20e3 }).status === 0;
}

/**
 * One pass: stop what is over a cap, release what a cap allows again. → { caps, spend, daily, stopped: [stop + line],
 * cleared: [{ id, kind }], alert }. Never throws for one build: a store refusal is reported in `errors`.
 */
export function enforce({ env = process.env, by = 'budget', now = Date.now() } = {}) {
  if (env.AXF_BUDGET === 'off') return { off: true, stopped: [], cleared: [], daily: { reached: false }, alert: null, errors: [] };
  const seen = look({ env, now });
  const stopped = []; const cleared = []; const errors = [];
  for (const stop of seen.stops) {
    const b = core.findBuild(loadStore(), stop.id); if (!b) continue;
    const at = nowIso(); const line = B.stopLine(stop, { title: b.title });
    try {
      const p2 = b.flow === P2.FLOW;
      const out = (b.steps ?? []).filter((s) => ['sending', 'building'].includes(s.status));
      // the session goes, and the build lock it held with it (or the step's next launch is refused as still live)
      for (const s of out) { killSession(s.tmux, env); try { if (s.worktree) releaseLock(`${b.id}--${s.id}`, { dir: s.worktree }); } catch { /* the lock expires by itself */ } }
      if (!p2) killSession(b.pipeline?.session, env);
      withStore((st) => { const rec = core.findBuild(st, stop.id); if (rec) { rec.budgetStop = { at, kind: stop.kind, spentUsd: stop.spentUsd, capUsd: stop.capUsd }; rec.notes = [...(rec.notes ?? []), { text: `Budget: ${line}`, at, by }]; rec.updatedAt = at; } return st; }, { by, action: 'budget:stop', note: `${stop.id} (${stop.kind})` });
      if (p2) {
        const why = `budget: ${stop.kind === 'build' ? 'the build' : 'the day'} reached its cap`;
        for (const s of out) setFlowStatus(stop.id, P2.FAILED, { step: s.id, by, why });
        if (P2.isHand(b)) setFlowStatus(stop.id, P2.FAILED, { by, why });
      }
      stopped.push({ ...stop, line });
      try { crewSay('dispatcher', 'blocked', line, { ref: stop.id, env }); } catch { /* the chat is a courtesy */ }
    } catch (e) { errors.push({ id: stop.id, error: str(e.message) }); }
  }
  for (const c of seen.clears) {
    try {
      const at = nowIso();
      withStore((st) => { const rec = core.findBuild(st, c.id); if (rec?.budgetStop) { delete rec.budgetStop; rec.notes = [...(rec.notes ?? []), { text: `Budget: the ${c.kind === 'build' ? 'per-build' : 'daily'} cap allows it again: released.`, at, by }]; rec.updatedAt = at; } return st; }, { by, action: 'budget:clear', note: c.id });
      cleared.push(c);
    } catch (e) { errors.push({ id: c.id, error: str(e.message) }); }
  }
  return { caps: seen.caps, spend: { dayUsd: seen.spend.dayUsd, sessions: seen.spend.sessions }, daily: seen.daily, stopped, cleared, alert: B.alertOf(stopped, seen.daily), errors };
}

/** Is the day's cap reached (the dispatcher starts nothing while it is)? Cheap enough for every pass. */
export function dailyReached(env = process.env) {
  if (env.AXF_BUDGET === 'off') return { reached: false };
  const caps = readCaps(env);
  if (!(caps.dailyUsd > 0)) return { reached: false, capUsd: 0 };
  const spend = B.spendOf(readMeters(env), { dayStart: dayStart() });
  return { reached: spend.dayUsd >= caps.dailyUsd, spentUsd: spend.dayUsd, capUsd: caps.dailyUsd };
}

function main(argv) {
  const [cmd = 'status'] = argv; const json = argv.includes('--json');
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  if (cmd === 'status' || cmd === 'check') {
    const r = look();
    const cap = (n, stored) => (n > 0 ? money(n) : stored ? 'no cap (set to 0)' : 'no cap (none saved yet)');
    const rows = Object.entries(r.spend.byBuild).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, v]) => `  ${id}: ${money(v)}`);
    return print({ ok: true, caps: r.caps, daily: r.daily, byBuild: r.spend.byBuild, stops: r.stops, clears: r.clears },
      [`per build ${cap(r.caps.perBuildUsd, r.caps.stored.perBuild)} · daily ${cap(r.caps.dailyUsd, r.caps.stored.daily)} · today ${money(r.spend.dayUsd)}${r.daily.reached ? ' (daily cap reached: nothing new starts)' : ''}`,
        ...(r.stops.length ? ['would stop:', ...r.stops.map((s) => `  ${B.stopLine(s)}`)] : []), ...(r.clears.length ? [`would release: ${r.clears.map((c) => c.id).join(', ')}`] : []), ...(rows.length ? ['spend per build:', ...rows] : [])].join('\n'));
  }
  if (cmd === 'enforce') { const r = enforce({ by: process.env.AXF_ACTOR || 'budget' }); return print({ ok: !r.errors.length, ...r }, r.off ? 'budgets are off (AXF_BUDGET=off)' : `stopped ${r.stopped.length} · released ${r.cleared.length}${r.daily.reached ? ' · daily cap reached' : ''}${r.errors.length ? `\n${r.errors.map((e) => `  ${e.id}: ${e.error}`).join('\n')}` : ''}`); }
  console.error('usage: build-budget.mjs status | check | enforce [--json]'); process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`build-budget: ${e.message}`); process.exitCode = 1; }
}
