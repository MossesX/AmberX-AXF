/**
 * Host worker: shipped-features watcher (host-service shipped-features). Each pass runs the ledger sync (new build
 * events, recent PRs, the deploy log) and, when `shipLanded` is on, ships manifests for newly landed builds; both are
 * fixed root tasks (`axf-task shipped-sync`, `shipped-landed`) because the ledger and the store live in the root-owned
 * checkout. In shadow mode it reports what it would run. The console's `_maybe_sync` stops syncing in host mode.
 */
const task = (ctx, name) => ctx.sudo([`${ctx.root}/deploy/host-services/bin/axf-task`, name], { timeoutMs: 600000 });
const tail = (r) => `${r.stdout}${r.stderr}`.trim().split('\n').slice(-1)[0] || '';
const out = (r) => ({ ok: r.ok, code: r.code, output: `${r.stdout}${r.stderr}`.trim().split('\n').slice(-20).join('\n') });

export const intervalSec = 120;

/** The ledger is node:sqlite (Node 22+); the console image has it, a host with an older node does not. */
export function nodeProblem(version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  return major >= 22 ? '' : `the feature ledger needs Node 22 or newer on the host (node:sqlite); this host runs Node ${version}. Fix: install Node 22 on the VPS (nodesource), then restart axf-shipped-features.service`;
}

export function health() {
  const p = nodeProblem();
  return p ? { ok: false, message: p } : { ok: true };
}

export async function tick(ctx) {
  if (nodeProblem()) return { result: 'error', message: nodeProblem(), effects: [] };
  const effects = ['sync', ...(ctx.settings.shipLanded ? ['ship-landed'] : [])];
  if (ctx.dryRun) return { result: 'ok', message: `would run ${effects.join(' + ')}`, effects };
  const s = await task(ctx, 'shipped-sync');
  if (!s.ok) return { result: 'error', message: `ledger sync: ${tail(s).slice(0, 300)}`, effects };
  if (ctx.settings.shipLanded) {
    const l = await task(ctx, 'shipped-landed');
    if (!l.ok) return { result: 'error', message: `ship landed: ${tail(l).slice(0, 300)}`, effects };
  }
  return { result: 'ok', message: tail(s).slice(0, 300), effects };
}

export const actions = {
  sync: async (_a, ctx) => (ctx.dryRun ? { dryRun: true } : out(await task(ctx, 'shipped-sync'))),
  'ship-landed': async (_a, ctx) => (ctx.dryRun ? { dryRun: true } : out(await task(ctx, 'shipped-landed'))),
};
