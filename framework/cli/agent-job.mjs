#!/usr/bin/env node
/**
 * agent-job: hand a recurring job (job-type@1, framework/assets/job-type/) to the hired agent who owns it, instead of
 * spinning up an anonymous one-off build (Brett, Nov 1 2026).
 *
 *   node framework/cli/agent-job.mjs <job-type> [--input k=v]… [--dry-run] [--json]
 *        picks the owning agent, checks it is on duty and under budget, writes the brief from the job type's template
 *        (the agent gets only that brief and its own short notes), launches it through deploy/claude-headless.sh with
 *        the session named <agent>-<job>, and records the run on the agent (history, stats, cost)
 *   node framework/cli/agent-job.mjs list | due [--run] | event <name> [--run] | sweep | hire <job-type>
 *
 * Nobody owns the job type: exit 3 with "UNASSIGNED" (the Breakroom offers a one-tap hire).
 * The handler is found by capability (a console plugin providing service:agent-jobs@1 with jobs.mjs), never by folder.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The plugin folder that provides service:agent-jobs@1 and ships jobs.mjs, or null. */
export function findJobs(root = ROOT) {
  const plugins = join(root, 'apps/console-web/plugins');
  if (!existsSync(plugins)) return null;
  for (const n of readdirSync(plugins).sort()) {
    const d = join(plugins, n);
    try { if (JSON.parse(readFileSync(join(d, 'plugin.json'), 'utf8')).provides?.includes('service:agent-jobs@1') && existsSync(join(d, 'jobs.mjs'))) return d; } catch { /* not a plugin */ }
  }
  return null;
}

export async function main(argv = process.argv.slice(2)) {
  const owner = findJobs();
  if (!owner) { console.error('agent-job: no console plugin provides agent-jobs@1 here (agent swarm removed?); nothing run'); process.exitCode = 1; return; }
  const mod = await import(pathToFileURL(join(owner, 'jobs.mjs')).href);
  await mod.main(argv);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`agent-job: ${e.message}`); process.exit(2); });
}
