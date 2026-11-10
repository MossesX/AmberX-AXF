/**
 * assignment@1 — how the orchestrator hands a build or a step to an employee agent through the group chat (pure, IO-free).
 *
 * Brett, Nov 10 2026: "When the orchestrator assigns builds or steps they are sent to the right employee who has its own
 * set of briefs to send back to the orchestrator and uses the employee data in the brief. In the group chat the
 * orchestrator asks if anyone can do something, if they have skills or tools or capabilities; the first one to take it
 * opens a dialog listing all the matching agents with a percentage of each one being the best choice for the job. After
 * the 90 second veto it chooses the best probable one by default."
 *
 * The envelope is the group chat's own message (swarm-state@1 `messages`, normMessage in engines/swarm-rules.mjs:
 * id, at, from, kind, text, jobId, vibe, toned), never a new one: an assignment line is a message of kind `assignment`
 * whose `assignment` field carries one typed payload. `jobId` names the work the swarm way (`<buildId>` for a whole
 * build, `<buildId>.<stepId>` for a step, like swarm-job@1 ids), so the chat, the planner and the runs agree.
 *
 *   type         who posts      carries
 *   ask          boss           need { skills, tools, capabilities }: "can anyone do this?"
 *   claim        an agent       the first taker; it opens the dialog (nobody else may claim the same ask)
 *   candidates   the claimer    every matching agent with match % (sum 100) and reasons, and the veto deadline
 *                (or boss)      (claimed at + 90 s)
 *   veto         brett          inside the window: stop the default; `employee` set = his pick, blank = declined
 *   pick         brett | boss   the decision: pickedBy `brett` any time after the ask, `default` once the window closed
 *                               (the top candidate)
 *   brief        the employee   a brief sent back to the orchestrator: a ref to it, its kind, and the employee data the
 *                               brief was written with (id, name, role, skill)
 *
 * The record (`assignment` on a builds@1 build and on each step, framework/plan/builds-store-core.mjs) is the fold of
 * those payloads: status (asked → claimed → veto → assigned → returned, or declined), the ask id, need, candidates,
 * claimedBy, vetoDeadline, pickedBy, assignedEmployee, briefs and the message ids. `assignedEmployee` is also the
 * record's own column on the build and the step (the orchestrator table), kept equal by the normalizer. Records from
 * before this contract carry no `assignment`; their `assignedEmployee` (when one was ever written) stays.
 *
 * Every normalizer fills defaults and drops junk; every validator names the field ({ field, code, message }); `apply`
 * is the one state machine every surface uses, so a replayed chat gives the same record. Snapshot: `axf schemas`
 * writes framework/schemas/assignment.json and framework/schemas/json/assignment.schema.json (a copy next to the
 * contract doc, _claude/builds/contracts/assignment@1.schema.json). Fixture: framework/spec/fixtures/build-assignment.json
 * (check-build-assignment.mjs). Kotlin twin deferred (PORTING.md).
 */

export const SCHEMA = 'assignment@1';
/** The chat kind every assignment line is posted as (engines/swarm-rules.mjs CHAT_KINDS). */
export const CHAT_KIND = 'assignment';
export const TYPES = ['ask', 'claim', 'candidates', 'veto', 'pick', 'brief'];
export const STATUSES = ['', 'asked', 'claimed', 'veto', 'assigned', 'returned', 'declined'];
export const PICKERS = ['', 'brett', 'default'];
export const NEED_KEYS = ['skills', 'tools', 'capabilities'];
export const BRIEF_KINDS = ['brief', 'report', 'handoff', 'question'];
export const VETO_SECONDS = 90;
export const BOSS_ID = 'boss';
export const BRETT_ID = 'brett';
/** Who may post each type (the chat's speakers: boss, agent, brett). */
export const SPEAKERS = Object.freeze({ ask: ['boss'], claim: ['agent'], candidates: ['agent', 'boss'], veto: ['brett'], pick: ['brett', 'boss'], brief: ['agent'] });
/** Match weights: a needed skill the agent has counts most, a tool next, a capability word last. */
export const WEIGHTS = Object.freeze({ skill: 3, tool: 2, capability: 1 });
export const LIMITS = Object.freeze({
  id: 40, buildId: 80, stepId: 40, jobId: 120, need: 20, needItem: 60, candidates: 30, reasons: 12, reason: 120, briefs: 50, ref: 300, note: 400, messages: 200, name: 60, role: 80, skill: 40,
});

export const REGISTRY = Object.freeze({
  $id: 'axf/assignment', $axf: SCHEMA, envelope: 'swarm-state@1 messages (engines/swarm-rules.mjs normMessage), kind "assignment"',
  types: TYPES, statuses: STATUSES, pickers: PICKERS, needKeys: NEED_KEYS, briefKinds: BRIEF_KINDS, vetoSeconds: VETO_SECONDS, speakers: SPEAKERS, weights: WEIGHTS, limits: LIMITS,
  jobId: '<buildId> for a build, <buildId>.<stepId> for a step (swarm-job@1 ids)',
  flow: ['ask', 'claim', 'candidates', 'veto | pick', 'brief'],
});

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const iso = (v) => { const s = str(v, 40).trim(); return s && ISO_RE.test(s) && Number.isFinite(Date.parse(s)) ? s : ''; };
const list = (v, max, len) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, len).trim()).filter(Boolean))].slice(0, max) : []);
const err = (field, code, message) => ({ field, code, message });
const clone = (o) => JSON.parse(JSON.stringify(o));
const low = (s) => str(s, 400).toLowerCase();

export const isAgentId = (v) => typeof v === 'string' && ID_RE.test(v);
export const isTimestamp = (v) => !!iso(v);
/** The swarm job id of a build or one of its steps. */
export const jobIdOf = (buildId, stepId = '') => (str(stepId, LIMITS.stepId) ? `${str(buildId, LIMITS.buildId)}.${str(stepId, LIMITS.stepId)}` : str(buildId, LIMITS.buildId));
/** `{ buildId, stepId }` of a job id ('' stepId for a whole build). A build id may carry dots only when a step is not named. */
export function parseJobId(jobId) {
  const s = str(jobId, LIMITS.jobId);
  const m = /^(.+?)\.(s\d\S*)$/.exec(s); // the first ".s<n>" starts the step id (divided steps read s1.2)
  return m ? { buildId: m[1], stepId: m[2] } : { buildId: s, stepId: '' };
}
export const plusSeconds = (at, s) => { const t = Date.parse(at); return Number.isFinite(t) ? new Date(t + s * 1000).toISOString() : ''; };

/* ------------------------------------------------------------------ */
/* Need, candidates, briefs                                             */
/* ------------------------------------------------------------------ */

export function normNeed(n) {
  const o = isObj(n) ? n : {};
  return { skills: list(o.skills, LIMITS.need, LIMITS.needItem), tools: list(o.tools, LIMITS.need, LIMITS.needItem), capabilities: list(o.capabilities, LIMITS.need, LIMITS.needItem) };
}
export const needEmpty = (n) => NEED_KEYS.every((k) => !(n?.[k]?.length));
/** One line of a need: "skills react-ui, tools Edit, can screenshots". */
export function needText(n) {
  const x = normNeed(n);
  const parts = [];
  if (x.skills.length) parts.push(`skills ${x.skills.join(', ')}`);
  if (x.tools.length) parts.push(`tools ${x.tools.join(', ')}`);
  if (x.capabilities.length) parts.push(`can ${x.capabilities.join(', ')}`);
  return parts.join('; ') || 'anything';
}

export function normCandidate(c) {
  const o = isObj(c) ? c : {};
  const match = Number.isFinite(Number(o.match)) ? Math.min(100, Math.max(0, Math.round(Number(o.match)))) : 0;
  return { employee: str(o.employee, LIMITS.id), match, reasons: list(o.reasons, LIMITS.reasons, LIMITS.reason) };
}
/** Candidates, best match first; ties keep the order they came in (candidatesFor puts the cheaper agent first). */
export const normCandidates = (l) => (Array.isArray(l) ? l : []).map(normCandidate).filter((c) => isAgentId(c.employee)).slice(0, LIMITS.candidates).sort((a, b) => b.match - a.match);

/** The employee data a brief is written with (from agent@1): what the orchestrator shows next to the returned brief. */
export function normEmployee(e) {
  const o = isObj(e) ? e : {};
  const id = str(o.id, LIMITS.id);
  if (!isAgentId(id)) return null;
  return { id, name: str(o.name, LIMITS.name), role: str(o.role, LIMITS.role), skill: str(o.skill, LIMITS.skill) };
}
export function normBrief(b) {
  const o = isObj(b) ? b : {};
  return { ref: str(o.ref, LIMITS.ref), kind: BRIEF_KINDS.includes(o.kind) ? o.kind : 'brief', by: str(o.by, LIMITS.id), at: iso(o.at), employee: normEmployee(o.employee), message: str(o.message, LIMITS.id) };
}

/**
 * Every agent that matches a need, ranked, with the chance (%) that each is the best choice: its score over the sum of
 * all scores, rounded so the percentages add up to 100. Score = needed skills it has × 3, needed tools it has × 2,
 * capability words found in its keywords / specialty / role / models / paths × 1; the step's `text` adds a keyword hit
 * per keyword found (× 1). Agents scoring 0 are left out; when nobody scores, `fallback` (an agent id) is the one
 * candidate at 100 % with a reason that says so. `agents` = agent@1 records that may work (the caller filters statuses).
 */
export function candidatesFor(need, agents, { text = '', fallback = '' } = {}) {
  const n = normNeed(need);
  const t = low(text);
  const scored = [];
  for (const a of Array.isArray(agents) ? agents : []) {
    if (!isAgentId(a?.id)) continue;
    const skills = new Set([a.skill, ...(a.skills ?? [])].filter(Boolean).map(low));
    const tools = new Set((a.tools ?? []).map(low));
    const words = [...(a.keywords ?? []), a.specialty ?? '', a.role ?? '', ...(a.models ?? []), ...(a.paths ?? [])].map(low).join(' ');
    let score = 0; const reasons = [];
    for (const k of n.skills) { if (skills.has(low(k))) { score += WEIGHTS.skill; reasons.push(`skill ${k}`); } else if (skills.has('*')) { score += WEIGHTS.skill; reasons.push(`all-rounder: ${k}`); } }
    for (const k of n.tools) if (tools.has(low(k))) { score += WEIGHTS.tool; reasons.push(`tool ${k}`); }
    for (const k of n.capabilities) if (words.includes(low(k))) { score += WEIGHTS.capability; reasons.push(`can ${k}`); }
    if (t) for (const k of a.keywords ?? []) if (k && new RegExp(`(^|[^a-z0-9])${low(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t)) { score += WEIGHTS.capability; reasons.push(`knows ${k}`); }
    // a tool everybody has is not a match on its own when the need names skills or capabilities
    const strong = reasons.some((r) => !r.startsWith('tool '));
    if (score > 0 && (strong || (!n.skills.length && !n.capabilities.length))) scored.push({ employee: a.id, score, salary: Number(a.salary) || 0, reasons: reasons.slice(0, LIMITS.reasons) });
  }
  if (!scored.length) return isAgentId(fallback) ? [{ employee: fallback, match: 100, reasons: ['roster fallback: nobody matched the need'] }] : [];
  scored.sort((a, b) => b.score - a.score || a.salary - b.salary || a.employee.localeCompare(b.employee));
  const total = scored.reduce((s, c) => s + c.score, 0);
  const raw = scored.map((c) => (c.score / total) * 100);
  const pct = raw.map(Math.floor);
  let left = 100 - pct.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; pct[i] += 1; left -= 1; }
  return scored.slice(0, LIMITS.candidates).map((c, i) => ({ employee: c.employee, match: pct[i], reasons: c.reasons }));
}

/* ------------------------------------------------------------------ */
/* Payloads (what rides on the chat message)                            */
/* ------------------------------------------------------------------ */

export function normPayload(p) {
  if (!isObj(p) || !TYPES.includes(p.type)) return null;
  const base = { type: p.type, buildId: str(p.buildId, LIMITS.buildId), stepId: str(p.stepId, LIMITS.stepId), ask: str(p.ask, LIMITS.id), at: iso(p.at) };
  switch (p.type) {
    case 'ask': return { ...base, need: normNeed(p.need) };
    case 'claim': return { ...base, by: str(p.by, LIMITS.id) };
    case 'candidates': return { ...base, by: str(p.by, LIMITS.id), candidates: normCandidates(p.candidates), vetoDeadline: iso(p.vetoDeadline) };
    case 'veto': return { ...base, by: str(p.by, LIMITS.id) || BRETT_ID, employee: str(p.employee, LIMITS.id), note: str(p.note, LIMITS.note) };
    case 'pick': return { ...base, employee: str(p.employee, LIMITS.id), pickedBy: PICKERS.includes(p.pickedBy) && p.pickedBy ? p.pickedBy : 'brett' };
    case 'brief': return { ...base, by: str(p.by, LIMITS.id), ref: str(p.ref, LIMITS.ref), kind: BRIEF_KINDS.includes(p.kind) ? p.kind : 'brief', employee: normEmployee(p.employee) };
    default: return null;
  }
}

/** Problems with one payload, before it is posted or applied. `agents` = ids on the roster (empty = not checked). */
export function payloadErrors(p, agents = [], f = 'assignment') {
  if (!isObj(p)) return [err(f, 'missing', `${f} is missing`)];
  const out = [];
  if (!TYPES.includes(p.type)) return [err(`${f}.type`, p.type === undefined ? 'missing' : 'invalid', `${f}.type must be one of ${TYPES.join(', ')}`)];
  if (!str(p.buildId, LIMITS.buildId)) out.push(err(`${f}.buildId`, 'missing', `${f}.buildId names the build`));
  if (p.type !== 'ask' && !str(p.ask, LIMITS.id)) out.push(err(`${f}.ask`, 'missing', `${f}: a ${p.type} answers an ask (its message id)`));
  if (p.at !== undefined && p.at !== '' && !iso(p.at)) out.push(err(`${f}.at`, 'invalid', `${f}.at is not an ISO timestamp`));
  const agentField = (k, who) => { const v = str(p[k], LIMITS.id); if (!v) out.push(err(`${f}.${k}`, 'missing', `${f}.${k}: ${who} is missing`)); else if (!isAgentId(v)) out.push(err(`${f}.${k}`, 'invalid', `${f}.${k} "${v}" is not an agent id`)); else if (agents.length && !agents.includes(v)) out.push(err(`${f}.${k}`, 'invalid', `${f}.${k} "${v}" is not on the roster`)); };
  switch (p.type) {
    case 'ask': if (needEmpty(normNeed(p.need))) out.push(err(`${f}.need`, 'missing', `${f}.need names at least one skill, tool or capability`)); break;
    case 'claim': agentField('by', 'the claimer'); break;
    case 'candidates': {
      agentField('by', 'who opened the dialog');
      const c = normCandidates(p.candidates);
      if (!c.length) out.push(err(`${f}.candidates`, 'missing', `${f}.candidates lists at least one matching agent`));
      else if (c.reduce((s, x) => s + x.match, 0) !== 100) out.push(err(`${f}.candidates`, 'invalid', `${f}.candidates: the match percentages add up to 100`));
      if (!iso(p.vetoDeadline)) out.push(err(`${f}.vetoDeadline`, 'missing', `${f}.vetoDeadline (claimed at + ${VETO_SECONDS} s) is missing`));
      break;
    }
    case 'veto': if (str(p.employee)) agentField('employee', 'his pick'); break;
    case 'pick': agentField('employee', 'the employee'); if (!PICKERS.includes(p.pickedBy) || !p.pickedBy) out.push(err(`${f}.pickedBy`, 'invalid', `${f}.pickedBy is brett or default`)); break;
    case 'brief':
      agentField('by', 'the employee');
      if (!str(p.ref)) out.push(err(`${f}.ref`, 'missing', `${f}.ref points at the brief sent back`));
      if (p.employee !== undefined && p.employee !== null && !normEmployee(p.employee)) out.push(err(`${f}.employee`, 'invalid', `${f}.employee carries the agent's id, name, role, skill`));
      break;
    default: break;
  }
  return out;
}

/** Is `from` (boss | brett | an agent id) allowed to post this payload type? */
export function speakerOf(from) { return from === BOSS_ID ? 'boss' : from === BRETT_ID ? 'brett' : isAgentId(from) ? 'agent' : ''; }
export const maySpeak = (from, type) => !!SPEAKERS[type]?.includes(speakerOf(from));

/* ------------------------------------------------------------------ */
/* The record on a build or a step                                      */
/* ------------------------------------------------------------------ */

export function emptyAssignment() {
  return { status: '', ask: '', askedAt: '', need: normNeed(null), candidates: [], claimedBy: '', claimedAt: '', vetoDeadline: '', pickedBy: '', pickedAt: '', assignedEmployee: '', briefs: [], messages: [], updatedAt: '' };
}

/**
 * The record, or null when there is nothing to keep (no assignment ever happened and no employee is named). An
 * `assignedEmployee` from the record's own column fills a blank one here, so a build or step that only ever had the
 * column reads the same everywhere.
 */
export function normAssignment(a, { assignedEmployee = '' } = {}) {
  const o = isObj(a) ? a : {};
  const col = isAgentId(assignedEmployee) ? assignedEmployee : '';
  const r = {
    status: STATUSES.includes(o.status) ? o.status : '',
    ask: str(o.ask, LIMITS.id), askedAt: iso(o.askedAt), need: normNeed(o.need), candidates: normCandidates(o.candidates),
    claimedBy: isAgentId(o.claimedBy) ? o.claimedBy : '', claimedAt: iso(o.claimedAt), vetoDeadline: iso(o.vetoDeadline),
    pickedBy: PICKERS.includes(o.pickedBy) ? o.pickedBy : '', pickedAt: iso(o.pickedAt),
    assignedEmployee: isAgentId(o.assignedEmployee) ? o.assignedEmployee : o.status === 'declined' ? '' : col,
    briefs: (Array.isArray(o.briefs) ? o.briefs : []).map(normBrief).filter((b) => b.ref).slice(-LIMITS.briefs),
    messages: list(o.messages, LIMITS.messages, LIMITS.id), updatedAt: iso(o.updatedAt),
  };
  if (!r.status && !r.ask && !r.assignedEmployee && !r.briefs.length && !r.messages.length) return null;
  if (!r.status && r.assignedEmployee) r.status = 'assigned';
  return r;
}

/** Seconds left in the veto window at `now` (0 when closed or not open). */
export function vetoLeft(a, now) {
  if (!a || a.status !== 'veto' || !a.vetoDeadline) return 0;
  return Math.max(0, Math.ceil((Date.parse(a.vetoDeadline) - Date.parse(now)) / 1000));
}
export const vetoOpen = (a, now) => vetoLeft(a, now) > 0;

/**
 * Fold one posted payload into the record. Returns { record, error } where `error` names why it was refused (the
 * record is then unchanged). `messageId` is the chat message the payload rode on; `from` is who posted it.
 */
export function apply(record, payload, { at, from = '', messageId = '' } = {}) {
  const a = record ? clone(record) : emptyAssignment();
  const p = normPayload(payload);
  const now = iso(at) || p?.at || '';
  const refuse = (m) => ({ record: record ?? null, error: m });
  if (!p) return refuse('not an assignment payload');
  if (!now) return refuse('no time for the change (at)');
  if (from && !maySpeak(from, p.type)) return refuse(`${from} cannot post a ${p.type} (${SPEAKERS[p.type].join(' or ')} does)`);
  const sameAsk = p.type === 'ask' || !a.ask || p.ask === a.ask;
  if (!sameAsk) return refuse(`${p.type} answers ask ${p.ask}, the open ask is ${a.ask}`);
  const touch = () => { a.updatedAt = now; if (messageId) { a.messages.push(str(messageId, LIMITS.id)); a.messages = [...new Set(a.messages)].slice(-LIMITS.messages); } };
  switch (p.type) {
    case 'ask': {
      if (needEmpty(p.need)) return refuse('an ask names at least one skill, tool or capability');
      if (a.status === 'claimed' || a.status === 'veto') return refuse(`ask ${a.ask} is still open (${a.status})`);
      Object.assign(a, { status: 'asked', ask: messageId || a.ask, askedAt: now, need: p.need, candidates: [], claimedBy: '', claimedAt: '', vetoDeadline: '', pickedBy: '', pickedAt: '' });
      touch(); return { record: a, error: '' };
    }
    case 'claim': {
      if (a.status !== 'asked') return refuse(a.status === 'claimed' || a.status === 'veto' ? `${a.claimedBy} already took it` : 'nothing is being asked');
      if (!isAgentId(p.by)) return refuse('the claimer is not an agent id');
      Object.assign(a, { status: 'claimed', claimedBy: p.by, claimedAt: now });
      touch(); return { record: a, error: '' };
    }
    case 'candidates': {
      if (a.status !== 'claimed') return refuse(a.status === 'veto' ? 'the dialog is already open' : 'nobody has claimed the ask');
      if (p.by !== a.claimedBy && from !== BOSS_ID) return refuse(`${a.claimedBy} opened the dialog, not ${p.by}`);
      if (!p.candidates.length) return refuse('no candidates');
      Object.assign(a, { status: 'veto', candidates: p.candidates, vetoDeadline: p.vetoDeadline || plusSeconds(a.claimedAt || now, VETO_SECONDS) });
      touch(); return { record: a, error: '' };
    }
    case 'veto': {
      if (a.status !== 'veto') return refuse('no veto window is open');
      if (!vetoOpen(a, now)) return refuse(`the veto window closed at ${a.vetoDeadline}`);
      if (p.employee) Object.assign(a, { status: 'assigned', assignedEmployee: p.employee, pickedBy: 'brett', pickedAt: now });
      else Object.assign(a, { status: 'declined', pickedBy: 'brett', pickedAt: now, assignedEmployee: '' });
      touch(); return { record: a, error: '' };
    }
    case 'pick': {
      if (!isAgentId(p.employee)) return refuse('the pick names an employee');
      if (p.pickedBy === 'brett') {
        if (!['asked', 'claimed', 'veto'].includes(a.status)) return refuse(a.status === 'assigned' ? `${a.assignedEmployee} already has it` : 'nothing is being asked');
      } else {
        if (a.status !== 'veto') return refuse('a default pick needs a closed veto window');
        if (vetoOpen(a, now)) return refuse(`the veto window is open until ${a.vetoDeadline} (${vetoLeft(a, now)} s left)`);
        if (p.employee !== a.candidates[0]?.employee) return refuse(`the default pick is the best match, ${a.candidates[0]?.employee ?? 'nobody'}`);
      }
      Object.assign(a, { status: 'assigned', assignedEmployee: p.employee, pickedBy: p.pickedBy, pickedAt: now });
      touch(); return { record: a, error: '' };
    }
    case 'brief': {
      if (a.status !== 'assigned' && a.status !== 'returned') return refuse('nobody is assigned yet');
      if (p.by !== a.assignedEmployee) return refuse(`${a.assignedEmployee} has it, not ${p.by}`);
      if (!p.ref) return refuse('the brief has no ref');
      a.briefs.push({ ref: p.ref, kind: p.kind, by: p.by, at: now, employee: p.employee, message: str(messageId, LIMITS.id) });
      a.briefs = a.briefs.slice(-LIMITS.briefs);
      a.status = 'returned';
      touch(); return { record: a, error: '' };
    }
    default: return refuse('unknown type');
  }
}

/** The default pick once the window closed: a payload the boss posts, or null while it is open / nothing to pick. */
export function defaultPick(record, now, { buildId = '', stepId = '' } = {}) {
  const a = record;
  if (!a || a.status !== 'veto' || vetoOpen(a, now) || !a.candidates[0]) return null;
  return { type: 'pick', buildId: buildId || '', stepId: stepId || '', ask: a.ask, employee: a.candidates[0].employee, pickedBy: 'default', at: iso(now) };
}

/** Replay a list of chat messages (kind assignment, same jobId) into one record; messages that do not apply are reported. */
export function fold(messages, { buildId = '', stepId = '' } = {}) {
  let record = null; const refused = [];
  const want = jobIdOf(buildId, stepId);
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.kind !== CHAT_KIND || !m.assignment) continue;
    if (want && m.jobId && m.jobId !== want) continue;
    const r = apply(record, m.assignment, { at: m.at, from: m.from, messageId: m.id });
    if (r.error) refused.push({ id: m.id ?? '', error: r.error }); else record = r.record;
  }
  return { record, refused };
}

/**
 * Two copies of one record (a store merge, builds-merge-core): the one changed later wins its fields; briefs and
 * message ids are the union; an employee is never blanked by a copy that has none unless that copy declined.
 */
export function mergeAssignment(a, b) {
  const x = normAssignment(a); const y = normAssignment(b);
  if (!x) return y; if (!y) return x;
  const [win, lose] = (x.updatedAt || '') >= (y.updatedAt || '') ? [x, y] : [y, x];
  const out = clone(win);
  const key = (br) => `${br.ref}|${br.at}`;
  const seen = new Set(out.briefs.map(key));
  for (const br of lose.briefs) if (!seen.has(key(br))) { out.briefs.push(clone(br)); seen.add(key(br)); }
  out.briefs.sort((p, q) => (p.at < q.at ? -1 : p.at > q.at ? 1 : 0));
  out.messages = [...new Set([...out.messages, ...lose.messages])].slice(-LIMITS.messages);
  if (!out.assignedEmployee && lose.assignedEmployee && out.status !== 'declined') { out.assignedEmployee = lose.assignedEmployee; if (!out.status) out.status = 'assigned'; }
  return out;
}

/* ------------------------------------------------------------------ */
/* Chat lines (the human text on the envelope)                          */
/* ------------------------------------------------------------------ */

const namer = (names) => (id) => (names && typeof names === 'object' && typeof names[id] === 'string' && names[id]) || id;
const job = (p) => (p.stepId ? `${p.buildId} ${p.stepId}` : p.buildId);

/** One chat message (envelope + payload) for a payload; `names` maps agent ids to display names. */
export function messageFor(payload, { from, at, id = '', names = {} } = {}) {
  const p = normPayload(payload); if (!p) return null;
  const name = namer(names);
  let text = '';
  switch (p.type) {
    case 'ask': text = `Who can take ${job(p)}? Need: ${needText(p.need)}.`; break;
    case 'claim': text = `${name(p.by)} took ${job(p)} and opened the dialog.`; break;
    case 'candidates': text = `${job(p)}: ${p.candidates.map((c) => `${name(c.employee)} ${c.match}%`).join(', ')}. Veto until ${p.vetoDeadline}, then the top one has it.`; break;
    case 'veto': text = p.employee ? `Brett: ${name(p.employee)} takes ${job(p)}.` : `Brett vetoed ${job(p)}${p.note ? `: ${p.note}` : ''}.`; break;
    case 'pick': text = p.pickedBy === 'brett' ? `Brett picked ${name(p.employee)} for ${job(p)}.` : `${name(p.employee)}, ${job(p)} is yours (best match, nobody vetoed).`; break;
    case 'brief': text = `${name(p.by)} sent the ${p.kind} for ${job(p)} back: ${p.ref}.`; break;
    default: break;
  }
  return { ...(id ? { id } : {}), at: iso(at) || p.at, from: str(from, LIMITS.id), kind: CHAT_KIND, jobId: jobIdOf(p.buildId, p.stepId), text, assignment: p };
}

/* ------------------------------------------------------------------ */
/* JSON Schema                                                          */
/* ------------------------------------------------------------------ */

export function jsonSchemas() {
  const ts = { type: 'string', format: 'date-time', pattern: ISO_RE.source };
  const tsOrBlank = { anyOf: [ts, { const: '' }] };
  const agentId = { type: 'string', pattern: ID_RE.source };
  const agentOrBlank = { anyOf: [agentId, { const: '' }] };
  const strList = (max, len) => ({ type: 'array', maxItems: max, uniqueItems: true, items: { type: 'string', maxLength: len } });
  const need = { type: 'object', properties: { skills: strList(LIMITS.need, LIMITS.needItem), tools: strList(LIMITS.need, LIMITS.needItem), capabilities: strList(LIMITS.need, LIMITS.needItem) }, additionalProperties: false };
  const candidate = { type: 'object', required: ['employee', 'match'], properties: { employee: agentId, match: { type: 'integer', minimum: 0, maximum: 100 }, reasons: strList(LIMITS.reasons, LIMITS.reason) }, additionalProperties: false };
  const employee = { anyOf: [{ type: 'object', required: ['id'], properties: { id: agentId, name: { type: 'string', maxLength: LIMITS.name }, role: { type: 'string', maxLength: LIMITS.role }, skill: { type: 'string', maxLength: LIMITS.skill } }, additionalProperties: false }, { type: 'null' }] };
  const brief = { type: 'object', required: ['ref', 'kind', 'by', 'at'], properties: { ref: { type: 'string', maxLength: LIMITS.ref }, kind: { enum: BRIEF_KINDS }, by: agentId, at: ts, employee, message: { type: 'string', maxLength: LIMITS.id } }, additionalProperties: false };
  const base = (type, props, required = []) => ({
    type: 'object', required: ['type', 'buildId', ...(type === 'ask' ? [] : ['ask']), ...required],
    properties: { type: { const: type }, buildId: { type: 'string', maxLength: LIMITS.buildId }, stepId: { type: 'string', maxLength: LIMITS.stepId }, ask: { type: 'string', maxLength: LIMITS.id }, at: tsOrBlank, ...props },
    additionalProperties: false,
  });
  const payload = {
    oneOf: [
      base('ask', { need: { $ref: '#/$defs/need' } }, ['need']),
      base('claim', { by: agentId }, ['by']),
      base('candidates', { by: agentId, candidates: { type: 'array', minItems: 1, maxItems: LIMITS.candidates, items: { $ref: '#/$defs/candidate' } }, vetoDeadline: ts }, ['by', 'candidates', 'vetoDeadline']),
      base('veto', { by: { const: BRETT_ID }, employee: agentOrBlank, note: { type: 'string', maxLength: LIMITS.note } }),
      base('pick', { employee: agentId, pickedBy: { enum: ['brett', 'default'] } }, ['employee', 'pickedBy']),
      base('brief', { by: agentId, ref: { type: 'string', minLength: 1, maxLength: LIMITS.ref }, kind: { enum: BRIEF_KINDS }, employee }, ['by', 'ref']),
    ],
  };
  const record = {
    type: 'object', required: ['status', 'assignedEmployee'],
    properties: {
      status: { enum: STATUSES }, ask: { type: 'string', maxLength: LIMITS.id }, askedAt: tsOrBlank, need: { $ref: '#/$defs/need' },
      candidates: { type: 'array', maxItems: LIMITS.candidates, items: { $ref: '#/$defs/candidate' } },
      claimedBy: agentOrBlank, claimedAt: tsOrBlank, vetoDeadline: tsOrBlank, pickedBy: { enum: PICKERS }, pickedAt: tsOrBlank, assignedEmployee: agentOrBlank,
      briefs: { type: 'array', maxItems: LIMITS.briefs, items: { $ref: '#/$defs/brief' } }, messages: strList(LIMITS.messages, LIMITS.id), updatedAt: tsOrBlank,
    },
    additionalProperties: false,
  };
  const message = {
    type: 'object', required: ['from', 'kind', 'text', 'jobId', 'assignment'],
    description: 'A swarm-state@1 chat message (engines/swarm-rules.mjs normMessage) of kind "assignment" carrying one payload. jobId = <buildId> or <buildId>.<stepId>.',
    properties: {
      id: { type: 'string', maxLength: 40 }, at: tsOrBlank, from: { type: 'string', maxLength: 40 }, kind: { const: CHAT_KIND }, text: { type: 'string', minLength: 1, maxLength: 1000 },
      jobId: { type: 'string', maxLength: LIMITS.jobId }, vibe: { anyOf: [{ type: 'number' }, { type: 'null' }] }, toned: { type: 'boolean' }, assignment: { $ref: '#/$defs/payload' },
    },
  };
  return {
    'assignment.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'axf/assignment.schema.json', title: `AmberX AXF build assignment (${SCHEMA})`,
      description: 'Generated from framework/core/build-assignment.mjs. The orchestrator asks the group chat who can take a build or step; the first claimer opens the dialog of matching agents with match %; after the 90 s veto the best match has it by default; the employee sends its briefs back. One schema: the record on a builds@1 build / step ($defs.record), the typed payload ($defs.payload) and the chat message it rides on ($defs.message).',
      $ref: '#/$defs/record',
      $defs: { need, candidate, employee, brief, payload, record, message },
    },
  };
}
