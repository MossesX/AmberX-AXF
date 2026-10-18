#!/usr/bin/env node
/**
 * build-queue — the build manager's state (framework/plan/build-queue.json) on top of the plan.
 *
 *   node framework/cli/build-queue.mjs              sync with the plan and print the queue
 *   node framework/cli/build-queue.mjs --next       print the next step to build (id, model, deps, features)
 *   node framework/cli/build-queue.mjs --reprocess  apply a reprocess (dependency order + rework flags)
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = (m) => console.log(m);
  if (process.argv.includes('--reprocess')) reprocessQueue({ apply: true, by: 'cli', log });
  const { view } = syncBuildQueue({ by: 'cli', log });
  if (process.argv.includes('--next')) { const s = view.steps.find((x) => x.id === view.next); console.log(JSON.stringify(s, null, 2)); }
  else for (const s of view.steps) console.log(`${String(s.position).padStart(2)}. ${s.state.padEnd(7)} ${s.modelLabel.padEnd(10)} ${s.title}${s.violations.length ? '  ⚠ ' + s.violations.join('; ') : ''}${s.rework ? '  ↻ ' + s.rework.reasons[0] : ''}`);
  console.log(`next: ${view.next ?? '—'} · ${JSON.stringify(view.counts)} · remaining by model ${JSON.stringify(view.byModel)}`);
}
