/**
 * Lander, the pure part (build merge-all-ready-buttons-server-side-lander, Brett Nov 12 2026). No IO, no clock, no
 * model calls: lander.mjs (the host service), the push banner's server and the tests read the same rules from here.
 *
 * The lander replaces the merge queue. It merges ready PRs into main ONE AT A TIME through the main gate:
 *   1. pick the next PR (finished builds first, then Brett's Merge requests, then the backlog oldest first);
 *   2. behind main → merge main into the PR branch (builds files newer-wins, logs unioned, generated files
 *      regenerated; a plain push, never a force-push) and wait for the PR's tests on that new head;
 *   3. tests green on the exact head, not behind main in code → GitHub merge pinned to that head;
 *   4. tests red → blocked with the failing checks named; a code conflict → blocked with the files named (one
 *      fixer job on the current Claude account); both stay blocked until the PR gets a new commit.
 * Builds that finish while the lander runs merge themselves the same way (merge on finish), ahead of the backlog.
 */

export const LANDER_FRAME = 'lander@1';
export const LANDER_CONTROL_FRAME = 'lander-control@1';
export const GATE_LOG_FRAME = 'server-gate-log@1';

/** Settings (push banner config.json). The lander is on unless Brett switches it off. */
export const LANDER_DEFAULTS = Object.freeze({ lander: true, landerWaitUi: true, landerFixConflicts: true });
/** Seconds between two lander steps while something is in flight, and while idle. */
export const STEP_SEC = 30;
export const IDLE_SEC = 90;
/** Tests that haven't finished after this long block the PR (a stuck run). */
export const TEST_TIMEOUT_MIN = 90;
/** Times main is merged into one PR in one attempt before it is blocked as "main keeps moving". */
export const MAX_CATCH_UPS = 3;
/** Claude accounts the lander's conflict fixer uses, in order (Brett, Nov 12 2026): Moses X, then Hulu API, then Hulu. */
export const ACCOUNT_ORDER = Object.freeze(['mossesx-max-', 'account-5', 'account-3']);

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (Number.isInteger(v) && v > 0 ? v : 0);

/** Item states, in the words the banner shows. */
export const STATES = Object.freeze({
  ready: 'Ready', catching: 'Updating from main', testing: 'Testing', merging: 'Merging', merged: 'Merged',
  blocked: 'Blocked', waiting: 'Not ready',
});

/**
 * Why an open PR can't go through the gate yet (plain words), or '' when it can.
 * `pr` = { number, draft, head, ci: success|failure|running|none, ui: UI Review hold ('' none), held: hand hold,
 *          blocked: { head, why } the lander's own mark }
 */
export function notReady(pr, { waitUi = true } = {}) {
  if (!num(pr?.number)) return 'not a pull request';
  if (pr.draft) return 'it is a draft';
  if (pr.fork) return 'it comes from a fork';
  if (pr.held) return `held by hand (${str(String(pr.held), 120)})`;
  if (pr.blocked && pr.blocked.head === pr.head) return `blocked: ${str(pr.blocked.why, 300)}`;
  if (waitUi && pr.ui) return pr.ui === 'waiting' ? 'its screenshots wait for Brett in UI Review' : `UI Review holds it (${str(pr.ui, 40)})`;
  return '';
}

/**
 * Landing order: builds that just finished (merge on finish) first, then PRs Brett asked to merge (in the order asked),
 * then build priority (P0 first), then oldest first. `ctl` = { finished: [pr], requested: [pr] }.
 */
export function order(prs, ctl = {}) {
  const fin = new Map((ctl.finished || []).filter(num).map((n, i) => [n, i]));
  const req = new Map((ctl.requested || []).filter(num).map((n, i) => [n, i]));
  const pri = (p) => (/^P[0-3]$/.test(str(p.priority)) ? Number(p.priority[1]) : 2);
  const key = (p) => [fin.has(p.number) ? 0 : 1, fin.get(p.number) ?? 0, req.has(p.number) ? 0 : 1, req.get(p.number) ?? 0, pri(p), Date.parse(p.createdAt || '') || 0, p.number];
  return [...prs].sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
}

/**
 * Which PRs the lander may take this step. `mode`: 'all' (on: the whole backlog), 'requested' (off, but Brett pressed
 * Merge on some rows or a build finished: only those). Returns the eligible PRs in landing order.
 */
export function eligible(prs, ctl = {}, { on = true, waitUi = true } = {}) {
  const asked = new Set([...(ctl.finished || []), ...(ctl.requested || [])]);
  const ready = prs.filter((p) => !notReady(p, { waitUi }) && (on || ctl.drain || asked.has(p.number)));
  return order(ready, ctl);
}

/**
 * The gate for the PR in flight. `f` = { ci, behind: commits of main not in it that touch code, conflicts: [code
 * files], catchUps, testingMin }. Returns { act: merge|catch-up|wait|block, why }.
 */
export function gate(f = {}) {
  if (f.conflicts?.length) return { act: 'block', why: `it conflicts with main in ${f.conflicts.slice(0, 3).join(', ')}${f.conflicts.length > 3 ? ` and ${f.conflicts.length - 3} more` : ''}` };
  if (f.behind > 0) {
    if ((f.catchUps || 0) >= MAX_CATCH_UPS) return { act: 'block', why: `main moved ${MAX_CATCH_UPS} times while its tests ran; it goes back in line` };
    return { act: 'catch-up', why: `${f.behind} commit(s) behind main` };
  }
  if (f.ci === 'failure') return { act: 'block', why: `its tests failed${f.failing?.length ? ` (${f.failing.slice(0, 3).join(', ')})` : ''}` };
  if (f.ci === 'success') return { act: 'merge', why: 'tests passed on its head, up to date with main' };
  if ((f.testingMin || 0) >= TEST_TIMEOUT_MIN) return { act: 'block', why: `its tests didn't finish in ${TEST_TIMEOUT_MIN} minutes` };
  return { act: 'wait', why: f.ci === 'none' ? 'its tests haven\'t started yet' : 'its tests are running' };
}

/**
 * The Claude account for the conflict fixer: the first account in ACCOUNT_ORDER that can run now (not out of usage,
 * key present, under its caps). `accounts` = claude-workers@1 status rows. Returns { account, label, why } ('' = none).
 * Moses X comes back the moment it resets (it is first in the order again).
 */
export function pickAccount(accounts = [], prefer = ACCOUNT_ORDER) {
  const rows = new Map((accounts || []).map((a) => [a?.name, a]));
  const skipped = [];
  for (const name of prefer) {
    const a = rows.get(name);
    if (!a) { skipped.push(`${name} not signed in`); continue; }
    const out = a.limited ? `out until ${str(String(a.limited?.until || a.limited?.reset || a.limited), 40)}` : a.hasKey === false ? 'no key' : a.canRun === false ? (a.why || 'can\'t run now') : '';
    if (out) { skipped.push(`${a.label || name} ${out}`); continue; }
    return { account: name, label: a.label || name, why: skipped.join('; ') };
  }
  return { account: '', label: '', why: skipped.join('; ') || 'no Claude account can run' };
}

/** A Server gate log entry (the gate log page reads these). */
export function gateEntry({ at, gate: g = 'main gate', build = '', pr = 0, by = 'lander', did = '', why = '' }) {
  return { $axf: GATE_LOG_FRAME, at, gate: str(g, 60), build: str(build, 120), pr: num(pr) || undefined, by: str(by, 80), did: str(did, 120), why: str(why, 400) };
}

/** The banner's one line of progress for the lander state. */
export function progress(st = {}) {
  const items = st.items || [];
  const merged = (st.merged || []).length; const blocked = items.filter((x) => x.state === 'blocked').length;
  const ready = items.filter((x) => x.state === 'ready').length;
  const cur = st.current;
  const now = cur ? `#${cur.pr} ${STATES[cur.phase] || cur.phase}` : (st.on || st.drain ? 'idle' : 'off');
  return { now, merged, blocked, ready, total: items.length, text: `${now} · ${ready} ready · ${blocked} blocked · ${merged} merged` };
}

/** Commands (one list: REST, CLI, MCP and voice read the same). */
export const LANDER_COMMANDS = Object.freeze([
  { cli: 'merge-all', title: 'Merge all ready', body: [] },
  { cli: 'merge', title: 'Merge this PR now', body: ['pr'] },
  { cli: 'finish', title: 'A build finished: merge it now', body: ['build'] },
  { cli: 'unblock', title: 'Try a blocked PR again', body: ['pr'] },
  { cli: 'stop', title: 'Stop after the PR in flight', body: [] },
]);

/** Apply a command to the control document. Pure. */
export function applyControl(doc, cmd, arg, { at = '' } = {}) {
  const d = { $axf: LANDER_CONTROL_FRAME, finished: [], requested: [], blocked: {}, finishedBuilds: [], ...(doc || {}) };
  const n = Number(arg);
  const add = (list, v) => (list.includes(v) ? list : [...list, v]);
  if (cmd === 'merge-all') return { ...d, drain: at || true, stop: false };
  if (cmd === 'stop') return { ...d, drain: false, stop: at || true, requested: [] };
  if (cmd === 'merge') { if (!num(n)) throw new Error('merge <pr>'); return { ...d, requested: add(d.requested, n), stop: false }; }
  if (cmd === 'unblock') { if (!num(n)) throw new Error('unblock <pr>'); const b = { ...d.blocked }; delete b[n]; return { ...d, blocked: b, requested: add(d.requested, n) }; }
  if (cmd === 'finish') { const id = str(String(arg || ''), 120); if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('finish <build id>'); return { ...d, finishedBuilds: add(d.finishedBuilds, id), stop: false }; }
  throw new Error(`unknown lander command: ${cmd}`);
}

/** Drop control entries for PRs that are no longer open. Pure. */
export function pruneControl(doc, open) {
  const o = new Set(open);
  const blocked = Object.fromEntries(Object.entries(doc.blocked || {}).filter(([k]) => o.has(Number(k))));
  return { ...doc, finished: (doc.finished || []).filter((n) => o.has(n)), requested: (doc.requested || []).filter((n) => o.has(n)), blocked };
}
