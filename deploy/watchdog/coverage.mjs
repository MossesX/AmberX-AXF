#!/usr/bin/env node
/**
 * Watch coverage (watch-coverage@1): for every status a build or step can stand in, who watches it, after how many
 * minutes, and what the catch does. A status nobody watches, or a landing status watched too late, is a gap.
 *
 * Why (Brett, Nov 24 2026: "Don't we have a watchdog for this?"): PR #915 and #916 stood in running-ci until the build
 * was failed and merged by hand. There were watchdogs, and none covered that place: the Stuck statuses watch read
 * landing, fixing and merging only, and the Pipeline 2.0 watchdog gave running-ci 60 minutes and then only nudged the
 * lander. Nothing said so until a build was lost. This check says so: it is derived from the same tables the
 * watchdogs run on (the status contract, the layer-2 budgets, the Stuck statuses list), so a status added later, a
 * limit raised in the settings or a watch switched off shows up here, in CI and in the watchdog's audits, before a
 * build stands still in it.
 *
 * Rules:
 *   unwatched   a status that is not an end status has no watcher with a time limit
 *   slow        a landing status (build-complete … merging-main) is first looked at after more than
 *               LANDING_CEILING_MIN minutes
 *   off         a watch is switched off, or its schedule is not installed (live check only)
 *
 *   node deploy/watchdog/coverage.mjs [table] [--json]   the table, with the defaults
 *   node deploy/watchdog/coverage.mjs check [--json]     the table with the live settings, the watches and the
 *                                                        schedules; exit 1 on a gap that is not a known one
 * Tests: node --test deploy/watchdog/coverage.test.mjs
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P2 from '../../framework/core/pipeline-status.mjs';
import * as W from './core.mjs';

const SELF = fileURLToPath(import.meta.url);

export const SCHEMA = 'watch-coverage@1';
/** A build on its way into main is looked at within this many minutes of standing still, whichever status it is in. */
export const LANDING_CEILING_MIN = 20;
/**
 * Gaps that are known and have a build closing them: reported on every run, never a failure. An entry goes when its
 * gap closes (the test refuses an entry whose build is not named).
 */
export const KNOWN_GAPS = Object.freeze({
  'build:running-ci:slow': Object.freeze({ build: 'watchdog-catches-lander-prs-stuck-ci', why: 'running-ci is first looked at after 60 minutes and the catch only nudges the lander; that build gives it a short limit and a catch that reads the PR checks' }),
});

const L2 = 'Pipeline 2.0 watchdog (deploy/watchdog layer 2)';
const STALE = 'Stuck statuses (build watchdog)';
const finite = (n) => Number.isFinite(Number(n)) && Number(n) > 0;

/**
 * The table. `budgets` = the layer-2 budgets ({ build, step }, W.normSettings().budgets), `stale` = the Stuck statuses
 * limits ({ status: minutes }, or null when that watch is not there), `retryAfterMin` = the wait before a failed
 * record is retried. → [{ kind, status, lander, watchers: [{ by, limitMin, action }], limitMin }]
 */
export function coverage({ budgets = W.normSettings().budgets, stale = null, retryAfterMin = W.DEFAULTS.retryAfterMin, nudges = W.DEFAULTS.nudges } = {}) {
  const rows = [];
  const row = (kind, status, watchers, extra = {}) => {
    const ws = watchers.filter((w) => finite(w.limitMin));
    rows.push({ kind, status, ...extra, watchers: ws, limitMin: ws.length ? Math.min(...ws.map((w) => Number(w.limitMin))) : null });
  };
  for (const status of W.BUILD_STATUSES) {
    if (W.BUILD_DONE.includes(status)) continue;
    if (status === W.FAILED) { row('build', status, [{ by: L2, limitMin: retryAfterMin, action: 'retried forward into the status it failed in, up to the attempt ceiling; then one alert' }]); continue; }
    const lander = W.LANDER_OWNED.includes(status);
    const watchers = [{ by: L2, limitMin: budgets.build?.[status], action: lander ? 'one lander tick for the build, as often as it stays stuck' : `the transition is re-run ${nudges} time(s), then the build is failed and retried` }];
    if (stale && finite(stale[status])) watchers.push({ by: STALE, limitMin: stale[status], action: 'the next action on its ladder' });
    row('build', status, watchers, { lander, ...(W.WAITING_BUILD.includes(status) ? { note: 'no limit while another build holds the active place' } : {}) });
  }
  for (const status of W.STEP_STATUSES) {
    if (W.STEP_DONE.includes(status)) continue;
    if (status === W.FAILED) { row('step', status, [{ by: L2, limitMin: retryAfterMin, action: 'relaunched as attempt N+1, on another account when it has one' }]); continue; }
    if (status === 'building') { row('step', status, [{ by: L2, limitMin: finite(budgets.step?.building) ? budgets.step.building : P2.stepBudgetMinutes({}), action: 'a dead, hung or usage-limited session is failed and relaunched' }], { note: 'twice the step\'s own estimate; a dead session is caught at once' }); continue; }
    row('step', status, [{ by: L2, limitMin: budgets.step?.[status], action: status === 'completed' ? 'one lander tick for the build' : `the transition is re-run ${nudges} time(s), then the step is failed and retried` }]);
  }
  return rows;
}

/** The gaps in a table. → [{ key, kind, status, rule, why, known? }] */
export function gaps(rows, { ceilingMin = LANDING_CEILING_MIN, known = KNOWN_GAPS } = {}) {
  const out = [];
  const add = (r, rule, why) => { const key = `${r.kind}:${r.status}:${rule}`; out.push({ key, kind: r.kind, status: r.status, rule, why, ...(known[key] ? { known: known[key] } : {}) }); };
  for (const r of rows) {
    if (r.limitMin == null) { add(r, 'unwatched', `no watchdog has a time limit for a ${r.kind} standing in ${r.status}`); continue; }
    if (r.lander && r.limitMin > ceilingMin) add(r, 'slow', `a build standing in ${r.status} is first looked at after ${r.limitMin} minutes (the ceiling for a landing status is ${ceilingMin})`);
  }
  return out;
}

/** Gaps that are not on the known list: these fail the check. */
export const failing = (list) => list.filter((g) => !g.known);

// the build orchestrator's watchdog (the Stuck statuses, Build sessions and Left-over rows watches). The marked lines go
// with the build-orchestrator plugin: then only the Pipeline 2.0 watchdog is in the table.
let staleCore = ''; let buildWatchdog = '';
staleCore = '../../apps/console-web/plugins/build-orchestrator/watchdog/stale-core.mjs'; // axf-plugin:build-orchestrator
buildWatchdog = '../../apps/console-web/plugins/build-orchestrator/watchdog.mjs'; // axf-plugin:build-orchestrator

/** The Stuck statuses limits with their defaults, or null without the plugin. */
export async function staleDefaults() {
  if (!staleCore) return null;
  try { return { ...(await import(staleCore)).DEFAULTS.limits }; } catch { return null; }
}

/**
 * The live facts as gaps of rule `off`: a watchdog or watch that is switched off, and a schedule that is not installed.
 * `facts` = { layer2: { enabled }, schedules: { ok, files, l3Timer } | null, watchdogs: watchdogs-status@1 | null }.
 */
export function offGaps(facts = {}) {
  const out = [];
  const add = (status, why) => out.push({ key: `watch:${status}:off`, kind: 'watch', status, rule: 'off', why });
  if (facts.layer2 && facts.layer2.enabled === false) add('layer-2', 'the Pipeline 2.0 watchdog is switched off (node deploy/watchdog/layer2.mjs set enabled=true)');
  if (facts.schedules && !facts.schedules.ok) {
    const bad = Object.entries(facts.schedules.files ?? {}).filter(([, v]) => v !== 'ok').map(([n, v]) => `${n} ${v}`);
    if (facts.schedules.l3Timer && !['n/a', 'active'].includes(facts.schedules.l3Timer)) bad.push(`axf-watchdog-l3.timer ${facts.schedules.l3Timer}`);
    if ((facts.schedules.retiredPresent ?? []).length) bad.push(`retired ${facts.schedules.retiredPresent.join(', ')} still present`);
    add('schedules', `the watchdog schedules are not as installed: ${bad.join('; ') || 'unknown'} (node deploy/watchdog/cron.mjs install)`);
  }
  const wd = facts.watchdogs;
  if (wd) {
    if (wd.enabled === false) add('build-watchdog', 'the build watchdog is switched off (node apps/console-web/plugins/build-orchestrator/watchdog.mjs set enabled=on)');
    if (wd.cron && wd.cron.installed === false) add('build-watchdog-cron', `the build watchdog's cron file ${wd.cron.file || ''} is not installed (node apps/console-web/plugins/build-orchestrator/watchdog.mjs install-cron)`.replace('  ', ' '));
    for (const w of wd.watches ?? []) {
      if (w.available === false) add(w.id, `the ${w.label || w.id} watch could not be loaded: ${w.error || 'unknown'}`);
      else if (wd.enabled !== false && w.enabled === false) add(w.id, `the ${w.label || w.id} watch is switched off (node apps/console-web/plugins/build-orchestrator/watchdog.mjs set ${w.id}.enabled=on)`);
    }
  }
  return out;
}

/** The live facts: the layer-2 settings, the schedules, and the build watchdog's status when the plugin is there. */
export async function liveFacts(env = process.env) {
  const L2M = await import('./layer2.mjs');
  const settings = L2M.loadSettings(env);
  let schedules = null;
  try { schedules = (await import('./cron.mjs')).status({ env }); } catch { /* no schedules readable here */ }
  let watchdogs = null; let staleLimits = await staleDefaults();
  if (buildWatchdog) {
    try {
      const B = await import(buildWatchdog);
      watchdogs = await B.status({ env, recent: 0 });
      const st = (await B.loadWatch('stale'))?.watch;
      if (st && staleLimits) { const s = await st.settings(env); for (const k of Object.keys(staleLimits)) if (finite(s?.[`limit.${k}`])) staleLimits[k] = Number(s[`limit.${k}`]); }
      if ((watchdogs?.watches ?? []).some((w) => w.id === 'stale' && w.enabled === false)) staleLimits = null;
    } catch { /* the plugin's state is not readable here: the table still stands on the defaults */ }
  }
  return { settings, schedules, watchdogs, staleLimits };
}

/** One live check. → { $axf, at, ok, rows, gaps, failing } */
export async function check({ env = process.env, facts = null } = {}) {
  const f = facts ?? await liveFacts(env);
  const rows = coverage({ budgets: f.settings.budgets, stale: f.staleLimits, retryAfterMin: f.settings.retryAfterMin, nudges: f.settings.nudges });
  const all = [...gaps(rows), ...offGaps({ layer2: { enabled: f.settings.enabled }, schedules: f.schedules, watchdogs: f.watchdogs })];
  return { $axf: SCHEMA, at: new Date().toISOString(), ok: failing(all).length === 0, rows, gaps: all, failing: failing(all) };
}

export function text(rows, list) {
  const lines = rows.map((r) => `${r.kind.padEnd(5)} ${r.status.padEnd(17)} ${r.limitMin == null ? 'NOT WATCHED' : `${String(r.limitMin).padStart(4)} min`}  ${r.watchers.map((w) => `${w.by}: ${w.action}`).join(' | ')}${r.note ? ` (${r.note})` : ''}`);
  const g = list.map((x) => `${x.known ? 'known gap' : 'GAP'} [${x.rule}] ${x.why}${x.known ? `. Closing: ${x.known.build}` : ''}`);
  return [...lines, '', ...(g.length ? g : ['no gaps: every status has a watcher inside its limit'])].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const cmd = argv.find((a) => !a.startsWith('--')) || 'table'; const json = argv.includes('--json');
  if (cmd === 'table') {
    const rows = coverage({ stale: await staleDefaults() }); const list = gaps(rows);
    return console.log(json ? JSON.stringify({ $axf: SCHEMA, rows, gaps: list }, null, 1) : text(rows, list));
  }
  if (cmd === 'check') {
    const r = await check();
    if (!r.ok) process.exitCode = 1;
    return console.log(json ? JSON.stringify(r, null, 1) : text(r.rows, r.gaps));
  }
  console.error('usage: coverage.mjs [table|check] [--json]'); process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch((e) => { console.error(`watch coverage: ${e.message || e}`); process.exitCode = 1; });
