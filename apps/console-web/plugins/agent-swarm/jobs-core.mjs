/**
 * Agent jobs (Brett, Nov 1 2026: "hire agents to run that kind of stuff instead of spinning up anonymous one-off
 * builds"). Pure rules for routing a job-type@1 run to the agent who owns it: owners, duty + budget check, model,
 * brief, session name, run record, the Breakroom's Jobs view and one-tap hires. No I/O; jobs.mjs does the files and
 * the launch.
 *
 * Cost rule: an agent gets only its job's brief and its own short notes (its skill page and notes file). Nothing else
 * is loaded by default: no CLAUDE.md dump, no rules files, no MCP servers beyond what the launcher adds.
 */
import { JOB_TYPE, isDue, jobInputs, jobTypeErrors, nextRun, normalizeJobType, renderJobBrief, timeWords } from '../../../../framework/core/engines/job-type-rules.mjs';
import * as chat from '../../../../framework/core/engines/swarm-chat.mjs';
import { hasSkills } from '../../../../framework/core/engines/swarm-rules.mjs';
import { MODEL_IDS, MODEL_TIERS, budgetUsd, canWork, fmtTokens, fmtUsd, normAgent, normRun, payOf, runCost, statusLabel } from './web/swarm-core.mjs';

export const JOB_RUN_KIND = 'job';
export const NOTES_MAX = 1500;
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Job types from asset@1 envelopes: { id, name, description, data (normalized), errors }. Bad ones keep their errors. */
export function jobTypes(assets) {
  return (Array.isArray(assets) ? assets : []).filter((a) => a?.type === JOB_TYPE && typeof a.id === 'string').map((a) => ({
    id: a.id, name: str(a.name, 80) || a.id, description: str(a.description, 600), data: normalizeJobType(a.data), errors: jobTypeErrors(JOB_TYPE, a.data),
  })).sort((x, y) => x.name.localeCompare(y.name));
}

/** Can this agent take this job type (holds every skill it needs)? */
export const canTake = (jt, agent) => hasSkills(agent, jt.data.skills?.length ? jt.data.skills : [jt.data.specialty]);
/** The home skill of role holders (Who does what, agents/roles.json): they hold a standing role, never take job-type runs. */
export const ROLE_SKILL = 'crew-roles';
/** Agents whose home job this is (a preference only, never exclusive). */
export const homeOf = (jt, roster) => roster.agents.filter((a) => a.home === jt.id || (!a.home && a.skill === jt.data.specialty));
/** Runs an agent has going now (any kind): the router's "least busy". */
export const busyOf = (runs, agentId) => (runs ?? []).filter((r) => r.agent === agentId && r.status === 'running').length;
/** Runs an agent started in the 24 hours before `at`: the tie-break after "least busy", so work goes round the crew. */
export const loadOf = (runs, agentId, at) => { const from = new Date(Date.parse(at) - 864e5).toISOString(); return (runs ?? []).filter((r) => r.agent === agentId && (r.startedAt || '') >= from).length; };

/**
 * Agents who can take the job type, home agents first, then cheapest. Fired agents take nothing (nobody is fired
 * since the retrain, the check stays for old state files).
 */
export function owners(jt, roster, state) {
  const home = new Set(homeOf(jt, roster).map((a) => a.id));
  return roster.agents.filter((a) => canTake(jt, a) && state?.agents?.[a.id]?.status !== 'fired')
    .sort((a, b) => (home.has(b.id) - home.has(a.id)) || a.salary - b.salary || a.id.localeCompare(b.id));
}

/** The model a run uses: the job's default when the agent may use it, else the cheapest the agent has at or above it. */
export function jobModel(jt, agent) {
  if (agent.models.includes(jt.data.model)) return jt.data.model;
  const need = MODEL_TIERS.indexOf(jt.data.model);
  return agent.models.find((m) => MODEL_TIERS.indexOf(m) >= need) ?? agent.models[agent.models.length - 1];
}

/** Most a run may cost: the job's dollar cap when it has one, else its token budget priced on the model. */
export function runCap(jt, model, table) {
  return jt.data.budget.usd > 0 ? jt.data.budget.usd : budgetUsd({ budget: { tokens: jt.data.budget.tokens }, model }, table);
}

/**
 * Pick the agent for one run among those who can take it: free = on duty (status allows it, not broke) and pay left
 * this week covers the run's cap. Free agents are ranked home job first, then least busy (running runs), then
 * cheapest (a day's runs break ties, so work goes round the crew). Nobody with the skills free: any free job agent (jobsOnly) takes it, so the job never goes to nobody
 * while someone is free. `opts.force` (a launch that is starting anyway, deploy/claude-headless.sh) books the best
 * agent even when nobody is free, saying why. `opts.agent` asks for one agent by id.
 * Returns { ok, agent, model, cap, why, unassigned, forced, tried: [{ agent, why }] }.
 */
export function route(jt, roster, state, runs, table, at, opts = {}) {
  if (jt.errors?.length) return { ok: false, unassigned: false, why: `job type ${jt.id} is invalid: ${jt.errors[0]}`, tried: [] };
  if (opts.agent) {
    const a = roster.agents.find((x) => x.id === opts.agent);
    if (!a) return { ok: false, unassigned: false, why: `no agent "${opts.agent}" on the roster`, tried: [] };
    if (state?.agents?.[a.id]?.status === 'fired') return { ok: false, unassigned: false, why: `${a.name} was let go`, tried: [] };
    const model = jobModel(jt, a);
    return { ok: true, unassigned: false, forced: false, agent: a, model, cap: runCap(jt, model, table), why: '', tried: [], notify: false };
  }
  const own = owners(jt, roster, state);
  const crew = roster.agents.filter((a) => a.jobsOnly && a.skill !== ROLE_SKILL && !own.includes(a) && state?.agents?.[a.id]?.status !== 'fired');
  if (!own.length && !crew.length) return { ok: false, unassigned: true, why: `nobody can take ${jt.name} (skills ${jt.data.skills.join(', ') || jt.data.specialty}): hire one`, tried: [] };
  const home = new Set(homeOf(jt, roster).map((a) => a.id));
  const tried = []; const free = [];
  for (const [i, a] of [...own, ...crew].entries()) {
    const as = state.agents[a.id]; const pay = payOf(a, as, runs, table, at); const model = jobModel(jt, a); const cap = runCap(jt, model, table);
    const w = canWork(a, as, { estimate: 30 }, at, pay);
    if (!w.ok) { tried.push({ agent: a.id, why: w.why }); continue; }
    if (pay.left < cap) { tried.push({ agent: a.id, why: `${fmtUsd(pay.left)} left this week, the run may cost up to ${fmtUsd(cap)}` }); continue; }
    free.push({ a, model, cap, notify: w.notify, skilled: i < own.length, busy: busyOf(runs, a.id), load: loadOf(runs, a.id, at) });
  }
  const rank = (x, y) => (y.skilled - x.skilled) || (home.has(y.a.id) - home.has(x.a.id)) || x.busy - y.busy || x.load - y.load || x.a.salary - y.a.salary || x.a.id.localeCompare(y.a.id);
  const pick = free.sort(rank)[0];
  if (pick) return { ok: true, unassigned: false, forced: false, agent: pick.a, model: pick.model, cap: pick.cap, why: '', tried, notify: pick.notify };
  const why = `${tried.slice(0, 2).map((t) => `${t.agent}: ${t.why}`).join(' · ')}${tried.length > 2 ? ` · ${tried.length - 2} more can't either` : ''}`;
  if (opts.force) { // starting anyway: the least busy agent who can take it books it, and the card says it ran over
    const a = [...own, ...crew].map((x) => ({ a: x, busy: busyOf(runs, x.id), load: loadOf(runs, x.id, at) }))
      .sort((x, y) => (home.has(y.a.id) - home.has(x.a.id)) || x.busy - y.busy || x.load - y.load || x.a.salary - y.a.salary || x.a.id.localeCompare(y.a.id))[0].a;
    const model = jobModel(jt, a);
    return { ok: true, unassigned: false, forced: true, agent: a, model, cap: runCap(jt, model, table), why: `nobody free (${why}); booked on ${a.name} anyway`, tried, notify: true };
  }
  return { ok: false, unassigned: false, why, tried };
}

/** Slug for names: lowercase letters, digits, dashes. */
const slug = (s, max = 48) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
/** The headless session's name: the agent + the job ("paulie-site-check"); claude-headless.sh makes it axf-<name>. */
export const sessionName = (agent, jt) => slug(`${agent.id}-${jt.id}`);
/** One run's id: job-<type>-<stamp>, unique per minute. */
export const runIdFor = (jt, at) => `job-${jt.id}-${timeWords(at).stamp}`;

/** The one short system line every job agent gets (replaces Claude Code's default prompt; same bytes per agent). */
export function jobSystem(agent) {
  return `You are ${agent.name} (${agent.role}), a hired AmberX AXF job agent. Do only the job in the message, using only your notes and the files it names. Do not read CLAUDE.md, rules or other docs, and do not explore the repo. End with the JSON report block the message asks for.`;
}

/**
 * The brief a job agent gets: the job type's brief (inputs + built-ins filled, outputs listed), its skill page, its
 * own short notes, Amber's voice and the report format. Returns { text, report, group, tokens }.
 */
export function jobBrief(jt, agent, { values = {}, at, runId, skill = null, notes = '', persona = '' }) {
  const b = renderJobBrief(jt.data, values, { at, agent: agent.id, agentName: agent.name, jobType: jt.id, jobName: jt.name, runId });
  const text = [
    `JOB ${runId}: ${jt.name}`,
    b.text,
    skill?.body ? `\nYOUR SKILL (${skill.title || skill.id})\n${skill.body.trim()}` : '',
    notes.trim() ? `\nYOUR NOTES\n${notes.trim().slice(0, NOTES_MAX)}` : '',
    persona.trim() ? `\nVOICE\n${persona.trim()}` : '',
    '\nREPORT',
    `- Write the report file above, then end with exactly one fenced json block: {"$axf":"swarm-report@1","status":"done|failed|blocked","summary":"one or two lines","files":["paths you changed"],"checks":[{"name":"…","ok":true}],"notes":"lines for shared files, or empty","handoff":"","question":"the exact question when blocked, or empty"}`,
    `- Budget: ${fmtTokens(jt.data.budget.tokens)} tokens, ${jt.data.budget.maxTurns} turns. Be direct.`,
  ].filter(Boolean).join('\n');
  return { text, report: b.report, group: b.group, tokens: Math.ceil(text.length / 4) };
}

/** Tools a run gets: the job's list when it has one, else the agent's; a read-only job never gets edit tools. */
export function jobTools(jt, agent) {
  const t = jt.data.tools.length ? jt.data.tools : agent.tools;
  return jt.data.readOnly ? t.filter((x) => !/^(Edit|Write|NotebookEdit|MultiEdit)$/.test(x)) : t;
}

/** Claude Code arguments for the launcher (deploy/claude-headless.sh adds -p, the stream format and the brief). */
export function jobArgs(jt, agent, model) {
  return [
    '--model', MODEL_IDS[model] ?? model,
    '--system-prompt', jobSystem(agent),
    '--max-turns', String(jt.data.budget.maxTurns),
    '--allowedTools', jobTools(jt, agent).join(','),
    '--permission-mode', jt.data.readOnly ? 'default' : 'acceptEdits',
    '--strict-mcp-config',
  ];
}

/** A run record (swarm-run@1 with kind "job", the contract shared with the swarm runner) written at launch; the sweep fills usage, status and report. */
export function jobRunRecord(jt, agent, model, { runId, at, session, brief, cwd, branch = '', log, inputs }) {
  return normRun({
    kind: JOB_RUN_KIND, jobId: runId, buildId: `job:${jt.id}`, stepId: jt.id, jobType: jt.id, agent: agent.id, model, startedAt: at, endedAt: '',
    status: 'running', reason: '', report: null, usage: null, reportedCost: null, turns: 0, budget: { tokens: jt.data.budget.tokens, maxTurns: jt.data.budget.maxTurns },
    session, cwd, branch, worktree: cwd, log, reportPath: brief.report, group: brief.group, inputs, briefTokens: brief.tokens,
  });
}

/**
 * How a booked headless build ended (a launch through deploy/claude-headless.sh or a back-assigned build: its brief
 * is the build's own, so there is no swarm-report@1 block to read). A clean result = done; an error result = error;
 * no result (stopped part way, cut off) = blocked, which books the usage without counting as the agent's failure.
 */
export function buildOutcome(tr) {
  if (tr.final && !tr.isError) return { status: 'done', reason: '', report: null };
  if (tr.final) return { status: 'error', reason: tr.subtype || 'error result', report: null };
  return { status: 'blocked', reason: 'stopped before a result', report: null };
}
/** A run booked by the launcher or back-assigned (not launched by the job router with a job brief). */
export const isBuildRun = (r) => r?.source === 'launcher' || r?.source === 'assign';

/** Boss's line when a job goes out, and when nobody can take it (the chat contract's builders). */
export const assignJobLine = (jt, agent, model, cap) => chat.assignJobLine(jt.name, agent.name, model, jt.data.budget.tokens, cap, jt.id);
export const unassignedLine = (jt, why) => chat.unassignedLine(jt.name, why, jt.id);

/**
 * A one-tap hire for a job type nobody owns: a new agent@1 whose specialty is the job type's, with a skill page made
 * from the job type (kept in the swarm state with the hire). Returns { agent, skill }.
 */
export function hireFor(jt, roster, at) {
  const base = slug(jt.data.specialty.split('-')[0] || jt.id, 10) || 'hire';
  let id = base; let i = 2;
  while (roster.agents.some((a) => a.id === id)) id = `${base}${i++}`;
  const agent = normAgent({
    id, name: `${jt.name.split(' ')[0]} ${['Rookie', 'Temp', 'New Kid'][id.length % 3]}`, role: `${jt.name} agent`, skill: jt.data.specialty, skills: jt.data.skills, home: jt.id, jobsOnly: true,
    specialty: jt.description || jt.name, models: [jt.data.model], tools: jt.data.tools.length ? jt.data.tools : ['Read', 'Grep', 'Glob'],
    maxTurns: jt.data.budget.maxTurns, tokenBudget: jt.data.budget.tokens, salary: 10, hiredAt: at.slice(0, 10),
    avatar: { face: ['round', 'square', 'tall'][id.length % 3], hair: id.length % 6, gear: 'cap', hue: (id.charCodeAt(0) * 37) % 360 },
    catchphrase: 'New here. Point me at the job.', bio: `Hired ${at.slice(0, 10)} to own ${jt.name}.`,
  });
  const skill = { id: jt.data.specialty, title: jt.name, schema: 'agent-skill@1', body: `You own the ${jt.name} job.\n\n- ${jt.description || 'Do the job in the brief.'}\n- Follow the brief exactly; report what you did and what you could not.`, lines: 3, chars: 0 };
  skill.chars = skill.body.length;
  return { agent, skill };
}

/** Last run of a job type (newest first by start), or null. */
export const lastRunOf = (runs, jtId) => (runs ?? []).filter((r) => r.kind === JOB_RUN_KIND && r.jobType === jtId).reduce((b, r) => (!b || (r.startedAt || '') > (b.startedAt || '') ? r : b), null);

/** The Breakroom's Jobs view: one row per job type. */
export function jobsView(types, roster, state, runs, table, at) {
  return types.map((jt) => {
    const own = owners(jt, roster, state); const r = route(jt, roster, state, runs, table, at);
    const mine = (runs ?? []).filter((x) => x.kind === JOB_RUN_KIND && x.jobType === jt.id);
    const last = lastRunOf(runs, jt.id);
    return {
      id: jt.id, name: jt.name, description: jt.description, specialty: jt.data.specialty, model: jt.data.model, trigger: jt.data.trigger, readOnly: jt.data.readOnly,
      budget: jt.data.budget, inputs: jt.data.inputs, outputs: jt.data.outputs, errors: jt.errors,
      skills: jt.data.skills, home: homeOf(jt, roster).map((a) => a.id),
      owners: own.map((a) => ({ id: a.id, name: a.name, status: statusLabel(state.agents[a.id]), home: a.home === jt.id, busy: busyOf(runs, a.id) })),
      routed: r.ok ? r.agent.id : '', routeWhy: r.why, unassigned: r.unassigned,
      lastRun: last ? { at: last.startedAt, status: last.status, agent: last.agent, usd: runCost(last, table), runId: last.jobId } : null,
      next: nextRun(jt.data.trigger, last?.startedAt ?? '', at), due: isDue(jt.data.trigger, last?.startedAt ?? '', at),
      cost: { runs: mine.length, usd: mine.reduce((t, x) => t + runCost(x, table), 0) },
    };
  });
}

/** The job types an agent can take (its card shows them), its home job first. */
export const jobsOf = (types, agent) => types.filter((jt) => canTake(jt, agent))
  .sort((a, b) => ((b.id === agent.home) - (a.id === agent.home)) || a.name.localeCompare(b.name)).map((jt) => ({ id: jt.id, name: jt.name, home: jt.id === agent.home }));

/** Every skill the job types need (an all-rounder's card lists them). */
export const allSkills = (types) => [...new Set(types.flatMap((jt) => jt.data.skills))].sort();

/** Check a run's inputs before launch; throws a plain message. Returns the filled values. */
export function checkInputs(jt, given) {
  const { values, missing } = jobInputs(jt.data, given);
  if (missing.length) throw new Error(`${jt.name} needs ${missing.map((m) => `--input ${m}=…`).join(' ')}`);
  return values;
}
