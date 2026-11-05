/**
 * Merge queue, the pure part (build merge-queue, Brett Nov 4 2026: "We're paying to do these CI checks twice."). No IO,
 * no model calls: land.mjs (the host runner), the push banner's server and the console view read the same rules here.
 *
 * GitHub's own merge queue only works on organisation-owned repos (MossesX/AmberX-AXF belongs to a personal account),
 * so the queue is ours and works the same way:
 *   ready PRs line up (Brett's order first, then the build's priority tag, then auto-land's dependency order, then oldest). The first `depth` of them
 *   form a stack: queue/pr-<a> = main + a, queue/pr-<b> = queue/pr-<a> + b, …; CI runs once on each queue branch, on
 *   exactly the code main will have once everything ahead of it has merged. When the head's run is green it merges
 *   with no retest, and the next one's run already covered it. A red run is blamed only when everything ahead of it
 *   passed: that PR is kicked out with the failing jobs in plain words, and the ones behind it are rebuilt without it.
 *   Main moving in code outside the queue invalidates the stack (rebuilt on the new main); status-only `[skip ci]`
 *   commits under _claude/ never do.
 */

export const QUEUE_FRAME = 'merge-queue@1';
export const QUEUE_CONTROL_FRAME = 'merge-queue-control@1';
/** Settings (push banner config.json): the queue is on unless switched off; `queueDepth` PRs are tested at once. */
export const QUEUE_DEFAULTS = Object.freeze({ mergeQueue: true, queueDepth: 3 });
export const QUEUE_DEPTH_MAX = 6;
/** Minutes a queue commit may sit with no CI run before the runner starts one itself (workflow_dispatch). */
export const NO_RUN_MIN = 10;
/** Minutes one CI run takes when the queue has no history yet (learned from finished runs after that). */
export const DEFAULT_RUN_MIN = 14;
export const QUEUE_PREFIX = 'queue/pr-';
export const queueBranch = (n) => `${QUEUE_PREFIX}${n}`;
export const isQueueBranch = (b) => typeof b === 'string' && /^queue\/pr-\d+$/.test(b);

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (Number.isInteger(v) && v > 0 ? v : 0);

/** Is the code at two commits the same, given the files that differ? Status data under _claude/ doesn't count (= ci-scope.mjs sameCode). */
export const sameCodeFiles = (files) => (files || []).map((f) => String(f || '').trim()).filter(Boolean).every((f) => f.startsWith('_claude/'));

/** Entry states, in the words the view shows. */
export const STATES = Object.freeze({
  waiting: 'Waiting', testing: 'Testing', passed: 'Passed', merging: 'Merging', merged: 'Merged', kicked: 'Kicked out', held: 'Not in the queue',
});

/**
 * Why an open PR can't be in the queue (plain words), or '' when it can. `pr` is what the runner knows about it:
 *   { number, draft, head, ci: PR checks on its head (success|failure|running|none), ui: UI Review hold ('' = none),
 *     landHeld: auto-land hold reason, conflicts: [code files] }
 * `ctl` is the control document: removed[pr] = {head} (Remove from queue, until a new commit), kicked[pr] = {head}.
 */
export function notReady(pr, ctl = {}, { waitUi = true } = {}) {
  const n = num(pr?.number);
  if (!n) return 'not a pull request';
  if (pr.draft) return 'it is a draft';
  if (pr.fork) return 'it comes from a fork';
  const removed = ctl.removed?.[n];
  if (removed && (!removed.head || removed.head === pr.head) && !(ctl.added || []).includes(n)) return `taken out of the queue by hand${removed.why ? ` (${str(removed.why, 120)})` : ''}`;
  const kicked = ctl.kicked?.[n];
  if (kicked && kicked.head === pr.head && !(ctl.added || []).includes(n)) return `kicked out: ${str(kicked.why, 300)} Push a fix and it rejoins by itself.`;
  if (pr.landHeld) return `held by hand in auto-land (${str(String(pr.landHeld), 120)})`;
  if (waitUi && pr.ui) return pr.ui === 'waiting' ? 'its screenshots wait for Brett in UI Review' : `UI Review holds it (${str(pr.ui, 40)})`;
  if (pr.conflicts?.length) return `it conflicts with main in code (${pr.conflicts.slice(0, 3).join(', ')})`;
  if (pr.ci === 'failure') return 'its PR checks are red';
  if (pr.ci === 'running') return 'its PR checks are still running';
  // GitHub runs no PR checks on a PR that conflicts with main: the queue commit resolves data conflicts itself (and kicks
  // a code conflict out with the files named), so such a PR goes straight to its one full run
  if (pr.ci === 'none' && !pr.conflicted) return 'its PR checks have not run yet';
  return '';
}

/**
 * Queue order: Brett's own order (`ctl.order`, front first; Jump to front puts a PR at its start), then auto-land's
 * landing order (`rank`: PR number → index), then oldest first.
 */
/**
 * The priority a build's PR lands with: its stored tag, else Urgent when marked urgent, else Normal. This folder runs on
 * the host with node built-ins only, so it can't import framework/core/build-priority.mjs; the test holds the two together.
 */
export function buildPriority(b) {
  if (/^P[0-3]$/.test(str(b?.priority))) return b.priority;
  const marked = (b?.profiles ?? []).includes('urgent') || /(^|[^a-z])(urgent|hotfix)([^a-z]|$)/i.test(`${str(b?.id)} ${str(b?.title)}`)
    || /\b(URGENT|HOTFIX)\b/.test(`${str(b?.detail, 8000)}\n${str(b?.origin?.brief, 20000)}`) || /^\s*(urgent|hotfix)\b/im.test(`${str(b?.detail, 8000)}\n${str(b?.origin?.brief, 20000)}`);
  return marked ? 'P0' : 'P2';
}
const priorityRank = (p) => (/^P[0-3]$/.test(str(p)) ? Number(p[1]) : 2);

export function queueOrder(prs, ctl = {}, rank = {}, stack = []) {
  const manual = (Array.isArray(ctl.order) ? ctl.order : []).filter(num);
  const pos = new Map(manual.map((n, i) => [n, i]));
  // Brett's manual order first; then what is already in the stack, so a new priority never throws away a run in progress
  // (that CI is paid for); then the build's priority tag (higher lands first); then the old order
  const inStack = new Map(stack.map((e, i) => [e.pr, i]));
  const key = (p) => [pos.has(p.number) ? pos.get(p.number) : 1e6, inStack.has(p.number) ? inStack.get(p.number) : 1e6, priorityRank(p.priority), rank[p.number] ?? 1e6, str(p.createdAt) || '9', p.number];
  return [...prs].sort((a, b) => {
    const x = key(a); const y = key(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });
}

/**
 * The part of last round's stack that still holds. Entry i holds while it is still i-th in the queue (merged ones
 * dropped from both), its PR head is unchanged, it was built on the same unmerged PRs ahead of it, and main did not
 * move in code outside the queue. Everything from the first entry that doesn't hold is rebuilt.
 *   stack: [{ pr, head, ahead: [pr numbers in its queue commit before it], sha, base, … }]
 *   queue: ordered ready PRs [{ number, head }]; merged: Set of PR numbers merged by the queue
 */
export function keepStack(stack, queue, { merged = new Set(), mainMoved = false } = {}) {
  if (mainMoved) return [];
  const live = (stack || []).filter((e) => !merged.has(e.pr));
  const out = [];
  for (let i = 0; i < live.length; i++) {
    const e = live[i]; const q = queue[i];
    if (!q || q.number !== e.pr || q.head !== e.head || !e.sha) break;
    const ahead = (e.ahead || []).filter((n) => !merged.has(n));
    const want = queue.slice(0, i).map((x) => x.number);
    if (ahead.length !== want.length || ahead.some((n, k) => n !== want[k])) break;
    out.push(e);
  }
  return out;
}

/**
 * What to do with the stack given each entry's CI on its queue commit (`ci[pr]` = success|failure|running|none):
 *   merge: the green PRs at the head, in order (each one's run covered everything ahead of it, so no retest)
 *   kick:  the first red PR whose every entry ahead passed (only it can be to blame), or null
 *   keep:  how many entries stay; the rest (behind a kicked one) are rebuilt without it
 */
export function decide(stack, ci = {}) {
  const merge = []; let kick = null; let i = 0;
  for (; i < stack.length; i++) {
    const c = ci[stack[i].pr] || 'none';
    if (c === 'success') { if (merge.length === i) merge.push(stack[i].pr); continue; }
    if (c === 'failure') kick = stack[i].pr;
    break;
  }
  return { merge, kick, keep: kick ? i : stack.length };
}

/** The plain-words reason a PR was kicked out (shown in the view, the alert and on the bugs board). */
export function kickReason(pr, { failing = [], ahead = [], url = '' } = {}) {
  const jobs = failing.filter(Boolean).slice(0, 4);
  const on = ahead.length ? `main + ${ahead.map((n) => `#${n}`).join(', ')}` : 'main';
  return `#${pr} broke CI when tested on top of ${on}${jobs.length ? ` (failed: ${jobs.join(', ')})` : ''}.${url ? ` Run: ${url}` : ''}`.slice(0, 600);
}

/** Average minutes of the last finished queue runs (learned), else the default. */
export function runMinutes(history = []) {
  const ds = history.filter((m) => typeof m === 'number' && m > 0 && m < 240).slice(-10);
  return ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : DEFAULT_RUN_MIN;
}

/**
 * Minutes until each entry should merge. In the stack: its run's time left (runs go in parallel). Behind the stack:
 * one more run per `depth` entries ahead of it.
 */
export function etaMinutes(index, { depth = 3, avg = DEFAULT_RUN_MIN, startedMin = null } = {}) {
  if (index < depth) return Math.max(1, Math.round(avg - (startedMin ?? 0)));
  return Math.round(avg * (1 + Math.floor((index - depth) / depth) + 1));
}

/** The commands, declared once: the CLI, the push banner's REST routes and (through plugin-commands@1) MCP. */
export const QUEUE_COMMANDS = Object.freeze([
  { id: 'mergequeue-list', method: 'GET', path: '/queue', cli: 'list', title: 'Merge queue: the line', description: 'Every PR in the merge queue in order: title, agent, test state (waiting, testing, passed, kicked out and why), ETA; and the open PRs not in it, with why.', effect: 'read' },
  { id: 'mergequeue-add', method: 'POST', path: '/queue/add', cli: 'add', title: 'Merge queue: add a PR', description: 'Put a PR (back) in the merge queue: undoes Remove from queue or a kick-out at the same head. It still has to be ready (PR checks green, not held by UI Review).', effect: 'write', input: { pr: 'PR number' } },
  { id: 'mergequeue-remove', method: 'POST', path: '/queue/remove', cli: 'remove', title: 'Merge queue: remove a PR', description: 'Take a PR out of the merge queue until it gets a new commit or is added again; the ones behind it are retested without it.', effect: 'write', input: { pr: 'PR number', why: 'optional reason' } },
  { id: 'mergequeue-move', method: 'POST', path: '/queue/move', cli: 'move', title: 'Merge queue: move a PR', description: "Move a PR to a place in the merge queue (0 = front). Jump to front from the console is Brett's own click.", effect: 'write', input: { pr: 'PR number', to: 'new index, 0 = front' } },
]);

/** Apply one control command (add | remove | move | kick | clear-kick). Returns the new control document. */
export function applyQueueControl(doc, cmd, pr, { why = '', to = 0, head = '', at = new Date().toISOString(), current = [] } = {}) {
  const d = { $axf: QUEUE_CONTROL_FRAME, order: [], removed: {}, kicked: {}, added: [], ...(doc && typeof doc === 'object' ? doc : {}) };
  d.order = [...(d.order || [])].filter(num); d.removed = { ...(d.removed || {}) }; d.kicked = { ...(d.kicked || {}) }; d.added = [...(d.added || [])].filter(num);
  const n = typeof pr === 'string' ? Number(pr.replace(/^#/, '')) : pr;
  if (!num(n)) throw new Error('send a PR number');
  if (cmd === 'add') { delete d.removed[n]; delete d.kicked[n]; d.added = [...new Set([...d.added, n])].slice(-50); }
  else if (cmd === 'remove') { d.removed[n] = { why: str(why, 200), head: str(head, 40), at }; d.order = d.order.filter((x) => x !== n); d.added = d.added.filter((x) => x !== n); }
  else if (cmd === 'kick') { d.kicked[n] = { why: str(why, 600), head: str(head, 40), at }; d.added = d.added.filter((x) => x !== n); }
  else if (cmd === 'move') {
    const i = Number(to);
    if (!Number.isInteger(i) || i < 0) throw new Error('to is the new index (0 = front)');
    // the order Brett sees now becomes the manual order, with this PR at its new place
    const base = [...new Set([...(current || []).filter(num), ...d.order])].filter((x) => x !== n);
    base.splice(Math.min(i, base.length), 0, n);
    d.order = base.slice(0, 100);
  } else throw new Error(`unknown command ${cmd}`);
  d.updatedAt = at;
  return d;
}

/** Drop control entries for PRs that are no longer open (keeps the document small). */
export function pruneControl(doc, open) {
  const ok = new Set(open);
  const keepObj = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => ok.has(Number(k))));
  return { ...doc, order: (doc.order || []).filter((n) => ok.has(n)), added: (doc.added || []).filter((n) => ok.has(n)), removed: keepObj(doc.removed), kicked: keepObj(doc.kicked) };
}

/** The banner chip: "Merge queue: N" (N = PRs in the line), with the worst state for its colour. */
export function chip(state) {
  const items = Array.isArray(state?.items) ? state.items : [];
  const n = items.length;
  const kicked = (state?.kicked || []).length;
  return { label: `Merge queue: ${n}`, count: n, testing: items.filter((x) => x.state === 'testing').length, kicked, tone: kicked ? 'warning' : n ? 'info' : 'muted' };
}
