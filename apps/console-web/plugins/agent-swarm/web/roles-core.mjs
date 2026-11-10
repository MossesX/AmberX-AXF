/**
 * Who does what (crew-roles@1): every role in the system (the orchestrator, the dispatcher, each app, each kind of
 * action) has one employee on the crew who holds it, and every Activity Monitor entry resolves to the employee who did
 * it. Pure and framework-agnostic: the catalogue is agents/roles.json, Brett's reassignments live in the plugin's data
 * folder (roles.json there: { holders: { roleId: agentId }, history: [...] }), swarm.mjs reads and writes both.
 * Kotlin twin deferred (Android on hold, framework/spec/PORTING.md).
 */

export const TAG = 'crew-roles@1';
export const GROUPS = ['Orchestrator', 'Apps', 'Actions'];
const MAX_HISTORY = 500;
const MAX_LOG = 5000;

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, max = 40) => (Array.isArray(v) ? v.map((x) => str(x, 80).toLowerCase()).filter(Boolean).slice(0, max) : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The catalogue (agents/roles.json), cleaned: unknown keys dropped, ids unique, groups known. */
export function normRoles(raw) {
  const o = isObj(raw) ? raw : {};
  const seen = new Set();
  const roles = [];
  for (const r of Array.isArray(o.roles) ? o.roles : []) {
    if (!isObj(r)) continue;
    const id = str(r.id, 60);
    if (!/^[a-z][a-z0-9.-]{0,59}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const m = isObj(r.match) ? r.match : {};
    roles.push({
      id, label: str(r.label, 60) || id, group: GROUPS.includes(r.group) ? r.group : 'Actions', holder: str(r.holder, 40), about: str(r.about, 300),
      match: { ids: list(m.ids), sources: list(m.sources), kinds: list(m.kinds), words: list(m.words) },
    });
  }
  const fallback = seen.has(o.fallback) ? o.fallback : roles[0]?.id ?? '';
  return { $axf: TAG, fallback, roles };
}

/** Problems with the catalogue against the roster: holders that aren't on it. */
export function rolesErrors(cat, roster) {
  const ids = new Set((roster?.agents ?? []).map((a) => a.id));
  const out = [];
  for (const r of cat.roles) if (!ids.has(r.holder)) out.push(`role ${r.id}: holder "${r.holder}" is not on the roster`);
  if (!cat.roles.length) out.push('no roles');
  return out;
}

/** Brett's reassignments (data folder), cleaned. */
export function normAssignments(raw) {
  const o = isObj(raw) ? raw : {};
  const holders = {};
  for (const [k, v] of Object.entries(isObj(o.holders) ? o.holders : {})) if (typeof v === 'string' && v) holders[str(k, 60)] = str(v, 40);
  const history = (Array.isArray(o.history) ? o.history : []).filter(isObj).slice(-MAX_HISTORY)
    .map((h) => ({ at: str(h.at, 40), role: str(h.role, 60), from: str(h.from, 40), to: str(h.to, 40), by: str(h.by, 40) || 'Brett', note: str(h.note, 200) }));
  return { holders, history };
}

/** The holder of every role: Brett's choice when that agent is still on the roster, else the catalogue default. */
export function holders(cat, asg, roster) {
  const ids = new Set((roster?.agents ?? []).map((a) => a.id));
  return Object.fromEntries(cat.roles.map((r) => {
    const pick = asg.holders[r.id];
    return [r.id, pick && ids.has(pick) ? pick : r.holder];
  }));
}

/** Reassign one role. Throws on an unknown role or agent. Returns the new assignments (history appended). */
export function assign(cat, asg, roster, roleId, agentId, at, by = 'Brett', note = '') {
  const role = cat.roles.find((r) => r.id === roleId);
  if (!role) throw new Error(`no role "${roleId}" (see: swarm.mjs roles)`);
  const agent = (roster?.agents ?? []).find((a) => a.id === agentId || a.name.toLowerCase() === String(agentId).toLowerCase());
  if (!agent) throw new Error(`no agent "${agentId}" on the roster`);
  const from = holders(cat, asg, roster)[roleId];
  const next = { holders: { ...asg.holders }, history: [...asg.history] };
  if (agent.id === role.holder) delete next.holders[roleId]; else next.holders[roleId] = agent.id;
  if (from !== agent.id) next.history = [...next.history, { at, role: roleId, from, to: agent.id, by: str(by, 40) || 'Brett', note: str(note, 200) }].slice(-MAX_HISTORY);
  return { state: next, role, agent, from, changed: from !== agent.id };
}

const words = (s) => ` ${String(s ?? '').toLowerCase().replace(/[^a-z0-9@.:-]+/g, ' ')} `;
const hasWord = (text, w) => text.includes(` ${w} `) || (w.includes(' ') && text.includes(w));

/**
 * The role an activity entry belongs to ({ id, source, kind, title, detail }), or the fallback role. Order: an id
 * prefix, then the source, then the kind, then a whole word in the title (catalogue order within each pass), so the
 * more precise signal wins over the looser one.
 */
export function roleOf(item, cat) {
  const id = String(item?.id ?? '').toLowerCase();
  const source = String(item?.source ?? '').toLowerCase();
  const kind = String(item?.kind ?? '').toLowerCase();
  const text = words(`${item?.title ?? ''} ${String(item?.detail ?? '').split('\n')[0]}`);
  return cat.roles.find((r) => r.match.ids.some((p) => id.startsWith(p)))
    ?? cat.roles.find((r) => source && r.match.sources.includes(source))
    ?? cat.roles.find((r) => kind && r.match.kinds.includes(kind))
    ?? cat.roles.find((r) => r.match.words.some((w) => hasWord(text, w)))
    ?? cat.roles.find((r) => r.id === cat.fallback) ?? null;
}

/** A crew member named by the entry itself (`by`, `agent`, or "Agent: Name" in its text): the real actor beats the role. */
export function namedAgent(item, roster) {
  const agents = roster?.agents ?? [];
  for (const k of [item?.agent, item?.by]) {
    const v = String(k ?? '').trim().toLowerCase();
    if (!v) continue;
    const a = agents.find((x) => x.id === v || x.name.toLowerCase() === v);
    if (a) return a;
  }
  const m = /\bagent:\s*([A-Za-z' ]{2,40}?)(?:[.,;)\n]|$)/i.exec(`${item?.title ?? ''}\n${item?.detail ?? ''}`);
  if (m) { const n = m[1].trim().toLowerCase(); return agents.find((x) => x.name.toLowerCase() === n || x.id === n) ?? null; }
  return null;
}

/** Who did an activity entry: { agent, name, role (the job title), roleId, roleLabel, why } or null when no roles. */
export function actorOf(item, cat, held, roster) {
  const role = roleOf(item, cat);
  const named = namedAgent(item, roster);
  const id = named?.id ?? (role ? held[role.id] : '');
  const a = (roster?.agents ?? []).find((x) => x.id === id);
  if (!a) return null;
  return { agent: a.id, name: a.name, title: a.role, avatar: a.avatar, roleId: role?.id ?? '', roleLabel: role?.label ?? '', why: named ? 'named' : 'role' };
}

/** The Who does what board: every role with its holder, grouped; plus each agent's jobs. */
export function board(cat, asg, roster) {
  const held = holders(cat, asg, roster);
  const byId = Object.fromEntries((roster?.agents ?? []).map((a) => [a.id, a]));
  const roles = cat.roles.map((r) => {
    const a = byId[held[r.id]];
    return { id: r.id, label: r.label, group: r.group, about: r.about, holder: held[r.id], holderName: a?.name ?? held[r.id], holderTitle: a?.role ?? '', isDefault: held[r.id] === r.holder, defaultHolder: r.holder, match: r.match };
  });
  const jobs = {};
  for (const r of roles) (jobs[r.holder] ??= []).push(r.id);
  return { $axf: TAG, fallback: cat.fallback, groups: GROUPS, roles, jobs, history: [...asg.history].reverse().slice(0, 50) };
}

/* ---------- each employee's activity history (data folder: activity.jsonl, one line per entry state) ---------- */

/** The log line for an entry seen in the Activity Monitor (null when nobody resolves). */
export function logLine(item, actor, at) {
  if (!actor) return null;
  return { at, agent: actor.agent, roleId: actor.roleId, id: str(item.id, 200), state: str(item.state, 20), source: str(item.source, 40), kind: str(item.kind, 30), title: str(item.title, 200), url: str(item.url, 400) };
}
/** Key that makes one entry state one line (a running → done entry is two lines). */
export const logKey = (l) => `${l.id}\u0000${l.state}`;
/** Keep the log bounded. */
export const trimLog = (lines) => lines.slice(-MAX_LOG);
/** One agent's history, newest first. */
export const historyOf = (lines, agentId, limit = 100) => lines.filter((l) => l.agent === agentId).reverse().slice(0, Math.max(1, Math.min(limit, 1000)));
