/**
 * Host worker: axHub sync (host-service hub-sync). Each pass runs `claude-sync sync` in the checkout and, when
 * `pushEachPass` is on, `persist.mjs push` (seeds shared files the hub does not have; never overwrites). Both are
 * fixed root tasks (root's claude-sync install, the root-owned checkout). In shadow mode it reports what it would run.
 * In the container, the systems check's shared-data fix asks this service instead of pushing itself in host mode.
 */
const task = (ctx, name, timeoutMs = 600000) => ctx.sudo([`${ctx.root}/deploy/host-services/bin/axf-task`, name], { timeoutMs });
const last = (r) => `${r.stdout}${r.stderr}`.trim().split('\n').filter(Boolean).slice(-1)[0] || '';
const out = (r) => ({ ok: r.ok, code: r.code, output: `${r.stdout}${r.stderr}`.trim().split('\n').slice(-30).join('\n') });

export const intervalSec = 300;

export async function tick(ctx) {
  const effects = ['claude-sync', ...(ctx.settings.pushEachPass ? ['persist-push'] : [])];
  if (ctx.dryRun) return { result: 'ok', message: `would run ${effects.join(' + ')}`, effects };
  const s = await task(ctx, 'hub-sync');
  if (!s.ok) return { result: 'error', message: `claude-sync: ${last(s).slice(0, 300)}`, effects };
  if (ctx.settings.pushEachPass) {
    const p = await task(ctx, 'persist-push', 120000);
    if (!p.ok) return { result: 'error', message: `persist push: ${last(p).slice(0, 300)}`, effects };
  }
  const held = /held|conflict/i.test(s.stdout) ? ` (${last(s).slice(0, 200)})` : '';
  return { result: 'ok', message: `synced${held}`, effects };
}

export const actions = {
  sync: async (_a, ctx) => (ctx.dryRun ? { dryRun: true } : out(await task(ctx, 'hub-sync'))),
  status: async (_a, ctx) => out(await task(ctx, 'hub-status', 60000)),
  'persist-push': async (_a, ctx) => (ctx.dryRun ? { dryRun: true } : out(await task(ctx, 'persist-push', 120000))),
  'persist-pull': async (_a, ctx) => (ctx.dryRun ? { dryRun: true } : out(await task(ctx, 'persist-pull', 120000))),
};
