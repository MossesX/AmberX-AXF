/**
 * swarm-chat — the agent swarm's group chat contract (Brett, Oct 31 2026: one room where Boss hands out jobs, agents
 * report, and the crew talks like Amber; Fable rebuild Nov 3 2026).
 *
 * Three things every port must agree on:
 *   1. Messages (swarm-state@1 `messages`, shape in swarm-rules.mjs): who may speak and what each kind must carry.
 *      Work kinds are built from orchestrator data and agent reports (no tokens); `banter` is the crew's own voice;
 *      `brett` is the boss's boss. A work line about a job names it (`jobId`).
 *   2. Boss's work lines: one builder per moment (assign, lease, report, handoff, merge, status, pay, discipline,
 *      hire, waiting) so the same event reads the same everywhere. Builders take a `names` map (id → display name),
 *      never a roster, so they stay pure and cheap.
 *   3. The banter batch: the zero-token bank (deterministic from a seed), who reacts to what, the prompt for one
 *      cheap model batch and how its answer is read back ([{ agent, text }], real agents only, capped).
 *
 * Posting goes through `post(state, msgs, at, filter)`: the switches (room, per agent) decide what is kept; `filter`
 * is the vibe engine's hook (swarm-vibe.mjs) and may tone a line down or drop it. Pure, no I/O, no clock.
 * Fixture: framework/spec/fixtures/swarm-chat.json (check-swarm.mts). Kotlin twin deferred (PORTING.md).
 */

import { BOSS, BRETT, CHAT_KINDS, WORK_KINDS, SWARM, normMessage } from './swarm-rules.mjs';

export { BOSS, BRETT, CHAT_KINDS, WORK_KINDS };

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const err = (field, code, message) => ({ field, code, message });

/* ------------------------------------------------------------------ */
/* 1. Messages: who may say what                                        */
/* ------------------------------------------------------------------ */

/** Kinds Boss posts (a `handoff` from Boss hands a clash to the merge fixer); kinds an agent posts about its own run; what Brett posts. */
export const SPEAKERS = {
  boss: ['assign', 'lease', 'merge', 'handoff', 'status', 'discipline', 'pay', 'session', 'handover', 'claim'],
  agent: ['report', 'handoff', 'banter', 'discipline', 'pay', 'session', 'handover', 'claim'],
  brett: ['brett'],
};
/** The Sessions channel's kinds (Session sync plugin, session-link@1): what two Claude sessions and the orchestrator post. */
export const SESSION_KINDS = ['session', 'handover', 'claim', 'report'];
/** Work kinds that are about one job and must name it. */
export const JOB_KINDS = ['assign', 'lease', 'report', 'handoff'];
export const BANTER_MAX_CHARS = 200;
export const BANTER_PROMPT_LINE_CHARS = 140;
export const BANTER_BATCH_MAX = 20;
export const BANTER_RECENT = 12;

/** Problems with one message before it is posted: speaker, kind, job reference, text. `agents` = ids who may speak. */
export function messageErrors(m, agents = [], p = 'message') {
  if (!isObj(m)) return [err(p, 'invalid', `${p} must be an object`)];
  const out = [];
  const from = str(m.from, 40);
  const who = from === BOSS.id ? 'boss' : from === BRETT ? 'brett' : agents.includes(from) ? 'agent' : '';
  if (!from) out.push(err(`${p}.from`, 'missing', `${p}.from is missing`));
  else if (!who) out.push(err(`${p}.from`, 'invalid', `${p}.from "${from}" is not Boss, Brett or an agent on the roster`));
  if (!CHAT_KINDS.includes(m.kind)) out.push(err(`${p}.kind`, m.kind === undefined ? 'missing' : 'invalid', `${p}.kind must be one of ${CHAT_KINDS.join(', ')}`));
  else if (who && !SPEAKERS[who].includes(m.kind)) out.push(err(`${p}.kind`, 'invalid', `${p}: ${who === 'agent' ? from : who} cannot post a "${m.kind}" line (${who} posts ${SPEAKERS[who].join(', ')})`));
  if (JOB_KINDS.includes(m.kind) && !str(m.jobId, 120)) out.push(err(`${p}.jobId`, 'missing', `${p}: a "${m.kind}" line names its job (jobId)`));
  if (typeof m.text !== 'string' || !m.text.trim()) out.push(err(`${p}.text`, 'missing', `${p}.text is missing`));
  else if (m.text.length > SWARM.chat.textMax) out.push(err(`${p}.text`, 'invalid', `${p}.text is longer than ${SWARM.chat.textMax} characters`));
  return out;
}

/** Is this speaker's voice on? Boss and Brett only need the room switch; an agent also needs its own. */
export const chatOn = (state, from, channel = '') => channel === 'sessions' || (state.chat.enabled && (from === BOSS.id || from === BRETT || state.chat.agents[from] !== false));

/**
 * Post messages into the state. Room off = nothing kept and nothing spent; an agent switched off stays quiet while
 * Boss still posts its work. `filter(msg)` (the vibe engine) returns the message to keep, or null to drop it. Ids are
 * `m<epoch ms>-<index>` so replays match. Returns how many were posted.
 */
export function post(state, msgs, at, filter = (m) => m) {
  let n = 0;
  for (const raw of Array.isArray(msgs) ? msgs : []) {
    if (!raw?.text || !chatOn(state, raw.from, raw.channel)) continue; // the Sessions channel is a work record: kept even when the room is off
    const m = filter(raw);
    if (!m) continue;
    const id = `m${Date.parse(at) || 0}-${state.messages.length}`;
    state.messages.push(normMessage({ ...m, id, at: m.at || at }, state.messages.length)); n += 1;
  }
  if (state.messages.length > SWARM.chat.max) state.messages.splice(0, state.messages.length - SWARM.chat.max);
  return n;
}

/* ------------------------------------------------------------------ */
/* 2. Boss's work lines (and the crew's own report lines)               */
/* ------------------------------------------------------------------ */

/** Display names: a map, a roster ({ agents }) or a function; Boss and Brett are always known. */
export function namer(names) {
  const map = typeof names === 'function' ? null : names && Array.isArray(names.agents) ? new Map(names.agents.map((a) => [a.id, a.name])) : names instanceof Map ? names : new Map(Object.entries(isObj(names) ? names : {}));
  return (id) => (id === BOSS.id ? BOSS.name : id === BRETT ? 'Brett' : (typeof names === 'function' ? names(id) : map.get(id)) || id);
}
export const fileList = (l) => (l.length ? (l.length > 3 ? `${l.slice(0, 3).join(', ')} +${l.length - 3}` : l.join(', ')) : 'no files named');
const usd = (v) => `$${(Number(v) || 0) < 10 ? (Number(v) || 0).toFixed(2) : Math.round(Number(v) || 0)}`;
const tokens = (v) => { const n = Number(v) || 0; return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n); };
const MODEL_WORD = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' };

/** Boss hands a build job out: task, files, model, budget. */
export function assignLine(job, names) {
  const name = namer(names);
  return { from: BOSS.id, kind: 'assign', jobId: job.id, text: `${name(job.agent)}, you got ${job.id}: ${str(job.text, 160)}. Files: ${fileList(job.leases)}. Model ${MODEL_WORD[job.model] ?? job.model}, budget ${tokens(job.budget.tokens)} tokens / ${job.budget.maxTurns} turns.` };
}
/** Boss's lease decisions for a plan: who waits for whom, over which files. `overlap(a, b)` is the planner's lease test. */
export function leaseLines(plan, names, overlap = (a, b) => a.some((x) => b.includes(x))) {
  const name = namer(names); const out = [];
  for (const j of plan.jobs) {
    if (!j.after.length) continue;
    const e = plan.jobs.find((x) => x.id === j.after[j.after.length - 1]);
    const shared = e ? j.leases.filter((f) => e.leases.some((l) => overlap([f], [l]))) : [];
    out.push({ from: BOSS.id, kind: 'lease', jobId: j.id, text: `${name(j.agent)} waits on ${name(e?.agent)} (${e?.id}): ${shared.length ? `both want ${fileList(shared)}` : 'same agent or no files named'}. Wave ${j.wave + 1}.` });
  }
  return out;
}
/** The agent's own report line, and its handoff when it left one. */
export function reportLines(run) {
  const r = run.report; const who = run.agent;
  const head = run.status === 'done' ? `Done with ${run.jobId}` : run.status === 'killed' ? `Got killed on ${run.jobId}: ${run.reason}` : run.status === 'blocked' ? `Blocked on ${run.jobId}` : `Failed ${run.jobId}${run.reason ? `: ${run.reason}` : ''}`;
  const out = [{ from: who, kind: 'report', jobId: run.jobId, text: `${head}.${r?.summary ? ` ${r.summary}` : ''}${r?.question ? ` Q for Brett: ${r.question}` : ''}` }];
  if (r?.handoff) out.push({ from: who, kind: 'handoff', jobId: run.jobId, text: `Handoff: ${r.handoff}` });
  return out;
}
/** After a batch merge: what went in, who cleans up a clash, what was refused for leaving its lease. `fixer` = the merge fixer's id. */
export function mergeLines(res, names, fixer = 'max') {
  const name = namer(names); const out = [];
  if (res.merged.length) out.push({ from: BOSS.id, kind: 'merge', text: `Merged ${res.merged.join(', ')} into ${res.branch}.` });
  for (const c of res.conflicts) out.push({ from: BOSS.id, kind: 'handoff', jobId: c.fixer, text: `${name(fixer)}, ${c.job} clashed on ${fileList(c.files)}. Clean it up (${c.fixer}).` });
  for (const r of res.refused) out.push({ from: BOSS.id, kind: 'lease', jobId: r.job, text: `${r.job} touched files outside its lease (${fileList([...r.outside, ...r.shared])}). Not merging that.` });
  return out;
}
/** Boss on a status change Brett made. */
export const statusLine = (agentId, label, note, names) => ({ from: BOSS.id, kind: 'status', text: `${namer(names)(agentId)} is now ${label}${note ? `: ${str(note, 200)}` : ''}.` });
/** Boss on a raise, a dock, a top-up or a bonus. */
export function payLine(kind, agentId, v, names) {
  const name = namer(names)(agentId);
  if (kind === 'raise') return { from: BOSS.id, kind: 'pay', text: `${name} gets a raise: ${usd(v.from)} → ${usd(v.to)} a week.${v.note ? ` ${str(v.note, 200)}` : ''}` };
  if (kind === 'dock') return { from: BOSS.id, kind: 'pay', text: `${name} got docked: ${usd(v.from)} → ${usd(v.to)} a week.${v.note ? ` ${str(v.note, 200)}` : ''}` };
  if (kind === 'topup') return { from: BOSS.id, kind: 'pay', text: `Brett topped ${name} up by ${usd(v.usd)} this week.` };
  return { from: BOSS.id, kind: 'pay', text: `${name} finished ${v.jobId} for ${usd(v.cost)}, ${usd(v.usd)} under budget. Bonus.` };
}
/** An agent saying it is broke till payday (once a pay period). */
export const brokeLine = (agentId, p) => ({ from: agentId, kind: 'pay', text: `I'm broke. Spent ${usd(p.spent)} of ${usd(p.salary + p.topups)} this week, so no more jobs till payday (${p.payday.slice(0, 10)}) unless Brett tops me up.` });
/** Boss on discipline: a suspension, its end, a rehire, medical leave over; the agent's own rage-quit and Boss's line after it. */
export function disciplineLines(moment, agentId, v = {}, names) {
  const name = namer(names)(agentId);
  switch (moment) {
    case 'suspend': return [{ from: BOSS.id, kind: 'discipline', text: `${name} is suspended until ${str(v.until, 40).slice(0, 16).replace('T', ' ')} UTC. Reason: ${str(v.reason, 300)}.` }];
    case 'suspension-over': return [{ from: BOSS.id, kind: 'discipline', text: `${agentId}'s suspension is over. Back on duty.` }];
    case 'back-from-leave': return [{ from: BOSS.id, kind: 'status', text: `${agentId} is back from medical leave and on duty.` }];
    case 'rehire': return [{ from: BOSS.id, kind: 'discipline', text: `${name} is rehired and back on duty. Don't make me regret it.` }];
    case 'quit': return [{ from: agentId, kind: 'discipline', text: `That's ${v.streak} in a row. I'm DONE with this shit. I quit.` }, { from: BOSS.id, kind: 'discipline', text: `${name} rage-quit. No jobs till Brett rehires.` }];
    default: return [];
  }
}
/** Boss on a hire for a job type, and on new ID cards for everybody. */
export const hiredLine = (agentName, jobName) => ({ from: BOSS.id, kind: 'status', text: `Hired ${agentName} to own ${jobName}. Welcome to the crew.` });
export const newCardsLine = (designName) => ({ from: BOSS.id, kind: 'status', text: `New ID cards for everybody${designName ? ` (${str(designName, 60)})` : ''}. Smile, assholes.` });
/** Boss when the agent cap has an agent waiting for a desk. */
export const waitingLine = (agentName, q) => ({ from: BOSS.id, kind: 'status', text: `${agentName} is waiting for a desk (position ${q.position} in the queue, ${q.used}/${q.cap} running).` });
/** Boss hands a job type out (agent jobs), and when nobody can take it. */
export const assignJobLine = (jobName, agentName, model, budgetTokens, cap, jobTypeId) => ({ from: BOSS.id, kind: 'assign', jobId: jobTypeId, text: `${agentName}, you're on ${jobName}. ${model}, up to ${tokens(budgetTokens)} tokens (${usd(cap)}).` });
export const unassignedLine = (jobName, why, jobTypeId) => ({ from: BOSS.id, kind: 'assign', jobId: jobTypeId, text: `${jobName} has nobody: ${why}.` });

/* ------------------------------------------------------------------ */
/* 3. Banter: the bank, who reacts, the cheap batch                     */
/* ------------------------------------------------------------------ */

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
export const BANTER_MOMENTS = Object.keys(BANTER);

const hash = (seed, k) => { let h = 0; for (const ch of String(seed)) h = (h * k + ch.charCodeAt(0)) >>> 0; return h; };

/** Pick a banter line (deterministic from `seed`, so tests and replays match); an unknown moment reads as idle. */
export function banterLine(moment, seed, vars = {}) {
  const pool = BANTER[moment] ?? BANTER.idle;
  return pool[hash(seed, 31) % pool.length].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? k);
}

/** Coworkers who react to an event (not the subject; switched-on, still-employed agents), up to `n`, deterministic from `seed`. */
export function reactors(state, roster, subject, n, seed) {
  const pool = roster.agents.filter((a) => a.id !== subject && chatOn(state, a.id) && !['fired', 'quit'].includes(state.agents[a.id]?.status));
  const h = hash(seed, 33);
  return Array.from({ length: Math.min(n, pool.length) }, (_, i) => pool[(h + i * 3) % pool.length]).filter((a, i, arr) => arr.indexOf(a) === i);
}

/** Prompt for one cheap batch of banter lines (one turn, no tools): the crew, the recent room, the rules, the JSON shape. */
export function banterPrompt(roster, recent, n = 6) {
  const who = roster.agents.map((a) => `${a.id} (${a.name}, ${a.role}): "${a.catchphrase}"`).join('\n');
  const lines = (Array.isArray(recent) ? recent : []).slice(-BANTER_RECENT).map((m) => `${m.from}: ${m.text}`).join('\n');
  return `Write ${n} short group-chat lines between these coworkers, reacting to the recent work below. Amber's voice: blunt street slang, cussing, wild, funny about the work. Never joke about race, ethnicity, religion, gender, sexuality or any other identity. One line each, under ${BANTER_PROMPT_LINE_CHARS} characters.\nCoworkers:\n${who}\nRecent:\n${lines || '(quiet day)'}\nAnswer only JSON: [{"agent":"<id>","text":"…"}]`;
}
/** Read a batch back: the first JSON list in the text; only real agents, text capped, at most BANTER_BATCH_MAX lines. */
export function parseBanter(text, roster) {
  const m = /\[[\s\S]*\]/.exec(str(text, 20000)); if (!m) return [];
  try { return JSON.parse(m[0]).filter((x) => roster.agents.some((a) => a.id === x?.agent) && typeof x.text === 'string' && x.text.trim()).slice(0, BANTER_BATCH_MAX).map((x) => ({ from: x.agent, kind: 'banter', text: str(x.text, BANTER_MAX_CHARS) })); }
  catch { return []; }
}
