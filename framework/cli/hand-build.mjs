#!/usr/bin/env node
/**
 * hand-build — the hand build lane (hand-build@1, Brett, Nov 21 2026): Brett starts one build by hand from his
 * signed-in console, tracked in the builds store, without the Pipeline 2.0 dispatcher. No split, no queue.
 *
 * One hand build, in order:
 *   1. record   Brett's console click (AXF_APPROVER + AXF_APPROVER_VIA=console, emergency-builds.mjs ownerFrom) and a
 *               model he picked (Opus or Fable from the live model policy, framework/core/model-policy.mjs; there is no
 *               default) → one build record in the builds store (builds-store.mjs withStore): `mode: 'hand'`, status
 *               `running`, one step on the chosen model, `hand` = { model, by, item, brief, emergency, state }. Then
 *               the emergency grant (build-limit.mjs grantEmergency), so its session is admitted in the emergency
 *               slot pool and never takes an ordinary slot. Nothing launches before the record is written.
 *   2. launch   on the VPS host (the same path axHub's vps.build_start takes): a worktree from /opt/axf on branch
 *               claude/<id>, the brief as .brief.md, a one-build dispatch token (dispatch-gate.mjs issue, so the
 *               launcher's gate takes it), then deploy/claude-headless.sh in tmux on the chosen model.
 *               Where the request came from the console container (it has no host tmux), the host's timer
 *               (`tick`, deploy/install-hand-build.sh) launches it within seconds; elsewhere it launches at once.
 *   3. live     `tick` also keeps `hand.live` on each open hand build: launched → building (its tmux session is up) →
 *               PR #n (the session links it, or its claude/<id> branch has one) → CI (pending / green / red) → merged.
 *
 *   node framework/cli/hand-build.mjs models [--json]                  the models the picker offers (live list)
 *   … start <id> --model Opus|Fable --title "…" --brief-file f [--item id] [--source s] [--json]
 *                                                                      record (+ launch here when on the host). Brett's
 *                                                                      console only: exit 3 for anyone else
 *   … launch <id> [--json]                                             launch a recorded hand build (host)
 *   … tick [--json]                                                    host timer: launch what is recorded, refresh live state
 *   … status <id> [--json] · list [--json] · log <id> [--lines n]      read
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_MODELS, MODEL_IDS, MODEL_LABELS, modelKey } from '../core/model-policy.mjs';
import { isBuildId } from '../core/build-id.mjs';
import { findBuild, normBuild } from '../plan/builds-store-core.mjs';
import { loadStore, withStore } from './builds-store.mjs';
import { emergencyIds, grantEmergency, revokeEmergency } from './build-limit.mjs';
import { emergencyTag, isOpenHandEmergency, ownerFrom } from './emergency-builds.mjs';
import { issue as issueDispatch } from './dispatch-gate.mjs';
import { tmuxSessions } from './build-lock.mjs';

export const SCHEMA = 'hand-build@1';
export const MODE = 'hand';
/**
 * The store status a hand build holds while it is open: `running`, a builds@1 status the launch gates let hold a slot.
 * Never a Pipeline 2.0 status (`building` would make it a Pipeline 2.0 build the dispatcher splits and launches), and
 * the old dispatcher only acts on a running build that has its own `pipeline` run record, which a hand build never gets.
 */
export const OPEN_STATUS = 'running';
/** Stored launch states. `live.state` (what the item shows) is worked out from these and the facts. */
export const STATES = ['recorded', 'launching', 'launched', 'failed'];
/** What the item shows, in order. */
export const LIVE_STATES = ['recorded', 'launched', 'building', 'ended', 'pr', 'merged', 'closed', 'failed'];
export const BRIEF_MAX = 120_000;
/** How often the live refresh asks GitHub about one hand build's PR and CI. */
export const GITHUB_EVERY_MS = 60_000;
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
/** Claude Code args for the session: the same set vps.build_start passes. */
export const CLAUDE_ARGS = Object.freeze(['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'Edit', 'Write', 'MultiEdit', 'Read', 'Grep', 'Glob']);

export class HandRefused extends Error {
  /** code 3 = not Brett's console · 2 = a bad ask (model, id, item) · 4 = not on the host. */
  constructor(message, code = 2, reason = 'invalid') { super(message); this.code = code; this.reason = reason; }
}

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ models (the picker's live list) */

/** The models the picker offers: every allowed model of the policy, highest first. [{ key, name, label, id }]. */
export function modelChoices() {
  return [...ALLOWED_MODELS].reverse().map((k) => ({ key: k, name: k[0].toUpperCase() + k.slice(1), label: MODEL_LABELS[k], id: MODEL_IDS[k] }));
}

/** The picked model as its policy key. No pick, or one the policy does not allow, is refused: there is no default. */
export function requireHandModel(m) {
  const said = str(m, 80).trim();
  if (!said) throw new HandRefused('pick a model for the hand build (Opus or Fable): there is no default', 2, 'model');
  const k = modelKey(said);
  if (!k || !ALLOWED_MODELS.includes(k)) throw new HandRefused(`"${said}" is not a model a hand build may run on: pick ${modelChoices().map((c) => c.name).join(' or ')}`, 2, 'model');
  return k;
}

/* ------------------------------------------------------------------ the brief */

/** The standing rules every hand build brief carries. */
export const BRIEF_RULES = Object.freeze([
  'Clean code, comments and commits. Read only the files the task needs.',
  'Tests for what you change; run them before you push.',
  'Commit on this branch only and push it (`git push -u origin HEAD`). Never push to main.',
  'Open a PR, then link it: `node framework/cli/builds-live.mjs link <build> --branch <branch> --pr <n>`.',
  'CI must go green: if it fails, fix it and push again.',
  'Do not merge the PR yourself: it is merged once CI is green.',
  'Opus or Fable only. Heavy steps (npm/vite builds, Playwright) go through `node framework/cli/agent-slots.mjs heavy -- <cmd>`.',
]);

/**
 * The brief of a hand build: the item (title + full body), then every nested child with its body in tree order (each
 * heading one level deeper per depth), then the rules. `item` = { title, body, kind? }, `children` = [{ depth (1 =
 * direct child), title, body, kind?, done? }] in order. Pure.
 */
export function handBrief({ id, branch = `claude/${id}`, model, item, children = [], by = 'Brett' }) {
  const k = requireHandModel(model);
  const head = (depth) => '#'.repeat(Math.min(6, 2 + depth));
  const kids = children.flatMap((c) => [
    `${head(Math.max(1, Number(c.depth) || 1))} ${c.done ? '[done] ' : ''}${str(c.title, 2000)}${c.kind ? ` (${c.kind})` : ''}`,
    ...(str(c.body, 40_000).trim() ? ['', str(c.body, 40_000).trim()] : []),
    '',
  ]);
  const text = [
    `# ${str(item.title, 2000)} (hand build ${id})`,
    '',
    `Hand build ${id}, started by ${by} from Plan Studio. Model ${MODEL_LABELS[k]}. You run headless; nobody is watching.`,
    `Branch ${branch}. The build is tracked in the builds store as ${id} (mode hand): no dispatcher, no split, no queue.`,
    '',
    '## The task',
    '',
    str(item.body, 40_000).trim() || '(no notes on the item: the title is the task)',
    '',
    ...(kids.length ? ['## Everything under it, in order', '', ...kids] : []),
    '## Rules',
    ...BRIEF_RULES.map((r) => `- ${r.replace('<build>', id).replace('<branch>', branch)}`),
  ].join('\n');
  return text.length > BRIEF_MAX ? `${text.slice(0, BRIEF_MAX - 80)}\n\n(brief cut at ${BRIEF_MAX} characters)` : text;
}

/* ------------------------------------------------------------------ the record */

export const isHand = (b) => !!b && b.mode === MODE && !!b.hand && typeof b.hand === 'object';
/** A hand build still open: not deleted, not finished, its launch not failed. Its emergency grant stays while it is. */
export const isOpenHand = (b) => isHand(b) && isOpenHandEmergency(b);

/** The new build record (pure). */
export function handRecord({ id, title, brief, model, item = null, by, source = 'console', profile = '', now = nowIso() }) {
  const k = requireHandModel(model);
  const name = k === 'fable' ? 'Fable' : 'Opus';
  const tag = emergencyTag(by, now);
  return {
    id, title: str(title, 300) || id, detail: str(brief, 8000), status: OPEN_STATUS, source: str(source, 40) || 'console',
    planRef: str(item?.id, 80), branch: `claude/${id}`, createdAt: now, updatedAt: now, ...(profile ? { profiles: [profile] } : {}),
    steps: [{ id: 's1', text: str(title, 2000) || id, model: name }],
    notes: [{ text: `Hand build started by ${tag.by} (${MODEL_LABELS[k]}): no dispatcher, no split, no queue. Signed as emergency: it takes one emergency slot.${item?.id ? ` Plan item ${item.id}.` : ''}`, at: now, by: tag.by }],
    mode: MODE,
    hand: {
      $axf: SCHEMA, model: name, modelId: MODEL_IDS[k], by: tag.by, at: now, emergency: tag,
      item: item ? { id: str(item.id, 80), title: str(item.title, 300), path: str(item.path, 600) } : null,
      brief: str(brief, BRIEF_MAX), state: 'recorded', session: '', worktree: '', log: '', launchedAt: '', error: '', live: { state: 'recorded', at: now },
    },
  };
}

/**
 * Step 1: Brett's ask → the record in the builds store and the emergency grant. Refused before anything is written
 * when it is not Brett's console (HandRefused 3) or no model was picked (HandRefused 2). → the stored record.
 */
export function recordHandBuild({ id, title, brief, model, item = null, source = 'console', profile = '', env = process.env }) {
  const who = ownerFrom(env);
  if (!who.ok) throw new HandRefused(who.why.replace('sends a build to emergency', 'starts a hand build'), 3, 'forbidden');
  requireHandModel(model);
  if (!isBuildId(id)) throw new HandRefused(`"${id}" is not a build id (lowercase letters, digits and dashes, at most 40)`, 2, 'id');
  if (!str(brief).trim()) throw new HandRefused('the brief is empty', 2, 'brief');
  let rec = null;
  withStore((s) => {
    const old = findBuild(s, id);
    if (old && !old.deleted) throw new HandRefused(`"${id}" is already a build (${old.status}): pick another build id`, 2, 'taken');
    const raw = handRecord({ id, title, brief, model, item, by: who.by, source, profile });
    rec = normBuild(raw, profile ? { profile } : {});
    rec.mode = raw.mode; rec.hand = raw.hand; // normBuild keeps only the fields it knows; the store keeps these on every later write
    s.builds.push(rec);
    return s;
  }, { by: who.by, action: 'hand-build:record', note: `${id} (${rec?.hand?.model ?? model})` });
  grantEmergency(id, { by: who.by, owner: true });
  return findBuild(loadStore(), id);
}

/** Change one hand build's `hand` block under the store lock. `fn(hand, b)` returns false to leave it. → the build, or null. */
function patchHand(id, fn, { by = 'hand-build', action = 'hand-build:state', note = '' } = {}) {
  let out = null;
  withStore((s) => {
    const b = findBuild(s, id);
    if (!isHand(b)) return s;
    if (fn(b.hand, b) === false) return s;
    b.updatedAt = nowIso(); out = b;
    return s;
  }, { by, action, note: note || id });
  return out;
}

/* ------------------------------------------------------------------ step 2: launch on the host */

export const worktreesRoot = (env = process.env) => env.AXF_HAND_WORKTREES || env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
/** Where this process is: the console container has no host tmux, so its launches go to the host's timer. */
export const launchHere = (env = process.env) => (env.AXF_HAND_LAUNCH ? env.AXF_HAND_LAUNCH === 'here' : !existsSync('/.dockerenv'));

/** The worktree: from fresh origin/main of the host checkout, on branch claude/<id> (what vps.build_start does). */
export function cutWorktree(id, env = process.env) {
  const dir = join(worktreesRoot(env), id);
  if ((env.AXF_HAND_WORKTREE_MODE || 'git') === 'mkdir') { mkdirSync(dir, { recursive: true }); return dir; }
  if (existsSync(dir)) throw new Error(`${dir} already exists: a worktree is never reused for a new hand build`);
  const root = env.AXF_HAND_REPO || REPO_ROOT;
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8', timeout: 300e3 });
  git('fetch', '-q', 'origin', 'main');
  const base = git('rev-parse', '--verify', '-q', 'origin/main').status === 0 ? 'origin/main' : 'HEAD';
  mkdirSync(worktreesRoot(env), { recursive: true });
  const r = git('worktree', 'add', '-B', `claude/${id}`, dir, base);
  if (r.status !== 0) throw new Error(`worktree for ${id}: ${str((r.stderr || r.stdout).trim(), 300)}`);
  for (const rel of ['node_modules', 'apps/console-web/node_modules', 'apps/axhub-web/node_modules']) { // installed packages come from the host checkout
    const src = join(root, rel); const dst = join(dir, rel);
    if (existsSync(src) && !existsSync(dst)) { try { mkdirSync(dirname(dst), { recursive: true }); symlinkSync(src, dst); } catch { /* optional */ } }
  }
  return dir;
}

/**
 * Step 2: start a recorded hand build. Claims it (recorded → launching) under the store lock so two ticks never start
 * it twice, checks its emergency grant is on file, cuts the worktree, writes the brief, issues the dispatch token and
 * runs the launcher. → { ok, id, session, worktree } · { ok: false, error } (the build is marked failed, its grant goes).
 */
export function launchHandBuild(id, { env = process.env, launcher = env.AXF_HAND_LAUNCHER || join(REPO_ROOT, 'deploy', 'claude-headless.sh'), cut = cutWorktree } = {}) {
  if (!emergencyIds().includes(id)) return fail(id, 'no emergency grant on file: only a hand build Brett started from his console launches');
  const claimed = patchHand(id, (h) => { if (h.state !== 'recorded') return false; h.state = 'launching'; return true; }, { action: 'hand-build:launching' });
  if (!claimed) return { ok: false, id, error: `${id} is not a recorded hand build waiting to launch` };
  const h = claimed.hand;
  let dir = '';
  try {
    dir = cut(id, env);
    writeFileSync(join(dir, '.brief.md'), `${h.brief}\n`);
    writeFileSync(join(dir, '.axf-hand-build.json'), `${JSON.stringify({ $axf: SCHEMA, id, model: h.model, by: h.by, at: h.at, item: h.item?.id ?? '' })}\n`); // axf-data: not data (a git-ignored launch marker in the build's own worktree, like .brief.md)
    const token = issueDispatch(id, { account: '', model: h.model, env });
    const key = requireHandModel(h.model);
    const args = ['--name', id, '--brief', '.brief.md', '--log', `${id}.log`, '--', '--model', MODEL_IDS[key], ...CLAUDE_ARGS];
    const e = { ...Object.fromEntries(Object.entries(env).filter(([k2]) => !['AXF_APPROVER', 'AXF_APPROVER_VIA'].includes(k2))), HOME: env.HOME || homedir() || '/root', AXF_DISPATCH_TOKEN: token, AXF_SURFACE: 'hand', AXF_MODEL: key, AXF_BUILD_ID: id, AXF_PIPELINE_EXIT: 'off' };
    const r = spawnSync('bash', [launcher, ...args], { cwd: dir, encoding: 'utf8', timeout: 120e3, env: e });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    const session = /started (axf-\S+) in/.exec(text)?.[1] ?? '';
    const queued = /queued (?:at position \d+|for look approval)/.test(text);
    if (r.status !== 0 || (!session && !queued)) throw new Error(`launcher exit ${r.status}: ${str(text.trim().split('\n').filter(Boolean).pop() || 'no output', 300)}`);
    const at = nowIso();
    patchHand(id, (x) => { Object.assign(x, { state: 'launched', session, worktree: dir, log: join(dir, `${id}.log`), launchedAt: at, error: '', live: { state: 'launched', at } }); }, { action: 'hand-build:launched', note: `${id} ${session || 'queued'}` });
    return { ok: true, id, session, queued: !session, worktree: dir };
  } catch (err) { return fail(id, str(err.message), dir); }
}

function fail(id, why, dir = '') {
  const at = nowIso();
  patchHand(id, (x, b) => { Object.assign(x, { state: 'failed', error: why, ...(dir ? { worktree: dir } : {}), live: { state: 'failed', at, why } }); b.notes = [...(b.notes ?? []), { text: `Hand build did not launch: ${why}`, at, by: 'hand-build' }]; }, { action: 'hand-build:failed' });
  revokeEmergency(id, { by: 'hand-build' });
  return { ok: false, id, error: why };
}

/**
 * Step 1 then step 2 where this process can launch (the host), else leaves it for the host's timer.
 * → { ok, id, build, launch: { ok, session } | { pending: true } }.
 */
export function startHandBuild(opts, { env = opts.env ?? process.env, launch = launchHandBuild } = {}) {
  const b = recordHandBuild({ ...opts, env });
  if (!launchHere(env)) return { ok: true, id: b.id, build: b, launch: { pending: true, why: 'the host launches it within a few seconds (hand build timer)' } };
  return { ok: true, id: b.id, build: findBuild(loadStore(), b.id), launch: launch(b.id, { env }) };
}

/* ------------------------------------------------------------------ step 3: live state */

/**
 * What the item shows (pure). facts = { alive: true | false | null (unknown), pr: { number, state: open|closed, merged,
 * ci: pending|green|red|'' , url } | null }.
 */
export function liveState(b, facts = {}, now = nowIso()) {
  const h = b?.hand ?? {};
  if (h.state === 'failed') return { state: 'failed', at: now, why: h.error };
  if (h.state === 'recorded' || h.state === 'launching') return { state: 'recorded', at: now };
  const pr = facts.pr ?? null;
  const base = { at: now, session: h.session || '', alive: facts.alive ?? null };
  if (pr?.merged) return { ...base, state: 'merged', pr: pr.number, ci: pr.ci || '', url: pr.url || '' };
  if (pr && pr.state === 'closed') return { ...base, state: 'closed', pr: pr.number, ci: pr.ci || '', url: pr.url || '' };
  if (pr) return { ...base, state: 'pr', pr: pr.number, ci: pr.ci || 'pending', url: pr.url || '' };
  if (facts.alive) return { ...base, state: 'building' };
  if (facts.alive === false && h.live?.state && h.live.state !== 'launched') return { ...base, state: 'ended' };
  return { ...base, state: facts.alive === false ? 'ended' : 'launched' };
}

/** CI of a PR head from its check runs: red when any failed, pending while any runs, else green ('' = none yet). */
export function ciOf(runs = []) {
  if (!runs.length) return '';
  if (runs.some((r) => ['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required'].includes(r.conclusion))) return 'red';
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  return 'green';
}

async function prFacts(b, gh, repo) {
  const n = Number(String(b.pr || '').replace(/^#/, '').match(/(\d+)\s*$/)?.[1]) || 0;
  let pr = null;
  if (n) pr = await gh.json('GET', `/repos/${repo}/pulls/${n}`);
  else {
    const owner = repo.split('/')[0];
    const list = await gh.json('GET', `/repos/${repo}/pulls?state=all&head=${encodeURIComponent(`${owner}:${b.branch || `claude/${b.id}`}`)}&per_page=1`);
    pr = Array.isArray(list) ? list[0] ?? null : null;
  }
  if (!pr) return null;
  let ci = '';
  try { const c = await gh.json('GET', `/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`); ci = ciOf(c.check_runs ?? []); } catch { /* CI unknown */ }
  return { number: pr.number, state: pr.state, merged: !!pr.merged_at, ci, url: pr.html_url };
}

/** Refresh every open hand build's live state (host: tmux + GitHub). → [{ id, state }]. */
export async function refreshLive({ env = process.env, gh = null, repo = '' } = {}) {
  const open = loadStore().builds.filter((b) => isOpenHand(b) && b.hand.state === 'launched');
  if (!open.length) return [];
  let client = gh; let name = repo;
  if (!client) { try { const G = await import('./github.mjs'); client = G.createGitHub({ userAgent: 'axf-hand-build' }); } catch { client = null; } }
  if (!name) { try { name = (await import('./stale-facts.mjs')).repoName(REPO_ROOT); } catch { name = ''; } }
  const out = [];
  for (const b of open) {
    let alive = null; try { alive = tmuxSessions(b.id, env).length > 0; } catch { alive = null; }
    // GitHub at most once a minute per build (the timer runs every 10 s): between asks the last PR facts stand
    const mark = b.hand.worktree ? join(b.hand.worktree, '.axf-hand-checked') : '';
    const due = !mark || !existsSync(mark) || Date.now() - statSync(mark).mtimeMs >= GITHUB_EVERY_MS;
    const last = b.hand.live?.pr ? { number: b.hand.live.pr, state: b.hand.live.state === 'closed' ? 'closed' : 'open', merged: b.hand.live.state === 'merged', ci: b.hand.live.ci ?? '', url: b.hand.live.url ?? '' } : null;
    let pr = last;
    if (due && client && name) { try { pr = await prFacts(b, client, name); if (mark) writeFileSync(mark, `${nowIso()}\n`); } catch { pr = last; } }
    const live = liveState(b, { alive, pr });
    const was = JSON.stringify({ ...b.hand.live, at: '' }); const next = JSON.stringify({ ...live, at: '' });
    if (was !== next) {
      patchHand(b.id, (h, rec) => {
        h.live = live;
        if (live.pr && !rec.pr) rec.pr = `#${live.pr}`;
        if (live.state === 'merged') { rec.mergedAt = rec.mergedAt || live.at; revokeEmergency(rec.id, { by: 'hand-build' }); }
        if (live.state === 'closed') revokeEmergency(rec.id, { by: 'hand-build' });
      }, { action: 'hand-build:live', note: `${b.id} ${live.state}` });
    }
    out.push({ id: b.id, state: live.state });
  }
  return out;
}

/** The host timer's pass: launch every recorded hand build, then refresh the live state of the open ones. */
export async function tick({ env = process.env } = {}) {
  const waiting = loadStore().builds.filter((b) => isHand(b) && !b.deleted && b.hand.state === 'recorded');
  const launched = waiting.map((b) => launchHandBuild(b.id, { env }));
  const live = await refreshLive({ env });
  return { ok: true, launched, live };
}

/* ------------------------------------------------------------------ reads */

/** What a reader sees of a hand build (never the brief). */
export function view(b) {
  if (!isHand(b)) return null;
  const { brief, ...h } = b.hand;
  return { id: b.id, title: b.title, status: b.status, branch: b.branch, pr: b.pr, planRef: b.planRef, ...h, briefChars: str(brief, BRIEF_MAX).length, live: b.hand.live ?? { state: b.hand.state } };
}
export const list = (store = loadStore()) => store.builds.filter((b) => isHand(b) && !b.deleted).map(view);
export const status = (id, store = loadStore()) => view(findBuild(store, id));

/** The last lines of a hand build's log. The console container sees the host's worktrees under /hostfs. */
export function logTail(id, { lines = 200, store = loadStore(), env = process.env } = {}) {
  const v = status(id, store);
  if (!v) throw new HandRefused(`no hand build "${id}"`, 2, 'not_found');
  if (!v.log) return { ok: true, id, log: '', lines: [], why: 'no log yet: it has not launched' };
  const host = worktreesRoot(env);
  const seen = [v.log, v.log.startsWith(`${host}/`) ? join(env.AXF_HAND_WORKTREES_SEEN || '/hostfs/axf-builds', v.log.slice(host.length + 1)) : ''].filter(Boolean).find((f) => existsSync(f));
  if (!seen) return { ok: true, id, log: v.log, lines: [], why: 'the log is on the VPS host and not visible from here' };
  const all = readFileSync(seen, 'utf8').split('\n');
  return { ok: true, id, log: v.log, lines: all.slice(-Math.max(1, Math.min(Number(lines) || 200, 2000))) };
}

/* ------------------------------------------------------------------ CLI */

function flags(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[a.slice(2)] = true; else { o[a.slice(2)] = v; i++; } } else o._.push(a); }
  return o;
}

async function cli(argv) {
  const f = flags(argv); const [cmd = 'list', id = ''] = f._;
  const print = (o, text) => console.log(f.json ? JSON.stringify(o) : text);
  try {
    switch (cmd) {
      case 'models': { const m = modelChoices(); return print({ ok: true, models: m }, m.map((x) => `${x.name} (${x.label}, ${x.id})`).join('\n')); }
      case 'start': {
        const brief = f['brief-file'] ? readFileSync(f['brief-file'], 'utf8') : '';
        const r = startHandBuild({ id, title: f.title || id, brief, model: f.model === true ? '' : f.model, item: f.item ? { id: f.item } : null, source: f.source || 'cli' });
        return print(r, `${r.id} recorded${r.launch.pending ? ': the host launches it' : r.launch.ok ? `, launched ${r.launch.session || '(queued)'}` : `, launch failed: ${r.launch.error}`}`);
      }
      case 'launch': { const r = launchHandBuild(id); if (!r.ok) process.exitCode = 1; return print(r, r.ok ? `${id} launched ${r.session || '(queued)'}` : `${id}: ${r.error}`); }
      case 'tick': { const r = await tick(); return print(r, `launched ${r.launched.filter((x) => x.ok).length}/${r.launched.length} · live ${r.live.map((x) => `${x.id} ${x.state}`).join(', ') || 'none open'}`); }
      case 'status': { const v = status(id); if (!v) throw new HandRefused(`no hand build "${id}"`, 2); return print({ ok: true, build: v }, `${v.id} · ${v.live.state}${v.live.pr ? ` · PR #${v.live.pr}${v.live.ci ? ` CI ${v.live.ci}` : ''}` : ''} · ${v.model} · by ${v.by}`); }
      case 'list': { const l = list(); return print({ ok: true, builds: l }, l.map((v) => `${v.id} · ${v.live.state} · ${v.model}`).join('\n') || 'no hand builds'); }
      case 'log': { const r = logTail(id, { lines: f.lines }); return print(r, r.lines.join('\n') || r.why); }
      default: throw new HandRefused('usage: hand-build.mjs models | start <id> --model m --title t --brief-file f | launch <id> | tick | status <id> | list | log <id>', 2);
    }
  } catch (e) {
    process.exitCode = e instanceof HandRefused ? e.code : 1;
    if (f.json) console.log(JSON.stringify({ ok: false, error: e.message, reason: e.reason ?? 'error' })); else console.error(`hand-build: ${e.message}`);
  }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) await cli(process.argv.slice(2));
