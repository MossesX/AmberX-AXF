#!/usr/bin/env node
/**
 * Build orchestrator CLI. The orchestrator owns the one builds store (builds@1, framework/cli/builds-store.mjs): on
 * the axf-data Postgres tables once cut over (Pipeline 2.0: no store.json projection), so any session on any machine or
 * account reads it and carries the build on. Each build profile (build-profiles@1) is a field on the builds, and
 * this CLI reads and writes the active profile's view of the store (orchestrator@1). Every write is versioned in
 * `_claude/builds/journal/`. The per-profile orchestrator.json files are the read-only pre-migration snapshots.
 * AXF_ORCH_FILE points at a plain orchestrator@1 file instead (old-style tests).
 *
 *   node apps/console-web/plugins/build-orchestrator/orchestrator.mjs            list (one line per build)
 *   … next [id]                       what to do next (default: the first build with work left)
 *   … brief <id> [--no-rules]         the current phase's brief, ready to paste as a first message; self-contained
 *                                     (headless-context@1): the rules block for this job is written in (rules brief +
 *                                     rule snippets by tag), and a brief over Claude settings headless.briefBudgetChars
 *                                     says so on stderr (`budget` in --json). --no-rules = the bare phase brief.
 *   … act <action> <id> [args…]       step <id> <stepId> [done|undo] · approve <id> <phase> · status <id> <status>
 *                                     note <id> <text> · rename <id> <title> · rename-step <id> <stepId> <title>
 *                                     archive|hide|unhide|remove <id>
 *   … act --json '{"action":…}'       any change from orchestrator-core.mjs apply()
 *   … request-upgrade <id> <phase>    a session reached a model UPGRADE: file the request and print the axHub approval
 *                                     to ask for (Brett approves; nobody else can)
 *
 * Model switches (framework/core/model-switch.mjs, Brett, Nov 3 2026): a downgrade passes by itself; an upgrade needs
 * Brett. Approving one here works only when the caller is Brett: the console server (his signed-in click) or its
 * axHub-approved MCP tool set AXF_APPROVER + AXF_APPROVER_VIA, and nothing in the environment says the caller is a
 * Claude session, a headless build or an agent. An `approver` inside a --json change is never trusted.
 *   … attempts <id>                   done-means-merged@1: every attempt, the open failure, the evidence, the ladder's next rung
 *   … retry <id> [strategy] [--why w] Retry by hand: the ladder starts over (a strategy given runs at once, never above the pin)
 *   … where                           the tracker file in use
 *   … tick [--build <id>]             Pipeline 2.0 layer 1 (the cron every minute, deploy/watchdog/cron.mjs): one
 *                                     dispatcher round, under the dispatcher's lock. Without --build: the full round
 *                                     (pipeline.mjs tick: builds@1 work, then pipeline2.mjs advance() for every
 *                                     Pipeline 2.0 build), and the heartbeat <pipeline dir>/orchestrator-tick.json
 *                                     ({ at }) that watchdog layer 3 checks. With --build: advance() for that one build
 *                                     only (the layer-2 watchdog's nudge); no heartbeat.
 * Any <id> may be a build's alias (build-id@1): a build whose id is over 40 characters answers to a short one too.
 *   --json on any command prints JSON (the console server uses this).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/orchestrator-core.mjs';
import { effectivePriority, priorityLabel } from '../../../../framework/core/build-priority.mjs';
import { approverFrom, upgradeLine, upgradePolicy } from '../../../../framework/core/model-switch.mjs';
import { loadUpgradePolicy } from '../../../../framework/cli/upgrade-policy.mjs';
import { readPolicy as readContextPolicy, rulesFor } from '../../../../framework/cli/headless-context.mjs';
import { briefBudget } from '../../../../framework/core/headless-context.mjs';
import * as BR from '../../../../framework/core/build-rules.mjs';

/** The session's share of the build rules for one build (brief-blocks@1); null when the store can't be read. */
function storeBlocks(b) { try { return BR.briefBlocks(BR.load().store, { id: b.id, title: b.title, text: b.detail || '' }); } catch { return null; } }

loadUpgradePolicy(); // Fable upgrades need my approval (owner-only Claude setting, default off; Brett, Nov 4 2026)
import { activeProfile } from '../../../../framework/cli/persist.mjs';
import { storeFile, withStore, loadStore } from '../../../../framework/cli/builds-store.mjs';
import { absorbOrchestrator, projectOrchestrator } from '../../../../framework/plan/builds-store-core.mjs';

const legacy = () => process.env.AXF_ORCH_FILE || '';
const profile = () => activeProfile().id;
/**
 * The profile a change works in (projects@1): the active project's, unless the build it names lives only in another
 * project (a session still running that project's build after Brett switched), which then gets its own.
 */
export function profileFor(store, id, active = profile()) {
  if (!id) return active;
  const b = store.builds.find((x) => x.id === id && !x.deleted) ?? store.builds.find((x) => x.id === id);
  return !b || (b.profiles ?? []).includes(active) || !b.profiles?.length ? active : b.profiles[0];
}
/** Where the builds are: the store (normally) or AXF_ORCH_FILE. */
export const trackerFile = () => legacy() || storeFile();

export function load(id = '') {
  const f = legacy();
  if (f) return core.normalizeState(existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : core.emptyState());
  const store = loadStore();
  return core.normalizeState(projectOrchestrator(store, profileFor(store, id)));
}
export function save(state, by = 'orchestrator') {
  const f = legacy();
  if (f) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`); renameSync(tmp, f); return; }
  const p = profile();
  withStore((s) => absorbOrchestrator(s, p, state, { by }), { by, action: 'orchestrator' });
}
/** One change: applied to the profile's view of the store and taken back into it, under the store lock (versioned). */
/** A build's id from its id or alias (build-id@1: a build made before ids were capped answers to a short alias too). */
export function resolveId(store, id) {
  if (!id || store.builds.some((x) => x.id === id)) return id;
  return store.builds.find((x) => x.alias === id)?.id ?? id;
}

export function act(change, by = process.env.AXF_ACTOR || 'orchestrator') {
  change = withApprover(change);
  if (!legacy() && change?.id && change.action !== 'add') change = { ...change, id: resolveId(loadStore(), change.id) };
  if (change.approver) by = `${change.approver.by} (${change.approver.via})`;
  if (legacy()) { const r = core.apply(load(), change); save(r.state); return r; }
  let r;
  withStore((s) => { const p = change?.action === 'add' ? profile() : profileFor(s, change?.id); r = core.apply(projectOrchestrator(s, p), change); return absorbOrchestrator(s, p, r.state, { by }); }, { by, action: `orchestrator:${change?.action}`, note: change?.id ?? '' });
  return r;
}

/** The change with the approver this process may give (never one it was handed): Brett only, from the environment. */
export function withApprover(change, env = process.env) {
  const { approver: _drop, ...c } = change && typeof change === 'object' ? change : {};
  const a = approverFrom(env);
  return a.ok ? { ...c, approver: { by: a.by, via: a.via } } : c;
}

/** The axHub approval a session asks for at an upgrade (confirm policy on axHub: Brett approves, then it runs). */
export function upgradeAsk(b, p, req) {
  const what = upgradeLine(b.id, p);
  return {
    tool: 'axf.orchestrator_upgrade_approve',
    arguments: { build: b.id, phase: p.index, request: req?.id ?? '' },
    reason: { title: `Upgrade ${b.id} phase ${p.index + 1}: ${p.from} → ${p.model}`.slice(0, 120),
      description: `${what}. Approving lets the build run phase ${p.index + 1}${p.label ? ` (${p.label})` : ''} on ${p.model} (${p.steps.filter((s) => !s.done && !s.skip).length} steps left). Deny keeps it on ${p.from}; the session has stopped and waits.` },
  };
}

function line(b, rules) {
  const p = core.progress(b); const n = core.nextUp(b, rules);
  const next = n.done ? 'done' : n.needsApproval ? `Brett: upgrade ${n.phase.from}→${n.phase.model}` : `${n.step?.model} ${n.step?.id}`;
  return `${b.id.padEnd(34)} ${priorityLabel(effectivePriority(b)).padEnd(7)} ${(core.STATUS_LABEL[b.status] ?? b.status).padEnd(15)} ${String(p.done).padStart(2)}/${p.total} steps · ${core.formatMinutes(p.minutesLeft) || '0 min'} left · next: ${next}`;
}

/**
 * Pipeline 2.0 layer 1: `tick [--build <id>]` (see the header). Re-execs under the dispatcher's lock (pipeline.mjs
 * pipelineLock, the same one step exits and pipeline2.mjs advance take) unless already inside it.
 */
async function tickCmd(given, out) {
  const bi = given.indexOf('--build');
  const raw = bi >= 0 ? String(given[bi + 1] ?? '').trim() : '';
  if (bi >= 0 && (!raw || raw.startsWith('--'))) throw new Error('tick [--build <id>]');
  const pl = await import('./pipeline.mjs');
  const { spawnSync } = await import('node:child_process');
  if (process.env.AXF_PIPELINE_LOCKED !== '1' && spawnSync('flock', ['-V'], { encoding: 'utf8' }).status === 0) {
    const lock = pl.pipelineLock();
    try { mkdirSync(dirname(lock), { recursive: true }); } catch { /* flock reports it */ }
    const r = spawnSync('flock', ['-w', '120', lock, process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, AXF_PIPELINE_LOCKED: '1' } });
    process.exitCode = r.status ?? 1; return undefined;
  }
  if (raw) {
    const id = legacy() ? raw : resolveId(loadStore(), raw);
    const P2F = await import('./pipeline2.mjs');
    const r = P2F.advance({ build: id });
    return out({ ok: true, build: id, ...r }, `tick ${id}: ${r.active === id ? 'active' : `not active (active: ${r.active || 'none'})`} · split ${r.split.length} · launched ${r.launched.length} · failed ${r.failed.length}${r.waits.length ? `\n${r.waits.map((w) => `  waits ${w.id}${w.step ? `/${w.step}` : ''}: ${w.why}`).join('\n')}` : ''}`);
  }
  const r = pl.tick();
  const at = new Date().toISOString();
  try { const f = join(pl.pipeDir(), 'orchestrator-tick.json'); mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify({ at, by: 'orchestrator.mjs tick' })}\n`); renameSync(tmp, f); } // axf-data: not data (the tick heartbeat watchdog layer 3 reads; host-local, not build state)
  catch (e) { process.stderr.write(`orchestrator: tick heartbeat not written: ${e.message}\n`); }
  const p2 = r.p2 ?? null;
  return out({ ok: true, at, tick: r }, `tick ${at} · launched ${(r.launched ?? []).length}${r.failed?.length ? ` · launch failed ${r.failed.length}` : ''}${p2 ? (p2.error ? ` · pipeline 2.0 failed: ${p2.error}` : ` · pipeline 2.0: active ${p2.active || 'none'}, launched ${p2.launched.length}`) : ''}`);
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'list', ...given] = args;
  if (cmd === 'tick') return tickCmd(given, out);
  const rest = !legacy() && ['next', 'brief', 'request-upgrade'].includes(cmd) && given[0] ? [resolveId(loadStore(), given[0]), ...given.slice(1)] : given;
  const s = load(['next', 'brief'].includes(cmd) ? rest[0] : '');
  if (cmd === 'where') return out({ ok: true, file: trackerFile() }, trackerFile());
  // done-means-merged@1: the same calls as REST GET attempts/<id>, POST retry/<id>, the MCP commands and voice
  if (cmd === 'attempts' || cmd === 'retry') {
    const id = rest[0]; if (!id) throw new Error(`${cmd} <build>${cmd === 'retry' ? ' [strategy] [--why "…"]' : ''}`);
    const pl = await import('./pipeline.mjs');
    const real = resolveId(loadStore(), id);
    if (cmd === 'attempts') { const b = (await import('../../../../framework/plan/builds-store-core.mjs')).findBuild(loadStore(), real); if (!b) throw new Error(`no build "${id}"`); const v = pl.attemptsView(b); return out({ ok: true, id: b.id, status: b.status, ...v }, `${b.id}: ${b.status} · ${v.attempts.length} attempt(s)${v.failure ? ` · fixing ${v.failure.kind}: ${v.failure.why}` : ''}${v.escalation ? ` · escalated: ${v.escalation.why}` : ''}\n${v.attempts.map((a) => `  ${a.n} ${a.kind} ${a.strategy}${a.fixStrategy ? `:${a.fixStrategy}` : ''} ${a.model || '-'} ${a.account || a.source} ${a.result}`).join('\n')}`); }
    const wi = rest.indexOf('--why'); const strategy = rest[1] && !rest[1].startsWith('--') ? rest[1] : '';
    const r = pl.retryBuild(real, { strategy, by: process.env.AXF_ACTOR || 'cli', why: wi >= 0 ? rest[wi + 1] || '' : '' });
    return out({ ok: true, ...r }, `${r.id}: ${r.status}${r.strategy ? ` (${r.strategy})` : ''}${r.launch ? ` · ${r.launch.action}` : ' · the next tick relaunches it'}`);
  }
  if (cmd === 'list' || cmd === 'state') return out({ ok: true, state: s, upgradePolicy: upgradePolicy() }, s.builds.filter((b) => !b.hidden && b.status !== 'archived').map((b) => line(b, s.rules)).join('\n') || 'No builds.');
  if (cmd === 'next') {
    const b = rest[0] ? s.builds.find((x) => x.id === rest[0]) : s.builds.find((x) => !x.hidden && !['built', 'complete', 'archived'].includes(x.status));
    if (!b) return out({ ok: true, next: null }, 'Nothing left to build.');
    const n = core.nextUp(b, s.rules);
    return out({ ok: true, id: b.id, ...n }, `${b.title} (${b.id})\n${n.done ? 'complete' : n.needsApproval ? `Needs Brett's approval: model UPGRADE ${n.phase.from} → ${n.phase.model} (phase ${n.phase.index + 1}). Stop here: request-upgrade ${b.id} ${n.phase.index}` : `Next: ${n.step.id} on ${n.step.model} — ${n.step.text}`}`);
  }
  if (cmd === 'brief') { const b = s.builds.find((x) => x.id === rest[0]); if (!b) throw new Error(`no build "${rest[0]}"`);
    // the session's rules come from the build rules store (build-rules@1), as at dispatch
    const blocks = storeBlocks(b);
    let t = core.brief(b, s.rules, { blocks });
    if (!rest.includes('--no-rules')) { if (blocks?.blocks?.rules) t = `${t}\n\n${blocks.blocks.rules}`; else { const r = rulesFor(t, { model: (core.nextUp(b, s.rules).phase?.model || '').toLowerCase(), name: b.id }); if (r.text) t = `${t}\n\n${r.text}`; } }
    const budget = briefBudget(t, readContextPolicy()); if (!budget.ok) process.stderr.write(`orchestrator: ${budget.warning}\n`);
    return out({ ok: true, brief: t, budget }, t); }
  if (cmd === 'request-upgrade') {
    const [id, ph] = rest; const r = act({ action: 'request-upgrade', id, phase: Number(ph), by: process.env.AXF_SESSION || process.env.AXF_ACTOR || 'session' });
    const b = r.build; const p = core.phases(b)[Number(ph)]; const req = b.upgradeRequests.find((x) => x.phase === p.index && x.state !== 'denied');
    if (!upgradePolicy().approvalRequired) return out({ ok: true, auto: true, log: r.log }, [...r.log, 'Fable upgrades need no approval right now: carry on with this phase on the higher model.'].join('\n'));
    const ask = upgradeAsk(b, p, req);
    return out({ ok: true, request: req, ask, log: r.log }, [...r.log,
      'Only Brett can approve a model upgrade. Ask him once, then stop this session (do no work on that phase):',
      `  axHub call ${ask.tool} ${JSON.stringify(ask.arguments)} with reason ${JSON.stringify(ask.reason)}`,
      '  (no axHub here: the request shows in the console, Build orchestrator → Approve upgrade, for Brett)'].join('\n'));
  }
  if (cmd === 'act') {
    let change;
    if (rest[0]?.startsWith('{')) change = JSON.parse(rest[0]);
    else {
      const [action, id, a, b] = rest;
      change = action === 'step' ? { action, id, step: a, done: b !== 'undo' } : action === 'approve' ? { action, id, phase: Number(a) }
        : action === 'status' ? { action, id, status: a } : action === 'note' ? { action, id, text: rest.slice(2).join(' ') }
        : action === 'rename' ? { action, id, title: rest.slice(2).join(' ') } : action === 'rename-step' ? { action, id, step: a, title: rest.slice(3).join(' ') } : { action, id };
    }
    const r = act(change);
    return out({ ok: true, state: r.state, build: r.build, log: r.log }, r.log.join('\n'));
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
