#!/usr/bin/env node
/**
 * fix-session — the auto-lander's fix-session launcher (auto-lander@1 kind `red-ci`, framework/spec/AUTO-LANDER.md).
 *
 * When a build's PR is red (or main clashes with it in hand-written code), the server starts a Claude session that
 * fixes it. There is one way to start a build session (Brett, Nov 9 2026: "It has to be the orchestrator"), so this
 * goes through the orchestrator pipeline, never around it:
 *
 *   1. never twice: a build that already has a live session (tmux, claude pid or a fresh build lock, build-lock@1), an
 *      open red-ci attempt, or a Running pipeline record gets no second one (→ status `running`);
 *   2. a fix phase is added to the build: one Opus step that carries the failure summary (job, step, first errors from
 *      ci-status.mjs, or the clashing files from merge-main.mjs) and Brett's verbatim words (build-origin@1; the
 *      dispatcher's brief puts them first as well), plus a build note;
 *   3. the build goes to the Queue (status queued: only a Queued build may take a slot, dispatch-gate.mjs);
 *   4. an account is routed (deploy/claude-workers.mjs route); none free → it stays Queued and the dispatcher's next
 *      tick starts it (→ status `queued`, nothing is left blocked);
 *   5. the pipeline's own launch (pipeline.mjs launch: dispatch token, build lock, brief, worktree) runs
 *      deploy/claude-headless.sh --account <a>, which takes an agent slot (agent-slots@1) before Claude starts;
 *   6. the run is recorded on the build (Running on that account). The red-ci attempt is opened in the attempt log as
 *      soon as the build is Queued (head = the red head), and gets the account and session once it launches. The loop ends it when the new head's CI is known.
 *
 *   node deploy/auto-lander/fix-session.mjs <build> [--summary-file f | --summary "…"] [--dry-run] [--json]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as AL from '../../framework/core/auto-lander.mjs';
import * as attempts from './attempts.mjs';

export const FIX_MODEL = 'Opus';
export const STEP_MAX = 1800;
const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));

/** The fix step's text: what to do, the failure summary, Brett's words. */
export function fixStepText(b, { n = 1, summary = '', origin = null } = {}) {
  const said = origin?.said ? `\nBrett said (verbatim): "${clip(origin.said, 500)}"` : '';
  const lead = `Auto-lander fix, attempt ${n}: make CI green on ${b.branch || `claude/${b.id}`} so the build lands. Merge origin/main in first, fix the failures below at their cause (never by skipping a check), run the failing checks locally, commit, push, and tick this step. The auto-lander re-reads CI on the new head and lands it.`;
  const room = STEP_MAX - lead.length - said.length - 30;
  return `${lead}\nFailure summary:\n${clip(summary || 'CI is red (no summary could be read).', Math.max(200, room))}${said}`;
}

/**
 * The build's worktree on its own branch. The pipeline makes a missing worktree off main (a new build); a fix session
 * must start from the branch as it is on GitHub, so a missing worktree is made here first, off origin/<branch>.
 */
export function branchWorktree(dir, branch, repo) {
  if (existsSync(dir)) return { dir, made: false };
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8', timeout: 180000 });
  git('fetch', '-q', 'origin', branch);
  let r = git('worktree', 'add', '-B', branch, dir, `origin/${branch}`);
  if (r.status !== 0 && /already checked out|already exists/.test(r.stderr)) r = git('worktree', 'add', '--detach', dir, `origin/${branch}`);
  if (r.status !== 0) throw new Error(`worktree for ${branch}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return { dir, made: true };
}

/** Default dependencies: the real orchestrator, pipeline, router, lock and attempt log (loaded on first use). */
export async function realDeps() {
  const pipe = await import('../../apps/console-web/plugins/build-orchestrator/pipeline.mjs');  // axf-plugin:build-orchestrator
  const orch = await import('../../apps/console-web/plugins/build-orchestrator/orchestrator.mjs');  // axf-plugin:build-orchestrator
  const { loadStore } = await import('../../framework/cli/builds-store.mjs');
  const storeCore = await import('../../framework/plan/builds-store-core.mjs');
  const lock = await import('../../framework/cli/build-lock.mjs');
  const workers = await import('../claude-workers.mjs');
  return {
    build: (id) => storeCore.findBuild(loadStore(), id),
    rules: () => storeCore.projectOrchestrator(loadStore(), 'all').rules,
    live: (id, dir) => lock.liveness(id, { dir }),
    worktree: (id) => join(process.env.AXF_PIPELINE_WORKTREES || '/root/axf-builds', id),
    branchWorktree: (id, branch) => branchWorktree(join(process.env.AXF_PIPELINE_WORKTREES || '/root/axf-builds', id), branch, pipe.REPO_ROOT),
    act: (change) => orch.act(change, 'auto-lander'),
    setPipeline: pipe.setPipeline,
    route: () => workers.route({}),
    launch: pipe.launch,
    attempts,
  };
}

/**
 * Start (or not) a fix session for one build.
 *   id        the build
 *   summary   the failure summary text (ci-status text, or merge-main's conflicts)
 *   n         the red-ci attempt number decide() gave (default: the next in the log)
 *   dry       say what would happen, change nothing
 * → { status: 'launched' | 'queued' | 'running' | 'refused' | 'dry', build, account, session, step, attempt, why }
 */
export async function launchFix({ id, summary = '', n = 0, head = '', dry = false, deps = null, now = () => new Date().toISOString() } = {}) {
  const d = deps || await realDeps();
  const b = d.build(id);
  if (!b) return { status: 'refused', build: id, why: `no build "${id}"` };
  if (b.deleted || b.status === 'archived') return { status: 'refused', build: id, why: `${id} is ${b.deleted ? 'deleted' : 'archived'}` };

  // 1. never a second fix session
  const lv = d.live(id, d.worktree(id));
  if (lv?.live) return { status: 'running', build: id, why: lv.why || `${id} already has a live session` };
  const open = d.attempts.list(id, { kind: 'red-ci' }).find((a) => a.result === 'started');
  if (open && !AL.timedOut(open, {}, now())) return { status: 'running', build: id, session: open.session, account: open.account, why: `fix attempt ${open.n} is still open (${open.session || 'starting'})` };
  if (b.status === 'running' && b.pipeline?.session) return { status: 'running', build: id, session: b.pipeline.session, why: `${id} is Running on ${b.pipeline.account || 'an account'}` };

  const num = n || d.attempts.nextN(id, 'red-ci');
  const text = fixStepText(b, { n: num, summary, origin: b.origin });
  if (dry) return { status: 'dry', build: id, attempt: num, step: text, account: d.route() || '' };

  // 2. the fix phase: an Opus step at the end (a new phase once the earlier steps are done) + a note
  const r = d.act({ action: 'add-step', id, stepData: { model: FIX_MODEL, estimate: '10 min', text, why: 'auto-lander red-ci', files: [] } });
  const stepId = r?.state?.builds?.find?.((x) => x.id === id)?.steps?.slice(-1)?.[0]?.id || '';
  d.act({ action: 'note', id, text: `Auto-lander: fix attempt ${num} (${stepId || 'new step'}) added. ${clip(summary.split('\n')[0] || 'CI is red.', 300)}` });

  // 3. into the Queue (only a Queued build may take a slot)
  d.setPipeline(id, { queuedAt: now(), queuedBy: 'auto-lander', note: `fix attempt ${num}` }, { status: 'queued', note: `Queued by auto-lander for fix attempt ${num}.`, by: 'auto-lander', action: 'pipeline:queue' });

  // the attempt opens now (even when it only gets Queued), so the next tick waits for it instead of adding a second fix
  const pr = Number(String(b.pr || '').replace(/\D/g, '')) || 0;
  const opened = d.attempts.start(id, 'red-ci', { n: num, account: '', session: '', branch: b.branch || `claude/${id}`, head, pr, at: now() });

  // 4. an account
  const account = d.route();
  if (!account) return { status: 'queued', build: id, attempt: opened, step: stepId, why: 'no account is free: Queued, the dispatcher starts it when one frees' };

  // 5. the pipeline's launch (dispatch token, build lock, brief, claude-headless.sh --account, agent slot), in the
  //    build's worktree on its own branch
  let l;
  try { d.branchWorktree?.(id, b.branch || `claude/${id}`); l = d.launch(d.build(id), { account, model: FIX_MODEL, phase: `fix ${num}` }, { rules: d.rules() }); }
  catch (e) {
    if (e.code === 'live') return { status: 'running', build: id, why: e.message };
    return { status: 'queued', build: id, attempt: opened, step: stepId, account, why: `launch on ${account} failed (${clip(e.message, 200)}): left Queued for the dispatcher` };
  }

  // 6. recorded: Running on that account, and the attempt opened
  const runs = (b.pipeline?.runs ?? 0) + 1;
  d.setPipeline(id, { account, session: l.session, slot: l.slot, model: FIX_MODEL, phase: `fix ${num}`, launchedAt: now(), dispatchedAt: now(), runs }, { status: 'running', note: `Auto-lander started fix attempt ${num} on ${account}: ${l.session || 'queued in agent slots'}.`, by: 'auto-lander', action: 'pipeline:launch' });
  const attempt = d.attempts.append({ ...opened, account, session: l.session || l.slot || '' });
  return { status: 'launched', build: id, account, session: l.session, slot: l.slot, attempt, step: stepId };
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2); const json = a.includes('--json');
  const opt = (k) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : ''; };
  const id = a.find((x, i) => !x.startsWith('--') && !['--summary', '--summary-file'].includes(a[i - 1]));
  const summary = opt('summary-file') ? readFileSync(opt('summary-file'), 'utf8') : opt('summary');
  launchFix({ id, summary, dry: a.includes('--dry-run') })
    .then((r) => { process.stdout.write(`${json ? JSON.stringify(r, null, 1) : `${r.status}: ${r.build}${r.account ? ` on ${r.account}` : ''}${r.session ? ` (${r.session})` : ''}${r.why ? ` — ${r.why}` : ''}`}\n`); process.exitCode = r.status === 'refused' ? 2 : 0; })
    .catch((e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
}
