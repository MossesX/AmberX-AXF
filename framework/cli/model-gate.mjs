#!/usr/bin/env node
/**
 * model-gate — no build starts on a higher model than Brett approved (Brett, Nov 3 2026: "You can downgrade, but you
 * can't upgrade."; framework/core/model-switch.mjs).
 *
 *   node framework/cli/model-gate.mjs launch --model <m> [--build <id>] [--name <session name>] [--brief <file>] [--json]
 *        exit 0 = may start; exit 3 = refused (one plain line says why and what to do)
 *   node framework/cli/model-gate.mjs audit [--all] [--json]
 *        every model upgrade approved so far (--all: downgrades too) and whether Brett approved it
 *   node framework/cli/model-gate.mjs mark-self <build> <phase> --by "<who>" [--note "…"]
 *        the audit's fix: an approval a session gave itself stops counting (journalled)
 *
 * deploy/claude-headless.sh asks `launch` before every headless start (axHub vps.build_start, console launches, agent
 * jobs), so launching or relaunching a build on a higher model than its orchestrator step is refused like an
 * unapproved upgrade phase. The build is found by --build (AXF_BUILD_ID), else the session name, else the brief's
 * `Continue build "…" (<id>)` line. Not an orchestrator build = nothing to compare, it starts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_LABELS, modelKey, modelRank } from '../core/model-policy.mjs';
import { phaseApproved, stepPhases, upgradeLine, upgradeNeedsApproval } from '../core/model-switch.mjs';
import { loadUpgradePolicy } from './upgrade-policy.mjs';
import { loadStore, withStore } from './builds-store.mjs';

const label = (m) => MODEL_LABELS[modelKey(m)] ?? m;
const open = (s) => !s.done && !s.skip;

/** The orchestrator build a launch belongs to, or null. */
export function findBuild(store, { build = '', name = '', brief = '' } = {}) {
  const live = (store?.builds ?? []).filter((b) => !b.deleted);
  const byId = (id) => (id ? live.find((b) => b.id === id) ?? null : null);
  const bare = String(name).replace(/^axf-/, '').replace(/^build:/, '');
  const fromBrief = /Continue build ".*?" \(([a-z0-9][a-z0-9._-]*)\)/.exec(brief)?.[1] ?? /orchestrator\.mjs (?:brief|next) ([a-z0-9][a-z0-9._-]*)/.exec(brief)?.[1] ?? '';
  return byId(build) ?? byId(bare) ?? byId(fromBrief);
}

/** { ok, why, build?, phase? }: may this build start on `model` now? */
export function launchCheck(b, model) {
  if (!b) return { ok: true, why: 'not an orchestrator build: nothing to compare' };
  const want = modelKey(model);
  if (!want) return { ok: true, why: `model "${model}" unknown to the policy: the launcher's own check decides` };
  const phases = stepPhases(b.steps);
  const p = phases.find((x) => b.steps.some((s) => x.stepIds.includes(s.id) && open(s)));
  if (!p) return { ok: true, why: `${b.id} has no open steps` };
  if (!phaseApproved(b.approvals, p)) {
    return { ok: false, build: b.id, phase: p.index, why: `${upgradeLine(b.id, p)} and Brett hasn't approved it. Only Brett can: run \`orchestrator.mjs request-upgrade ${b.id} ${p.index}\` (files the axHub approval) and wait; don't launch it.` };
  }
  if (modelRank(want) > modelRank(p.model)) {
    return { ok: false, build: b.id, phase: p.index, why: upgradeNeedsApproval()
      ? `${b.id}: phase ${p.index + 1} is pinned to ${label(p.model)}; launching it on ${label(want)} is a model upgrade and needs Brett's approval. Launch it on ${label(p.model)} (or lower), or ask Brett to raise the step's model in the Build orchestrator.`
      : `${b.id}: phase ${p.index + 1} is pinned to ${label(p.model)}. If it needs ${label(want)}, set its steps to ${label(want)} in the Build orchestrator first (no approval needed right now: Fable upgrades need my approval is off), then launch.` };
  }
  const auto = p.gate && p.kind === 'upgrade' && !upgradeNeedsApproval() && !(b.approvals ?? []).some((a) => a.phase === p.index) ? ' (upgrade: no approval needed, recorded when its first step is ticked)' : '';
  return { ok: true, build: b.id, phase: p.index, why: `${b.id} phase ${p.index + 1} runs on ${label(p.model)}${auto}; ${label(want)} is ${modelRank(want) < modelRank(p.model) ? 'a downgrade (fine)' : 'the same model'}` };
}

/**
 * Every model switch approval in the store, with its kind (upgrade / downgrade, from the steps' phases), who gave it
 * (`by`/`via`; old records have neither: the journal revision that first holds it and git history say who wrote it)
 * and whether that was Brett (via console or axHub). `opts.all` keeps downgrades too.
 */
export function audit(store = loadStore(), opts = {}) {
  const out = [];
  for (const b of (store?.builds ?? []).filter((x) => !x.deleted)) {
    const ps = stepPhases(b.steps);
    for (const a of b.approvals ?? []) {
      const p = ps[a.phase];
      const kind = a.kind === 'downgrade' ? 'downgrade' : p?.kind || (modelRank(a.to) > modelRank(a.from) ? 'upgrade' : 'downgrade');
      if (kind !== 'upgrade' && !opts.all) continue;
      out.push({ build: b.id, status: b.status, phase: a.phase, from: a.from, to: a.to, kind, at: a.at, by: a.by || '', via: a.via || '', note: a.note || '',
        human: ['console', 'axhub'].includes(a.via), selfApproved: a.selfApproved === true });
    }
  }
  return out.sort((x, y) => String(x.at).localeCompare(String(y.at)));
}

/** Mark one approval as not Brett's (the audit): it stops counting for an upgrade; who did it goes in `by` / `note`. */
export function markSelfApproved(store, id, phase, { by = '', note = '' } = {}) {
  const b = store.builds.find((x) => x.id === id && !x.deleted); if (!b) throw new Error(`no build "${id}"`);
  const a = (b.approvals ?? []).find((x) => x.phase === Number(phase)); if (!a) throw new Error(`${id} has no approval on phase ${Number(phase) + 1}`);
  a.selfApproved = true; if (by) a.by = by; if (note) a.note = note;
  const p = stepPhases(b.steps)[a.phase]; if (p?.kind === 'downgrade') a.kind = 'downgrade';
  return store;
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] ?? '' : ''; };
  const [cmd] = args;
  if (cmd === 'launch') {
    loadUpgradePolicy();
    const briefFile = opt('brief'); const brief = briefFile && existsSync(briefFile) ? readFileSync(briefFile, 'utf8').slice(0, 64 * 1024) : '';
    const b = findBuild(loadStore(), { build: opt('build') || process.env.AXF_BUILD_ID || '', name: opt('name'), brief });
    const r = launchCheck(b, opt('model') || process.env.AXF_MODEL || '');
    console.log(json ? JSON.stringify(r) : `${r.ok ? 'ok' : 'refused'}: ${r.why}`);
    if (!r.ok) process.exitCode = 3;
    return;
  }
  if (cmd === 'audit') {
    const rows = audit(loadStore(), { all: args.includes('--all') });
    if (json) return console.log(JSON.stringify({ ok: true, approvals: rows }));
    if (!rows.length) return console.log('No model upgrades approved yet.');
    for (const r of rows) console.log(`${r.at}  ${r.build} phase ${r.phase + 1}: ${r.from} → ${r.to} (${r.kind})  ${r.human ? `Brett via ${r.via}` : r.via === 'policy' ? 'automatic (Fable upgrades need my approval was off)' : `NOT Brett${r.by ? `: ${r.by}` : ': approver not recorded (before Nov 3 2026)'}`}${r.selfApproved ? ' · marked self-approved' : ''}`);
    return;
  }
  if (cmd === 'mark-self') { // audit fix: node framework/cli/model-gate.mjs mark-self <build> <phase> --by "<who>" [--note "…"]
    const [, id, phase] = args;
    const r = withStore((st) => markSelfApproved(st, id, phase, { by: opt('by'), note: opt('note') }), { by: 'model-gate audit', action: 'model-gate:mark-self', note: `${id} phase ${Number(phase) + 1}` });
    return console.log(`${id} phase ${Number(phase) + 1}: marked self-approved (store rev ${r.rev})`);
  }
  console.error('usage: model-gate.mjs launch --model <m> [--build <id>] [--name <n>] [--brief <file>] | audit'); process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`model-gate: ${e.message}`); process.exitCode = 2; });
}
