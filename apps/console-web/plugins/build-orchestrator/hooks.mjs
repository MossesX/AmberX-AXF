/**
 * Lifecycle hooks (plugin-lifecycle@1). Builds live in the builds store (framework/cli/builds-store.mjs: Postgres on
 * axf-data), which is project data: uninstall never deletes it. There is no status file (Nov 25 2026): nothing here
 * looks for one, and none is created.
 */
import { existsSync } from 'node:fs';
import { loadStore, storeMode } from '../../../../framework/cli/builds-store.mjs';
import * as cron from './watchdog/cron.mjs';

export async function onInstall(ctx) {
  ctx.log(`builds store: ${storeMode()}`);
  const c = cron.install();
  ctx.log(`stale-row watchdog cron: ${c.skipped ?? (c.ok ? `${c.unchanged ? 'already' : 'installed'} ${c.file}` : `not installed (${c.why})`)}`);
}
export async function onUninstall(ctx) {
  const c = cron.uninstall();
  ctx.log(`build orchestrator removed; the builds stay in the builds store; watchdog cron ${c.removed ? 'removed' : 'was not installed'}`);
}
export async function checks() {
  const c = cron.status();
  return [
    (() => { try { const n = loadStore().builds.length; return { id: 'builds-store', ok: true, detail: `${storeMode()}: ${n} build(s)` }; } catch (e) { return { id: 'builds-store', ok: false, detail: `the builds store can't be read: ${e.message}` }; } })(),
    { id: 'watchdog-cron', ok: c.installed || !existsSync('/opt/axf/apps/console-web'), detail: c.installed ? c.file : `${c.file} missing: node apps/console-web/plugins/build-orchestrator/install.mjs` },
  ];
}
