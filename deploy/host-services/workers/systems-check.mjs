/**
 * Host worker: systems check runner (host-service systems-check). Each pass refreshes the host report
 * (console-doctor.sh --report → .axf-console/host-check.json, which the console's systems check already reads) and
 * measures what only the host can see: disk use of / and the data folder, Docker space, the checkout's git state.
 * Those land in <dataDir>/checks.json as health@1 items (host-disk, host-docker-space, host-git) that the console's
 * systems check shows. `fix` runs one Auto fix from the manifest's list (confirm). Shadow: measure, never fix.
 */
import { statfsSync } from 'node:fs';

const task = (ctx, name, timeoutMs = 300000) => ctx.sudo([`${ctx.root}/deploy/host-services/bin/axf-task`, name], { timeoutMs });
const FIX_TASK = { 'host-report': 'doctor-report', 'host-docker': 'console-install', 'host-update-cron': 'console-install', 'host-anthropic-keyfile': 'keyfile-perms', 'host-claude-pick': 'claude-pick-install' };

function diskItem(path, label, s) {
  try {
    const f = statfsSync(path);
    const pct = Math.round((1 - f.bavail / f.blocks) * 100);
    const free = Math.round((f.bavail * f.bsize) / 1e9);
    const status = pct >= s.diskErrorPct ? 'error' : pct >= s.diskWarnPct ? 'warn' : 'ok';
    return { id: `host-disk${label ? `-${label}` : ''}`, status, title: `Disk ${path}`, message: `${pct}% used, ${free} GB free`, fix: status === 'ok' ? null : { service: 'maintenance', action: 'clear-docker-cache' } };
  } catch (e) { return { id: `host-disk${label ? `-${label}` : ''}`, status: 'warn', title: `Disk ${path}`, message: `cannot read: ${e.message}` }; }
}

export async function measure(ctx) {
  const items = [diskItem('/', '', ctx.settings)];
  if (ctx.data) items.push(diskItem(ctx.data, 'data', ctx.settings));
  const df = await ctx.sudo(['/usr/bin/docker', 'system', 'df'], { timeoutMs: 60000 }).catch((e) => ({ ok: false, stderr: e.message, stdout: '' }));
  const reclaim = (df.stdout.match(/Build Cache.*?(\d+(?:\.\d+)?[kMGT]?B)\s*\(?\d*%?\)?\s*$/m) || [])[1] || '';
  items.push({ id: 'host-docker-space', status: df.ok ? 'ok' : 'warn', title: 'Docker space', message: df.ok ? df.stdout.trim().split('\n').slice(1).map((l) => l.replace(/\s{2,}/g, ' ')).join('; ').slice(0, 400) : `docker system df: ${(df.stderr || '').trim().slice(0, 200)}`, ...(reclaim ? { reclaimable: reclaim } : {}) });
  const g = await task(ctx, 'git-status', 60000);
  const lines = g.stdout.trim().split('\n').filter(Boolean);
  const head = lines[0] || '';
  const dirty = lines.slice(1).filter((l) => !/^\?\? /.test(l)).length;
  const behind = Number((head.match(/behind (\d+)/) || [])[1] || 0);
  items.push({ id: 'host-git', status: !g.ok ? 'error' : dirty ? 'warn' : 'ok', title: 'Checkout /opt/axf', message: !g.ok ? `git status failed: ${g.stderr.trim().slice(0, 200)}` : `${head.replace(/^## /, '')}${dirty ? `, ${dirty} changed file(s)` : ', clean'}${behind ? `, ${behind} behind` : ''}` });
  return items;
}

export const intervalSec = 300;

export async function tick(ctx) {
  const items = await measure(ctx);
  let report = 'skipped (dry run)';
  if (!ctx.dryRun) { const r = await task(ctx, 'doctor-report', 180000); report = r.ok ? 'host report refreshed' : `host report failed: ${(r.stderr || r.error).trim().slice(0, 200)}`; }
  ctx.writeJson(`${ctx.dataDir}/checks.json`, { $axf: 'host-checks@1', at: new Date().toISOString(), items, report });
  const bad = items.filter((i) => i.status !== 'ok');
  return { result: 'ok', message: `${items.length} host checks, ${bad.length} not ok${bad.length ? ` (${bad.map((b) => b.id).join(', ')})` : ''}; ${report}`, effects: ['measure', ...(ctx.dryRun ? [] : ['doctor-report'])] };
}

export function health(ctx) {
  const c = ctx.readJson(`${ctx.dataDir}/checks.json`, null);
  const err = (c?.items || []).filter((i) => i.status === 'error');
  return { ok: true, message: c ? `${(c.items || []).length} checks at ${c.at}${err.length ? `, ${err.length} error` : ''}` : 'no checks yet' };
}

export const actions = {
  'run-checks': async (_a, ctx) => { const r = await tick(ctx); return { ...r, checks: ctx.readJson(`${ctx.dataDir}/checks.json`, null) }; },
  checks: async (_a, ctx) => ctx.readJson(`${ctx.dataDir}/checks.json`, null),
  fix: async (a, ctx) => {
    const t = FIX_TASK[a.check];
    if (!t) throw new Error(`no host fix for ${a.check}`);
    if (ctx.dryRun) return { ok: true, dryRun: true, task: t };
    const r = await task(ctx, t, 900000);
    if (t !== 'doctor-report') await task(ctx, 'doctor-report', 180000);
    return { ok: r.ok, code: r.code, output: `${r.stdout}${r.stderr}`.trim().split('\n').slice(-30).join('\n') };
  },
};
