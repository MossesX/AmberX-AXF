/**
 * Auto-land, the pure part (build auto-land, Brett Nov 3 2026: "zero tokens for merging"). No IO, no model calls:
 * land.mjs (the host runner) and the push banner's server read the same rules from here.
 *
 * A finished build (builds@1 status `built`, or every step done, with a branch) is landed by plain scripts:
 *   clean its worktree (synced files committed on its own branch, scratch files skipped, untracked duplicates of hub
 *   files backed up) → merge origin/main in (builds files newer-wins, union files unioned, generated files taken from
 *   main and regenerated) → push → its PR is opened / linked → the push banner merges it once CI is green on that head
 *   and UI Review doesn't hold it, in dependency order, one per round.
 * Anything that needs judgement (a code conflict, CI red) is reported in plain words; only those two create an agent
 * job. Everything else waits by itself (CI running, UI Review waiting, a dependency not merged yet).
 *
 * The one import is the generated-files manifest (generated-files@1): which files a merge resolves by itself and how.
 */
import manifest from '../../../../../framework/spec/generated-files.json' with { type: 'json' };

export const LAND_FRAME = 'auto-land@1';
export const CONTROL_FRAME = 'auto-land-control@1';

/**
 * Settings (push banner config.json): on unless switched off. Auto-land is the default for every build again (Brett,
 * Nov 13 2026: "what's it gonna take to get you to merge and land what's completed"); one build is switched off with
 * the per-build switch (land-control `off`). A config written before that (no `autoLandRev`, the Nov 4 "off") is read
 * as on: the old off was the reason finished builds sat unlanded.
 */
export const LAND_DEFAULTS = Object.freeze({ autoLand: true, landWaitUi: true });
/** The config revision from which an explicit `autoLand: false` is honoured. */
export const AUTO_LAND_REV = 2;

/** Is auto-land on, from the raw config.json object? */
export function autoLandOn(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return c.autoLandRev === AUTO_LAND_REV ? c.autoLand !== false : true;
}

/** Is auto-land on for this one build (the per-build switch; on unless switched off)? */
export const buildOn = (ctl, id) => !(ctl && ctl.off && typeof ctl.off === 'object' && ctl.off[id]);

/** Commit messages of status-only commits on main (framework/cli/builds-live.mjs, the reconciler, the store). */
export const STATUS_ONLY_MARK = '[skip ci]';
/** Paths status-only commits may touch: the builds store and its exports, journals and the threads log. */
export const STATUS_PATHS = /^_claude\//;

/** Files that are scratch in a build's worktree: never committed, never block a landing. */
const SCRATCH = [/^\.brief\.md$/, /^[^/]+\.log$/, /^[^/]+\.jsonl$/, /^\.axf-[^/]*$/, /^\.claude-sync-hold$/, /(^|\/)node_modules(\/|$)/, /^\.shots-harness\//];
/** Synced data (claude-sync, persist.mjs): changes here are committed on the build's own branch. */
const SYNCED = [/^_claude\//, /^changes\//, /^sessions\//, /^apps\/[^/]+\/_claude\//, /^framework\/plan\//, /^framework\/catalog\/status\.json$/, /^tracker\.json$/, /^project\.manifest\.json$/, /^apps\/[^/]+\/project\.manifest\.json$/];

/** Builds files: merged per build and step, newer wins (builds-live.mjs merge driver). */
const BUILDS = [/^_claude\/builds\/store\.json$/, /^_claude\/builds\/orchestrator\.json$/, /^_claude\/builds\/profiles\/[^/]+\/orchestrator\.json$/, /^_claude\/builds\/journal\/[^/]+\.jsonl$/];
/** Line files: both sides' lines kept (union). */
const UNION = [/^_claude\/THREADS\.md$/, /^_claude\/memory\/STATUS\.md$/, /^_claude\/memory\/decisions\.md$/, /\.log$/, /\.jsonl$/];
/**
 * Generated and additive files (generated-files@1, framework/spec/generated-files.json: the one manifest this runner,
 * the merge queue and the vps.build_land resolver share). A clash in one of these never needs a person:
 *   regen        main's copy is taken, then the named generator runs on the merged tree (control inventory, help bake,
 *                framework re-bake + lock, fixtures, tracker) and its outputs are committed with the merge
 *   union-json   both sides' keys kept (3-way merge by key; main wins a scalar clash): help packs, catalog status
 *   union-lines  both sides' lines kept (git merge-file --union): PORTING.md
 *   main         main's copy is enough (plan exports, hub data copies)
 */
const MANIFEST = manifest;
const GENERATED = (MANIFEST.files || []).map((f) => ({ ...f, re: new RegExp(f.match) }));
const GENERATORS = MANIFEST.generators || {};

const any = (list, p) => list.some((r) => r.test(p));
const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
const rule = (p) => GENERATED.find((g) => g.re.test(p));

/** What kind of file a merge conflict is in: builds | union | union-json | generated | code. Only `code` needs a person. */
export function classifyPath(path) {
  const p = str(path, 400).replace(/^\.\//, '');
  if (any(BUILDS, p)) return 'builds';
  if (any(UNION, p)) return 'union';
  const g = rule(p);
  if (!g) return 'code';
  if (g.merge === 'union-json') return 'union-json';
  if (g.merge === 'union-lines') return 'union';
  return 'generated';
}

/** The generator a generated file needs, with {app} filled in: { id, run, check, outputs, timeoutMs } or null (main's copy is enough). */
export function generatorFor(path) {
  const p = str(path, 400).replace(/^\.\//, '');
  const g = rule(p);
  if (!g || g.merge !== 'regen' || !GENERATORS[g.generator]) return null;
  const gen = GENERATORS[g.generator];
  const app = g.app ? (p.match(g.re) || [])[g.app] || '' : '';
  const fill = (x) => String(x).replace(/\{app\}/g, app);
  return { id: app ? `${g.generator}:${app}` : g.generator, run: (gen.run || []).map(fill), check: gen.check ? gen.check.map(fill) : null, outputs: (gen.outputs || []).map(fill), timeoutMs: gen.timeoutMs || 120000, optional: gen.optional === true };
}

/** The command that regenerates a generated file (null = main's copy is enough). */
export function regenFor(path) {
  const g = generatorFor(path);
  return g ? g.run : null;
}

/** The generators a set of regenerated files needs, each once, in manifest order. */
export function regenPlan(paths) {
  const out = new Map();
  for (const p of paths || []) { const g = generatorFor(p); if (g && !out.has(g.id)) out.set(g.id, g); }
  return [...out.values()];
}

/** The quick tests the manifest asks for after generated or additive files were resolved. */
export const landTests = () => (MANIFEST.tests || []).map((t) => [...t]);

/** Split a merge's conflicted files: auto-resolvable by kind, and the code ones a person (or an agent) must look at. */
export function planConflicts(paths) {
  const out = { builds: [], union: [], unionJson: [], generated: [], code: [] };
  for (const p of paths || []) { const k = classifyPath(p); out[k === 'union-json' ? 'unionJson' : k].push(p); }
  return out;
}

/**
 * 3-way merge of JSON values (additive catalogs and help packs: both sides' keys kept). `b` = base, `o` = ours,
 * `t` = theirs; `prefer` names the side whose scalar wins a true clash ('ours' | 'theirs'). Objects merge by key
 * (a key one side deleted and the other left alone stays deleted), lists of `{ id }` records merge by id, other
 * lists are unioned in order.
 */
export function mergeJson3(b, o, t, prefer = 'theirs') {
  const MISSING = Symbol('missing');
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const rec = (b, o, t) => {
    if (same(o, t)) return o;
    if (same(b, o)) return t;
    if (same(b, t)) return o;
    if (isObj(o) && isObj(t)) {
      const bd = isObj(b) ? b : {};
      const out = {};
      for (const k of [...Object.keys(o), ...Object.keys(t).filter((k) => !(k in o))]) {
        const ov = k in o ? o[k] : MISSING; const tv = k in t ? t[k] : MISSING; const bv = k in bd ? bd[k] : MISSING;
        if (ov === MISSING) { if (bv !== MISSING && same(bv, tv)) continue; out[k] = tv; continue; }
        if (tv === MISSING) { if (bv !== MISSING && same(bv, ov)) continue; out[k] = ov; continue; }
        out[k] = rec(bv === MISSING ? undefined : bv, ov, tv);
      }
      return out;
    }
    if (Array.isArray(o) && Array.isArray(t)) {
      const key = (x) => (isObj(x) && typeof x.id === 'string' ? x.id : null);
      if ([...o, ...t].length && [...o, ...t].every((x) => key(x) !== null)) {
        const bl = new Map((Array.isArray(b) ? b : []).filter((x) => key(x) !== null).map((x) => [key(x), x]));
        const tm = new Map(t.map((x) => [key(x), x])); const om = new Map(o.map((x) => [key(x), x]));
        const out = [];
        for (const x of o) { const k = key(x); if (tm.has(k)) out.push(rec(bl.get(k), x, tm.get(k))); else if (bl.has(k) && same(bl.get(k), x)) continue; else out.push(x); }
        for (const x of t) { const k = key(x); if (om.has(k)) continue; if (bl.has(k) && same(bl.get(k), x)) continue; out.push(x); }
        return out;
      }
      const out = [...o];
      for (const x of t) if (!out.some((y) => same(x, y))) out.push(x);
      return out;
    }
    return prefer === 'ours' ? o : t;
  };
  return rec(b, o, t);
}

/**
 * What to do with each line of `git status --porcelain` in a finished build's worktree.
 *   commit   synced data changed here (claude-sync / persist wrote it): committed on the build's own branch
 *   skip     scratch (.brief.md, logs, jsonl, .axf-* files): left alone, never committed
 *   archive  untracked file that is a copy of a hub file (claude-sync dropped it): moved to /root/archive/<build>/
 *   restore  tracked synced file whose content is the hub's copy (a sync drop, not the build's work): backed up the
 *            same way, then put back to the branch's version (the hub keeps it; nothing is lost)
 *   code     tracked code changed but not committed: the landing waits and says so (never committed for the build)
 *   keep     untracked file that isn't a hub copy: left alone
 * `hubHas(path)` says whether the hub (/projects/<name>/_claude …) has a file at that repo path.
 */
export function strayPlan(porcelain, hubHas = () => false) {
  const plan = { commit: [], skip: [], archive: [], restore: [], code: [], keep: [] };
  for (const raw of String(porcelain || '').split('\n')) {
    if (!raw.trim()) continue;
    const xy = raw.slice(0, 2); let p = raw.slice(3).trim();
    if (p.includes(' -> ')) p = p.split(' -> ').pop();
    p = p.replace(/^"|"$/g, '');
    if (any(SCRATCH, p)) { plan.skip.push(p); continue; }
    const untracked = xy === '??'; const deleted = xy.includes('D');
    if (!deleted && hubHas(p)) { (untracked ? plan.archive : plan.restore).push(p); continue; }
    if (untracked) { (any(SYNCED, p) ? plan.commit : plan.keep).push(p); continue; }
    (any(SYNCED, p) ? plan.commit : plan.code).push(p);
  }
  return plan;
}

const ALL_DONE = (b) => Array.isArray(b.steps) && b.steps.length > 0 && b.steps.every((s) => s.done);

/** A build the pipeline should land: finished (built, or every step done), with a branch, not merged, not archived. */
export function isCandidate(b) {
  if (!b || b.deleted || b.hidden) return false;
  if (!str(b.branch) || b.branch === 'main') return false;
  if (b.mergedAt || ['complete', 'archived', 'failed', 'broken', 'cancelled'].includes(b.status)) return false;
  return b.status === 'built' || ALL_DONE(b);
}

/** One landing per branch: builds that share a branch (a build and its "-done" follow-up) land as one, the first. */
export function uniqueByBranch(cands) {
  const first = new Map();
  for (const b of cands) { const f = first.get(b.branch); if (f) (f.alsoBuilds ??= []).push(b.id); else first.set(b.branch, { ...b }); }
  return [...first.values()];
}

/** A running build (s5): status running / waiting / blocked with a branch, steps left, not merged. */
export function isRunning(b) {
  if (!b || b.deleted || b.hidden || b.mergedAt) return false;
  if (!str(b.branch) || b.branch === 'main') return false;
  return ['running', 'waiting'].includes(b.status) && !ALL_DONE(b);
}
/** Running builds get main merged in this often, at most MAX_REFRESH a round. */
export const REFRESH_MS = 30 * 60 * 1000;
export const MAX_REFRESH = 2;
/** Running builds whose last refresh is REFRESH_MS old or more, oldest first. */
export function refreshDue(builds, last = {}, nowMs = Date.now()) {
  const t = (id) => Date.parse(last[id]?.at || 0) || 0;
  return (builds || []).filter(isRunning).filter((b) => nowMs - t(b.id) >= REFRESH_MS).sort((a, b) => t(a.id) - t(b.id));
}

/** At most this many branches get main merged in per round, so CI isn't flooded; the rest wait their turn (quiet). */
export const MAX_MAIN_MERGES = 3;

/** "Land after X" / "after X lands" in a build's notes or detail names a dependency (only ids of real builds). */
export function noteDeps(b, ids) {
  const text = [str(b.detail, 8000), ...(Array.isArray(b.notes) ? b.notes.map((n) => str(n?.text, 2000)) : [])].join('\n').toLowerCase();
  const out = new Set();
  for (const m of text.matchAll(/\b(?:land|merge)s?\s+after\s+([a-z0-9][a-z0-9._-]{1,80})|\bafter\s+([a-z0-9][a-z0-9._-]{1,80})\s+(?:lands|merges|is merged)/g)) {
    const id = (m[1] || m[2] || '').replace(/['’]s$/, '').replace(/[.,;:]+$/, '');
    if (id && id !== b.id && ids.has(id)) out.add(id);
  }
  return [...out];
}

/**
 * Dependency order for the batch: a build goes after every candidate it depends on (control `after`, "land after X"
 * notes, a branch that contains another candidate's head), else oldest finished first. Cycles fall back to age.
 * `contains(a, b)` = a's branch already contains b's head (built on top of it).
 */
export function landOrder(cands, { after = {}, contains = () => false } = {}) {
  const ids = new Set(cands.map((c) => c.id));
  const deps = new Map(cands.map((c) => [c.id, new Set([...(after[c.id] || []).filter((x) => ids.has(x)), ...noteDeps(c, ids)])]));
  for (const a of cands) for (const b of cands) if (a.id !== b.id && contains(a, b) && !contains(b, a)) deps.get(a.id).add(b.id);
  const age = (c) => str(c.builtAt) || str(c.updatedAt) || str(c.createdAt) || '9';
  const left = [...cands].sort((x, y) => (age(x) < age(y) ? -1 : age(x) > age(y) ? 1 : x.id < y.id ? -1 : 1));
  const out = []; const placed = new Set();
  while (left.length) {
    const i = left.findIndex((c) => [...deps.get(c.id)].every((d) => placed.has(d)));
    const c = left.splice(i >= 0 ? i : 0, 1)[0]; // a cycle: the oldest goes first
    out.push(c); placed.add(c.id);
  }
  return out.map((c) => ({ id: c.id, after: [...deps.get(c.id)] }));
}

/** Are the commits on main a branch lacks only status data (all `[skip ci]`, all files under _claude/)? */
export function statusOnly(commits, files) {
  if (!Array.isArray(commits) || !commits.length) return true;
  if (!commits.every((m) => String(m || '').includes(STATUS_ONLY_MARK))) return false;
  return Array.isArray(files) && files.every((f) => STATUS_PATHS.test(String(f || '')));
}

/**
 * Why a landing can't go on, in plain words, or null when nothing holds it. `s` is what the runner found:
 *   { code: [files], conflicts: [files], ci: 'success'|'failure'|'running'|'none', failing: [check names],
 *     ui: '' | 'waiting' | 'changes' | 'rejected' | 'unknown', waitUi, deps: [build ids not merged], held: why,
 *     pushError, prError }
 * kind = held | code | conflict | ci | ui | dependency | push | pr | running. `agent` = needs a code change (only
 * conflict and ci): those, and only those, may create an agent job.
 */
export function blockReason(id, s = {}) {
  const r = (kind, text, extra = {}) => ({ kind, text: `${id}: ${text}`, agent: kind === 'conflict' || kind === 'ci', ...extra });
  if (s.held) return r('held', `held by hand${s.held === true ? '' : ` (${str(s.held, 160)})`}. Release it to land it.`);
  if (s.code?.length) return r('code', `its worktree has code changes that were never committed (${s.code.slice(0, 4).join(', ')}${s.code.length > 4 ? ', …' : ''}). Commit or drop them, then it lands.`);
  if (s.conflicts?.length) return r('conflict', `merging main into it conflicts in code (${s.conflicts.slice(0, 4).join(', ')}${s.conflicts.length > 4 ? ', …' : ''}). Needs a code fix.`, { files: s.conflicts.slice(0, 20) });
  if (s.pushError) return r('push', `pushing its branch failed (${str(s.pushError, 160)}).`);
  if (s.prError) return r('pr', `its pull request couldn't be opened (${str(s.prError, 160)}).`);
  if (s.deps?.length) return r('dependency', `waits for ${s.deps.join(', ')} to land first.`);
  if (s.ci === 'failure') return r('ci', `CI is red${s.failing?.length ? ` (${s.failing.slice(0, 3).join(', ')})` : ''}. Needs a code fix.`, { checks: (s.failing || []).slice(0, 10) });
  if (s.waitUi !== false && s.ui && s.ui !== '') {
    const words = { waiting: 'its screenshots are waiting in UI Review. Approve them and it merges by itself.', changes: 'UI Review asked for changes.', rejected: 'UI Review rejected it.', unknown: "UI Review couldn't be read, so it waits." };
    return r('ui', words[s.ui] || `UI Review holds it (${str(s.ui, 40)}).`);
  }
  if (s.ci === 'running' || s.ci === 'none') return r('running', s.ci === 'running' ? 'CI is running on its head.' : 'CI has not run on its head yet; started it.', { quiet: true });
  return null;
}

/**
 * The serial landing line (Brett, Nov 13 2026; fixes "cannot lock ref 'refs/remotes/origin/main'"): every landing
 * (the cron round, the finish hook's round, `land.mjs serial -- <cmd>` for anything else that lands) holds one lock,
 * so two never fetch, merge or push at once. A lock older than LOCK_STALE_MS belongs to a killed run and is taken over.
 */
export const LOCK_STALE_MS = 20 * 60 * 1000;
/** How long a waiting landing waits for the line before it leaves its request for the next round. */
export const LOCK_WAIT_MS = 15 * 60 * 1000;
/** git errors that mean another git process held a ref lock at that moment: retried, never reported. */
export const REF_LOCK_ERR = /cannot lock ref|unable to update local ref|Unable to create '[^']*\.lock'|is at [0-9a-f]+ but expected/i;

/** The alert key for a blocked build (one per build; a new reason replaces the old text, never a second push). */
export const alertKey = (id) => `land:${id}`;

/** Should Brett get a push for this reason now? Once per (build, kind, head): never for quiet waits. */
export function shouldPush(prev, reason, head) {
  if (!reason || reason.quiet) return false;
  return !(prev && prev.kind === reason.kind && prev.head === head);
}

/** The one alert for a blocked build: plain words, what to do, and since when. */
export function alertFor(reason, { pr = '', since = '' } = {}) {
  const id = reason.text.split(':')[0];
  return {
    source: 'push-banner', key: alertKey(id), severity: reason.kind === 'ci' || reason.kind === 'conflict' ? 'error' : 'warning',
    title: `Not landed: ${reason.text}`.slice(0, 200),
    body: `${reason.text}${pr ? ` PR ${pr}.` : ''}${since ? ` Since ${since}.` : ''}${reason.agent ? ' An agent was given the fix.' : ''}`.slice(0, 600),
  };
}

/** The job a code conflict or red CI hands to a free agent (agent-job.mjs; the all-rounder router picks who). */
export function agentJobFor(b, reason) {
  if (!reason?.agent) return null;
  const checks = reason.kind === 'ci' ? `the failing CI checks: ${(reason.checks || []).join(', ') || 'see the PR'}` : "the build's own tests + node framework/cli/tracker.mjs --check";
  return { type: 'land-build', input: { branch: b.branch, build: b.id, checks } };
}

/**
 * The P0 fix build for a build that clashes with main in code or whose tests fail (Brett, Nov 13 2026: it keeps trying
 * until it lands; Brett gets an FYI per attempt, never a question). Filed through the orchestrator's
 * axf.build-dispatch@1 (POST /land/fix on this plugin's server), priority P0, straight into the Queue. The fix works on
 * the build's own branch, so its PR and its place in the merge queue stay.
 */
export const FIX_RETRY_MS = 90 * 60 * 1000;
export const FIX_RETRY_MAX_MS = 6 * 3600 * 1000;

/** Is a new fix attempt due? No attempt yet; the head moved and it still fails; or the last one went quiet too long. */
export function fixDue(prev, reason, head, nowMs = Date.now()) {
  if (!reason?.agent) return false;
  if (!prev || !prev.attempt) return true;
  if (head && prev.head && prev.head !== head) return true;
  const wait = Math.min(FIX_RETRY_MAX_MS, FIX_RETRY_MS * prev.attempt);
  return nowMs - Date.parse(prev.at || 0) >= wait;
}

/** The fix build's title and brief (plain words, the exact files or checks, where to push). */
export function fixBuildFor(b, reason, { attempt = 1, pr = null } = {}) {
  const what = reason.kind === 'conflict' ? `merging main into it clashes in code: ${(reason.files || []).slice(0, 12).join(', ') || 'see the merge'}`
    : `its tests fail: ${(reason.checks || []).slice(0, 8).join(', ') || 'see the PR checks'}`;
  const title = `Merge main and land ${b.id}${attempt > 1 ? ` (attempt ${attempt})` : ''}`.slice(0, 200);
  const detail = [
    `Auto-land could not land \`${b.id}\` (${str(b.title, 200) || b.id}): ${what}.`,
    '',
    `Work on its own branch \`${b.branch}\`${pr ? ` (PR #${pr})` : ''}; do not open a new PR.`,
    `1. git fetch origin && git checkout ${b.branch} && git merge origin/main`,
    '2. Resolve every conflict keeping both sides\' intent (builds files: newer wins; THREADS / STATUS / decisions: keep both).',
    `3. Make ${reason.kind === 'ci' ? 'the failing checks' : 'the tests the clash touches'} pass, plus node framework/cli/tracker.mjs --check.`,
    `4. Commit and push to ${b.branch}. Auto-land and the merge queue land it by themselves.`,
    '',
    `Attempt ${attempt}. Auto-land retries until it lands; Brett gets an FYI for each attempt.`,
  ].join('\n');
  return { title, detail, priority: 'P0', build: b.id, branch: b.branch, kind: reason.kind, attempt };
}

/** The FYI Brett gets for each fix attempt: information, not a question. */
export function fixFyi(b, reason, { attempt = 1, fixId = '', pr = null } = {}) {
  return {
    source: 'push-banner', key: `land-fix:${b.id}`, severity: 'info',
    title: `FYI: ${b.id} ${reason.kind === 'conflict' ? 'clashes with main' : 'fails its tests'}; fix build ${attempt > 1 ? `attempt ${attempt} ` : ''}queued (P0)`.slice(0, 200),
    body: `${reason.text}${pr ? ` PR #${pr}.` : ''} ${fixId ? `Fix build ${fixId} is in the Queue at P0.` : 'A P0 fix build is in the Queue.'} Nothing to do: it lands by itself.`.slice(0, 600),
  };
}

/**
 * The sweeper (Brett, Nov 13 2026): every SWEEP_MS, any finished build that is still not on main is landed or gets
 * its fix build. Kicked out of the merge queue (a clash with main, or it broke CI on top of main) → a fix build;
 * stuck on something plain scripts can retry (push, PR, a failed round) → first in line again.
 */
export const SWEEP_MS = 10 * 60 * 1000;
/** Stuck: blocked or waiting this long (the banner shows it, the sweeper acts on it). */
export const STUCK_MS = 30 * 60 * 1000;

/** A kicked-out queue entry → the landing reason it stands for (conflict / ci), or null. */
export function kickReason(id, why) {
  const w = str(why, 600);
  if (!/^kicked out/i.test(w)) return null;
  const files = (w.match(/conflicts with main in code \(([^)]*)\)/) || [])[1];
  if (files) return blockReason(id, { conflicts: files.split(/,\s*/).filter(Boolean) });
  const checks = (w.match(/failed: ([^)]*)\)/) || [])[1];
  return blockReason(id, { ci: 'failure', failing: checks ? checks.split(/,\s*/).filter(Boolean) : [] });
}

/**
 * A clash the sweeper settles itself before filing a fix build: every clashing file is data or generated
 * (generated-files@1: builds, union, union-json, generated), none is code. Main is merged in again by land.mjs
 * mergeMain, whose resolveConflicts regenerates the generated files. Only once per head (`tried` is that head).
 */
export function regenFirst(reason, head = '', tried = '') {
  if (reason?.kind !== 'conflict' || !reason.files?.length) return false;
  if (head && tried === head) return false;
  return planConflicts(reason.files).code.length === 0;
}

/** What the sweeper does for each finished, unlanded build: fix | retry | none. */
export function sweepPlan(items = [], waiting = [], nowMs = Date.now()) {
  const kicked = new Map(); for (const w of waiting || []) if (w?.build && /^kicked out/i.test(w.why || '')) kicked.set(w.build, w);
  const out = [];
  for (const it of items || []) {
    const k = kicked.get(it.id);
    const kr = k ? kickReason(it.id, k.why) : null;
    if (kr) { out.push({ id: it.id, act: 'fix', reason: kr, head: k.head || it.head || '', pr: k.pr || it.pr || null }); continue; }
    if (it.reason?.agent) { out.push({ id: it.id, act: 'fix', reason: it.reason, head: it.head || '', pr: it.pr || null }); continue; }
    const stuck = nowMs - (Date.parse(it.since || 0) || nowMs) >= STUCK_MS;
    if (stuck && ['push', 'pr', 'error'].includes(it.reason?.kind)) out.push({ id: it.id, act: 'retry' });
  }
  return out;
}

/** Items stuck for over STUCK_MS (anything but a quiet wait on CI that is running): for the banner. */
export function stuckItems(items = [], nowMs = Date.now()) {
  return (items || []).filter((x) => x && x.state !== 'ready' && x.state !== 'off' && x.reason && nowMs - (Date.parse(x.since || 0) || nowMs) >= STUCK_MS)
    .map((x) => ({ id: x.id, pr: x.pr || null, kind: x.reason.kind, text: x.reason.text, since: x.since, fix: x.fix?.id || '' }));
}

/** The commands, declared once: the CLI, the push banner's REST routes and (through plugin-commands@1) MCP. */
export const LAND_COMMANDS = Object.freeze([
  { id: 'land-list', method: 'GET', path: '/land', cli: 'list', title: 'Auto-land: every finished build', description: 'Every finished build the pipeline lands, in landing order, with its PR, state and what it waits on.', effect: 'read' },
  { id: 'land-blocked', method: 'GET', path: '/land/blocked', cli: 'blocked', title: 'Auto-land: blocked builds', description: 'Finished builds that are not landing, each with the reason in plain words (UI waiting, CI red, conflict, dependency).', effect: 'read' },
  { id: 'land-now', method: 'POST', path: '/land/now', cli: 'now', title: 'Auto-land: land a build now', description: 'Land one finished build at the next round (within 3 minutes), ahead of the rest; a hold on it is released.', effect: 'write', input: { build: 'build id' } },
  { id: 'land-hold', method: 'POST', path: '/land/hold', cli: 'hold', title: 'Auto-land: hold a build', description: 'Keep a finished build from landing until it is released.', effect: 'write', input: { build: 'build id', why: 'optional reason' } },
  { id: 'land-release', method: 'POST', path: '/land/release', cli: 'release', title: 'Auto-land: release a held build', description: 'Let a held build land again.', effect: 'write', input: { build: 'build id' } },
  { id: 'land-off', method: 'POST', path: '/land/off', cli: 'off', title: 'Auto-land: switch one build off', description: 'The per-build switch: this build is not landed by itself (auto-land stays on for every other build).', effect: 'write', input: { build: 'build id', why: 'optional reason' } },
  { id: 'land-on', method: 'POST', path: '/land/on', cli: 'on', title: 'Auto-land: switch one build back on', description: 'The per-build switch: this build lands by itself again (the default).', effect: 'write', input: { build: 'build id' } },
  { id: 'land-line', method: 'GET', path: '/land/line', cli: 'line', title: 'Auto-land: the landing line', description: 'The serial landing line: builds waiting to land in order, what is stuck for over 30 minutes and why, each fix build filed, the last sweep.', effect: 'read' },
  { id: 'land-sweep', method: 'POST', path: '/land/sweep', cli: 'sweep', title: 'Auto-land: sweep now', description: 'Run the sweeper at the next round: every finished build not on main is landed or gets its P0 fix build.', effect: 'write' },
  { id: 'land-status', method: 'GET', path: '/land/status', cli: 'status', title: 'Auto-land: sweeper status', description: 'The sweeper: paused or running, when it last swept and what it did (landed, regenerated, fix build filed), what is stuck over 30 minutes.', effect: 'read' },
  { id: 'land-pause', method: 'POST', path: '/land/pause', cli: 'pause', title: 'Auto-land: pause the sweeper', description: 'Stop the 10-minute sweeper acting (rounds still land finished builds; the merge queue still merges).', effect: 'write', input: { why: 'optional reason' } },
  { id: 'land-resume', method: 'POST', path: '/land/resume', cli: 'resume', title: 'Auto-land: resume the sweeper', description: 'Let the 10-minute sweeper act again (the default).', effect: 'write' },
]);

/** Apply one control command to the control document (holds, now, after). Returns the new document. */
export function applyControl(doc, cmd, build, { why = '', at = new Date().toISOString(), after = '' } = {}) {
  const d = { $axf: CONTROL_FRAME, holds: {}, now: [], after: {}, off: {}, ...(doc && typeof doc === 'object' ? doc : {}) };
  d.holds = { ...(d.holds || {}) }; d.now = [...(d.now || [])]; d.after = { ...(d.after || {}) }; d.off = { ...(d.off || {}) };
  // the sweeper's own switch (not per build): pause keeps rounds landing but stops the 10-minute sweep acting
  if (cmd === 'pause') { d.sweepPaused = { why: str(why, 200) || 'sweeper paused by hand', at }; d.updatedAt = at; return d; }
  if (cmd === 'resume') { delete d.sweepPaused; d.updatedAt = at; return d; }
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(build || '')) throw new Error('send a build id');
  if (cmd === 'hold') d.holds[build] = { why: str(why, 200) || 'held by hand', at };
  else if (cmd === 'release') delete d.holds[build];
  else if (cmd === 'now') { delete d.holds[build]; d.now = [build, ...d.now.filter((x) => x !== build)].slice(0, 20); }
  else if (cmd === 'off') d.off[build] = { why: str(why, 200) || 'auto-land switched off for this build', at };
  else if (cmd === 'on') delete d.off[build];
  else if (cmd === 'after') { if (!after) throw new Error('after <build> <other>'); d.after[build] = [...new Set([...(d.after[build] || []), after])]; }
  else throw new Error(`unknown command ${cmd}`);
  d.updatedAt = at;
  return d;
}
