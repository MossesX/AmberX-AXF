/**
 * swarm-rules — the agent swarm's data contracts (Brett, Oct 31 2026: headless specialist agents for the Build
 * orchestrator; Fable rebuild Nov 3 2026 after the Fable review: "the contracts live only inside the plugin").
 *
 * ONE registry (SWARM) for the seven records every swarm surface reads and writes:
 *   agent@1         one specialist on the roster (skill, models, tools, limits, salary, avatar, voice)
 *   agent-skill@1   the agent's one-page skill file (markdown with front matter)
 *   swarm-roster@1  the roster: agents + a budget tune
 *   swarm-state@1   runtime state: statuses, pay, history, chat, chat settings, ID cards, Breakroom hires
 *   swarm-job@1     one planned job of a build step: agent, model, leases, budget, wave
 *   swarm-run@1     one finished or running job (kind `build`), shared with agent jobs (kind `job`)
 *   swarm-report@1  the agent's report at the end of a run
 *
 * Pure, no I/O, no DOM. Every normalizer fills defaults and drops junk (never throws); every validator names the
 * field it refuses ({ field, code: missing|invalid, message }). Models go only through core/model-policy.mjs (Opus or
 * Fable, never Sonnet): a stored blocked model is coerced up. `axf schemas` writes the registry as
 * framework/schemas/swarm.json and the JSON Schemas as framework/schemas/json/<record>.schema.json;
 * framework/spec/check-swarm.mts replays framework/spec/fixtures/swarm.json and keeps every reader in step.
 *
 * Engines that act on these records (planner, context packer, runner tracking, chat lines, vibe filter) are not
 * contracts and live with their steps; they import the shapes from here. Kotlin twin deferred (PORTING.md).
 */

import { ALLOWED_MODELS, DEFAULT_MODEL, MODEL_TIERS, coerceModel, modelAllowed, modelProblem } from '../model-policy.mjs';

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

export const TAGS = {
  agent: 'agent@1', skill: 'agent-skill@1', roster: 'swarm-roster@1', state: 'swarm-state@1', job: 'swarm-job@1',
  run: 'swarm-run@1', report: 'swarm-report@1', runs: 'swarm-runs@1',
};

/** Statuses an agent can have. `works`: true = gets work, false = skipped, 'small' = small jobs only. */
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

export const CHAT_KINDS = ['assign', 'lease', 'report', 'handoff', 'merge', 'status', 'discipline', 'pay', 'banter', 'brett', 'session', 'handover', 'claim'];
/** Channels: the room (''), and `sessions` = the Session sync plugin's channel (session-link@1, spec/HANDOFF.md): what two Claude sessions and the orchestrator say to each other. */
export const CHAT_CHANNELS = ['', 'sessions'];
/** Work kinds are built from orchestrator messages and agent reports: no tokens. */
export const WORK_KINDS = ['assign', 'lease', 'report', 'handoff', 'merge', 'status', 'discipline', 'pay', 'brett', 'session', 'handover', 'claim'];
export const BOSS = { id: 'boss', name: 'Boss' };
export const BRETT = 'brett';

/** Vibe 1–500: 1 = straight to the point, no sarcasm; 100 = chill; 250 = full Amber; 500 = off the rails. */
export const VIBE = { min: 1, max: 500, chill: 100, amber: 250 };
export const SLIDERS = ['vibe', 'chattiness', 'cussing', 'drama'];
export const PRESETS = {
  business: { label: 'All business', vibe: 1, chattiness: 0, cussing: 0, drama: 0 },
  crew: { label: 'Work crew', vibe: 100, chattiness: 35, cussing: 30, drama: 20 },
  breakroom: { label: 'Break room', vibe: 250, chattiness: 65, cussing: 70, drama: 60 },
  rails: { label: 'Off the rails', vibe: 500, chattiness: 100, cussing: 100, drama: 100 },
};
export const DEFAULT_PRESET = 'crew';
/** Theme colours Brett can pick as the base for color-by-vibe (theme roles, never raw colours). */
export const VIBE_COLORS = ['accent', 'info', 'success', 'warning', 'danger', 'brand-1', 'brand-2', 'brand-3'];

export const AVATAR_FACES = ['round', 'square', 'tall'];
export const AVATAR_GEAR = ['none', 'glasses', 'shades', 'cap', 'beanie', 'headphones'];
/** Avatar palette: theme colours only, so every avatar follows the theme; the agent's hue picks its pair. */
export const AVATAR_TOKENS = ['--fx-brand-1', '--fx-brand-2', '--fx-brand-3', '--fx-accent', '--fx-info', '--fx-success', '--fx-warning', '--fx-danger'];

/** Identity fields an ID card shows that Brett may edit per agent (blank = the roster's value or a derived one). */
export const IDENTITY_FIELDS = ['name', 'role', 'specialty', 'photo', 'employeeId', 'email', 'hiredAt', 'catchphrase', 'signature'];
/** agent-card@1 data keys a saved design keeps (the card renderer normalizes the rest; rules in agent-card-rules.mjs). */
export const CARD_KEYS = ['design', 'orientation', 'logo', 'surface', 'accent', 'finish', 'photo', 'code', 'front', 'back', 'labels'];

/**
 * Files only the orchestrator writes, after a batch merge: shared notes, registries, catalogs and trackers. A job
 * never leases them; what it would have written there goes in its report's `notes` instead.
 */
export const SHARED_FILES = [
  '_claude/sync/', '_claude/memory/STATUS.md', '_claude/memory/decisions.md', '_claude/builds/', 'tracker.json',
  'framework/catalog/', 'framework/plan/', 'framework/catalog/plugins.json', 'CLAUDE.md', '_claude/rules/', '_claude/shared/',
];

export const RUN_KINDS = ['build', 'job'];
/** A run's status: `running` while it is out, then how it ended. */
export const RUN_STATUSES = ['running', 'done', 'failed', 'blocked', 'killed', 'error'];
export const REPORT_STATUSES = ['done', 'failed', 'blocked'];
export const LEASE_KINDS = ['files', 'area', 'all'];

export const SWARM = {
  $id: 'axf/swarm',
  tags: TAGS,
  idPattern: '^[a-z][a-z0-9-]{0,39}$',
  cardIdPattern: '^[a-z0-9][a-z0-9-]{1,47}$',
  jobIdPattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$',
  /** From model-policy@1 (one registry; never a copy that can drift). */
  models: { tiers: MODEL_TIERS, allowed: ALLOWED_MODELS, default: DEFAULT_MODEL },
  agent: {
    required: ['id', 'skill'],
    limits: { id: 40, name: 60, role: 80, skill: 40, skills: 60, home: 40, specialty: 200, keywords: 40, keyword: 40, paths: 40, path: 200, models: 4, tools: 30, tool: 120, catchphrase: 160, bio: 600, hiredAt: 40 },
    ranges: { maxTurns: [1, 200], tokenBudget: [1000, 10_000_000], salary: [0, 10000] },
    defaults: { maxTurns: 20, tokenBudget: 300000, salary: 10 },
    avatar: { faces: AVATAR_FACES, gear: AVATAR_GEAR, hair: [0, 5], hue: [0, 359], tokens: AVATAR_TOKENS },
  },
  skill: { required: ['id', 'title'], maxLines: 50, maxChars: 3000, maxFile: 20000 },
  /** `fallback`: the agent who takes a build step no skill matches ('' = the most capable agent on the roster). */
  roster: { tune: { scale: [0.25, 2], defaultScale: 1, basis: 300 }, fallback: '' },
  state: {
    statuses: STATUSES, pickable: PICKABLE, defaultRules: { rageQuitAfter: 3 }, rageQuitRange: [1, 50], smallJobMinutes: 15,
    identityFields: IDENTITY_FIELDS, cardKeys: CARD_KEYS,
    limits: { note: 300, until: 40, customName: 40, salary: 100000, topups: 100, pay: 100, bonuses: 200, history: 200, notices: 200, banterSpend: 500, hired: 50, hiredSkills: 50, designs: 50, identity: 200, photo: 600 },
  },
  chat: {
    kinds: CHAT_KINDS, workKinds: WORK_KINDS, channels: CHAT_CHANNELS, boss: BOSS, brett: BRETT, max: 2000, textMax: 1000,
    sliders: SLIDERS, vibe: VIBE, presets: PRESETS, defaultPreset: DEFAULT_PRESET, vibeColors: VIBE_COLORS,
    banterBudget: { default: 0.5, max: 1000 }, savedPresets: 30,
  },
  job: { required: ['id', 'buildId', 'stepId', 'agent', 'skill', 'model', 'leases', 'leaseKind', 'budget'], leaseKinds: LEASE_KINDS, sharedFiles: SHARED_FILES, limits: { text: 2000, estimate: 20, leases: 200, lease: 400, checks: 20, check: 300, after: 200 } },
  run: { required: ['jobId', 'agent', 'model', 'startedAt', 'status'], kinds: RUN_KINDS, statuses: RUN_STATUSES, cacheReadWeight: 0.1, keep: 5000 },
  report: { required: ['status'], statuses: REPORT_STATUSES, limits: { summary: 600, files: 200, file: 300, checks: 30, checkName: 200, notes: 2000, handoff: 1000, question: 600 } },
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

const ID_RE = new RegExp(SWARM.idPattern);
const CARD_ID_RE = new RegExp(SWARM.cardIdPattern);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, d, lo = 0, hi = Infinity) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
const list = (v, max = 40, len = 200) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, [lo, hi]) => isNum(v) && v >= lo && v <= hi;
const err = (field, code, message) => ({ field, code, message });
export const isAgentId = (v) => typeof v === 'string' && ID_RE.test(v);
export const isCardId = (v) => typeof v === 'string' && CARD_ID_RE.test(v);
export const isTimestamp = (v) => typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
/** One line for a refusal. */
export const rejection = (errors) => errors.map((e) => e.message).join('; ');

/* ------------------------------------------------------------------ */
/* agent@1                                                              */
/* ------------------------------------------------------------------ */

const A = SWARM.agent;

/** The skills list word for "every skill, including ones added later". */
export const ALL_SKILLS = '*';
/** Does the agent hold every skill in `need`? */
export const hasSkills = (agent, need) => (agent?.skills ?? []).includes(ALL_SKILLS) || (need ?? []).every((k) => k === agent?.skill || (agent?.skills ?? []).includes(k));

/** Fill defaults, drop junk, coerce models to the policy (blocked ones go up, unknown words are dropped). */
export function normAgent(a) {
  const o = isObj(a) ? a : {};
  const models = [...new Set(list(o.models, A.limits.models, 20).filter((m) => MODEL_TIERS.includes(m)).map((m) => coerceModel(m)))].sort((x, y) => MODEL_TIERS.indexOf(x) - MODEL_TIERS.indexOf(y));
  const av = isObj(o.avatar) ? o.avatar : {};
  return {
    $axf: TAGS.agent,
    id: str(o.id, A.limits.id),
    name: str(o.name, A.limits.name) || str(o.id, A.limits.id),
    role: str(o.role, A.limits.role),
    skill: str(o.skill, A.limits.skill),
    // every skill the agent can work (Brett, Nov 3 2026: all-rounders; "*" = every skill, now and later). The home
    // skill is always in it; `home` is the job type it prefers (a tie-break for the router, never exclusive)
    skills: [...new Set([str(o.skill, A.limits.skill), ...list(o.skills, A.limits.skills, A.limits.skill)].filter(Boolean))],
    home: str(o.home, A.limits.home),
    // hired for recurring job types (job-type@1) only: the build planner never hands them build steps
    jobsOnly: o.jobsOnly === true,
    specialty: str(o.specialty, A.limits.specialty),
    keywords: list(o.keywords, A.limits.keywords, A.limits.keyword).map((k) => k.toLowerCase()),
    paths: list(o.paths, A.limits.paths, A.limits.path),
    models: models.length ? models : [DEFAULT_MODEL],
    tools: list(o.tools, A.limits.tools, A.limits.tool),
    maxTurns: num(o.maxTurns, A.defaults.maxTurns, ...A.ranges.maxTurns),
    tokenBudget: num(o.tokenBudget, A.defaults.tokenBudget, ...A.ranges.tokenBudget),
    salary: num(o.salary, A.defaults.salary, ...A.ranges.salary),
    hiredAt: str(o.hiredAt, A.limits.hiredAt),
    avatar: { face: AVATAR_FACES.includes(av.face) ? av.face : 'round', hair: num(av.hair, 0, ...A.avatar.hair) | 0, gear: AVATAR_GEAR.includes(av.gear) ? av.gear : 'none', hue: num(av.hue, 0, ...A.avatar.hue) | 0 },
    catchphrase: str(o.catchphrase, A.limits.catchphrase),
    bio: str(o.bio, A.limits.bio),
  };
}

/** Problems with one agent record, each naming its field (`p` prefixes the field, e.g. `agents[2]`). */
export function agentErrors(a, p = 'agent') {
  if (!isObj(a)) return [err(p, 'invalid', `${p} must be an object`)];
  const out = [];
  const id = typeof a.id === 'string' ? a.id : '';
  if (!id) out.push(err(`${p}.id`, 'missing', `${p}.id is missing`));
  else if (!ID_RE.test(id)) out.push(err(`${p}.id`, 'invalid', `agent "${id}": id is lowercase letters, digits and dashes`));
  const who = id || '?';
  if (typeof a.skill !== 'string' || !a.skill.trim()) out.push(err(`${p}.skill`, 'missing', `agent ${who}: skill is missing`));
  if (a.models !== undefined) {
    if (!Array.isArray(a.models)) out.push(err(`${p}.models`, 'invalid', `agent ${who}: models must be a list`));
    else a.models.forEach((m, i) => { if (!modelAllowed(m)) out.push(err(`${p}.models[${i}]`, 'invalid', `agent ${who}: ${modelProblem(m)}`)); });
  }
  if (a.skills !== undefined && (!Array.isArray(a.skills) || a.skills.some((x) => typeof x !== 'string' || !(x === ALL_SKILLS || ID_RE.test(x))))) out.push(err(`${p}.skills`, 'invalid', `agent ${who}: skills must be a list of skill ids (or "${ALL_SKILLS}" for every skill)`));
  if (a.home !== undefined && (typeof a.home !== 'string' || (a.home && !ID_RE.test(a.home)))) out.push(err(`${p}.home`, 'invalid', `agent ${who}: home is a job type id`));
  if (a.tools !== undefined && !Array.isArray(a.tools)) out.push(err(`${p}.tools`, 'invalid', `agent ${who}: tools must be a list`));
  else if (!list(a.tools, A.limits.tools, A.limits.tool).length) out.push(err(`${p}.tools`, 'missing', `agent ${who}: no tools`));
  for (const k of ['keywords', 'paths']) if (a[k] !== undefined && !Array.isArray(a[k])) out.push(err(`${p}.${k}`, 'invalid', `agent ${who}: ${k} must be a list`));
  for (const [k, r] of Object.entries(A.ranges)) if (a[k] !== undefined && !inRange(a[k], r)) out.push(err(`${p}.${k}`, 'invalid', `agent ${who}: ${k} must be a number from ${r[0]} to ${r[1]}`));
  if (a.avatar !== undefined) {
    if (!isObj(a.avatar)) out.push(err(`${p}.avatar`, 'invalid', `agent ${who}: avatar must be an object`));
    else {
      if (a.avatar.face !== undefined && !AVATAR_FACES.includes(a.avatar.face)) out.push(err(`${p}.avatar.face`, 'invalid', `agent ${who}: avatar.face must be one of ${AVATAR_FACES.join(', ')}`));
      if (a.avatar.gear !== undefined && !AVATAR_GEAR.includes(a.avatar.gear)) out.push(err(`${p}.avatar.gear`, 'invalid', `agent ${who}: avatar.gear must be one of ${AVATAR_GEAR.join(', ')}`));
      if (a.avatar.hair !== undefined && !inRange(a.avatar.hair, A.avatar.hair)) out.push(err(`${p}.avatar.hair`, 'invalid', `agent ${who}: avatar.hair must be ${A.avatar.hair[0]} to ${A.avatar.hair[1]}`));
      if (a.avatar.hue !== undefined && !inRange(a.avatar.hue, A.avatar.hue)) out.push(err(`${p}.avatar.hue`, 'invalid', `agent ${who}: avatar.hue must be ${A.avatar.hue[0]} to ${A.avatar.hue[1]}`));
    }
  }
  if (a.hiredAt !== undefined && a.hiredAt !== '' && !/^\d{4}-\d{2}-\d{2}/.test(String(a.hiredAt))) out.push(err(`${p}.hiredAt`, 'invalid', `agent ${who}: hiredAt must be YYYY-MM-DD`));
  return out;
}

/* ------------------------------------------------------------------ */
/* agent-skill@1                                                        */
/* ------------------------------------------------------------------ */

/** agent-skill@1: a markdown file with `---` front matter (`$axf`, `id`, `title`) and a body under one page. */
export function parseSkill(md) {
  const text = str(md, SWARM.skill.maxFile);
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const head = {};
  if (m) for (const line of m[1].split('\n')) { const k = /^([$\w-]+):\s*(.*)$/.exec(line); if (k) head[k[1]] = k[2].trim(); }
  const body = (m ? m[2] : text).trim();
  return { id: head.id ?? '', title: head.title ?? '', schema: head.$axf ?? '', body, lines: body.split('\n').length, chars: body.length };
}

/** A skill record from parts (Breakroom hires keep theirs in the swarm state, not in a file). */
export function normSkill(s) {
  const o = isObj(s) ? s : {};
  const body = str(o.body, SWARM.skill.maxChars);
  return { id: str(o.id, A.limits.skill), title: str(o.title, 80), schema: TAGS.skill, body, lines: body ? body.split('\n').length : 0, chars: body.length };
}

export function skillErrors(s, p = 'skill') {
  if (!isObj(s)) return [err(p, 'invalid', `${p} must be an object`)];
  const out = []; const who = s.id || '?';
  if (s.schema !== TAGS.skill) out.push(err(`${p}.schema`, s.schema ? 'invalid' : 'missing', `skill ${who}: front matter needs $axf: ${TAGS.skill}`));
  if (!s.id) out.push(err(`${p}.id`, 'missing', `skill ${who}: front matter needs an id`));
  if (s.lines > SWARM.skill.maxLines || s.chars > SWARM.skill.maxChars) out.push(err(`${p}.body`, 'invalid', `skill ${who}: longer than one page (${s.lines} lines, ${s.chars} chars)`));
  return out;
}

/* ------------------------------------------------------------------ */
/* swarm-roster@1                                                       */
/* ------------------------------------------------------------------ */

export function normRoster(r) {
  const o = isObj(r) ? r : {};
  const T = SWARM.roster.tune;
  const tune = isObj(o.tune) ? { scale: num(o.tune.scale, T.defaultScale, ...T.scale), basis: str(o.tune.basis, T.basis) } : { scale: T.defaultScale, basis: '' };
  return { $axf: TAGS.roster, tune, fallback: isAgentId(o.fallback) ? o.fallback : '', agents: (Array.isArray(o.agents) ? o.agents : []).map(normAgent) };
}

/** Problems with a roster and its skills ({ id: skill }). Empty = fine. */
export function rosterErrors(roster, skills = {}) {
  if (!isObj(roster)) return [err('roster', 'invalid', 'the roster must be an object')];
  const out = [];
  if (roster.$axf !== undefined && roster.$axf !== TAGS.roster) out.push(err('$axf', 'invalid', `$axf must be ${TAGS.roster}`));
  if (roster.tune !== undefined) {
    if (!isObj(roster.tune)) out.push(err('tune', 'invalid', 'tune must be an object'));
    else if (roster.tune.scale !== undefined && !inRange(roster.tune.scale, SWARM.roster.tune.scale)) out.push(err('tune.scale', 'invalid', `tune.scale must be ${SWARM.roster.tune.scale[0]} to ${SWARM.roster.tune.scale[1]}`));
  }
  for (const [k, s] of Object.entries(isObj(skills) ? skills : {})) out.push(...skillErrors(s, `skills.${k}`));
  if (!Array.isArray(roster.agents)) { out.push(err('agents', 'missing', 'agents must be a list')); return out; }
  const seen = new Set();
  roster.agents.forEach((a, i) => {
    const p = `agents[${i}]`;
    out.push(...agentErrors(a, p));
    if (!isObj(a)) return;
    if (seen.has(a.id)) out.push(err(`${p}.id`, 'invalid', `agent "${a.id}" is listed twice`));
    seen.add(a.id);
    if (typeof a.skill === 'string' && a.skill && !skills[a.skill]) out.push(err(`${p}.skill`, 'invalid', `agent ${a.id}: no skill file for "${a.skill}"`));
  });
  if (roster.fallback !== undefined && roster.fallback !== '' && !roster.agents.some((a) => isObj(a) && a.id === roster.fallback)) out.push(err('fallback', 'invalid', `fallback "${roster.fallback}" is not an agent on the roster`));
  return out;
}

/* ------------------------------------------------------------------ */
/* swarm-state@1                                                        */
/* ------------------------------------------------------------------ */

const S = SWARM.state; const C = SWARM.chat;
const slider = (v, d, max = 100) => Math.round(num(v, d, 0, max));

export function normAgentState(s) {
  const o = isObj(s) ? s : {};
  const L = S.limits;
  return {
    status: Object.hasOwn(STATUSES, o.status) ? o.status : 'on-duty',
    note: str(o.note, L.note),
    until: str(o.until, L.until),
    custom: { name: str(o.custom?.name, L.customName), works: o.custom?.works === true },
    // salary = the weekly token budget in dollars (replaced the plain spend cap: an old cap becomes the salary); null = the roster's
    salary: Number.isFinite(Number(o.salary)) && o.salary !== null && o.salary !== '' ? num(o.salary, 0, 0, L.salary) : Number(o.cap) > 0 ? num(o.cap, 0, 0, L.salary) : null,
    topups: (Array.isArray(o.topups) ? o.topups : []).slice(-L.topups).map((x) => ({ at: str(x?.at, 40), usd: num(x?.usd, 0, 0, L.salary) })),
    pay: (Array.isArray(o.pay) ? o.pay : []).slice(-L.pay).map((x) => ({ at: str(x?.at, 40), kind: x?.kind === 'dock' ? 'dock' : 'raise', from: num(x?.from, 0), to: num(x?.to, 0), note: str(x?.note, 200) })),
    bonuses: (Array.isArray(o.bonuses) ? o.bonuses : []).slice(-L.bonuses).map((x) => ({ at: str(x?.at, 40), jobId: str(x?.jobId, 120), usd: num(x?.usd, 0) })),
    brokeSaid: str(o.brokeSaid, 40),
    failStreak: num(o.failStreak, 0, 0, 1000) | 0,
    history: (Array.isArray(o.history) ? o.history : []).slice(-L.history).map((h) => ({ at: str(h?.at, 40), from: str(h?.from, 40), to: str(h?.to, 40), note: str(h?.note, L.note), by: str(h?.by, 40) || BRETT })),
    // ID card: identity fields Brett edited (blank = the roster's) and a per-agent card design ('' = the default design)
    identity: Object.fromEntries(IDENTITY_FIELDS.map((k) => [k, str(o.identity?.[k], k === 'photo' ? L.photo : L.identity).trim()])),
    card: isCardId(str(o.card, 48)) ? str(o.card, 48) : '',
  };
}

export function normChat(c) {
  const o = isObj(c) ? c : {};
  return { enabled: o.enabled !== false, agents: Object.fromEntries(Object.entries(isObj(o.agents) ? o.agents : {}).map(([k, v]) => [str(k, 40), v !== false])) };
}

/** One chat message. Unknown kinds read as banter (the cheap kind); `vibe` and `toned` are set by the vibe filter. */
export const normMessage = (m, i = 0) => ({ id: str(m?.id, 40) || `m${i}`, at: str(m?.at, 40), from: str(m?.from, 40), kind: CHAT_KINDS.includes(m?.kind) ? m.kind : 'banter', text: str(m?.text, C.textMax), jobId: str(m?.jobId, 120), vibe: Number.isFinite(m?.vibe) ? m.vibe : null, toned: m?.toned === true, ...(CHAT_CHANNELS.includes(m?.channel) && m.channel ? { channel: m.channel } : {}) });

const sliderVals = (v, d) => ({ vibe: Math.round(num(v?.vibe, d.vibe, VIBE.min, VIBE.max)), chattiness: slider(v?.chattiness, d.chattiness), cussing: slider(v?.cussing, d.cussing), drama: slider(v?.drama, d.drama) });

export function normChatSettings(o) {
  const x = isObj(o) ? o : {};
  const base = PRESETS[DEFAULT_PRESET];
  const overrides = {};
  for (const [k, v] of Object.entries(isObj(x.overrides) ? x.overrides : {})) {
    const o2 = {}; for (const s of SLIDERS) if (v && v[s] != null && Number.isFinite(Number(v[s]))) o2[s] = s === 'vibe' ? Math.round(num(v[s], VIBE.chill, VIBE.min, VIBE.max)) : slider(v[s], 50);
    if (Object.keys(o2).length) overrides[str(k, 40)] = o2;
  }
  return {
    ...sliderVals(x, base), preset: str(x.preset, 40) || DEFAULT_PRESET, overrides,
    banterBudget: num(x.banterBudget, C.banterBudget.default, 0, C.banterBudget.max),
    saved: (Array.isArray(x.saved) ? x.saved : []).slice(0, C.savedPresets).map((p) => ({ name: str(p?.name, 40), ...sliderVals(p, base) })).filter((p) => p.name),
  };
}

/** A saved card design, kept as an asset@1 envelope; data keeps only the agent-card keys (the renderer normalizes the rest). */
export function normCardDesign(d) {
  const o = isObj(d) ? d : {};
  const raw = isObj(o.data) ? o.data : {};
  const data = {};
  for (const k of CARD_KEYS) {
    const v = raw[k];
    if (k === 'front' || k === 'back') { if (Array.isArray(v)) data[k] = list(v, 12, 24); }
    else if (k === 'labels') { if (isObj(v)) data[k] = Object.fromEntries(Object.entries(v).slice(0, 13).map(([lk, lv]) => [str(lk, 24), str(lv, 24)]).filter(([lk, lv]) => lk && lv)); }
    else if (typeof v === 'string') data[k] = str(v, 24);
  }
  return { $axf: 'asset@1', type: 'agent-card', id: str(o.id, 48), name: str(o.name, 60) || str(o.id, 48), version: str(o.version, 20) || '1.0.0', author: str(o.author, 60) || 'Brett', data };
}
export function normCards(c) {
  const o = isObj(c) ? c : {};
  return { default: isCardId(str(o.default, 48)) ? str(o.default, 48) : '', designs: (Array.isArray(o.designs) ? o.designs : []).slice(0, S.limits.designs).map(normCardDesign).filter((d) => isCardId(d.id)) };
}

export function normState(s, roster) {
  const o = isObj(s) ? s : {};
  const L = S.limits;
  const agents = {};
  for (const a of roster?.agents ?? []) agents[a.id] = normAgentState(o.agents?.[a.id]);
  for (const [k, v] of Object.entries(isObj(o.agents) ? o.agents : {})) if (!agents[k]) agents[k] = normAgentState(v); // keep history of agents taken off the roster
  const rules = { rageQuitAfter: num(o.rules?.rageQuitAfter, S.defaultRules.rageQuitAfter, ...S.rageQuitRange) | 0 };
  return {
    $axf: TAGS.state, updatedAt: str(o.updatedAt, 40), rules, agents, chat: normChat(o.chat), chatSettings: normChatSettings(o.chatSettings),
    messages: (Array.isArray(o.messages) ? o.messages : []).slice(-C.max).map(normMessage),
    banterSpend: (Array.isArray(o.banterSpend) ? o.banterSpend : []).slice(-L.banterSpend).map((b) => ({ at: str(b?.at, 40), usd: Number(b?.usd) || 0 })),
    notices: (Array.isArray(o.notices) ? o.notices : []).slice(-L.notices).map((n) => ({ at: str(n?.at, 40), agent: str(n?.agent, 40), text: str(n?.text, 400) })),
    cards: normCards(o.cards),
    // one-tap hires for job types (agent-jobs): agents and their skill pages, kept here (the roster file is hand-kept)
    hired: (Array.isArray(o.hired) ? o.hired : []).slice(0, L.hired).map(normAgent).filter((a) => isAgentId(a.id)),
    hiredSkills: Object.fromEntries(Object.entries(isObj(o.hiredSkills) ? o.hiredSkills : {}).slice(0, L.hiredSkills).map(([k, v]) => [str(k, 40), { id: str(k, 40), title: str(v?.title, 80), body: str(v?.body, SWARM.skill.maxChars) }])),
  };
}

export function stateErrors(s) {
  if (!isObj(s)) return [err('state', 'invalid', 'the swarm state must be an object')];
  const out = [];
  if (s.$axf !== undefined && s.$axf !== TAGS.state) out.push(err('$axf', 'invalid', `$axf must be ${TAGS.state}`));
  if (s.updatedAt !== undefined && s.updatedAt !== '' && !isTimestamp(s.updatedAt)) out.push(err('updatedAt', 'invalid', 'updatedAt must be an ISO timestamp'));
  if (s.rules !== undefined && (!isObj(s.rules) || (s.rules.rageQuitAfter !== undefined && !inRange(s.rules.rageQuitAfter, S.rageQuitRange)))) out.push(err('rules.rageQuitAfter', 'invalid', `rules.rageQuitAfter must be ${S.rageQuitRange[0]} to ${S.rageQuitRange[1]}`));
  if (s.agents !== undefined) {
    if (!isObj(s.agents)) out.push(err('agents', 'invalid', 'agents must map agent ids to their state'));
    else for (const [id, as] of Object.entries(s.agents)) {
      const p = `agents.${id}`;
      if (!isObj(as)) { out.push(err(p, 'invalid', `${p} must be an object`)); continue; }
      if (as.status !== undefined && !Object.hasOwn(STATUSES, as.status)) out.push(err(`${p}.status`, 'invalid', `${p}.status must be one of ${Object.keys(STATUSES).join(', ')}`));
      if (as.status === 'custom' && !str(as.custom?.name, S.limits.customName).trim()) out.push(err(`${p}.custom.name`, 'missing', `${p}: a custom status needs a name`));
      if (['medical-leave', 'suspended'].includes(as.status) && as.until && !isTimestamp(as.until)) out.push(err(`${p}.until`, 'invalid', `${p}.until must be an ISO timestamp`));
      if (as.salary !== undefined && as.salary !== null && !inRange(Number(as.salary), [0, S.limits.salary])) out.push(err(`${p}.salary`, 'invalid', `${p}.salary must be 0 to ${S.limits.salary}`));
      if (as.card !== undefined && as.card !== '' && !isCardId(as.card)) out.push(err(`${p}.card`, 'invalid', `${p}.card is not a card design id`));
      for (const k of ['topups', 'pay', 'bonuses', 'history']) if (as[k] !== undefined && !Array.isArray(as[k])) out.push(err(`${p}.${k}`, 'invalid', `${p}.${k} must be a list`));
    }
  }
  if (s.chat !== undefined && !isObj(s.chat)) out.push(err('chat', 'invalid', 'chat must be an object'));
  if (s.chatSettings !== undefined) {
    if (!isObj(s.chatSettings)) out.push(err('chatSettings', 'invalid', 'chatSettings must be an object'));
    else {
      const cs = s.chatSettings;
      if (cs.vibe !== undefined && !inRange(cs.vibe, [VIBE.min, VIBE.max])) out.push(err('chatSettings.vibe', 'invalid', `chatSettings.vibe must be ${VIBE.min} to ${VIBE.max}`));
      for (const k of ['chattiness', 'cussing', 'drama']) if (cs[k] !== undefined && !inRange(cs[k], [0, 100])) out.push(err(`chatSettings.${k}`, 'invalid', `chatSettings.${k} must be 0 to 100`));
      if (cs.preset !== undefined && typeof cs.preset !== 'string') out.push(err('chatSettings.preset', 'invalid', 'chatSettings.preset must be a preset name'));
      if (cs.banterBudget !== undefined && !inRange(cs.banterBudget, [0, C.banterBudget.max])) out.push(err('chatSettings.banterBudget', 'invalid', `chatSettings.banterBudget must be 0 to ${C.banterBudget.max}`));
      if (cs.overrides !== undefined && !isObj(cs.overrides)) out.push(err('chatSettings.overrides', 'invalid', 'chatSettings.overrides must map agent ids to sliders'));
    }
  }
  if (s.messages !== undefined) {
    if (!Array.isArray(s.messages)) out.push(err('messages', 'invalid', 'messages must be a list'));
    else s.messages.forEach((m, i) => {
      if (!isObj(m)) { out.push(err(`messages[${i}]`, 'invalid', `messages[${i}] must be an object`)); return; }
      if (m.kind !== undefined && !CHAT_KINDS.includes(m.kind)) out.push(err(`messages[${i}].kind`, 'invalid', `messages[${i}].kind must be one of ${CHAT_KINDS.join(', ')}`));
      if (typeof m.text !== 'string' || !m.text) out.push(err(`messages[${i}].text`, 'missing', `messages[${i}].text is missing`));
      if (typeof m.from !== 'string' || !m.from) out.push(err(`messages[${i}].from`, 'missing', `messages[${i}].from is missing`));
    });
  }
  if (s.cards !== undefined) {
    if (!isObj(s.cards)) out.push(err('cards', 'invalid', 'cards must be an object'));
    else {
      if (s.cards.default !== undefined && s.cards.default !== '' && !isCardId(s.cards.default)) out.push(err('cards.default', 'invalid', 'cards.default is not a card design id'));
      if (s.cards.designs !== undefined && !Array.isArray(s.cards.designs)) out.push(err('cards.designs', 'invalid', 'cards.designs must be a list'));
      else (s.cards.designs ?? []).forEach((d, i) => { if (!isObj(d) || !isCardId(d.id)) out.push(err(`cards.designs[${i}].id`, 'invalid', `cards.designs[${i}].id is not a card design id`)); });
    }
  }
  if (s.hired !== undefined) {
    if (!Array.isArray(s.hired)) out.push(err('hired', 'invalid', 'hired must be a list of agents'));
    else s.hired.forEach((a, i) => out.push(...agentErrors(a, `hired[${i}]`)));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* swarm-job@1                                                          */
/* ------------------------------------------------------------------ */

const J = SWARM.job;

export function normJob(j) {
  const o = isObj(j) ? j : {};
  const b = isObj(o.budget) ? o.budget : {};
  return {
    $axf: TAGS.job, id: str(o.id, 120), buildId: str(o.buildId, 80), stepId: str(o.stepId, 40), text: str(o.text, J.limits.text), estimate: str(o.estimate, J.limits.estimate),
    agent: str(o.agent, A.limits.id), skill: str(o.skill, A.limits.skill), tier: coerceModel(o.tier), model: coerceModel(o.model), match: num(o.match, 0, 0, 10000),
    leases: list(o.leases, J.limits.leases, J.limits.lease), leaseKind: LEASE_KINDS.includes(o.leaseKind) ? o.leaseKind : 'all', shared: list(o.shared, J.limits.leases, J.limits.lease),
    budget: { tokens: num(b.tokens, A.defaults.tokenBudget, ...A.ranges.tokenBudget) | 0, maxTurns: num(b.maxTurns, A.defaults.maxTurns, ...A.ranges.maxTurns) | 0 },
    checks: list(o.checks, J.limits.checks, J.limits.check), wave: num(o.wave, 0, 0, 10000) | 0, after: list(o.after, J.limits.after, 120),
    ...(o.fixes ? { fixes: str(o.fixes, 120) } : {}),
  };
}

export function jobErrors(j, p = 'job') {
  if (!isObj(j)) return [err(p, 'invalid', `${p} must be an object`)];
  const out = [];
  if (j.$axf !== undefined && j.$axf !== TAGS.job) out.push(err(`${p}.$axf`, 'invalid', `${p}.$axf must be ${TAGS.job}`));
  for (const k of ['id', 'buildId', 'stepId', 'agent', 'skill']) if (typeof j[k] !== 'string' || !j[k]) out.push(err(`${p}.${k}`, 'missing', `${p}.${k} is missing`));
  if (typeof j.agent === 'string' && j.agent && !ID_RE.test(j.agent)) out.push(err(`${p}.agent`, 'invalid', `${p}.agent is not an agent id`));
  if (!modelAllowed(j.model)) out.push(err(`${p}.model`, j.model === undefined ? 'missing' : 'invalid', `${p}.model: ${j.model === undefined ? 'missing' : modelProblem(j.model)}`));
  if (!Array.isArray(j.leases)) out.push(err(`${p}.leases`, 'missing', `${p}.leases must be a list of paths`));
  if (!LEASE_KINDS.includes(j.leaseKind)) out.push(err(`${p}.leaseKind`, j.leaseKind === undefined ? 'missing' : 'invalid', `${p}.leaseKind must be one of ${LEASE_KINDS.join(', ')}`));
  if (!isObj(j.budget)) out.push(err(`${p}.budget`, 'missing', `${p}.budget must give tokens and maxTurns`));
  else {
    if (!inRange(j.budget.tokens, A.ranges.tokenBudget)) out.push(err(`${p}.budget.tokens`, 'invalid', `${p}.budget.tokens must be ${A.ranges.tokenBudget[0]} to ${A.ranges.tokenBudget[1]}`));
    if (!inRange(j.budget.maxTurns, A.ranges.maxTurns)) out.push(err(`${p}.budget.maxTurns`, 'invalid', `${p}.budget.maxTurns must be ${A.ranges.maxTurns[0]} to ${A.ranges.maxTurns[1]}`));
  }
  if (j.wave !== undefined && !(Number.isInteger(j.wave) && j.wave >= 0)) out.push(err(`${p}.wave`, 'invalid', `${p}.wave must be a whole number`));
  if (j.after !== undefined && !Array.isArray(j.after)) out.push(err(`${p}.after`, 'invalid', `${p}.after must be a list of job ids`));
  return out;
}

/* ------------------------------------------------------------------ */
/* swarm-report@1                                                       */
/* ------------------------------------------------------------------ */

const R = SWARM.report;

export function normReport(r) {
  const o = isObj(r) ? r : {};
  return {
    $axf: TAGS.report, status: REPORT_STATUSES.includes(o.status) ? o.status : 'failed', summary: str(o.summary, R.limits.summary), files: list(o.files, R.limits.files, R.limits.file),
    checks: (Array.isArray(o.checks) ? o.checks : []).slice(0, R.limits.checks).map((x) => ({ name: str(x?.name, R.limits.checkName), ok: x?.ok === true })),
    notes: str(o.notes, R.limits.notes), handoff: str(o.handoff, R.limits.handoff), question: str(o.question, R.limits.question),
  };
}

export function reportErrors(r, p = 'report') {
  if (!isObj(r)) return [err(p, 'invalid', `${p} must be an object`)];
  const out = [];
  if (r.$axf !== undefined && r.$axf !== TAGS.report) out.push(err(`${p}.$axf`, 'invalid', `${p}.$axf must be ${TAGS.report}`));
  if (!REPORT_STATUSES.includes(r.status)) out.push(err(`${p}.status`, r.status === undefined ? 'missing' : 'invalid', `${p}.status must be one of ${REPORT_STATUSES.join(', ')}`));
  if (r.summary !== undefined && typeof r.summary !== 'string') out.push(err(`${p}.summary`, 'invalid', `${p}.summary must be text`));
  if (r.files !== undefined && !Array.isArray(r.files)) out.push(err(`${p}.files`, 'invalid', `${p}.files must be a list of paths`));
  if (r.checks !== undefined) {
    if (!Array.isArray(r.checks)) out.push(err(`${p}.checks`, 'invalid', `${p}.checks must be a list of { name, ok }`));
    else r.checks.forEach((c, i) => { if (!isObj(c) || typeof c.name !== 'string' || typeof c.ok !== 'boolean') out.push(err(`${p}.checks[${i}]`, 'invalid', `${p}.checks[${i}] must be { name, ok }`)); });
  }
  for (const k of ['notes', 'handoff', 'question']) if (r[k] !== undefined && typeof r[k] !== 'string') out.push(err(`${p}.${k}`, 'invalid', `${p}.${k} must be text`));
  if (r.status === 'blocked' && !str(r.question, R.limits.question).trim()) out.push(err(`${p}.question`, 'missing', `${p}: a blocked report carries the exact question`));
  return out;
}

/** The agent's swarm-report@1 from its final message: the last fenced json block whose status is a report status. */
export function parseReport(text) {
  const blocks = [...str(text, 200000).matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const m of blocks.reverse()) {
    try { const r = JSON.parse(m[1]); if (isObj(r) && REPORT_STATUSES.includes(r.status)) return normReport(r); }
    catch { /* try the one before */ }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* swarm-run@1 (kind build: the swarm runner; kind job: agent jobs)     */
/* ------------------------------------------------------------------ */

export const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const normUsage = (u) => (isObj(u) ? { input: num(u.input, 0), output: num(u.output, 0), cacheRead: num(u.cacheRead, 0), cacheWrite: num(u.cacheWrite, 0) } : null);
/** Tokens charged against a job's budget: cache reads cost about a tenth of fresh input. */
export const budgetTokens = (u) => (u ? Math.round(u.input + u.output + u.cacheWrite + u.cacheRead * SWARM.run.cacheReadWeight) : 0);

/**
 * Normalize a run record. Core fields are the same for both kinds; the launch and bookkeeping fields (worktree,
 * session, log, queue position…) are kept when present, as strings, numbers, booleans or small objects.
 */
export function normRun(r) {
  const o = isObj(r) ? r : {};
  const kind = RUN_KINDS.includes(o.kind) ? o.kind : 'build';
  const b = isObj(o.budget) ? o.budget : {};
  const usage = normUsage(o.usage);
  const out = {
    $axf: TAGS.run, kind, jobId: str(o.jobId, 120), buildId: str(o.buildId, 80), stepId: str(o.stepId, 40), agent: str(o.agent, A.limits.id), model: coerceModel(o.model),
    startedAt: str(o.startedAt, 40), endedAt: str(o.endedAt, 40), status: RUN_STATUSES.includes(o.status) ? o.status : 'error', reason: str(o.reason, 400),
    report: isObj(o.report) ? normReport(o.report) : null, usage, budgetTokens: o.budgetTokens !== undefined ? num(o.budgetTokens, 0) | 0 : budgetTokens(usage),
    budget: { tokens: num(b.tokens, 0, 0, A.ranges.tokenBudget[1]) | 0, maxTurns: num(b.maxTurns, 0, 0, A.ranges.maxTurns[1]) | 0 }, turns: num(o.turns, 0, 0, 100000) | 0,
    reportedCost: isNum(o.reportedCost) ? o.reportedCost : null,
  };
  if (kind === 'job') out.jobType = str(o.jobType, 80);
  for (const k of ['cwd', 'branch', 'worktree', 'session', 'tmux', 'log', 'briefFile', 'reportPath', 'reportFile', 'group', 'build', 'source']) if (typeof o[k] === 'string') out[k] = o[k].slice(0, 600);
  if (typeof o.forced === 'boolean') out.forced = o.forced; // booked with nobody free (claude-headless.sh launches)
  if (isObj(o.lease)) out.lease = { ok: o.lease.ok !== false, outside: list(o.lease.outside, 500, 400), shared: list(o.lease.shared, 500, 400), files: list(o.lease.files, 5000, 400) };
  if (isObj(o.inputs)) out.inputs = Object.fromEntries(Object.entries(o.inputs).slice(0, 40).map(([k, v]) => [str(k, 40), str(String(v ?? ''), 2000)]));
  if (isNum(o.briefTokens)) out.briefTokens = o.briefTokens | 0;
  if (isObj(o.queued)) out.queued = { position: num(o.queued.position, 0) | 0, id: str(o.queued.id, 80) }; else if (o.queued === null) out.queued = null;
  return out;
}

export function runErrors(r, p = 'run') {
  if (!isObj(r)) return [err(p, 'invalid', `${p} must be an object`)];
  const out = [];
  if (r.$axf !== undefined && r.$axf !== TAGS.run) out.push(err(`${p}.$axf`, 'invalid', `${p}.$axf must be ${TAGS.run}`));
  if (r.kind !== undefined && !RUN_KINDS.includes(r.kind)) out.push(err(`${p}.kind`, 'invalid', `${p}.kind must be one of ${RUN_KINDS.join(', ')}`));
  for (const k of ['jobId', 'agent']) if (typeof r[k] !== 'string' || !r[k]) out.push(err(`${p}.${k}`, 'missing', `${p}.${k} is missing`));
  if (r.kind === 'job' && (typeof r.jobType !== 'string' || !r.jobType)) out.push(err(`${p}.jobType`, 'missing', `${p}.jobType is missing (a job run names its job type)`));
  if (!modelAllowed(r.model)) out.push(err(`${p}.model`, r.model === undefined ? 'missing' : 'invalid', `${p}.model: ${r.model === undefined ? 'missing' : modelProblem(r.model)}`));
  if (!isTimestamp(r.startedAt)) out.push(err(`${p}.startedAt`, r.startedAt === undefined ? 'missing' : 'invalid', `${p}.startedAt must be an ISO timestamp`));
  if (r.endedAt !== undefined && r.endedAt !== '' && !isTimestamp(r.endedAt)) out.push(err(`${p}.endedAt`, 'invalid', `${p}.endedAt must be an ISO timestamp or ""`));
  if (!RUN_STATUSES.includes(r.status)) out.push(err(`${p}.status`, r.status === undefined ? 'missing' : 'invalid', `${p}.status must be one of ${RUN_STATUSES.join(', ')}`));
  if (r.status !== 'running' && r.endedAt !== undefined && r.endedAt === '') out.push(err(`${p}.endedAt`, 'missing', `${p}: a finished run has an endedAt`));
  if (r.report !== undefined && r.report !== null) out.push(...reportErrors(r.report, `${p}.report`));
  if (r.usage !== undefined && r.usage !== null && (!isObj(r.usage) || ['input', 'output', 'cacheRead', 'cacheWrite'].some((k) => r.usage[k] !== undefined && !isNum(r.usage[k])))) out.push(err(`${p}.usage`, 'invalid', `${p}.usage must give input, output, cacheRead and cacheWrite token counts`));
  if (r.budget !== undefined && !isObj(r.budget)) out.push(err(`${p}.budget`, 'invalid', `${p}.budget must give tokens and maxTurns`));
  if (r.reportedCost !== undefined && r.reportedCost !== null && !isNum(r.reportedCost)) out.push(err(`${p}.reportedCost`, 'invalid', `${p}.reportedCost must be a number or null`));
  return out;
}

/* ------------------------------------------------------------------ */
/* One front door                                                       */
/* ------------------------------------------------------------------ */

const BY_TAG = {
  [TAGS.agent]: { norm: normAgent, errors: (v) => agentErrors(v, 'agent') },
  [TAGS.skill]: { norm: normSkill, errors: (v) => skillErrors(v, 'skill') },
  [TAGS.roster]: { norm: normRoster, errors: (v, ctx) => rosterErrors(v, ctx?.skills) },
  [TAGS.state]: { norm: (v, ctx) => normState(v, ctx?.roster), errors: stateErrors },
  [TAGS.job]: { norm: normJob, errors: (v) => jobErrors(v, 'job') },
  [TAGS.run]: { norm: normRun, errors: (v) => runErrors(v, 'run') },
  [TAGS.report]: { norm: normReport, errors: (v) => reportErrors(v, 'report') },
};

/** Problems with any swarm record by its tag ([] for a good one; one error for an unknown tag). */
export function swarmErrors(tag, value, ctx) {
  const h = BY_TAG[tag];
  return h ? h.errors(value, ctx) : [err('$axf', 'invalid', `"${tag}" is not a swarm record (${Object.values(TAGS).filter((t) => BY_TAG[t]).join(', ')})`)];
}
/** Normalize any swarm record by its tag (throws on an unknown tag: that is a programming error, not bad data). */
export function normSwarm(tag, value, ctx) {
  const h = BY_TAG[tag];
  if (!h) throw new Error(`"${tag}" is not a swarm record`);
  return h.norm(value, ctx);
}

/* ------------------------------------------------------------------ */
/* JSON Schemas (written by `axf schemas`)                              */
/* ------------------------------------------------------------------ */

export function jsonSchemas() {
  const ts = { type: 'string', format: 'date-time', pattern: ISO_RE.source };
  const tsOrBlank = { anyOf: [ts, { const: '' }] };
  const strList = (max, len) => ({ type: 'array', maxItems: max, items: { type: 'string', maxLength: len } });
  const rng = ([lo, hi]) => ({ type: 'number', minimum: lo, maximum: hi });
  const head = (name, tag, title, description) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `axf/${name}.schema.json`, title: `AmberX AXF ${title} (${tag})`, description: `Generated from framework/core/engines/swarm-rules.mjs. ${description}` });
  const agent = {
    ...head('agent', TAGS.agent, 'swarm agent', 'One specialist agent on the swarm roster.'),
    type: 'object', required: A.required,
    properties: {
      $axf: { const: TAGS.agent }, id: { type: 'string', pattern: SWARM.idPattern }, name: { type: 'string', maxLength: A.limits.name }, role: { type: 'string', maxLength: A.limits.role },
      skill: { type: 'string', maxLength: A.limits.skill }, skills: strList(A.limits.skills, A.limits.skill), home: { type: 'string', maxLength: A.limits.home }, jobsOnly: { type: 'boolean' }, specialty: { type: 'string', maxLength: A.limits.specialty },
      keywords: strList(A.limits.keywords, A.limits.keyword), paths: strList(A.limits.paths, A.limits.path), models: { type: 'array', maxItems: A.limits.models, items: { enum: ALLOWED_MODELS } },
      tools: strList(A.limits.tools, A.limits.tool), maxTurns: rng(A.ranges.maxTurns), tokenBudget: rng(A.ranges.tokenBudget), salary: rng(A.ranges.salary), hiredAt: { type: 'string' },
      avatar: { type: 'object', properties: { face: { enum: AVATAR_FACES }, hair: rng(A.avatar.hair), gear: { enum: AVATAR_GEAR }, hue: rng(A.avatar.hue) } },
      catchphrase: { type: 'string', maxLength: A.limits.catchphrase }, bio: { type: 'string', maxLength: A.limits.bio },
    },
  };
  const skill = {
    ...head('agent-skill', TAGS.skill, 'agent skill page', 'The parsed form of an agent\'s one-page skill file (markdown with front matter).'),
    type: 'object', required: ['id', 'title', 'schema', 'body'],
    properties: { id: { type: 'string', maxLength: A.limits.skill }, title: { type: 'string' }, schema: { const: TAGS.skill }, body: { type: 'string', maxLength: SWARM.skill.maxChars }, lines: { type: 'integer', maximum: SWARM.skill.maxLines }, chars: { type: 'integer', maximum: SWARM.skill.maxChars } },
  };
  const roster = {
    ...head('swarm-roster', TAGS.roster, 'swarm roster', 'The agents and the budget tune.'),
    type: 'object', required: ['agents'],
    properties: { $axf: { const: TAGS.roster }, about: { type: 'string' }, tune: { type: 'object', properties: { scale: rng(SWARM.roster.tune.scale), basis: { type: 'string', maxLength: SWARM.roster.tune.basis } } }, fallback: { anyOf: [{ type: 'string', pattern: SWARM.idPattern }, { const: '' }] }, agents: { type: 'array', items: { $ref: 'axf/agent.schema.json' } } },
  };
  const sliders = { vibe: rng([VIBE.min, VIBE.max]), chattiness: rng([0, 100]), cussing: rng([0, 100]), drama: rng([0, 100]) };
  const stamped = (props) => ({ type: 'object', properties: { at: { type: 'string' }, ...props } });
  const agentState = {
    type: 'object',
    properties: {
      status: { enum: Object.keys(STATUSES) }, note: { type: 'string', maxLength: S.limits.note }, until: tsOrBlank, custom: { type: 'object', properties: { name: { type: 'string', maxLength: S.limits.customName }, works: { type: 'boolean' } } },
      salary: { anyOf: [rng([0, S.limits.salary]), { type: 'null' }] }, topups: { type: 'array', items: stamped({ usd: { type: 'number' } }) },
      pay: { type: 'array', items: stamped({ kind: { enum: ['raise', 'dock'] }, from: { type: 'number' }, to: { type: 'number' }, note: { type: 'string' } }) },
      bonuses: { type: 'array', items: stamped({ jobId: { type: 'string' }, usd: { type: 'number' } }) }, brokeSaid: { type: 'string' }, failStreak: { type: 'integer', minimum: 0 },
      history: { type: 'array', items: stamped({ from: { type: 'string' }, to: { type: 'string' }, note: { type: 'string' }, by: { type: 'string' } }) },
      identity: { type: 'object', propertyNames: { enum: IDENTITY_FIELDS }, additionalProperties: { type: 'string' } }, card: { anyOf: [{ type: 'string', pattern: SWARM.cardIdPattern }, { const: '' }] },
    },
  };
  const message = { type: 'object', required: ['from', 'kind', 'text'], properties: { id: { type: 'string' }, at: { type: 'string' }, from: { type: 'string' }, kind: { enum: CHAT_KINDS }, text: { type: 'string', maxLength: C.textMax }, jobId: { type: 'string' }, vibe: { anyOf: [rng([VIBE.min, VIBE.max]), { type: 'null' }] }, toned: { type: 'boolean' }, channel: { enum: CHAT_CHANNELS.filter(Boolean) } } };
  const state = {
    ...head('swarm-state', TAGS.state, 'swarm runtime state', 'Statuses, pay, history, chat, chat settings, ID cards and Breakroom hires.'),
    type: 'object', required: ['agents'],
    properties: {
      $axf: { const: TAGS.state }, updatedAt: tsOrBlank, rules: { type: 'object', properties: { rageQuitAfter: rng(S.rageQuitRange) } },
      agents: { type: 'object', additionalProperties: agentState },
      chat: { type: 'object', properties: { enabled: { type: 'boolean' }, agents: { type: 'object', additionalProperties: { type: 'boolean' } } } },
      chatSettings: { type: 'object', properties: { ...sliders, preset: { type: 'string' }, overrides: { type: 'object', additionalProperties: { type: 'object', properties: sliders } }, banterBudget: rng([0, C.banterBudget.max]), saved: { type: 'array', maxItems: C.savedPresets, items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, ...sliders } } } } },
      messages: { type: 'array', maxItems: C.max, items: message },
      banterSpend: { type: 'array', items: stamped({ usd: { type: 'number' } }) }, notices: { type: 'array', items: stamped({ agent: { type: 'string' }, text: { type: 'string' } }) },
      cards: { type: 'object', properties: { default: { anyOf: [{ type: 'string', pattern: SWARM.cardIdPattern }, { const: '' }] }, designs: { type: 'array', maxItems: S.limits.designs, items: { $ref: 'axf/agent-card.schema.json' } } } },
      hired: { type: 'array', maxItems: S.limits.hired, items: { $ref: 'axf/agent.schema.json' } },
      hiredSkills: { type: 'object', additionalProperties: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string', maxLength: SWARM.skill.maxChars } } } },
    },
  };
  const budget = { type: 'object', required: ['tokens', 'maxTurns'], properties: { tokens: rng(A.ranges.tokenBudget), maxTurns: rng(A.ranges.maxTurns) } };
  const job = {
    ...head('swarm-job', TAGS.job, 'planned swarm job', 'One build step planned for one agent: model, leases, budget and its place in the waves.'),
    type: 'object', required: J.required,
    properties: {
      $axf: { const: TAGS.job }, id: { type: 'string' }, buildId: { type: 'string' }, stepId: { type: 'string' }, text: { type: 'string', maxLength: J.limits.text }, estimate: { type: 'string' },
      agent: { type: 'string', pattern: SWARM.idPattern }, skill: { type: 'string' }, tier: { enum: ALLOWED_MODELS }, model: { enum: ALLOWED_MODELS }, match: { type: 'number' },
      leases: strList(J.limits.leases, J.limits.lease), leaseKind: { enum: LEASE_KINDS }, shared: strList(J.limits.leases, J.limits.lease), budget, checks: strList(J.limits.checks, J.limits.check),
      wave: { type: 'integer', minimum: 0 }, after: strList(J.limits.after, 120), fixes: { type: 'string' },
    },
  };
  const report = {
    ...head('swarm-report', TAGS.report, 'agent report', 'What an agent reports at the end of a run (the last fenced json block of its final message).'),
    type: 'object', required: R.required,
    properties: {
      $axf: { const: TAGS.report }, status: { enum: REPORT_STATUSES }, summary: { type: 'string', maxLength: R.limits.summary }, files: strList(R.limits.files, R.limits.file),
      checks: { type: 'array', maxItems: R.limits.checks, items: { type: 'object', required: ['name', 'ok'], properties: { name: { type: 'string', maxLength: R.limits.checkName }, ok: { type: 'boolean' } } } },
      notes: { type: 'string', maxLength: R.limits.notes }, handoff: { type: 'string', maxLength: R.limits.handoff }, question: { type: 'string', maxLength: R.limits.question },
    },
  };
  const usage = { anyOf: [{ type: 'object', properties: { input: { type: 'number' }, output: { type: 'number' }, cacheRead: { type: 'number' }, cacheWrite: { type: 'number' } } }, { type: 'null' }] };
  const run = {
    ...head('swarm-run', TAGS.run, 'swarm run', 'One run of a job: a build step by the swarm runner (kind build) or a job type by a hired agent (kind job).'),
    type: 'object', required: SWARM.run.required,
    properties: {
      $axf: { const: TAGS.run }, kind: { enum: RUN_KINDS }, jobId: { type: 'string' }, buildId: { type: 'string' }, stepId: { type: 'string' }, jobType: { type: 'string' },
      agent: { type: 'string', pattern: SWARM.idPattern }, model: { enum: ALLOWED_MODELS }, startedAt: ts, endedAt: tsOrBlank, status: { enum: RUN_STATUSES }, reason: { type: 'string' },
      report: { anyOf: [{ $ref: 'axf/swarm-report.schema.json' }, { type: 'null' }] }, usage, budgetTokens: { type: 'integer', minimum: 0 }, budget: { type: 'object', properties: { tokens: { type: 'integer', minimum: 0 }, maxTurns: { type: 'integer', minimum: 0 } } },
      turns: { type: 'integer', minimum: 0 }, reportedCost: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      cwd: { type: 'string' }, branch: { type: 'string' }, worktree: { type: 'string' }, session: { type: 'string' }, tmux: { type: 'string' }, log: { type: 'string' }, briefFile: { type: 'string' }, reportPath: { type: 'string' }, reportFile: { type: 'string' }, group: { type: 'string' },
      lease: { type: 'object', properties: { ok: { type: 'boolean' }, outside: strList(500, 400), shared: strList(500, 400), files: strList(5000, 400) } },
      inputs: { type: 'object', additionalProperties: { type: 'string' } }, briefTokens: { type: 'integer', minimum: 0 }, queued: { anyOf: [{ type: 'object', properties: { position: { type: 'integer' }, id: { type: 'string' } } }, { type: 'null' }] },
    },
  };
  return { 'agent.schema.json': agent, 'agent-skill.schema.json': skill, 'swarm-roster.schema.json': roster, 'swarm-state.schema.json': state, 'swarm-job.schema.json': job, 'swarm-report.schema.json': report, 'swarm-run.schema.json': run };
}
