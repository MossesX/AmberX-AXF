/**
 * Build orchestrator core (orchestrator@1). Pure: no fs, no DOM. Shared by the console page, the CLI
 * (../orchestrator.mjs), the server part and the tests.
 *
 * A build is a list of small steps (≤ 30 min), each pinned to Fable or Opus. Consecutive steps on the same model
 * form a phase. A phase whose model differs from the phase before it opens behind an approval gate: Brett approves
 * the model switch before the next session starts it. Token rules travel with every build: stay in the same
 * session, no sub-agents, and only the current phase goes into a brief.
 */

export const SCHEMA = 'orchestrator@1';
export const MODELS = ['Fable', 'Opus'];
export const STATUSES = ['pending', 'running', 'waiting', 'blocked', 'failed', 'complete', 'archived'];
export const STATUS_LABEL = { pending: 'Pending', running: 'Running', waiting: 'Needs approval', blocked: 'Blocked', failed: 'Failed', complete: 'Complete', archived: 'Archived' };
export const SORTS = ['status', 'added', 'built', 'left', 'next', 'category', 'title'];
export const SORT_LABEL = { status: 'Status', added: 'Date added', built: 'Date built', left: 'Time left', next: 'Next model', category: 'Category', title: 'Title' };
export const UNCATEGORISED = 'Uncategorised';
export const DEFAULT_RULES = { sameSession: true, subAgents: false, approveModelSwitch: true, maxStepMinutes: 30 };
/** When Fable is worth its price (shown on the page; the session picks a step's model from it). */
export const MODEL_GUIDE = {
  Fable: 'Cross-port contracts, kernel/engine internals, schema + migration design, heavy refactors, anything that changes how GUIs work across apps.',
  Opus: 'Everything else: plugin UI on the framework, servers, routes, tests, docs, wiring, security work.',
};

const now = () => new Date().toISOString();
const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
/** A step still to do: not done and not skipped by the build's feature matrix. */
const open = (s) => !s.done && !s.skip;
const slug = (t) => str(t, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'build';

/** "45 min", "2 h", "1.5 d", "90" → minutes (a day = 8 working hours), null when unreadable. */
export function estimateMinutes(e) {
  if (typeof e === 'number' && e > 0) return e;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?\s*$/i.exec(str(e, 30));
  if (!m) return null;
  const n = Number(m[1]); const u = (m[2] || 'min').toLowerCase();
  return Math.round(u.startsWith('h') ? n * 60 : u.startsWith('d') ? n * 480 : n);
}
export function formatMinutes(min) {
  if (!min) return '';
  if (min < 60) return `${min} min`;
  const h = min / 60; return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

function normStep(s, i) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    id: str(o.id, 40) || `s${i + 1}`,
    ...(str(o.uid, 60) ? { uid: str(o.uid, 60) } : {}), // builds@1 step record id: never changes (store, Steps view)
    ...(str(o.title, 200) ? { title: str(o.title, 200) } : {}), // a renamed step shows its title instead of its text
    text: str(o.text, 2000),
    model: MODELS.includes(o.model) ? o.model : 'Opus',
    why: str(o.why, 300),
    phase: str(o.phase, 80),
    group: str(o.group, 80),
    estimate: str(o.estimate, 20),
    files: Array.isArray(o.files) ? o.files.map((f) => str(f, 300)).filter(Boolean).slice(0, 30) : [],
    checks: Array.isArray(o.checks) ? o.checks.map((f) => str(f, 300)).filter(Boolean).slice(0, 20) : [],
    session: o.session === 'new' ? 'new' : 'same',
    agent: o.agent === true,
    skip: o.skip === true, // set by the feature matrix (feature-matrix@1): skipped when the build runs, never removed
    done: o.done === true,
    doneAt: o.done === true ? str(o.doneAt, 40) : '',
    note: str(o.note, 1000),
  };
}

function normBuild(b) {
  const o = b && typeof b === 'object' ? b : {};
  const steps = (Array.isArray(o.steps) ? o.steps : []).map(normStep);
  const seen = new Set();
  steps.forEach((s, i) => { if (seen.has(s.id)) s.id = `s${i + 1}-${i}`; seen.add(s.id); });
  return {
    id: str(o.id, 80) || slug(o.title),
    title: str(o.title, 300) || 'Untitled build',
    category: str(o.category, 60),
    detail: str(o.detail, 8000),
    status: STATUSES.includes(o.status) ? o.status : 'pending',
    hidden: o.hidden === true,
    source: str(o.source, 40) || 'console',
    pendingId: str(o.pendingId, 80),
    branch: str(o.branch, 200),
    pr: str(o.pr, 200),
    createdAt: str(o.createdAt, 40) || now(),
    updatedAt: str(o.updatedAt, 40) || now(),
    builtAt: o.status === 'complete' ? str(o.builtAt, 40) : '',
    notes: (Array.isArray(o.notes) ? o.notes : []).map((n) => ({ text: str(n?.text, 2000), at: str(n?.at, 40) })).filter((n) => n.text),
    approvals: (Array.isArray(o.approvals) ? o.approvals : []).map((a) => ({ phase: Number(a?.phase) || 0, from: str(a?.from, 10), to: str(a?.to, 10), at: str(a?.at, 40) })),
    steps,
  };
}

export function emptyState() { return { $axf: SCHEMA, updatedAt: now(), rules: { ...DEFAULT_RULES }, builds: [] }; }
export function normalizeState(s) {
  const o = s && typeof s === 'object' ? s : {};
  return { $axf: SCHEMA, updatedAt: str(o.updatedAt, 40) || now(), rules: { ...DEFAULT_RULES, ...(o.rules && typeof o.rules === 'object' ? o.rules : {}) }, builds: (Array.isArray(o.builds) ? o.builds : []).map(normBuild) };
}

/**
 * Steps → phases → groups. A phase is a run of consecutive steps with the same phase label and model (a step with
 * no label joins the run before it while the model stays the same). `gate` = this phase starts with a model switch.
 * Inside a phase, consecutive steps with the same group label form a group.
 */
export function phases(build) {
  const out = [];
  build.steps.forEach((s, i) => {
    const last = out[out.length - 1];
    const sameRun = last && last.model === s.model && (!s.phase || s.phase === last.label);
    if (sameRun) last.steps.push({ ...s, index: i });
    else out.push({ index: out.length, model: s.model, label: s.phase || '', steps: [{ ...s, index: i }], gate: !!last && last.model !== s.model, from: last?.model ?? '' });
  });
  for (const p of out) {
    p.name = p.label || `Phase ${p.index + 1}`;
    p.done = p.steps.every((s) => !open(s));
    p.approved = !p.gate || build.approvals.some((a) => a.phase === p.index && a.to === p.model);
    p.minutesLeft = p.steps.filter(open).reduce((t, s) => t + (estimateMinutes(s.estimate) ?? 0), 0);
    p.groups = [];
    for (const s of p.steps) {
      const g = p.groups[p.groups.length - 1];
      if (g && g.label === s.group) g.steps.push(s);
      else p.groups.push({ label: s.group, steps: [s] });
    }
    for (const g of p.groups) { g.done = g.steps.filter((s) => s.done).length; g.skipped = g.steps.filter((s) => s.skip).length; g.minutesLeft = g.steps.filter(open).reduce((t, s) => t + (estimateMinutes(s.estimate) ?? 0), 0); }
  }
  return out;
}

/** Every category in use, sorted, with counts (builds without one count as UNCATEGORISED). */
export function categories(builds) {
  const c = new Map();
  for (const b of builds) { const k = b.category || UNCATEGORISED; c.set(k, (c.get(k) ?? 0) + 1); }
  return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

/** What happens next: the first phase with work left, its next step, and whether a switch approval is needed. */
export function nextUp(build, rules = DEFAULT_RULES) {
  const ps = phases(build);
  const phase = ps.find((p) => !p.done) ?? null;
  if (!phase) return { phase: null, step: null, needsApproval: false, done: build.steps.length > 0 };
  const step = phase.steps.find(open) ?? null;
  const needsApproval = rules.approveModelSwitch !== false && phase.gate && !phase.approved;
  return { phase, step, needsApproval, done: false };
}

export function progress(build) {
  const total = build.steps.length; const done = build.steps.filter((s) => s.done).length; const skipped = build.steps.filter((s) => s.skip && !s.done).length;
  const left = build.steps.filter(open);
  const minutesLeft = left.reduce((t, s) => t + (estimateMinutes(s.estimate) ?? 0), 0);
  const byModel = Object.fromEntries(MODELS.map((m) => [m, left.filter((s) => s.model === m).reduce((t, s) => t + (estimateMinutes(s.estimate) ?? 0), 0)]));
  const switches = phases(build).filter((p) => p.gate).length;
  return { total, done, skipped, minutesLeft, byModel, switches };
}

/** Steps over the size limit or without an estimate (the small-steps rule). */
export function splitCheck(build, rules = DEFAULT_RULES) {
  const reasons = [];
  build.steps.forEach((s, i) => {
    const m = estimateMinutes(s.estimate);
    if (m == null) reasons.push(`step ${i + 1} has no estimate`);
    else if (m > (rules.maxStepMinutes || 30)) reasons.push(`step ${i + 1} is ${formatMinutes(m)}`);
  });
  if (!build.steps.length) reasons.push('no steps yet');
  // skipped steps (feature matrix) still have to be small: they may come back
  return { needsSplit: reasons.length > 0, reasons };
}

/** Status the build should show, from its steps (explicit blocked/failed/archived stay). */
export function derivedStatus(build, rules) {
  if (['blocked', 'failed', 'archived'].includes(build.status)) return build.status;
  if (!build.steps.length) return build.status; // nothing to derive from (e.g. a Pending item built before it had steps)
  if (build.status === 'complete' && !build.steps.some((s) => s.done)) return 'complete'; // built without ticking its steps
  const n = nextUp(build, rules);
  if (n.done) return 'complete';
  if (n.needsApproval) return 'waiting';
  return build.steps.some((s) => s.done) || build.status === 'running' ? 'running' : 'pending';
}

export function counts(builds) {
  const c = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const b of builds) c[b.status] += 1;
  return c;
}

const ORDER = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
export function sortBuilds(list, sort = 'status', dir = 'asc', rules) {
  const k = (b) => sort === 'category' ? (b.category || '~').toLowerCase() : sort === 'title' ? b.title.toLowerCase() : sort === 'added' ? b.createdAt : sort === 'built' ? (b.builtAt || '') : sort === 'left' ? progress(b).minutesLeft
    : sort === 'next' ? (nextUp(b, rules).step?.model ?? 'z') : ORDER[b.status];
  const out = [...list].sort((a, b) => { const x = k(a); const y = k(b); return x < y ? -1 : x > y ? 1 : a.createdAt < b.createdAt ? -1 : 1; });
  return dir === 'desc' ? out.reverse() : out;
}

/**
 * Brief for the next session: only the current phase (fewest tokens), the token rules, what to read first and how
 * to report. Paste it as the first message, or `node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief <id>`.
 */
export function brief(build, rules = DEFAULT_RULES) {
  const n = nextUp(build, rules);
  if (n.done) return `Build "${build.title}" (${build.id}) is complete.`;
  const p = n.phase;
  const files = [...new Set(p.steps.filter(open).flatMap((s) => s.files))];
  const checks = [...new Set(p.steps.filter(open).flatMap((s) => s.checks))];
  const lines = [
    `Continue build "${build.title}" (${build.id})${build.category ? ` [${build.category}]` : ''} — ${p.name}, model ${p.model}.`,
    n.needsApproval ? `STOP: this phase switches ${p.from} → ${p.model}. Ask Brett to approve the switch (card) before any work: orchestrator.mjs act approve ${build.id} ${p.index}.` : '',
    `Rules: ${rules.sameSession ? 'stay in this one session' : 'new session allowed'}; ${rules.subAgents ? 'sub-agents allowed' : 'no sub-agents'}; steps ≤ ${rules.maxStepMinutes} min; read only the files listed; stop at the end of this phase.`,
    build.branch ? `Branch: ${build.branch}${build.pr ? ` · PR ${build.pr}` : ''}` : '',
    `Steps in this phase (${p.steps.filter(open).length} left, ~${formatMinutes(p.minutesLeft) || '?'}):`,
    ...p.steps.map((s, i) => `${s.group && s.group !== p.steps[i - 1]?.group ? `— ${s.group} —\n` : ''}${s.done ? '[x]' : s.skip ? '[skip]' : '[ ]'} ${s.id} ${s.estimate ? `(~${s.estimate}) ` : ''}${s.text}${s.session === 'new' ? ' [needs a new session]' : ''}${s.agent ? ' [sub-agent allowed]' : ''}`),
    files.length ? `Read first: ${files.join(', ')}` : '',
    checks.length ? `Checks: ${checks.join(' · ')}` : '',
    `Tick each step: node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act step ${build.id} <stepId> done — then commit _claude/builds/orchestrator.json with your work.`,
    'Watch live: when you start on a screen, run `node framework/cli/axf.mjs focus <app> [route] [css-selector] --note "…"` so the live preview follows you.',
    'Screenshots that are not for approval (checking a screen, live captures, before/after): axf shot <file> --title "…" --app … --screen … --source check --session … (UI Review → Screenshots), never the review queue.',
  ];
  return lines.filter(Boolean).join('\n');
}

/** Apply one change. Returns { state, build?, log: string[] } or throws Error with a plain message. */
export function apply(state, change) {
  const s = normalizeState(state);
  const c = change && typeof change === 'object' ? change : {};
  const log = [];
  const find = () => { const b = s.builds.find((x) => x.id === c.id); if (!b) throw new Error(`no build "${c.id}"`); return b; };
  const stepOf = (b) => { const st = b.steps.find((x) => x.id === c.step) ?? b.steps[Number(c.index)]; if (!st) throw new Error(`no step "${c.step ?? c.index}" in ${b.id}`); return st; };
  let b = null;
  switch (c.action) {
    case 'add': {
      const id = slug(c.id || c.title); if (!str(c.title).trim()) throw new Error('a title is needed');
      if (s.builds.some((x) => x.id === id)) throw new Error(`"${id}" is already on the list`);
      b = normBuild({ ...c, id, status: 'pending', createdAt: now() }); s.builds.push(b); log.push(`added ${id} (${b.steps.length} steps)`); break;
    }
    case 'import': { // from a pending@1 item: its sub prompts become steps on the item's model
      const it = c.item ?? {}; const id = slug(c.id || it.id || it.title);
      if (s.builds.some((x) => x.id === id)) throw new Error(`"${id}" is already on the list`);
      const model = MODELS.includes(it.model) ? it.model : 'Opus';
      b = normBuild({ id, title: it.title, detail: it.detail, source: 'pending', pendingId: it.id, steps: (it.subPrompts ?? []).map((p) => ({ text: p.text, estimate: p.estimate, model, done: p.done, doneAt: p.doneAt })) });
      s.builds.push(b); log.push(`imported pending ${it.id} as ${id}`); break;
    }
    case 'update': { b = find(); for (const k of ['title', 'detail', 'branch', 'pr', 'category']) if (typeof c[k] === 'string') b[k] = str(c[k], k === 'detail' ? 8000 : k === 'category' ? 60 : 300); if (Array.isArray(c.steps)) b.steps = c.steps.map(normStep); log.push(`updated ${b.id}`); break; }
    case 'rename': { b = find(); const t = str(c.title, 300).trim(); if (!t) throw new Error('a build needs a name'); b.title = t; log.push(`${b.id} renamed "${t}"`); break; } // the id never changes
    case 'rename-step': { b = find(); const st = stepOf(b); const t = str(c.title, 200).trim(); if (!t) throw new Error('a step needs a name'); st.title = t; log.push(`${b.id} ${st.id} renamed "${t}"`); break; }
    case 'remove': { b = find(); s.builds = s.builds.filter((x) => x !== b); log.push(`removed ${b.id}`); break; }
    case 'status': { b = find(); if (!STATUSES.includes(c.status)) throw new Error(`unknown status ${c.status}`); b.status = c.status; b.builtAt = c.status === 'complete' ? now() : ''; log.push(`${b.id} → ${c.status}`); break; }
    case 'archive': { b = find(); b.status = 'archived'; log.push(`archived ${b.id}`); break; }
    case 'hide': case 'unhide': { b = find(); b.hidden = c.action === 'hide'; log.push(`${c.action} ${b.id}`); break; }
    case 'note': { b = find(); if (!str(c.text).trim()) throw new Error('empty note'); b.notes.push({ text: str(c.text, 2000), at: now() }); log.push(`note on ${b.id}`); break; }
    case 'step': { b = find(); const st = stepOf(b); const ps = phases(b); const ph = ps.find((p) => p.steps.some((x) => x.id === st.id));
      if (c.done !== false && ph && ph.gate && !ph.approved && s.rules.approveModelSwitch !== false) throw new Error(`phase ${ph.index + 1} switches ${ph.from} → ${ph.model}: approve the switch first`);
      st.done = c.done !== false; st.doneAt = st.done ? now() : ''; if (typeof c.note === 'string') st.note = str(c.note, 1000); log.push(`${b.id} ${st.id} ${st.done ? 'done' : 'not done'}`); break; }
    case 'add-step': { b = find(); const st = normStep({ ...c.stepData, id: `s${b.steps.length + 1}` }, b.steps.length); if (!st.text) throw new Error('step text needed'); const at = Number.isInteger(c.at) ? c.at : b.steps.length; b.steps.splice(at, 0, st); log.push(`${b.id} + ${st.id}`); break; }
    case 'edit-step': { b = find(); const st = stepOf(b); Object.assign(st, normStep({ ...st, ...c.stepData, id: st.id, done: st.done, doneAt: st.doneAt }, 0)); log.push(`${b.id} ${st.id} edited`); break; }
    case 'skip-step': { b = find(); const st = stepOf(b); st.skip = c.skip !== false; log.push(`${b.id} ${st.id} ${st.skip ? 'skipped' : 'back in'}`); break; } // the feature matrix's view of a step; the step stays
    case 'remove-step': { b = find(); const st = stepOf(b); b.steps = b.steps.filter((x) => x !== st); log.push(`${b.id} − ${st.id}`); break; }
    case 'move-step': { b = find(); const st = stepOf(b); const i = b.steps.indexOf(st); const j = i + (c.dir === 'up' ? -1 : 1); if (j >= 0 && j < b.steps.length) { b.steps.splice(i, 1); b.steps.splice(j, 0, st); } log.push(`${b.id} ${st.id} moved ${c.dir}`); break; }
    case 'approve': { b = find(); const p = phases(b)[Number(c.phase)]; if (!p || !p.gate) throw new Error('that phase has no model switch to approve');
      if (!p.approved) b.approvals.push({ phase: p.index, from: p.from, to: p.model, at: now() }); log.push(`${b.id}: switch ${p.from} → ${p.model} approved (phase ${p.index + 1})`); break; }
    case 'rules': { for (const k of Object.keys(DEFAULT_RULES)) if (k in (c.rules ?? {})) s.rules[k] = typeof DEFAULT_RULES[k] === 'number' ? Math.max(5, Math.min(240, Number(c.rules[k]) || 30)) : c.rules[k] === true; log.push('rules saved'); break; }
    default: throw new Error(`unknown action ${c.action}`);
  }
  if (b && s.builds.includes(b)) { b.updatedAt = now(); const st = derivedStatus(b, s.rules); if (st !== b.status && !(c.action === 'status')) { if (st === 'complete') b.builtAt = now(); b.status = st; } }
  s.updatedAt = now();
  return { state: s, build: b && s.builds.includes(b) ? b : undefined, log };
}
