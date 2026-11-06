#!/usr/bin/env node
/**
 * Build orchestrator CLI. The orchestrator owns the one builds store (builds@1, `_claude/builds/store.json`, see
 * framework/cli/builds-store.mjs): a repo file, so any session on any machine or account reads it and carries the build
 * on (it syncs with the hub through claude-sync). Each build profile (build-profiles@1) is a field on the builds, and
 * this CLI reads and writes the active profile's view of the store (orchestrator@1). Every write is versioned in
 * `_claude/builds/journal/`. The per-profile orchestrator.json files are the read-only pre-migration snapshots.
 * AXF_ORCH_FILE points at a plain orchestrator@1 file instead (old-style tests).
 *
 *   node apps/console-web/plugins/build-orchestrator/orchestrator.mjs            list (one line per build)
 *   … next [id]                       what to do next (default: the first build with work left)
 *   … brief <id>                      the current phase's brief, ready to paste as a first message
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
 *   … where                           the tracker file in use
 *   --json on any command prints JSON (the console server uses this).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/orchestrator-core.mjs';
import { effectivePriority, priorityLabel } from '../../../../framework/core/build-priority.mjs';
import { approverFrom, upgradeLine, upgradePolicy } from '../../../../framework/core/model-switch.mjs';
import { loadUpgradePolicy } from '../../../../framework/cli/upgrade-policy.mjs';

loadUpgradePolicy(); // Fable upgrades need my approval (owner-only Claude setting, default off; Brett, Nov 4 2026)
import { activeProfile } from '../../../../framework/cli/persist.mjs';
import { storeFile, withStore, loadStore } from '../../../../framework/cli/builds-store.mjs';
import { absorbOrchestrator, projectOrchestrator } from '../../../../framework/plan/builds-store-core.mjs';

const legacy = () => process.env.AXF_ORCH_FILE || '';
const profile = () => activeProfile().id;
/** Where the builds are: the store (normally) or AXF_ORCH_FILE. */
export const trackerFile = () => legacy() || storeFile();

export function load() {
  const f = legacy();
  if (f) return core.normalizeState(existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : core.emptyState());
  return core.normalizeState(projectOrchestrator(loadStore(), profile()));
}
export function save(state, by = 'orchestrator') {
  const f = legacy();
  if (f) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`); renameSync(tmp, f); return; }
  const p = profile();
  withStore((s) => absorbOrchestrator(s, p, state, { by }), { by, action: 'orchestrator' });
}
/** One change: applied to the profile's view of the store and taken back into it, under the store lock (versioned). */
export function act(change, by = process.env.AXF_ACTOR || 'orchestrator') {
  change = withApprover(change);
  if (change.approver) by = `${change.approver.by} (${change.approver.via})`;
  if (legacy()) { const r = core.apply(load(), change); save(r.state); return r; }
  const p = profile();
  let r;
  withStore((s) => { r = core.apply(projectOrchestrator(s, p), change); return absorbOrchestrator(s, p, r.state, { by }); }, { by, action: `orchestrator:${change?.action}`, note: change?.id ?? '' });
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
  return `${b.id.padEnd(34)} ${priorityLabel(effectivePriority(b)).padEnd(7)} ${core.STATUS_LABEL[b.status].padEnd(15)} ${String(p.done).padStart(2)}/${p.total} steps · ${core.formatMinutes(p.minutesLeft) || '0 min'} left · next: ${next}`;
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'list', ...rest] = args;
  const s = load();
  if (cmd === 'where') return out({ ok: true, file: trackerFile() }, trackerFile());
  if (cmd === 'list' || cmd === 'state') return out({ ok: true, state: s, upgradePolicy: upgradePolicy() }, s.builds.filter((b) => !b.hidden && b.status !== 'archived').map((b) => line(b, s.rules)).join('\n') || 'No builds.');
  if (cmd === 'next') {
    const b = rest[0] ? s.builds.find((x) => x.id === rest[0]) : s.builds.find((x) => !x.hidden && !['built', 'complete', 'archived'].includes(x.status));
    if (!b) return out({ ok: true, next: null }, 'Nothing left to build.');
    const n = core.nextUp(b, s.rules);
    return out({ ok: true, id: b.id, ...n }, `${b.title} (${b.id})\n${n.done ? 'complete' : n.needsApproval ? `Needs Brett's approval: model UPGRADE ${n.phase.from} → ${n.phase.model} (phase ${n.phase.index + 1}). Stop here: request-upgrade ${b.id} ${n.phase.index}` : `Next: ${n.step.id} on ${n.step.model} — ${n.step.text}`}`);
  }
  if (cmd === 'brief') { const b = s.builds.find((x) => x.id === rest[0]); if (!b) throw new Error(`no build "${rest[0]}"`); const t = core.brief(b, s.rules); return out({ ok: true, brief: t }, t); }
  if (cmd === 'suggest') {   // the model the chain control rules suggest for each open step; the step's pin still decides
    const cli = await import('../../../../framework/cli/chain-control.mjs');
    const rows = cli.suggestFor(rest[0]);
    return out({ ok: true, suggestions: rows }, rows.map((r) => `${r.step} ${r.differs ? '≠' : '='} pinned ${r.pinned}, suggest ${r.model} (${r.why}): ${r.text.slice(0, 70)}`).join('\n') || 'No open steps.');
  }
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
