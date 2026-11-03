/**
 * Agent swarm core. Pure: no fs, no DOM, no clock reads except through `now` arguments. Shared by the console page,
 * the CLI (../swarm.mjs), the runner, the server part and the tests.
 *
 * The data contracts (agent@1, agent-skill@1, swarm-roster@1, swarm-state@1, swarm-job@1, swarm-run@1,
 * swarm-report@1) are the framework's: framework/core/engines/swarm-rules.mjs (one registry, normalizers, validators
 * that name the field, JSON Schemas, fixture framework/spec/fixtures/swarm.json). This file re-exports them so every
 * swarm surface keeps one import, and holds the engines that act on them: planner, context packer, runner tracking,
 * cost meter, pay, statuses, chat lines, banter and the vibe filter.
 */

import { ALLOWED_MODELS, DEFAULT_MODEL, MODEL_IDS as POLICY_IDS, MODEL_TIERS as POLICY_TIERS, coerceModel } from '../../../../../framework/core/model-policy.mjs';
import * as rules from '../../../../../framework/core/engines/swarm-rules.mjs';

// ---------------------------------------------------------------- contracts (framework/core/engines/swarm-rules.mjs)

export {
  SWARM, TAGS, STATUSES, PICKABLE, CHAT_KINDS, WORK_KINDS, BOSS, VIBE, SLIDERS, PRESETS, DEFAULT_PRESET, VIBE_COLORS, AVATAR_FACES, AVATAR_GEAR, AVATAR_TOKENS,
  IDENTITY_FIELDS, SHARED_FILES, RUN_KINDS, REPORT_STATUSES, LEASE_KINDS, isAgentId, isCardId, isTimestamp, rejection,
  normAgent, agentErrors, parseSkill, normSkill, skillErrors, normRoster, rosterErrors, normAgentState, normChat, normMessage, normChatSettings, normCardDesign, normCards, normState, stateErrors,
  normJob, jobErrors, normReport, reportErrors, parseReport, emptyUsage, budgetTokens, normRun, runErrors, swarmErrors, normSwarm,
} from '../../../../../framework/core/engines/swarm-rules.mjs';

/**
 * Models from cheapest to dearest (the model policy's tier order). A job needs a tier; an agent runs the cheapest model
 * it allows at or above it. Only the policy's allowed models may run (Opus or Fable, never Sonnet; Brett, Nov 1 2026):
 * a roster or job that names a blocked one is coerced up to the cheapest allowed model.
 */
export const MODEL_TIERS = POLICY_TIERS;
export { ALLOWED_MODELS, DEFAULT_MODEL };
export const MODEL_LABEL = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' };
/** A skill file is one page at most. */
export const SKILL_MAX_LINES = rules.SWARM.skill.maxLines;
export const SKILL_MAX_CHARS = rules.SWARM.skill.maxChars;
/** Runner statuses after a run ended (the contract's list without `running`). */
export const RUN_STATUSES = rules.RUN_STATUSES.filter((s) => s !== 'running');
export const CACHE_READ_WEIGHT = rules.SWARM.run.cacheReadWeight;
export const REPORT_SCHEMA = rules.TAGS.report;
export const CHAT_MAX = rules.SWARM.chat.max;
export const DEFAULT_RULES = rules.SWARM.state.defaultRules;
export const SMALL_JOB_MINUTES = rules.SWARM.state.smallJobMinutes;

const { STATUSES, PICKABLE, BOSS, VIBE, SLIDERS, PRESETS, IDENTITY_FIELDS, SHARED_FILES, WORK_KINDS, isCardId, normState, normChatSettings, normMessage, normCardDesign } = rules;
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, d, lo = 0, hi = Infinity) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
const list = (v, max = 40, len = 200) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);

/** Problems with a roster and its skills ({ id: skill }), as plain sentences (the contract's messages). Empty = fine. */
export const checkRoster = (roster, skills = {}) => rules.rosterErrors(roster, skills).map((e) => e.message);

// ---------------------------------------------------------------- job planner (swarm-job@1)

const TIER_WORDS = {
  fable: /\b(contract|schema|migration|cross-port|kernel|engine internals?|asset type|design the)\b/i,
  opus: /\b(refactor|engine|kernel|security|migration|contract|runner|merge|lease|concurren\w*|planner|scor\w+)\b/i,
  haiku: /\b(docs?|readme|rename|typo|manifest|plugin\.json|status line|changelog|wording|copy)\b/i,
};
const CHEAP_SKILLS = ['docs', 'plugin-manifests'];
const PATH_RE = /(?:[\w.-]+\/)+[\w.*-]+\/?|\b[\w-]+\.(?:mjs|ts|tsx|py|json|md|kt|kts|css)\b/g;

/** `**` = any folders, `*` = anything but a slash; a pattern ending in `/` matches everything under it. */
export function globMatch(pattern, file) {
  if (pattern.endsWith('/')) return file.startsWith(pattern) || globMatch(`${pattern}**`, file);
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?')}$`);
  return re.test(file);
}
const isShared = (f, shared = SHARED_FILES) => shared.some((s) => (s.endsWith('/') ? f.startsWith(s) : f === s));

/** Do two leases touch the same file? Paths, folders (`x/`) and globs. */
export function leasesOverlap(a, b) {
  for (const x of a) for (const y of b) {
    if (x === y) return true;
    if (globMatch(x, y) || globMatch(y, x)) return true;
    if (x.endsWith('/') && y.startsWith(x)) return true;
    if (y.endsWith('/') && x.startsWith(y)) return true;
  }
  return false;
}

/** Paths a step names: its `files`, else paths written in its text. */
export function stepFiles(step) {
  const own = Array.isArray(step?.files) ? step.files.filter(Boolean) : [];
  if (own.length) return [...new Set(own)];
  const found = (str(step?.text, 4000).match(PATH_RE) ?? []).map((p) => p.replace(/[.,;:)]+$/, ''));
  return [...new Set(found.filter((p) => /\.[a-z]{1,5}$/.test(p) || /^(apps|framework|_claude|deploy|\.github)\//.test(p)))];
}

/** The agent whose skill fits a step best (keywords ×2, path patterns ×3). Ties go to the cheaper salary. */
export function matchAgent(text, files, agents) {
  const low = ` ${str(text, 8000).toLowerCase()} `;
  let best = null;
  for (const a of agents) {
    let score = 0;
    for (const k of a.keywords) if (new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(low)) score += 2;
    for (const f of files) if (a.paths.some((p) => globMatch(p, f))) score += 3;
    if (!best || score > best.score || (score === best.score && a.salary < best.agent.salary)) best = { agent: a, score };
  }
  return best;
}

/** Cheapest tier that can do the step: Fable only for contract/design work pinned to Fable; the rest the policy's default (cheap tiers are coerced up). */
export function requiredTier(step, skill) {
  const text = str(step?.text, 4000);
  if (step?.model === 'Fable' && TIER_WORDS.fable.test(text)) return 'fable';
  if (TIER_WORDS.opus.test(text)) return 'opus';
  if (CHEAP_SKILLS.includes(skill) || TIER_WORDS.haiku.test(text)) return coerceModel(CHEAP_SKILLS.includes(skill) ? 'haiku' : 'sonnet');
  return coerceModel('sonnet');
}
/** The cheapest model the agent allows at or above the tier (or its dearest, flagged, when none reaches it). */
export function pickModel(agent, tier) {
  const need = MODEL_TIERS.indexOf(tier);
  const ok = agent.models.find((m) => MODEL_TIERS.indexOf(m) >= need);
  return ok ? { model: ok, short: false } : { model: agent.models[agent.models.length - 1], short: true };
}

/** "45 min", "2 h", 90 → minutes; null when unreadable. */
export function minutesOf(e) {
  if (typeof e === 'number' && e > 0) return e;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)?\s*$/i.exec(str(e, 30));
  return m ? Math.round(Number(m[1]) * ((m[2] || 'm').toLowerCase().startsWith('h') ? 60 : 1)) : null;
}

/** Token budget and max turns for one job: the agent's limits scaled by the step's estimate (30 min = 1×). */
export function budgetFor(agent, step, tune = {}) {
  const k = Math.min(1.5, Math.max(0.25, (minutesOf(step?.estimate) ?? 20) / 30)) * (tune.scale ?? 1);
  return { tokens: Math.round(agent.tokenBudget * k), maxTurns: Math.max(4, Math.round(agent.maxTurns * Math.min(1.25, k + 0.25))) };
}

/**
 * Split builds into jobs (one per open step) and order them so no two jobs that lease the same file run at once.
 * Builds are orchestrator@1 builds; several at once share one lease table, so many builds run side by side.
 *   opts.eligible(agent, job) → true when the agent may take the job (statuses, pay); default: everyone.
 *   opts.tune → { scale } budget multiplier. opts.includeDone → plan done steps too (checks and merges after the tick).
 * Returns { jobs, waves, warnings }. A job's `wave` is when it may start; `after` lists the jobs it waits for.
 */
export function planJobs(builds, roster, opts = {}) {
  const eligible = opts.eligible ?? (() => true);
  const jobs = []; const warnings = [];
  for (const b of Array.isArray(builds) ? builds : [builds]) {
    for (const s of b.steps ?? []) {
      if ((s.done === true && !opts.includeDone) || s.skip === true) continue;
      const files = stepFiles(s);
      const pool = roster.agents.filter((a) => !a.jobsOnly && eligible(a, { stepId: s.id, buildId: b.id, estimate: s.estimate }));
      const want = requiredTier(s, null); // agents that can reach the job's tier come first
      const able = pool.filter((a) => !pickModel(a, want).short);
      const hit = matchAgent(s.text, files, able.length ? able : pool);
      const id = `${b.id}.${s.id}`;
      if (!hit) { warnings.push(`${id}: no agent can take it (everyone is off, benched or broke)`); continue; }
      const a = hit.agent;
      if (hit.score === 0) warnings.push(`${id}: no clear specialist (name files in the step); went to ${a.name}`);
      const tier = requiredTier(s, a.skill);
      const pick = pickModel(a, tier);
      if (pick.short) warnings.push(`${id}: ${a.name} tops out at ${pick.model}; job wants ${tier}`);
      const leases = files.filter((f) => !isShared(f, opts.sharedFiles));
      const shared = files.filter((f) => isShared(f, opts.sharedFiles));
      // no named files: lease the agent's whole area, so the job is sequenced against anything in it
      const area = leases.length ? leases : a.paths.filter((p) => !p.startsWith('**'));
      jobs.push({ $axf: 'swarm-job@1', id, buildId: b.id, stepId: s.id, text: str(s.text, 2000), estimate: str(s.estimate, 20), agent: a.id, skill: a.skill, tier, model: pick.model, match: hit.score,
        leases: area, leaseKind: leases.length ? 'files' : area.length ? 'area' : 'all', shared, budget: budgetFor(a, s, opts.tune ?? roster.tune), checks: list(s.checks, 20, 300), wave: 0, after: [] });
    }
  }
  // overlap sequencing, in order: a job waits for every earlier job it overlaps with ('all' overlaps everything)
  for (let i = 0; i < jobs.length; i += 1) {
    const j = jobs[i];
    for (let k = 0; k < i; k += 1) {
      const e = jobs[k];
      const clash = j.leaseKind === 'all' || e.leaseKind === 'all' || leasesOverlap(j.leases, e.leases)
        || (e.buildId === j.buildId && e.agent === j.agent); // one agent works one job of a build at a time
      if (clash) { j.after.push(e.id); j.wave = Math.max(j.wave, e.wave + 1); }
    }
  }
  const waves = [];
  for (const j of jobs) (waves[j.wave] ??= []).push(j.id);
  return { jobs, waves, warnings };
}

// ---------------------------------------------------------------- context packer

/**
 * The shared prefix: identical bytes for every job of every agent, so prompt caching applies across the swarm.
 * Nothing job-specific goes in here (no ids, dates, paths). The persona block is added by step s8.
 */
export function sharedPrefix(parts = {}) {
  return [
    'You are one specialist agent in the AmberX AXF agent swarm, run headless by the build orchestrator ("Boss").',
    'WORK RULES',
    '- Do only the job in the message. Read and edit only the leased files listed there; the snippets are all the context you get. Do not explore the repo, list folders or read CLAUDE.md.',
    '- Never write shared files (_claude/THREADS.md, _claude/memory/STATUS.md, _claude/builds/, framework/catalog/, framework/plan/, tracker.json, CLAUDE.md, rules). Put what they need in your report\'s "notes"; Boss writes them after the merge.',
    '- Code, code comments and commit messages are clean and professional. No secrets anywhere.',
    '- Commit your work in this worktree with a plain one-line message. Do not push.',
    '- Stop when the job is done, failed or blocked. Do not start extra work.',
    'REPORT',
    `- End with exactly one fenced json block: {"$axf":"${REPORT_SCHEMA}","status":"done|failed|blocked","summary":"one or two lines","files":["paths you changed"],"checks":[{"name":"…","ok":true}],"notes":"lines for shared files, or empty","handoff":"what the next job should know, or empty","question":"the exact question when blocked, or empty"}`,
    parts.persona ? `PERSONA\n${parts.persona.trim()}` : '',
  ].filter(Boolean).join('\n');
}

const WORD = /[a-z][a-z0-9_-]{3,}/g;
const STOP = new Set(['with', 'that', 'this', 'from', 'into', 'each', 'when', 'then', 'only', 'every', 'what', 'also', 'make', 'have', 'more', 'than', 'they', 'them', 'their', 'there', 'files', 'file', 'step']);
export const SNIPPET = { wholeUpTo: 80, head: 12, context: 3, maxLines: 120 };

/**
 * The parts of one file a job needs: the whole file when it's short; else its head plus the lines that mention the
 * task's words (± context), merged, capped. Returns { path, whole, lines: [[from, to]], text }.
 */
export function extractSnippet(path, content, task, lim = SNIPPET) {
  const lines = str(content, 2_000_000).split('\n');
  if (lines.length <= lim.wholeUpTo) return { path, whole: true, lines: [[1, lines.length]], text: lines.join('\n') };
  const words = [...new Set((str(task, 8000).toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)))];
  const ranges = [[0, Math.min(lim.head, lines.length) - 1]];
  lines.forEach((l, i) => { const low = l.toLowerCase(); if (words.some((w) => low.includes(w))) ranges.push([Math.max(0, i - lim.context), Math.min(lines.length - 1, i + lim.context)]); });
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
  const out = []; let used = 0; const kept = [];
  for (const [a, b] of merged) {
    if (used >= lim.maxLines) break;
    const end = Math.min(b, a + (lim.maxLines - used) - 1);
    out.push(`@@ lines ${a + 1}-${end + 1}`, ...lines.slice(a, end + 1)); kept.push([a + 1, end + 1]); used += end - a + 1;
  }
  return { path, whole: false, lines: kept, text: out.join('\n') };
}

export const tokensOf = (text) => Math.ceil(str(text, 10_000_000).length / 4);

/**
 * One job's brief. `system` = shared prefix + the agent's skill (both cacheable; the prefix is the same for all),
 * `prompt` = the task, its leases and the snippets. Nothing else from the repo goes in.
 */
export function packJob(job, { prefix, skill, snippets = [], handoffs = [] } = {}) {
  const system = `${prefix}\nSKILL: ${skill?.title ?? job.skill}\n${skill?.body ?? ''}`.trim();
  const prompt = [
    `JOB ${job.id} (build ${job.buildId}, step ${job.stepId})`,
    `Task: ${job.text}`,
    `Leased files (only these): ${job.leases.length ? job.leases.join(', ') : 'none named; ask in your report if you need one'}`,
    job.shared?.length ? `Shared files Boss will write after merge (do not touch; put lines in notes): ${job.shared.join(', ')}` : '',
    job.checks?.length ? `Checks to run: ${job.checks.join(' · ')}` : '',
    `Budget: ${job.budget.tokens} tokens, ${job.budget.maxTurns} turns. Over budget = killed, so be direct.`,
    ...handoffs.filter(Boolean).map((h) => `Handoff from an earlier job: ${str(h, 600)}`),
    ...snippets.map((s) => `--- ${s.path}${s.whole ? '' : ' (excerpt)'} ---\n${s.text}`),
  ].filter(Boolean).join('\n');
  return { jobId: job.id, model: job.model, system, prompt, tokens: { system: tokensOf(system), prompt: tokensOf(prompt) } };
}

// ---------------------------------------------------------------- headless runner (pure parts)

/** Model ids for `claude --model`. */
export const MODEL_IDS = POLICY_IDS;

/** Arguments for one headless Claude Code run: own system prompt (no default dump), no MCP servers, only the job's tools. */
export function claudeArgs(brief, job, agent) {
  return [
    '-p', brief.prompt,
    '--model', MODEL_IDS[job.model] ?? job.model,
    '--system-prompt', brief.system,
    '--max-turns', String(job.budget.maxTurns),
    '--output-format', 'stream-json', '--verbose',
    '--allowedTools', agent.tools.join(','),
    '--permission-mode', 'acceptEdits',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  ];
}

const { emptyUsage, budgetTokens, parseReport } = rules;
export function addUsage(u, raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  u.input += Number(r.input_tokens) || 0; u.output += Number(r.output_tokens) || 0;
  u.cacheRead += Number(r.cache_read_input_tokens) || 0; u.cacheWrite += Number(r.cache_creation_input_tokens) || 0;
  return u;
}
/**
 * Follow a stream-json run line by line. Returns the next tracker: usage so far, turns, the final result text and
 * whether the run is over budget (the runner kills it then).
 */
export function trackLine(tr, line, budget) {
  let ev; try { ev = JSON.parse(line); } catch { return tr; }
  if (ev.type === 'assistant' && ev.message?.usage) { addUsage(tr.usage, ev.message.usage); tr.turns += 1; }
  if (ev.type === 'result') {
    tr.final = true; tr.text = str(ev.result, 200000); tr.isError = ev.is_error === true; tr.turns = Number(ev.num_turns) || tr.turns;
    if (ev.usage) { tr.usage = addUsage(emptyUsage(), ev.usage); } // the result's totals replace the running sum
    if (Number.isFinite(ev.total_cost_usd)) tr.reportedCost = ev.total_cost_usd;
    tr.subtype = str(ev.subtype, 60);
  }
  tr.over = budgetTokens(tr.usage) > budget.tokens;
  return tr;
}
export const newTracker = () => ({ usage: emptyUsage(), turns: 0, final: false, text: '', isError: false, over: false, reportedCost: null, subtype: '' });

/** How a finished run ends up: killed / error / the report's status. */
export function runOutcome(tr, { killed = '', exitCode = 0 } = {}) {
  const report = parseReport(tr.text);
  if (killed) return { status: 'killed', reason: killed, report };
  if (!tr.final || tr.isError || exitCode) return { status: 'error', reason: tr.subtype || (exitCode ? `exit ${exitCode}` : 'no result'), report };
  if (!report) return { status: 'failed', reason: 'no swarm-report@1 block', report: null };
  return { status: report.status, reason: '', report };
}

// ---------------------------------------------------------------- leases, shared files, batch merge

/** Pre-push / pre-merge check: every changed file is inside the job's lease, and no shared file is touched. */
export function leaseCheck(job, changed, shared = SHARED_FILES) {
  const files = list(changed, 5000, 400);
  const sharedHit = files.filter((f) => isShared(f, shared));
  const outside = job.leaseKind === 'all' ? [] : files.filter((f) => !isShared(f, shared) && !job.leases.some((l) => l === f || globMatch(l, f)));
  return { ok: !sharedHit.length && !outside.length, outside, shared: sharedHit, files };
}

/** Jobs ready for the batch merge, in plan order: run done, lease clean, not merged yet. */
export function mergeQueue(plan, runs, merged = []) {
  const last = new Map(); for (const r of runs) last.set(r.jobId, r);
  return plan.jobs.filter((j) => { const r = last.get(j.id); return r && r.status === 'done' && r.lease?.ok !== false && !merged.includes(j.id); }).map((j) => ({ job: j, run: last.get(j.id) }));
}

/** A merge-fixer job for a conflict between a merged job and the one that wouldn't merge. */
export function fixerJob(job, files, roster, withJob = '') {
  const a = roster.agents.find((x) => x.skill === 'merge-fixer') ?? roster.agents[0];
  return { $axf: 'swarm-job@1', id: `${job.buildId}.fix-${job.stepId}`, buildId: job.buildId, stepId: `fix-${job.stepId}`, text: `Resolve the merge conflict from ${job.id}${withJob ? ` against ${withJob}` : ''}: ${files.join(', ')}`,
    estimate: '15 min', agent: a.id, skill: a.skill, tier: 'sonnet', model: pickModel(a, 'sonnet').model, match: 0, leases: list(files, 200, 400), leaseKind: 'files', shared: [], budget: budgetFor(a, { estimate: '15 min' }), checks: job.checks, wave: job.wave, after: [job.id], fixes: job.id };
}

/**
 * What the orchestrator writes to the shared files after a batch merge: tick each merged step on the tracker
 * (orchestrator@1) with the report's summary, add one build note for the batch, and collect the reports' notes
 * lines for the session to put in THREADS / STATUS. Pure: returns a new tracker and the lines.
 */
export function applyMerge(tracker, buildId, merged, at) {
  const t = JSON.parse(JSON.stringify(tracker ?? { builds: [] }));
  const b = (t.builds ?? []).find((x) => x.id === buildId);
  if (!b) throw new Error(`no build "${buildId}" on the tracker`);
  const lines = [];
  for (const { job, run } of merged) {
    const s = (b.steps ?? []).find((x) => x.id === job.stepId);
    if (s) { s.done = true; s.doneAt = at; s.agent = job.agent; s.note = str(`${job.agent} on ${job.model}: ${run.report?.summary ?? 'merged'}`, 1000); }
    if (run.report?.notes) lines.push(`${job.id}: ${run.report.notes}`);
  }
  if (merged.length) (b.notes ??= []).push({ text: `Swarm batch merge: ${merged.map((m) => m.job.stepId).join(', ')}`, at });
  b.updatedAt = at; t.updatedAt = at;
  return { tracker: t, lines };
}

// ---------------------------------------------------------------- cost meter

/**
 * USD per million tokens. framework/schemas/model-pricing.json is the source; Haiku isn't in it yet, so its line
 * here is an estimate until it is (check claude.com/pricing).
 */
export const HAIKU_ESTIMATE = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, estimate: true };
export function prices(pricingFile) {
  const m = pricingFile?.models && typeof pricingFile.models === 'object' ? pricingFile.models : {};
  return { haiku: m.haiku ?? HAIKU_ESTIMATE, sonnet: m.sonnet, opus: m.opus, fable: m.fable };
}
export function costOf(u, model, table) {
  const p = table?.[model]; if (!p || !u) return 0;
  return (u.input * p.input + u.output * p.output + u.cacheRead * (p.cacheRead ?? 0) + u.cacheWrite * (p.cacheWrite ?? 0)) / 1e6;
}
/** A run's dollars: what Claude Code reported when it did, else priced from its usage. */
export const runCost = (r, table) => (Number.isFinite(r?.reportedCost) ? r.reportedCost : costOf(r?.usage, r?.model, table));
/** What a job's budget is worth: the budget tokens priced as a typical agent run (mostly cache reads). */
export function budgetUsd(job, table) {
  const t = job?.budget?.tokens ?? 0;
  return costOf({ input: t * 0.3, output: t * 0.1, cacheRead: t * 3, cacheWrite: t * 0.3 }, job?.model, table);
}
const totTokens = (u) => (u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0);

/** Tokens and dollars per agent, job and build, plus the total. */
export function meter(runs, table) {
  const z = () => ({ runs: 0, tokens: 0, usd: 0, done: 0, failed: 0 });
  const out = { total: z(), byAgent: {}, byJob: {}, byBuild: {}, byModel: {} };
  for (const r of Array.isArray(runs) ? runs : []) {
    const usd = runCost(r, table); const tok = totTokens(r.usage); const ok = r.status === 'done';
    for (const [k, key] of [['byAgent', r.agent], ['byJob', r.jobId], ['byBuild', r.buildId], ['byModel', r.model], ['total', null]]) {
      const slot = key === null ? out.total : (out[k][key] ??= z());
      slot.runs += 1; slot.tokens += tok; slot.usd += usd; if (ok) slot.done += 1; else slot.failed += 1;
    }
  }
  return out;
}
export const fmtUsd = (v) => `$${(Number(v) || 0) < 10 ? (Number(v) || 0).toFixed(2) : Math.round(Number(v) || 0)}`;
export const fmtTokens = (v) => { const n = Number(v) || 0; return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n); };

// ---------------------------------------------------------------- pilot: swarm vs one session

/**
 * Shape of a typical headless job run, used to project a job's tokens before (or without) a live run, and the
 * share of its max turns it uses. Replace with measured numbers from real runs (swarm.mjs pilot --measured).
 */
export const RUN_SHAPE = { turnShare: 0.6, growthPerTurn: 1500, outputPerTurn: 800 };

/** Projected usage of one job: its brief is written to the cache once, then read back on every turn as context grows. */
export function projectRun(job, briefTokens, shape = RUN_SHAPE) {
  const T = Math.max(1, Math.round(job.budget.maxTurns * shape.turnShare));
  const g = shape.growthPerTurn;
  return { input: T * 200, output: T * shape.outputPerTurn, cacheWrite: briefTokens + g * T, cacheRead: T * briefTokens + (g * T * (T - 1)) / 2 };
}

/**
 * Projected usage of the same build done in one session: model-pricing.json's per-minute heuristic over the
 * build's estimate, plus the always-loaded context (CLAUDE.md, rules, THREADS) read back once per minute.
 */
export function projectSession(build, heuristic, loadTokens = 0) {
  const min = (build.steps ?? []).filter((s) => !s.done && !s.skip).reduce((t, s) => t + (minutesOf(s.estimate) ?? 20), 0);
  const h = heuristic?.tokensPerMinute ?? { input: 5000, output: 3000, cacheRead: 300000, cacheWrite: 0 };
  return { minutes: min, usage: { input: h.input * min, output: h.output * min, cacheRead: (h.cacheRead + loadTokens) * min, cacheWrite: (h.cacheWrite ?? 0) * min + loadTokens } };
}

/**
 * Compare the swarm with one session for a build and suggest a budget scale: each job's budget should hold its
 * projected run with 50% headroom; the scale is the median of projected×1.5 / assigned, clamped 0.25–2.
 */
export function pilotReport(build, plan, briefs, table, heuristic, loadTokens, shape = RUN_SHAPE) {
  const jobs = plan.jobs.map((j) => {
    const b = briefs[j.id] ?? { system: 0, prompt: 0 };
    const u = projectRun(j, b.system + b.prompt, shape);
    return { id: j.id, agent: j.agent, model: j.model, brief: b.system + b.prompt, usage: u, usd: costOf(u, j.model, table), budget: j.budget.tokens, need: Math.round(budgetTokens(u) * 1.5) };
  });
  const swarm = jobs.reduce((t, j) => ({ tokens: t.tokens + budgetTokens(j.usage), usd: t.usd + j.usd }), { tokens: 0, usd: 0 });
  const modelOf = (s) => (s.model === 'Fable' ? 'fable' : 'opus');
  const open = (build.steps ?? []).filter((s) => !s.done && !s.skip);
  const single = open.reduce((t, s) => {
    const p = projectSession({ steps: [s] }, heuristic, loadTokens);
    return { minutes: t.minutes + p.minutes, tokens: t.tokens + budgetTokens(p.usage), usd: t.usd + costOf(p.usage, modelOf(s), table) };
  }, { minutes: 0, tokens: 0, usd: 0 });
  const ratios = jobs.map((j) => j.need / Math.max(1, j.budget)).sort((a, b) => a - b);
  const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
  const scale = Math.round(Math.min(2, Math.max(0.25, median)) * 100) / 100;
  return { build: build.id, jobs, swarm, single, saving: single.usd ? 1 - swarm.usd / single.usd : 0, scale, shape };
}

// ---------------------------------------------------------------- swarm state (swarm-state@1) and statuses
// Shapes, statuses and normalizers are the contract's (swarm-rules.mjs); what follows acts on them.

// ---------------------------------------------------------------- ID cards (agent-card@1 designs; rules framework/core/engines/agent-card-rules.mjs)

/** The identity a card shows: the roster's agent with Brett's edits on top, plus its status words. */
export function cardIdentity(agent, as, statusWord = '') {
  const id = as?.identity ?? {};
  const pick = (k) => id[k] || agent?.[k] || '';
  return { id: agent?.id ?? '', name: pick('name'), role: pick('role'), specialty: pick('specialty'), photo: id.photo || '', employeeId: id.employeeId || '', email: id.email || '', hiredAt: pick('hiredAt'), status: statusWord, catchphrase: pick('catchphrase'), signature: id.signature || '', page: `axf://agent-swarm/${agent?.id ?? ''}` };
}
/** Which design an agent's card uses: its own pick, else the swarm's default, else '' (the app's active agent-card asset). */
export const cardFor = (state, agentId) => state.agents[agentId]?.card || state.cards.default || '';

export const statusLabel = (as) => (as.status === 'custom' ? as.custom.name || 'Custom' : STATUSES[as.status]?.label ?? as.status);
const worksOf = (as) => (as.status === 'custom' ? as.custom.works : STATUSES[as.status]?.works);

/** Can this agent take this job now? { ok, why, notify } (`notify` = Brett hears about the run: probation). */
export function canWork(agent, as, job = {}, now = '', pay = null) {
  const w = worksOf(as);
  if (w !== false && pay?.broke) return { ok: false, why: `broke till payday (${pay.payday.slice(0, 10)})`, notify: false };
  if (w === true) return { ok: true, why: '', notify: false };
  if (w === 'small') {
    const m = minutesOf(job.estimate) ?? 20;
    return m <= SMALL_JOB_MINUTES ? { ok: true, why: '', notify: true } : { ok: false, why: `${statusLabel(as)}: small jobs only (≤ ${SMALL_JOB_MINUTES} min)`, notify: false };
  }
  return { ok: false, why: `${statusLabel(as)}${as.until ? ` until ${as.until.slice(0, 10)}` : ''}`, notify: false };
}

/** Set a status, keeping history. Returns the log line. */
function setStatus(st, id, to, note, at, by = 'brett', extra = {}) {
  const as = st.agents[id]; if (!as) throw new Error(`no agent "${id}"`);
  const from = statusLabel(as);
  as.status = to; as.note = str(note, 300); as.until = str(extra.until, 40);
  if (to === 'custom') as.custom = { name: str(extra.name, 40) || 'Custom', works: extra.works === true };
  as.history.push({ at, from, to: statusLabel(as), note: as.note, by });
  return `${id}: ${from} → ${statusLabel(as)}${note ? ` (${note})` : ''}`;
}

/** Time-driven changes: medical leave that has ended goes back on duty. Returns { state, log }. */
export function tick(state, at) {
  const log = [];
  for (const [id, as] of Object.entries(state.agents)) {
    if (as.status === 'suspended' && as.until && as.until <= at) { log.push(setStatus(state, id, 'on-duty', 'suspension over', at, 'boss')); post(state, [{ from: BOSS.id, kind: 'discipline', text: `${id}'s suspension is over. Back on duty.` }], at); }
    if (as.status === 'medical-leave' && as.until && as.until <= at) { log.push(setStatus(state, id, 'on-duty', 'back from medical leave', at, 'boss')); post(state, [{ from: BOSS.id, kind: 'status', text: `${id} is back from medical leave and on duty.` }], at); }
  }
  return { state, log };
}

/** One change to the swarm state. Returns { state, log } or throws with a plain message. */
export function applyChange(state, change, roster, at) {
  const s = normState(state, roster); const c = change && typeof change === 'object' ? change : {};
  const log = [];
  switch (c.action) {
    case 'status': {
      if (!PICKABLE.includes(c.status)) throw new Error(c.status === 'suspended' || c.status === 'quit' ? `use ${c.status === 'quit' ? 'rehire' : 'suspend'} for that` : `unknown status "${c.status}"`);
      if (c.status === 'medical-leave' && !(str(c.until, 40) > at)) throw new Error('medical leave needs a return date in the future');
      if (c.status === 'custom' && !str(c.name, 40).trim()) throw new Error('a custom status needs a name');
      log.push(setStatus(s, c.agent, c.status, c.note, at, 'brett', c));
      post(s, [{ from: BOSS.id, kind: 'status', text: `${nameOf(roster, c.agent)} is now ${statusLabel(s.agents[c.agent])}${c.note ? `: ${str(c.note, 200)}` : ''}.` }], at); break;
    }
    case 'salary': { // raise or dock, posted by Boss, with coworker reactions
      const a = roster.agents.find((x) => x.id === c.agent); const as = s.agents[c.agent]; if (!a || !as) throw new Error(`no agent "${c.agent}"`);
      const from = as.salary ?? a.salary; const to = num(c.usd, from, 0, 100000);
      if (to === from) throw new Error('that is the same salary');
      const kind = to > from ? 'raise' : 'dock'; as.salary = to; as.pay.push({ at, kind, from, to, note: str(c.note, 200) });
      log.push(`${c.agent}: ${kind === 'raise' ? 'raise' : 'docked'} ${fmtUsd(from)} → ${fmtUsd(to)} a week`);
      post(s, [{ from: BOSS.id, kind: 'pay', text: kind === 'raise' ? `${a.name} gets a raise: ${fmtUsd(from)} → ${fmtUsd(to)} a week.${c.note ? ` ${str(c.note, 200)}` : ''}` : `${a.name} got docked: ${fmtUsd(from)} → ${fmtUsd(to)} a week.${c.note ? ` ${str(c.note, 200)}` : ''}` }], at);
      for (const r of reactors(s, roster, a.id, reactCount(s, at), `${at}${a.id}`)) post(s, [{ from: r.id, kind: 'banter', text: banterLine(kind === 'raise' ? 'raise' : 'docked', `${at}${r.id}`, { other: a.name }) }], at);
      break;
    }
    case 'topup': {
      const a = roster.agents.find((x) => x.id === c.agent); const as = s.agents[c.agent]; if (!a || !as) throw new Error(`no agent "${c.agent}"`);
      const usd = num(c.usd, 0, 0, 100000); if (!usd) throw new Error('top up by more than $0');
      as.topups.push({ at, usd }); as.brokeSaid = ''; log.push(`${c.agent}: topped up ${fmtUsd(usd)}`);
      post(s, [{ from: BOSS.id, kind: 'pay', text: `Brett topped ${a.name} up by ${fmtUsd(usd)} this week.` }], at); break;
    }
    case 'chat': { // global and per-agent switches
      if (typeof c.enabled === 'boolean') { s.chat.enabled = c.enabled; log.push(`group chat ${c.enabled ? 'on' : 'off'}`); }
      if (c.agent) { if (!s.agents[c.agent]) throw new Error(`no agent "${c.agent}"`); s.chat.agents[c.agent] = c.on !== false; log.push(`${c.agent} chat ${c.on !== false ? 'on' : 'off'}`); }
      break;
    }
    case 'chat-settings': { // sliders, overrides, banter budget, presets
      const cs = s.chatSettings;
      if (c.preset) { const p = PRESETS[c.preset] ?? cs.saved.find((x) => x.name === c.preset); if (!p) throw new Error(`no preset "${c.preset}"`); for (const k of SLIDERS) cs[k] = p[k]; cs.preset = c.preset; log.push(`chat preset ${p.label ?? p.name}`); }
      const vals = c.values && typeof c.values === 'object' ? c.values : {};
      for (const k of SLIDERS) if (vals[k] != null) { cs[k] = k === 'vibe' ? Math.round(num(vals[k], cs[k], VIBE.min, VIBE.max)) : slider(vals[k], cs[k]); cs.preset = 'custom'; }
      if (c.banterBudget != null) cs.banterBudget = num(c.banterBudget, cs.banterBudget, 0, 1000);
      if (c.agent) {
        if (!s.agents[c.agent]) throw new Error(`no agent "${c.agent}"`);
        if (c.override === null) delete cs.overrides[c.agent];
        else { const o = { ...(cs.overrides[c.agent] ?? {}) }; for (const k of SLIDERS) if (c.override?.[k] != null) o[k] = k === 'vibe' ? Math.round(num(c.override[k], 100, VIBE.min, VIBE.max)) : slider(c.override[k], 50); else if (c.override && k in c.override) delete o[k]; cs.overrides[c.agent] = o; }
        log.push(`${c.agent}: chat overrides ${c.override === null ? 'cleared' : 'saved'}`);
      }
      if (c.save) { const name = str(c.save, 40).trim(); if (!name || PRESETS[name]) throw new Error('pick another preset name'); cs.saved = [...cs.saved.filter((x) => x.name !== name), { name, ...Object.fromEntries(SLIDERS.map((k) => [k, cs[k]])) }]; cs.preset = name; log.push(`preset "${name}" saved`); }
      if (c.forget) { cs.saved = cs.saved.filter((x) => x.name !== c.forget); log.push(`preset "${c.forget}" removed`); }
      if (!log.length) log.push('chat settings saved');
      s.chatSettings = normChatSettings(cs); break;
    }
    case 'say': { // Brett posts in the room (no tokens; nobody answers unless banter is asked for)
      const text = str(c.text, 1000).trim(); if (!text) throw new Error('empty message');
      if (!post(s, [{ from: 'brett', kind: 'brett', text }], at)) throw new Error('the group chat is off'); log.push('posted'); break;
    }
    case 'suspend': {
      const until = str(c.until, 40); const reason = str(c.reason, 300).trim();
      if (!(until > at)) throw new Error('a suspension needs an end in the future');
      if (!reason) throw new Error('say why');
      log.push(setStatus(s, c.agent, 'suspended', reason, at, 'brett', { until }));
      post(s, [{ from: BOSS.id, kind: 'discipline', text: `${nameOf(roster, c.agent)} is suspended until ${until.slice(0, 16).replace('T', ' ')} UTC. Reason: ${reason}.` }], at); break;
    }
    case 'rehire': {
      const as = s.agents[c.agent]; if (!as) throw new Error(`no agent "${c.agent}"`);
      if (as.status === 'on-duty') throw new Error('already on duty');
      log.push(setStatus(s, c.agent, 'on-duty', str(c.note, 300) || 'rehired', at)); as.failStreak = 0;
      post(s, [{ from: BOSS.id, kind: 'discipline', text: `${nameOf(roster, c.agent)} is rehired and back on duty. Don't make me regret it.` }], at); break;
    }
    case 'rules': { if (c.rageQuitAfter != null) s.rules.rageQuitAfter = num(c.rageQuitAfter, 3, 1, 50) | 0; log.push(`rage-quit after ${s.rules.rageQuitAfter} failed jobs in a row`); break; }
    case 'identity': { // ID card fields; blank = back to the roster's / derived value
      const as = s.agents[c.agent]; if (!as) throw new Error(`no agent "${c.agent}"`);
      const f = c.fields && typeof c.fields === 'object' ? c.fields : {};
      if (f.hiredAt && !/^\d{4}-\d{2}-\d{2}$/.test(str(f.hiredAt, 20))) throw new Error('hire date must be YYYY-MM-DD');
      if (f.photo && !/^(https?:\/\/|data:image\/|\/)/.test(str(f.photo, 600))) throw new Error('photo must be an image link');
      for (const k of IDENTITY_FIELDS) if (k in f) as.identity[k] = str(f[k], k === 'photo' ? 600 : 200).trim();
      log.push(`${c.agent}: ID card details saved`); break;
    }
    case 'card': { // per-agent design ('' = the default)
      const as = s.agents[c.agent]; if (!as) throw new Error(`no agent "${c.agent}"`);
      const id = str(c.design, 48); if (id && !isCardId(id)) throw new Error('not a card design id');
      as.card = id; log.push(`${c.agent}: card design ${id || 'default'}`); break;
    }
    case 'card-default': {
      const id = str(c.design, 48); if (id && !isCardId(id)) throw new Error('not a card design id');
      s.cards.default = id; log.push(`default card design ${id || "the app's"}`);
      post(s, [{ from: BOSS.id, kind: 'status', text: `New ID cards for everybody${id ? ` (${str(c.name, 60) || id})` : ''}. Smile, assholes.` }], at); break;
    }
    case 'card-save': { // Save as new: a new design asset (never overwrites a starter id)
      const d = normCardDesign(c.asset);
      if (!isCardId(d.id)) throw new Error('give the design an id (lowercase letters, digits, dashes)');
      if ((c.taken ?? []).includes(d.id)) throw new Error(`"${d.id}" is already a design: pick another id`);
      s.cards.designs = [...s.cards.designs.filter((x) => x.id !== d.id), d].slice(-50);
      log.push(`card design "${d.name}" saved`); break;
    }
    case 'card-delete': {
      const id = str(c.design, 48); const before = s.cards.designs.length;
      s.cards.designs = s.cards.designs.filter((x) => x.id !== id); if (s.cards.designs.length === before) throw new Error(`no saved design "${id}"`);
      if (s.cards.default === id) s.cards.default = '';
      for (const as of Object.values(s.agents)) if (as.card === id) as.card = '';
      log.push(`card design "${id}" removed`); break;
    }
    case 'note': { const as = s.agents[c.agent]; if (!as) throw new Error(`no agent "${c.agent}"`); as.note = str(c.note, 300); log.push(`${c.agent}: note saved`); break; }
    default: throw new Error(`unknown action ${c.action}`);
  }
  s.updatedAt = at;
  return { state: s, log };
}

// ---------------------------------------------------------------- spend per agent

/** Start of the week (Monday 00:00 UTC) and of the day (00:00 UTC) for an ISO time. */
export function weekStart(at) { const d = new Date(at); const day = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString(); }
export function dayStart(at) { const d = new Date(at); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString(); }

/** Dollars and tokens an agent spent: all time, this week, today, and the average per job. */
export function spendOf(runs, agentId, table, at) {
  const w = weekStart(at); const d = dayStart(at);
  const z = () => ({ usd: 0, tokens: 0, runs: 0 });
  const o = { all: z(), week: z(), today: z(), avgPerJob: 0, jobs: 0 };
  const jobs = new Set();
  for (const r of runs ?? []) {
    if (r.agent !== agentId) continue;
    const usd = runCost(r, table); const tok = totTokens(r.usage); const when = r.endedAt || r.startedAt || '';
    const add = (s) => { s.usd += usd; s.tokens += tok; s.runs += 1; };
    add(o.all); if (when >= w) add(o.week); if (when >= d) add(o.today); jobs.add(r.jobId);
  }
  o.jobs = jobs.size; o.avgPerJob = jobs.size ? o.all.usd / jobs.size : 0;
  return o;
}

/**
 * Pay for this pay period (Monday 00:00 UTC to the next Monday): the salary is the agent's weekly budget in dollars,
 * plus any top-ups this week. Broke = spent it all: no new jobs until payday or a top-up.
 */
export function payOf(agent, as, runs, table, at) {
  const start = weekStart(at); const payday = new Date(Date.parse(start) + 7 * 864e5).toISOString();
  const salary = as?.salary ?? agent?.salary ?? 0;
  const topups = (as?.topups ?? []).filter((x) => x.at >= start).reduce((t, x) => t + x.usd, 0);
  const spent = spendOf(runs, agent?.id, table, at).week.usd;
  const left = salary + topups - spent;
  const bonus = (as?.bonuses ?? []).reduce((t, x) => t + x.usd, 0);
  return { salary, topups, spent, left, broke: left <= 0, periodStart: start, payday, bonus, bonusWeek: (as?.bonuses ?? []).filter((x) => x.at >= start).reduce((t, x) => t + x.usd, 0) };
}

/** Broke agents say so in the chat, once per pay period. Returns the log lines. */
export function payCheck(state, roster, runs, table, at) {
  const log = [];
  for (const a of roster.agents) {
    const as = state.agents[a.id]; const p = payOf(a, as, runs, table, at);
    if (p.broke && as.brokeSaid < p.periodStart && worksOf(as) !== false) {
      as.brokeSaid = at; log.push(`${a.id}: broke till ${p.payday.slice(0, 10)}`);
      post(state, [{ from: a.id, kind: 'pay', text: `I'm broke. Spent ${fmtUsd(p.spent)} of ${fmtUsd(p.salary + p.topups)} this week, so no more jobs till payday (${p.payday.slice(0, 10)}) unless Brett tops me up.` }], at);
    }
  }
  return log;
}

// ---------------------------------------------------------------- cards and profiles

/** What an agent's card and profile show from its runs. */
export function agentStats(runs, agentId, table, feedSize = 10) {
  const mine = (runs ?? []).filter((r) => r.agent === agentId);
  const done = mine.filter((r) => r.status === 'done').length; const failed = mine.length - done;
  const models = {}; for (const r of mine) models[r.model] = (models[r.model] ?? 0) + 1;
  const favorite = Object.entries(models).sort((a, b) => b[1] - a[1] || MODEL_TIERS.indexOf(a[0]) - MODEL_TIERS.indexOf(b[0]))[0]?.[0] ?? '';
  const last = mine.reduce((t, r) => ((r.endedAt || r.startedAt || '') > t ? r.endedAt || r.startedAt : t), '');
  const feed = mine.slice(-feedSize).reverse().map((r) => ({ jobId: r.jobId, buildId: r.buildId, at: r.endedAt || r.startedAt, status: r.status, model: r.model, usd: runCost(r, table), summary: r.report?.summary ?? r.reason ?? '' }));
  return { runs: mine.length, done, failed, successRate: mine.length ? done / mine.length : null, favoriteModel: favorite, lastSeen: last, feed };
}
/** Avatar colours: theme tokens only (the contract's AVATAR_TOKENS), so every avatar follows the theme; the agent's hue picks its pair. */
export function avatarColors(av) {
  const T = rules.AVATAR_TOKENS;
  const i = Math.floor((av?.hue ?? 0) / 45) % T.length;
  return { hair: T[i], shirt: T[(i + 3 + (av?.hair ?? 0)) % T.length] };
}

// ---------------------------------------------------------------- group chat

/** Is this agent's voice on? (Boss and Brett only need the global switch.) */
export const chatOn = (state, from) => state.chat.enabled && (from === BOSS.id || from === 'brett' || state.chat.agents[from] !== false);

/**
 * Post messages. Global switch off = nothing is kept and no banter is asked for (zero cost). An agent switched off
 * stays quiet; Boss still posts its work. Returns how many were posted.
 */
export function post(state, msgs, at) {
  let n = 0;
  for (const raw of msgs) {
    if (!raw?.text || !chatOn(state, raw.from)) continue;
    const m = state.chatSettings ? vibeFilter(raw, state.chatSettings) : raw; // over the ceiling = toned down or dropped
    if (!m) continue;
    const id = `m${Date.parse(at) || 0}-${state.messages.length}`;
    state.messages.push(normMessage({ ...m, id, at: m.at || at }, state.messages.length)); n += 1;
  }
  if (state.messages.length > CHAT_MAX) state.messages.splice(0, state.messages.length - CHAT_MAX);
  return n;
}

const fileList = (l) => (l.length ? (l.length > 3 ? `${l.slice(0, 3).join(', ')} +${l.length - 3}` : l.join(', ')) : 'no files named');
const nameOf = (roster, id) => roster.agents.find((a) => a.id === id)?.name ?? (id === BOSS.id ? BOSS.name : id);

/** Boss's assignment line: task, files, model, budget. */
export function assignLine(job, roster) {
  return { from: BOSS.id, kind: 'assign', jobId: job.id, text: `${nameOf(roster, job.agent)}, you got ${job.id}: ${str(job.text, 160)}. Files: ${fileList(job.leases)}. Model ${MODEL_LABEL[job.model] ?? job.model}, budget ${fmtTokens(job.budget.tokens)} tokens / ${job.budget.maxTurns} turns.` };
}
/** Boss's lease decisions for a plan: who waits for whom, over which files. */
export function leaseLines(plan, roster) {
  const out = [];
  for (const j of plan.jobs) {
    if (!j.after.length) continue;
    const e = plan.jobs.find((x) => x.id === j.after[j.after.length - 1]);
    const shared = e ? j.leases.filter((f) => e.leases.some((l) => leasesOverlap([f], [l]))) : [];
    out.push({ from: BOSS.id, kind: 'lease', jobId: j.id, text: `${nameOf(roster, j.agent)} waits on ${nameOf(roster, e?.agent)} (${e?.id}): ${shared.length ? `both want ${fileList(shared)}` : 'same agent or no files named'}. Wave ${j.wave + 1}.` });
  }
  return out;
}
/** The agent's own report line, and its handoff when it left one. */
export function reportLines(run, roster) {
  const r = run.report; const who = run.agent;
  const head = run.status === 'done' ? `Done with ${run.jobId}` : run.status === 'killed' ? `Got killed on ${run.jobId}: ${run.reason}` : run.status === 'blocked' ? `Blocked on ${run.jobId}` : `Failed ${run.jobId}${run.reason ? `: ${run.reason}` : ''}`;
  const out = [{ from: who, kind: 'report', jobId: run.jobId, text: `${head}.${r?.summary ? ` ${r.summary}` : ''}${r?.question ? ` Q for Brett: ${r.question}` : ''}` }];
  if (r?.handoff) out.push({ from: who, kind: 'handoff', jobId: run.jobId, text: `Handoff: ${r.handoff}` });
  return out;
}
export function mergeLines(res, roster) {
  const out = [];
  if (res.merged.length) out.push({ from: BOSS.id, kind: 'merge', text: `Merged ${res.merged.join(', ')} into ${res.branch}.` });
  for (const c of res.conflicts) out.push({ from: BOSS.id, kind: 'handoff', jobId: c.fixer, text: `${nameOf(roster, 'max')}, ${c.job} clashed on ${fileList(c.files)}. Clean it up (${c.fixer}).` });
  for (const r of res.refused) out.push({ from: BOSS.id, kind: 'lease', jobId: r.job, text: `${r.job} touched files outside its lease (${fileList([...r.outside, ...r.shared])}). Not merging that.` });
  return out;
}

/**
 * Banter bank: zero-token lines in Amber's voice, by moment. {me} = speaker, {other} = coworker, {file}, {job}.
 * No jokes about anyone's identity, ever. A cheap-model batch can add more (banterPrompt / parseBanter).
 */
export const BANTER = {
  idle: ['Anybody else just staring at the queue like it owes us money?', 'Chillin\' till Boss throws something at me. Don\'t make it CSS.', 'Coffee\'s cold, tokens are hot. Typical Tuesday.', 'Who keeps leaving half-merged branches in the fridge?'],
  gradle: ['Gradle\'s running. Cracking a beer, wake me up in twenty.', 'Kat, your damn Gradle build is older than my last raise.', 'I swear Gradle downloads the whole internet every time.'],
  fight: ['{other}, get your hands off {file}, that shit\'s leased to me.', 'Boss gave me {file}. Back the hell up, {other}.', '{other} wants {file} too? Take a number, buddy.'],
  done: ['{other} finished {job}? Took long enough, damn.', 'Nice one {other}. Don\'t let it go to your head.', 'Look at {other}, actually shipping. Who knew.'],
  failed: ['{other} blew up {job}. Somebody check on them.', 'Rough one, {other}. Shake it off and read the error this time.', 'F in the chat for {other}\'s {job}.'],
  raise: ['A raise for {other}? For WHAT? I fixed three conflicts this week.', 'Oh sure, {other} gets paid. Some of us actually work.', 'Congrats {other}. Drinks are on you, rich ass.'],
  bonus: ['{other} came in under budget again. Teacher\'s pet.', 'Bonus for {other}. I\'m not jealous, you\'re jealous.'],
  docked: ['{other} got docked. Ouch. Should\'ve stayed in your lease.', 'Pay cut for {other}? Brutal. Kinda deserved though.'],
};

/** Pick a banter line (deterministic from `seed`, so tests and replays match). */
export function banterLine(moment, seed, vars = {}) {
  const pool = BANTER[moment] ?? BANTER.idle;
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? k);
}

/** Coworkers who react to an event (not the subject; switched-on, working agents), up to `n`. */
export function reactors(state, roster, subject, n, seed) {
  const pool = roster.agents.filter((a) => a.id !== subject && chatOn(state, a.id) && !['fired', 'quit'].includes(state.agents[a.id]?.status));
  let h = 0; for (const ch of String(seed)) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: Math.min(n, pool.length) }, (_, i) => pool[(h + i * 3) % pool.length]).filter((a, i, arr) => arr.indexOf(a) === i);
}

/** Prompt for one cheap batch of banter lines (small model, no tools, one turn). */
export function banterPrompt(roster, recent, n = 6) {
  const who = roster.agents.map((a) => `${a.id} (${a.name}, ${a.role}): "${a.catchphrase}"`).join('\n');
  const lines = recent.slice(-12).map((m) => `${m.from}: ${m.text}`).join('\n');
  return `Write ${n} short group-chat lines between these coworkers, reacting to the recent work below. Amber's voice: blunt street slang, cussing, wild, funny about the work. Never joke about race, ethnicity, religion, gender, sexuality or any other identity. One line each, under 140 characters.\nCoworkers:\n${who}\nRecent:\n${lines || '(quiet day)'}\nAnswer only JSON: [{"agent":"<id>","text":"…"}]`;
}
export function parseBanter(text, roster) {
  const m = /\[[\s\S]*\]/.exec(str(text, 20000)); if (!m) return [];
  try { return JSON.parse(m[0]).filter((x) => roster.agents.some((a) => a.id === x?.agent) && typeof x.text === 'string').slice(0, 20).map((x) => ({ from: x.agent, kind: 'banter', text: str(x.text, 200) })); }
  catch { return []; }
}

// ---------------------------------------------------------------- discipline

/**
 * Book a finished run on its agent: a done job resets the failure streak; failed, killed and errored jobs add to it
 * (blocked doesn't count: it's a question, not a failure). At the rage-quit limit the agent quits itself and says so.
 * Returns the log lines.
 */
export function recordRun(state, run, roster, at, table = null) {
  const as = state.agents[run.agent]; if (!as) return [];
  const log = [];
  if (run.status === 'done' && table && run.budget) { // under budget = a bonus (bragging rights, not real money)
    const cap = budgetUsd({ budget: run.budget, model: run.model }, table); const cost = runCost(run, table);
    if (cost < cap) {
      const usd = Math.round((cap - cost) * 100) / 100; as.bonuses.push({ at, jobId: run.jobId, usd });
      const name = nameOf(roster, run.agent); log.push(`${run.agent}: bonus ${fmtUsd(usd)}`);
      post(state, [{ from: BOSS.id, kind: 'pay', text: `${name} finished ${run.jobId} for ${fmtUsd(cost)}, ${fmtUsd(usd)} under budget. Bonus.` }], at);
      for (const r of reactors(state, roster, run.agent, reactCount(state, at), `${run.jobId}bonus`)) post(state, [{ from: r.id, kind: 'banter', text: banterLine('bonus', `${run.jobId}${r.id}`, { other: name }) }], at);
    }
  }
  if (run.status === 'done') as.failStreak = 0;
  else if (run.status !== 'blocked') as.failStreak += 1;
  if (as.failStreak >= state.rules.rageQuitAfter && !['quit', 'fired'].includes(as.status)) {
    log.push(setStatus(state, run.agent, 'quit', `rage-quit after ${as.failStreak} failed jobs in a row`, at, run.agent));
    post(state, [{ from: run.agent, kind: 'discipline', text: `That's ${as.failStreak} in a row. I'm DONE with this shit. I quit.` }, { from: BOSS.id, kind: 'discipline', text: `${nameOf(roster, run.agent)} rage-quit. No jobs till Brett rehires.` }], at);
  }
  return log;
}

// ---------------------------------------------------------------- chat settings: vibe ceiling, sliders, presets
// VIBE, SLIDERS, PRESETS, DEFAULT_PRESET, VIBE_COLORS and normChatSettings are the contract's (swarm-rules.mjs).

const slider = (v, d, max = 100) => Math.round(num(v, d, 0, max));
/** The sliders that apply to one speaker: global, then its own overrides. */
export const settingsFor = (cs, from) => ({ ...cs, ...(cs.overrides?.[from] ?? {}) });

const CUSS = [
  { re: /\bfuck(ing|in'|ed|er)?\b/gi, level: 2, clean: (m) => (/ing|in'/i.test(m) ? 'freaking' : 'freak') },
  { re: /\bshit(ty)?\b/gi, level: 2, clean: (m) => (/ty$/i.test(m) ? 'crappy' : 'stuff') },
  { re: /\bbitch\w*\b/gi, level: 2, clean: () => 'complain' },
  { re: /\bass\b/gi, level: 1, clean: () => 'butt' },
  { re: /\bdamn(ed)?\b/gi, level: 1, clean: () => 'darn' },
  { re: /\bhell\b/gi, level: 1, clean: () => 'heck' },
  { re: /\bcrap\b/gi, level: 1, clean: () => 'junk' },
];
const SARCASM = [/\boh sure\b/i, /\bwho knew\b/i, /\btook (?:you )?long enough\b/i, /\bteacher'?s pet\b/i, /\btypical\b/i, /\bnot jealous\b/i, /\bdon'?t let it go to your head\b/i, /\bactually (?:work|shipping)\b/i, /\bkinda deserved\b/i];
const DRAMA = [/\bjealous\b/i, /\bback (?:the \w+ )?off\b|\bback the \w+ up\b/i, /\bget your hands off\b/i, /\bfor what\b/i, /\bdeserved\b/i, /\brich\b/i, /\bi quit\b/i, /\bregret\b/i, /\bclashed\b/i, /\bblew up\b/i, /\btake a number\b/i, /\bF in the chat\b/i];
const SLANG = [/\byo\b/i, /\bbro\b/i, /\bain'?t\b/i, /\by'all\b/i, /\bbuddy\b/i, /\bgonna\b/i];
/** Topics a joke may never be about, whatever the settings. */
const IDENTITY = /\b(race|racial|ethnic\w*|religio\w*|muslim\w*|christian\w*|jew(ish)?|hindu\w*|gay|lesbian|trans\w*gender|transgender|queer|gender|sexuality|black people|white people|asian\w*|latin[oa]s?|immigrant\w*)\b/i;

/** A message's vibe score, 1–500, from its words (no model). Work messages built by Boss score low. */
export function scoreVibe(text, kind = 'banter') {
  const t = str(text, 2000);
  let s = WORK_KINDS.includes(kind) && kind !== 'brett' ? 1 : 40;
  for (const c of CUSS) s += (t.match(c.re)?.length ?? 0) * (c.level === 2 ? 70 : 30);
  s += (t.match(/\b[A-Z]{3,}\b/g) ?? []).filter((w) => !/^(API|CSS|TSX|MCP|JSON|UTC|CLI|USD|PR|CI|URL|SDK)$/.test(w)).length * 25;
  s += Math.min(5, (t.match(/!/g) ?? []).length) * 12;
  s += SARCASM.filter((r) => r.test(t)).length * 45;
  s += DRAMA.filter((r) => r.test(t)).length * 40;
  s += SLANG.filter((r) => r.test(t)).length * 8;
  return Math.max(VIBE.min, Math.min(VIBE.max, Math.round(s)));
}
/** Cussing slider 0–100: under 34 every cuss word is cleaned, under 67 the strong ones. */
export function cleanCussing(text, cussing) {
  const keep = cussing >= 67 ? 2 : cussing >= 34 ? 1 : 0;
  let t = str(text, 2000);
  for (const c of CUSS) if (c.level > keep) t = t.replace(c.re, (m) => { const r = c.clean(m); return m[0] === m[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r; });
  return t;
}
/** Tone a line down: no shouting, no pile of exclamation marks, no sarcastic asides. */
export function calmDown(text) {
  let t = str(text, 2000).replace(/\b([A-Z]{3,})\b/g, (w) => (/^(API|CSS|TSX|MCP|JSON|UTC|CLI|USD|CI|URL|SDK)$/.test(w) ? w : w.toLowerCase())).replace(/!+/g, '.').replace(/\.\.+/g, '.');
  // a sarcastic sentence goes as a whole (cutting just the phrase leaves nonsense)
  return t.split(/(?<=[.?])\s+/).filter((x) => !SARCASM.some((r) => r.test(x))).join(' ').trim();
}

/**
 * Run one message through the speaker's settings. Returns the message to show (with `vibe` and `toned`) or null
 * when it's dropped. The vibe setting is a hard ceiling: a line above it is cleaned, then calmed; banter still
 * above is dropped. Work lines are never dropped (only toned down). Brett's own lines are scored, never changed.
 * Identity jokes are dropped whatever the settings; drama lines need the drama slider.
 */
export function vibeFilter(msg, cs) {
  const k = msg.kind; const set = settingsFor(cs, msg.from);
  if (k === 'brett') return { ...msg, vibe: scoreVibe(msg.text, k), toned: false };
  const work = WORK_KINDS.includes(k);
  if (!work && IDENTITY.test(msg.text)) return null;
  if (!work && set.drama < 30 && DRAMA.some((r) => r.test(msg.text))) return null;
  let text = cleanCussing(msg.text, set.cussing); let score = scoreVibe(text, k);
  if (score > set.vibe) { text = calmDown(cleanCussing(text, 0)); score = scoreVibe(text, k); }
  if ((score > set.vibe || !text) && !work) return null;
  return { ...msg, text, vibe: Math.min(score, set.vibe), toned: text !== msg.text };
}

/** How many coworkers react to an event at this chattiness (0 = assignments only). */
export const reactionsFor = (cs) => (cs.chattiness < 20 ? 0 : cs.chattiness < 60 ? 1 : 2);
/** Paid banter is allowed today: chattiness up, chat on, today's banter spend under the daily budget. */
export function banterAllowed(state, at) {
  const cs = state.chatSettings; const d = dayStart(at);
  const today = state.banterSpend.filter((b) => b.at >= d).reduce((t, b) => t + b.usd, 0);
  if (!state.chat.enabled) return { ok: false, why: 'the group chat is off', today };
  if (cs.chattiness < 40) return { ok: false, why: 'chattiness is too low for paid banter', today };
  if (today >= cs.banterBudget) return { ok: false, why: `today's banter budget (${fmtUsd(cs.banterBudget)}) is spent; quiet till tomorrow`, today };
  return { ok: true, why: '', today };
}

/** The live preview line: one sample per moment, run through the settings as they are now. */
export function previewLine(cs, from = 'rio', seed = 'preview') {
  const raw = cs.vibe > 300 ? 'Oh sure, TEX gets a raise. For WHAT? I fixed three damn conflicts this week, rich ass!!' : cs.vibe > 150 ? 'Boss gave me ui.tsx. Back the hell up, Tex, that shit\'s leased to me.' : 'Gradle\'s running. Cracking a beer, wake me up in twenty.';
  const m = vibeFilter({ from, kind: 'banter', text: raw }, cs);
  return m ?? { from, kind: 'banter', text: '(dropped: above the vibe ceiling)', vibe: null, toned: true, dropped: true, seed };
}
/** Color by vibe: how strong the tint is, 0–1 (light near 1, darkest at the ceiling). */
export const vibeShade = (score, ceiling) => (score == null ? 0 : Math.max(0.08, Math.min(1, score / Math.max(1, ceiling))));
/** Coworker reactions per event: by chattiness, none once today's banter budget is spent (quiet when hit). */
export function reactCount(state, at) {
  const cs = state.chatSettings; if (!cs) return 1;
  const d = dayStart(at); const today = state.banterSpend.filter((b) => b.at >= d).reduce((t, b) => t + b.usd, 0);
  return cs.banterBudget > 0 && today >= cs.banterBudget ? 0 : reactionsFor(cs);
}
