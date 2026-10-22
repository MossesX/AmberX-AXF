#!/usr/bin/env node
/**
 * build-queue — the build manager's state (framework/plan/build-queue.json) on top of the plan.
 *
 *   node framework/cli/build-queue.mjs              sync with the plan and print the queue
 *   node framework/cli/build-queue.mjs --next       print the next step to build (id, model, deps, features)
 *   node framework/cli/build-queue.mjs --reprocess  apply a reprocess (dependency order + rework flags)
 *   node framework/cli/build-queue.mjs --steps      also list each step's small steps (✓ when done) with their estimates
 *   node framework/cli/build-queue.mjs --check-steps  small-steps rule (Oct 21 2026): remaining steps over 30 min without
 *                                                   small steps of ≤ 30 min. Read-only; warns, exit 0 (--strict fails). In CI.
 *
 * The logic lives in framework/plan/build-queue-core.mjs (shared with the console and the MCP server);
 * this file only reads and writes the files.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlan, setStatuses } from './plan.mjs';
import * as core from '../plan/build-queue-core.mjs';
import { dataPath } from './persist.mjs';

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE = dataPath('framework/plan/build-queue.json');

export const loadQueueState = () => (existsSync(QUEUE) ? JSON.parse(readFileSync(QUEUE, 'utf8')) : null);
const saveQueueState = (q) => writeFileSync(QUEUE, JSON.stringify(q, null, 1) + '\n');

/** Write plan status changes, then re-sync (completions recorded, rework flagged) and save. */
function commit(changes, q, by, log) {
  const applied = setStatuses(changes);
  for (const c of applied) log(`plan: ${c.id} ${c.from} → ${c.to}`);
  const s = core.syncQueue(loadPlan().features, q, new Date().toISOString(), by);
  for (const c of setStatuses(s.changes)) log(`plan: ${c.id} ${c.from} → ${c.to} (sync)`);
  for (const l of s.log) log(`sync: ${l}`);
  saveQueueState(s.queue);
  return { applied, synced: s.changes.length };
}

export function queueView() {
  const q = loadQueueState();
  return { state: q ?? core.emptyQueue(), view: core.computeQueue(loadPlan().features, q) };
}

/** Two-way sync (console start, after plan/status writes). */
export function syncBuildQueue({ by = 'console:init', log = () => {} } = {}) {
  const r = commit([], loadQueueState(), by, log);
  return { ...r, ...queueView() };
}

export function reorderQueue({ order, by = 'console', log = () => {} }) {
  if (!Array.isArray(order)) throw new Error('order must be an array of step ids');
  const q = core.reorder(loadPlan().features, loadQueueState(), order, new Date().toISOString(), by);
  saveQueueState(q);
  const v = queueView();
  log(`queue reordered${v.view.violations ? ` — ${v.view.violations} step(s) now run before a dependency; reprocess to fix` : ''}`);
  return v;
}

export function reprocessQueue({ apply = false, by = 'console', log = () => {} } = {}) {
  const features = loadPlan().features;
  const q = loadQueueState();
  if (!apply) return { proposal: core.proposeReprocess(features, q), ...queueView() };
  const r = core.applyReprocess(features, q, new Date().toISOString(), by);
  saveQueueState(r.queue);
  log(`reprocessed: ${r.proposal.moves.length} move(s), ${r.proposal.rework.length} step(s) need rework`);
  for (const m of r.proposal.moves) log(`  ${m.title}: ${m.from} → ${m.to} (${m.reason})`);
  for (const w of r.proposal.rework) log(`  rework ${w.title} [${core.MODEL_LABEL[w.model] ?? w.model}]: ${w.reasons.join('; ')}`);
  return { proposal: r.proposal, ...queueView() };
}

export function stepQueue({ id, action, status, note, by = 'console', log = () => {} }) {
  const r = core.stepAction(loadPlan().features, loadQueueState(), { id, action, status, note, by });
  commit(r.changes, r.queue, by, log);
  log(`step ${id}: ${action}${status ? ` (${status})` : ''}`);
  return queueView();
}

/** Edit a step's build-time estimate and its small steps (Oct 21 2026; see build-queue-core stepsAction). Never touches the plan. */
export function stepsQueue({ by = 'console', log = () => {}, ...edit }) {
  const q = core.stepsAction(loadPlan().features, loadQueueState(), edit, new Date().toISOString(), by);
  saveQueueState(q);
  log(q.history[q.history.length - 1]?.text ?? `steps of ${edit.id} updated`);
  return queueView();
}

/** Remaining steps that break the small-steps rule (CI `--check-steps`). */
export function unsplitQueue() { return core.unsplitSteps(loadPlan().features, loadQueueState()); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = (m) => console.log(m);
  if (process.argv.includes('--check-steps')) {
    // Read-only: no sync, so CI never rewrites the shared data file.
    const view = core.computeQueue(loadPlan().features, loadQueueState());
    const bad = core.unsplitSteps(loadPlan().features, loadQueueState());
    const left = Object.entries(view.minutesLeftByModel).map(([m, n]) => `${core.MODEL_LABEL[m] ?? m} ${core.formatMinutes(n) || '0 min'}`).join(' · ');
    console.log(`build queue: ${view.steps.length - (view.counts.done ?? 0) - (view.counts.rework ?? 0) - (view.counts.dropped ?? 0)} remaining step(s) · time left ${left || '—'}`);
    for (const b of bad) console.log(`  ⚠ ${b.id} (~${b.estimate || '?'}): ${b.reasons.join('; ')}`);
    if (!bad.length) console.log('  every remaining step over 30 min is split into small steps of 30 min or less');
    else console.log(`  ${bad.length} step(s) break the small-steps rule (steps over 30 min are split into small steps of ≤ 30 min, each with an estimate)`);
    process.exit(bad.length && process.argv.includes('--strict') ? 1 : 0);
  }
  if (process.argv.includes('--reprocess')) reprocessQueue({ apply: true, by: 'cli', log });
  const { view } = syncBuildQueue({ by: 'cli', log });
  if (process.argv.includes('--next')) { const s = view.steps.find((x) => x.id === view.next); console.log(JSON.stringify(s, null, 2)); }
  else for (const s of view.steps) {
    const prog = s.steps.length ? `  [${s.stepsDone}/${s.steps.length} steps${s.minutesLeft ? `, ${core.formatMinutes(s.minutesLeft)} left` : ''}]` : s.estimate ? `  [~${s.estimate}]` : '';
    console.log(`${String(s.position).padStart(2)}. ${s.state.padEnd(7)} ${s.modelLabel.padEnd(10)} ${s.title}${prog}${s.needsSplit && s.state !== 'done' ? '  ⚠ needs splitting' : ''}${s.violations.length ? '  ⚠ ' + s.violations.join('; ') : ''}${s.rework ? '  ↻ ' + s.rework.reasons[0] : ''}`);
    if (process.argv.includes('--steps')) for (const [k, sp] of s.steps.entries()) console.log(`      ${sp.done ? '✓' : ' '}${String(k + 1).padStart(2)}. ${(sp.estimate ? `~${sp.estimate}` : '').padEnd(8)} ${sp.text.slice(0, 110)}`);
  }
  console.log(`next: ${view.next ?? '—'} · ${JSON.stringify(view.counts)} · remaining by model ${JSON.stringify(view.byModel)} · time left ${JSON.stringify(Object.fromEntries(Object.entries(view.minutesLeftByModel).map(([m, n]) => [m, core.formatMinutes(n) || '0 min'])))}`);
}
