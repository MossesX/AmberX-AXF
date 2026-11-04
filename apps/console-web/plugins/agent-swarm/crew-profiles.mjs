/**
 * Crew profiles (crew-profile@1): one roster where every employee is an agent with a job title (Brett, Nov 4 2026:
 * "they're all agents and employees, they're all the same thing. They just have different job titles").
 *
 * One record per member, built from what already exists, never copied:
 *   - the swarm roster (agents/roster.json, agent@1): name, avatar, tools, models, weekly budget (salary)
 *   - the swarm state: status, custom name, runs, spend (the Breakroom's numbers)
 *   - agents/profiles.json (seed) + the plugin's data folder profiles.json (edits): persona, duties, skills, tools
 *     allow list, model, memory, safety, hourly pay, reports to, job title
 *   - the Agent manager's agents (capability axf.agents@1, passed in by the server): job title Assistant, the ones who
 *     run the AI assistant. Their own persona / skills / tools stay in the Agent manager; the profile only links them.
 *   - write-ups from the shared memory file (_claude/shared/memory/write-ups.md)
 *
 * Pure (no fs): crew-profiles-cli in swarm.mjs and the server feed it. Checked by test.mjs.
 */

export const TAG = 'crew-profile@1';
export const SECTIONS = ['persona', 'role', 'skills', 'tools', 'model', 'memory', 'safety', 'pay', 'stats', 'avatar', 'reportsTo'];
/** Only Brett (his signed-in console session) changes these. */
export const OWNER_ONLY = ['pay', 'tools', 'safety', 'jobTitle'];
export const MIN_HOURLY = 7.5;
export const MODELS = ['opus', 'fable']; // never Sonnet or Haiku (model policy); a stored one is coerced up to opus
export const KINDS = ['owner', 'crew', 'assistant', 'system'];
/** Not crew: apps and bots that only look like agents. */
export const NOT_CREW = { molly: 'Molly is the app, not an agent (her guide duties are Gizmo\'s).', vinnie: 'Vinnie is axHub\'s approval bot (system).', vinny: 'Vinnie is axHub\'s approval bot (system).' };
export const SORTS = ['working', 'name', 'title'];

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, max = 40, len = 120) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function normSkill(s) {
  if (typeof s === 'string') return { tag: str(s, 40).toLowerCase(), level: 3 };
  return { tag: str(s?.tag, 40).toLowerCase(), level: num(s?.level, 3, 1, 5) | 0 };
}

export function normModel(m) {
  const v = str(m, 20).toLowerCase();
  return MODELS.includes(v) ? v : 'opus';
}

/** One profile's own sections (what the seed and edits may carry). */
export function normProfile(o = {}) {
  const p = isObj(o.persona) ? o.persona : {};
  return {
    jobTitle: str(o.jobTitle, 60),
    pronouns: str(o.pronouns, 20),
    reportsTo: str(o.reportsTo, 40),
    persona: { voice: str(p.voice, 300), tone: str(p.tone, 120), slang: num(p.slang, 2, 0, 5) | 0, catchphrases: list(p.catchphrases, 10, 160), groupChat: str(p.groupChat, 300) },
    duties: list(o.duties, 20, 200),
    skills: (Array.isArray(o.skills) ? o.skills : []).map(normSkill).filter((s) => s.tag).slice(0, 30),
    tools: { allow: list(o.tools?.allow, 60, 120) },
    model: normModel(o.model),
    memory: { scope: str(o.memory?.scope, 60), notes: str(o.memory?.notes, 600) },
    safety: { limits: list(o.safety?.limits, 20, 200), dangerousTools: o.safety?.dangerousTools === true },
    pay: { hourly: o.pay?.hourly === null ? null : num(o.pay?.hourly, MIN_HOURLY, 0, 1000) },
  };
}

/** Edits on top of the seed: a section present in the edit replaces that section (persona merges field by field). */
function merged(seed, edit) {
  if (!isObj(edit)) return seed;
  const out = { ...seed, ...edit };
  if (isObj(seed.persona) || isObj(edit.persona)) out.persona = { ...(seed.persona ?? {}), ...(edit.persona ?? {}) };
  return out;
}

/** "## Write-up: Landin' Lenny - Nov 3 2026 (…)" sections → { name: [{ title, date, lines }] }. */
export function parseWriteups(md = '') {
  const out = {};
  let cur = null;
  for (const line of String(md).split('\n')) {
    const m = /^##\s+Write-up:\s*(.+?)\s+-\s+(.+)$/.exec(line);
    if (m) { cur = { name: m[1].trim(), date: m[2].trim(), lines: [] }; (out[cur.name.toLowerCase()] ??= []).push(cur); continue; }
    if (/^##\s/.test(line)) { cur = null; continue; }
    if (cur && line.trim()) cur.lines.push(line.replace(/^-\s*/, '').trim());
  }
  return out;
}

const statusOf = (crewRow) => (crewRow?.running?.length ? 'working' : crewRow && crewRow.works === false ? 'off' : 'idle');

/**
 * The whole roster: owner first (not on payroll), then every roster agent and every Agent manager assistant.
 * `crew` = swarm.mjs crew() rows (status, spend, stats); `assistants` = axf.agents@1 list_agents() rows.
 */
export function buildRoster({ roster = { agents: [] }, crew = [], seed = {}, edits = {}, assistants = [], writeups = {} } = {}) {
  const byCrew = new Map(crew.map((c) => [c.id, c]));
  const members = seed.members ?? {};
  const out = [];
  const owner = members.brett;
  if (owner) out.push(member('brett', { name: 'Brett', kind: 'owner', avatar: null }, merged(owner, edits.brett), null, []));
  for (const a of roster.agents ?? []) {
    if (NOT_CREW[a.id]) continue;
    const c = byCrew.get(a.id);
    const base = { name: c?.name || a.name, kind: 'crew', avatar: a.avatar ?? null, role: a.role, specialty: a.specialty, bio: a.bio, catchphrase: a.catchphrase, hiredAt: a.hiredAt, tools: a.tools, models: a.models, weekly: a.salary };
    const own = merged(members[a.id] ?? { jobTitle: a.role }, edits[a.id]);
    out.push(member(a.id, base, own, c, writeups[(c?.name || a.name).toLowerCase()] ?? []));
  }
  const taken = new Set(out.map((m) => m.id));
  for (const s of assistants) {
    if (!s?.id || NOT_CREW[s.id]) continue;
    const id = taken.has(s.id) ? `asst-${s.id}` : s.id;
    const base = { name: s.name || s.id, kind: 'assistant', avatar: null, role: 'Assistant', specialty: s.description ?? '', assistant: { agentManager: s.id, dangerous: !!s.dangerous, origin: s.origin ?? '' } };
    out.push(member(id, base, merged(members[id] ?? { jobTitle: 'Assistant', reportsTo: 'amber' }, edits[id]), null, writeups[(s.name || '').toLowerCase()] ?? []));
    taken.add(id);
  }
  return out;
}

function member(id, base, ownRaw, c, writeups) {
  const own = normProfile(ownRaw);
  if (!own.jobTitle) own.jobTitle = base.kind === 'assistant' ? 'Assistant' : base.role || 'All-rounder';
  if (!own.tools.allow.length && base.tools) own.tools.allow = [...base.tools];
  if (base.kind === 'owner') own.pay.hourly = null; // the boss is not on payroll
  else if (own.pay.hourly !== null && own.pay.hourly < MIN_HOURLY) own.pay.hourly = MIN_HOURLY;
  const status = base.kind === 'owner' ? 'owner' : statusOf(c);
  return {
    $axf: TAG, id, name: base.name, kind: base.kind, ...own,
    role: { title: own.jobTitle, specialty: base.specialty ?? '', duties: own.duties, bio: base.bio ?? '' },
    avatar: base.avatar, catchphrase: own.persona.catchphrases[0] || base.catchphrase || '', hiredAt: base.hiredAt ?? '',
    assistant: base.assistant ?? null, weeklyBudget: base.weekly ?? null,
    status, statusLabel: c?.statusLabel ?? (status === 'owner' ? 'Owner' : 'Idle'),
    running: c?.running ?? [],
    stats: {
      jobs: c?.stats?.done ?? 0, failed: c?.stats?.failed ?? 0, costUsd: c?.spend?.all ?? 0, costToday: c?.spend?.today ?? 0,
      strikes: c?.stats?.failStreak ?? c?.strikes ?? 0, writeups: writeups.map((w) => ({ date: w.date, lines: w.lines })),
    },
  };
}

/** Working first (longest-running first), then queued / assigned, then idle, then off; owner always on top. */
export function sortMembers(ms, sort = 'working') {
  const rank = (m) => (m.kind === 'owner' ? -1 : m.status === 'working' ? 0 : m.status === 'queued' ? 1 : m.status === 'idle' ? 2 : 3);
  const started = (m) => Math.min(...(m.running ?? []).map((r) => Date.parse(r.startedAt)).filter(Number.isFinite), Infinity);
  const name = (m) => m.name.toLowerCase();
  return [...ms].sort((a, b) => {
    if (sort === 'name') return name(a).localeCompare(name(b));
    if (sort === 'title') return a.jobTitle.localeCompare(b.jobTitle) || name(a).localeCompare(name(b));
    return rank(a) - rank(b) || started(a) - started(b) || name(a).localeCompare(name(b));
  });
}

/**
 * Apply an edit to one member's stored edits. Owner-only sections are refused unless `owner` is true; job titles of
 * the owner record can't change. Returns the new edit record for that member (to store), never the whole roster.
 */
export function applyUpdate(current = {}, patch = {}, { owner = false, kind = 'crew' } = {}) {
  if (!isObj(patch)) throw new Error('invalid: send the sections to change as an object');
  const allowed = new Set(['jobTitle', 'pronouns', 'reportsTo', 'persona', 'duties', 'skills', 'tools', 'model', 'memory', 'safety', 'pay']);
  const bad = Object.keys(patch).filter((k) => !allowed.has(k));
  if (bad.length) throw new Error(`invalid: unknown section ${bad.join(', ')}`);
  const locked = Object.keys(patch).filter((k) => OWNER_ONLY.includes(k));
  if (locked.length && !owner) throw new Error(`owner_only: ${locked.join(', ')} change only with Brett's own click in the console`);
  if (kind === 'owner' && ('jobTitle' in patch || 'pay' in patch)) throw new Error('invalid: the boss has no pay and keeps his title');
  if (patch.pay && patch.pay.hourly !== undefined && Number(patch.pay.hourly) < MIN_HOURLY) throw new Error(`invalid: pay is at least $${MIN_HOURLY.toFixed(2)}/h`);
  if (patch.model !== undefined && !MODELS.includes(String(patch.model).toLowerCase())) throw new Error('invalid: model is opus or fable (never Sonnet or Haiku)');
  const next = merged(current, patch);
  const n = normProfile(next);
  // keep only what was ever set (so the seed still shows through for untouched sections)
  return Object.fromEntries(Object.keys(next).filter((k) => allowed.has(k)).map((k) => [k, k === 'persona' ? n.persona : n[k] ?? next[k]]));
}

/** The persona as group chat lines and claude_session_persona use it: one compact paragraph. */
export function personaLine(m) {
  const p = m.persona ?? {};
  return [`${m.name} (${m.jobTitle})`, p.voice, p.tone && `Tone: ${p.tone}.`, p.groupChat && `In group chat: ${p.groupChat}`, p.catchphrases?.length ? `Says: "${p.catchphrases.join('" / "')}"` : '']
    .filter(Boolean).join(' ');
}
