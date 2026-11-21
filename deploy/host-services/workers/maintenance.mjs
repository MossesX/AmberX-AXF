/**
 * Host worker: maintenance actions (host-service maintenance). A thin host-service@1 front for the Maintenance
 * plugin's host part: each pass measures (the plugin's engine, maint.py snapshot); Clear Docker cache, Restart Docker
 * and Status run deploy/host-services/tasks/maint-docker.mjs through fixed root tasks, so they work while the console
 * (or Docker) is down. Clear Docker cache and Restart Docker run only in host mode (never twice) and need confirm.
 */
const task = (ctx, name, timeoutMs) => ctx.sudo([`${ctx.root}/deploy/host-services/bin/axf-task`, name], { timeoutMs });
const parse = (r) => {
  const text = `${r.stdout}`.trim();
  let body = null;
  try { body = JSON.parse(text.split('\n').filter(Boolean).slice(-1)[0] || 'null'); } catch { /* text answer */ }
  return { ok: r.ok, code: r.code, ...(body && typeof body === 'object' ? { answer: body } : {}), output: `${r.stdout}${r.stderr}`.trim().split('\n').slice(-30).join('\n') };
};

export const intervalSec = 600;

export async function tick(ctx) {
  if (ctx.dryRun) return { result: 'ok', message: 'would measure (maint.py snapshot)', effects: ['snapshot'] };
  const r = await task(ctx, 'maint-snapshot', 600000);
  return { result: r.ok ? 'ok' : 'error', message: r.ok ? 'measured' : `snapshot: ${(r.stderr || r.error).trim().slice(-200)}`, effects: ['snapshot'] };
}

export const actions = {
  'clear-docker-cache': async (a, ctx) => parse(await task(ctx, a.restartDocker === false ? 'maint-docker-cache-norestart' : 'maint-docker-cache', 1500000)),
  'restart-docker': async (_a, ctx) => parse(await task(ctx, 'maint-docker-restart', 600000)),
  snapshot: async (_a, ctx) => (ctx.dryRun ? { dryRun: true } : parse(await task(ctx, 'maint-snapshot', 600000))),
  status: async (_a, ctx) => parse(await task(ctx, 'maint-status', 60000)),
};
