#!/usr/bin/env node
/**
 * Agent jobs: route a job (job-type@1) to an agent who can take it and launch it headless. Every agent on the job
 * crew is an all-rounder (Brett, Nov 3 2026), and every headless session is booked on a named agent before it starts.
 * Reached through `node framework/cli/agent-job.mjs …` (found by capability service:agent-jobs@1), the console's
 * Breakroom → Jobs (Run), or directly:
 *
 *   node apps/console-web/plugins/agent-swarm/jobs.mjs list                         job types, owner, last run, next, cost
 *   … <job-type> [--input k=v]… [--agent <id>] [--dry-run]   route + brief + launch (deploy/claude-headless.sh, session <agent>-<job>)
 *   … run <job-type> [--input k=v]… [--agent <id>] [--dry-run]  same (--agent: this agent, not the router's pick)
 *   … book --name <slug> [--agent <id>] [--job feature-build] [--cwd d] [--log f] [--model m] [--sh]
 *                                                a headless launch that is starting now (deploy/claude-headless.sh): book it
 *                                                on the agent given, else the router's pick (never nobody); --sh prints
 *                                                agent_id=… agent_name=… for the launcher
 *   … assign <build-name> [--agent <id>] [--job feature-build] [--cwd d] [--log f]
 *                                                attach a build already running or finished (its worktree under
 *                                                AXF_BUILDS_ROOT, default /root/axf-builds/<name>) to an agent; the sweep
 *                                                books its usage and report on the card
 *   … due [--run]                                scheduled job types that are due (and launch them)
 *   … event <name> [--input k=v]… [--run]        job types triggered by that event (and launch them)
 *   … sweep                                      finished runs: usage, status and report onto the agent (stats, cost, chat)
 *   … hire <job-type>                            one-tap hire for a job type nobody owns
 *   --json on any command prints JSON (the console server uses this).
 *
 * Job types: framework/assets/job-type/*.json (asset@1). Runs: the swarm's runs.json (swarm-run@1, kind "job").
 * The launcher is deploy/claude-headless.sh (AXF_JOB_LAUNCHER overrides, for tests), so the agent cap and queue apply
 * once they land there. Each run gets its own git worktree under the swarm's data folder.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as jc from './jobs-core.mjs';
import * as core from './web/swarm-core.mjs';
import { ROOT, chatAfterRun, dataDir, loadPersona, loadRoster, loadRuns, loadSkills, loadState, priceTable, readJson, repoRoot, runsFile, say, withState, writeJson } from './swarm.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const typesDir = () => process.env.AXF_JOB_TYPES_DIR || join(ROOT, 'framework/assets/job-type');
export const launcher = () => process.env.AXF_JOB_LAUNCHER || join(ROOT, 'deploy/claude-headless.sh');

export function loadTypes() {
  const d = typesDir(); if (!existsSync(d)) return [];
  return jc.jobTypes(readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => readJson(join(d, f), null)).filter(Boolean));
}
export function findType(id) { const jt = loadTypes().find((t) => t.id === id); if (!jt) throw new Error(`no job type "${id}" (see: agent-job.mjs list)`); return jt; }
/** The agent's own short notes (agents/notes/<id>.md), capped. */
export function loadNotes(agentId) { const f = join(HERE, 'agents/notes', `${agentId}.md`); return existsSync(f) ? readFileSync(f, 'utf8').slice(0, jc.NOTES_MAX) : ''; }

export function list() {
  const at = new Date().toISOString();
  return jc.jobsView(loadTypes(), loadRoster(), loadState(), loadRuns(), priceTable(), at);
}

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
/** A fresh worktree for one run: detached at HEAD for read-only jobs, else on its own branch agent-jobs/<type>/<stamp>. */
export function jobWorktree(jt, runId, stamp) {
  const path = join(dataDir(), 'job-worktrees', runId);
  if (existsSync(path)) return { path, branch: '' };
  mkdirSync(join(dataDir(), 'job-worktrees'), { recursive: true });
  const branch = jt.data.readOnly ? '' : `agent-jobs/${jt.id}/${stamp}`;
  const r = branch ? git(repoRoot(), 'worktree', 'add', '-b', branch, path, 'HEAD') : git(repoRoot(), 'worktree', 'add', '--detach', path, 'HEAD');
  if (r.status !== 0) throw new Error(`worktree for ${runId}: ${(r.stderr || r.stdout).trim()}`);
  return { path, branch };
}

/** Save a run's changes in place (by jobId). */
function updateRun(runId, patch) {
  const runs = loadRuns(); const i = runs.findIndex((r) => r.jobId === runId); if (i < 0) return null;
  runs[i] = { ...runs[i], ...patch }; writeJson(runsFile(), { $axf: 'swarm-runs@1', runs }); return runs[i];
}

/**
 * One run: route to the owner (on duty, under budget), write the brief, launch headless, record it on the agent.
 * opts: { inputs, dry, at }. Returns { ok, run | dry brief | unassigned, why }.
 */
export function run(typeId, opts = {}) {
  const at = opts.at ?? new Date().toISOString();
  const jt = findType(typeId); const roster = loadRoster(); const st = loadState(); const runs = loadRuns(); const table = priceTable();
  const r = jc.route(jt, roster, st, runs, table, at, { agent: opts.agent });
  if (!r.ok) {
    if (!opts.dry) say([jc.unassignedLine(jt, r.why)]);
    return { ok: false, unassigned: r.unassigned, why: r.why, tried: r.tried, jobType: jt.id };
  }
  const values = jc.checkInputs(jt, opts.inputs ?? {});
  const runId = jc.runIdFor(jt, at); const agent = r.agent;
  const skills = loadSkills(); const skill = skills[jt.data.specialty] ?? skills[agent.skill] ?? null; // the job's skill page, whoever takes it
  const brief = jc.jobBrief(jt, agent, { values, at, runId, skill, notes: loadNotes(agent.id), persona: loadPersona() });
  const args = jc.jobArgs(jt, agent, r.model); const session = jc.sessionName(agent, jt);
  if (opts.dry) return { ok: true, dry: true, jobType: jt.id, agent: agent.id, model: r.model, cap: r.cap, session, runId, brief, args };
  if (jc.lastRunOf(runs, jt.id)?.jobId === runId) throw new Error(`${jt.name} already started this minute (${runId})`);
  const wt = jobWorktree(jt, runId, runId.slice(-15));
  const briefFile = join(dataDir(), 'job-briefs', `${runId}.md`); mkdirSync(join(dataDir(), 'job-briefs'), { recursive: true }); writeFileSync(briefFile, `${brief.text}\n`);
  const log = `.axf-job-${runId}.log`.slice(0, 80);
  const p = spawnSync('bash', [launcher(), '--name', session, '--brief', briefFile, '--log', log, '--', ...args], { cwd: wt.path, encoding: 'utf8', env: { ...process.env, AXF_SURFACE: 'agent-job', AXF_MODEL: r.model, AXF_SESSION: session, AXF_AGENT: agent.id, AXF_AGENT_NAME: agent.name || agent.id, AXF_AGENT_BOOKED: runId, AXF_JOB_TYPE: jt.id }, timeout: 60000 });
  if (p.status !== 0) throw new Error(`launch failed: ${(p.stderr || p.stdout || '').trim().slice(-400)}`);
  // started now, or queued by the agent cap (agent-slots@1): a waiter starts it when a desk frees
  const started = /started (\S+)/.exec(p.stdout ?? ''); const tmux = started && !started[1].startsWith('pid') ? started[1] : '';
  const queued = /queued at position (\d+) \(([^)]+)\)/.exec(p.stdout ?? '');
  const rec = { ...jc.jobRunRecord(jt, agent, r.model, { runId, at, session, brief, cwd: wt.path, branch: wt.branch, log, inputs: values }), tmux, briefFile, queued: queued ? { position: Number(queued[1]), id: queued[2] } : null };
  const all = loadRuns(); all.push(rec); writeJson(runsFile(), { $axf: 'swarm-runs@1', runs: all.slice(-5000) });
  withState((s) => {
    core.post(s, [jc.assignJobLine(jt, agent, r.model, r.cap)], at);
    if (r.notify) s.notices.push({ at, agent: agent.id, text: `${agent.name} (probation) started ${jt.name}` });
  });
  return { ok: true, run: rec, launched: (p.stdout ?? '').trim() };
}

/** Job types due on their schedule (and launch them with --run). */
export function due(opts = {}) {
  const v = list().filter((j) => j.due);
  return opts.run ? v.map((j) => { try { return { id: j.id, ...run(j.id, { inputs: opts.inputs }) }; } catch (e) { return { id: j.id, ok: false, why: e.message }; } }) : v;
}
/** Job types triggered by an event (and launch them with --run). */
export function event(name, opts = {}) {
  const v = loadTypes().filter((t) => t.data.trigger.kind === 'event' && t.data.trigger.event === name);
  return opts.run ? v.map((t) => { try { return { id: t.id, ...run(t.id, { inputs: opts.inputs }) }; } catch (e) { return { id: t.id, ok: false, why: e.message }; } }) : v.map((t) => ({ id: t.id, name: t.name }));
}

/** A run's tmux session is up: the recorded name, or (started later by the agent cap's waiter) axf-<session>[-suffix]. */
const tmuxAlive = (r) => {
  const names = (spawnSync('tmux', ['ls', '-F', '#S'], { encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean);
  return names.some((n) => n === r.tmux || n === `axf-${r.session}` || n.startsWith(`axf-${r.session}-`));
};
const QUEUE_PATIENCE_MS = 24 * 3600e3;
/**
 * Finished runs: read each running job's raw stream (<log>.jsonl in its worktree), fill usage, turns, cost and the
 * agent's report, then book it on the agent (stats, spend, fail streak, bonus) and post the report in the chat.
 * A run whose session is gone without a result is marked error. Returns the run ids it closed.
 */
export function sweep(opts = {}) {
  const closed = [];
  for (const r of loadRuns().filter((x) => x.kind === jc.JOB_RUN_KIND && x.status === 'running')) {
    const raw = join(r.cwd || '', `${(r.log || '').replace(/\.log$/, '')}.jsonl`);
    const tr = core.newTracker();
    if (existsSync(raw)) for (const line of readFileSync(raw, 'utf8').split('\n')) if (line.trim()) core.trackLine(tr, line, r.budget);
    // queued by the agent cap and not started yet: still waiting for a desk (given up after a day)
    const waiting = !!r.queued && !existsSync(raw) && Date.now() - Date.parse(r.startedAt) < QUEUE_PATIENCE_MS;
    const alive = opts.alive ? opts.alive(r) : waiting || tmuxAlive(r);
    if (!tr.final && alive) continue;
    const build = jc.isBuildRun(r);
    const o = build ? jc.buildOutcome(tr) : core.runOutcome(tr, { exitCode: tr.final ? (tr.isError ? 1 : 0) : 1 });
    const rec = updateRun(r.jobId, { endedAt: new Date().toISOString(), status: tr.final || build ? o.status : 'error', reason: tr.final || build ? o.reason : 'the session ended without a result', report: o.report, usage: tr.usage, budgetTokens: core.budgetTokens(tr.usage), turns: tr.turns, reportedCost: tr.reportedCost });
    if (!rec) continue;
    // the final message is kept as the run's report (read-only jobs can't write files): data folder, by run id
    if (tr.text) { const f = join(dataDir(), 'job-reports', `${rec.jobId}.md`); mkdirSync(join(dataDir(), 'job-reports'), { recursive: true }); writeFileSync(f, `${tr.text.trim()}\n`); updateRun(rec.jobId, { reportFile: f }); }
    chatAfterRun(rec); closed.push(rec.jobId);
  }
  return closed;
}

/** One-tap hire: a new agent (kept in the swarm state) whose specialty owns the job type. */
export function hire(typeId) {
  const jt = findType(typeId); const roster = loadRoster(); const st = loadState();
  if (jc.owners(jt, roster, st).length) throw new Error(`${jt.name} already has an owner`);
  const at = new Date().toISOString(); const { agent, skill } = jc.hireFor(jt, roster, at);
  withState((s) => {
    s.hired.push(agent); s.hiredSkills[skill.id] = { id: skill.id, title: skill.title, body: skill.body };
    core.post(s, [core.hiredLine(agent.name, jt.name)], at);
  });
  return { agent, skill };
}

export const buildsRoot = () => process.env.AXF_BUILDS_ROOT || '/root/axf-builds';
const nameSlug = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/**
 * Book one headless session on an agent: the agent asked for, else the router's pick for the job type (default
 * feature-build) with force (the launch is starting: someone always books it, the card says when nobody was free).
 * opts: { name, agent, job, cwd, log, model, session, at, startedAt, inputs, source }. Writes the run (swarm-run@1,
 * kind job) and the boss's chat line. Returns { ok, agent, run, forced, why }.
 */
export function book(opts = {}) {
  const at = opts.at ?? new Date().toISOString();
  const name = nameSlug(opts.name); if (!name) throw new Error('book needs --name <build or session name>');
  const jt = findType(opts.job || 'feature-build'); const roster = loadRoster(); const st = loadState(); const runs = loadRuns(); const table = priceTable();
  const r = jc.route(jt, roster, st, runs, table, at, { agent: opts.agent, force: true });
  if (!r.ok) throw new Error(r.why);
  const agent = r.agent; const model = core.MODEL_TIERS.includes(opts.model) ? opts.model : r.model;
  const runId = `job-${jt.id}-${name}-${(opts.startedAt || at).replace(/[^0-9]/g, '').slice(0, 12)}`.slice(0, 120);
  const prior = runs.find((x) => x.jobId === runId);
  if (prior) return { ok: true, agent: roster.agents.find((a) => a.id === prior.agent) ?? agent, run: prior, forced: false, why: 'already booked', existing: true };
  const log = opts.log || `${name}.log`;
  const rec = { ...jc.jobRunRecord(jt, agent, model, { runId, at: opts.startedAt || at, session: opts.session || name, brief: { report: '', group: '', tokens: 0 }, cwd: opts.cwd || process.cwd(), branch: opts.branch || '', log, inputs: { build: name, ...(opts.inputs ?? {}) } }), tmux: opts.tmux || '', build: name, source: opts.source || 'launcher', forced: !!r.forced };
  const all = loadRuns(); all.push(rec); writeJson(runsFile(), { $axf: 'swarm-runs@1', runs: all.slice(-5000) });
  withState((s) => {
    core.post(s, [jc.assignJobLine({ ...jt, name: `${jt.name} ${name}` }, agent, model, r.cap)], at);
    if (r.forced) s.notices.push({ at, agent: agent.id, text: `${agent.name} booked on ${name} with nobody free: ${r.why}` });
  });
  return { ok: true, agent, run: rec, forced: !!r.forced, why: r.why };
}

/** A build's worktree details: .axhub-build.json (axHub build_start) for the model and start time, the <name>.log stream. */
export function buildInfo(name, cwd = '') {
  const dir = cwd || join(buildsRoot(), name);
  if (!existsSync(dir)) throw new Error(`no worktree for ${name} at ${dir} (pass --cwd)`);
  const meta = readJson(join(dir, '.axhub-build.json'), {}) ?? {};
  const logs = readdirSync(dir).filter((f) => /\.log$/.test(f) && existsSync(join(dir, f.replace(/\.log$/, '.jsonl'))));
  const log = logs.find((f) => f === `${name}.log`) ?? logs.find((f) => f.startsWith('.axf-')) ?? logs[0] ?? `${name}.log`;
  const startedAt = Number.isFinite(meta.startedAt) ? new Date(meta.startedAt * 1000).toISOString() : '';
  return { dir, log, model: typeof meta.model === 'string' ? meta.model : '', startedAt, repo: meta.repo ?? '', base: meta.base ?? '' };
}

/** Attach a build already running or finished to an agent (back-assign); the sweep then books its usage on the card. */
export function assign(name, opts = {}) {
  const n = nameSlug(name); if (!n) throw new Error('assign needs a build name');
  const info = buildInfo(n, opts.cwd);
  const tmuxNames = (spawnSync('tmux', ['ls', '-F', '#S'], { encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean);
  const tmux = tmuxNames.find((t) => t === `axf-${n}` || t.endsWith(`-${n}`)) ?? '';
  const r = book({ name: n, agent: opts.agent, job: opts.job, cwd: info.dir, log: opts.log || info.log, model: info.model, startedAt: info.startedAt || undefined, session: n, tmux, source: 'assign', inputs: info.repo ? { repo: info.repo } : {} });
  const closed = r.existing ? [] : sweep();
  return { ...r, closed: closed.includes(r.run.jobId) };
}

/** --input k=v pairs → { k: v }. */
export function parseInputs(args) {
  const o = {};
  args.forEach((a, i) => { if (a === '--input' && args[i + 1]) { const [k, ...v] = args[i + 1].split('='); o[k] = v.join('='); } });
  return o;
}

export async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const flag = (f) => args.includes(f);
  const VALUED = ['--input', '--agent', '--name', '--job', '--cwd', '--log', '--model', '--session'];
  const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] ?? '' : ''; };
  const pos = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
  const [cmd = 'list', ...rest] = pos;
  if (cmd === 'list') {
    sweep(); const v = list();
    return out({ ok: true, jobs: v }, v.map((j) => `${j.id.padEnd(20)} ${(j.owners.length ? `${j.owners[0].name}${j.owners.length > 1 ? ` +${j.owners.length - 1}` : ''}` : 'UNASSIGNED').padEnd(20)} ${j.trigger.kind.padEnd(9)} next ${j.next ? j.next.slice(0, 16) : '—'.padEnd(16)} last ${j.lastRun ? `${j.lastRun.at.slice(0, 16)} ${j.lastRun.status}` : '—'} · ${j.cost.runs} runs ${core.fmtUsd(j.cost.usd)}${j.routeWhy ? `\n  ! ${j.routeWhy}` : ''}`).join('\n') || 'No job types.');
  }
  if (cmd === 'sweep') { const c = sweep(); return out({ ok: true, closed: c }, c.length ? `closed ${c.join(', ')}` : 'nothing finished'); }
  if (cmd === 'hire') { const r = hire(rest[0]); return out({ ok: true, ...r }, `hired ${r.agent.name} (${r.agent.id}) for ${rest[0]}`); }
  if (cmd === 'due') { const r = due({ run: flag('--run'), inputs: parseInputs(args) }); return out({ ok: true, due: r }, r.map((x) => `${x.id}${x.ok === false ? ` ! ${x.why}` : ''}`).join('\n') || 'nothing due'); }
  if (cmd === 'event') { const r = event(rest[0], { run: flag('--run'), inputs: parseInputs(args) }); return out({ ok: true, jobs: r }, r.map((x) => `${x.id}${x.ok === false ? ` ! ${x.why}` : ''}`).join('\n') || `no job types for ${rest[0]}`); }
  if (cmd === 'book') {
    const r = book({ name: val('--name') || rest[0], agent: val('--agent'), job: val('--job'), cwd: val('--cwd'), log: val('--log'), model: val('--model'), session: val('--session'), inputs: parseInputs(args) });
    if (flag('--sh')) return console.log(`agent_id=${r.agent.id} agent_name="${r.agent.name.replace(/[^A-Za-z0-9 '._-]/g, '')}" agent_run=${r.run.jobId}`);
    return out({ ok: true, agent: r.agent.id, run: r.run, forced: r.forced, why: r.why }, `${r.run.build} booked on ${r.agent.name} (${r.agent.id})${r.forced ? ` · ${r.why}` : ''}`);
  }
  if (cmd === 'assign') {
    const r = assign(rest[0], { agent: val('--agent'), job: val('--job'), cwd: val('--cwd'), log: val('--log') });
    return out({ ok: true, agent: r.agent.id, run: r.run, closed: r.closed, existing: !!r.existing }, `${r.run.build} → ${r.agent.name} (${r.agent.id})${r.existing ? ' · already booked' : r.closed ? ' · finished, booked on the card' : ' · running'}`);
  }
  const typeId = cmd === 'run' ? rest[0] : cmd;
  if (!typeId) throw new Error('which job type? (agent-job.mjs list)');
  const r = run(typeId, { inputs: parseInputs(args), dry: flag('--dry-run'), agent: val('--agent') });
  if (!r.ok) { process.exitCode = 3; return out(r, `${r.unassigned ? 'UNASSIGNED' : 'NOT ROUTED'}: ${r.why}`); }
  return out(r, r.dry ? `would run as ${r.agent} (${r.model}, up to ${core.fmtUsd(r.cap)}), session axf-${r.session}\n\n${r.brief.text}\n\nclaude ${r.args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}` : `${r.run.jobId}: ${r.run.agent} on ${r.run.model} · ${r.launched}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
