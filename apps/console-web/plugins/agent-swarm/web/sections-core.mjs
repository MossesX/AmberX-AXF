/**
 * Section owners (crew-sections@1): every section of the system that acts on its own (the orchestrator, the dispatcher,
 * the watchdog, landing, the merge queue, deploys, backups, the systems check, notification rules…) has one employee on
 * the crew who owns it, and its key events are posted in the Breakroom group chat as that employee. Pure: the catalogue
 * is agents/sections.json, Brett's reassignments live in the plugin's data folder (sections.json there), sections.mjs
 * reads and writes both. Kotlin twin deferred (Android on hold, framework/spec/PORTING.md).
 */

export const TAG = 'crew-sections@1';
/** The key moments a section posts. `waiting` = waiting for Brett. */
export const EVENTS = ['start', 'done', 'failed', 'blocked', 'waiting'];
export const GROUPS = ['Builds', 'Accounts', 'Merging', 'Deploys', 'Health', 'Other'];
export const TEXT_MAX = 300;
/** The same line from the same section is posted once per window (a watchdog that sees the same thing every minute). */
export const DEDUPE_MIN = 30;
const MAX_HISTORY = 300;
const MAX_SAID = 500;
const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The catalogue (agents/sections.json), cleaned: ids unique and well formed, groups and events known. */
export function normSections(raw) {
  const o = isObj(raw) ? raw : {};
  const seen = new Set(); const sections = [];
  for (const s of Array.isArray(o.sections) ? o.sections : []) {
    if (!isObj(s)) continue;
    const id = str(s.id, 40);
    if (!ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    sections.push({
      id, label: str(s.label, 60) || id, group: GROUPS.includes(s.group) ? s.group : 'Other', owner: str(s.owner, 40), about: str(s.about, 300),
      where: str(s.where, 200),
      events: (Array.isArray(s.events) ? s.events : []).filter((e) => EVENTS.includes(e)),
    });
  }
  return { $axf: TAG, sections };
}

/** Problems with the catalogue against the crew: no owner, an owner who isn't on it, a section with no events. */
export function sectionErrors(cat, roster) {
  const ids = new Set((roster?.agents ?? []).map((a) => a.id));
  const out = [];
  if (!cat.sections.length) out.push('no sections');
  for (const s of cat.sections) {
    if (!s.owner) out.push(`section ${s.id}: no owner`);
    else if (!ids.has(s.owner)) out.push(`section ${s.id}: owner "${s.owner}" is not on the crew`);
    if (!s.events.length) out.push(`section ${s.id}: no events`);
  }
  return out;
}

/** Brett's reassignments (data folder), cleaned. */
export function normOverrides(raw) {
  const o = isObj(raw) ? raw : {};
  const owners = {};
  for (const [k, v] of Object.entries(isObj(o.owners) ? o.owners : {})) if (ID_RE.test(k) && typeof v === 'string' && v) owners[k] = str(v, 40);
  const history = (Array.isArray(o.history) ? o.history : []).filter(isObj).slice(-MAX_HISTORY)
    .map((h) => ({ at: str(h.at, 40), section: str(h.section, 40), from: str(h.from, 40), to: str(h.to, 40), by: str(h.by, 40) || 'Brett', note: str(h.note, 200) }));
  return { owners, history };
}

/** The owner of every section: Brett's pick while that agent is still on the crew, else the catalogue's. */
export function owners(cat, ov, roster) {
  const ids = new Set((roster?.agents ?? []).map((a) => a.id));
  return Object.fromEntries(cat.sections.map((s) => { const pick = ov.owners[s.id]; return [s.id, pick && ids.has(pick) ? pick : s.owner]; }));
}

/** Reassign one section. Throws on an unknown section or agent. Returns the new overrides (history appended). */
export function assign(cat, ov, roster, sectionId, agentRef, at, by = 'Brett', note = '') {
  const sec = cat.sections.find((s) => s.id === sectionId);
  if (!sec) throw new Error(`no section "${sectionId}" (see: sections.mjs list)`);
  const ref = String(agentRef ?? '').toLowerCase();
  const agent = (roster?.agents ?? []).find((a) => a.id === ref || a.name.toLowerCase() === ref);
  if (!agent) throw new Error(`no agent "${agentRef}" on the crew`);
  const from = owners(cat, ov, roster)[sec.id];
  const next = { owners: { ...ov.owners }, history: [...ov.history] };
  if (agent.id === sec.owner) delete next.owners[sec.id]; else next.owners[sec.id] = agent.id;
  const changed = from !== agent.id;
  if (changed) next.history = [...next.history, { at, section: sec.id, from, to: agent.id, by: str(by, 40) || 'Brett', note: str(note, 200) }].slice(-MAX_HISTORY);
  return { overrides: next, section: sec, agent, from, changed };
}

/** What the settings page shows: every section with its owner (default and current), grouped in catalogue order. */
export function board(cat, ov, roster) {
  const who = owners(cat, ov, roster);
  const by = new Map((roster?.agents ?? []).map((a) => [a.id, a]));
  return {
    $axf: TAG, events: EVENTS, groups: GROUPS.filter((g) => cat.sections.some((s) => s.group === g)),
    sections: cat.sections.map((s) => ({ ...s, current: who[s.id], name: by.get(who[s.id])?.name ?? who[s.id], avatar: by.get(who[s.id])?.avatar ?? '', reassigned: who[s.id] !== s.owner })),
    history: [...ov.history].reverse().slice(0, 50),
    crew: (roster?.agents ?? []).map((a) => ({ id: a.id, name: a.name, role: a.role ?? '' })),
  };
}

/** Problems with a post before it goes out: section known and owned, event known, text present. */
export function postErrors(cat, roster, ov, sectionId, event, text) {
  const sec = cat.sections.find((s) => s.id === sectionId);
  if (!sec) return [`no section "${sectionId}" in the registry`];
  const out = [];
  if (!EVENTS.includes(event)) out.push(`event "${event}" is not one of ${EVENTS.join(', ')}`);
  if (!str(text, TEXT_MAX)) out.push('no text');
  const who = owners(cat, ov, roster)[sec.id];
  if (!who || !(roster?.agents ?? []).some((a) => a.id === who)) out.push(`section ${sec.id} has no owner on the crew`);
  return out;
}

/** The chat line: the owner reports on the section (a `report` naming the section, and the build or PR when given). */
export function sectionLine(sectionId, ownerId, event, text, ref = '') {
  const r = str(ref, 80);
  return { from: ownerId, kind: 'report', jobId: r ? `${sectionId}:${r}` : sectionId, text: str(String(text ?? '').replace(/\s+/g, ' '), TEXT_MAX), section: sectionId, event };
}

/** The dedupe key of a post: section, event, ref and text unless the caller names one. */
export const sayKey = (sectionId, event, text, ref = '', key = '') => str(key, 200) || `${sectionId}|${event}|${str(ref, 80)}|${str(String(text ?? ''), 120)}`;

/** Was this key posted inside the window? `said` = { key: iso }. */
export function recentlySaid(said, key, at, windowMin = DEDUPE_MIN) {
  const t = Date.parse(said?.[key] ?? '');
  return Number.isFinite(t) && Date.parse(at) - t < windowMin * 60e3;
}

/** Remember a key; keeps the newest MAX_SAID. */
export function remember(said, key, at) {
  const next = { ...(isObj(said) ? said : {}), [key]: at };
  const keys = Object.keys(next);
  if (keys.length > MAX_SAID) for (const k of keys.sort((a, b) => String(next[a]).localeCompare(String(next[b]))).slice(0, keys.length - MAX_SAID)) delete next[k];
  return next;
}

/**
 * The CI check: every section the code posts for is in the registry, owned by someone on the crew, and posts only events
 * it declares; every section in the registry has an owner. `usages` = [{ file, line, section, event }] (event '' when the
 * call passes it as a variable); `dynamic` = calls whose section is not a literal.
 */
export function checkUsages(cat, roster, ov, usages = [], dynamic = []) {
  const out = [...sectionErrors(cat, roster)];
  const who = owners(cat, ov, roster);
  for (const u of usages) {
    const sec = cat.sections.find((s) => s.id === u.section);
    if (!sec) { out.push(`${u.file}:${u.line}: posts for section "${u.section}", which has no owner (not in agents/sections.json)`); continue; }
    if (!who[sec.id]) out.push(`${u.file}:${u.line}: section ${sec.id} has no owner`);
    if (u.event && !EVENTS.includes(u.event)) out.push(`${u.file}:${u.line}: unknown event "${u.event}"`);
    else if (u.event && !sec.events.includes(u.event)) out.push(`${u.file}:${u.line}: section ${sec.id} doesn't declare the "${u.event}" event`);
  }
  for (const d of dynamic) out.push(`${d.file}:${d.line}: the section must be written out (a literal id), so the owner check can see it`);
  return out;
}
