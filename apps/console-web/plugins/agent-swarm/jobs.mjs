#!/usr/bin/env node
/**
 * Agent jobs: route a recurring job (job-type@1) to the hired agent who owns it and launch it headless.
 * Reached through `node framework/cli/agent-job.mjs …` (found by capability service:agent-jobs@1), the console's
 * Breakroom → Jobs (Run), or directly:
 *
 *   node apps/console-web/plugins/agent-swarm/jobs.mjs list                         job types, owner, last run, next, cost
 *   … <job-type> [--input k=v]… [--dry-run]     route + brief + launch (deploy/claude-headless.sh, session <agent>-<job>)
 *   … run <job-type> [--input k=v]… [--dry-run]  same
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
  const r = jc.route(jt, roster, st, runs, table, at);
  if (!r.ok) {
    if (!opts.dry) say([jc.unassignedLine(jt, r.why)]);
    return { ok: false, unassigned: r.unassigned, why: r.why, tried: r.tried, jobType: jt.id };
  }
  const values = jc.checkInputs(jt, opts.inputs ?? {});
  const runId = jc.runIdFor(jt, at); const agent = r.agent;
  const skill = loadSkills()[agent.skill] ?? null;
  const brief = jc.jobBrief(jt, agent, { values, at, runId, skill, notes: loadNotes(agent.id), persona: loadPersona() });
  const args = jc.jobArgs(jt, agent, r.model); const session = jc.sessionName(agent, jt);
  if (opts.dry) return { ok: true, dry: true, jobType: jt.id, agent: agent.id, model: r.model, cap: r.cap, session, runId, brief, args };
  if (jc.lastRunOf(runs, jt.id)?.jobId === runId) throw new Error(`${jt.name} already started this minute (${runId})`);
  const wt = jobWorktree(jt, runId, runId.slice(-15));
  const briefFile = join(dataDir(), 'job-briefs', `${runId}.md`); mkdirSync(join(dataDir(), 'job-briefs'), { recursive: true }); writeFileSync(briefFile, `${brief.text}\n`);
  const log = `.axf-job-${runId}.log`.slice(0, 80);
  const p = spawnSync('bash', [launcher(), '--name', session, '--brief', briefFile, '--log', log, '--', ...args], { cwd: wt.path, encoding: 'utf8', env: { ...process.env, AXF_SURFACE: 'agent-job', AXF_MODEL: r.model, AXF_SESSION: session }, timeout: 60000 });
  if (p.status !== 0) throw new Error(`launch failed: ${(p.stderr || p.stdout || '').trim().slice(-400)}`);
  const started = /started (\S+)/.exec(p.stdout ?? ''); const tmux = started && !started[1].startsWith('pid') ? started[1] : '';
  const rec = { ...jc.jobRunRecord(jt, agent, r.model, { runId, at, session, brief, cwd: wt.path, branch: wt.branch, log, inputs: values }), tmux, briefFile };
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

const tmuxAlive = (s) => !!s && spawnSync('tmux', ['has-session', '-t', `=${s}`], { encoding: 'utf8' }).status === 0;
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
    const alive = opts.alive ? opts.alive(r) : tmuxAlive(r.tmux);
    if (!tr.final && alive) continue;
    const o = core.runOutcome(tr, { exitCode: tr.final ? (tr.isError ? 1 : 0) : 1 });
    const rec = updateRun(r.jobId, { endedAt: new Date().toISOString(), status: tr.final ? o.status : 'error', reason: tr.final ? o.reason : 'the session ended without a result', report: o.report, usage: tr.usage, budgetTokens: core.budgetTokens(tr.usage), turns: tr.turns, reportedCost: tr.reportedCost });
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
    core.post(s, [{ from: core.BOSS.id, kind: 'status', text: `Hired ${agent.name} to own ${jt.name}. Welcome to the crew.` }], at);
  });
  return { agent, skill };
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
  const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--input');
  const [cmd = 'list', ...rest] = pos;
  if (cmd === 'list') {
    sweep(); const v = list();
    return out({ ok: true, jobs: v }, v.map((j) => `${j.id.padEnd(20)} ${(j.owners.map((o) => o.name).join(', ') || 'UNASSIGNED').padEnd(16)} ${j.trigger.kind.padEnd(9)} next ${j.next ? j.next.slice(0, 16) : '—'.padEnd(16)} last ${j.lastRun ? `${j.lastRun.at.slice(0, 16)} ${j.lastRun.status}` : '—'} · ${j.cost.runs} runs ${core.fmtUsd(j.cost.usd)}${j.routeWhy ? `\n  ! ${j.routeWhy}` : ''}`).join('\n') || 'No job types.');
  }
  if (cmd === 'sweep') { const c = sweep(); return out({ ok: true, closed: c }, c.length ? `closed ${c.join(', ')}` : 'nothing finished'); }
  if (cmd === 'hire') { const r = hire(rest[0]); return out({ ok: true, ...r }, `hired ${r.agent.name} (${r.agent.id}) for ${rest[0]}`); }
  if (cmd === 'due') { const r = due({ run: flag('--run'), inputs: parseInputs(args) }); return out({ ok: true, due: r }, r.map((x) => `${x.id}${x.ok === false ? ` ! ${x.why}` : ''}`).join('\n') || 'nothing due'); }
  if (cmd === 'event') { const r = event(rest[0], { run: flag('--run'), inputs: parseInputs(args) }); return out({ ok: true, jobs: r }, r.map((x) => `${x.id}${x.ok === false ? ` ! ${x.why}` : ''}`).join('\n') || `no job types for ${rest[0]}`); }
  const typeId = cmd === 'run' ? rest[0] : cmd;
  if (!typeId) throw new Error('which job type? (agent-job.mjs list)');
  const r = run(typeId, { inputs: parseInputs(args), dry: flag('--dry-run') });
  if (!r.ok) { process.exitCode = 3; return out(r, `${r.unassigned ? 'UNASSIGNED' : 'NOT ROUTED'}: ${r.why}`); }
  return out(r, r.dry ? `would run as ${r.agent} (${r.model}, up to ${core.fmtUsd(r.cap)}), session axf-${r.session}\n\n${r.brief.text}\n\nclaude ${r.args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}` : `${r.run.jobId}: ${r.run.agent} on ${r.run.model} · ${r.launched}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
