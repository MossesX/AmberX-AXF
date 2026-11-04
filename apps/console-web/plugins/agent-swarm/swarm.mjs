#!/usr/bin/env node
/**
 * Agent swarm CLI. Reads the active build profile's orchestrator tracker (orchestrator@1; AXF_ORCH_FILE overrides),
 * the roster (agents/roster.json) and the swarm state (data folder; AXF_SWARM_DIR overrides).
 *
 *   node apps/console-web/plugins/agent-swarm/swarm.mjs roster              the agents and their skills
 *   … plan <buildId>…                    split builds into jobs: agent, model, leases, waves (several builds share one lease table)
 *   … pack <buildId> <stepId>            one job's brief: shared prefix + skill, task, leases, snippets
 *   … state | cost                       everything the console shows | the cost meter (agent, build, job)
 *   … pilot <buildId> [--apply]          plan + pack a build, project swarm vs one session, suggest a budget scale
 *   … act status <agent> <status> [note]  statuses: on-duty off-duty injured medical-leave probation fired custom
 *   … act --json '{"action":…}'          any change from swarm-core.mjs applyChange()
 *   … act salary <agent> <usd> [note]     weekly salary = budget (higher = raise, lower = docked) · act topup <agent> <usd>
 *   … sessions                           runs with the agent's status and spend (for the session browser)
 *   … crew                               the crew in one compact read (the Claude agent picker)
 *   … book '<json>'                      book a Claude session on an agent's card ({session, agent, usd?, summary?, commits?, final?})
 *   … chat [n] | banter [--dry-run]      the group chat | one cheap small-model batch of banter
 *   … mentions [n] [--negative]          chat messages about Brett (the boss, the owner), newest first, redacted
 *   … chats-export                       rewrite the hub's read-only chat mirror now (breakroom-chats@1)
 *   … act chat on|off · act chat <agent> on|off · act say <text>
 *   … act suspend <agent> <hours> <reason> · act rehire <agent> · act rules <rage-quit N>
 *   … act preset business|crew|breakroom|rails · act vibe <1-500> · act --json '{"action":"chat-settings",…}'
 *   … run <buildId> <stepId> [--dry-run] headless run of one job in its own worktree (swarm/<build>/<step>)
 *   … check <buildId> <stepId>           pre-push lease check of a job's worktree
 *   … merge <buildId> [--push]           batch merge of done, lease-clean jobs; Boss then ticks the tracker
 *   … fix <buildId> <stepId> [--dry-run] hand a merge conflict to the merge fixer
 *   --json on any command prints JSON (the console server uses this).
 */
import { existsSync, statSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/swarm-core.mjs';
import { orchestratorPath, persistRoot } from '../../../../framework/cli/persist.mjs';
import * as watch from './web/chat-watch.mjs';
import * as crewProfiles from './crew-profiles.mjs';
import { spawnSync } from 'node:child_process';
import { runJob, worktreeFor } from './runner.mjs';
import { withSlot } from '../../../../framework/cli/agent-slots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
export const trackerFile = () => process.env.AXF_ORCH_FILE || orchestratorPath();
/** The checkout the swarm works on (AXF_SWARM_REPO overrides, for tests). */
export const repoRoot = () => process.env.AXF_SWARM_REPO || ROOT;
export const dataDir = () => process.env.AXF_SWARM_DIR || join(ROOT, '.axf-console/plugins/agent-swarm');

export function readJson(f, fallback) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } }
export function writeJson(f, data) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`); renameSync(tmp, f);
}

/** The roster file plus agents hired from the Breakroom (one-tap hires for job types, kept in the swarm state). */
export function loadRoster() {
  const r = core.normRoster(readJson(join(HERE, 'agents/roster.json'), { agents: [] }));
  const hired = readJson(stateFile(), {}).hired;
  if (Array.isArray(hired)) for (const a of hired.map(core.normAgent)) if (a.id && !r.agents.some((x) => x.id === a.id)) r.agents.push(a);
  return r;
}
export function loadSkills() {
  const dir = join(HERE, 'agents/skills');
  const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => { const s = core.parseSkill(readFileSync(join(dir, f), 'utf8')); return [s.id, s]; }));
  // skill pages of Breakroom hires (made from their job type) live in the swarm state
  const hs = readJson(stateFile(), {}).hiredSkills ?? {};
  for (const [k, v] of Object.entries(hs)) if (!files[k] && typeof v?.body === 'string') files[k] = { id: k, title: String(v.title ?? k), schema: 'agent-skill@1', body: v.body.slice(0, core.SKILL_MAX_CHARS), lines: v.body.split('\n').length, chars: Math.min(v.body.length, core.SKILL_MAX_CHARS) };
  return files;
}
export function loadTracker() { const f = trackerFile(); return existsSync(f) ? readJson(f, { builds: [] }) : { builds: [] }; }
export function findBuilds(ids) {
  const t = loadTracker();
  return ids.map((id) => { const b = (t.builds ?? []).find((x) => x.id === id); if (!b) throw new Error(`no build "${id}" in ${trackerFile()}`); return b; });
}

/** Swarm state (swarm-state@1): statuses, history, pay, chat. Time-driven changes are applied on every read. */
export const stateFile = () => join(dataDir(), 'state.json');
/**
 * Read-only mirror of the group chat on the hub (breakroom-chats@1): <hub data>/agent-swarm/chats/, which sessions read
 * with axhub.memory_read (project amberx-axf, area data). AXF_SWARM_CHATS_DIR overrides ("off" = none); a test data
 * folder (AXF_SWARM_DIR) never mirrors unless that is set too.
 */
export function chatsDir() {
  const env = process.env.AXF_SWARM_CHATS_DIR;
  if (env !== undefined) return env && env !== 'off' ? env : null;
  if (process.env.AXF_SWARM_DIR) return null;
  const root = persistRoot(); return root ? join(root, watch.HUB_FOLDER) : null;
}
export function mirrorChats(st, { force = false } = {}) {
  const dir = chatsDir(); if (!dir) return null;
  const last = st.messages.at(-1);
  const sig = `${st.messages.length}:${last?.id ?? ''}:${st.chat.enabled}:${loadRoster().agents.length}`;
  if (!force && readJson(join(dir, 'index.json'), {})?.sig === sig) return dir;
  try {
    const docs = watch.chatDocs(st, loadRoster(), new Date().toISOString());
    docs['index.json'].sig = sig;
    for (const [f, doc] of Object.entries(docs)) writeJson(join(dir, f), doc); // index last: readers see whole documents
  } catch (e) { console.error(`chat mirror skipped: ${e.message}`); return null; }
  return dir;
}
/** Save the swarm state and refresh the hub mirror of its chat. */
export function writeState(st) { writeJson(stateFile(), st); mirrorChats(st); }
export function loadState() {
  const roster = loadRoster(); const at = new Date().toISOString();
  const st = core.normState(readJson(stateFile(), {}), roster); const t = core.tick(st, at);
  t.log.push(...core.payCheck(st, roster, loadRuns(), priceTable(), at));
  if (t.log.length) { st.updatedAt = at; writeState(st); }
  return st;
}
/** Load the state, change it, save it. */
export function withState(fn) { const st = loadState(); const r = fn(st); st.updatedAt = new Date().toISOString(); writeState(st); return r; }
/** Post to the group chat (dropped when it's off). */
export const say = (msgs) => withState((st) => core.post(st, msgs, new Date().toISOString()));
export function act(change) {
  const r = core.applyChange(loadState(), change, loadRoster(), new Date().toISOString());
  writeState(r.state); return r;
}
/** Only agents whose status and pay let them work get jobs (broke = no new jobs till payday or a top-up). */
export function eligibility(st = loadState()) {
  const at = new Date().toISOString(); const runs = loadRuns(); const table = priceTable();
  return (a, job) => { const as = st.agents[a.id] ?? core.normAgentState({}); return core.canWork(a, as, job, at, core.payOf(a, as, runs, table, at)).ok; };
}
export function plan(ids, opts = {}) { return core.planJobs(findBuilds(ids), loadRoster(), { eligible: eligibility(), ...opts }); }

/** The persona block of the shared prefix (agents/persona.md), empty when there is none. */
export function loadPersona() { const f = join(HERE, 'agents/persona.md'); return existsSync(f) ? core.parseSkill(readFileSync(f, 'utf8')).body : ''; }
export const prefix = () => core.sharedPrefix({ persona: loadPersona() });

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.gradle', '__pycache__', '.axf-console']);
/** File names under a folder (relative, sorted by the index), skipping build output; globs are not walked. */
export function listFolder(abs, max = 2000) {
  const out = [];
  const walk = (dir, rel) => {
    let entries = []; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= max) return;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), `${rel}${e.name}/`); }
      else out.push(`${rel}${e.name}`);
    }
  };
  walk(abs, ''); return out;
}

/** A job's brief: snippets of its leased files (plain paths) and listings of its leased folders (globs are named, not read). */
export function pack(job, handoffs = []) {
  const snippets = []; const indexes = [];
  for (const f of job.leases) {
    if (f.includes('*')) continue;
    const abs = resolve(repoRoot(), f);
    if (!abs.startsWith(`${repoRoot()}/`) || !existsSync(abs)) continue;
    if (f.endsWith('/') || statSync(abs).isDirectory()) indexes.push(core.folderIndex(f, listFolder(abs)));
    else if (statSync(abs).isFile()) snippets.push(core.extractSnippet(f, readFileSync(abs, 'utf8'), job.text));
  }
  return core.packJob(job, { prefix: prefix(), skill: loadSkills()[job.skill], snippets, indexes, handoffs });
}
/** Every run, newest last (swarm-run@1 records), in the data folder. */
export const runsFile = () => join(dataDir(), 'runs.json');
export const loadRuns = () => { const r = readJson(runsFile(), { runs: [] }); return Array.isArray(r.runs) ? r.runs : []; };
export function saveRun(run) { const runs = loadRuns(); runs.push(run); writeJson(runsFile(), { $axf: 'swarm-runs@1', runs: runs.slice(-5000) }); return run; }

/**
 * Book a Claude session on an agent's card (agent-pick, Nov 3 2026): a `job` run of job type `agent-session`, one
 * record per session (`jobId` = `session-<id>`), replaced on every booking so cost and time grow with the session.
 * `final: true` closes it: the report is posted in the chat and the run counts like any finished job.
 */
export const SESSION_JOB_TYPE = 'agent-session';
export function book(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const sid = String(e.session ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
  if (!sid) throw new Error('book needs a session id');
  const roster = loadRoster();
  const agent = roster.agents.find((a) => a.id === e.agent || a.name === e.agent);
  if (!agent) throw new Error(`no agent "${e.agent ?? ''}" on the crew`);
  const jobId = `session-${sid}`; const runs = loadRuns(); const prev = runs.find((r) => r.jobId === jobId);
  if (prev && prev.agent !== agent.id) throw new Error(`session ${sid} is booked on ${prev.agent}, not ${agent.id}`);
  const now = new Date().toISOString(); const final = e.final === true;
  const commits = [...new Set([...(prev?.report?.summary?.match(/(?<=commits: )[0-9a-f, ]+/)?.[0]?.split(/,\s*/) ?? []), ...(Array.isArray(e.commits) ? e.commits : [])].map((c) => String(c).trim()).filter((c) => /^[0-9a-f]{7,40}$/.test(c)))].slice(-40);
  const summary = [String(e.summary ?? prev?.report?.summary?.replace(/\s*· commits: [0-9a-f, ]+$/, '') ?? '').slice(0, 300), commits.length ? `commits: ${commits.join(', ')}` : ''].filter(Boolean).join(' · ');
  const rec = core.normRun({
    kind: 'job', jobType: SESSION_JOB_TYPE, jobId, buildId: String(e.build ?? prev?.buildId ?? ''), agent: agent.id, model: e.model ?? prev?.model ?? 'opus',
    startedAt: prev?.startedAt || String(e.startedAt ?? now), endedAt: final ? now : '', status: final ? (e.status === 'failed' ? 'failed' : 'done') : 'running',
    reportedCost: Number.isFinite(Number(e.usd)) ? Number(e.usd) : prev?.reportedCost ?? null, usage: e.usage ?? prev?.usage ?? null, session: sid,
    branch: String(e.branch ?? prev?.branch ?? ''), report: { status: e.status === 'failed' ? 'failed' : 'done', summary },
  });
  writeJson(runsFile(), { $axf: 'swarm-runs@1', runs: [...runs.filter((r) => r.jobId !== jobId), rec].slice(-5000) });
  if (final && prev?.status === 'running') chatAfterRun(rec, roster);
  return rec;
}

export const profilesFile = () => join(dataDir(), 'profiles.json');
const flag = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
/** Agent manager assistants as the server passes them (axf.agents@1 list_agents), or the last ones it saw. */
function assistantsArg(args) {
  const raw = flag(args, '--assistants');
  if (raw) { const a = JSON.parse(raw); writeJson(join(dataDir(), 'assistants.json'), { $axf: 'crew-assistants@1', at: new Date().toISOString(), agents: a }); return a; }
  return readJson(join(dataDir(), 'assistants.json'), { agents: [] }).agents ?? [];
}
/** crew() rows with their job title and persona line (the agent picker and claude_session_persona read them). */
export function withProfiles(rows) {
  const by = new Map(crewRoster({ assistants: [] }).map((m) => [m.id, m]));
  return rows.map((r) => { const m = by.get(r.id); return m ? { ...r, jobTitle: m.jobTitle, role: m.jobTitle || r.role, personaLine: crewProfiles.personaLine(m), pronouns: m.pronouns } : r; });
}
/** The one roster (crew-profile@1): every member with every profile section (crew-profiles.mjs). */
export function crewRoster({ assistants = [] } = {}) {
  const writeupsFile = join(ROOT, '_claude/shared/memory/write-ups.md');
  return crewProfiles.buildRoster({
    roster: loadRoster(), crew: crew(), seed: readJson(join(HERE, 'agents/profiles.json'), {}), edits: readJson(profilesFile(), {}).members ?? {},
    assistants, writeups: crewProfiles.parseWriteups(existsSync(writeupsFile) ? readFileSync(writeupsFile, 'utf8') : ''),
  });
}

/** The crew in one compact read (the Claude agent picker): who, status, pay, spend, stats, raises, latest runs. */
export function crew() {
  const s = state(); const at = new Date().toISOString(); const day = core.dayStart(at); const week = core.weekStart(at);
  const mins = (r) => { const a = Date.parse(r.startedAt); const b = Date.parse(r.endedAt || at); return Number.isFinite(a) && Number.isFinite(b) && b > a ? (b - a) / 60000 : 0; };
  return s.roster.agents.map((a) => {
    const as = s.swarm.agents[a.id] ?? core.normAgentState({}); const mine = s.runs.filter((r) => r.agent === a.id);
    // an open Claude session (status running) is neither a success nor a failure yet
    const st = core.agentStats(s.runs.filter((r) => r.status !== 'running'), a.id, s.prices, 8); const timed = mine.filter((r) => r.endedAt);
    return {
      id: a.id, name: core.cardIdentity(a, as).name, role: a.role, specialty: a.specialty, avatar: a.avatar, catchphrase: a.catchphrase, bio: a.bio, jobsOnly: a.jobsOnly,
      status: as.status, statusLabel: core.statusLabel(as), strikes: as.failStreak ?? 0, works: core.STATUSES[as.status]?.works !== false,
      running: mine.filter((r) => r.status === 'running').map((r) => ({ jobId: r.jobId, buildId: r.buildId, startedAt: r.startedAt, summary: r.report?.summary ?? '' })),
      pay: s.pay[a.id], spend: { today: s.spend[a.id]?.today.usd ?? 0, week: s.spend[a.id]?.week.usd ?? 0, all: s.spend[a.id]?.all.usd ?? 0, avgPerJob: s.spend[a.id]?.avgPerJob ?? 0 },
      minutes: { today: Math.round(mine.filter((r) => (r.endedAt || at) >= day).reduce((t, r) => t + mins(r), 0)), week: Math.round(mine.filter((r) => (r.endedAt || at) >= week).reduce((t, r) => t + mins(r), 0)), avgPerJob: timed.length ? Math.round(timed.reduce((t, r) => t + mins(r), 0) / timed.length) : 0 },
      stats: { runs: st.runs, done: st.done, failed: st.failed, successRate: st.successRate, favoriteModel: st.favoriteModel, lastSeen: st.lastSeen }, feed: st.feed,
      raises: (as.pay ?? []).slice(-10).reverse(), bonuses: (as.bonuses ?? []).length,
      // write-ups: the discipline side of the status history (suspended, probation, fired, rage-quit)
      writeups: (as.history ?? []).filter((h) => ['suspended', 'probation', 'fired', 'quit'].includes(h.to)).slice(-10).reverse(),
    };
  });
}

/** Plan → pack → worktree → claude -p → record. `dry` returns the brief and the command instead of running. */
export async function run(buildId, ref, opts = {}) {
  const job = jobOf(plan([buildId]), ref);
  const agent = loadRoster().agents.find((a) => a.id === job.agent);
  const brief = pack(job, opts.handoffs);
  if (opts.dry) return { dry: true, job, brief, args: core.claudeArgs(brief, job, agent).map((a) => (a.length > 120 ? `${a.slice(0, 117)}…` : a)) };
  const wt = opts.cwd ? { path: opts.cwd, branch: '' } : worktreeFor(repoRoot(), dataDir(), job, opts.base);
  const roster = loadRoster();
  say([core.assignLine(job, roster), ...core.leaseLines({ jobs: [job, ...plan([buildId]).jobs.filter((x) => job.after.includes(x.id))] }, roster).filter((l) => l.jobId === job.id)]);
  // agent-slots@1: the swarm shares the VPS-wide cap with every headless session; over it, the agent waits for a desk.
  const go = () => runJob(job, agent, brief, { cwd: wt.path, bin: opts.bin, timeoutMin: opts.timeoutMin });
  const rec = process.env.AXF_SLOTS === 'off' ? await go()
    : await withSlot({ name: `swarm-${job.id}`, kind: 'swarm', agent: agent.id, priority: opts.priority, by: 'agent-swarm',
      onQueued: (r) => say([core.waitingLine(agent.name, r)]) }, go);
  chatAfterRun(rec, roster);
  const lease = core.leaseCheck(job, changedFiles(wt.path, opts.base));
  const st = loadState(); const as = st.agents[agent.id];
  if (as && core.canWork(agent, as, job).notify) { st.notices.push({ at: rec.endedAt, agent: agent.id, text: `${agent.name} (probation) ran ${job.id}: ${rec.status}` }); writeState(st); }
  return saveRun({ ...rec, branch: wt.branch, worktree: wt.path, lease });
}

/** The agent's report in the room, plus a coworker's reaction from the banter bank (no tokens). */
export function chatAfterRun(rec, roster = loadRoster()) {
  withState((st) => {
    const at = rec.endedAt || new Date().toISOString();
    core.post(st, core.reportLines(rec, roster), at);
    core.recordRun(st, rec, roster, at, rec.source === 'launcher' || rec.source === 'assign' ? null : priceTable()); // a headless build has no job budget to beat: no bonus
    const moment = rec.status === 'done' ? 'done' : 'failed';
    for (const a of core.reactors(st, roster, rec.agent, core.reactCount(st, at), rec.jobId)) core.post(st, [{ from: a.id, kind: 'banter', text: core.banterLine(moment, `${rec.jobId}${a.id}`, { other: roster.agents.find((x) => x.id === rec.agent)?.name ?? rec.agent, job: rec.jobId }) }], at);
  });
}

/** One cheap batch of banter from the small model (one turn, no tools). Nothing runs while the chat is off. */
export async function banter(opts = {}) {
  const st = loadState(); const roster = loadRoster();
  const allowed = core.banterAllowed(st, new Date().toISOString());
  if (!allowed.ok) return { posted: 0, usd: 0, skipped: allowed.why };
  const prompt = core.banterPrompt(roster, st.messages, opts.n ?? 6);
  if (opts.dry) return { dry: true, prompt };
  const bin = opts.bin ?? process.env.AXF_CLAUDE_BIN ?? 'claude';
  const r = spawnSync(bin, ['-p', prompt, '--model', core.MODEL_IDS[core.DEFAULT_MODEL], '--max-turns', '1', '--output-format', 'json', '--system-prompt', loadPersona(), '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--allowedTools', ''], { encoding: 'utf8', timeout: 120000 });
  if (r.error) throw new Error(r.error.code === 'ENOENT' ? `Claude Code not found (${bin}); set AXF_CLAUDE_BIN` : r.error.message);
  let res = {}; try { res = JSON.parse(r.stdout); } catch { throw new Error('banter run gave no JSON'); }
  const lines = core.parseBanter(res.result, roster); const usd = Number(res.total_cost_usd) || 0;
  const posted = withState((s2) => { const at = new Date().toISOString(); s2.banterSpend.push({ at, usd }); return core.post(s2, lines, at); });
  return { posted, usd };
}

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
/** Files a worktree changed since it branched (committed or not). */
export function changedFiles(cwd, base = 'HEAD') {
  const mb = git(cwd, 'merge-base', base === 'HEAD' ? 'HEAD@{upstream}' : base, 'HEAD');
  const from = mb.status === 0 ? mb.stdout.trim() : git(cwd, 'rev-list', '--max-parents=0', 'HEAD').stdout.trim().split('\n')[0];
  const a = git(cwd, 'diff', '--name-only', from).stdout; const u = git(cwd, 'ls-files', '--others', '--exclude-standard').stdout;
  return [...new Set(`${a}\n${u}`.split('\n').map((x) => x.trim()).filter(Boolean))];
}

/** Merge state per build (what's in, what conflicted), in the data folder. */
export const mergesFile = () => join(dataDir(), 'merges.json');

/**
 * Batch merge: every done, lease-clean job of the build, in wave order, into the build's merge branch (its own
 * worktree, so the main checkout is never touched). A conflict is aborted and handed to the merge fixer. Then
 * Boss writes the shared files: the tracker ticks and one note. --push pushes the merge branch.
 */
export function batchMerge(buildId, opts = {}) {
  const b = findBuilds([buildId])[0];
  const p = plan([buildId], { includeDone: true });
  const ms = readJson(mergesFile(), {}); const st = (ms[buildId] ??= { merged: [], conflicts: [] });
  const queue = core.mergeQueue(p, loadRuns(), st.merged);
  const branch = opts.into || b.branch || `swarm/${buildId}/merge`;
  const dir = join(dataDir(), 'worktrees', `_merge-${buildId}`);
  if (!existsSync(dir)) { const has = git(repoRoot(), 'rev-parse', '--verify', '--quiet', branch).status === 0; const r = has ? git(repoRoot(), 'worktree', 'add', dir, branch) : git(repoRoot(), 'worktree', 'add', '-b', branch, dir, opts.base || 'HEAD'); if (r.status) throw new Error(r.stderr.trim()); }
  const merged = []; const conflicts = []; const refused = [];
  for (const q of queue) {
    const lease = core.leaseCheck(q.job, changedFiles(q.run.worktree, branch));
    if (!lease.ok) { refused.push({ job: q.job.id, outside: lease.outside, shared: lease.shared }); continue; }
    const r = git(dir, 'merge', '--no-ff', '-m', `Swarm merge: ${q.job.id} (${q.job.agent})`, q.run.branch);
    if (r.status !== 0) {
      const files = git(dir, 'diff', '--name-only', '--diff-filter=U').stdout.split('\n').filter(Boolean);
      git(dir, 'merge', '--abort');
      const fix = core.fixerJob(q.job, files, loadRoster(), merged.map((m) => m.job.id).join(', '));
      conflicts.push({ job: q.job.id, files, fixer: fix.id }); continue;
    }
    merged.push(q); st.merged.push(q.job.id);
  }
  st.conflicts = conflicts; writeJson(mergesFile(), ms);
  let lines = [];
  if (merged.length && !opts.noShared) { const r = core.applyMerge(loadTracker(), buildId, merged, new Date().toISOString()); writeJson(trackerFile(), r.tracker); lines = r.lines; }
  if (opts.push && merged.length) { const r = git(dir, 'push', '-u', 'origin', branch); if (r.status) throw new Error(r.stderr.trim()); }
  return { branch, merged: merged.map((m) => m.job.id), conflicts, refused, notes: lines };
}

/** Hand a conflict to the merge fixer: its worktree holds the half-done merge, then the fixer runs there. */
export async function fix(buildId, stepId, opts = {}) {
  const ms = readJson(mergesFile(), {}); const c = ms[buildId]?.conflicts?.find((x) => x.job === `${buildId}.${stepId}`);
  if (!c) throw new Error(`no conflict recorded for ${buildId}.${stepId}`);
  const p = plan([buildId], { includeDone: true }); const job = jobOf(p, stepId);
  const fj = core.fixerJob(job, c.files, loadRoster());
  const b = findBuilds([buildId])[0]; const into = b.branch || `swarm/${buildId}/merge`;
  const wt = worktreeFor(repoRoot(), dataDir(), fj, into);
  const src = loadRuns().filter((r) => r.jobId === job.id).pop();
  git(wt.path, 'merge', '--no-commit', '--no-ff', src.branch);
  const agent = loadRoster().agents.find((a) => a.id === fj.agent);
  const brief = pack(fj, [src.report?.handoff ?? '']);
  if (opts.dry) return { dry: true, job: fj, brief };
  const rec = await runJob(fj, agent, brief, { cwd: wt.path, bin: opts.bin });
  return saveRun({ ...rec, branch: wt.branch, worktree: wt.path, lease: core.leaseCheck(fj, changedFiles(wt.path, into)) });
}
export const priceTable = () => core.prices(readJson(join(ROOT, 'framework/schemas/model-pricing.json'), {}));

/** Everything the console page shows, in one read. */
export function state() {
  const roster = loadRoster(); const sk = loadSkills(); const runs = loadRuns(); const table = priceTable();
  const tr = loadTracker();
  const builds = (tr.builds ?? []).filter((b) => !['complete', 'archived'].includes(b.status) && !b.hidden).map((b) => ({ id: b.id, title: b.title, status: b.status, open: (b.steps ?? []).filter((x) => !x.done && !x.skip).length }));
  const swarm = loadState();
  const at = new Date().toISOString();
  const spend = Object.fromEntries(roster.agents.map((a) => [a.id, core.spendOf(runs, a.id, table, at)]));
  const pay = Object.fromEntries(roster.agents.map((a) => [a.id, core.payOf(a, swarm.agents[a.id], runs, table, at)]));
  return { swarm, spend, pay, banterToday: core.banterAllowed(swarm, at).today, statuses: core.STATUSES, pickable: core.PICKABLE, roster, skills: Object.fromEntries(Object.entries(sk).map(([k, v]) => [k, { id: v.id, title: v.title, body: v.body }])), problems: core.checkRoster(roster, sk),
    runs: runs.slice(-300), meter: core.meter(runs, table), prices: table, builds, tracker: trackerFile() };
}
/** Tokens every plain session loads before it starts (CLAUDE.md and the rules it pulls in, THREADS.md). */
export function sessionLoadTokens() {
  return ['CLAUDE.md', '_claude/shared/rules/RULES.md', '_claude/rules/RULES.md', '_claude/THREADS.md'].reduce((t, f) => { try { return t + core.tokensOf(readFileSync(join(ROOT, f), 'utf8')); } catch { return t; } }, 0);
}

/** Pilot: plan + pack every job of a build (no run), project both ways, suggest a budget scale. --apply saves it on the roster. */
export function pilot(buildId, opts = {}) {
  const b = findBuilds([buildId])[0];
  const p = core.planJobs([b], loadRoster(), { tune: { scale: 1 } });
  const briefs = Object.fromEntries(p.jobs.map((j) => [j.id, pack(j).tokens]));
  const pricing = readJson(join(ROOT, 'framework/schemas/model-pricing.json'), {});
  const r = core.pilotReport(b, p, briefs, core.prices(pricing), pricing.heuristic, sessionLoadTokens());
  writeJson(join(dataDir(), `pilot-${buildId}.json`), { at: new Date().toISOString(), ...r });
  if (opts.apply) {
    const f = join(HERE, 'agents/roster.json'); const raw = readJson(f, {});
    // a dry pilot only projects; never cut budgets below half until real runs are measured
    const scale = opts.measured ? r.scale : Math.max(0.5, r.scale);
    raw.tune = { scale, basis: `pilot ${opts.measured ? 'measured' : 'dry run'} on ${buildId} (${new Date().toISOString().slice(0, 10)}): suggested ${r.scale}, swarm ${core.fmtUsd(r.swarm.usd)} vs one session ${core.fmtUsd(r.single.usd)}${opts.measured ? '' : '; floored at 0.5 until runs are measured'}` };
    // one-line edit so the hand-kept layout of roster.json stays as it is
    const line = ` "tune": ${JSON.stringify(raw.tune)},`; const text = readFileSync(f, 'utf8');
    writeFileSync(f, /^ "tune": .*,$/m.test(text) ? text.replace(/^ "tune": .*,$/m, line) : text.replace(/^( "about": .*,)$/m, `$1\n${line}`));
  }
  return r;
}
export function jobOf(p, ref) { const j = p.jobs.find((x) => x.id === ref || x.stepId === ref); if (!j) throw new Error(`no open job "${ref}"`); return j; }

function planText(p) {
  const out = [];
  p.waves.forEach((w, i) => { out.push(`Wave ${i + 1}:`); for (const id of w) { const j = p.jobs.find((x) => x.id === id); out.push(`  ${j.id.padEnd(28)} ${j.agent.padEnd(6)} ${j.model.padEnd(7)} ${String(j.budget.tokens).padStart(7)} tok · ${j.leases.join(', ') || '(no files)'}`); } });
  return [...out, ...p.warnings.map((w) => `! ${w}`)].join('\n') || 'Nothing to plan.';
}

export async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'roster', ...rest] = args;
  if (cmd === 'roster') {
    const r = loadRoster(); const sk = loadSkills(); const problems = core.checkRoster(r, sk);
    return out({ ok: true, roster: r, skills: sk, problems }, [...r.agents.map((a) => `${a.id.padEnd(6)} ${a.name.padEnd(12)} ${a.skill.padEnd(17)} ${a.models.join('/')}`), ...problems.map((p) => `! ${p}`)].join('\n'));
  }
  if (cmd === 'state') return out({ ok: true, state: state() }, JSON.stringify(state(), null, 1));
  if (cmd === 'crew') { const c = withProfiles(crew()); return out({ ok: true, crew: c }, c.map((a) => `${a.id.padEnd(8)} ${a.name.padEnd(16)} ${a.statusLabel.padEnd(12)} today ${core.fmtUsd(a.spend.today)} · ${a.stats.done} done`).join('\n')); }
  if (cmd === 'crew-list' || cmd === 'crew-get') {
    const ms = crewRoster({ assistants: assistantsArg(args) });
    if (cmd === 'crew-list') { const sorted = crewProfiles.sortMembers(ms, flag(args, '--sort') || 'working'); return out({ ok: true, $axf: 'crew-roster@1', members: sorted }, sorted.map((m) => `${m.id.padEnd(9)} ${m.name.padEnd(16)} ${m.jobTitle.padEnd(20)} ${m.status.padEnd(8)} ${m.pay.hourly == null ? '—' : `$${m.pay.hourly.toFixed(2)}/h`}`).join('\n')); }
    const m = ms.find((x) => x.id === rest[0] || x.name.toLowerCase() === String(rest[0] ?? '').toLowerCase());
    if (!m) throw new Error(`not_found: no crew member "${rest[0]}"`);
    return out({ ok: true, member: m, personaLine: crewProfiles.personaLine(m) }, JSON.stringify(m, null, 1));
  }
  if (cmd === 'crew-update') {
    const [id, patch] = rest; const owner = args.includes('--owner') && process.env.AXF_CREW_OWNER === '1' && !['CLAUDECODE', 'AXF_SESSION', 'AXF_AGENT', 'AXF_SURFACE'].some((k) => process.env[k]); // only the console server, for Brett's own click
    const ms = crewRoster({ assistants: assistantsArg(args) }); const m = ms.find((x) => x.id === id);
    if (!m) throw new Error(`not_found: no crew member "${id}"`);
    const edits = readJson(profilesFile(), { members: {} }); edits.members ??= {};
    edits.members[id] = crewProfiles.applyUpdate(edits.members[id], JSON.parse(patch ?? '{}'), { owner, kind: m.kind });
    writeJson(profilesFile(), { $axf: 'crew-profile-edits@1', updatedAt: new Date().toISOString(), members: edits.members });
    const after = crewRoster({ assistants: assistantsArg(args) }).find((x) => x.id === id);
    return out({ ok: true, member: after }, `${after.name} updated`);
  }
  if (cmd === 'book') { const r = book(JSON.parse(rest[0] ?? '{}')); return out({ ok: true, run: r }, `${r.jobId} on ${r.agent}: ${r.status}${r.reportedCost != null ? ` · ${core.fmtUsd(r.reportedCost)}` : ''}`); }
  if (cmd === 'cost') {
    const m = state().meter; const row = (k, v) => `${k.padEnd(28)} ${String(v.runs).padStart(4)} runs ${core.fmtTokens(v.tokens).padStart(7)} tok ${core.fmtUsd(v.usd).padStart(8)}`;
    return out({ ok: true, meter: m }, [row('TOTAL', m.total), '— by agent', ...Object.entries(m.byAgent).map(([k, v]) => row(k, v)), '— by build', ...Object.entries(m.byBuild).map(([k, v]) => row(k, v)), '— by job', ...Object.entries(m.byJob).map(([k, v]) => row(k, v))].join('\n'));
  }
  if (cmd === 'pilot') {
    const r = pilot(rest.find((a) => !a.startsWith('--')), { apply: args.includes('--apply') });
    const lines = r.jobs.map((j) => `${j.id.padEnd(22)} ${j.agent.padEnd(6)} ${j.model.padEnd(7)} brief ${core.fmtTokens(j.brief).padStart(5)} · projected ${core.fmtTokens(core.budgetTokens(j.usage)).padStart(5)} (${core.fmtUsd(j.usd)}) · budget ${core.fmtTokens(j.budget)} → need ${core.fmtTokens(j.need)}`);
    return out({ ok: true, pilot: r }, [...lines, `Swarm: ${core.fmtTokens(r.swarm.tokens)} budget-tokens, ${core.fmtUsd(r.swarm.usd)}`, `One session (${r.single.minutes} min): ${core.fmtTokens(r.single.tokens)} budget-tokens, ${core.fmtUsd(r.single.usd)}`, `Saving: ${Math.round(r.saving * 100)}% · suggested budget scale ${r.scale}${args.includes('--apply') ? ' (saved on the roster)' : ' (--apply to save)'}`].join('\n'));
  }
  if (cmd === 'act') {
    let change;
    if (rest[0]?.startsWith('{')) change = JSON.parse(rest[0]);
    else { const [action, agent, a, ...more] = rest; change = action === 'status' ? { action, agent, status: a, note: more.join(' ') } : action === 'salary' || action === 'topup' ? { action, agent, usd: Number(a), note: more.join(' ') }
        : action === 'chat' ? (agent === 'on' || agent === 'off' ? { action, enabled: agent === 'on' } : { action, agent, on: a !== 'off' }) : action === 'say' ? { action, text: rest.slice(1).join(' ') }
        : action === 'suspend' ? { action, agent, until: new Date(Date.now() + (Number(a) || 24) * 3600e3).toISOString(), reason: more.join(' ') } : action === 'rehire' ? { action, agent } : action === 'preset' ? { action: 'chat-settings', preset: agent } : action === 'vibe' ? { action: 'chat-settings', values: { vibe: Number(agent) } } : action === 'rules' ? { action, rageQuitAfter: Number(agent) } : { action, agent, note: [a, ...more].join(' ') }; }
    const r = act(change); return out({ ok: true, state: state(), log: r.log }, r.log.join('\n'));
  }
  if (cmd === 'sessions') { // per run: the agent's status and spend, for the session browser
    const s = state(); const by = new Map(s.roster.agents.map((a) => [a.id, a]));
    const rows = s.runs.map((r) => ({ jobId: r.jobId, agent: r.agent, name: by.get(r.agent)?.name ?? r.agent, status: core.statusLabel(s.swarm.agents[r.agent] ?? core.normAgentState({})), run: r.status, usd: core.runCost(r, s.prices), spend: s.spend[r.agent] }));
    return out({ ok: true, sessions: rows }, rows.map((x) => `${x.jobId.padEnd(26)} ${x.name.padEnd(12)} ${x.status.padEnd(14)} ${x.run.padEnd(7)} ${core.fmtUsd(x.usd)}`).join('\n') || 'No runs yet.');
  }
  if (cmd === 'chat') { const st = loadState(); const n = Number(rest[0]) || 30; return out({ ok: true, chat: st.chat, messages: st.messages.slice(-n) }, st.chat.enabled ? st.messages.slice(-n).map((m) => `${m.at.slice(11, 16)} ${m.from.padEnd(6)} ${m.text}`).join('\n') || 'Quiet.' : 'The group chat is off.'); }
  if (cmd === 'mentions') { // messages about Brett, newest first (redacted)
    const st = loadState(); const n = Number(rest.find((a) => /^\d+$/.test(a))) || 50;
    const list = watch.mentions(st, loadRoster(), { limit: n, negativeOnly: args.includes('--negative') });
    return out({ ok: true, terms: watch.MENTION_TERMS.map((t) => t.id), count: list.length, negative: list.filter((m) => m.tone === 'negative').length, mentions: list },
      list.map((m) => `${m.at.slice(0, 16).replace('T', ' ')} ${m.tone === 'negative' ? '!' : ' '} ${m.fromName.padEnd(14)} ${m.text}`).join('\n') || 'Nobody is talking about Brett.');
  }
  if (cmd === 'chats-export') { const dir = mirrorChats(loadState(), { force: true }); return out({ ok: !!dir, dir }, dir ? `mirrored to ${dir}` : 'no hub data folder here (AXF_SWARM_CHATS_DIR to set one)'); }
  if (cmd === 'banter') { const r = await banter({ dry: args.includes('--dry-run') }); return out({ ok: true, ...r }, r.dry ? r.prompt : r.skipped ?? `posted ${r.posted} lines for ${core.fmtUsd(r.usd)}`); }
  if (cmd === 'plan') { if (!rest.length) throw new Error('plan needs a build id'); const p = plan(rest); return out({ ok: true, plan: p }, planText(p)); }
  if (cmd === 'pack') { const [b, ref] = rest; const j = jobOf(plan([b]), ref); const p = pack(j); return out({ ok: true, job: j, brief: p }, `${p.system}\n\n=====\n${p.prompt}\n\n(~${p.tokens.system} + ${p.tokens.prompt} tokens)`); }
  if (cmd === 'run') {
    const [b, ref] = rest.filter((a) => !a.startsWith('--')); const r = await run(b, ref, { dry: args.includes('--dry-run') });
    return out({ ok: true, run: r }, r.dry ? `would run: claude ${r.args.join(' ')}` : `${r.jobId} ${r.status}${r.reason ? ` (${r.reason})` : ''} · ${r.budgetTokens}/${r.budget.tokens} tokens · ${r.turns} turns${r.report ? `\n${r.report.summary}` : ''}`);
  }
  if (cmd === 'check') { const [b, ref] = rest; const r = loadRuns().filter((x) => x.jobId === `${b}.${ref}`).pop(); if (!r) throw new Error('no run for that job yet'); const j = jobOf(plan([b], { includeDone: true }), ref); const l = core.leaseCheck(j, changedFiles(r.worktree)); return out({ ok: l.ok, lease: l }, l.ok ? 'lease clean' : `outside the lease: ${l.outside.join(', ') || '-'} · shared: ${l.shared.join(', ') || '-'}`); }
  if (cmd === 'merge') { const r = batchMerge(rest[0], { push: args.includes('--push') }); say(core.mergeLines(r, loadRoster())); return out({ ok: true, ...r }, `merged ${r.merged.length} into ${r.branch}${r.conflicts.length ? ` · ${r.conflicts.length} conflict(s) → merge fixer` : ''}${r.refused.length ? ` · ${r.refused.length} refused (lease)` : ''}${r.notes.length ? `\nNotes for shared files:\n${r.notes.join('\n')}` : ''}`); }
  if (cmd === 'fix') { const [b, ref] = rest.filter((a) => !a.startsWith('--')); const r = await fix(b, ref, { dry: args.includes('--dry-run') }); return out({ ok: true, run: r }, r.dry ? r.brief.prompt : `${r.jobId} ${r.status}`); }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
