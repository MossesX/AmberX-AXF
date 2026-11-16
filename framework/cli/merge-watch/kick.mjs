/**
 * merge-watch@1 trigger: start one `merge-watch.mjs tick` in the background, right after something landed on main.
 * Never blocks the caller and never throws; a tick already running holds the lock, so a second kick is a no-op and the
 * next cron poll (deploy/cron/axf-merge-watch, every minute) takes whatever it missed.
 *
 * Called from: the merge queue (push-banner/land/merge-queue.mjs, after a batch lands), the orchestrator's after-tick
 * hook (pipeline.mjs: build_land fast-forwards and every landing the tick saw), builds-live (linkBuild with mergedAt).
 * AXF_MERGE_WATCH_KICK=off or CI set = never (tests, CI, a host that isn't the VPS).
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from './walk.mjs';

export const CLI = join(REPO_ROOT, 'framework', 'cli', 'merge-watch.mjs');

export function kick(reason = '', env = process.env) {
  if (env.AXF_MERGE_WATCH_KICK === 'off' || env.CI) return false; // CI runs never start a real tick
  try {
    const child = spawn(process.execPath, [CLI, 'tick', '--json'], { cwd: REPO_ROOT, env: { ...env, AXF_MERGE_WATCH_REASON: String(reason).slice(0, 120) }, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}
