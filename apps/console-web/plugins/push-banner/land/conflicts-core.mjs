/**
 * PR conflict watch, the pure part (build merge-conflict-alerts, Nov 7 2026). No IO, no model calls; this folder runs on
 * the host with node built-ins only.
 *
 * Every queue round scans every open PR against main with `git merge-tree` (no API call). A conflict counts when it is in
 * code: builds files, logs and generated files are settled by the queue itself (land-core.mjs planConflicts), the same
 * line the queue kicks on. Drafts aren't scanned: they aren't asking to land.
 *
 * The first scan is a baseline: everything already conflicting goes in one digest, not one push per PR. After that a new
 * conflict is pushed once, and a burst of them (a stack landing can break many PRs at once) is one digest again.
 * Nothing here launches anything: only Brett's Fix conflicts now does (control file `fix[pr]`, pinned to the head he saw).
 */
import { planConflicts } from './land-core.mjs';

export const CONFLICTS_FRAME = 'pr-conflicts@1';
export const CONFLICTS_CONTROL_FRAME = 'pr-conflicts-control@1';
export const DIGEST_KEY = 'conflict:digest';
export const alertKey = (n) => `conflict:${n}`;
export const fixBuildId = (n) => `conflict-fix-pr-${n}`;
/** More new conflicts than this in one round go out as one digest. */
export const BURST = 3;
/** A fix job that shows no result after this long stops counting as running: Fix conflicts now comes back. */
export const FIX_STALE_MIN = 180;

const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (Number.isInteger(v) && v > 0 ? v : 0);

/** One `git merge-tree --write-tree --name-only` answer: { clean } | { files: [code files] } | null when git failed. */
export function parseMergeTree(code, out) {
  if (code === 0) return { clean: true };
  if (code !== 1) return null;
  const names = String(out || '').split('\n\n')[0].split('\n').slice(1).map((x) => x.trim()).filter(Boolean);
  const files = planConflicts([...new Set(names)]).code;
  return files.length ? { files } : { clean: true };
}

/** Is an error from a merge attempt a conflict (GitHub 405, or main not merging in)? */
export const isConflictRefusal = (why) => /conflict/i.test(str(why));

/** One line for the alert and the view. */
export function filesText(files) {
  const f = files || [];
  return f.length ? `${f.slice(0, 4).join(', ')}${f.length > 4 ? `, +${f.length - 4} more` : ''}` : 'GitHub refused the merge';
}

/** Compare a scan with the last state: the new state, what to raise and what to clear. */
export function reconcile(prev, scans, { at = new Date().toISOString(), refused = {} } = {}) {
  const old = new Map((prev?.items || []).map((x) => [x.pr, x]));
  const baseline = !prev?.at;
  const items = []; const fresh = [];
  const fixOf = (o, head) => (o?.fix && o.fix.head === head ? o.fix : null);
  for (const s of scans) {
    const o = old.get(s.pr);
    const it = { pr: s.pr, title: str(s.title, 200), branch: str(s.branch, 200), url: str(s.url, 300), head: str(s.head, 40), build: str(s.build, 120), files: (s.files || []).slice(0, 30), why: '', since: o?.since || at, fix: fixOf(o, s.head) };
    items.push(it);
    // new here, or a fix moved the branch and it still conflicts
    if (!o || (o.fix && o.fix.head !== s.head)) fresh.push(it);
  }
  for (const [k, why] of Object.entries(refused)) {
    const pr = Number(k); if (!num(pr) || items.some((x) => x.pr === pr)) continue;
    const o = old.get(pr); const r = { pr, title: str(o?.title, 200), branch: str(o?.branch, 200), url: str(o?.url, 300), head: str(o?.head, 40), build: str(o?.build, 120), files: [], why: str(why, 300), since: o?.since || at, fix: o?.fix || null, refused: true };
    items.push(r); if (!o) fresh.push(r);
  }
  items.sort((a, b) => b.pr - a.pr);
  const resolved = [...old.values()].filter((o) => !items.some((x) => x.pr === o.pr));
  return { items, fresh, resolved, digest: fresh.length > 0 && (baseline || fresh.length > BURST), baseline };
}

/** The alert for one PR. Severity error reaches the bell and AmberX; `meta.pr` is what the Fix button acts on. */
export function alertFor(it, { consoleUrl = '' } = {}) {
  return {
    source: 'push-banner', key: alertKey(it.pr), severity: 'error',
    title: `PR #${it.pr} has merge conflicts`.slice(0, 200),
    body: `${it.title ? `${it.title}\n` : ''}${filesText(it.files)}${it.why ? `\n${it.why}` : ''}\nFix conflicts now launches a job that merges main in, resolves them and puts it back in the queue.`.slice(0, 1200),
    link: consoleUrl ? `${consoleUrl}/?axf-conflicts=${it.pr}` : 'settings:push-banner',
    meta: { pr: it.pr, branch: it.branch, head: it.head, label: 'Merge conflicts' },
  };
}

/** One alert for many: the first scan, or a burst after a stack landed. */
export function digestFor(items, { consoleUrl = '', baseline = false } = {}) {
  const top = items.slice(0, 6).map((x) => `#${x.pr} ${x.title}`.slice(0, 90)).join('\n');
  return {
    source: 'push-banner', key: DIGEST_KEY, severity: 'error',
    title: `${items.length} open PR${items.length === 1 ? ' has' : 's have'} merge conflicts`,
    body: `${baseline ? 'First scan of every open PR.\n' : ''}${top}${items.length > 6 ? `\n+${items.length - 6} more` : ''}`.slice(0, 1200),
    link: consoleUrl ? `${consoleUrl}/?axf-conflicts=all` : 'settings:push-banner',
    meta: { count: items.length, label: 'Merge conflicts' },
  };
}

/** Apply a control command. `fix` is pinned to the head Brett saw; a new head drops it. */
export function applyControl(doc, cmd, pr, { head = '', by = '', at = new Date().toISOString() } = {}) {
  const d = { $axf: CONFLICTS_CONTROL_FRAME, fix: {}, ...(doc && typeof doc === 'object' ? doc : {}) };
  d.fix = { ...(d.fix || {}) };
  const n = typeof pr === 'string' ? Number(pr.replace(/^#/, '')) : pr;
  if (!num(n)) throw new Error('send a PR number');
  if (cmd === 'fix') {
    if (!str(head, 40)) throw new Error('fix is pinned to the head shown');
    if (!str(by, 120)) throw new Error("Fix conflicts now is Brett's own click");
    d.fix[n] = { head: str(head, 40), by: str(by, 120), at };
  } else if (cmd === 'done') delete d.fix[n];
  else throw new Error(`unknown command ${cmd}`);
  return d;
}

/** The fix to run this round: one per PR, only while the PR still conflicts at the head Brett saw. */
export function fixesToRun(control, items) {
  const out = []; const drop = [];
  for (const [k, f] of Object.entries(control?.fix || {})) {
    const n = Number(k); const it = items.find((x) => x.pr === n);
    if (!it || it.head !== f.head || it.fix?.state === 'running') { drop.push(n); continue; }
    out.push({ item: it, request: f });
  }
  return { run: out, drop };
}

/** Did a running fix go quiet? */
export const fixStale = (fix, at, min = FIX_STALE_MIN) => fix?.state === 'running' && Date.parse(at) - Date.parse(fix.at) > min * 60000;

/** The build record (orchestrator) for a fix: id, title, Brett's tap as his words, one step. */
export function fixBuild(it, request) {
  return {
    action: 'add', id: fixBuildId(it.pr), title: `Fix conflicts: PR #${it.pr}`.slice(0, 120), category: 'merge-queue', source: 'console',
    detail: `Merge main into ${it.branch}, resolve the conflicts in ${filesText(it.files)}, rerun its checks and push, so PR #${it.pr} rejoins the merge queue.`,
    said: `Fix conflicts now (PR #${it.pr}, tapped by ${str(request?.by, 120)})`,
    steps: [{ text: `Merge main into ${it.branch}, resolve, check, push`, model: 'Opus', estimate: '30m' }],
  };
}

/** The agent job input for a fix (job type conflict-fix). */
export const fixJob = (it) => ({ type: 'conflict-fix', input: { pr: String(it.pr), branch: it.branch, build: fixBuildId(it.pr), files: filesText(it.files) } });
