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
 * Serial mode (the merge queue's default since Nov 14 2026, build land-finish-auto-land-live-clear-backlog): the build
 * also joins the front of the landing line (landing-line@1, land-one.mjs enqueue) and the background round is followed by
 * the serial lander (`land-one.mjs line`): main merged in, generated files regenerated, CI once on the merged head,
 * merged on green, a fix build on red, then the next build in the line.
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
import { enqueue } from './land-one.mjs';
import { readQueueConfig } from './merge-queue.mjs';

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
  const serial = readQueueConfig(s).mode === 'serial';
  const all = builds || storeBuilds(SELF_REPO);
  const lined = [];
  if (serial) for (const id of fresh) { const b = all.find((x) => x.id === id); if (b?.branch) { try { enqueue(s, b, { front: true }); lined.push(id); } catch { /* not a valid entry */ } } }
  const started = env.AXF_LAND_HOOK_SPAWN === 'off' ? [] : fresh.filter((id) => start(id, env, { serial }));
  return { landing: fresh, started, lined };
}

/** One background round for one build, through the serial landing lock (land.mjs takes it). Never waits here. */
export function startRound(id, env = process.env, { serial = false } = {}) {
  const repo = runnerRepo(env); if (!repo) return false;
  const dir = join(repo, 'apps/console-web/plugins/push-banner/land');
  // serial: the round (worktree cleaned, branch pushed) and then the serial lander, one after the other in one child
  const q = (x) => `'${String(x).replace(/'/g, "'\\''")}'`;
  const cmd = serial
    ? ['/bin/sh', ['-c', `${q(process.execPath)} ${q(join(dir, 'land.mjs'))} run --only ${q(id)} --wait-lock; ${q(process.execPath)} ${q(join(dir, 'land-one.mjs'))} line`]]
    : [process.execPath, [join(dir, 'land.mjs'), 'run', '--only', id, '--wait-lock']];
  try {
    const p = spawn(cmd[0], cmd[1], {
      cwd: repo, detached: true, stdio: 'ignore', env: { ...env, AXF_LAND_REPO: repo },
    });
    p.unref(); return true;
  } catch { return false; }
}

export default onBuildEvents;
