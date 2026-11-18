#!/usr/bin/env node
/**
 * split-gate-reject — a build start the gate rule require-split-id refused goes to the orchestrator's Failed tab
 * (split-plan@1; Brett, Nov 18 2026: "rejected starts go back to the orchestrator Failed tab with the reason").
 *
 * The rejection record (gate-rejection@1) says who tried, when, the reason and what was missing:
 *   { $axf: 'gate-rejection@1', rule: 'require-split-id', at, by, name, reason, missing: ['build-id' | 'split-id' | …] }
 * It is written to the builds store, journalled (action gate:rejected):
 *   - a known build that is not running: status failed, gateReason = the reason, gateRejection = the record, a note;
 *     the Failed tab (orchestrator tab `errors`) shows it with the reason, and Queue puts it back through the splitter;
 *   - a known build with a run on (running, landing, …): the record and a note only; its run is not touched;
 *   - a start with no orchestrator build at all: a new failed build named after the session, so it shows up too.
 * The last GATE_REJECTIONS_MAX records ride on the build (gateRejections, newest last).
 *
 *   node framework/cli/split-gate-reject.mjs record --build <id> | --name <session> --why "…" [--missing a,b] [--by who]
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/builds-store-core.mjs';
import { withStore } from './builds-store.mjs';
import { uniqueBuildId } from '../core/build-id.mjs';

export const SCHEMA = 'gate-rejection@1';
export const RULE = 'require-split-id';
export const GATE_REJECTIONS_MAX = 20;
/** Statuses whose run the rejection must not touch: only the record and a note are added. */
export const KEEP_STATUS = Object.freeze(['splitting', 'running', 'waiting', 'fixing', 'landing', 'landed', 'complete', 'built', 'escalated', 'archived']);
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));

/** The rejection record, in shape. */
export function rejectionOf({ why = '', missing = [], name = '', by = '', at = new Date().toISOString() } = {}) {
  return { $axf: SCHEMA, rule: RULE, at, by: str(by, 80) || 'launcher', name: str(name, 120), reason: str(why, 600), missing: (Array.isArray(missing) ? missing : String(missing).split(',')).map((m) => str(m, 40).trim()).filter(Boolean).slice(0, 8) };
}

/** Write one refused start to the store (journalled). → { id, created, status, rejection } */
export function rejectStart({ build = '', why = '', missing = [], name = '', by = '', at = new Date().toISOString() } = {}) {
  const rec = rejectionOf({ why, missing, name, by, at });
  let out = null;
  withStore((s) => {
    let b = build ? core.findBuild(s, build) : null;
    let created = false;
    if (!b) {
      const bare = str(name, 120).replace(/^axf-/, '').replace(/^build[-:]/, '') || 'rejected-start';
      const id = uniqueBuildId(bare, new Set(s.builds.map((x) => x.id)));
      b = core.normBuild({ id, title: `Rejected start: ${bare}`, detail: `A build start without an orchestrator build id was refused by the gate rule ${RULE}. File it with the orchestrator to run it.`, status: 'failed', steps: [], createdAt: at, updatedAt: at });
      s.builds.push(b); created = true;
    }
    const keep = KEEP_STATUS.includes(b.status);
    if (!keep) b.status = 'failed';
    b.gateReason = rec.reason;
    b.gateRejection = rec;
    b.gateRejections = [...(Array.isArray(b.gateRejections) ? b.gateRejections : []), rec].slice(-GATE_REJECTIONS_MAX);
    b.notes.push({ text: `Start refused by ${RULE}${rec.missing.length ? ` (missing ${rec.missing.join(', ')})` : ''}: ${rec.reason}${keep ? ` (its ${b.status} run is not touched)` : ''}`, at });
    b.updatedAt = at;
    out = { id: b.id, created, status: b.status, rejection: rec };
    return s;
  }, { by: rec.by, action: 'gate:rejected', note: `${build || name}: ${rec.reason.slice(0, 200)}` });
  return out;
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] ?? '' : ''; };
  if (args[0] !== 'record') { console.error('usage: split-gate-reject.mjs record --build <id> | --name <session> --why "…" [--missing a,b] [--by who]'); process.exitCode = 2; return; }
  const r = rejectStart({ build: opt('build'), name: opt('name'), why: opt('why'), missing: opt('missing'), by: opt('by') || process.env.AXF_ACTOR || 'cli' });
  console.log(json ? JSON.stringify({ ok: true, ...r }) : `${r.id}: ${r.status}${r.created ? ' (new record)' : ''} · ${r.rejection.reason}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(`split-gate-reject: ${e.message}`); process.exitCode = 1; });
