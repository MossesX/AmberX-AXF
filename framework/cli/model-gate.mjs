#!/usr/bin/env node
/**
 * model-gate — no build starts on a higher model than Brett approved (Brett, Nov 3 2026: "You can downgrade, but you
 * can't upgrade."; framework/core/model-switch.mjs).
 *
 *   node framework/cli/model-gate.mjs launch --model <m> [--build <id>] [--name <session name>] [--brief <file>] [--step <id>] [--json]
 *        --step (a parallel step launch, BUILD-PARALLEL; AXF_STEP_ID): the check is that step's own: open, its phase
 *        approved, and never a model above the step's pin. AXF_BUILD_STEP (a Pipeline 2.0 step) compares with the step's pin
 *        exit 0 = may start; exit 3 = refused (one plain line says why and what to do). A model word the policy
 *        does not know is refused for every launch, build or not: it is an error, never a silent Opus.
 *   node framework/cli/model-gate.mjs resolve <model> [--json]
 *        the policy's key, label and Claude Code id for any spelling ("FABLE" → claude-fable-5-2); exit 2 when unknown
 *   node framework/cli/model-gate.mjs for-work "<text>" [--floor <model>] [--json]
 *        the model a piece of work gets from the one word list (model-policy@1 work: unsure = Fable) and why
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
import { MODEL_IDS, MODEL_LABELS, modelKey, modelProblem, modelRank, requireModel, workModel } from '../core/model-policy.mjs';
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
  // pipeline-2@1: a step's session is named <build>--<step>
  const ofStep = bare.includes('--') ? bare.slice(0, bare.lastIndexOf('--')) : '';
  return byId(build) ?? byId(bare) ?? byId(fromBrief) ?? byId(ofStep);
}

/** The Pipeline 2.0 step a launch is for: AXF_BUILD_STEP, else the <build>--<step> launch name. */
export function stepOf(b, { step = '', name = '' } = {}) {
  if (!b || b.flow !== 'pipeline-2') return null;
  const bare = String(name).replace(/^axf-/, '');
  const id = step || (bare.startsWith(`${b.id}--`) ? bare.slice(b.id.length + 2).split('--')[0] : '');
  return (b.steps ?? []).find((s) => s.id === id) ?? null;
}

/**
 * { ok, why, build?, phase?, step? }: may this build start on `model` now? A Pipeline 2.0 step is pinned by its own
 * `model` (the orchestrator assigns it; the watchdog raises it to Fable first, recorded on the build), so its launch is
 * compared with that step, never with the build's first open phase (Nov 20 2026: a step raised to Fable was refused
 * because phase 1 of the build was Opus).
 */
export function launchCheck(b, model, { step = null } = {}) {
  const want = modelKey(model);
  if (!want && String(model ?? '').trim()) return { ok: false, unknown: true, ...(b ? { build: b.id } : {}), why: `${modelProblem(model)}. An unknown model is an error, never a silent ${MODEL_LABELS.opus.split(' ')[0]}: launch it on ${MODEL_LABELS.opus} or ${MODEL_LABELS.fable}.` };
  if (!b) return { ok: true, why: 'not an orchestrator build: nothing to compare' };
  if (!want) return { ok: true, why: 'no model given: nothing to compare' };
  if (step) {
    if (modelRank(want) > modelRank(step.model)) return { ok: false, build: b.id, step: step.id, why: `${b.id}/${step.id} is pinned to ${label(step.model)}; launching it on ${label(want)} is a model upgrade: raise the step first.` };
    return { ok: true, build: b.id, step: step.id, why: `${b.id}/${step.id} runs on ${label(step.model)}; ${label(want)} is ${modelRank(want) < modelRank(step.model) ? 'a downgrade (fine)' : 'the same model'}` };
  }
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

/** { ok, why, build?, step? }: may this one step (a parallel step session) start on `model` now? Checked per step. */
export function stepLaunchCheck(b, stepId, model) {
  if (!b) return { ok: false, why: `step launch ${stepId}: no orchestrator build found` };
  const s = (b.steps ?? []).find((x) => x.id === stepId);
  if (!s) return { ok: false, build: b.id, why: `${b.id} has no step ${stepId}` };
  if (!open(s)) return { ok: false, build: b.id, step: s.id, why: `${b.id} ${s.id} is ${s.done ? 'done' : 'skipped'}: nothing to launch` };
  const want = modelKey(model);
  if (!want && String(model ?? '').trim()) return { ok: false, unknown: true, build: b.id, step: s.id, why: `${modelProblem(model)}. An unknown model is an error, never a silent ${MODEL_LABELS.opus.split(' ')[0]}.` };
  if (!want) return { ok: true, build: b.id, step: s.id, why: 'no model given: nothing to compare' };
  const p = stepPhases(b.steps).find((x) => x.stepIds.includes(s.id));
  if (p && !phaseApproved(b.approvals, p)) return { ok: false, build: b.id, step: s.id, phase: p.index, why: `${upgradeLine(b.id, p)} and Brett hasn't approved it: ${s.id} waits.` };
  if (modelRank(want) > modelRank(s.model)) return { ok: false, build: b.id, step: s.id, why: `${b.id} ${s.id} is pinned to ${label(s.model)}: never launched on ${label(want)} (raise the step first)` };
  return { ok: true, build: b.id, step: s.id, why: `${b.id} ${s.id} runs on ${label(s.model)}; ${label(want)} is ${modelRank(want) < modelRank(s.model) ? 'a downgrade (fine)' : 'the same model'}` };
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
    const pstep = opt('step') || process.env.AXF_STEP_ID || '';
    const r = pstep ? stepLaunchCheck(b, pstep, opt('model') || process.env.AXF_MODEL || '')
      : launchCheck(b, opt('model') || process.env.AXF_MODEL || '', { step: stepOf(b, { step: process.env.AXF_BUILD_STEP || '', name: opt('name') }) });
    console.log(json ? JSON.stringify(r) : `${r.ok ? 'ok' : 'refused'}: ${r.why}`);
    if (!r.ok) process.exitCode = 3;
    return;
  }
  if (cmd === 'resolve') {
    const key = requireModel(args[1]); // throws ModelError on an unknown or missing model → exit 2
    const r = { ok: true, key, label: MODEL_LABELS[key], id: MODEL_IDS[key] };
    return console.log(json ? JSON.stringify(r) : r.id);
  }
  if (cmd === 'for-work') {
    const floor = opt('floor'); const text = args.slice(1).filter((a, i, l) => a !== '--floor' && l[i - 1] !== '--floor').join(' ');
    const r = workModel(text, { floor });
    return console.log(json ? JSON.stringify({ ok: true, ...r, label: MODEL_LABELS[r.model], id: MODEL_IDS[r.model] }) : `${MODEL_LABELS[r.model]}: ${r.why}`);
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
  console.error('usage: model-gate.mjs launch --model <m> [--build <id>] [--name <n>] [--brief <file>] | resolve <model> | for-work "<text>" [--floor <model>] | audit'); process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`model-gate: ${e.message}`); process.exitCode = 2; });
}
