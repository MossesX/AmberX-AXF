/**
 * Agent swarm core. Pure: no fs, no DOM, no clock reads except through `now` arguments. Shared by the console page,
 * the CLI (../swarm.mjs), the runner, the server part and the tests.
 *
 * Contracts: swarm-roster@1 (agents/roster.json, each agent agent@1), agent-skill@1 (agents/skills/<id>.md),
 * swarm-state@1 (runtime state in the data folder), swarm-job@1 (a planned job), swarm-report@1 (an agent's report).
 */

// ---------------------------------------------------------------- roster (agent@1) and skills (agent-skill@1)

/** Models from cheapest to dearest. A job needs a tier; an agent runs the cheapest model it allows at or above it. */
export const MODEL_TIERS = ['haiku', 'sonnet', 'opus', 'fable'];
export const MODEL_LABEL = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' };
/** A skill file is one page at most. */
export const SKILL_MAX_LINES = 50;
export const SKILL_MAX_CHARS = 3000;
export const AVATAR_FACES = ['round', 'square', 'tall'];
export const AVATAR_GEAR = ['none', 'glasses', 'shades', 'cap', 'beanie', 'headphones'];

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, d, lo = 0, hi = Infinity) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
const list = (v, max = 40, len = 200) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);
const ID = /^[a-z][a-z0-9-]{0,39}$/;

export function normAgent(a) {
  const o = a && typeof a === 'object' ? a : {};
  const models = list(o.models, 4, 20).filter((m) => MODEL_TIERS.includes(m)).sort((x, y) => MODEL_TIERS.indexOf(x) - MODEL_TIERS.indexOf(y));
  const av = o.avatar && typeof o.avatar === 'object' ? o.avatar : {};
  return {
    $axf: 'agent@1',
    id: str(o.id, 40),
    name: str(o.name, 60) || str(o.id, 40),
    role: str(o.role, 80),
    skill: str(o.skill, 40),
    specialty: str(o.specialty, 200),
    keywords: list(o.keywords, 40, 40).map((k) => k.toLowerCase()),
    paths: list(o.paths, 40, 200),
    models: models.length ? models : ['sonnet'],
    tools: list(o.tools, 30, 120),
    maxTurns: num(o.maxTurns, 20, 1, 200),
    tokenBudget: num(o.tokenBudget, 300000, 1000, 10_000_000),
    salary: num(o.salary, 10, 0, 10000),
    hiredAt: str(o.hiredAt, 40),
    avatar: { face: AVATAR_FACES.includes(av.face) ? av.face : 'round', hair: num(av.hair, 0, 0, 5) | 0, gear: AVATAR_GEAR.includes(av.gear) ? av.gear : 'none', hue: num(av.hue, 0, 0, 359) | 0 },
    catchphrase: str(o.catchphrase, 160),
    bio: str(o.bio, 600),
  };
}

export function normRoster(r) {
  const o = r && typeof r === 'object' ? r : {};
  const tune = o.tune && typeof o.tune === 'object' ? { scale: num(o.tune.scale, 1, 0.25, 2), basis: str(o.tune.basis, 300) } : { scale: 1, basis: '' };
  return { $axf: 'swarm-roster@1', tune, agents: (Array.isArray(o.agents) ? o.agents : []).map(normAgent) };
}

/** agent-skill@1: a markdown file with `---` front matter (`id`, `title`) and a body under one page. */
export function parseSkill(md) {
  const text = str(md, 20000);
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const head = {};
  if (m) for (const line of m[1].split('\n')) { const k = /^([$\w-]+):\s*(.*)$/.exec(line); if (k) head[k[1]] = k[2].trim(); }
  const body = (m ? m[2] : text).trim();
  return { id: head.id ?? '', title: head.title ?? '', schema: head.$axf ?? '', body, lines: body.split('\n').length, chars: body.length };
}

/** Problems with a roster and its skills ({ id: skill }), as plain sentences. Empty = fine. */
export function checkRoster(roster, skills = {}) {
  const p = [];
  const seen = new Set();
  for (const s of Object.values(skills)) {
    if (s.schema !== 'agent-skill@1') p.push(`skill ${s.id || '?'}: front matter needs $axf: agent-skill@1`);
    if (s.lines > SKILL_MAX_LINES || s.chars > SKILL_MAX_CHARS) p.push(`skill ${s.id}: longer than one page (${s.lines} lines, ${s.chars} chars)`);
  }
  for (const a of roster.agents) {
    if (!ID.test(a.id)) p.push(`agent "${a.id}": id is lowercase letters, digits and dashes`);
    if (seen.has(a.id)) p.push(`agent "${a.id}" is listed twice`);
    seen.add(a.id);
    if (!skills[a.skill]) p.push(`agent ${a.id}: no skill file for "${a.skill}"`);
    if (!a.tools.length) p.push(`agent ${a.id}: no tools`);
  }
  return p;
}

// ---------------------------------------------------------------- job planner (swarm-job@1)

/**
 * Files only the orchestrator writes, after a batch merge: shared notes, registries, catalogs and trackers. A job
 * never leases them; what it would have written there goes in its report's `notes` instead.
 */
export const SHARED_FILES = [
  '_claude/THREADS.md', '_claude/memory/STATUS.md', '_claude/memory/decisions.md', '_claude/builds/', 'tracker.json',
  'framework/catalog/', 'framework/plan/', 'framework/catalog/plugins.json', 'CLAUDE.md', '_claude/rules/', '_claude/shared/',
];
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

/** Cheapest tier that can do the step: Fable only for contract/design work pinned to Fable. */
export function requiredTier(step, skill) {
  const text = str(step?.text, 4000);
  if (step?.model === 'Fable' && TIER_WORDS.fable.test(text)) return 'fable';
  if (TIER_WORDS.opus.test(text)) return 'opus';
  if (CHEAP_SKILLS.includes(skill) || TIER_WORDS.haiku.test(text)) return CHEAP_SKILLS.includes(skill) ? 'haiku' : 'sonnet';
  return 'sonnet';
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
      const pool = roster.agents.filter((a) => eligible(a, { stepId: s.id, buildId: b.id, estimate: s.estimate }));
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

export const REPORT_SCHEMA = 'swarm-report@1';
export const REPORT_STATUSES = ['done', 'failed', 'blocked'];
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
export const MODEL_IDS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' };
export const RUN_STATUSES = ['done', 'failed', 'blocked', 'killed', 'error'];
/** Cache reads cost about a tenth of fresh input, so they count a tenth against a job's token budget. */
export const CACHE_READ_WEIGHT = 0.1;

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

export const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export function addUsage(u, raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  u.input += Number(r.input_tokens) || 0; u.output += Number(r.output_tokens) || 0;
  u.cacheRead += Number(r.cache_read_input_tokens) || 0; u.cacheWrite += Number(r.cache_creation_input_tokens) || 0;
  return u;
}
/** Tokens charged against a job's budget. */
export const budgetTokens = (u) => Math.round(u.input + u.output + u.cacheWrite + u.cacheRead * CACHE_READ_WEIGHT);

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

/** The agent's swarm-report@1: the last fenced json block in its final message. */
export function parseReport(text) {
  const blocks = [...str(text, 200000).matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const m of blocks.reverse()) {
    try {
      const r = JSON.parse(m[1]);
      if (r && REPORT_STATUSES.includes(r.status)) {
        return { $axf: REPORT_SCHEMA, status: r.status, summary: str(r.summary, 600), files: list(r.files, 200, 300), checks: (Array.isArray(r.checks) ? r.checks : []).slice(0, 30).map((x) => ({ name: str(x?.name, 200), ok: x?.ok === true })),
          notes: str(r.notes, 2000), handoff: str(r.handoff, 1000), question: str(r.question, 600) };
      }
    } catch { /* try the one before */ }
  }
  return null;
}

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

/**
 * Statuses an agent can have. `works`: true = gets work, false = skipped, 'small' = small jobs only.
 * Custom statuses are named by Brett with their own `works`.
 */
export const STATUSES = {
  'on-duty': { label: 'On duty', works: true, tone: 'success', about: 'Gets work.' },
  'off-duty': { label: 'Off duty', works: false, tone: '', about: 'Skipped; keeps everything.' },
  injured: { label: 'Injured', works: false, tone: 'danger', about: 'Keeps failing: no new jobs, flagged for a fix.' },
  'medical-leave': { label: 'Medical leave', works: false, tone: 'warning', about: 'Benched until a date, then back on duty by itself.' },
  probation: { label: 'Probation', works: 'small', tone: 'warning', about: 'Small jobs only; Brett is notified every run.' },
  fired: { label: 'Fired', works: false, tone: 'danger', about: 'Never assigned again; kept greyed in history.' },
  custom: { label: 'Custom', works: false, tone: 'accent', about: 'Brett names it and picks whether it gets work.' },
  suspended: { label: 'Suspended', works: false, tone: 'danger', about: 'No jobs until the suspension ends, then back on duty by itself.' },
  quit: { label: 'Quit', works: false, tone: 'danger', about: 'Rage-quit after too many failed jobs in a row; Rehire puts it back.' },
};
/** Statuses Brett sets from the dropdown; Suspended and Quit come from Suspend and rage-quit. */
export const PICKABLE = ['on-duty', 'off-duty', 'injured', 'medical-leave', 'probation', 'fired', 'custom'];
export const DEFAULT_RULES = { rageQuitAfter: 3 };
export const SMALL_JOB_MINUTES = 15;

export function normAgentState(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    status: Object.hasOwn(STATUSES, o.status) ? o.status : 'on-duty',
    note: str(o.note, 300),
    until: str(o.until, 40),
    custom: { name: str(o.custom?.name, 40), works: o.custom?.works === true },
    cap: num(o.cap, 0, 0, 100000),
    failStreak: num(o.failStreak, 0, 0, 1000) | 0,
    benched: str(o.benched, 20),
    history: (Array.isArray(o.history) ? o.history : []).slice(-200).map((h) => ({ at: str(h?.at, 40), from: str(h?.from, 40), to: str(h?.to, 40), note: str(h?.note, 300), by: str(h?.by, 40) || 'brett' })),
  };
}
export function normState(s, roster) {
  const o = s && typeof s === 'object' ? s : {};
  const agents = {};
  for (const a of roster?.agents ?? []) agents[a.id] = normAgentState(o.agents?.[a.id]);
  for (const [k, v] of Object.entries(o.agents ?? {})) if (!agents[k]) agents[k] = normAgentState(v); // keep history of agents taken off the roster
  const rules = { rageQuitAfter: num(o.rules?.rageQuitAfter, DEFAULT_RULES.rageQuitAfter, 1, 50) | 0 };
  return { $axf: 'swarm-state@1', updatedAt: str(o.updatedAt, 40), rules, agents, chat: normChat(o.chat), messages: (Array.isArray(o.messages) ? o.messages : []).slice(-CHAT_MAX).map(normMsg), banterSpend: (Array.isArray(o.banterSpend) ? o.banterSpend : []).slice(-500).map((b) => ({ at: str(b?.at, 40), usd: Number(b?.usd) || 0 })), notices: (Array.isArray(o.notices) ? o.notices : []).slice(-200).map((n) => ({ at: str(n?.at, 40), agent: str(n?.agent, 40), text: str(n?.text, 400) })) };
}

export const statusLabel = (as) => (as.status === 'custom' ? as.custom.name || 'Custom' : STATUSES[as.status]?.label ?? as.status);
const worksOf = (as) => (as.status === 'custom' ? as.custom.works : STATUSES[as.status]?.works);

/** Can this agent take this job now? { ok, why, notify } (`notify` = Brett hears about the run: probation). */
export function canWork(agent, as, job = {}, now = '') {
  const w = worksOf(as);
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
  as.status = to; as.note = str(note, 300); as.until = str(extra.until, 40); as.benched = '';
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
    case 'cap': { const as = s.agents[c.agent]; if (!as) throw new Error(`no agent "${c.agent}"`); as.cap = num(c.usd, 0, 0, 100000); log.push(`${c.agent}: spend cap ${as.cap ? `${fmtUsd(as.cap)} a week` : 'off'}`); break; }
    case 'chat': { // global and per-agent switches
      if (typeof c.enabled === 'boolean') { s.chat.enabled = c.enabled; log.push(`group chat ${c.enabled ? 'on' : 'off'}`); }
      if (c.agent) { if (!s.agents[c.agent]) throw new Error(`no agent "${c.agent}"`); s.chat.agents[c.agent] = c.on !== false; log.push(`${c.agent} chat ${c.on !== false ? 'on' : 'off'}`); }
      break;
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
 * Spend cap: an agent whose spend this week reaches its cap is benched (Off duty, by Boss) until Brett puts it back.
 * Returns the log lines.
 */
export function capCheck(state, runs, table, at) {
  const log = [];
  for (const [id, as] of Object.entries(state.agents)) {
    if (!(as.cap > 0) || worksOf(as) === false) continue;
    const spent = spendOf(runs, id, table, at).week.usd;
    if (spent >= as.cap) { log.push(setStatus(state, id, 'off-duty', `spend cap hit: ${fmtUsd(spent)} of ${fmtUsd(as.cap)} this week`, at, 'boss')); as.benched = 'cap'; post(state, [{ from: BOSS.id, kind: 'status', text: `${id} hit the spend cap (${fmtUsd(spent)} of ${fmtUsd(as.cap)}). Benched.` }], at); }
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
/** Avatar palette: theme colours only, so every avatar follows the theme; the agent's hue picks its pair. */
export const AVATAR_TOKENS = ['--fx-brand-1', '--fx-brand-2', '--fx-brand-3', '--fx-accent', '--fx-info', '--fx-success', '--fx-warning', '--fx-danger'];
export function avatarColors(av) {
  const i = Math.floor((av?.hue ?? 0) / 45) % AVATAR_TOKENS.length;
  return { hair: AVATAR_TOKENS[i], shirt: AVATAR_TOKENS[(i + 3 + (av?.hair ?? 0)) % AVATAR_TOKENS.length] };
}

// ---------------------------------------------------------------- group chat

export const CHAT_KINDS = ['assign', 'lease', 'report', 'handoff', 'merge', 'status', 'discipline', 'pay', 'banter', 'brett'];
/** Work kinds are built from orchestrator messages and agent reports: no tokens. */
export const WORK_KINDS = ['assign', 'lease', 'report', 'handoff', 'merge', 'status', 'discipline', 'pay', 'brett'];
export const CHAT_MAX = 2000;
export const BOSS = { id: 'boss', name: 'Boss' };

export function normChat(c) {
  const o = c && typeof c === 'object' ? c : {};
  return {
    enabled: o.enabled !== false,
    agents: Object.fromEntries(Object.entries(o.agents && typeof o.agents === 'object' ? o.agents : {}).map(([k, v]) => [str(k, 40), v !== false])),
  };
}
const normMsg = (m, i) => ({ id: str(m?.id, 40) || `m${i}`, at: str(m?.at, 40), from: str(m?.from, 40), kind: CHAT_KINDS.includes(m?.kind) ? m.kind : 'banter', text: str(m?.text, 1000), jobId: str(m?.jobId, 120), vibe: Number.isFinite(m?.vibe) ? m.vibe : null, toned: m?.toned === true });

/** Is this agent's voice on? (Boss and Brett only need the global switch.) */
export const chatOn = (state, from) => state.chat.enabled && (from === BOSS.id || from === 'brett' || state.chat.agents[from] !== false);

/**
 * Post messages. Global switch off = nothing is kept and no banter is asked for (zero cost). An agent switched off
 * stays quiet; Boss still posts its work. Returns how many were posted.
 */
export function post(state, msgs, at) {
  let n = 0;
  for (const m of msgs) {
    if (!m?.text || !chatOn(state, m.from)) continue;
    const id = `m${Date.parse(at) || 0}-${state.messages.length}`;
    state.messages.push(normMsg({ ...m, id, at: m.at || at }, state.messages.length)); n += 1;
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
export function recordRun(state, run, roster, at) {
  const as = state.agents[run.agent]; if (!as) return [];
  const log = [];
  if (run.status === 'done') as.failStreak = 0;
  else if (run.status !== 'blocked') as.failStreak += 1;
  if (as.failStreak >= state.rules.rageQuitAfter && !['quit', 'fired'].includes(as.status)) {
    log.push(setStatus(state, run.agent, 'quit', `rage-quit after ${as.failStreak} failed jobs in a row`, at, run.agent));
    post(state, [{ from: run.agent, kind: 'discipline', text: `That's ${as.failStreak} in a row. I'm DONE with this shit. I quit.` }, { from: BOSS.id, kind: 'discipline', text: `${nameOf(roster, run.agent)} rage-quit. No jobs till Brett rehires.` }], at);
  }
  return log;
}
