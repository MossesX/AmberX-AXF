/**
 * Shared pieces of the act catalog (demo-act@1, framework/spec/LIVE-DEMO.md).
 *
 * Every act file exports `acts(ids)` (the demo-act@1 entries, given the run's demo build ids from sandbox.mjs) and
 * `handlers` (the `custom` actions those entries name: `async (ctx, act) => ({ observed, evidence })`). The runner
 * (runner.mjs) owns the context:
 *
 *   ctx.store      the builds store adapter (sandbox.mjs: read / write as a demo action)
 *   ctx.data       the plugin data folder (data-store@1)
 *   ctx.ids        { grid, crash, ci, die } → demo build ids of this run
 *   ctx.sessions   the fake headless runner (fake-session.mjs): start / kill / alive; no Claude account is spent
 *   ctx.lander     the dry-run landing line (dry-lander.mjs): never the real merge queue
 *   ctx.alerts     raise / clear / list demo alerts (alert hub, meta.demo)
 *   ctx.notify     axf.notify@1 sender (type orchestrator-demo.demo, tagged demo)
 *   ctx.log(text)  a line in the run log (the `log` expectation reads it)
 *   ctx.now()      ISO time
 */
export const APP = 'console-web';

/** The console-control address of a build row (and step) on the Build orchestrator's pipeline tab. */
export const rowAddress = (build, step = '') => `view:builds/tab:pipeline/row:${build}${step ? `/step:${step}` : ''}`;

/** A focus target for a build row (and optionally one of its steps). */
export const focusRow = (build, step = '', note = '') => ({
  app: APP, route: 'builds', address: rowAddress(build, step),
  selector: step ? `[data-axf-target="${rowAddress(build, step)}"]` : `[data-axf-target="${rowAddress(build)}"]`,
  note: note || `orchestrator demo: watch ${build}${step ? ` ${step}` : ''}`,
});

/** A focus target for a whole view / tab. */
export const focusView = (address, note, route = 'builds') => ({ app: APP, route, address, selector: `[data-axf-target="${address}"]`, note });

/** A custom action the act's handler performs. */
export const custom = (cmd, body = null, timeoutMs = 60000) => ({ kind: 'custom', cmd, body, timeoutMs });

/** Mark a build's step done (tick) through a demo write. */
export function tickStep(b, stepId, at) {
  const s = (b.steps ?? []).find((x) => x.id === stepId);
  if (!s) throw new Error(`${b.id} has no step ${stepId}`);
  s.done = true; s.doneAt = at; s.updatedAt = at;
  return s;
}

export const note = (b, text, at) => { b.notes = [...(b.notes ?? []), { text, at }]; };

export const evidence = (kind, text, ref = '', at = new Date().toISOString()) => ({ kind, text, ref, at });
