/**
 * Merge gate, the pure part (build auto-rebuild-failed-merges, Brett Nov 11 2026: "You gotta redo anything
 * automatically. Make that a server gate. Fix everything. If something fails, re-pull in main and rebuild it."). No IO,
 * no model calls: merge-gate.mjs (the host runner, every auto-land round), the push banner's server and the console read
 * the same rules here.
 *
 * A finished build that can't merge (a code conflict with main, a red test gate, or too far behind main) gets up to
 * `cap` attempts (default 3), each one either
 *   fix      YELLOW  main pulled into the branch; a fix session (filed with the orchestrator, the only launcher) resolves
 *                    the conflicts / failing checks on that branch while keeping the feature; the queue re-runs the checks
 *   rebuild  BLUE    a fresh build <name>-rN from origin/main with the original brief, the old branch name and the failure
 *                    list; the old build is superseded (linked both ways), its PR closed
 * A new branch gets a fix first (cheap); a fix that didn't get it green, or a branch too far behind, gets a rebuild.
 * Green: passed, then merged by the normal merge path (the queue). After `cap` failed attempts: RED, held for Brett, one
 * high-priority merge.blocked push. This gate never pushes to main.
 *
 * Every entry keeps the why of each attempt in plain English, and lives in the merge log (merge-log@1) for good;
 * clearing it only takes it off the banner.
 */

export const LOG_FRAME = 'merge-log@1';
export const CONTROL_FRAME = 'merge-gate-control@1';
/** Settings (push banner config.json): on unless switched off; `mergeGateCap` attempts; a branch more than
 *  `mergeGateBehind` code commits behind main goes straight to a rebuild. */
export const GATE_DEFAULTS = Object.freeze({ mergeGate: true, mergeGateCap: 3, mergeGateBehind: 150 });
export const CAP_MAX = 6;
/** Hours a fix or rebuild may run with nothing to show (no new head, no finished build) before the attempt counts as failed. */
export const ATTEMPT_HOURS = 6;

/** Entry states: the colour is a theme tone (warn / info / ok / error), never a literal. */
export const STATES = Object.freeze({
  fixing: { label: 'Auto-fixing', tone: 'warning', group: 'working', icon: 'hammer' },
  rebuilding: { label: 'Full rebuild', tone: 'info', group: 'working', icon: 'refresh' },
  passed: { label: 'Passed', tone: 'success', group: 'merged', icon: 'check' },
  merged: { label: 'Merged', tone: 'success', group: 'merged', icon: 'check-circle' },
  failed: { label: 'Failed 3 times - needs you', tone: 'danger', group: 'failed', icon: 'alert' },
  skipped: { label: 'Skipped', tone: 'muted', group: 'merged', icon: 'x' },
});
/** The banner's groups for gate entries, in order. */
export const GROUPS = Object.freeze([
  { id: 'working', title: 'Auto-fixing / Rebuilding', clear: '' },
  { id: 'failed', title: 'Failed - needs you', clear: 'Clear reds' },
  { id: 'merged', title: 'Fixed and merged', clear: 'Clear merged' },
]);

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
const arr = (v, n = 20, m = 200) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(0, n).map((x) => x.slice(0, m)) : []);

// ------------------------------------------------------------------ what went wrong, in plain English

/**
 * A failure as the gate sees it: { kind: conflict | ci | behind, files: [conflicting files], checks: [failing checks],
 * errors: [key error lines], behind: commits behind main, runUrl, text: the reason the queue / auto-land gave }.
 */
export function normTrigger(t = {}) {
  const kind = ['conflict', 'ci', 'behind'].includes(t.kind) ? t.kind : 'ci';
  return { kind, files: arr(t.files), checks: arr(t.checks, 10), errors: arr(t.errors, 8, 300), behind: Number.isInteger(t.behind) && t.behind > 0 ? t.behind : 0, runUrl: str(t.runUrl, 300), text: str(t.text, 600), head: str(t.head, 40) };
}

/**
 * Read a merge queue kick-out (merge-queue-core kickReason / the conflict line) into a trigger.
 *   "#12 conflicts with main in code (a.mjs, b.tsx). Merge main in and fix them."
 *   "#12 broke CI when tested on top of main (failed: test, android). Run: https://…"
 */
export function triggerFromKick(k = {}) {
  const why = str(k.why, 800);
  const conflict = why.match(/conflicts with main in code \(([^)]*)\)/);
  if (conflict) return normTrigger({ kind: 'conflict', files: conflict[1].split(',').map((x) => x.trim()).filter(Boolean), text: why, head: k.head });
  const failed = why.match(/\(failed: ([^)]*)\)/);
  const url = why.match(/Run: (\S+)/);
  return normTrigger({ kind: 'ci', checks: failed ? failed[1].split(',').map((x) => x.trim()).filter(Boolean) : [], runUrl: url ? url[1] : str(k.runUrl, 300), text: why, head: k.head });
}

/** Auto-land's reason ({ kind: conflict | ci, files, checks, text }) as a trigger. */
export function triggerFromLand(reason = {}, head = '') {
  if (reason?.kind === 'conflict') return normTrigger({ kind: 'conflict', files: reason.files || reason.conflicts || [], text: reason.text, head });
  return normTrigger({ kind: 'ci', checks: reason?.checks || [], text: reason?.text, head });
}

const list = (xs, n = 4) => { const a = xs.slice(0, n); const more = xs.length - a.length; return `${a.join(', ')}${more > 0 ? ` and ${more} more` : ''}`; };

/** The why of a failure in one plain sentence (what the banner, the phone and the log say). */
export function whyText(t) {
  const x = normTrigger(t);
  if (x.kind === 'conflict') return `Conflicts with main in ${x.files.length ? list(x.files) : 'code'}.`;
  if (x.kind === 'behind') return `Too far behind main (${x.behind} commits) to fix by merging.`;
  const errs = x.errors.length ? ` Errors: ${x.errors.slice(0, 2).join(' | ')}` : '';
  return `Failed the test gate${x.checks.length ? `: ${list(x.checks)}` : ''}.${errs}`.slice(0, 600);
}

// ------------------------------------------------------------------ the rules

/**
 * What the next attempt is: { kind: 'fix' | 'rebuild' | 'hold', n }.
 *   hold     `cap` attempts are used up (red)
 *   rebuild  the branch is too far behind main, or a fix on this same branch already failed
 *   fix      otherwise (a new branch gets the cheap fix first)
 */
export function nextAttempt(entry, trigger, { cap = GATE_DEFAULTS.mergeGateCap, behindLimit = GATE_DEFAULTS.mergeGateBehind, force = '' } = {}) {
  const attempts = entry?.attempts || [];
  const n = attempts.length + 1;
  if (!force && n > cap) return { kind: 'hold', n: attempts.length };
  if (force === 'fix' || force === 'rebuild') return { kind: force, n };
  const t = normTrigger(trigger);
  if (t.kind === 'behind' || t.behind > behindLimit) return { kind: 'rebuild', n };
  const branch = entry?.branch || '';
  if (attempts.some((a) => a.kind === 'fix' && a.branch === branch && a.result === 'failed')) return { kind: 'rebuild', n };
  return { kind: 'fix', n };
}

/** The id of the rebuild build: <name>-rN, with N one past any -rN already on the name, and free in `taken`. */
export function rebuildId(id, taken = new Set()) {
  const m = String(id || 'build').match(/^(.*?)-r(\d+)$/);
  const base = (m ? m[1] : String(id || 'build')).slice(0, 70);
  let k = m ? Number(m[2]) + 1 : 2;
  while (taken.has(`${base}-r${k}`)) k++;
  return `${base}-r${k}`;
}

/** A new log entry for a build that couldn't merge. */
export function newEntry({ build, title = '', branch = '', pr = null, repo = 'MossesX/AmberX-AXF', agent = '', at }) {
  return {
    id: str(build, 90), build: str(build, 90), title: str(title, 200) || str(build, 90), repo: str(repo, 120), branch: str(branch, 200), pr: Number.isInteger(pr) ? pr : null,
    agent: str(agent, 80), state: 'fixing', attempts: [], timeline: [], links: { supersedes: [], supersededBy: '' },
    banner: { cleared: false, clearedAt: '' }, archived: false, createdAt: at, updatedAt: at, outcome: '', heldAt: '', autoMerge: null,
  };
}

const say = (e, at, text) => { e.timeline = [...(e.timeline || []), { at, text: str(text, 600) }].slice(-80); e.updatedAt = at; };

/**
 * Start attempt n on an entry: the state turns yellow (fix) or blue (rebuild) and the why is kept with the attempt.
 * `job` = what was launched: { build: the fix / rebuild build id, branch, session, account, mergedMain: bool, note }.
 */
export function startAttempt(entry, kind, trigger, { at, job = {}, cap = GATE_DEFAULTS.mergeGateCap } = {}) {
  const e = { ...entry, attempts: [...(entry.attempts || [])] };
  const t = normTrigger(trigger);
  const n = e.attempts.length + 1;
  const a = {
    n, kind, trigger: t, why: whyText(t), branch: kind === 'rebuild' ? str(job.branch, 200) : e.branch, startHead: t.head, startedAt: at, endedAt: '', result: 'running',
    job: { build: str(job.build, 90), branch: str(job.branch, 200), session: str(job.session, 120), account: str(job.account, 80), mergedMain: job.mergedMain === true, cost: typeof job.cost === 'number' ? job.cost : null },
    changed: str(job.note, 600), tests: '',
  };
  e.attempts.push(a);
  e.state = kind === 'rebuild' ? 'rebuilding' : 'fixing';
  e.outcome = ''; e.heldAt = '';
  e.banner = { cleared: false, clearedAt: '' }; // a new attempt is news again
  say(e, at, `${kind === 'rebuild' ? 'Full rebuild' : 'Auto-fix'} (attempt ${n} of ${cap}): ${a.why}${a.changed ? ` ${a.changed}` : ''}`);
  if (kind === 'rebuild' && job.branch) e.branch = str(job.branch, 200);
  return e;
}

/** The running attempt, or null. */
export const running = (e) => (e?.attempts || []).find((a) => a.result === 'running') || null;

/** End the running attempt: passed (green) or failed (the gate then starts the next or holds it). */
export function endAttempt(entry, result, { at, note = '', tests = '', trigger = null } = {}) {
  const e = { ...entry, attempts: (entry.attempts || []).map((a) => ({ ...a })) };
  const a = e.attempts.find((x) => x.result === 'running');
  if (!a) return e;
  a.result = result === 'passed' ? 'passed' : 'failed'; a.endedAt = at;
  if (note) a.changed = str([a.changed, note].filter(Boolean).join(' '), 600);
  if (tests) a.tests = str(tests, 300);
  if (trigger && result !== 'passed') { a.failedWith = normTrigger(trigger); a.failedWhy = whyText(trigger); }
  if (result === 'passed') { e.state = 'passed'; say(e, at, `Attempt ${a.n} passed: checks are green; it lands through the merge queue.`); }
  else say(e, at, `Attempt ${a.n} (${a.kind === 'rebuild' ? 'full rebuild' : 'auto-fix'}) failed: ${a.failedWhy || note || 'still not mergeable'}`);
  return e;
}

/** All attempts used: red, held for Brett. */
export function hold(entry, { at, cap = GATE_DEFAULTS.mergeGateCap } = {}) {
  const e = { ...entry, state: 'failed', heldAt: at, outcome: 'held', banner: { cleared: false, clearedAt: '' } };
  say(e, at, `Failed ${cap} times; held for Brett. ${redWhy(e)}`);
  return e;
}

/** Landed on main through the merge path. */
export function merged(entry, { at, sha = '', pr = null } = {}) {
  const e = { ...entry, state: 'merged', outcome: 'merged', mergedAt: at, mergedSha: str(sha, 40) };
  if (Number.isInteger(pr)) e.pr = pr;
  e.attempts = (e.attempts || []).map((a) => (a.result === 'running' ? { ...a, result: 'passed', endedAt: at } : a));
  say(e, at, `Merged${sha ? ` at ${String(sha).slice(0, 8)}` : ''}.`);
  return e;
}

/** For red: the reason each attempt failed, one line each. */
export function redWhy(e) {
  return (e.attempts || []).map((a) => `${a.n}. ${a.kind === 'rebuild' ? 'Rebuild' : 'Fix'}: ${a.failedWhy || a.why}`).join(' ');
}

/** What the banner / phone shows for an entry: { tone, label, group, title, why, lines[] }. */
export function bannerView(e, { cap = GATE_DEFAULTS.mergeGateCap } = {}) {
  const st = STATES[e.state] || STATES.fixing;
  const a = running(e) || (e.attempts || []).at(-1) || null;
  const label = e.state === 'fixing' ? `Auto-fixing (attempt ${a?.n || 1} of ${cap})`
    : e.state === 'rebuilding' ? `Full rebuild (attempt ${a?.n || 1} of ${cap})`
      : e.state === 'failed' ? `Failed ${(e.attempts || []).length} times - needs you` : st.label;
  const lines = [];
  if (e.state === 'failed') for (const x of e.attempts || []) lines.push(`${x.n}. ${x.kind === 'rebuild' ? 'Rebuild' : 'Fix'}: ${x.failedWhy || x.why}`);
  else if (a) {
    lines.push(`Why: ${a.why}`);
    if (a.trigger?.errors?.length) lines.push(...a.trigger.errors.slice(0, 3).map((l) => `  ${l}`));
    if (a.changed) lines.push(`What it did: ${a.changed}`);
    if (a.job?.build && a.job.build !== e.build) lines.push(`${a.kind === 'rebuild' ? 'Rebuild' : 'Fix'} build: ${a.job.build}`);
  }
  if (e.state === 'merged' && e.mergedSha) lines.push(`Landed at ${e.mergedSha.slice(0, 8)}.`);
  const why = e.state === 'failed' ? redWhy(e) : a ? a.why : '';
  return { tone: st.tone, label, group: st.group, icon: st.icon, title: e.title || e.build, why, lines };
}

/** Banner entries: not cleared, not archived, grouped. */
export function bannerGroups(log, opts = {}) {
  const entries = (log?.entries || []).filter((e) => !e.archived && !e.banner?.cleared);
  return GROUPS.map((g) => ({ ...g, entries: entries.filter((e) => (STATES[e.state] || STATES.fixing).group === g.id).map((e) => ({ id: e.id, build: e.build, pr: e.pr, branch: e.branch, state: e.state, ...bannerView(e, opts) })) })).filter((g) => g.entries.length);
}

/** The phone notification for an entry (one per build, updated in place: key gate:<build>). */
export function alertFor(e, opts = {}) {
  const v = bannerView(e, opts);
  return { source: 'push-banner', key: `gate:${e.build}`, severity: e.state === 'failed' ? 'error' : e.state === 'merged' || e.state === 'passed' ? 'info' : 'warning', title: `${v.label}: ${e.title || e.build}`.slice(0, 200), body: v.lines.join('\n').slice(0, 1500) || v.why };
}

// ------------------------------------------------------------------ commands (row buttons, right-click, REST, CLI, MCP, voice)

/** Every command, declared once. `flag` ones change only the log (applied at once); the rest the host runner carries out. */
export const GATE_COMMANDS = Object.freeze([
  { id: 'mergegate-log', cmd: 'log', method: 'GET', path: '/merge-log', title: 'Merge log: every build the gate fixed or rebuilt', description: 'Every entry of the merge gate (cleared or not): build, state (auto-fixing, full rebuild, passed, merged, failed 3 times), attempts with the why of each (conflicting files, failing checks and error lines, what the fix or rebuild changed), branch, PR, timeline, links.', effect: 'read', voice: ['show the merge log', 'what failed to merge'] },
  { id: 'mergegate-retry', cmd: 'retry', title: 'Merge gate: retry now', description: 'Start the next attempt now (auto-fix or full rebuild by the rules); a red one gets a fresh set of attempts.', effect: 'write', voice: ['retry the failed merges', 'retry merge'] },
  { id: 'mergegate-fix', cmd: 'fix', title: 'Merge gate: auto-fix now', description: 'Pull main into the branch and file a fix session with the orchestrator for the conflicts / failing checks.', effect: 'write', voice: ['auto fix', 'fix the merge'] },
  { id: 'mergegate-rebuild', cmd: 'rebuild', title: 'Merge gate: full rebuild now', description: 'File a fresh <name>-rN build from main with the original brief and the failure list; the old build is superseded and its PR closed.', effect: 'write', voice: ['rebuild', 'full rebuild'] },
  { id: 'mergegate-merge', cmd: 'merge', title: 'Merge gate: merge', description: 'Put its PR (back) in the merge queue, the normal merge path; it lands when its batch is green.', effect: 'write', voice: ['merge it'] },
  { id: 'mergegate-skip', cmd: 'skip', title: 'Merge gate: skip', description: 'Stop working on it: no more attempts; it stays in the log.', effect: 'write', voice: ['skip it'] },
  { id: 'mergegate-automerge', cmd: 'automerge', title: 'Merge gate: toggle auto-merge', description: 'Auto-merge for this build on or off: on, a passed attempt goes into the merge queue by itself; off, it waits for Merge.', effect: 'write', voice: ['toggle auto merge'] },
  { id: 'mergegate-clear', cmd: 'clear', flag: true, title: 'Merge gate: clear from the banner', description: 'Take entries off the merge banner (by id, or every red / merged one with group). They stay in the merge log.', effect: 'write', voice: ['clear the reds', 'clear merged'] },
  { id: 'mergegate-restore', cmd: 'restore', flag: true, title: 'Merge gate: restore to the banner', description: 'Put cleared entries back on the merge banner.', effect: 'write' },
  { id: 'mergegate-archive', cmd: 'archive', flag: true, title: 'Merge gate: archive', description: 'Archive entries: hidden from the banner and from the log grid unless Archived is shown. Kept forever.', effect: 'write' },
]);
export const CMD_IDS = Object.freeze(GATE_COMMANDS.filter((c) => c.cmd !== 'log').map((c) => c.cmd));
export const FLAG_CMDS = Object.freeze(GATE_COMMANDS.filter((c) => c.flag).map((c) => c.cmd));

/** Which entries a command's selection means: explicit ids, or `group` (failed | merged | working) for Clear reds / Clear merged. */
export function selectIds(log, { ids = [], group = '' } = {}) {
  const es = log?.entries || [];
  if (group) return es.filter((e) => !e.archived && (STATES[e.state] || STATES.fixing).group === group && (group !== 'failed' || e.state === 'failed')).map((e) => e.id);
  const want = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
  return es.filter((e) => want.has(e.id) || want.has(e.build) || (e.pr && want.has(String(e.pr))) || want.has(`#${e.pr}`)).map((e) => e.id);
}

/** Queue a command (the control file): { id, cmd, ids, group, at, by }. Returns the new control document. */
export function addCommand(ctl, { cmd, ids = [], group = '', by = '', at = new Date().toISOString(), seq = Date.now() }) {
  if (!CMD_IDS.includes(cmd)) throw new Error(`unknown command ${cmd}; one of ${CMD_IDS.join(', ')}`);
  const idl = (Array.isArray(ids) ? ids : [ids]).map((x) => String(x).replace(/^#/, '')).filter(Boolean).slice(0, 100);
  if (!idl.length && !group) throw new Error('send ids (build ids or PR numbers) or a group (failed | merged | working)');
  if (group && !GROUPS.some((g) => g.id === group)) throw new Error('group is failed, merged or working');
  const d = { $axf: CONTROL_FRAME, cmds: [], ...(ctl && typeof ctl === 'object' ? ctl : {}) };
  d.cmds = [...(Array.isArray(d.cmds) ? d.cmds : []), { id: `${seq}-${cmd}`, cmd, ids: idl, group, by: str(by, 80), at }].slice(-200);
  return d;
}

/** Apply a flag command (clear / restore / archive) to the log. Pure: returns the new log. */
export function applyFlag(log, c, at) {
  const ids = new Set(selectIds(log, c));
  const entries = (log?.entries || []).map((e) => {
    if (!ids.has(e.id)) return e;
    if (c.cmd === 'clear') return { ...e, banner: { cleared: true, clearedAt: at, by: c.by || '' } };
    if (c.cmd === 'restore') return { ...e, archived: false, banner: { cleared: false, clearedAt: '' } };
    if (c.cmd === 'archive') return { ...e, archived: true, banner: { cleared: true, clearedAt: e.banner?.clearedAt || at } };
    return e;
  });
  return { ...log, entries };
}

/** The log as the console should show it now: the flag commands still waiting for the runner applied on top. */
export function withPending(log, ctl) {
  const done = new Set(log?.applied || []);
  let out = { $axf: LOG_FRAME, entries: [], applied: [], ...(log || {}) };
  for (const c of ctl?.cmds || []) if (!done.has(c.id) && FLAG_CMDS.includes(c.cmd)) out = applyFlag(out, c, c.at);
  return out;
}

/** Grid rows: one per entry (archived only when asked), newest first, with what the columns show. */
export function gridRows(log, { archived = false, cap = GATE_DEFAULTS.mergeGateCap } = {}) {
  return (log?.entries || []).filter((e) => archived || !e.archived).map((e) => {
    const v = bannerView(e, { cap });
    const last = (e.attempts || []).at(-1);
    return { id: e.id, build: e.build, title: e.title, state: e.state, label: v.label, tone: v.tone, attempts: (e.attempts || []).length, branch: e.branch, pr: e.pr, repo: e.repo, createdAt: e.createdAt, updatedAt: e.updatedAt, outcome: e.outcome || (e.state === 'failed' ? 'held' : ''), why: v.why, cleared: !!e.banner?.cleared, archived: !!e.archived, lastKind: last?.kind || '', agent: e.agent || '' };
  }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Plain text of an entry's why for Copy why. */
export function copyWhy(e, opts = {}) {
  const v = bannerView(e, opts);
  return [`${e.title || e.build} (${e.build}) - ${v.label}`, ...(e.attempts || []).map((a) => `Attempt ${a.n} (${a.kind}): ${a.why}${a.failedWhy ? ` -> failed: ${a.failedWhy}` : a.result === 'passed' ? ' -> passed' : ''}${a.changed ? ` [${a.changed}]` : ''}`)].join('\n');
}

/** The brief of a fix session (the orchestrator files it; the dispatcher starts it). */
export function fixBrief({ entry, attempt, trigger, mergedMain, report = '' }) {
  const t = normTrigger(trigger);
  return [
    `Merge gate auto-fix, attempt ${attempt} for build ${entry.build} (branch ${entry.branch}${entry.pr ? `, PR #${entry.pr}` : ''}).`,
    `It can't merge: ${whyText(t)}`,
    t.files.length ? `Conflicting files: ${t.files.join(', ')}` : '',
    t.checks.length ? `Failing checks: ${t.checks.join(', ')}${t.runUrl ? ` (run ${t.runUrl})` : ''}` : '',
    t.errors.length ? `Key error lines:\n${t.errors.map((l) => `  ${l}`).join('\n')}` : '',
    '',
    'Do this, keeping the feature intact:',
    `1. git fetch origin && git checkout -B ${entry.branch} origin/${entry.branch}${mergedMain ? ' (main is already merged in by the gate)' : ' && git merge origin/main'}`,
    '2. Resolve every conflict and fix every failing check; run the build\'s own tests and the failing checks locally.',
    `3. Commit and push to ${entry.branch} only (git push origin HEAD:${entry.branch}). Never push to main and never merge the PR: the merge queue re-tests it and lands it.`,
    `4. In the final message say what you changed in one line${report ? `; add a line to ${report}` : ''}.`,
  ].filter((x) => x !== '').join('\n').slice(0, 7000);
}

/** The brief of a full rebuild: the original brief, the old branch name, report and the failure list; re-implement on today's main. */
export function rebuildBrief({ entry, newId, original = '', report = '' }) {
  const fails = (entry.attempts || []).map((a) => `- attempt ${a.n} (${a.kind}): ${a.failedWhy || a.why}`);
  return [
    `Full rebuild (merge gate) of build ${entry.build}: re-implement it on today's main as ${newId} (branch claude/${newId}).`,
    `The old branch ${entry.branch}${entry.pr ? ` (PR #${entry.pr})` : ''} couldn't merge. Read it for reference (git diff origin/main...origin/${entry.branch}) but do NOT merge it; write the feature again on main.`,
    report ? `Old report: ${report}` : '',
    'Why it failed:', ...(fails.length ? fails : [`- ${whyText(entry.attempts?.at(-1)?.trigger || {})}`]),
    '', 'Original brief:', str(original, 5500),
  ].filter((x) => x !== '').join('\n').slice(0, 8000);
}
