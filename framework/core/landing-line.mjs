/**
 * Landing line (landing-line@1). Brett, Nov 14 2026: "We gotta get rid of that merge tier and start landing them one
 * at a time." The merge queue's stacks and batches go; what replaces them is one ordered line of finished builds / PRs,
 * landed one after the other, each on the main it will actually sit on. Pure: no IO, no git, no model. The host runner
 * (push-banner's lander), the console view, the CLI and the voice side all read these rules and nothing else.
 *
 * One entry at a time:
 *   waiting → merging-main → regenerating → checking → landing → landed
 *                 │               │             │          └→ merging-main   (main moved under it: once more)
 *                 └→ fix-filed    └→ fix-filed  ├→ checking (cancelled / superseded / stale run: not a result, re-run)
 *                                                └→ fix-filed (failure / timed_out: red)
 *   any live state → paused (by hand) → waiting (resume);  any live state → skipped (by hand, out of the line)
 *   fix-filed → waiting when the fix lands on the branch (new head)
 * Exactly one entry is in flight (merging-main, regenerating, checking, landing); nothing is stacked on it. When an entry
 * goes red a fix build is filed for it and the line moves on to the next one at once.
 *
 * A cancelled, superseded or stale CI run is never a verdict: a result is only success (green) or failure / timed_out
 * (red). Everything else re-runs on the same head and is logged as a retry on the attempt, never as a failure.
 */

export const LINE_FRAME = 'landing-line@1';
export const ENTRY_FRAME = 'landing-entry@1';
export const ATTEMPT_FRAME = 'landing-attempt@1';

/** Every state an entry can be in, in line order. */
export const STATES = Object.freeze(['waiting', 'merging-main', 'regenerating', 'checking', 'landing', 'landed', 'fix-filed', 'skipped', 'paused']);
/** The states that hold the one slot: while one entry is in any of them no other entry starts. */
export const IN_FLIGHT = Object.freeze(['merging-main', 'regenerating', 'checking', 'landing']);
/** States an entry leaves the line from (kept in history, never started again). */
export const TERMINAL = Object.freeze(['landed', 'skipped']);
/** States an entry can still be moved, paused or skipped from. */
export const LIVE = Object.freeze(['waiting', 'merging-main', 'regenerating', 'checking', 'landing', 'paused', 'fix-filed']);
export const STATE_LABEL = Object.freeze({
  waiting: 'Waiting', 'merging-main': 'Merging main in', regenerating: 'Regenerating', checking: 'Checking', landing: 'Landing',
  landed: 'Landed', 'fix-filed': 'Fix filed', skipped: 'Skipped', paused: 'Paused',
});
export const STATE_TONE = Object.freeze({
  waiting: 'muted', 'merging-main': 'info', regenerating: 'info', checking: 'info', landing: 'accent',
  landed: 'ok', 'fix-filed': 'danger', skipped: 'muted', paused: 'warn',
});

/** How one attempt ended. */
export const ATTEMPT_RESULTS = Object.freeze(['landed', 'retry', 'red', 'conflict', 'aborted']);

/**
 * Events the runner and the hands (console, CLI, MCP, voice) send. `by` on a hand event says who (Brett, an agent).
 *   add            a finished build / PR joins at the back        { entry }
 *   start          the first waiting entry takes the slot          (the runner)
 *   merged-main    main merged into the branch                     { sha }
 *   conflict       merging main hit a code conflict → fix-filed    { files }
 *   regenerated    fixtures / locks regenerated, pushed            { head }
 *   check          a CI run on the head was seen                   { run } | { runs }  (classifyCheckRun decides)
 *   main-moved     main changed in code while it was checking      { mainSha }  → merging-main again
 *   land           CI green → merging the PR                       (the runner)
 *   landed         the PR is on main                               { sha }
 *   land-rejected  GitHub refused the merge (main moved)           { why }  → merging-main again
 *   pause          by hand                                         { why, by }
 *   resume         by hand                                         { by }  → waiting
 *   skip           by hand, out of the line                        { why, by }
 *   move           by hand, to an index among the live entries     { to, by }  (0 = front; the in-flight entry stays ahead)
 *   rejoin         a fix landed on the branch                      { head }  fix-filed → waiting
 *   remove         the PR closed or the build was cancelled        { why }
 *   on / off       the whole line runs or holds                    { by }
 */
export const EVENTS = Object.freeze(['add', 'start', 'merged-main', 'conflict', 'regenerated', 'check', 'main-moved', 'land', 'landed', 'land-rejected', 'pause', 'resume', 'skip', 'move', 'rejoin', 'remove', 'on', 'off']);

const HISTORY_MAX = 200;
const ATTEMPTS_MAX = 30;
const NOTE_MAX = 600;
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const num = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
const sha = (v) => (/^[0-9a-f]{7,64}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');
const list = (v, n = 20) => (Array.isArray(v) ? v.map((x) => str(x, 160)).filter(Boolean).slice(0, n) : []);

// ------------------------------------------------------------------ records

/** An empty line. */
export function emptyLine(at = new Date().toISOString()) {
  return { $axf: LINE_FRAME, rev: 0, at, on: true, mainSha: '', entries: [], history: [] };
}

/** The id an entry is known by everywhere: its PR number when it has one, else its build id. */
export const entryId = (e) => (num(e?.pr) ? `pr-${e.pr}` : e?.build ? `build-${str(e.build, 80)}` : '');

/** One well-formed entry from whatever the caller knows (PR, build, branch, title). Starts waiting. */
export function normEntry(e, at = new Date().toISOString()) {
  const pr = num(e?.pr) || num(Number(String(e?.pr || '').replace(/^#/, '')));
  const out = {
    $axf: ENTRY_FRAME, id: str(e?.id, 100) || entryId({ ...e, pr }), pr, build: str(e?.build, 80), branch: str(e?.branch, 200), title: str(e?.title, 300),
    url: str(e?.url, 300), agent: str(e?.agent, 80), priority: /^P[0-3]$/.test(str(e?.priority)) ? e.priority : '', head: sha(e?.head),
    state: STATES.includes(e?.state) ? e.state : 'waiting', since: str(e?.since, 40) || at, addedAt: str(e?.addedAt, 40) || at,
    attempts: Array.isArray(e?.attempts) ? e.attempts.slice(-ATTEMPTS_MAX) : [],
  };
  if (!out.id) throw new Error('an entry needs a PR number or a build id');
  if (e?.note) out.note = str(e.note, NOTE_MAX);
  if (e?.outcome && typeof e.outcome === 'object') out.outcome = { ...e.outcome };
  if (e?.hold) out.hold = str(e.hold, 200);
  return out;
}

const openAttempt = (e) => e.attempts.find((a) => !a.endedAt) || null;

function newAttempt(e, at, head) {
  const n = e.attempts.length + 1;
  return { $axf: ATTEMPT_FRAME, n, startedAt: at, head: head || e.head, steps: ['merging-main'] };
}

function closeAttempt(e, at, result, extra = {}) {
  const a = openAttempt(e);
  if (!a) return e;
  const done = { ...a, endedAt: at, result, ...extra };
  return { ...e, attempts: e.attempts.map((x) => (x === a ? done : x)).slice(-ATTEMPTS_MAX) };
}

function noteStep(e, state) {
  const a = openAttempt(e);
  if (!a) return e;
  const steps = a.steps.includes(state) ? a.steps : [...a.steps, state];
  return { ...e, attempts: e.attempts.map((x) => (x === a ? { ...x, steps } : x)) };
}

function setState(e, state, at, extra = {}) {
  return noteStep({ ...e, ...extra, state, since: at }, state);
}

// ------------------------------------------------------------------ check runs

/**
 * What one GitHub Actions check run means for the head under test:
 *   green    completed, success (or neutral: it did not fail)
 *   red      completed, failure | timed_out | action_required | startup_failure
 *   running  queued / in progress
 *   retry    not a result: cancelled, stale, or the run is for another head (superseded): run CI again on the same head
 *   ignore   not CI: a skipped job, or a check from another app (CodeRabbit)
 * Returns { verdict, reason, name }. `reason` is the word for the view: cancelled | stale | superseded | skipped | not-ours | success | failure | …
 */
export function classifyCheckRun(run, { head = '' } = {}) {
  const name = str(run?.name, 120);
  const app = run?.app?.slug || 'github-actions';
  if (app !== 'github-actions') return { verdict: 'ignore', reason: 'not-ours', name };
  const runHead = sha(run?.head_sha || run?.headSha || run?.head);
  if (head && runHead && runHead !== sha(head)) return { verdict: 'retry', reason: 'superseded', name };
  if (run?.status && run.status !== 'completed') return { verdict: 'running', reason: str(run.status, 40) || 'running', name };
  const c = str(run?.conclusion, 40);
  if (c === 'skipped') return { verdict: 'ignore', reason: 'skipped', name };
  if (c === 'success' || c === 'neutral') return { verdict: 'green', reason: c, name };
  if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(c)) return { verdict: 'red', reason: c, name };
  if (c === 'cancelled' || c === 'stale' || c === '') return { verdict: 'retry', reason: c || 'no-conclusion', name };
  return { verdict: 'retry', reason: c, name };
}

/**
 * All the runs on a head together: red if any is red; else running if any still runs; else retry if any was cancelled /
 * superseded / stale; else green when at least one is green; else none. `failing` names the red jobs, `retry` the ones
 * to run again.
 */
export function classifyCheckRuns(runs, { head = '' } = {}) {
  const cs = (Array.isArray(runs) ? runs : []).map((r) => classifyCheckRun(r, { head })).filter((c) => c.verdict !== 'ignore');
  const of = (v) => cs.filter((c) => c.verdict === v);
  if (of('red').length) return { verdict: 'red', failing: of('red').map((c) => c.name).filter(Boolean).slice(0, 10), retry: [] };
  if (of('running').length) return { verdict: 'running', failing: [], retry: [] };
  if (of('retry').length) return { verdict: 'retry', failing: [], retry: of('retry').map((c) => `${c.name || 'run'}: ${c.reason}`).slice(0, 10) };
  if (of('green').length) return { verdict: 'green', failing: [], retry: [] };
  return { verdict: 'none', failing: [], retry: [] };
}

// ------------------------------------------------------------------ reading the line

export const inFlight = (line) => (line?.entries || []).find((e) => IN_FLIGHT.includes(e.state)) || null;
export const liveEntries = (line) => (line?.entries || []).filter((e) => LIVE.includes(e.state));
export const findEntry = (line, id) => (line?.entries || []).find((e) => e.id === id || (num(Number(id)) && e.pr === Number(id)) || e.build === id) || null;

/**
 * The entry the runner should start now, or null: the first waiting one, only when the line is on and nothing is in
 * flight. An entry with a `hold` (not ready: UI Review, draft, red PR checks) is passed over; the next waiting one goes.
 */
export function next(line) {
  if (!line || line.on === false) return null;
  if (inFlight(line)) return null;
  return (line.entries || []).find((e) => e.state === 'waiting' && !e.hold) || null;
}

/** The plain-words outcome of a red run, for the fix build, the PR comment and the alert. */
export function redReason(e, { failing = [], runUrl = '', onto = '' } = {}) {
  const jobs = list(failing, 4);
  const who = e.pr ? `#${e.pr}` : e.build || e.id;
  return `${who} broke CI when landed on main${onto ? ` ${onto.slice(0, 8)}` : ''}${jobs.length ? ` (failed: ${jobs.join(', ')})` : ''}.${runUrl ? ` Run: ${runUrl}` : ''}`.slice(0, NOTE_MAX);
}

/**
 * The fix build the runner files for a red or conflicting entry: pure data, the host creates the build. One per
 * (entry, head): the id carries the head so a second red on the same head never files twice.
 */
export function fixRequest(e, { why = '', files = [], failing = [], runUrl = '' } = {}) {
  const base = e.build || (e.pr ? `pr-${e.pr}` : e.id);
  const kind = files.length ? 'conflict' : 'ci';
  const text = why || (kind === 'conflict'
    ? `Merging main into ${e.branch || base} conflicts in code (${list(files, 4).join(', ')}). Resolve the conflicts, keep both sides' intent, push.`
    : redReason(e, { failing, runUrl }));
  return {
    id: `fix-${String(base).replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${(e.head || 'nohead').slice(0, 7)}`.slice(0, 40),
    title: `Fix landing: ${e.title || base}`.slice(0, 120), kind, for: e.id, pr: e.pr || 0, branch: e.branch, head: e.head,
    text, failing: list(failing, 10), files: list(files, 20), runUrl: str(runUrl, 300), priority: 'P1',
  };
}

// ------------------------------------------------------------------ transitions

const illegal = (e, ev) => new Error(`${e.id}: ${ev} is not allowed from ${e.state}`);

/**
 * Apply one event to the line. Returns a new line (the input is never changed); throws on an event that isn't allowed
 * from the entry's state, or when a second entry would take the slot. `ev` = { type, id?, at?, by?, …data }.
 */
export function transition(line, ev) {
  const at = str(ev?.at, 40) || new Date().toISOString();
  const type = str(ev?.type, 40);
  if (!EVENTS.includes(type)) throw new Error(`unknown event ${type || '(none)'}`);
  const L = { ...(line || emptyLine(at)), entries: [...(line?.entries || [])], history: [...(line?.history || [])] };
  const bump = (l) => ({ ...l, rev: (l.rev || 0) + 1, at });

  if (type === 'on' || type === 'off') return bump({ ...L, on: type === 'on', onBy: str(ev.by, 80), onAt: at });

  if (type === 'add') {
    const e = normEntry(ev.entry || ev, at);
    if (L.entries.some((x) => x.id === e.id)) return L; // already in the line
    const done = L.history.find((x) => x.id === e.id && x.state === 'landed' && x.head && x.head === e.head);
    if (done) return L; // this head already landed
    L.entries.push(e);
    return bump(L);
  }

  const i = L.entries.findIndex((x) => x.id === ev.id || (num(Number(ev.id)) && x.pr === Number(ev.id)) || (ev.id && x.build === ev.id));
  if (i < 0) throw new Error(`no entry ${ev.id} in the line`);
  let e = L.entries[i];
  const put = (ne) => { L.entries[i] = ne; return bump(L); };
  const retire = (ne) => { L.entries.splice(i, 1); L.history = [...L.history, ne].slice(-HISTORY_MAX); return bump(L); };
  const red = (extra, why) => {
    const fix = fixRequest(e, { why, ...extra });
    e = closeAttempt(e, at, extra.files?.length ? 'conflict' : 'red', { failing: list(extra.failing, 10), files: list(extra.files, 20), runUrl: str(extra.runUrl, 300), fix: fix.id });
    return put(setState(e, 'fix-filed', at, { outcome: { kind: fix.kind, text: fix.text, at, fix: fix.id, runUrl: fix.runUrl }, fix }));
  };

  switch (type) {
    case 'start': {
      if (e.state !== 'waiting') throw illegal(e, type);
      if (L.on === false) throw new Error('the line is off');
      const busy = inFlight(L);
      if (busy && busy.id !== e.id) throw new Error(`${busy.id} is already in flight; one at a time`);
      if (e.hold) throw new Error(`${e.id} is held: ${e.hold}`);
      const head = sha(ev.head) || e.head;
      e = { ...e, head, attempts: [...e.attempts, newAttempt(e, at, head)], mainSha: sha(ev.mainSha) || L.mainSha };
      delete e.outcome; delete e.fix;
      return put(setState(e, 'merging-main', at));
    }
    case 'merged-main': {
      if (e.state !== 'merging-main') throw illegal(e, type);
      const head = sha(ev.sha) || e.head;
      e = { ...e, head };
      const a = openAttempt(e); if (a) e = { ...e, attempts: e.attempts.map((x) => (x === a ? { ...x, mergeSha: head } : x)) };
      return put(setState(e, 'regenerating', at));
    }
    case 'conflict': {
      if (!['merging-main', 'regenerating'].includes(e.state)) throw illegal(e, type);
      return red({ files: list(ev.files, 20) }, str(ev.why, NOTE_MAX));
    }
    case 'regenerated': {
      if (e.state !== 'regenerating') throw illegal(e, type);
      e = { ...e, head: sha(ev.head) || e.head };
      return put(setState(e, 'checking', at, { ci: { verdict: 'none', at } }));
    }
    case 'check': {
      if (e.state !== 'checking') throw illegal(e, type);
      const runs = Array.isArray(ev.runs) ? ev.runs : ev.run ? [ev.run] : [];
      const c = classifyCheckRuns(runs, { head: e.head });
      const runUrl = str(ev.runUrl || runs.find((r) => r?.html_url)?.html_url, 300);
      if (c.verdict === 'red') return red({ failing: c.failing, runUrl });
      if (c.verdict === 'green') { e = { ...e, ci: { verdict: 'green', at, runUrl } }; return put(setState(e, 'landing', at)); }
      if (c.verdict === 'retry') {
        const a = openAttempt(e);
        const retries = [...(a?.retries || []), { at, why: c.retry }].slice(-10);
        if (a) e = { ...e, attempts: e.attempts.map((x) => (x === a ? { ...x, retries } : x)) };
        return put(setState({ ...e, ci: { verdict: 'retry', at, why: c.retry, runUrl } }, 'checking', at));
      }
      return put({ ...e, ci: { verdict: c.verdict, at, runUrl } }); // running | none: same state, no new `since`
    }
    case 'main-moved': {
      if (!['checking', 'landing'].includes(e.state)) throw illegal(e, type);
      e = closeAttempt(e, at, 'retry', { why: `main moved to ${sha(ev.mainSha).slice(0, 8) || 'a new commit'} while it was ${e.state}` });
      e = { ...e, mainSha: sha(ev.mainSha) || e.mainSha, attempts: [...e.attempts, newAttempt(e, at, e.head)] };
      return put(setState(e, 'merging-main', at));
    }
    case 'land': {
      if (e.state !== 'checking' && e.state !== 'landing') throw illegal(e, type);
      if (e.state === 'checking' && e.ci?.verdict !== 'green') throw new Error(`${e.id}: CI is not green on ${e.head.slice(0, 8)}`);
      return put(setState(e, 'landing', at));
    }
    case 'landed': {
      if (e.state !== 'landing') throw illegal(e, type);
      const landedSha = sha(ev.sha);
      e = closeAttempt(e, at, 'landed', { landedSha });
      return retire(setState(e, 'landed', at, { landedAt: at, landedSha, outcome: { kind: 'landed', text: `landed on main as ${landedSha.slice(0, 8) || 'a merge commit'}`, at } }));
    }
    case 'land-rejected': {
      if (e.state !== 'landing') throw illegal(e, type);
      e = closeAttempt(e, at, 'retry', { why: str(ev.why, 300) || 'the merge was rejected' });
      e = { ...e, attempts: [...e.attempts, newAttempt(e, at, e.head)] };
      return put(setState(e, 'merging-main', at));
    }
    case 'pause': {
      if (!LIVE.includes(e.state) || e.state === 'paused') throw illegal(e, type);
      if (IN_FLIGHT.includes(e.state)) e = closeAttempt(e, at, 'aborted', { why: `paused while ${e.state}` });
      return put(setState(e, 'paused', at, { pausedFrom: e.state, outcome: { kind: 'paused', text: str(ev.why, NOTE_MAX) || 'paused by hand', at, by: str(ev.by, 80) } }));
    }
    case 'resume': {
      if (e.state !== 'paused') throw illegal(e, type);
      e = { ...e }; delete e.pausedFrom; delete e.outcome;
      return put(setState(e, 'waiting', at));
    }
    case 'skip': {
      if (!LIVE.includes(e.state)) throw illegal(e, type);
      if (IN_FLIGHT.includes(e.state)) e = closeAttempt(e, at, 'aborted', { why: `skipped while ${e.state}` });
      return retire(setState(e, 'skipped', at, { outcome: { kind: 'skipped', text: str(ev.why, NOTE_MAX) || 'skipped by hand', at, by: str(ev.by, 80) } }));
    }
    case 'remove': {
      if (!LIVE.includes(e.state)) throw illegal(e, type);
      if (IN_FLIGHT.includes(e.state)) e = closeAttempt(e, at, 'aborted', { why: str(ev.why, 300) || 'removed' });
      return retire(setState(e, 'skipped', at, { outcome: { kind: 'removed', text: str(ev.why, NOTE_MAX) || 'its PR closed or its build was cancelled', at } }));
    }
    case 'rejoin': {
      if (e.state !== 'fix-filed') throw illegal(e, type);
      const head = sha(ev.head);
      if (!head || head === e.head) throw new Error(`${e.id}: a rejoin needs a new head`);
      e = { ...e, head }; delete e.outcome; delete e.fix;
      return put(setState(e, 'waiting', at));
    }
    case 'move': {
      if (!LIVE.includes(e.state)) throw illegal(e, type);
      return bump(moveEntry(L, e.id, ev.to, { by: str(ev.by, 80), at }));
    }
    default: throw new Error(`unknown event ${type}`);
  }
}

/**
 * Put entry `id` at index `to` among the line's entries (0 = front). The in-flight entry, if any, keeps the front: no
 * move puts anything ahead of what is being landed right now. Pure.
 */
export function moveEntry(line, id, to, { by = '', at = '' } = {}) {
  const i = Number(to);
  if (!Number.isInteger(i) || i < 0) throw new Error('to is the new index (0 = front)');
  const entries = [...(line.entries || [])];
  const k = entries.findIndex((e) => e.id === id);
  if (k < 0) throw new Error(`no entry ${id} in the line`);
  const [e] = entries.splice(k, 1);
  const busy = entries.findIndex((x) => IN_FLIGHT.includes(x.state));
  const floor = IN_FLIGHT.includes(e.state) ? 0 : busy + 1;
  entries.splice(Math.min(Math.max(i, floor), entries.length), 0, { ...e, moved: { at, by } });
  return { ...line, entries };
}

/** Move an entry one place up (ahead of the one before it), never past the in-flight one. */
export const moveUp = (line, id, opts = {}) => {
  const k = (line.entries || []).findIndex((e) => e.id === id);
  if (k < 0) throw new Error(`no entry ${id} in the line`);
  return moveEntry(line, id, Math.max(0, k - 1), opts);
};

/**
 * Make sure the line is well-formed. Returns { ok, errors: [field words] }: one slot, states known, ids unique,
 * attempts in order, history terminal only.
 */
export function validateLine(line) {
  const errors = [];
  if (line?.$axf !== LINE_FRAME) errors.push('$axf');
  const entries = Array.isArray(line?.entries) ? line.entries : (errors.push('entries'), []);
  const ids = new Set();
  let flying = 0;
  for (const e of entries) {
    if (!e?.id) errors.push('entry.id');
    else if (ids.has(e.id)) errors.push(`entry.id duplicate ${e.id}`);
    ids.add(e?.id);
    if (!STATES.includes(e?.state)) errors.push(`entry.state ${e?.id}`);
    if (TERMINAL.includes(e?.state)) errors.push(`entry.state terminal in line ${e?.id}`);
    if (IN_FLIGHT.includes(e?.state)) flying += 1;
    if (!num(e?.pr) && !e?.build) errors.push(`entry.pr|build ${e?.id}`);
    if (!Array.isArray(e?.attempts)) errors.push(`entry.attempts ${e?.id}`);
    else if (e.attempts.filter((a) => !a.endedAt).length > 1) errors.push(`entry.attempts open ${e.id}`);
    else if (e.attempts.some((a, k) => a.n !== k + 1)) errors.push(`entry.attempts order ${e.id}`);
    else if (!IN_FLIGHT.includes(e?.state) && e.attempts.some((a) => !a.endedAt)) errors.push(`entry.attempts open while ${e.state} ${e.id}`);
  }
  if (flying > 1) errors.push('one at a time');
  for (const h of Array.isArray(line?.history) ? line.history : (errors.push('history'), [])) {
    if (!TERMINAL.includes(h?.state)) errors.push(`history.state ${h?.id}`);
  }
  return { ok: !errors.length, errors };
}

// ------------------------------------------------------------------ views

/** The entries as a view shows them: position, label, tone, attempt count, the last word on each. */
export function view(line) {
  const items = (line?.entries || []).map((e, i) => ({
    i, id: e.id, pr: e.pr, build: e.build, title: e.title, url: e.url, branch: e.branch, agent: e.agent, priority: e.priority, head: e.head,
    state: e.state, label: STATE_LABEL[e.state], tone: STATE_TONE[e.state], since: e.since, attempts: e.attempts.length,
    retries: e.attempts.reduce((n, a) => n + (a.retries?.length || 0), 0),
    why: e.hold ? `not ready: ${e.hold}` : e.outcome?.text || e.ci?.why?.join('; ') || '', fix: e.fix?.id || '', runUrl: e.ci?.runUrl || e.outcome?.runUrl || '',
  }));
  const landed = (line?.history || []).filter((h) => h.state === 'landed');
  return { on: line?.on !== false, mainSha: line?.mainSha || '', inFlight: inFlight(line)?.id || '', items, landed: landed.slice(-20).reverse(), skipped: (line?.history || []).filter((h) => h.state === 'skipped').slice(-20).reverse() };
}

/** The banner chip: "Landing: N" with the colour of the worst state. */
export function chip(line) {
  const live = liveEntries(line);
  const n = live.length;
  const fixes = live.filter((e) => e.state === 'fix-filed').length;
  const flying = inFlight(line);
  return { label: `Landing: ${n}`, count: n, inFlight: flying?.id || '', fixes, paused: line?.on === false, tone: line?.on === false ? 'warning' : fixes ? 'warning' : flying ? 'info' : n ? 'muted' : 'muted' };
}

/** The commands, declared once: the CLI, the REST routes, MCP (plugin-commands@1) and voice say the same words. */
export const LINE_COMMANDS = Object.freeze([
  { id: 'landing-list', method: 'GET', path: '/landing', cli: 'list', title: 'Landing line: the line', description: 'Every finished build / PR in the landing line in order: title, agent, state (waiting, merging main in, regenerating, checking, landing, fix filed, paused), attempts, why.', effect: 'read' },
  { id: 'landing-add', method: 'POST', path: '/landing/add', cli: 'add', title: 'Landing line: add', description: 'Put a PR (or a finished build) at the back of the landing line.', effect: 'write', input: { pr: 'PR number', build: 'build id (when there is no PR yet)' } },
  { id: 'landing-pause', method: 'POST', path: '/landing/pause', cli: 'pause', title: 'Landing line: pause one', description: 'Pause one entry: it keeps its place but is passed over until it is resumed.', effect: 'write', input: { pr: 'PR number or build id', why: 'optional reason' } },
  { id: 'landing-resume', method: 'POST', path: '/landing/resume', cli: 'resume', title: 'Landing line: resume one', description: 'Resume a paused entry: it waits in its place again.', effect: 'write', input: { pr: 'PR number or build id' } },
  { id: 'landing-skip', method: 'POST', path: '/landing/skip', cli: 'skip', title: 'Landing line: skip one', description: 'Take an entry out of the landing line. It rejoins when it is added again.', effect: 'write', input: { pr: 'PR number or build id', why: 'optional reason' } },
  { id: 'landing-move', method: 'POST', path: '/landing/move', cli: 'move', title: 'Landing line: move one', description: 'Move an entry to a place in the line (0 = front). Nothing moves ahead of the one being landed right now.', effect: 'write', input: { pr: 'PR number or build id', to: 'new index, 0 = front' } },
  { id: 'landing-move-up', method: 'POST', path: '/landing/move-up', cli: 'up', title: 'Landing line: move one up', description: 'Move an entry one place up the line.', effect: 'write', input: { pr: 'PR number or build id' } },
  { id: 'landing-on', method: 'POST', path: '/landing/on', cli: 'on', title: 'Landing line: on / off', description: "Run the line, or hold it (the entry in flight finishes; nothing new starts). Off is Brett's own click.", effect: 'write', input: { on: 'true | false' } },
]);
