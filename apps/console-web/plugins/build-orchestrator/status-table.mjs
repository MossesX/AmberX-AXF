#!/usr/bin/env node
/**
 * status-table@1 (Pipeline 2.0): the one status-driven builds table, as compact rows read from the builds store
 * (framework/cli/builds-store.mjs: the Postgres tables on axf-data once cut over; never a store.json projection).
 * The console's GET /table (server/__init__.py) runs this; the rules are web/status-table-core.mjs.
 *
 *   node apps/console-web/plugins/build-orchestrator/status-table.mjs                 one line per row
 *   … --queue                                     the merge queue only (merging-pr through merging-main)
 *   … --landed                                    landed builds too (left out by default: the table hides them)
 *   … --since <rev>                               { unchanged: true } when the store is still at that rev
 *   --json prints { ok, rev, updatedAt, profile, rows }.
 */
import { activeProfile } from '../../../../framework/cli/persist.mjs';
import { loadStore } from '../../../../framework/cli/builds-store.mjs';
import { buildsOf } from '../../../../framework/plan/builds-store-core.mjs';
import { filterRows, formatElapsed, statusLabel, tableRows, timers } from './web/status-table-core.mjs';

export function table({ queue = false, landed = false, since = null } = {}) {
  const store = loadStore();
  const profile = activeProfile().id;
  const rev = store.rev ?? 0;
  if (since != null && Number(since) === rev) return { ok: true, unchanged: true, rev, profile };
  let rows = tableRows({ builds: buildsOf(store, profile) });
  rows = filterRows(rows, queue ? { queue: true } : { landed });
  return { ok: true, rev, updatedAt: store.updatedAt ?? '', profile, rows };
}

const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  try {
    const r = table({ queue: args.includes('--queue'), landed: args.includes('--landed'), since: opt('--since') });
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify(r)}\n`);
    else if (r.unchanged) process.stdout.write(`unchanged at rev ${r.rev}\n`);
    else for (const x of r.rows) {
      const t = timers(x);
      process.stdout.write(`${statusLabel(x.status, x.attempt).padEnd(18)} ${String(x.done).padStart(3)}/${String(x.total).padEnd(3)} ${formatElapsed(t.inStatus).padStart(8)} ${x.prNumber ? `#${x.prNumber}`.padEnd(6) : '      '} ${x.id}\n`);
    }
  } catch (e) {
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify({ ok: false, error: e.message })}\n`); else process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
