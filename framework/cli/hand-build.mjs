#!/usr/bin/env node
/**
 * hand-build — a hand build's record in the builds store (hand-build@1; Brett, Nov 23 2026: hand builds had no record,
 * so they had no steps to tick, nothing to link, and the lander never saw their green PRs).
 *
 * A hand build is a headless session somebody started outside the orchestrator (axHub vps.build_start, a console
 * launch) in a build worktree: a git worktree on the branch `claude/<session name>`. The launcher
 * (deploy/claude-headless.sh) calls `start` once the session really runs and `exit` when it ends:
 *
 *   start   one Pipeline 2.0 build, tagged `hand: { at, by }`, with one step (`s1`) that is already `building` in the
 *           session's worktree, on its branch. It runs beside the one active build (the contract's besideLine): it
 *           never waits for the active place and never holds it. Started again by hand after a stop or a crash, the
 *           same record carries on.
 *   exit    0 with commits on the branch: the branch is pushed, the step is `completed` and the build is
 *           `build-complete`, so the lander lands it like any other build (one PR, main pulled in, CI, merged).
 *           0 with nothing on the branch: archived, nothing to land.
 *           stopped by hand (SIGINT / SIGTERM): archived; starting it again brings it back.
 *           anything else: `failed` at building. It is never relaunched by the dispatcher or the watchdog: a hand
 *           build is started by hand.
 *   sweep   the dispatcher's tick calls this: a hand build whose session is gone without an `exit` call (the host
 *           rebooted, tmux was killed) is ended from the session-end event, or as a crash when there is none.
 *
 *   node framework/cli/hand-build.mjs start --name <session name> --session <tmux> --dir <worktree> [--model m] [--brief file] [--account a] [--by who]
 *   node framework/cli/hand-build.mjs exit  --name <session name> [--session <tmux>] --exit <n> [--kind phase-done|stopped|crash]
 *   node framework/cli/hand-build.mjs sweep [--json]
 *   node framework/cli/hand-build.mjs list [--json]
 *
 * Environment: AXF_HAND_BUILDS=off (the launcher skips both calls), AXF_HAND_GIT=off (tests: no git, the branch comes
 * from AXF_HAND_BRANCH and the commit count from AXF_HAND_AHEAD), AXF_HEADLESS_DIR (events.jsonl), AXF_P2_ALIVE (a
 * comma list of live tmux sessions instead of tmux).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P2 from '../core/pipeline-status.mjs';
import * as core from '../plan/builds-store-core.mjs';
import { modelKey } from '../core/model-policy.mjs';
import { activeProfile } from './persist.mjs';
import { loadStore, setFlowStatus, withStore } from './builds-store.mjs';
import { crewSay } from './crew-say.mjs';

export const SCHEMA = 'hand-build@1';
export const STEP = 's1';
/** A sweep leaves a session this long to show up in tmux and to write its own exit. */
export const SWEEP_GRACE_MS = 3 * 60e3;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const nowIso = () => new Date().toISOString();
const say = (kind, text, ref) => { try { crewSay('dispatcher', kind, text, { ref }); } catch { /* the chat is a courtesy */ } };

/** The build id of a session name: `axf-<id>`, `<id>`. */
export const idOf = (name) => str(name, 120).replace(/^axf-/, '').replace(/^build:/, '').trim();
/** The model label a step carries (Fable or Opus), from a Claude model id or key. */
export const modelLabel = (model) => (modelKey(model) === 'fable' ? 'Fable' : 'Opus');
/** The brief's title: its first heading, else its first line. */
export function titleOf(brief, fallback = '') {
  const lines = str(brief, 20000).split('\n').map((l) => l.trim()).filter(Boolean);
  const h = lines.find((l) => /^#\s+\S/.test(l));
  return str((h ? h.replace(/^#+\s+/, '') : lines[0] || fallback).replace(/^Build:\s*/i, ''), 300) || fallback;
}

const git = (dir, args, env = process.env) => {
  if (env.AXF_HAND_GIT === 'off') return { code: 1, out: '' };
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 120e3 });
  return { code: r.status ?? 1, out: str(r.stdout, 4000).trim() };
};
/** The worktree's branch ('' when it is not a git checkout or sits on a detached head). */
export function branchOf(dir, env = process.env) {
  if (env.AXF_HAND_GIT === 'off') return str(env.AXF_HAND_BRANCH, 200);
  const r = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], env);
  return r.code === 0 && r.out !== 'HEAD' ? r.out : '';
}
/** Commits the branch holds that main does not. */
export function aheadOf(dir, env = process.env) {
  if (env.AXF_HAND_GIT === 'off') return Number(env.AXF_HAND_AHEAD ?? 1) || 0;
  git(dir, ['fetch', '-q', 'origin', 'main'], env);
  const r = git(dir, ['rev-list', '--count', 'origin/main..HEAD'], env);
  return r.code === 0 ? Number(r.out) || 0 : 0;
}
/** Put the branch on GitHub when it holds commits GitHub lacks (the lander merges from GitHub, never from a folder). */
function pushBranch(dir, branch, env = process.env) {
  if (env.AXF_HAND_GIT === 'off') return true;
  const remote = git(dir, ['rev-parse', '-q', '--verify', `refs/remotes/origin/${branch}`], env);
  const head = git(dir, ['rev-parse', 'HEAD'], env);
  if (remote.code === 0 && remote.out === head.out) return true;
  return git(dir, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], env).code === 0;
}

/**
 * Is this launch a hand build: a session named <id> in a checkout on the branch claude/<id> (the worktree
 * vps.build_start and the console's launch cut for it)? → { ok, why, id, branch }. Walkthroughs, UI shot jobs, chats
 * and test launches run on main or on a branch that is not their own.
 */
export function eligible({ name = '', dir = '', env = process.env } = {}) {
  const id = idOf(name);
  if (!ID_RE.test(id)) return { ok: false, why: `"${id}" is not a build id` };
  if (!dir || !existsSync(dir)) return { ok: false, why: 'no worktree folder' };
  const branch = branchOf(dir, env);
  if (branch !== `claude/${id}`) return { ok: false, why: `branch ${branch || '(none)'} is not this session's build branch (claude/${id})` };
  return { ok: true, why: '', id, branch };
}

const stepNow = (b) => (b?.steps ?? []).find((s) => s.id === STEP) ?? null;
const out = (b) => ['sending', 'building'].includes(b?.status);
const ended = (b) => (b?.status === P2.FAILED && ['sending', 'building'].includes(b.failedFrom)) || (b?.status === P2.EXIT && ['sending', 'building'].includes(P2.archivedFromOf(b)));

/**
 * The session started: file the record, or carry an ended one on. → { ok, id, created?, resumed?, skipped?, why }.
 * A name that already belongs to a build of the orchestrator's, or to a hand build that is landing or landed, is left
 * exactly as it is.
 */
export function start({ name = '', session = '', dir = '', model = '', brief = '', account = '', by = process.env.AXF_ACTOR || 'hand', env = process.env } = {}) {
  const e = eligible({ name, dir, env });
  if (!e.ok) return { ok: false, skipped: true, why: e.why };
  const at = nowIso(); const label = modelLabel(model);
  const have = core.findBuild(loadStore(), e.id);
  const run = { model: label, worktree: resolve(dir), branch: e.branch, tmux: str(session, 120), ...(account ? { account: str(account, 80) } : {}) };
  if (have && !P2.isHand(have)) return { ok: true, id: e.id, skipped: true, why: `${e.id} is an orchestrator build: its record is the orchestrator's` };
  if (have) {
    if (!out(have) && !ended(have)) return { ok: true, id: e.id, skipped: true, why: `${e.id} is ${P2.labelOf(have.status, have.attempt)}: the record stays as it is` };
    const why = `started again by hand (${session || 'session'})`;
    const s = stepNow(have);
    if (s && s.status !== 'building') setFlowStatus(e.id, 'building', { step: STEP, by, why, reset: s.status === P2.FAILED, extra: run });
    else if (s) setFlowStatus(e.id, 'building', { step: STEP, by, extra: run });
    if (have.status !== 'building') setFlowStatus(e.id, 'building', { by, why, reset: have.status === P2.FAILED, mutate: (rec) => { delete rec.failure; delete rec.budgetStop; rec.notes.push({ text: `Hand build ${why}.`, at, by }); } });
    return { ok: true, id: e.id, resumed: true, why };
  }
  const title = titleOf(brief, e.id);
  const prof = activeProfile().id;
  withStore((s) => {
    if (core.findBuild(s, e.id)) return s; // filed by a second start in the same moment
    const step = P2.transition({ id: STEP, text: title, phase: 1, ...run }, 'building', { at, by, kind: 'step', why: `hand launch: ${session || 'session'}` }).rec;
    const b = P2.transition({
      id: e.id, title, detail: str(brief, 8000), source: 'hand', branch: e.branch, profiles: [prof], createdAt: at, updatedAt: at, flow: P2.FLOW,
      hand: { at, by: str(by, 80) },
      notes: [{ text: `Hand build: started outside the orchestrator as ${session || e.id} on ${label}, in ${resolve(dir)} on ${e.branch}. It runs beside the active build; when its session ends cleanly the lander lands it.`, at, by }],
      steps: [step],
    }, 'building', { at, by, why: 'hand launch' }).rec;
    s.builds.push(core.normBuild(b, { now: at, profile: prof }));
    return s;
  }, { by, action: 'hand-build:start', note: e.id });
  return { ok: true, id: e.id, created: true, why: '' };
}

/**
 * The session ended. → { ok, id, status, why }. Only a hand build whose step is out (sending / building) is ended, and
 * only by its own session when one is named: a late call from an older session changes nothing.
 */
export function exit({ name = '', session = '', exit: code = 0, kind = '', by = 'headless', env = process.env } = {}) {
  const id = idOf(name);
  const b = core.findBuild(loadStore(), id);
  if (!b || !P2.isHand(b)) return { ok: false, id, why: `${id} is not a hand build` };
  const s = stepNow(b);
  if (!s || !['sending', 'building'].includes(s.status)) return { ok: true, id, status: b.status, why: `${id} is ${P2.labelOf(b.status, b.attempt)}: nothing to end` };
  if (session && s.tmux && s.tmux !== session) return { ok: true, id, status: b.status, why: `${id} runs in ${s.tmux}, not ${session}: nothing to end` };
  const at = nowIso(); const n = Number(code) || 0;
  const how = kind || (n === 0 ? 'phase-done' : [130, 143].includes(n) ? 'stopped' : 'crash');
  const note = (text) => (rec) => { rec.notes.push({ text, at, by }); };
  if (how === 'stopped') {
    setFlowStatus(id, P2.EXIT, { by, why: 'stopped by hand', mutate: note('Hand build stopped by hand: archived, nothing is landed. Starting it again under the same name brings it back.') });
    return { ok: true, id, status: P2.EXIT, why: 'stopped by hand' };
  }
  if (n !== 0 || how === 'crash') {
    const why = `session exit ${n}`;
    setFlowStatus(id, P2.FAILED, { step: STEP, by, why });
    setFlowStatus(id, P2.FAILED, { by, why, mutate: note(`Hand build failed: its session ended with exit ${n}. Nothing relaunches a hand build: start it again under the same name to carry on in ${s.worktree || 'its worktree'}.`) });
    say('failed', `${id}: the hand build's session ended with exit ${n}. Start it again to carry on.`, id);
    return { ok: true, id, status: P2.FAILED, why };
  }
  const dir = s.worktree || '';
  const ahead = dir && existsSync(dir) ? aheadOf(dir, env) : 0;
  if (!ahead) {
    setFlowStatus(id, P2.EXIT, { by, why: 'ended with nothing to land', mutate: note(`Hand build ended cleanly with no commit on ${s.branch || 'its branch'} that main lacks: archived, nothing to land.`) });
    return { ok: true, id, status: P2.EXIT, why: 'nothing to land' };
  }
  if (!pushBranch(dir, s.branch || b.branch, env)) {
    const why = `${s.branch || b.branch} could not be pushed`;
    setFlowStatus(id, P2.FAILED, { step: STEP, by, why });
    setFlowStatus(id, P2.FAILED, { by, why, mutate: note(`Hand build ended cleanly but ${why}: the lander merges from GitHub. Push the branch and start it again, or push it and run \`node framework/cli/hand-build.mjs exit --name ${id} --exit 0\`.`) });
    return { ok: true, id, status: P2.FAILED, why };
  }
  setFlowStatus(id, 'completed', { step: STEP, by, why: 'session ended cleanly' });
  setFlowStatus(id, 'build-complete', { by, why: 'the hand session ended cleanly', mutate: note(`Hand build finished (${ahead} commit${ahead === 1 ? '' : 's'} on ${s.branch || b.branch}). Over to the lander.`) });
  say('done', `${id}: the hand build finished. Over to the lander.`, id);
  return { ok: true, id, status: 'build-complete', why: '' };
}

const aliveSet = (env) => {
  if (env.AXF_P2_ALIVE !== undefined) return new Set(env.AXF_P2_ALIVE.split(',').filter(Boolean));
  const r = spawnSync('tmux', ['ls', '-F', '#S'], { encoding: 'utf8' });
  return r.status === 0 ? new Set(r.stdout.split('\n').filter(Boolean)) : /no server running|error connecting/.test(r.stderr || '') ? new Set() : null;
};
/** How a session ended, from the launcher's events file: { exit, kind } or null. */
function endEvent(session, env) {
  try {
    const f = join(env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless', 'events.jsonl');
    const t = spawnSync('tail', ['-n', '4000', f], { encoding: 'utf8' }).stdout || '';
    const line = t.split('\n').filter((l) => l.includes(`"session":"${session}"`) && l.includes('session-end')).pop();
    if (!line) return null;
    const e = JSON.parse(line);
    return { exit: Number(e.exit) || 0, kind: str(e.kind, 20) };
  } catch { return null; }
}

/** End every hand build whose session is gone without its own exit call. → [{ id, status, why }] */
export function sweep({ env = process.env, now = Date.now() } = {}) {
  const alive = aliveSet(env); if (!alive) return [];
  const done = [];
  for (const b of P2.handBuilds(loadStore().builds)) {
    const s = stepNow(b);
    if (!s || !s.tmux || alive.has(s.tmux)) continue;
    if (now - Date.parse(s.statusAt || b.statusAt || 0) < SWEEP_GRACE_MS) continue;
    const e = endEvent(s.tmux, env) ?? { exit: 1, kind: 'crash' };
    try { const r = exit({ name: b.id, session: s.tmux, exit: e.exit, kind: e.kind, by: 'orchestrator', env }); done.push({ id: b.id, status: r.status, why: r.why }); }
    catch (err) { done.push({ id: b.id, status: b.status, why: str(err.message) }); }
  }
  return done;
}

/** Every hand build on record. */
export const list = (store = loadStore()) => store.builds.filter((b) => P2.isHand(b) && !b.deleted).map((b) => ({ id: b.id, title: b.title, status: b.status, label: P2.labelOf(b.status, b.attempt), branch: b.branch, pr: b.pr, session: stepNow(b)?.tmux ?? '', at: b.hand.at, by: b.hand.by }));

function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  const json = rest.includes('--json');
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'start') {
    const f = flag('brief'); const dir = flag('dir', process.cwd());
    const brief = f ? (() => { try { return readFileSync(resolve(dir, f), 'utf8'); } catch { return ''; } })() : '';
    const r = start({ name: flag('name'), session: flag('session'), dir, model: flag('model'), brief, account: flag('account'), by: flag('by', process.env.AXF_ACTOR || 'hand') });
    return print(r, r.created ? `hand build ${r.id}: on record (building)` : r.resumed ? `hand build ${r.id}: ${r.why}` : `no hand build record: ${r.why}`);
  }
  if (cmd === 'exit') {
    const r = exit({ name: flag('name'), session: flag('session'), exit: Number(flag('exit', '0')), kind: flag('kind'), by: flag('by', 'headless') });
    return print(r, r.ok ? `hand build ${r.id}: ${r.status}${r.why ? ` (${r.why})` : ''}` : r.why);
  }
  if (cmd === 'sweep') { const r = sweep(); return print({ ok: true, ended: r }, r.length ? r.map((x) => `${x.id}: ${x.status}${x.why ? ` (${x.why})` : ''}`).join('\n') : 'no hand build ended'); }
  if (cmd === 'list') { const r = list(); return print({ ok: true, builds: r }, r.length ? r.map((x) => `${x.id}: ${x.label}${x.pr ? ` · PR ${x.pr}` : ''}${x.session ? ` · ${x.session}` : ''}`).join('\n') : 'no hand builds'); }
  console.error('usage: hand-build.mjs start | exit | sweep | list (see the header)'); process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`hand-build: ${e.message}`); process.exitCode = 1; }
}
