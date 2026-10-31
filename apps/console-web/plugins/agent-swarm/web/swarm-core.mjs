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
  return { $axf: 'swarm-roster@1', agents: (Array.isArray(o.agents) ? o.agents : []).map(normAgent) };
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
 *   opts.tune → { scale } budget multiplier.
 * Returns { jobs, waves, warnings }. A job's `wave` is when it may start; `after` lists the jobs it waits for.
 */
export function planJobs(builds, roster, opts = {}) {
  const eligible = opts.eligible ?? (() => true);
  const jobs = []; const warnings = [];
  for (const b of Array.isArray(builds) ? builds : [builds]) {
    for (const s of b.steps ?? []) {
      if (s.done === true || s.skip === true) continue;
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
        leases: area, leaseKind: leases.length ? 'files' : area.length ? 'area' : 'all', shared, budget: budgetFor(a, s, opts.tune), checks: list(s.checks, 20, 300), wave: 0, after: [] });
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
