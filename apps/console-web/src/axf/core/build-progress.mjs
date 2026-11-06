/**
 * build-progress-core — where a running build is, written by the session that runs it (build-progress@1). Pure, IO-free.
 *
 * Brett, Nov 6 2026 (voice): every headless build session writes its progress to a small status file and never stops
 * to update the console; the console reads it when it needs to.
 *
 * One file per build, `<progress dir>/<build id>.json` (framework/cli/build-progress.mjs resolves the dir):
 *
 *   {
 *     $axf:      'build-progress@1'
 *     build:     the orchestrator build id
 *     title:     the build's title (copied at registration, for people reading the file)
 *     status:    pending | running | blocked | failed | stopped | done
 *     current:   the step being worked on ('' = none yet / finished)
 *     steps:     [{ id, text, state: pending|running|done|skipped|failed, at, note, commit }]   order = the build's
 *     notes:     [{ at, text }]  newest last, at most MAX_NOTES
 *     session:   tmux / Claude session name ('' until a run starts)
 *     agent:     the crew agent running it
 *     worktree:  the checkout the run works in (host path)
 *     branch, pr: what the run pushed (PR as '#123' or '')
 *     startedAt, updatedAt: ISO
 *     folded:    { at, steps: [ids] }  what the reconciler last copied into the builds store
 *   }
 *
 * Writing it is a local file write (no git, no network, no lock on the builds store), so a session records a step and
 * carries straight on. The zero-token reconciler (framework/cli/builds-reconcile.mjs) folds it into the builds store
 * (`foldPlan`: steps marked done there are ticked, branch / PR linked) and treats a recent `updatedAt` as a live run.
 */

export const SCHEMA = 'build-progress@1';
export const STATUSES = ['pending', 'running', 'blocked', 'failed', 'stopped', 'done'];
export const STEP_STATES = ['pending', 'running', 'done', 'skipped', 'failed'];
export const MAX_NOTES = 50;
export const MAX_NOTE = 1000;
/** A file updated within this many minutes counts as a live run (same window as build-log heartbeats). */
export const FRESH_MIN = 15;

const str = (v, max = 300) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '');
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
export const validId = (id) => ID.test(str(id, 200));

function normStep(s, i) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    id: str(o.id, 40) || `s${i + 1}`,
    text: str(o.text, 400),
    state: STEP_STATES.includes(o.state) ? o.state : 'pending',
    at: iso(o.at),
    note: str(o.note, MAX_NOTE),
    commit: /^[0-9a-f]{7,40}$/.test(str(o.commit)) ? o.commit : '',
  };
}

/** Any input (a parsed file, {}, garbage) -> a valid build-progress@1 object. */
export function normalize(p, buildId = '') {
  const o = p && typeof p === 'object' ? p : {};
  const steps = (Array.isArray(o.steps) ? o.steps : []).map(normStep);
  const pr = str(o.pr, 20); const prN = (pr.match(/(\d+)$/) ?? [])[1];
  return {
    $axf: SCHEMA,
    build: str(o.build, 120) || buildId,
    title: str(o.title, 300),
    status: STATUSES.includes(o.status) ? o.status : 'pending',
    current: str(o.current, 40),
    steps,
    notes: (Array.isArray(o.notes) ? o.notes : []).filter((n) => n && str(n.text).trim()).map((n) => ({ at: iso(n.at), text: str(n.text, MAX_NOTE) })).slice(-MAX_NOTES),
    session: str(o.session, 120), agent: str(o.agent, 80), worktree: str(o.worktree, 400),
    branch: str(o.branch, 200), pr: prN ? `#${prN}` : '',
    startedAt: iso(o.startedAt), updatedAt: iso(o.updatedAt),
    folded: { at: iso(o.folded?.at), steps: (Array.isArray(o.folded?.steps) ? o.folded.steps : []).map((x) => str(x, 40)).filter(Boolean) },
  };
}

/** Problems with a file as written (empty = valid). Used by the CLI's `check` and the spec test. */
export function validate(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['not an object'];
  if (p.$axf !== SCHEMA) errs.push(`$axf must be ${SCHEMA}`);
  if (!validId(p.build)) errs.push('build: a build id is needed');
  if (!STATUSES.includes(p.status)) errs.push(`status: one of ${STATUSES.join(', ')}`);
  if (!Array.isArray(p.steps)) errs.push('steps: an array');
  else p.steps.forEach((s, i) => { if (!str(s?.id)) errs.push(`steps[${i}].id missing`); if (!STEP_STATES.includes(s?.state)) errs.push(`steps[${i}].state: one of ${STEP_STATES.join(', ')}`); });
  if (p.current && Array.isArray(p.steps) && !p.steps.some((s) => s.id === p.current)) errs.push(`current: ${p.current} is not a step`);
  if (!Array.isArray(p.notes)) errs.push('notes: an array');
  return errs;
}

/** The file a build gets on registration: its steps, all pending (done ones as done). Keeps what `prev` already says. */
export function seed(build, prev = null, now = new Date().toISOString()) {
  const p = normalize(prev, build.id);
  const had = new Map(p.steps.map((s) => [s.id, s]));
  p.build = build.id; p.title = str(build.title, 300) || p.title;
  p.steps = (build.steps ?? []).map((s, i) => {
    const old = had.get(s.id);
    const st = normStep({ id: s.id, text: s.title || s.text, state: s.done ? 'done' : s.skip ? 'skipped' : 'pending', at: s.doneAt }, i);
    return old && old.state !== 'pending' ? { ...st, state: s.done ? 'done' : old.state, at: old.at || st.at, note: old.note, commit: old.commit } : st;
  });
  if (p.current && !p.steps.some((s) => s.id === p.current)) p.current = '';
  if (!p.updatedAt) p.updatedAt = now;
  return p;
}

/**
 * One change from a session: { step, state, note, commit } | { status } | { note } | { branch, pr, session, agent,
 * worktree }. Returns the new object (the input is not changed). A step set running becomes `current`; a step done
 * moves `current` on to the next open step. Unknown steps are added (a session may split a step).
 */
export function apply(prev, change, now = new Date().toISOString()) {
  const p = normalize(JSON.parse(JSON.stringify(prev ?? {})), str(change?.build, 120));
  const c = change && typeof change === 'object' ? change : {};
  if (c.step) {
    const id = str(c.step, 40); let st = p.steps.find((s) => s.id === id);
    if (!st) { st = normStep({ id }, p.steps.length); p.steps.push(st); }
    if (c.state) { if (!STEP_STATES.includes(c.state)) throw new Error(`state must be one of ${STEP_STATES.join(', ')}`); st.state = c.state; st.at = now; }
    if (typeof c.text === 'string' && c.text.trim()) st.text = str(c.text, 400);
    if (typeof c.note === 'string' && c.note.trim()) st.note = str(c.note, MAX_NOTE);
    if (c.commit && /^[0-9a-f]{7,40}$/.test(str(c.commit))) st.commit = c.commit;
    if (st.state === 'running') p.current = st.id;
    else if (p.current === st.id || !p.current) p.current = (p.steps.find((s) => s.state === 'running') ?? p.steps.find((s) => s.state === 'pending'))?.id ?? '';
    if (p.status === 'pending' && ['running', 'done'].includes(st.state)) p.status = 'running';
  } else if (typeof c.note === 'string' && c.note.trim()) {
    p.notes.push({ at: now, text: str(c.note, MAX_NOTE) }); p.notes = p.notes.slice(-MAX_NOTES);
  }
  if (c.status) {
    if (!STATUSES.includes(c.status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
    p.status = c.status; if (c.status === 'done') p.current = '';
  }
  for (const k of ['session', 'agent', 'worktree', 'branch', 'title']) if (typeof c[k] === 'string' && c[k]) p[k] = str(c[k], k === 'worktree' ? 400 : 200);
  if (c.pr) { const n = (str(c.pr).match(/(\d+)$/) ?? [])[1]; if (n) p.pr = `#${n}`; }
  if (p.status === 'running' && !p.startedAt) p.startedAt = now;
  p.updatedAt = now;
  return p;
}

/** True when the file was written within `freshMin` minutes (a live run). */
export function isFresh(p, now = new Date().toISOString(), freshMin = FRESH_MIN) {
  const t = Date.parse(str(p?.updatedAt));
  return Number.isFinite(t) && Date.parse(now) - t < freshMin * 60000 && !['done', 'failed', 'stopped'].includes(p?.status);
}

/**
 * What folding this file into the builds store changes on `build` (a builds@1 record): steps the file says are done
 * and the store doesn't, branch / PR when the store has none. { steps: [ids], stepNotes: {id: note}, set: {branch?,
 * pr?}, why: [..] } — empty lists = nothing to do. The store side applies it (builds-reconcile).
 */
export function foldPlan(build, p) {
  const out = { steps: [], stepNotes: {}, set: {}, why: [] };
  if (!build || !p || p.build !== build.id) return out;
  for (const s of p.steps) {
    if (s.state !== 'done') continue;
    const st = (build.steps ?? []).find((x) => x.id === s.id);
    if (st && !st.done) { out.steps.push(s.id); out.stepNotes[s.id] = s.note || `progress file${s.commit ? ` (${s.commit.slice(0, 9)})` : ''}`; }
  }
  if (p.branch && !str(build.branch)) out.set.branch = p.branch;
  if (p.pr && !str(build.pr)) out.set.pr = p.pr;
  if (out.steps.length) out.why.push(`progress file: ${out.steps.join(', ')} done`);
  if (out.set.branch) out.why.push(`branch ${out.set.branch}`);
  if (out.set.pr) out.why.push(`PR ${out.set.pr}`);
  return out;
}

/** A one-line summary for lists and the console ("s3 running · 2/8 done · 4 min ago"). */
export function summary(p, now = new Date().toISOString()) {
  if (!p) return 'no progress file';
  const done = p.steps.filter((s) => s.state === 'done').length;
  const cur = p.steps.find((s) => s.id === p.current);
  const ago = p.updatedAt ? Math.max(0, Math.round((Date.parse(now) - Date.parse(p.updatedAt)) / 60000)) : null;
  return [p.status, cur ? `${cur.id} ${cur.state}` : '', `${done}/${p.steps.length} done`, ago == null ? '' : ago < 1 ? 'just now' : ago < 120 ? `${ago} min ago` : `${Math.round(ago / 60)} h ago`].filter(Boolean).join(' · ');
}
