#!/usr/bin/env node
/**
 * The server part's bridge to the pure planner: reads {plan, queue, pending, changes, key, launch?} | {verifyFor} as JSON
 * on stdin, prints one JSON line. Builds the same rows the browser shows (merge.mjs over pending-core + build-queue-core),
 * the Live list (history.mjs over the build log) and runs orchestrate.mjs. No network, no writes.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRows } from './merge.mjs';
import { liveFromChanges } from './history.mjs';
import { launchCommand, planStart, verifyChecks } from './orchestrate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const pc = await import(pathToFileURL(join(REPO, 'framework/plan/pending-core.mjs')).href);
const qc = await import(pathToFileURL(join(REPO, 'framework/plan/build-queue-core.mjs')).href);
let pricing = null;
try { pricing = await import(pathToFileURL(join(REPO, 'framework/cli/model-pricing.mjs')).href); } catch { /* no estimate cost */ }

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const out = (x) => console.log(JSON.stringify(x));

if (input.verifyFor) { out({ ok: true, verify: verifyChecks(input.verifyFor) }); process.exit(0); }
if (input.command) { const c = input.command; out({ ok: true, command: launchCommand({ brief: String(c.brief ?? ''), branch: String(c.branch ?? ''), model: String(c.model ?? ''), changeId: String(c.changeId ?? '') }) }); process.exit(0); }

const features = input.plan?.features ?? [];
const queueState = input.queue ?? null;
const queue = features.length ? qc.computeQueue(features, queueState) : null;
const pending = pc.normalizeState(input.pending ?? { items: [] }).items.map((i) => ({ ...i, subPrompts: (input.pending?.items ?? []).find((r) => r.id === i.id)?.subPrompts ?? i.subPrompts }));
const rows = buildRows({ pending, queue, queueState, features }, { estimateMinutes: pc.estimateMinutes, formatMinutes: pc.formatMinutes });
const row = rows.find((r) => r.key === input.key);
const running = liveFromChanges(input.changes ?? [], rows);
const plan = planStart({ row, rows, features, queue: queueState, running, ...(input.reportCmd ? { reportCmd: input.reportCmd } : {}) });
if (row) {
  plan.row = { key: row.key, id: row.id, title: row.title, source: row.source, total: row.total, left: row.left };
  const min = row.left || row.total;
  if (min) plan.estimate = { minutes: min, ...(pricing?.estimateCost(plan.model, min) != null ? { costUsd: pricing.estimateCost(plan.model, min) } : {}) };
}
if (input.launch && plan.ok) plan.command = launchCommand({ brief: plan.brief, branch: plan.branch, model: plan.model, changeId: input.launch.changeId ?? '' });
out(plan);
