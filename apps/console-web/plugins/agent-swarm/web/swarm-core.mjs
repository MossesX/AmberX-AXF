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
