/**
 * What archiving a build does beyond its status (Brett, Nov 16 2026): it leaves the auto-lander list at once and its
 * open PR is closed with a note; the branch is kept. Every archive path calls `afterArchive` once the store holds the
 * new status: the orchestrator CLI (`act archive`), the Build manager / pipeline (`pipeline.mjs act archive`), the
 * Gate & rules Auto-lander grid (`lander.archive`), and through them REST, MCP, `axf` and voice.
 *
 * The work is the lander's `land.mjs archive <build>` (it owns land.json and the GitHub client), run detached so an
 * archive never waits on GitHub. AXF_ARCHIVE_PR=off skips it; AXF_ARCHIVE_PR=sync runs it inline. A scratch builds store
 * (AXF_BUILDS_STORE / AXF_ORCH_FILE, what tests use) never touches real PRs unless AXF_ARCHIVE_PR is on or sync.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LAND_CLI = join(REPO, 'apps/console-web/plugins/push-banner/land/land.mjs');

/** Start the close for one archived build: { started, mode } (mode off | sync | detached | unavailable). */
export function afterArchive(build, { by = 'orchestrator', why = '', pr = '', env = process.env } = {}) {
  const id = typeof build === 'string' ? build : build?.id;
  if (!id) return { started: false, mode: 'invalid' };
  const mode = env.AXF_ARCHIVE_PR === 'off' ? 'off' : env.AXF_ARCHIVE_PR === 'sync' ? 'sync' : 'detached';
  if (mode === 'off') return { started: false, mode };
  if ((env.AXF_BUILDS_STORE || env.AXF_ORCH_FILE) && !['on', 'sync'].includes(env.AXF_ARCHIVE_PR)) return { started: false, mode: 'scratch-store' };
  if (!existsSync(LAND_CLI)) return { started: false, mode: 'unavailable' };
  const branch = typeof build === 'object' && build?.branch ? build.branch : '';
  const args = [LAND_CLI, 'archive', id, '--by', String(by).slice(0, 80), '--json',
    ...(branch ? ['--branch', branch] : []), ...(pr ? ['--pr', String(pr)] : []), ...(why ? ['--why', String(why).slice(0, 200)] : [])];
  if (mode === 'sync') {
    const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: 60000, env });
    let json = null; try { json = JSON.parse(r.stdout); } catch { /* text */ }
    return { started: true, mode, ok: r.status === 0, result: json, err: (r.stderr || '').trim().slice(-300) };
  }
  try { spawn(process.execPath, args, { cwd: REPO, detached: true, stdio: 'ignore', env }).unref(); return { started: true, mode }; }
  catch { return { started: false, mode: 'unavailable' }; }
}
