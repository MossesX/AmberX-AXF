/** Lifecycle hooks (plugin-lifecycle@1) for Build docs. Jobs and videos live outside the repo (jobs.mjs dataDir()). */
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { dataDir } from './jobs.mjs';

export async function onInstall(ctx) { ctx.log(`ready: jobs and videos go to ${dataDir()}; right-click a built build → Create documentation / Create walkthrough video`); }
export async function onUninstall(ctx) {
  // removing the plugin's data removes its jobs folder on the VPS data volume too (scripts, videos, docs drafts)
  const jobs = dataDir();
  if (resolve(jobs) !== resolve(resolve(ctx.root, ctx.dataDir)) && existsSync(jobs)) { rmSync(jobs, { recursive: true, force: true }); ctx.log(`removed ${jobs}`); }
  ctx.log('docs already merged into the repo stay (ordinary Markdown files)');
}
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(resolve(ctx.root, ctx.dataDir)), detail: ctx.dataDir }, { id: 'jobs-folder', ok: true, detail: dataDir() }]; }
