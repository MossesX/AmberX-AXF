/**
 * build-hook@1 listener (plugin.json "buildHooks"): a build lands the moment it finishes (Brett, Nov 13 2026: "what's it
 * gonna take to get you to merge and land what's completed").
 *
 * Every builds store write reaches here right away. A `status` event to `built`, or a `step-done` event that leaves every
 * step of the build done, puts the build at the front of the landing line (land-control `now`) and starts one landing
 * round for it in the background through the serial landing lock (land.mjs `run --only <build>`: worktree cleaned,
 * branch pushed, origin/main merged in with the builds files settled newer-wins, THREADS / STATUS / decisions unioned,
 * JSON checked, pushed, PR opened, then into the merge queue, whose CI run on top of main is the test gate). A round
 * that can't start here (no runner checkout, hooks in a test) is not lost: the cron round takes the `now` line first.
 *
 * Idempotent on event id (replays happen): a build already in the `now` line is not asked twice.
 * Env: AXF_LAND_HOOK=off (record nothing, start nothing), AXF_LAND_HOOK_SPAWN=off (record only).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './land-core.mjs';
import { control, readConfig, readControl, settings } from './land.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF_REPO = resolve(HERE, '../../../../..');

/** The builds a batch of events finishes: status → built, or the step that left every step done. */
export function finishedBy(events, storeBuilds = []) {
  const byId = new Map((storeBuilds || []).map((b) => [b.id, b]));
  const out = new Set();
  for (const e of Array.isArray(events) ? events : []) {
    const id = e?.build?.id; if (!id) continue;
    const b = byId.get(id) || { ...e.build, steps: [] };
    if (e.event === 'status' && e.to === 'built' && core.isCandidate({ ...b, status: 'built', branch: b.branch || e.build.branch })) out.add(id);
    else if (e.event === 'step-done' && core.isCandidate(b)) out.add(id);
  }
  return [...out];
}

function storeBuilds(repo) {
  try { return JSON.parse(readFileSync(join(repo, '_claude/builds/store.json'), 'utf8')).builds || []; } catch { return []; }
}

/** The checkout the landing runner works in: AXF_LAND_REPO, else the deploy checkout, else none (the cron catches up). */
export function runnerRepo(env = process.env) {
  for (const r of [env.AXF_LAND_REPO, join(env.AXF_CONSOLE_ROOT || '/opt/axf')]) {
    if (r && existsSync(join(r, 'apps/console-web/plugins/push-banner/land/land.mjs'))) return r;
  }
  return '';
}

export function onBuildEvents(events, { env = process.env, start = startRound, builds } = {}) {
  if (env.AXF_LAND_HOOK === 'off') return { landing: [] };
  const s = settings();
  if (!readConfig(s).autoLand) return { landing: [], off: true };
  const ids = finishedBy(events, builds || storeBuilds(SELF_REPO));
  const ctl = readControl(s);
  const fresh = ids.filter((id) => core.buildOn(ctl, id) && !ctl.holds?.[id] && !(ctl.now || []).includes(id));
  for (const id of fresh) { try { control(s, 'now', id); } catch { /* bad id */ } }
  const started = env.AXF_LAND_HOOK_SPAWN === 'off' ? [] : fresh.filter((id) => start(id, env));
  return { landing: fresh, started };
}

/** One background round for one build, through the serial landing lock (land.mjs takes it). Never waits here. */
export function startRound(id, env = process.env) {
  const repo = runnerRepo(env); if (!repo) return false;
  try {
    const p = spawn(process.execPath, [join(repo, 'apps/console-web/plugins/push-banner/land/land.mjs'), 'run', '--only', id, '--wait-lock'], {
      cwd: repo, detached: true, stdio: 'ignore', env: { ...env, AXF_LAND_REPO: repo },
    });
    p.unref(); return true;
  } catch { return false; }
}

export default onBuildEvents;
