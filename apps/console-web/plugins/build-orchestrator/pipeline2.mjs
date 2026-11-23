#!/usr/bin/env node
/**
 * pipeline2.mjs — the Pipeline 2.0 orchestrator flow and dispatcher (pipeline-2@1, framework/spec/PIPELINE-2.md).
 * Runs on the VPS host (worktrees, tmux, the Claude logins). Everything is a status in the builds store, forward-only;
 * the pure decisions are framework/core/pipeline-status.mjs.
 *
 *   pending → splitting → split          every Pipeline 2.0 build sent from Plan Studio arrives as one plan (title,
 *                                        body, planning steps; no build steps): Fable designs the build steps, each
 *                                        with minutes and a model (one per planning step when Fable cannot answer);
 *                                        a build that already has steps is cut into as many parts as there are slots,
 *                                        parts never sharing files
 *   split → pulling-main                 only when no other build is active (one active build at a time)
 *   pulling-main                         one step at a time: its worktree cut at <worktrees>/<build>--<step> on
 *                                        claude/<build>--<step> from fresh origin/main (cut BEFORE launch, never at launch)
 *   assigning-models → ready             Fable where needed, Opus otherwise
 *   ready → sending → building           steps go out one at a time to each free slot (never waiting for every slot), on
 *                                        the account with usage left that has the fewest of this build's steps; up to
 *                                        stepsInParallel (default 4) steps of the build run at once, each in its own
 *                                        worktree, under the VPS-wide slot cap
 *   building → build-complete            every step completed (a step exit is written the moment it happens)
 *   failed (attempt N)                   a launch failure or a usage-limit exit retries forward at once on another
 *                                        account as attempt N + 1; there is no bench. A build that failed while it
 *                                        waited at split is activated again like any waiting build. At maxAttempts (the
 *                                        contract's ceiling, P2.MAX_ATTEMPTS; the watchdog's setting may lower it) the
 *                                        give-up is final: the record stays failed, the contract refuses every move,
 *                                        and only a reset moves it on (the watchdog's Fable escalation, or Brett's
 *                                        `orchestrator.mjs retry <build>`: retryBuild below)
 *
 * Emergency builds (Brett, Nov 20 2026): a build Brett sent to emergency from his signed-in console (`emergency` on
 * the build, framework/cli/emergency-builds.mjs) skips the line. It is split like any other, then goes straight to
 * pulling-main whatever else is active, and its steps go out to the EMERGENCY slot pool (2 places, counted apart from
 * the orchestrator's slots by the VPS hard limit and the slot queue). The orchestrator never puts an ordinary build's
 * step in an emergency slot, and an emergency build never takes or waits for the one active place.
 *
 * Triggers (more than one, so ready can never sit): the orchestrator tick (cron, every minute: orchestrator.mjs tick
 * runs pipeline.mjs tick, which calls advance(); `tick --build <id>` runs advance() for one build), the store change
 * event (build-hook@1 listener pipeline2-hook.mjs runs `advance` as soon as a Pipeline 2.0 build changes status or a
 * step finishes) and a step's exit (pipeline.mjs exit → stepExit → advance).
 *
 *   node apps/console-web/plugins/build-orchestrator/pipeline2.mjs advance [--build id] [--json]   one pass (under the dispatcher's lock)
 *   … status [--json]                      every Pipeline 2.0 build: status, steps, the active one
 *   … step-exit <build> <step> --exit n [--hit usage|auth] [--account a] [--session s]   a step's session ended
 *   … retry <build> [--why w] [--by who]   Brett's retry of a failed build: the attempt counts start again
 *   … act <build> <queue|hold|release|retry|rebuild|run-ci|land|cancel> [--step s] [--why w] [--by who]
 *                                          one tap on a build or a step (the console, Plan Studio 2.0, MCP): actBuild below
 *
 * Environment (tests): AXF_PIPELINE_LAUNCHER, AXF_PIPELINE_WORKTREES, AXF_PIPELINE_WORKTREE_MODE=mkdir, AXF_P2_SLOTS
 * (slot count instead of agent-slots), AXF_P2_ACCOUNTS (JSON rows instead of the logins), AXF_P2_ALIVE (comma list of
 * live tmux sessions instead of tmux), AXF_P2_PARALLEL (steps at once instead of the stepsInParallel setting),
 * AXF_P2_MAX_ATTEMPTS (instead of the watchdog's maxAttempts), AXF_P2_EMERGENCY_SLOTS (emergency slot count, with
 * AXF_P2_SLOTS).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P2 from '../../../../framework/core/pipeline-status.mjs';
import * as PC from './pipeline-core.mjs';
import * as storeCore from '../../../../framework/plan/builds-store-core.mjs';
import { FlowRefused, loadStore, setFlowStatus } from '../../../../framework/cli/builds-store.mjs';
import { issue as issueDispatch } from '../../../../framework/cli/dispatch-gate.mjs';
import * as lock from '../../../../framework/cli/build-lock.mjs';
import { MODEL_IDS, modelKey } from '../../../../framework/core/model-policy.mjs';
import { crewSay } from '../../../../framework/cli/crew-say.mjs';
import { syncGrants } from '../../../../framework/cli/emergency-builds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../../..');
const CLAUDE_ARGS = ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'Edit', 'Write', 'MultiEdit', 'Read', 'Grep', 'Glob'];
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const nowIso = () => new Date().toISOString();
const worktreesRoot = (env = process.env) => env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
export const stepName = (b, s) => `${b.id}--${s.id}`;
const lockEnv = (env) => (env.AXF_SLOTS_TMUX === 'off' && env.AXF_BUILD_LOCK_TMUX == null ? { ...env, AXF_BUILD_LOCK_TMUX: 'off' } : env);

let PL = null; // pipeline.mjs (settings, accounts, slots, the log): it binds itself (it imports this file), or loaded on first use
const pl = async () => (PL ??= await import('./pipeline.mjs'));
/** pipeline.mjs hands over what this file uses from it (no import cycle at load time). */
export function bindPipeline(mod) { PL = mod; }
/** Load pipeline.mjs when this file is used on its own (tests, the CLI). */
export const ready = () => pl();
const logLine = (o) => { try { const f = join(PL.pipeDir(), 'log.jsonl'); mkdirSync(dirname(f), { recursive: true }); appendFileSync(f, `${JSON.stringify({ at: nowIso(), flow: P2.FLOW, ...o })}\n`); } catch { /* the log is a courtesy */ } }; // axf-data: not data (the dispatcher's host-local event log, a courtesy; build state is in the builds store)
const say = (who, kind, text, ref) => { try { if (who === 'dispatcher') crewSay('dispatcher', kind, text, { ref }); else crewSay('orchestrator', kind, text, { ref }); } catch { /* the chat is a courtesy */ } };

/** Every live Pipeline 2.0 build. */
export const p2Builds = (store) => store.builds.filter((b) => b.flow === P2.FLOW && !b.deleted && b.status !== P2.EXIT);

/** Move through the contract; a refusal is logged (never silent) and returns null instead of throwing. */
function move(id, to, opts = {}) {
  try { return setFlowStatus(id, to, { by: 'orchestrator', ...opts }); }
  catch (e) { if (e instanceof FlowRefused) { logLine({ event: 'refused', build: id, step: opts.step || '', to, error: str(e.message) }); return null; } throw e; }
}
const stepOf = (b, sid) => b.steps.find((x) => x.id === sid || x.uid === sid);
/** Where a failed record retries to: the status it failed at, never earlier than `floor`. */
const retryTo = (rec, floor, kind = 'step') => (P2.rank(rec.failedFrom, kind) > P2.rank(floor, kind) ? rec.failedFrom : floor);
const at = (rec, ...ss) => ss.includes(rec.status) || (rec.status === P2.FAILED && ss.includes(rec.failedFrom));

/* ------------------------------------------------------------------ splitting */

/** Slots the split may use: the agent-slots cap (never above the VPS hard limit). */
function slotCount(env) {
  if (env.AXF_P2_SLOTS) return Math.max(1, Number(env.AXF_P2_SLOTS) || 1);
  try { const sl = PL.slotsNow(); return Math.max(1, Math.min(sl.cap || 1, sl.hard?.max || sl.cap || 1)); } catch { return 1; }
}
const minutesOf = (s) => parseInt(str(s.estimate), 10) || 0;
/** One step row per part: one step as it is, several joined (their text as a list, files merged, Fable if any is). */
export function partStep(part, i, { at: when, by }) {
  const one = part.length === 1 ? part[0] : null;
  const base = one ? { ...one } : {
    text: part.map((x) => `- ${str(x.text, 600)}`).join('\n'), model: part.some((x) => x.model === 'Fable') ? 'Fable' : 'Opus',
    estimate: `${part.reduce((m, x) => m + minutesOf(x), 0)} min`, files: [...new Set(part.flatMap((x) => x.files ?? []))], phase: 1,
    note: `Part ${i + 1}: ${part.length} plan steps in one session (they touch the same files).`,
  };
  for (const k of ['uid', 'status', 'statusAt', 'statusBy', 'statusLog', 'attempt', 'failedFrom', 'rev']) delete base[k];
  return P2.transition({ ...base, id: `s${i + 1}` }, 'pending', { at: when, by, kind: 'step', why: 'split' }).rec;
}

/** Where Fable can be asked: a test splitter, or the VPS host (the logins live there; elsewhere the host's tick splits). */
const canAskFable = (env) => !!env.AXF_PIPELINE_SPLITTER || !!env.AXF_P2_ACCOUNTS || !PL.seesAccounts || PL.seesAccounts(env);

/**
 * The build steps of a build Plan Studio sent as one plan (planning steps only, no build steps): Fable designs them,
 * each with minutes and a model (pipeline-core p2SplitPrompt, checked by normDesign). When Fable cannot answer (no
 * credits, no login, the split provider off, an answer that does not pass) the split falls back to one step per planning
 * step (fallbackDesign) and the build's note says why. → { steps: [{ text, model, minutes, files }], by, why }
 */
export function designSteps(b, { env = process.env, slots = 1 } = {}) {
  let settings = { splitProvider: 'claude' }; try { settings = PL.loadSettings(env); } catch { /* defaults */ }
  let why = '';
  if (env.AXF_PIPELINE_SPLITTER || settings.splitProvider === 'claude') {
    try {
      const a = PL.askSplitter(PC.p2SplitPrompt(b, { slots, maxStepMinutes: P2.STEP_MAX_MINUTES }), settings, env, { model: 'fable' });
      if (!a.error) {
        const d = P2.normDesign(PC.answerJson(a.text));
        if (!d.errors.length) return { steps: d.steps, by: 'fable', why: '' };
        why = `the answer did not pass: ${d.errors.slice(0, 3).map((x) => `${x.path} ${x.why}`).join('; ')}`;
      } else why = a.error;
    } catch (e) { why = str(e.message); }
  } else why = `split provider is ${settings.splitProvider}`;
  return { steps: P2.fallbackDesign(b), by: 'fallback', why: str(why, 300) };
}

function splitAll(store, env, out, only = '') {
  for (const b of p2Builds(store).filter((x) => at(x, 'pending', 'splitting') && (!only || x.id === only))) {
    const planningOnly = !b.steps.length;
    if (planningOnly && !canAskFable(env)) { out.waits.push({ id: b.id, why: 'Fable designs its steps on the VPS host (the next host tick)' }); continue; }
    if (b.status === 'pending' && !move(b.id, 'splitting', { why: planningOnly ? 'Fable is designing its steps' : 'the orchestrator is splitting it' })) continue;
    const slots = slotCount(env);
    let parts; let note = '';
    if (planningOnly) {
      const d = designSteps(b, { env, slots });
      const steps = d.steps.map((x) => ({ text: x.text, model: x.model, estimate: `${x.minutes} min`, files: x.files, phase: 1 }));
      parts = P2.splitParts(steps, steps.length); // one row per designed step; only steps sharing files go together
      const minutes = d.steps.reduce((m, x) => m + x.minutes, 0);
      note = d.by === 'fable'
        ? `Split by Fable into ${d.steps.length} step${d.steps.length === 1 ? '' : 's'} (${minutes} min, ${d.steps.filter((x) => x.model === 'Fable').length} Fable).`
        : `Fable could not split it (${d.why}): one step per planning step instead (${d.steps.length}, ${minutes} min). Review the steps.`;
      logLine({ event: 'design', build: b.id, by: d.by, steps: d.steps.length, why: d.why });
    } else parts = P2.splitParts(b.steps.filter((s) => !s.skip), slots);
    const when = nowIso();
    const r = move(b.id, 'split', { why: `${parts.length} step${parts.length === 1 ? '' : 's'} for ${slots} slot${slots === 1 ? '' : 's'}`,
      mutate: (rec) => { rec.steps = parts.map((p, i) => storeCore.normStep(partStep(p, i, { at: when, by: 'orchestrator' }), i)); if (note) rec.notes.push({ text: note, at: when, by: 'orchestrator' }); } });
    if (r) { out.split.push({ id: b.id, steps: parts.length, slots }); logLine({ event: 'split', build: b.id, steps: parts.length, slots }); say('orchestrator', 'done', note || `Split ${b.id} into ${parts.length} step${parts.length === 1 ? '' : 's'} (${slots} slots).`, b.id); }
  }
}

/* ------------------------------------------------------------------ one active build, then main into each step */

/** On hold (Brett's Hold on a build that waits its turn): it keeps its place and is not activated until released. */
export const isHeld = (b) => !!str(b?.pipeline?.heldAt, 40);
/** Waiting its turn: at `split`, or failed there with attempts left (a build that failed while it waited starts like any other). */
export const waitsTurn = (b, max = P2.MAX_ATTEMPTS) => P2.WAITING.includes(b.status) || (b.status === P2.FAILED && P2.WAITING.includes(b.failedFrom) && !P2.gaveUp(b, max));
/** The next build to become active: P0 first, then the oldest. Only when no build is active. Emergency builds have their own lane. */
export function nextToActivate(builds, max = P2.MAX_ATTEMPTS) {
  const pr = (b) => ({ P0: 0, P1: 1, P2: 2, P3: 3 }[b.priority] ?? 2);
  return builds.filter((b) => waitsTurn(b, max) && !b.hidden && !P2.isEmergency(b) && !isHeld(b)).sort((a, b) => pr(a) - pr(b) || String(a.createdAt).localeCompare(String(b.createdAt)))[0] ?? null;
}

/** Cut a step's worktree from fresh origin/main (or pull main into the one already there). Outside any launch. */
export function cutWorktree(b, s, env = process.env) {
  const name = stepName(b, s);
  const dir = join(worktreesRoot(env), name);
  if ((env.AXF_PIPELINE_WORKTREE_MODE || 'git') === 'mkdir') { mkdirSync(dir, { recursive: true }); return { dir, branch: `claude/${name}` }; }
  if (!existsSync(dir)) { PL.ensureWorktree(name, env); return { dir, branch: `claude/${name}` }; }
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 300e3 });
  let r = git('fetch', '-q', 'origin', 'main');
  if (r.status === 0) r = git('merge', '--no-edit', '-q', 'origin/main');
  if (r.status !== 0) throw new Error(`pull main into ${name}: ${str((r.stderr || r.stdout || '').trim(), 300)}`);
  return { dir, branch: `claude/${name}` };
}

/** Does main still have to go into this step: pending (a step with no status counts as pending), pulling, or failed there. */
const needsMain = (s) => !s.skip && (!s.status || at(s, 'pending', 'pulling-main'));

function pullMain(b, env, out) {
  const maxAttempts = attemptCap(env);
  for (const s0 of b.steps) {
    const s = stepOf(loadStore().builds.find((x) => x.id === b.id), s0.id);
    if (!needsMain(s)) continue;
    if (P2.gaveUp(s, maxAttempts)) { out.waits.push({ id: b.id, step: s.id, why: `the main pull gave up after attempt ${s.attempt} of ${maxAttempts}: retry the build to start it again` }); return false; }
    const name = stepName(b, s);
    const dir = join(worktreesRoot(env), name);
    if (s.status !== 'pulling-main' && !move(b.id, 'pulling-main', { step: s.id, why: 'cutting its worktree and pulling main', extra: { worktree: dir, branch: `claude/${name}` } })) return false;
    try { cutWorktree(b, s, env); }
    catch (e) {
      move(b.id, P2.FAILED, { step: s.id, why: str(e.message) });
      out.failed.push({ id: b.id, step: s.id, error: str(e.message) }); logLine({ event: 'pull-main-failed', build: b.id, step: s.id, error: str(e.message) });
      say('orchestrator', 'failed', `Couldn't pull main into ${name}: ${str(e.message, 160)}. Retrying on the next pass.`, b.id);
      return false; // one at a time: the next step waits for this one
    }
    move(b.id, 'ready', { step: s.id, why: 'main is in' });
    out.pulled.push({ id: b.id, step: s.id });
  }
  return true;
}

function prepare(b, env, out) {
  if (at(b, 'pulling-main')) {
    if (b.status === P2.FAILED && !move(b.id, 'pulling-main', { why: 'retrying the main pull' })) return;
    if (!pullMain(b, env, out)) return;
    const fresh = loadStore().builds.find((x) => x.id === b.id);
    if (!P2.everyStep(fresh, 'ready')) return;
    if (!move(b.id, 'assigning-models', { why: 'every step has main' })) return;
  }
  const cur = loadStore().builds.find((x) => x.id === b.id);
  if (cur.status !== 'assigning-models') return;
  const raised = [];
  move(b.id, 'ready', { why: 'models assigned', mutate: (rec) => { for (const s of rec.steps) { const m = P2.modelFor(s); if (m !== s.model) raised.push(`${s.id} ${s.model} → ${m}`); s.model = m; } if (raised.length) rec.notes.push({ text: `Models assigned (Fable where needed): ${raised.join(', ')}.`, at: nowIso() }); } });
  out.ready.push(b.id); logLine({ event: 'ready', build: b.id, raised });
}

/* ------------------------------------------------------------------ accounts and launches */

/** Accounts as the dispatcher picks from: the pipeline's view plus usage left from claude-workers. */
function accountRows(env) {
  if (env.AXF_P2_ACCOUNTS) return JSON.parse(env.AXF_P2_ACCOUNTS);
  const read = PL.accountsRead(loadStore(), PL.loadSettings(env), env);
  const rows = new Map((read.rows ?? []).map((r) => [r.name, r]));
  return read.accounts.filter((a) => a.kind !== 'api').map((a) => ({ ...a, usageLeft: rows.get(a.name)?.usageLeft ?? 1, limited: a.limited || rows.get(a.name)?.limited || null }));
}
/** Steps of one build that may run at once: the stepsInParallel setting (default 4); the slot cap still applies. */
export function parallelCap(env = process.env) {
  if (env.AXF_P2_PARALLEL) return Math.max(1, Number(env.AXF_P2_PARALLEL) || 1);
  try { return Math.max(1, Number(PL.loadSettings(env).stepsInParallel) || PC.DEFAULTS.stepsInParallel); } catch { return PC.DEFAULTS.stepsInParallel; }
}
/** The attempt cap: the watchdog's maxAttempts setting (its settings file next to the dispatcher's) when lower than the contract's P2.MAX_ATTEMPTS, else that. */
export function attemptCap(env = process.env) {
  const cap = (n) => (Number.isFinite(n) && n >= 1 ? Math.min(P2.MAX_ATTEMPTS, Math.floor(n)) : P2.MAX_ATTEMPTS); // the contract's ceiling: a setting may lower it, never raise it
  if (env.AXF_P2_MAX_ATTEMPTS) return cap(Number(env.AXF_P2_MAX_ATTEMPTS));
  try { return cap(Number(JSON.parse(readFileSync(join(env.AXF_WATCHDOG2_DIR || join(PL.pipeDir(), 'watchdog2'), 'settings.json'), 'utf8'))?.maxAttempts)); } catch { return P2.MAX_ATTEMPTS; }
}
const inSlot = (s) => ['sending', 'building'].includes(s.status);
/** The slot pool a build's steps go to: `emergency` for an emergency build, else the orchestrator's `builds` pool. */
export const poolOf = (b) => (P2.isEmergency(b) ? 'emergency' : 'builds');
/** Free slots in one pool. The pools never lend: an ordinary step never gets an emergency slot, nor the other way round. */
function freeSlots(env, pool = 'builds') {
  if (env.AXF_P2_SLOTS) {
    const used = p2Builds(loadStore()).filter((b) => poolOf(b) === pool).flatMap((b) => b.steps).filter(inSlot).length;
    const cap = pool === 'emergency' ? Number(env.AXF_P2_EMERGENCY_SLOTS ?? 2) || 0 : Number(env.AXF_P2_SLOTS);
    return Math.max(0, cap - used);
  }
  try { const sl = PL.slotsNow(); return Math.max(0, (pool === 'emergency' ? sl.emergency?.free : sl.free) ?? 0); } catch { return 0; }
}

function briefOf(b, s) {
  return [
    `# ${b.title}: step ${s.id}`,
    '',
    `Build ${b.id} (Pipeline 2.0), step ${s.id} of ${b.steps.length}. Model ${s.model}. You run headless; nobody is watching.`,
    `Worktree: ${s.worktree} (already cut from main) · branch ${s.branch}.`,
    '',
    '## Your step',
    s.text,
    ...(s.files?.length ? ['', `Files: ${s.files.join(', ')}. Other steps of this build work on other files at the same time: stay inside yours.`] : []),
    ...(b.detail ? ['', '## The build', str(b.detail, 6000)] : []),
    '',
    '## Rules',
    '- One session, no sub-agents. Commit on this branch only and push it (`git push -u origin HEAD`). Never push to main, never open or merge a PR: the lander merges every step of this build into one PR.',
    '- Opus or Fable only. Heavy steps (npm/vite builds, Playwright) go through `node framework/cli/agent-slots.mjs heavy -- <cmd>`.',
    `- When the step is done and pushed, end the session. The orchestrator marks the step completed when the session exits cleanly.`,
  ].join('\n');
}

/** Start one step's session in its pre-cut worktree. Never cuts a worktree (that happened in pulling-main). */
export function launchStep(b, s, { account, model }, { env = process.env, launcher = env.AXF_PIPELINE_LAUNCHER || join(REPO_ROOT, 'deploy', 'claude-headless.sh') } = {}) {
  const name = stepName(b, s);
  const dir = s.worktree;
  if (!dir || !existsSync(dir)) throw Object.assign(new Error(`the worktree of ${name} is missing (${dir || 'none'}): it is cut before launch, never at launch`), { code: 'no-worktree' });
  lock.acquire(name, { dir, account, by: 'dispatcher', env: lockEnv(env) });
  writeFileSync(join(dir, '.axf-brief.md'), `${briefOf(b, s)}\n`);
  const token = issueDispatch(name, { account, model, env });
  const key = modelKey(model) || 'opus';
  const args = ['--name', name, '--account', account, '--brief', '.axf-brief.md', '--log', `${name}.log`, '--', '--model', MODEL_IDS[key], ...CLAUDE_ARGS];
  // a stripped environment (a detached store hook) has no HOME: the launcher needs it (and its PATH entry)
  const e = { ...env, HOME: env.HOME || homedir() || '/root', AXF_DISPATCH_TOKEN: token, AXF_SURFACE: 'pipeline', AXF_MODEL: key, AXF_BUILD_ID: b.id, AXF_BUILD_STEP: s.id, AXF_CLAUDE_ACCOUNT: account, AXF_ACCOUNT_SWITCHES: '0' };
  let r;
  try { r = spawnSync('bash', [launcher, ...args], { cwd: dir, encoding: 'utf8', timeout: 120e3, env: e }); }
  catch (err) { lock.release(name, { dir }); throw err; }
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const session = /started (axf-\S+) in/.exec(text)?.[1] ?? /queued at position \d+ \((hl-[a-z0-9-]+)/.exec(text)?.[1] ?? '';
  const slot = /\((hl-[a-z0-9-]+)/.exec(text)?.[1] ?? '';
  if (r.status !== 0 || (!session && !/queued at position/.test(text))) {
    lock.release(name, { dir });
    throw new Error(`launcher exit ${r.status}: ${str(text.trim().split('\n').filter(Boolean).pop() || 'no output', 300)}`);
  }
  lock.beat(name, { dir, session });
  return { session, slot };
}

/** Accounts a step failed on before (its log: launch refusals and limit exits), newest attempts only. */
const failedOn = (s) => (s.statusLog ?? []).filter((l) => l.status === P2.FAILED).slice(-4).map((l) => /^launch on ([a-z0-9-]+):/.exec(l.why || '')?.[1] ?? /^([a-z0-9-]+) hit its/.exec(l.why || '')?.[1] ?? '').filter(Boolean);

/**
 * Send every sendable step of the active build to a free slot, one at a time, up to stepsInParallel of them at once; a
 * failed launch retries on another account at once. A step that used up its attempts is left failed (the give-up is final).
 */
function dispatch(b, env, out, { launch = launchStep } = {}) {
  const cap = parallelCap(env); const maxAttempts = attemptCap(env);
  const running = b.steps.filter(inSlot).length;
  const pool = poolOf(b);
  let free = Math.min(freeSlots(env, pool), cap - running);
  for (const s of b.steps.filter((x) => P2.gaveUp(x, maxAttempts) && ['ready', 'sending', 'building'].includes(x.failedFrom))) out.waits.push({ id: b.id, step: s.id, why: `gave up after attempt ${s.attempt} of ${maxAttempts}: the watchdog escalates it or Brett decides; never relaunched here` });
  if (free <= 0) { out.waits.push({ id: b.id, why: running >= cap ? `${running} of ${cap} steps already running (stepsInParallel)` : pool === 'emergency' ? 'no free emergency slot: the next step goes out when one frees' : 'no free slot: the next step goes out when one frees' }); return; }
  let accounts = accountRows(env);
  const refusedNow = new Set(); // an account that refused a launch in this pass gets no other step of it
  for (const s0 of b.steps) {
    if (free <= 0) break;
    const cur = loadStore().builds.find((x) => x.id === b.id);
    const s = stepOf(cur, s0.id);
    if (!P2.sendable(s, maxAttempts)) continue;
    const tried = [];
    // a retry goes to another account: never the one it just failed on, nor one that refused this step before
    const avoid = new Set([...(s.status === P2.FAILED && s.account ? [s.account] : []), ...failedOn(s), ...(s.tried ?? [])]);
    for (;;) {
      const fresh = stepOf(loadStore().builds.find((x) => x.id === b.id), s.id);
      if (!P2.sendable(fresh, maxAttempts)) { if (P2.gaveUp(fresh, maxAttempts)) logLine({ event: 'gave-up', build: b.id, step: s.id, attempt: fresh.attempt, max: maxAttempts }); break; }
      const onBuild = {}; for (const x of loadStore().builds.find((y) => y.id === b.id).steps) if (['sending', 'building'].includes(x.status) && x.account) onBuild[x.account] = (onBuild[x.account] ?? 0) + 1;
      // a step at `ready` with an `account` is pinned (the watchdog's relaunch chose it): that account, unless it is
      // marked out, full, or refused this step in this pass; otherwise the normal pick (never an out account)
      let a = P2.pinnedAccount(accounts, fresh, { model: fresh.model, exclude: [...tried, ...refusedNow] });
      if (a) logLine({ event: 'pinned-account', build: b.id, step: s.id, account: a.name });
      else if (fresh.status === 'ready' && fresh.account && !tried.includes(fresh.account)) logLine({ event: 'pin-skipped', build: b.id, step: s.id, account: fresh.account, why: 'marked out, full or refused: the normal pick chooses' });
      a ??= P2.pickAccount(accounts, { model: fresh.model, onBuild, exclude: [...tried, ...refusedNow, ...avoid] });
      // every account was avoided for this step: give the ones it failed on before another go (never one refused this pass)
      if (!a && avoid.size) a = P2.pickAccount(accounts, { model: fresh.model, onBuild, exclude: [...tried, ...refusedNow] });
      if (!a) {
        out.waits.push({ id: b.id, step: s.id, why: `no account with usage left for ${fresh.model}${tried.length ? ` (tried ${tried.join(', ')})` : ''}` });
        logLine({ event: 'no-account', build: b.id, step: s.id, tried });
        return;
      }
      const to = fresh.status === P2.FAILED ? retryTo(fresh, 'sending') : 'sending';
      if (!move(b.id, to, { step: s.id, why: `to ${a.name}`, extra: { account: a.name } })) break;
      const bNow = loadStore().builds.find((x) => x.id === b.id);
      if (at(bNow, 'ready', 'sending') && bNow.status !== 'sending') move(b.id, bNow.status === P2.FAILED ? retryTo(bNow, 'sending', 'build') : 'sending', { why: `sending ${s.id}` });
      try {
        // pre-cut in pulling-main; one that vanished since (a cleanup, a dead worktree) is cut again here, in the pass,
        // so the launch itself never cuts one and never times out on it
        const st = stepOf(bNow, s.id);
        let bL = bNow;
        if (!st.worktree || !existsSync(st.worktree)) {
          const w = cutWorktree(bNow, st, env);
          move(b.id, st.status, { step: s.id, why: 'worktree cut again', extra: { worktree: w.dir, branch: w.branch } });
          logLine({ event: 'worktree-recut', build: b.id, step: s.id }); bL = loadStore().builds.find((x) => x.id === b.id);
        }
        const r = launch(bL, stepOf(bL, s.id), { account: a.name, model: fresh.model }, { env });
        move(b.id, 'building', { step: s.id, why: `${r.session || 'queued'} on ${a.name}`, extra: { account: a.name, tmux: r.session, slot: r.slot } });
        const bb = loadStore().builds.find((x) => x.id === b.id);
        if (bb.status !== 'building') move(b.id, 'building', { why: `${s.id} is in a slot` });
        out.launched.push({ id: b.id, step: s.id, account: a.name, model: fresh.model, session: r.session });
        logLine({ event: 'launched', build: b.id, step: s.id, account: a.name, model: fresh.model, session: r.session });
        accounts = accounts.map((x) => (x.name === a.name ? { ...x, free: (x.free ?? 1) - 1 } : x));
        free -= 1;
        break;
      } catch (e) {
        tried.push(a.name); refusedNow.add(a.name);
        move(b.id, P2.FAILED, { step: s.id, why: `launch on ${a.name}: ${str(e.message)}` });
        out.failed.push({ id: b.id, step: s.id, account: a.name, error: str(e.message) });
        logLine({ event: 'launch-failed', build: b.id, step: s.id, account: a.name, error: str(e.message) });
        say('dispatcher', 'failed', `Couldn't start ${stepName(b, s)} on ${a.name}: ${str(e.message, 160)}. Retrying on another account.`, b.id);
        if (e.code === 'no-worktree' || /^pull main into/.test(e.message)) return; // the worktree itself is broken: the next pass (or the watchdog) cuts it again
      }
    }
  }
}

/* ------------------------------------------------------------------ step exits */

const aliveSet = (env) => (env.AXF_P2_ALIVE !== undefined ? new Set(env.AXF_P2_ALIVE.split(',').filter(Boolean)) : (() => { const r = spawnSync('tmux', ['ls', '-F', '#S'], { encoding: 'utf8' }); return r.status === 0 ? new Set(r.stdout.split('\n').filter(Boolean)) : /no server running|error connecting/.test(r.stderr || '') ? new Set() : null; })());

/**
 * A step's session ended (claude-headless.sh → pipeline.mjs exit → here, or the pass finding its session gone): exit 0
 * without a limit = completed; anything else = failed (attempt N), retried forward by the next dispatch on another
 * account. When every step is completed the build is build-complete (the lander takes it).
 */
export function stepExit(id, sid, { exit = 0, hit = '', account = '', session = '', by = 'headless', env = process.env } = {}) {
  const b = loadStore().builds.find((x) => x.id === id);
  if (!b || b.flow !== P2.FLOW) return { ok: false, why: `${id} is not a Pipeline 2.0 build` };
  const s = stepOf(b, sid);
  if (!s) return { ok: false, why: `no step ${sid} in ${id}` };
  if (!['sending', 'building'].includes(s.status) || (session && s.tmux && s.tmux !== session)) return { ok: true, why: `${id}/${sid} is ${s.status}: nothing to end` };
  try { lock.release(stepName(b, s), { dir: s.worktree }); } catch { /* gone with the worktree */ }
  const clean = Number(exit) === 0 && !hit;
  const why = clean ? 'session ended cleanly' : hit ? `${account || s.account} hit its ${hit === 'auth' ? 'login' : 'usage'} limit` : `session exit ${exit}`;
  move(id, clean ? 'completed' : P2.FAILED, { step: sid, by, why });
  logLine({ event: clean ? 'step-completed' : 'step-failed', build: id, step: sid, exit, hit, account: account || s.account });
  const after = loadStore().builds.find((x) => x.id === id);
  if (P2.everyStep(after, 'completed')) { move(id, 'build-complete', { by, why: 'every step completed' }); say('dispatcher', 'done', `${id}: every step completed. Over to the lander.`, id); }
  return { ok: true, status: clean ? 'completed' : P2.FAILED };
}

function sweepEnded(b, env, out) {
  const alive = aliveSet(env); if (!alive) return;
  for (const s of b.steps) {
    if (s.status !== 'building' || !s.tmux || alive.has(s.tmux)) continue;
    // the session is gone and its exit never reached us: the events file says how it ended, else it vanished
    let exit = 1; let hit = '';
    try {
      const t = spawnSync('tail', ['-n', '4000', join(env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless', 'events.jsonl')], { encoding: 'utf8' }).stdout || '';
      const end = t.split('\n').filter((l) => l.includes(`"session":"${s.tmux}"`) && l.includes('session-end')).pop();
      if (end) exit = Number(JSON.parse(end).exit) || 0;
      const log = join(s.worktree || '', `${stepName(b, s)}.log`);
      const tl = existsSync(log) ? spawnSync('tail', ['-n', '40', log], { encoding: 'utf8' }).stdout || '' : '';
      if (/hit your (?:weekly |daily |session |5-hour )?limit|usage limit reached|out of credits/i.test(tl)) hit = 'usage';
    } catch { /* judged as vanished */ }
    out.ended.push({ id: b.id, step: s.id, exit, hit });
    stepExit(b.id, s.id, { exit, hit, session: s.tmux, by: 'orchestrator', env });
  }
}

/* ------------------------------------------------------------------ one pass */

/**
 * One pass over every Pipeline 2.0 build (the tick, the store-change hook and a step exit all call this, under the
 * dispatcher's lock). `build` limits the pass to that one build (`orchestrator.mjs tick --build <id>`, the watchdog's
 * nudge): only it is split, it is activated only when it is the next in line, and the active-build work runs only when
 * it is the active build. The one-active-build rule is the same either way. → { split, pulled, ready, launched,
 * failed, ended, waits, active, build }
 */
export function advance({ env = process.env, launch = launchStep, build = '' } = {}) {
  if (!PL) throw new Error('pipeline2: pipeline.mjs is not bound (import it, or call ready() first)');
  const out = { split: [], pulled: [], ready: [], launched: [], failed: [], ended: [], waits: [], active: '', emergency: [], ...(build ? { build } : {}) };
  let store = loadStore();
  splitAll(store, env, out, build);
  advanceEmergency(env, out, { launch, build });
  store = loadStore();
  let { active, others } = P2.activeBuild(p2Builds(store));
  for (const o of others) { out.waits.push({ id: o.id, why: `one active build at a time: ${active.id} is active (this one is a breach, left for the watchdog)` }); logLine({ event: 'active-breach', build: o.id, active: active.id }); }
  if (!active) {
    const next = nextToActivate(p2Builds(store), attemptCap(env));
    if (next && (!build || next.id === build) && move(next.id, 'pulling-main', { why: next.status === P2.FAILED ? 'no other build is active (it failed while it waited: starting it now)' : 'no other build is active' })) active = loadStore().builds.find((x) => x.id === next.id);
  }
  for (const w of p2Builds(store).filter((b) => waitsTurn(b, attemptCap(env)) && !P2.isEmergency(b) && b.id !== active?.id && (!build || b.id === build))) out.waits.push({ id: w.id, why: isHeld(w) ? 'on hold: release it to give it its turn' : `waiting for ${active?.id ?? 'the active build'} to land (one active build at a time; nothing pulls main while one is active)` });
  if (!active) return out;
  out.active = active.id;
  if (build && active.id !== build) return out;
  // worktrees, tmux and the logins are on the VPS host: elsewhere (the console's container) the pass stops after the split
  if (!env.AXF_P2_ACCOUNTS && PL.seesAccounts && !PL.seesAccounts(env)) { out.waits.push({ id: active.id, why: 'main pulls and launches run on the VPS host (the next host tick)' }); return out; }
  work(active, env, out, { launch });
  return out;
}

/** One build past the line: main into its steps, ended sessions swept, steps out to its slot pool, build-complete. */
function work(b0, env, out, { launch }) {
  let b = b0;
  // attempts used up: the contract refuses every move, so nothing is tried (the watchdog alerted; a retry resets it)
  if (P2.gaveUp(b, attemptCap(env))) { out.waits.push({ id: b.id, why: `gave up after attempt ${b.attempt} at ${b.failedFrom || 'an unknown status'}: \`orchestrator.mjs retry ${b.id}\` starts it again` }); return; }
  if (at(b, 'pulling-main', 'assigning-models')) prepare(b, env, out);
  b = loadStore().builds.find((x) => x.id === b.id);
  sweepEnded(b, env, out);
  b = loadStore().builds.find((x) => x.id === b.id);
  // a step that never got main (one left without a status by an older writer) gets it now instead of blocking the build
  if (at(b, 'ready', 'sending', 'building') && b.steps.some(needsMain)) { pullMain(b, env, out); b = loadStore().builds.find((x) => x.id === b.id); }
  if (at(b, 'ready', 'sending', 'building')) dispatch(b, env, out, { launch });
  const fin = loadStore().builds.find((x) => x.id === b.id);
  if (at(fin, 'building', 'sending') && P2.everyStep(fin, 'completed')) move(fin.id, 'build-complete', { why: 'every step completed' });
}

/**
 * Brett's retry of a failed Pipeline 2.0 build (`orchestrator.mjs retry <build>`, the console's Retry, MCP): the one
 * way on for a record that used up its attempts. The build and every failed step leave `failed` forward, at the status
 * they failed at (a step that died in its slot relaunches through `ready`), as a reset: the attempt counts start again
 * at 1, with the reason in the log. A build that failed while waiting goes back to `split` and takes its turn. Nothing
 * is launched here: the next pass carries on. → { id, status, steps: [{ id, status }], by }
 */
export function retryBuild(id, { by = process.env.AXF_ACTOR || 'console', why = '' } = {}) {
  const b = storeCore.findBuild(loadStore(), id);
  if (!b || b.flow !== P2.FLOW) throw Object.assign(new Error(`${id} is not a Pipeline 2.0 build`), { code: 2 });
  const failedSteps = b.steps.filter((s) => s.status === P2.FAILED);
  if (b.status !== P2.FAILED && !failedSteps.length) throw Object.assign(new Error(`${b.id} is ${P2.labelOf(b.status, b.attempt)} with no failed step: nothing to retry`), { code: 2 });
  const reason = `Retry by ${by}${why ? `: ${why}` : ''}`;
  const steps = [];
  for (const s of failedSteps) {
    const to = P2.RELAUNCH_FROM.includes(s.failedFrom) ? 'ready' : s.failedFrom || 'pending';
    // a fresh start: the accounts it failed on may be tried again
    setFlowStatus(b.id, to, { step: s.id, by, why: reason, reset: true, extra: { tried: [] } });
    steps.push({ id: s.id, status: to });
  }
  let status = b.status;
  if (b.status === P2.FAILED) {
    status = b.failedFrom || 'pending';
    setFlowStatus(b.id, status, { by, why: reason, reset: true, mutate: (rec) => { delete rec.failure; rec.notes.push({ text: `${reason}. The attempt counts start again${steps.length ? ` (steps ${steps.map((x) => x.id).join(', ')} too)` : ''}.`, at: nowIso(), by }); } });
  } else setFlowStatus(b.id, b.status, { by, mutate: (rec) => { rec.notes.push({ text: `${reason}. Steps ${steps.map((x) => x.id).join(', ')} start again at attempt 1.`, at: nowIso(), by }); } });
  logLine({ event: 'retry-hand', build: b.id, by, status, steps: steps.map((x) => x.id) });
  return { id: b.id, status, steps, by };
}

/* ------------------------------------------------------------------ taps: one action on a build or a step */

/** What a tap may ask for (the orchestrator's own menu, Plan Studio 2.0's, REST, MCP, the CLI). */
export const BUILD_ACTIONS = Object.freeze(['queue', 'hold', 'release', 'retry', 'rebuild', 'run-ci', 'land', 'cancel']);
/** Before the active place: not yet split, or split and waiting its turn. */
const beforeTheLine = (b) => at(b, 'pending', 'splitting', 'split');
const inLanding = (b) => at(b, ...P2.LANDING_GROUP);
const SELF = fileURLToPath(import.meta.url);

/** One pass for one build under the dispatcher's lock (a second process when this one does not hold it). */
function passFor(id, env = process.env) {
  if (env.AXF_PIPELINE_LOCKED === '1' || spawnSync('flock', ['-V'], { encoding: 'utf8' }).status !== 0) return advance({ env, build: id });
  const lockFile = PL.pipelineLock();
  try { mkdirSync(dirname(lockFile), { recursive: true }); } catch { /* flock reports it */ }
  const r = spawnSync('flock', ['-w', '120', lockFile, process.execPath, SELF, 'advance', '--build', id, '--json'], { encoding: 'utf8', timeout: 600e3, env: { ...env, AXF_PIPELINE_LOCKED: '1' } });
  try { return JSON.parse((r.stdout || '').trim().split('\n').pop() || '{}'); } catch { return { waits: [], error: str((r.stderr || r.stdout || '').trim(), 300) }; }
}
/** Ask the lander for a pass now (it runs within a minute). Best effort: the lander's own timer comes round anyway. */
function requestLanderTick(by, env = process.env) {
  if (env.AXF_P2_LANDER === 'off') return false;
  const cli = join(REPO_ROOT, 'deploy', 'lander', 'run.mjs');
  if (!existsSync(cli)) return false;
  try { return spawnSync(process.execPath, [cli, 'run', '--request', '--by', str(by, 80) || 'console'], { encoding: 'utf8', timeout: 30e3, env }).status === 0; } catch { return false; }
}

/**
 * One tap on a Pipeline 2.0 build, or on one of its steps (`step`): every decision is made here, on the VPS; the
 * console only sends the tap and shows the answer. A tap that does not fit where the build is gets a refusal that says
 * why (code 2) and changes nothing.
 *   queue    move it on: split it if it is not split yet, and give it the active place when it is next in line.
 *            Never refused for waiting: the answer says where it stands
 *   hold     a build still waiting its turn keeps its place and is skipped until released
 *   release  off hold; it takes its turn again
 *   retry    a failed build and its failed steps leave `failed` forward where they failed; the attempt counts start again
 *   rebuild  a failed step is built again (through `ready`); a build that failed while landing has main pulled into its
 *            PR and is recompiled (`pr-pulling-main`); any other failed build is retried
 *   run-ci   a build that failed at CI (or after it) goes back to `running-ci`; one already there is checked now
 *   land     the lander takes a built build on its next pass; one that failed while landing is retried first
 *   cancel   out of the flow (archived), from any status; a session still running ends on its own and is not landed
 * → { id, action, step, status, label, held, say }
 */
export function actBuild(id, action, { by = process.env.AXF_ACTOR || 'console', why = '', step = '', env = process.env, pass = passFor, landerTick = requestLanderTick } = {}) {
  const refuse = (msg) => { throw Object.assign(new Error(msg), { code: 2 }); };
  if (!BUILD_ACTIONS.includes(action)) refuse(`action is one of ${BUILD_ACTIONS.join(', ')}`);
  const b = storeCore.findBuild(loadStore(), id);
  if (!b || b.deleted) refuse(`no build "${id}"`);
  if (b.flow !== P2.FLOW) refuse(`${b.id} is not a Pipeline 2.0 build`);
  const label = P2.labelOf(b.status, b.attempt);
  if (b.status === P2.EXIT) refuse(`${b.id} is archived: nothing to ${action}`);
  if (b.status === 'landed') refuse(`${b.id} has landed: nothing to ${action}`);
  const s = step ? stepOf(b, step) : null;
  if (step && !s) refuse(`no step ${step} in ${b.id}`);
  const reason = `${action} by ${by}${why ? `: ${str(why, 200)}` : ''}`;
  const note = (text) => (rec) => { rec.notes.push({ text, at: nowIso(), by }); };
  const done = (say, extra = {}) => {
    const cur = storeCore.findBuild(loadStore(), b.id);
    logLine({ event: 'act', build: b.id, action, step: s?.id ?? '', by });
    return { id: b.id, action, step: s?.id ?? '', status: cur.status, label: P2.labelOf(cur.status, cur.attempt), held: isHeld(cur), say, ...extra };
  };
  const setHold = (on) => setFlowStatus(b.id, b.status, { by, action: `pipeline2:${on ? 'hold' : 'release'}`, mutate: (rec) => {
    rec.pipeline = { ...(rec.pipeline ?? {}), heldAt: on ? nowIso() : '', heldBy: on ? str(by, 80) : '', heldWhy: on ? str(why, 300) : '' };
    rec.notes.push({ text: on ? `On hold (${by})${why ? `: ${str(why, 200)}` : ''}. It keeps its place and is skipped until released.` : `Released from hold (${by}): it takes its turn again.`, at: nowIso(), by });
  } });
  const where = (r) => {
    const cur = storeCore.findBuild(loadStore(), b.id);
    const now = P2.labelOf(cur.status, cur.attempt);
    const w = (r?.waits ?? []).find((x) => x.id === b.id && !x.step);
    return P2.holdsActive(cur) ? `${b.id} has the active place: ${now}.` : w ? `${b.id} is in line (${now}): ${w.why}.` : `${b.id}: ${now}.`;
  };
  switch (action) {
    case 'queue': {
      if (isHeld(b)) refuse(`${b.id} is on hold: release it first`);
      if (P2.gaveUp(b, attemptCap(env))) refuse(`${b.id} gave up (${label}): retry it first`);
      if (!beforeTheLine(b)) return done(`${b.id} is already past the line: ${label}.`);
      return done(where(pass(b.id, env)));
    }
    case 'hold': {
      if (isHeld(b)) refuse(`${b.id} is on hold already`);
      if (P2.isEmergency(b)) refuse(`${b.id} is an emergency build: it is never held`);
      if (!beforeTheLine(b)) refuse(`${b.id} is ${label}: only a build still waiting its turn is put on hold (Cancel stops one that is being built)`);
      setHold(true);
      return done(`${b.id} is on hold: it keeps its place and is skipped until released.`);
    }
    case 'release': {
      if (!isHeld(b)) refuse(`${b.id} is not on hold`);
      setHold(false);
      return done(`Released. ${where(pass(b.id, env))}`);
    }
    case 'retry': {
      const r = retryBuild(b.id, { by, why });
      return done(`${b.id}: retrying from ${P2.labelOf(r.status)}${r.steps.length ? ` (steps ${r.steps.map((x) => x.id).join(', ')})` : ''}; the attempt counts start again.`);
    }
    case 'rebuild': {
      if (s) {
        if (s.status !== P2.FAILED) refuse(`step ${s.id} is ${P2.labelOf(s.status, s.attempt, 'step')}: only a failed step is built again`);
        setFlowStatus(b.id, P2.RELAUNCH_FROM.includes(s.failedFrom) ? 'ready' : s.failedFrom || 'pending', { step: s.id, by, why: reason, reset: true, extra: { tried: [] } });
        setFlowStatus(b.id, b.status, { by, mutate: note(`Rebuild of step ${s.id} (${by}): it starts again at attempt 1.`) });
        return done(`${b.id}: step ${s.id} is built again.`);
      }
      if (b.status !== P2.FAILED) refuse(`${b.id} is ${label}: only a failed build is rebuilt`);
      if (!P2.LANDING_GROUP.includes(b.failedFrom)) { const r = retryBuild(b.id, { by, why: why || 'rebuild' }); return done(`${b.id}: building again from ${P2.labelOf(r.status)}.`); }
      setFlowStatus(b.id, 'pr-pulling-main', { by, why: reason, reset: true, mutate: (rec) => { delete rec.failure; note(`Rebuild (${by}): main is pulled into its PR again and the build is recompiled.`)(rec); } });
      landerTick(by, env);
      return done(`${b.id}: main is pulled into its PR again and the build is recompiled.`);
    }
    case 'run-ci': {
      if (!inLanding(b)) refuse(`${b.id} is ${label}: CI runs once its steps are merged into one PR`);
      if (b.status === P2.FAILED) {
        if (P2.rank(b.failedFrom) < P2.rank('running-ci')) refuse(`${b.id} failed before CI (at ${P2.labelOf(b.failedFrom)}): rebuild it instead`);
        setFlowStatus(b.id, 'running-ci', { by, why: reason, reset: true, mutate: (rec) => { delete rec.failure; note(`Run CI (${by}): back at Running CI.`)(rec); } });
      } else if (b.status === 'merging-main') refuse(`${b.id} is past CI: ${label}`);
      else if (b.status !== 'running-ci') refuse(`${b.id} is ${label}: CI starts by itself once main is in its PR`);
      landerTick(by, env);
      return done(`${b.id}: Running CI. The lander checks it on its next pass.`);
    }
    case 'land': {
      if (b.status === P2.FAILED && P2.LANDING_GROUP.includes(b.failedFrom)) { retryBuild(b.id, { by, why: why || 'land' }); landerTick(by, env); return done(`${b.id}: landing again from ${P2.labelOf(b.failedFrom)}.`); }
      if (b.status !== 'build-complete' && !(inLanding(b) && b.status !== P2.FAILED)) refuse(`${b.id} is ${label}: it lands once every step is built`);
      landerTick(by, env);
      return done(`${b.id}: the lander takes it on its next pass (${label}).`);
    }
    default: { // cancel
      const running = b.steps.filter(inSlot).length;
      setFlowStatus(b.id, P2.EXIT, { by, why: reason, mutate: note(`Cancelled from ${label} (${by})${why ? `: ${str(why, 200)}` : ''}.${running ? ` ${running} step session${running === 1 ? '' : 's'} still running end on their own; nothing of them is landed.` : ''}`) });
      return done(`${b.id} is cancelled (archived from ${label}).`);
    }
  }
}

/**
 * The emergency lane: every emergency build that is split goes to pulling-main at once (no waiting for the active
 * place) and is worked on beside the active build, its steps in the emergency slot pool. Grants of builds that are no
 * longer live emergency builds are taken back first. From build-complete on the lander has it (front of its line).
 */
function advanceEmergency(env, out, { launch, build = '' }) {
  try { syncGrants(loadStore()); } catch (e) { logLine({ event: 'emergency-grants', error: str(e.message) }); }
  for (const e0 of P2.emergencyBuilds(p2Builds(loadStore()))) {
    if (build && e0.id !== build) continue;
    let e = e0;
    if (!P2.holdsActive(e)) {
      if (!move(e.id, 'pulling-main', { why: 'emergency build: skips the line' })) continue;
      logLine({ event: 'emergency-activated', build: e.id }); say('orchestrator', 'done', `${e.id} is an emergency build: it skips the line and builds in the emergency slots.`, e.id);
      e = loadStore().builds.find((x) => x.id === e.id);
    }
    out.emergency.push(e.id);
    if (!env.AXF_P2_ACCOUNTS && PL.seesAccounts && !PL.seesAccounts(env)) { out.waits.push({ id: e.id, why: 'main pulls and launches run on the VPS host (the next host tick)' }); continue; }
    work(e, env, out, { launch });
  }
}

/** The table's view: every Pipeline 2.0 build with its label and steps. */
export function statusView(store = loadStore()) {
  const builds = p2Builds(store);
  return { active: P2.activeBuild(builds).active?.id ?? '', emergency: P2.emergencyBuilds(builds).map((b) => b.id), builds: builds.map((b) => ({ id: b.id, title: b.title, ...(P2.isEmergency(b) ? { emergency: true } : {}), status: b.status, label: P2.labelOf(b.status, b.attempt), at: b.statusAt, by: b.statusBy,
    steps: b.steps.map((s) => ({ id: s.id, status: s.status ?? '', label: P2.labelOf(s.status, s.attempt, 'step'), model: s.model, account: s.account ?? '', slot: s.slot ?? '', prNumber: s.prNumber ?? null })) })) };
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (n, d = '') => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : d; };
  const json = rest.includes('--json');
  await pl();
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'advance' || cmd === 'step-exit' || cmd === 'retry') {
    // the dispatcher's lock, as pipeline.mjs takes it: re-exec under flock unless already inside it
    const { pipelineLock } = await pl();
    if (process.env.AXF_PIPELINE_LOCKED !== '1' && spawnSync('flock', ['-V'], { encoding: 'utf8' }).status === 0) {
      const r = spawnSync('flock', ['-w', '120', pipelineLock(), process.execPath, fileURLToPath(import.meta.url), ...argv], { stdio: 'inherit', env: { ...process.env, AXF_PIPELINE_LOCKED: '1' } });
      process.exit(r.status ?? 1);
    }
  }
  if (cmd === 'advance') { const r = advance({ build: flag('build') }); return print(r, `active ${r.active || 'none'} · split ${r.split.length} · main pulled ${r.pulled.length} · ready ${r.ready.length} · launched ${r.launched.length} · failed ${r.failed.length}${r.waits.length ? `\n${r.waits.map((w) => `  waits ${w.id}${w.step ? `/${w.step}` : ''}: ${w.why}`).join('\n')}` : ''}`); }
  if (cmd === 'step-exit') { const r = stepExit(rest[0], rest[1], { exit: Number(flag('exit', '0')), hit: flag('hit'), account: flag('account'), session: flag('session'), by: flag('by', 'headless') }); return print(r, r.why || r.status); }
  if (cmd === 'retry') { if (!rest[0]) throw new Error('retry <build> [--why w] [--by who]'); const r = retryBuild(rest[0], { by: flag('by', process.env.AXF_ACTOR || 'cli'), why: flag('why') }); return print({ ok: true, ...r }, `${r.id}: ${P2.labelOf(r.status)}${r.steps.length ? ` · steps ${r.steps.map((x) => `${x.id} → ${x.status}`).join(', ')}` : ''} · the attempt counts start again`); }
  if (cmd === 'act') {
    const [id, action] = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--by', '--why', '--step'].includes(rest[i - 1])));
    try {
      if (!id || !action) throw Object.assign(new Error(`act <build> <${BUILD_ACTIONS.join('|')}> [--step s] [--why w] [--by who]`), { code: 2 });
      const r = actBuild(id, action, { by: flag('by', process.env.AXF_ACTOR || 'cli'), why: flag('why'), step: flag('step') });
      return print({ ok: true, ...r }, r.say);
    } catch (e) {
      if (!(e instanceof FlowRefused) && e.code !== 2) throw e;
      process.exitCode = 2;
      return json ? console.log(JSON.stringify({ ok: false, error: e.message })) : console.error(e.message);
    }
  }
  if (cmd === 'status') { const v = statusView(); return print(v, v.builds.map((b) => `${b.id}: ${b.label}${b.id === v.active ? ' (active)' : ''}\n${b.steps.map((s) => `  ${s.id} ${s.label} ${s.model}${s.account ? ` · ${s.account}` : ''}${s.slot ? ` · ${s.slot}` : ''}`).join('\n')}`).join('\n') || 'no Pipeline 2.0 builds'); }
  console.error('usage: pipeline2.mjs advance | status | retry <build> | act <build> <action> | step-exit <build> <step> --exit n [--hit usage|auth] (see the header)'); process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(`pipeline2: ${e.message}`); process.exitCode = 1; });
