#!/usr/bin/env node
/**
 * Merge queue (merge-queue@2): a read-only view of the builds store, the same single source of truth the orchestrator
 * and the lander read (Pipeline 2.0, Brett Nov 18 2026: "Keep the merge queue, but it's effectively read-only").
 * Every build from `building` up to (not including) `landed`, with its live status (failed shows the attempt), its PRs
 * and its steps. No state of its own, no actions: the lander (deploy/lander/run.mjs) does the landing.
 *
 *   node apps/console-web/plugins/merge-queue-view/queue.mjs [--json]
 * AXF_BUILDS_STORE points at another store (tests).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStoreNow } from '../../../../framework/cli/builds-store.mjs';
import { queueRows, LANDING } from '../../../../deploy/lander/lander-core.mjs';

export const FRAME = 'merge-queue@2';

/** The queue → { $axf, at, landing, rows }. `builds` defaults to the live store. */
export function readQueue(builds = (readStoreNow().builds || []).filter((b) => !b.deleted), at = new Date().toISOString()) {
  const rows = queueRows(builds);
  const landing = rows.find((r) => LANDING.includes(r.status === 'failed' ? r.failure?.status : r.status))?.build || '';
  return { $axf: FRAME, at, landing, rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const q = readQueue();
  if (process.argv.includes('--json')) console.log(JSON.stringify(q));
  else console.log(q.rows.map((r) => `${(r.status === 'failed' ? `failed, attempt ${r.attempt}` : r.status).padEnd(22)} ${r.build}${r.prs.length ? ` ${r.prs.map((p) => `#${p.pr}`).join(' ')}` : ''}`).join('\n') || 'nothing waits to land');
}
