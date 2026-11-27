/**
 * Host worker: builds-live publisher (host-service builds-live). Each pass looks at the builds store outbox and, when
 * something is queued, publishes it to main through the fixed root task `axf-task builds-live-flush` (the checkout's
 * git is root-owned); every `pullEvery` passes it pulls main's newer builds back. In shadow mode it only reports what
 * it would publish. The console's copy (flushLiveSoon in framework/cli/builds-live.mjs) stops spawning flushes while
 * this service is in host mode; store writes keep queueing to the same outbox.
 */
import { liveStatus } from '../../../framework/cli/builds-live.mjs';

let passes = 0;
const task = (ctx, name, timeoutMs = 300000) => ctx.sudo([`${ctx.root}/deploy/host-services/bin/axf-task`, name], { timeoutMs });
const out = (r) => ({ ok: r.ok, code: r.code, output: `${r.stdout}${r.stderr}`.trim().split('\n').slice(-20).join('\n') });

export const intervalSec = 20;

export async function tick(ctx) {
  passes += 1;
  const st = liveStatus();
  const effects = [];
  if (st.queued > 0) effects.push('publish');
  const pull = passes % Math.max(1, ctx.settings.pullEvery || 15) === 0;
  if (pull) effects.push('pull');
  if (ctx.dryRun) return { result: 'ok', message: `would publish ${st.queued} queued change(s)${pull ? ' and pull main' : ''}`, effects };
  if (st.queued > 0) {
    const r = await task(ctx, 'builds-live-flush');
    if (!r.ok) return { result: 'error', message: `publish failed: ${(r.stderr || r.error).trim().slice(0, 300)}`, effects };
  }
  if (pull) await task(ctx, 'builds-live-pull', 120000);
  const after = liveStatus();
  return { result: after.stuck ? 'error' : 'ok', message: after.stuck ? `outbox stuck (${after.queued}): ${after.error}` : `${st.queued} published, ${after.queued} queued`, effects };
}

export function health() {
  const s = liveStatus();
  return { ok: !s.stuck, message: s.stuck ? `outbox stuck: ${s.queued} queued, ${s.error}` : `${s.queued} queued, last publish ${s.lastOk || 'never'}` };
}

export const actions = {
  flush: async (_args, ctx) => (ctx.dryRun ? { dryRun: true, queued: liveStatus().queued } : out(await task(ctx, 'builds-live-flush'))),
  pull: async (_args, ctx) => (ctx.dryRun ? { dryRun: true } : out(await task(ctx, 'builds-live-pull', 120000))),
  sync: async (_args, ctx) => (ctx.dryRun ? { dryRun: true } : out(await task(ctx, 'builds-live-sync'))),
  status: async () => liveStatus(),
};
