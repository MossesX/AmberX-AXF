/**
 * The lander's fix session (lander@1): the one hand-off the lander makes. A code conflict, red CI or failing build
 * rules on a PR go to a headless session on Fable (Brett's model rule: merge conflicts and CI fixes are Fable work),
 * started the way the dispatcher starts a step: deploy/claude-headless.sh, which takes a real slot (agent-slots) and
 * a real account (the worker logins) or queues for one. It does not go through the agent roster.
 *
 * The session works in a worktree of the PR branch that the lander cuts, and its brief names the PR, the branch, the
 * failing checks with their log tail, and one rule above the rest: push to this branch only. It never pushes to main
 * and never merges; the lander sees the push as a new head, runs CI on it and does the merge itself.
 *
 * The session is not a build launch: its name (lander-fix-pr<N>-<k>) is no build id and it carries no AXF_BUILD_ID, so
 * the dispatch gate (one way to start builds) has nothing to judge.
 *
 * Environment: AXF_LANDER_FIX_LAUNCHER (the launcher script, default deploy/claude-headless.sh), AXF_PIPELINE_WORKTREES
 * (where worktrees live, default /root/axf-builds).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MODEL_IDS } from '../../framework/core/model-policy.mjs';

export const FIX_MODEL = 'fable';
const CLAUDE_ARGS = ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'Edit', 'Write', 'MultiEdit', 'Read', 'Grep', 'Glob'];
const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
const slug = (v) => str(v, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The session's name: lander-fix-pr<N>-<k> (k = the PR's fix session number). Never a build id, never `--`. */
export const fixName = (pr, n = 1) => `lander-fix-pr${Number(pr) || 0}-${Math.max(1, Number(n) || 1)}`;
/** The worktree a build's fix sessions work in (one per build, reused; removed when the build lands). */
export const fixWorktree = (buildId, env = process.env) => join(env.AXF_PIPELINE_WORKTREES || '/root/axf-builds', `lander-fix-${slug(buildId)}`);

/**
 * The brief, pure. `f` = the failure record being fixed (kind, why, failing), `log` = the failing log's tail, `n` = this
 * PR's fix session number, `of` = how many it gets.
 */
export function fixBrief({ build, title = '', pr, branch, base = 'main', remote = 'origin', f = {}, log = '', n = 1, of = 2, worktree = '' }) {
  const src = f.of?.kind ? f.of : f;
  const failing = (src.failing || []).filter(Boolean);
  const task = src.kind === 'clash-main'
    ? [`Merging ${base} into \`${branch}\` conflicts in code. Run \`git fetch ${remote}\` and \`git merge ${remote}/${base}\` (never rebase), resolve every conflict keeping both sides' intent, run the tests of the files you touched, commit the merge.`]
    : src.kind === 'rules'
      ? [`The build rules fail at the gate on \`${branch}\`${failing.length ? `: ${failing.join(', ')}` : ''}.`, `Run them yourself: \`node apps/console-web/plugins/*/build-rules-runner.mjs run --build ${build} --phase gate --root . --json\`, fix what they name, commit.`]
      : [`CI is red on \`${branch}\`${failing.length ? `. Failing checks: ${failing.join('; ')}` : ''}.`, 'Find the cause in the log below, reproduce the failing check locally, fix the code (never the test, unless the test is what is wrong), commit.'];
  return [
    `# Fix PR #${pr} so it can land: ${str(title || build, 120)}`,
    '',
    `Build \`${build}\`. The lander (deploy/lander/run.mjs) could not land PR #${pr}. Fix session ${n} of ${of}, on Fable. You run headless; nobody is watching.`,
    `Branch: \`${branch}\` (the PR's branch)${worktree ? ` · worktree: ${worktree}` : ''}.`,
    '',
    '## What failed',
    str(src.why || f.why, 600) || 'See the failing checks.',
    ...(f.kind === 'fix-timeout' ? ['', 'A fix session before this one pushed nothing. Do not repeat it: start from the log.'] : []),
    '',
    '## What to do',
    ...task,
    ...(str(log).trim() ? ['', '## The failing log (tail)', '```', str(log, 6000).trim(), '```'] : []),
    '',
    '## Rules',
    `- Push to this branch only: \`git push ${remote} HEAD:${branch}\`. Never push to ${base}. Never force-push. Never open, merge or close a PR.`,
    '- The lander sees your push, runs CI on it and merges the PR itself. A push is the only thing it waits for.',
    '- One session, no sub-agents. Opus or Fable only. Heavy steps (npm/vite builds, Playwright) go through `node framework/cli/agent-slots.mjs heavy -- <cmd>`.',
    '- Stay on the failure: no refactors, no unrelated changes.',
    '- If it cannot be fixed, push nothing and end the session; say why in your last message. The lander then stops and reports to Brett.',
  ].join('\n');
}

/**
 * Cut (or refresh) the fix worktree at the PR branch's newest head, detached: the session pushes `HEAD:<branch>`.
 * A worktree left by an earlier session is reset to the branch (what that session did not push is dropped).
 * → { ok, dir } | { ok: false, why }
 */
export function cutFixWorktree({ git, remote = 'origin', branch, dir }) {
  const ref = `${remote}/${branch}`;
  if (git(['rev-parse', '-q', '--verify', `refs/remotes/${ref}`]).code) return { ok: false, why: `${branch} is not on GitHub` };
  if (existsSync(join(dir, '.git'))) {
    const r = git(['checkout', '-q', '-f', '--detach', ref], { cwd: dir });
    if (r.code) return { ok: false, why: `worktree ${dir}: ${r.err.slice(-200)}` };
    git(['clean', '-qfd'], { cwd: dir });
    return { ok: true, dir };
  }
  git(['worktree', 'prune']);
  const r = git(['worktree', 'add', '-q', '--detach', dir, ref], { timeout: 300000 });
  return r.code ? { ok: false, why: `worktree ${dir}: ${r.err.slice(-200)}` } : { ok: true, dir };
}

/**
 * Start a fix session. → { exit, session, why, queued }: exit 0 = it started (or waits for a slot in the launcher's own
 * queue, which starts it by itself); anything else = it did not start, `why` says so in one line.
 */
export function defaultFixSession(s, { env = process.env, launcher = env.AXF_LANDER_FIX_LAUNCHER || join(s.repo, 'deploy', 'claude-headless.sh') } = {}) {
  return ({ git, b, f, branch, pr, log = '', n = 1, of = 2 }) => {
    const name = fixName(pr, n);
    const dir = fixWorktree(b.id, env);
    const cut = cutFixWorktree({ git, remote: s.remote, branch, dir });
    if (!cut.ok) return { exit: 1, session: '', why: cut.why };
    const notes = join(s.dataDir, 'fix'); mkdirSync(notes, { recursive: true });
    const brief = join(notes, `${name}.md`);
    // axf-data: not data (a host-local brief for one headless session; build state is in the builds store)
    writeFileSync(brief, `${fixBrief({ build: b.id, title: b.title, pr, branch, base: s.base, remote: s.remote, f, log, n, of, worktree: dir })}\n`);
    const args = ['--name', name, '--brief', brief, '--log', `${name}.log`, '--', '--model', MODEL_IDS[FIX_MODEL], ...CLAUDE_ARGS];
    const e = { ...env, HOME: env.HOME || homedir() || '/root', AXF_SURFACE: 'lander', AXF_MODEL: FIX_MODEL, AXF_AGENT_JOB: 'land-build' };
    for (const k of ['AXF_BUILD_ID', 'AXF_BUILD_STEP', 'AXF_DISPATCH_TOKEN', 'AXF_AGENT_BOOKED']) delete e[k];
    const r = spawnSync('bash', [launcher, ...args], { cwd: dir, encoding: 'utf8', timeout: 120e3, env: e });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    const session = /started (axf-\S+) in/.exec(text)?.[1] ?? /queued at position \d+ \((hl-[a-z0-9-]+)/.exec(text)?.[1] ?? '';
    const queued = /queued at position/.test(text);
    if (r.status !== 0 || (!session && !queued)) return { exit: r.status || 1, session: '', why: str(text.trim().split('\n').filter(Boolean).pop() || r.error?.message || 'the launcher printed nothing', 300) };
    return { exit: 0, session, why: '', queued, worktree: dir, model: FIX_MODEL };
  };
}
