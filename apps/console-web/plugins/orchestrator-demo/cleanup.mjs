/**
 * Orchestrator demo — the stop and cleanup path. Runs once when a run ends (done or stopped): it kills every fake
 * session of the run, removes every demo-* build (the run's own from the ledger, plus any demo-* build a dead run left
 * behind), forgets the dry-run lander's simulated branches and entries, and resolves every alert the demo raised. Only
 * demo- ids are ever touched: the sandbox and the builds store's demo guard refuse anything else.
 *
 * Returns the cleanup record written into the run (driver.cleanup): { at, removed, branches, alerts, sessions, errors }.
 */
import { DEMO_PREFIX, isDemoId } from '../../../../framework/core/demo-build.mjs';
import { removeFixtures } from './sandbox.mjs';

/** The alert keys a run may have raised. */
export const alertKeys = (rec) => [
  ...Object.values(rec.driver.ids ?? {}).filter(isDemoId).map((id) => `orchestrator-demo:broke:${id}`),
  `orchestrator-demo:notify:${rec.run.id}`,
];

export async function cleanupRun(ctx, rec) {
  const errors = [];
  const ids = Object.values(rec.driver.ids ?? {}).filter(isDemoId);
  const step = async (what, fn, fb) => { try { return await fn(); } catch (e) { errors.push(`${what}: ${e?.message || e}`); return fb; } };
  const sessions = await step('sessions', () => ctx.sessions.cleanup(ids), []);
  const r = await step('builds', () => removeFixtures({ store: ctx.store, data: ctx.data, runId: rec.run.id, sweep: true }), { removed: [] });
  // a second pass for any demo build of another, older run still in the ledger
  const older = await step('builds (older runs)', () => removeFixtures({ store: ctx.store, data: ctx.data, sweep: true }), { removed: [] });
  const branches = await step('branches', () => ctx.lander.cleanup(null), []);
  const keys = alertKeys(rec);
  await step('alerts', () => ctx.alerts.resolve?.(keys), null);
  const out = {
    at: ctx.now(), removed: [...new Set([...r.removed, ...older.removed])], branches, alerts: keys, sessions,
    prefix: DEMO_PREFIX, errors,
  };
  ctx.log?.(`cleanup: removed ${out.removed.length} demo build(s), ${branches.length} branch(es), ${keys.length} alert key(s)${errors.length ? `; errors: ${errors.join('; ')}` : ''}`);
  return out;
}
