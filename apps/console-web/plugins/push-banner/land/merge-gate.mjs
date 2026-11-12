#!/usr/bin/env node
/**
 * Merge gate runner (build auto-rebuild-failed-merges, Brett Nov 11 2026: "If something fails, re-pull in main and
 * rebuild it."). Plain Node on the VPS host, node built-ins only like the rest of this folder: git, the GitHub REST API,
 * the console's own routes, and the orchestrator's CLI (pipeline.mjs request, the only launcher) as a child process. It
 * never calls a model itself and never pushes to main. The rules are merge-gate-core.mjs.
 *
 * Runs in every auto-land round right after the merge queue (land.mjs run, cron every 3 minutes). Per round:
 *   1. commands from the console / CLI / MCP / voice (merge-gate-control.json) are applied;
 *   2. every finished build that can't merge is found: kicked out of the merge queue (code conflict with main, or its
 *      batch went red), auto-land's conflict / red CI (when auto-land is on), and branches too far behind main;
 *   3. a running attempt is followed: its PR merged (green, Merged), passed its checks (green, Passed), failed again or
 *      ran out of time (the attempt failed: the next one starts, or after `cap` the entry is held, red);
 *   4. a new attempt: fix (yellow: main merged into the branch, then a fix session filed with the orchestrator when code
 *      needs changing) or rebuild (blue: a fresh <name>-rN build from main with the original brief, the old build
 *      superseded and linked, its PR closed);
 *   5. each step is posted in the crew's group chat as the owner of section `landing`, the phone notification for the
 *      build (alert key gate:<build>) is updated in place, and a red one also raises merge.blocked (land:gate:<build>).
 * Everything goes to merge-log.json in the push banner's data folder (merge-log@1), which is never trimmed by clearing.
 *
 *   node apps/console-web/plugins/push-banner/land/merge-gate.mjs run [--dry-run] [--json]   one round on its own
 *   … log [--json] [--all]                                every entry (--all: archived too)
 *   … show <build|pr> [--json]                            one entry with every attempt and why
 *   … retry|fix|rebuild|merge|skip|automerge|clear|restore|archive <build|pr…> [--group failed|merged|working]
 *   … settings [--on|--off] [--cap n] [--behind n]
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './merge-gate-core.mjs';

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }

export const logFile = (s) => join(s.dataDir, 'merge-log.json');
export const gateControlFile = (s) => join(s.dataDir, 'merge-gate-control.json');
export const readLog = (s) => ({ $axf: G.LOG_FRAME, entries: [], applied: [], ...(readJson(logFile(s), {}) || {}) });
export const readGateControl = (s) => ({ $axf: G.CONTROL_FRAME, cmds: [], ...(readJson(gateControlFile(s), {}) || {}) });
export function readGateConfig(s) {
  const c = readJson(join(s.dataDir, 'config.json'), {}) || {};
  const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  return { on: c.mergeGate !== false, cap: int(c.mergeGateCap, 1, G.CAP_MAX, G.GATE_DEFAULTS.mergeGateCap), behindLimit: int(c.mergeGateBehind, 10, 5000, G.GATE_DEFAULTS.mergeGateBehind) };
}

/** Queue a command for the next round; flag commands (clear / restore / archive) show at once through withPending. */
export function command(s, cmd, { ids = [], group = '', by = '' } = {}) {
  const d = G.addCommand(readGateControl(s), { cmd, ids, group, by });
  writeJson(gateControlFile(s), d);
  return d;
}

/**
 * The orchestrator, the only launcher: file a build (pipeline.mjs request --queue; the dispatcher starts it), add a note,
 * set a status, point a build at a branch. Child processes, so this folder keeps to node built-ins.
 */
export function makeOrchestrator(s) {
  const pipe = join(s.repo, 'apps/console-web/plugins/build-orchestrator/pipeline.mjs');
  const orch = join(s.repo, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs');
  const run = (file, args) => {
    const r = spawnSync(process.execPath, [file, ...args, '--json'], { cwd: s.repo, encoding: 'utf8', timeout: 120000, env: { ...process.env, AXF_ACTOR: 'merge-gate' } });
    let out = {}; try { out = JSON.parse(String(r.stdout || '').trim().split('\n').pop() || '{}'); } catch { /* plain text */ }
    if (r.status !== 0) throw new Error(String(r.stderr || r.stdout || 'failed').trim().slice(-300));
    return out;
  };
  return {
    request: ({ id, title, detail, said = '' }) => run(pipe, ['request', '--id', id, '--title', title, '--detail', detail, ...(said ? ['--said', said] : []), '--queue', '--by', 'merge-gate', '--source', 'merge-gate']),
    act: (change) => run(orch, ['act', '--json', JSON.stringify(change)]),
  };
}

/** The failing step of each failed job of an Actions run, as key error lines (one call per new failure). */
async function errorLines(gh, s, runUrl) {
  const m = String(runUrl || '').match(/\/actions\/runs\/(\d+)/);
  if (!m) return [];
  try {
    const jobs = (await gh('GET', `/repos/${s.slug}/actions/runs/${m[1]}/jobs?per_page=50`))?.jobs || [];
    return jobs.filter((j) => j.conclusion === 'failure').flatMap((j) => (j.steps || []).filter((x) => x.conclusion === 'failure').map((x) => `${j.name}: step "${x.name}" failed`)).slice(0, 6);
  } catch { return []; }
}

/**
 * The builds that can't merge right now, by branch: { branch, build, pr, head, title, agent, trigger }. From the merge
 * queue's kicked / conflicting PRs and auto-land's blocked builds.
 */
export function failuresOf({ queue = {}, land = {}, builds = [], entries = [] }) {
  const out = new Map();
  const add = (branch, f) => { if (branch && !out.has(branch)) out.set(branch, { branch, ...f }); };
  const kickedBy = new Map((queue.kicked || []).map((k) => [k.pr, k]));
  for (const w of queue.waiting || []) {
    const why = String(w.why || '');
    if (w.state === 'kicked' || /conflicts with main in code/.test(why)) {
      const k = kickedBy.get(w.pr) || { pr: w.pr, head: w.head, why: why.replace(/^kicked out: /, '') };
      add(w.branch, { build: w.build || '', pr: w.pr, head: w.head || k.head || '', title: w.title || '', agent: w.agent || '', trigger: G.triggerFromKick({ ...k, head: w.head || k.head }) });
    }
  }
  for (const it of land.items || []) {
    if (it.state === 'blocked' && ['conflict', 'ci'].includes(it.reason?.kind)) add(it.branch, { build: it.id, pr: it.pr || null, head: it.head || '', title: it.title || '', agent: '', trigger: G.triggerFromLand(it.reason, it.head) });
  }
  // a rebuild's branch belongs to the entry that started it (its build may not be on main's store yet)
  for (const f of out.values()) if (!f.build) f.build = entries.find((e) => e.branch === f.branch && !e.archived)?.build || builds.find((b) => b.branch === f.branch)?.id || '';
  return [...out.values()].filter((f) => f.build);
}

const prOfBranch = (queue, branch) => [...(queue.items || []), ...(queue.waiting || [])].find((x) => x.branch === branch) || null;

/**
 * One gate round. `queue` / `land` are what this round's merge queue and auto-land wrote (read from the data folder
 * when not given). Returns the log.
 */
export async function gateRound({ s, git, gh, api = async () => null, orch = makeOrchestrator(s), mergeMain = null, queueCtl = null, say = () => {}, dry = false, now = () => new Date(), log = () => {}, queue = null, land = null } = {}) {
  const cfg = readGateConfig(s);
  const at = now().toISOString();
  let doc = readLog(s);
  const ctl = readGateControl(s);
  const applied = new Set(doc.applied || []);
  queue = queue || readJson(join(s.dataDir, 'merge-queue.json'), {}) || {};
  land = land || readJson(join(s.dataDir, 'land.json'), {}) || {};
  const storeText = git(['show', `${s.remote}/${s.base}:_claude/builds/store.json`]);
  const builds = storeText.code ? [] : (JSON.parse(storeText.out).builds || []).filter((b) => !b.deleted);
  const buildOf = (id) => builds.find((b) => b.id === id) || null;
  const taken = new Set([...builds.map((b) => b.id), ...(doc.entries || []).flatMap((e) => (e.attempts || []).map((x) => x.job?.build).filter(Boolean))]);
  const entries = new Map((doc.entries || []).map((e) => [e.id, e]));
  const put = (e) => entries.set(e.id, e);
  const capOf = (e) => cfg.cap + (e.capExtra || 0);
  const notify = async (e) => { if (!dry) await api('POST', '/api/alerts', G.alertFor(e, { cap: capOf(e) })); };
  const behindOf = (branch) => { const r = git(['rev-list', '--count', `${s.remote}/${branch}..${s.remote}/${s.base}`]); return r.code ? 0 : Number(r.out) || 0; };

  // 1. commands
  const forced = new Map();
  for (const c of ctl.cmds || []) {
    if (applied.has(c.id)) continue;
    applied.add(c.id);
    if (G.FLAG_CMDS.includes(c.cmd)) { doc = G.applyFlag({ ...doc, entries: [...entries.values()] }, c, at); entries.clear(); for (const e of doc.entries) put(e); continue; }
    for (const id of G.selectIds({ entries: [...entries.values()] }, c)) forced.set(id, [...(forced.get(id) || []), { cmd: c.cmd, by: c.by || '' }]);
  }

  const startNext = async (e0, trigger, force = '') => {
    let e = e0;
    const step = G.nextAttempt(e, trigger, { cap: capOf(e), behindLimit: cfg.behindLimit, force });
    if (step.kind === 'hold') {
      e = G.hold(e, { at, cap: capOf(e) });
      if (!dry) {
        await notify(e);
        await api('POST', '/api/alerts', { source: 'push-banner', key: `land:gate:${e.build}`, severity: 'error', title: `Landing blocked: ${e.title || e.build}`.slice(0, 200), body: `Failed ${e.attempts.length} times. ${G.redWhy(e)}`.slice(0, 1500) });
        say('blocked', `Brett, ${e.build} failed ${e.attempts.length} times and is held. ${G.redWhy(e)}`.slice(0, 600), e.build);
      }
      return e;
    }
    const b = buildOf(e.build) || {};
    if (step.kind === 'fix') {
      let note = ''; let mergedMain = false; let fixBuild = ''; let mergedHead = '';
      // re-pull main first (data conflicts resolved by the landing rules; a code conflict aborts and is left for the session)
      const mm = mergeMain || (await import('./land.mjs')).mergeMain;
      const m = dry ? { merged: false, conflicts: [] } : mm({ s, git, b: { id: e.build, branch: e.branch }, dry: false });
      if (m.merged) { mergedMain = true; mergedHead = m.sha || ''; note = 'Pulled main into the branch.'; git(['fetch', '-q', s.remote, `+refs/heads/${e.branch}:refs/remotes/${s.remote}/${e.branch}`]); }
      else if (m.conflicts?.length) { trigger = { ...trigger, kind: 'conflict', files: m.conflicts }; note = `Main conflicts in ${m.conflicts.slice(0, 4).join(', ')}: a fix session resolves them.`; }
      const dataOnly = mergedMain && G.normTrigger(trigger).kind === 'conflict';
      if (!dataOnly) {
        fixBuild = `${e.build}-fix${step.n}`.slice(0, 80);
        const t = G.normTrigger(trigger);
        const detail = G.fixBrief({ entry: e, attempt: step.n, trigger: t, mergedMain, report: `_claude/builds/reports/${e.build}.md` });
        if (!dry) {
          try { orch.request({ id: fixBuild, title: `Merge fix ${step.n}: ${e.title || e.build}`.slice(0, 200), detail }); orch.act({ action: 'update', id: fixBuild, branch: e.branch }); note = `${note} Fix session ${fixBuild} filed with the orchestrator.`.trim(); }
          catch (err) { note = `${note} Couldn't file the fix session: ${String(err.message).slice(0, 160)}`.trim(); fixBuild = ''; }
        }
      } else note = `${note} The conflict was in data files only: resolved without a session; the queue re-tests it.`;
      e = G.startAttempt(e, 'fix', trigger, { at, cap: capOf(e), job: { build: fixBuild, branch: e.branch, mergedMain, mergedHead, note } });
      if (!dry) say('start', `Auto-fixing ${e.build} (attempt ${step.n} of ${capOf(e)}): ${G.whyText(trigger)} ${note}`.slice(0, 600), e.build);
    } else {
      const newId = G.rebuildId(e.build, taken); taken.add(newId);
      const original = [b.origin?.said ? `Brett said: ${b.origin.said}` : '', b.detail || '', b.origin?.brief ? String(b.origin.brief).slice(0, 3000) : ''].filter(Boolean).join('\n\n');
      const detail = G.rebuildBrief({ entry: { ...e, attempts: [...e.attempts, { n: step.n, kind: 'rebuild', why: G.whyText(trigger), trigger: G.normTrigger(trigger) }] }, newId, original, report: `_claude/builds/reports/${e.build}.md` });
      let note = `Fresh build ${newId} from main (branch claude/${newId}); ${e.build} superseded.`;
      if (!dry) {
        try {
          orch.request({ id: newId, title: `${(b.title || e.title || e.build).replace(/\s*\(rebuild \d+\)$/, '')} (rebuild ${step.n})`.slice(0, 200), detail, said: b.origin?.said || '' });
          try { orch.act({ action: 'note', id: e.build, text: `Superseded by ${newId} (merge gate full rebuild, attempt ${step.n}): ${G.whyText(trigger)}` }); orch.act({ action: 'archive', id: e.build }); } catch { /* the old build may be gone */ }
          try { orch.act({ action: 'note', id: newId, text: `Rebuild of ${e.build} (branch ${e.branch}${e.pr ? `, PR #${e.pr}` : ''}) by the merge gate.` }); } catch { /* best effort */ }
          if (e.pr) {
            await gh('POST', `/repos/${s.slug}/issues/${e.pr}/comments`, { body: `**Superseded by a full rebuild.** The merge gate couldn't get this branch green (${G.whyText(trigger)}). Build \`${newId}\` re-implements it on today's main; this PR is closed.` }).catch(() => {});
            await gh('PATCH', `/repos/${s.slug}/pulls/${e.pr}`, { state: 'closed' }).catch(() => {});
          }
        } catch (err) { note = `Couldn't file the rebuild ${newId}: ${String(err.message).slice(0, 160)}`; }
      }
      const old = { build: e.build, branch: e.branch, pr: e.pr };
      e = G.startAttempt(e, 'rebuild', trigger, { at, cap: capOf(e), job: { build: newId, branch: `claude/${newId}`, note } });
      e.links = { ...e.links, chain: [...(e.links?.chain || []), { ...old, supersededBy: newId, at }] };
      e.pr = null; e.current = newId;
      if (!dry) say('start', `Full rebuild of ${old.build} (attempt ${step.n} of ${capOf(e)}): ${G.whyText(trigger)} ${note}`.slice(0, 600), old.build);
    }
    await notify(e);
    return e;
  };

  // 2. what can't merge now (also off: the log still records nothing new, commands still apply)
  const fails = cfg.on ? failuresOf({ queue, land, builds, entries: [...entries.values()] }) : [];
  for (const f of fails) { const n = behindOf(f.branch); if (n > cfg.behindLimit) f.trigger = G.normTrigger({ ...f.trigger, kind: f.trigger.kind === 'conflict' ? 'behind' : f.trigger.kind, behind: n }); else f.trigger.behind = n; }
  const failOfBranch = new Map(fails.map((f) => [f.branch, f]));
  const mergedPrs = new Map((queue.merged || []).map((m) => [m.pr, m]));

  // 3. follow the running attempts and the passed ones
  for (const e0 of [...entries.values()]) {
    let e = e0;
    if (e.archived || ['merged', 'skipped'].includes(e.state)) continue;
    const a = G.running(e);
    const p = prOfBranch(queue, e.branch);
    if (!e.pr && p?.pr) e = { ...e, pr: p.pr };
    if (e.pr && mergedPrs.has(e.pr) && Date.parse(mergedPrs.get(e.pr).at || 0) >= Date.parse(a?.startedAt || e.createdAt || 0)) {
      e = G.merged(e, { at, sha: mergedPrs.get(e.pr).sha, pr: e.pr });
      if (!dry) { await notify(e); await api('POST', '/api/alerts/resolve', { keys: [`land:gate:${e.build}`] }); say('done', `${e.build} merged after ${e.attempts.length} attempt${e.attempts.length === 1 ? '' : 's'}.`, e.build); }
      put(e); continue;
    }
    if (e.state === 'failed') { put(e); continue; }
    if (!a) { put(e); continue; }
    const f = failOfBranch.get(e.branch);
    const job = a.job?.build ? buildOf(a.job.build) : null;
    if (job?.pipeline?.account && !a.job.account) e = { ...e, attempts: e.attempts.map((x) => (x === a ? { ...x, job: { ...x.job, account: job.pipeline.account, cost: typeof job.costUsd === 'number' ? job.costUsd : x.job.cost } } : x)) };
    const passed = p && !f && (p.state === 'passed' || p.state === 'testing' && p.ci === 'success' || p.prCi === 'success' && p.state !== 'kicked') && (!a.startHead || p.head !== a.startHead || a.job?.mergedMain);
    if (passed) {
      e = G.endAttempt(e, 'passed', { at, tests: `PR checks ${p.prCi || p.ci || 'green'}` });
      if (e.autoMerge === false && queueCtl && !dry) queueCtl('remove', p.pr, { why: 'auto-merge is off for this build: waits for Merge' });
      if (!dry) { await notify(e); say('done', `${e.build} passed its checks (attempt ${G.running(e0)?.n || ''}); it lands through the merge queue.`, e.build); }
      put(e); continue;
    }
    // a fix session's own heads (the branch as it was, main merged in) failing again don't count until the session ends
    const session = !!a.job?.build && a.kind === 'fix';
    const own = new Set([a.startHead, a.job?.mergedHead].filter(Boolean));
    const jobDone = job && ['built', 'complete', 'failed', 'archived'].includes(job.status);
    const stale = Date.parse(at) - Date.parse(a.startedAt) > G.ATTEMPT_HOURS * 3600e3;
    const newFail = f && (a.kind === 'rebuild' || (session ? !own.has(f.head) : f.head !== a.startHead));
    if (newFail || (session && jobDone && f) || job?.status === 'failed' || stale) {
      const trig = f ? f.trigger : { kind: 'ci', text: stale ? `nothing to show after ${G.ATTEMPT_HOURS} hours` : `the ${a.kind} session ${a.job.build} failed` };
      if (f?.trigger?.runUrl && !dry) f.trigger.errors = await errorLines(gh, s, f.trigger.runUrl);
      e = G.endAttempt(e, 'failed', { at, trigger: trig, note: jobDone ? `${a.job.build} ended ${job.status}.` : '' });
      if (!dry) say('failed', `${e.build}: attempt ${a.n} (${a.kind === 'rebuild' ? 'full rebuild' : 'auto-fix'}) didn't get it green: ${G.whyText(trig)}`.slice(0, 600), e.build);
      if (!forced.has(e.id)) e = await startNext(e, f ? f.trigger : trig);
    }
    put(e);
  }

  // 4. new failures: a build with no live entry starts at attempt 1; a passed one that fails again starts its next attempt
  for (const f of fails) {
    const live = [...entries.values()].find((e) => !e.archived && (e.branch === f.branch || e.build === f.build) && !['merged', 'skipped'].includes(e.state));
    if (live && (G.running(live) || live.state === 'failed')) continue;
    if (!dry && f.trigger.runUrl) f.trigger.errors = await errorLines(gh, s, f.trigger.runUrl);
    let e = live || G.newEntry({ build: f.build, title: f.title || buildOf(f.build)?.title || f.build, branch: f.branch, pr: f.pr, repo: s.slug, agent: f.agent, at });
    if (!live) {
      const old = entries.get(e.id) || [...entries.values()].find((x) => x.branch === f.branch);
      if (old?.state === 'skipped') continue; // Brett said stop: it stays in the log, no more attempts
      if (old) e = { ...old, state: 'fixing', branch: f.branch, pr: f.pr, archived: false };
    }
    if (forced.has(e.id)) { put(e); continue; }
    put(await startNext(e, f.trigger));
  }

  // 5. Brett's commands
  for (const [id, cs] of forced) for (const c of cs) {
    let e = entries.get(id); if (!e) continue;
    const f = failOfBranch.get(e.branch);
    const trig = f?.trigger || G.running(e)?.trigger || e.attempts.at(-1)?.trigger || { kind: 'ci', text: 'started by hand' };
    const endRunning = (why) => { if (G.running(e)) e = G.endAttempt(e, 'failed', { at, note: why }); };
    if (c.cmd === 'skip') { endRunning(`skipped by ${c.by || 'hand'}`); e = { ...e, state: 'skipped', outcome: 'skipped', updatedAt: at, timeline: [...e.timeline, { at, text: `Skipped by ${c.by || 'hand'}.` }] }; }
    else if (c.cmd === 'automerge') { e = { ...e, autoMerge: e.autoMerge === false, updatedAt: at, timeline: [...e.timeline, { at, text: `Auto-merge ${e.autoMerge === false ? 'on' : 'off'} for this build (${c.by || 'hand'}).` }] }; }
    else if (c.cmd === 'merge') { if (e.pr && queueCtl && !dry) queueCtl('add', e.pr, {}); e = { ...e, updatedAt: at, timeline: [...e.timeline, { at, text: `Sent to the merge queue by ${c.by || 'hand'}${e.pr ? ` (#${e.pr})` : ' (no PR yet)'}.` }] }; }
    else if (cfg.on || c.cmd !== 'retry') {
      endRunning(`replaced by ${c.cmd} (${c.by || 'hand'})`);
      if (e.state === 'failed' || e.state === 'skipped' || e.state === 'merged') e = { ...e, capExtra: (e.capExtra || 0) + Math.max(1, e.attempts.length + 1 - cfg.cap - (e.capExtra || 0)) };
      e = await startNext(e, trig, c.cmd === 'retry' ? '' : c.cmd);
    }
    put(e);
  }

  doc = { $axf: G.LOG_FRAME, at, on: cfg.on, cap: cfg.cap, behindLimit: cfg.behindLimit, entries: [...entries.values()].sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt))), applied: [...applied].slice(-300) };
  if (!dry) {
    writeJson(logFile(s), doc);
    // the control file keeps only commands not applied yet (a command written during this round stays)
    const now2 = readGateControl(s);
    writeJson(gateControlFile(s), { ...now2, cmds: (now2.cmds || []).filter((c) => !applied.has(c.id)) });
  }
  log(`merge gate: ${doc.entries.filter((e) => G.running(e)).length} working, ${doc.entries.filter((e) => e.state === 'failed').length} held`);
  return doc;
}

// ------------------------------------------------------------------ CLI

const lineOf = (e, cap) => { const v = G.bannerView(e, { cap }); return `${v.label.padEnd(30)} ${e.build}${e.pr ? ` #${e.pr}` : ''}${e.banner?.cleared ? ' (cleared)' : ''}${e.archived ? ' (archived)' : ''} · ${v.why}`; };

export async function main(argv) {
  const { settings, makeGit, makeGitHub, makeConsole, crewSay } = await import('./land.mjs');
  const { queueControl } = await import('./merge-queue.mjs');
  const json = argv.includes('--json'); const dry = argv.includes('--dry-run');
  const args = argv.filter((a) => !['--json', '--dry-run'].includes(a));
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] || '' : ''; };
  const [cmd = 'log', ...rest] = args;
  const s = settings();
  const cfg = readGateConfig(s);
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'run') {
    const gh = makeGitHub(s);
    const doc = await gateRound({ s, git: makeGit(s.repo), gh, api: makeConsole(s), dry, queueCtl: (c, pr, o) => queueControl(s, c, pr, o), say: (ev, text, ref) => crewSay('landing', ev, text, { ref, repo: s.repo }), log: (m) => !json && console.error(m) });
    gh.save();
    return print(doc, doc.entries.map((e) => lineOf(e, cfg.cap)).join('\n') || 'the merge gate has nothing to fix');
  }
  if (cmd === 'log') {
    const doc = G.withPending(readLog(s), readGateControl(s));
    const es = doc.entries.filter((e) => args.includes('--all') || !e.archived);
    return print({ ...doc, entries: es, rows: G.gridRows(doc, { archived: args.includes('--all'), cap: cfg.cap }), groups: G.bannerGroups(doc, { cap: cfg.cap }), settings: cfg }, es.map((e) => lineOf(e, cfg.cap)).join('\n') || 'the merge log is empty');
  }
  if (cmd === 'show') {
    const doc = G.withPending(readLog(s), readGateControl(s));
    const id = G.selectIds(doc, { ids: [rest[0] || ''] })[0];
    const e = doc.entries.find((x) => x.id === id); if (!e) throw new Error(`no merge log entry for ${rest[0] || '(nothing)'}`);
    return print(e, G.copyWhy(e, { cap: cfg.cap }));
  }
  if (G.CMD_IDS.includes(cmd)) {
    const ids = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--group' && rest[i - 1] !== '--by');
    const d = command(s, cmd, { ids, group: opt('group'), by: opt('by') || process.env.AXF_ACTOR || 'cli' });
    const c = d.cmds.at(-1);
    return print({ ok: true, command: c }, `${cmd}: ${c.group ? `every ${c.group} entry` : c.ids.join(', ')} (${G.FLAG_CMDS.includes(cmd) ? 'shown at once' : 'carried out at the next round, within 3 minutes'})`);
  }
  if (cmd === 'settings') {
    const f = join(s.dataDir, 'config.json'); const c = readJson(f, {}) || {};
    let changed = false;
    if (args.includes('--on')) { c.mergeGate = true; changed = true; }
    if (args.includes('--off')) { c.mergeGate = false; changed = true; }
    if (opt('cap')) { const n = Number(opt('cap')); if (!Number.isInteger(n) || n < 1 || n > G.CAP_MAX) throw new Error(`--cap is 1 to ${G.CAP_MAX}`); c.mergeGateCap = n; changed = true; }
    if (opt('behind')) { const n = Number(opt('behind')); if (!Number.isInteger(n) || n < 10 || n > 5000) throw new Error('--behind is 10 to 5000'); c.mergeGateBehind = n; changed = true; }
    if (changed) writeJson(f, { $axf: 'push-banner-config@1', ...c });
    const now = readGateConfig(s);
    return print(now, `merge gate ${now.on ? 'on' : 'off'} · ${now.cap} attempts · rebuild when more than ${now.behindLimit} commits behind`);
  }
  throw new Error('usage: merge-gate.mjs run [--dry-run] | log [--all] | show <build|pr> | retry|fix|rebuild|merge|skip|automerge|clear|restore|archive <build|pr…> [--group failed|merged|working] | settings [--on|--off] [--cap n] [--behind n]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
