/**
 * Hand build lane (Brett, Nov 21 2026): start one build straight from a Plan Studio 2.0 item, tracked, without the
 * Pipeline 2.0 dispatcher. No split, no queue, no slot:
 *
 *   1. who asks: Brett's own signed-in console only (framework/cli/emergency-builds.mjs ownerFrom, the check PR 868 added
 *      for emergency builds). The console token, MCP, the CLI, voice and sessions are refused before anything is written;
 *   2. the model: picked every time from the live policy list (framework/core/model-policy.mjs ALLOWED_MODELS). No
 *      default: a hand build without a model is refused;
 *   3. the record first: a build in the builds store (builds-store.mjs withStore), id from the item's title, source
 *      `hand` (mode hand), status running, the model on its run record, linked to the item (planRef + a build link);
 *   4. its own cap: at most HAND_CAP hand builds run at once, counted from their records plus the live tmux sessions.
 *      Hand builds never take an orchestrator slot or an emergency slot and ignore the host build limit
 *      (AXF_SLOTS=off, AXF_BUILD_LIMIT=off for the launch): they start however busy the slots are;
 *   5. the launch: a worktree on claude/<id> from the console's checkout (/opt/axf), the whole item as the brief, and
 *      deploy/claude-headless.sh in tmux on the chosen model, the same path axHub's vps.build_start takes. The hand
 *      build is signed for the launcher's dispatch gate with a one-build token (dispatch-gate.mjs issue), spent when the
 *      session starts, so every gate the launcher runs accepts it;
 *   6. status: handStatus() reads the record and tmux (launched, building, PR #, CI, merged, ended) for the item's row.
 *
 * Pure helpers (brief, cap, status) take their inputs; launchHand() does the I/O and takes overrides for tests
 * (`sessions`, `spawn`, `worktree`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as tc from './web/tree-core.mjs';
import * as BS from '../../../../framework/cli/builds-store.mjs';
import * as core from '../../../../framework/plan/builds-store-core.mjs';
import { ALLOWED_MODELS, MODEL_IDS, MODEL_LABELS, MODEL_TIERS, modelKey } from '../../../../framework/core/model-policy.mjs';
import { issue as issueDispatch } from '../../../../framework/cli/dispatch-gate.mjs';
import { ownerFrom } from '../../../../framework/cli/emergency-builds.mjs';
import { activeProfile } from '../../../../framework/cli/persist.mjs';
import { isBuildId } from '../../../../framework/core/build-id.mjs';

/** At most this many hand builds run at once (Brett, Nov 21 2026). The lane's only limit. */
export const HAND_CAP = 2;
/** The builds store `source` of a hand build: its mode. */
export const HAND_SOURCE = 'hand';
/** A launched record with no tmux session yet still counts while it may be setting up (worktree, login, look gate). */
export const STARTUP_GRACE_MS = 10 * 60e3;
/** The tools a hand build session gets: the orchestrator's set. */
export const CLAUDE_ARGS = ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'Edit', 'Write', 'MultiEdit', 'Read', 'Grep', 'Glob'];
const ID_MAX = 40;

export class HandRefused extends Error {
  /** code: forbidden (not Brett's console) · model (none or not allowed) · cap (two already running) · validation · not_found · launch */
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

/* ------------------------------------------------------------------ the model picker */

/** The models a hand build may run on, best first, from the live policy: [{ value, label, id }]. */
export function handModels() {
  return [...ALLOWED_MODELS].sort((a, b) => MODEL_TIERS.indexOf(b) - MODEL_TIERS.indexOf(a)).map((k) => ({ value: k, label: MODEL_LABELS[k], id: MODEL_IDS[k] }));
}

/** The policy key for the model Brett picked; throws HandRefused('model') when none was picked or it may not run. */
export function pickModel(m) {
  if (!String(m ?? '').trim()) throw new HandRefused('model', `pick the model for this hand build: ${handModels().map((x) => x.label).join(' or ')}. There is no default.`);
  const k = modelKey(m);
  if (!ALLOWED_MODELS.includes(k)) throw new HandRefused('model', `"${m}" is not a model hand builds may run on: ${handModels().map((x) => x.label).join(' or ')}`);
  return k;
}

/* ------------------------------------------------------------------ the brief: the whole item */

const KIND_WORD = { plan: 'Plan', section: 'Section', step: 'Step', note: 'Note', list: 'List', item: 'List item' };

/** The item's subtree in order, depth first: every child with its body, numbered (1, 1.1, 1.2, 2 …). */
export function outline(state, id) {
  const lines = [];
  const walk = (rows, prefix, depth) => rows.forEach((r, i) => {
    const n = `${prefix}${i + 1}`;
    const mark = tc.CHECKABLE.has(r.kind) && r.done ? ' (done)' : '';
    lines.push(`${'#'.repeat(Math.min(3 + depth, 6))} ${n}. ${KIND_WORD[r.kind] ?? 'Item'}: ${r.title}${mark}`);
    const meta = [r.model && `model ${r.model}`, r.minutes && `${r.minutes} min`, r.priority, r.status].filter(Boolean);
    if (meta.length) lines.push(`_${meta.join(' · ')}_`);
    if (r.body?.trim()) lines.push('', r.body.trim());
    lines.push('');
    walk(r.children, `${n}.`, depth + 1);
  });
  walk(tc.tree(state, id), '', 0);
  return lines.join('\n').trim();
}

/** The standard rules every hand build is told (clean code, tests, a PR, CI green, never merge itself). */
export function handRules(id) {
  return [
    '## Rules',
    `- This is a hand build: no orchestrator steps, no split, no queue. Work the whole task above in this one session, on branch claude/${id} in this worktree.`,
    '- Clean code, clean comments and clean commit messages. Read only the files the task needs.',
    '- Tests for what you change; run them before you push.',
    '- Heavy steps (npm/vite builds, docker test runs, Playwright) go through `node framework/cli/agent-slots.mjs heavy -- <command>`.',
    `- Commit on claude/${id} only and open a PR. Link it: \`node framework/cli/builds-live.mjs link ${id} --branch claude/${id} --pr <n>\`.`,
    '- CI must go green. If it fails, fix it and push again until it is green.',
    '- Never merge the PR yourself, never push to main: the merge queue lands it.',
    '- Models: Opus or Fable only, never Sonnet or Haiku.',
    '- At the end, report: what changed, the tests, the PR number, the CI link, and anything Brett must do.',
  ].join('\n');
}

/** The whole brief: title, full body, every nested child with its body in order, then the rules. */
export function handBrief(state, ref, { id, model, by = 'Brett', at = new Date().toISOString() } = {}) {
  const it = tc.resolve(state, ref);
  if (!it) throw new HandRefused('not_found', `no item "${ref}"`);
  const label = MODEL_LABELS[modelKey(model)] ?? model;
  const under = outline(state, it.id);
  return [
    `# Hand build: ${it.title}`,
    '',
    `Build ${id} · hand build started by ${by} from Plan Studio 2.0 at ${at} · ${label}.`,
    `Plan Studio item: ${tc.pathOf(state, it.id)} (plan-studio-2.focus:${it.id})`,
    '',
    '## The task',
    '',
    it.body?.trim() || it.title,
    ...(under ? ['', '## Everything under it, in order', '', under] : []),
    '',
    handRules(id),
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ the cap and the status */

export const isHand = (b) => !!b && !b.deleted && b.source === HAND_SOURCE;

/** The tmux sessions on this host, or null when tmux can't be asked (no tmux, no server, tests). */
export function liveSessions(env = process.env) {
  if (env.AXF_HAND_TMUX === 'off') return null;
  const r = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8', timeout: 10e3 });
  if (r.error) return null;
  if (r.status !== 0) return /no server running|error connecting/i.test(r.stderr || '') ? [] : null;
  return r.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
}

/** The build's sessions among `names`: axf-<id>, axf-<id>--<agent>, or the launcher's axf-<id>-HHMMSS rename. */
export function sessionsOf(id, names) {
  const base = `axf-${id}`;
  return (names ?? []).filter((n) => n === base || n.startsWith(`${base}--`) || new RegExp(`^${base.replace(/[.]/g, '\\.')}-\\d{6}(--|$)`).test(n));
}

/**
 * The hand builds running now: a live tmux session for it, else a running record launched within STARTUP_GRACE_MS
 * whose run has not ended. When tmux can't be asked (`sessions` null) the record decides: running and no run end.
 * → [{ id, title, model, session, since }]
 */
export function runningHand(builds, { sessions = null, now = Date.now() } = {}) {
  const out = [];
  for (const b of builds ?? []) {
    if (!isHand(b)) continue;
    const live = sessions ? sessionsOf(b.id, sessions) : [];
    const ended = !!b.pipeline?.runEnd;
    const since = b.pipeline?.launchedAt || b.createdAt || '';
    const fresh = now - (Date.parse(since) || 0) < STARTUP_GRACE_MS;
    const recordRuns = b.status === 'running' && !ended;
    if (live.length || (recordRuns && (sessions === null || fresh))) out.push({ id: b.id, title: b.title, model: b.pipeline?.model || '', session: live[0] || '', since });
  }
  return out;
}

/** '' when another hand build may start, else the refusal naming the ones running. */
export function capRefusal(running, cap = HAND_CAP) {
  if (running.length < cap) return '';
  const names = running.map((r) => `${r.id} (${MODEL_LABELS[modelKey(r.model)] ?? (r.model || 'model ?')}${r.session ? `, ${r.session}` : ', starting'})`);
  return `${running.length} hand builds are already running, the most there may be at once (${cap}): ${names.join(' and ')}. Wait for one to finish, then start this one.`;
}

const prNumber = (pr) => Number(/(\d+)\s*$/.exec(String(pr || ''))?.[1] || /\/pull\/(\d+)/.exec(String(pr || ''))?.[1] || 0) || 0;

/**
 * One hand build as its Plan Studio item shows it. `state`: launched (record, no session yet) · building (tmux alive) ·
 * pr (PR open) · ci-running · ci-green · ci-red · merged · ended (session gone, no PR) · failed (launch refused).
 */
export function handStatus(b, { sessions = null, repo = '' } = {}) {
  const live = sessions ? sessionsOf(b.id, sessions) : [];
  const pr = prNumber(b.pr);
  const ci = String(b.landed?.ci || '');
  const merged = !!b.mergedAt || ['landed', 'complete'].includes(b.status);
  const end = b.pipeline?.runEnd ?? null;
  let state = 'launched';
  if (b.status === 'failed' && !pr) state = 'failed';
  else if (merged) state = 'merged';
  else if (pr && ci === 'success') state = 'ci-green';
  else if (pr && ci === 'failure') state = 'ci-red';
  else if (pr && ci === 'running') state = 'ci-running';
  else if (pr) state = 'pr';
  else if (live.length) state = 'building';
  else if (end || (sessions && !live.length && b.status === 'running' && Date.now() - (Date.parse(b.pipeline?.launchedAt || 0) || 0) > STARTUP_GRACE_MS)) state = 'ended';
  const LABEL = { launched: 'Launched', building: 'Building', pr: `PR #${pr}`, 'ci-running': `PR #${pr} · CI running`, 'ci-green': `PR #${pr} · CI green`, 'ci-red': `PR #${pr} · CI red`, merged: pr ? `Merged #${pr}` : 'Merged', ended: end && Number.isInteger(end.exit) ? `Ended (exit ${end.exit})` : 'Ended', failed: 'Not started' };
  return {
    id: b.id, title: b.title, item: b.planRef || '', state, label: LABEL[state], model: b.pipeline?.model || '', modelLabel: MODEL_LABELS[modelKey(b.pipeline?.model)] ?? '',
    session: live[0] || '', building: live.length > 0, pr, prUrl: pr && repo ? `https://github.com/${repo}/pull/${pr}` : '', ci, merged,
    branch: b.branch || `claude/${b.id}`, launchedAt: b.pipeline?.launchedAt || b.createdAt || '', by: b.pipeline?.queuedBy || '',
    log: b.pipeline?.note?.match(/log (\S+)/)?.[1] || '', exit: end && Number.isInteger(end.exit) ? end.exit : null,
  };
}

/* ------------------------------------------------------------------ the launch */

/** A build id from the title: lower-case, unique in the builds store, at most 40 characters. */
export function handId(title, taken) {
  const base = tc.slug(title).slice(0, ID_MAX - 3).replace(/-+$/, '') || 'hand-build';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, ID_MAX - String(n).length - 1)}-${n}`;
  return id;
}

/** The checkout hand builds branch from: AXF_HAND_REPO, else the console's /opt/axf, else this checkout. */
export const repoRoot = (env = process.env, here = dirname(new URL(import.meta.url).pathname)) =>
  env.AXF_HAND_REPO || (existsSync('/opt/axf/.git') ? '/opt/axf' : join(here, '../../../..'));
export const worktreesRoot = (env = process.env) => env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';

function git(cwd, ...a) { return spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 180e3 }); }

/** The build's worktree on its own branch claude/<id> from origin/main (made when missing); packages linked from the repo. */
export function ensureWorktree(id, env = process.env) {
  const repo = repoRoot(env);
  const dir = join(worktreesRoot(env), id);
  if (existsSync(dir)) return { dir, repo, made: false };
  mkdirSync(worktreesRoot(env), { recursive: true });
  git(repo, 'fetch', '-q', 'origin', 'main');
  const base = git(repo, 'rev-parse', '--verify', '-q', 'origin/main').status === 0 ? 'origin/main' : 'HEAD';
  const r = git(repo, 'worktree', 'add', '-B', `claude/${id}`, dir, base);
  if (r.status !== 0) throw new HandRefused('launch', `worktree for ${id}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  for (const rel of ['node_modules', 'apps/console-web/node_modules', 'apps/axhub-web/node_modules']) {
    const src = join(repo, rel); const dst = join(dir, rel);
    if (existsSync(src) && !existsSync(dst)) { try { mkdirSync(dirname(dst), { recursive: true }); symlinkSync(src, dst); } catch { /* optional */ } }
  }
  return { dir, repo, made: true };
}

/**
 * Can this host launch hand builds? The checkout to branch from, its launcher, git and tmux. → { ok, detail } with the
 * exact fix when not (the Systems check banner shows it through hooks.mjs checks).
 */
export function launchReadiness(env = process.env, { has = (cmd) => !spawnSync(cmd, ['-V'], { encoding: 'utf8', timeout: 10e3 }).error } = {}) {
  const repo = repoRoot(env);
  const launcher = env.AXF_HAND_LAUNCHER || join(repo, 'deploy', 'claude-headless.sh');
  const gitOk = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 10e3 }).status === 0;
  const missing = [
    !existsSync(join(repo, '.git')) && `no git checkout at ${repo} (set AXF_HAND_REPO to the console's checkout, normally /opt/axf)`,
    !existsSync(launcher) && `no launcher at ${launcher} (pull main into ${repo})`,
    !gitOk && 'git is not installed where the console server runs (apt-get install -y git)',
    !has('tmux') && 'tmux is not installed where the console server runs (apt-get install -y tmux): hand builds would start without a Terminal tab',
  ].filter(Boolean);
  return missing.length
    ? { ok: false, detail: `Hand builds can't launch from here: ${missing.join('; ')}.` }
    : { ok: true, detail: `Hand builds launch from ${repo} (worktrees in ${worktreesRoot(env)}), at most ${HAND_CAP} at once` };
}

/** Run deploy/claude-headless.sh in the worktree; → { status, out }. */
function runLauncher({ dir, repo, args, env }) {
  const launcher = env.AXF_HAND_LAUNCHER || join(repo, 'deploy', 'claude-headless.sh');
  const r = spawnSync('bash', [launcher, ...args], { cwd: dir, encoding: 'utf8', timeout: 180e3, env });
  return { status: r.status, out: `${r.stdout || ''}\n${r.stderr || ''}`.trim() };
}

const note = (b, text, at, by) => { b.notes = [...(b.notes ?? []), { text: String(text).slice(0, 2000), at, by }]; b.updatedAt = at; };

/**
 * Start a hand build for one Plan Studio item. `state` is the plan tree; `ref` the item (id or words).
 * Order: who asks → the model → the cap → the record (with the item link) → worktree + brief → token → launcher.
 * → { ok, state (the tree with the build link), build: { id, profile }, session, model, worktree, log, say }
 * Throws HandRefused: forbidden · model · cap · not_found · validation · launch (the record stays, marked failed).
 */
export function launchHand(state, ref, { model, buildId = '', env = process.env, sessions, spawn = runLauncher, worktree = ensureWorktree, now = () => new Date().toISOString() } = {}) {
  const who = ownerFrom(env);
  if (!who.ok) throw new HandRefused('forbidden', 'Only Brett starts a hand build, from his own signed-in console: a session, an agent, the console token, MCP, the CLI and voice cannot. Ask Brett to press Hand build on the item.');
  const key = pickModel(model);
  const it = tc.resolve(state, ref);
  if (!it) throw new HandRefused('not_found', `no item "${ref}"`);
  const live = sessions === undefined ? liveSessions(env) : sessions;
  const prof = activeProfile().id;
  const at = now();
  let id = '';
  // the cap is judged again under the store lock, so two clicks at once can't both take the last place
  BS.withStore((s) => {
    const no = capRefusal(runningHand(s.builds, { sessions: live, now: Date.parse(at) }));
    if (no) throw new HandRefused('cap', no);
    const taken = new Set(s.builds.flatMap((b) => [b.id, b.alias].filter(Boolean)));
    if (buildId && !isBuildId(buildId)) throw new HandRefused('validation', `"${buildId}" is not a build id: lower-case letters, digits and dashes, at most 40`);
    if (buildId && taken.has(buildId)) throw new HandRefused('validation', `"${buildId}" is already a build: pick another build id`);
    id = buildId || handId(it.title, taken);
    const rec = {
      id, title: it.title, detail: it.body || '', source: HAND_SOURCE, planRef: it.id, profiles: [prof], status: 'running', branch: `claude/${id}`, createdAt: at, updatedAt: at, steps: [],
      pipeline: { model: key, launchedAt: at, queuedAt: at, queuedBy: who.by, note: `mode hand · ${MODEL_LABELS[key]} · log ${worktreesRoot(env)}/${id}/${id}.log` },
      notes: [{ text: `Hand build (mode hand) started by ${who.by} from Plan Studio 2.0 item ${it.id} (${tc.pathOf(state, it.id)}) on ${MODEL_LABELS[key]}: no dispatcher, no split, no queue, no slot; at most ${HAND_CAP} hand builds at once.`, at, by: who.by }],
    };
    s.builds.push(core.normBuild(rec, { now: at, profile: prof }));
    return s;
  }, { by: who.by, action: 'plan-studio-2:hand-build', note: `${id || it.id}: hand build on ${key}` });
  const linked = tc.link(state, it.id, { type: 'build', ref: `${prof}:${id}`, label: `Hand build · ${MODEL_LABELS[key]}` });
  const fail = (why) => {
    BS.withStore((s) => { const b = core.findBuild(s, id); if (b) { b.status = 'failed'; note(b, `Hand build not started: ${why}`, now(), 'plan-studio-2'); } return s; }, { by: 'plan-studio-2', action: 'plan-studio-2:hand-build-failed', note: id });
    return new HandRefused('launch', `${id} was recorded but did not start: ${why}`, { state: linked.state, build: { id, profile: prof } });
  };
  let dir; let repo;
  try { ({ dir, repo } = worktree(id, env)); } catch (e) { throw fail(e.message); }
  writeFileSync(join(dir, '.axf-brief.md'), handBrief(state, it.id, { id, model: key, by: who.by, at }));
  // the signature every launcher gate accepts: a one-build dispatch token, spent when the session starts
  const token = issueDispatch(id, { account: 'hand', model: key, env });
  const args = ['--name', id, '--brief', '.axf-brief.md', '--log', `${id}.log`, '--', '--model', MODEL_IDS[key], ...CLAUDE_ARGS];
  const runEnv = {
    ...env, AXF_DISPATCH_TOKEN: token, AXF_SURFACE: 'hand-build', AXF_MODEL: key, AXF_BUILD_ID: id, AXF_PRIORITY: 'urgent',
    AXF_SLOTS: 'off', AXF_BUILD_LIMIT: 'off', // no orchestrator or emergency slot, past the host build limit: the hand cap is the only limit
  };
  for (const k of ['AXF_APPROVER', 'AXF_APPROVER_VIA']) delete runEnv[k]; // the session never inherits Brett's click
  let r;
  try { r = spawn({ dir, repo, args, env: runEnv }); } catch (e) { throw fail(e.message); }
  const session = /started (axf-\S+) in/.exec(r.out)?.[1] ?? '';
  const waiting = /queued for look approval/.test(r.out);
  if (r.status !== 0 || (!session && !waiting && !/started pid/.test(r.out))) throw fail((r.out.split('\n').filter(Boolean).pop() || `launcher exit ${r.status}`).slice(0, 300));
  BS.withStore((s) => { const b = core.findBuild(s, id); if (b) note(b, waiting ? 'Hand build waiting for Brett\'s look approval in UI Review; it starts by itself once he approves.' : `Hand build launched: ${session || 'started without tmux'} in ${dir}.`, now(), 'plan-studio-2'); return s; }, { by: who.by, action: 'plan-studio-2:hand-launched', note: id });
  const say = waiting ? `Hand build ${id} is recorded and waits for your look approval in UI Review.` : `Hand build ${id} launched on ${MODEL_LABELS[key]}${session ? ` (${session})` : ''}.`;
  return { ok: true, state: linked.state, build: { id, profile: prof }, session, model: key, worktree: dir, log: join(dir, `${id}.log`), waiting, say };
}

/** owner/name of the GitHub repo PRs open on (AXF_GITHUB_REPO, else the checkout's origin), '' when unknown. */
export function githubRepo(env = process.env) {
  if (env.AXF_GITHUB_REPO) return env.AXF_GITHUB_REPO;
  const url = git(repoRoot(env), 'remote', 'get-url', 'origin').stdout?.trim() ?? '';
  return /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url)?.[1] ?? '';
}

/** The hand builds of the store (optionally of one item), newest first, with their status. */
export function listHand({ item = '', env = process.env, sessions, repo = githubRepo(env) } = {}) {
  const live = sessions === undefined ? liveSessions(env) : sessions;
  const all = BS.loadStore().builds;
  const rows = all.filter((b) => isHand(b) && (!item || b.planRef === item)).map((b) => handStatus(b, { sessions: live, repo })).sort((a, b) => String(b.launchedAt).localeCompare(String(a.launchedAt)));
  const running = runningHand(all, { sessions: live });
  return { ok: true, cap: HAND_CAP, running: running.map((x) => x.id), free: Math.max(0, HAND_CAP - running.length), models: handModels(), builds: rows };
}

/** The last `lines` lines of a hand build's log (its worktree's <id>.log). */
export function handLog(id, { lines = 200, env = process.env } = {}) {
  const b = core.findBuild(BS.loadStore(), id);
  if (!isHand(b)) throw new HandRefused('not_found', `no hand build "${id}"`);
  const file = join(worktreesRoot(env), b.id, `${b.id}.log`);
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return { ok: true, id: b.id, file, text: '', missing: true }; }
  const all = text.split('\n');
  return { ok: true, id: b.id, file, text: all.slice(-Math.max(1, Math.min(Number(lines) || 200, 2000))).join('\n'), total: all.length };
}
