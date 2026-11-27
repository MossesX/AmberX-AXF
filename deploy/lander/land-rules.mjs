/**
 * Lander merge rules (pure, no IO). Ported from the retired push banner auto-land (land-core.mjs, Nov 3 2026) when the
 * Pipeline 2.0 lander replaced it (Nov 19 2026): which files a merge resolves by itself and how, the worktree clean-up
 * plan, and the status-only test for commits on main. Only a conflict in code needs a fix; everything else resolves here.
 *
 * Imports: the generated-files manifest (generated-files@1) and the tracking paths (tracking-paths@1).
 */
import manifest from '../../framework/spec/generated-files.json' with { type: 'json' };
import { isTracking, TRACKING_PATHS } from '../../framework/core/tracking-paths.mjs';

/** Commit messages of status-only commits on main (framework/cli/builds-live.mjs, the reconciler, the store). */
export const STATUS_ONLY_MARK = '[skip ci]';
/** Paths status-only commits may touch: the builds store and its exports, journals and the threads log. */
export const STATUS_PATHS = /^_claude\//;

/** Files that are scratch in a build's worktree: never committed, never block a landing. */
const SCRATCH = [/^\.brief\.md$/, /^[^/]+\.log$/, /^[^/]+\.jsonl$/, /^\.axf-[^/]*$/, /^\.claude-sync-hold$/, /(^|\/)node_modules(\/|$)/, /^\.shots-harness\//];
/** Synced data (claude-sync, persist.mjs): changes here are committed on the build's own branch, tracking files excepted. */
const SYNCED = [/^_claude\//, /^changes\//, /^sessions\//, /^apps\/[^/]+\/_claude\//, /^framework\/plan\//, /^framework\/catalog\/status\.json$/, /^tracker\.json$/, /^project\.manifest\.json$/, /^apps\/[^/]+\/project\.manifest\.json$/];

/**
 * Builds files: merged per build and step, newer wins (builds-live.mjs merge driver). The builds-kind entries of the
 * one tracking-paths list (framework/core/tracking-paths.mjs, tracking-paths@1); a build branch never commits them.
 */
const BUILDS = TRACKING_PATHS.filter((t) => t.kind === 'builds').map((t) => t.re);
/** Every tracking file (builds store exports, journal, pending list and build queue exports). */
export const trackingPath = (p) => isTracking(p);
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

/**
 * The generators a set of resolved files needs, each once, in manifest order: a regen file's own generator, and the
 * `then` generator of a file merged by union (catalog status → tracker, so tracker.json never lags a unioned status).
 */
export function regenPlan(paths) {
  const out = new Map();
  for (const p of paths || []) {
    const g = generatorFor(p); if (g && !out.has(g.id)) out.set(g.id, g);
    const r = rule(str(p, 400).replace(/^\.\//, ''));
    const then = r?.then && GENERATORS[r.then];
    if (then && !out.has(r.then)) out.set(r.then, { id: r.then, run: [...(then.run || [])], check: then.check ? [...then.check] : null, outputs: [...(then.outputs || [])], timeoutMs: then.timeoutMs || 120000, optional: then.optional === true });
  }
  return [...out.values()];
}

/** The quick tests the manifest asks for after generated or additive files were resolved. */
export const landTests = () => (MANIFEST.tests || []).map((t) => [...t]);

/**
 * Split a merge's conflicted files: auto-resolvable by kind, and the code ones a person (or an agent) must look at.
 * `tracking` (tracking-paths@1: store, orchestrator, origins, journal, pending and build-queue exports) always takes
 * main's copy (s6): a build branch never carries them, so main's is the live one.
 */
export function planConflicts(paths) {
  const out = { tracking: [], builds: [], union: [], unionJson: [], generated: [], code: [] };
  for (const p of paths || []) {
    if (isTracking(p)) { out.tracking.push(String(p).replace(/^\.\//, '')); continue; }
    const k = classifyPath(p); out[k === 'union-json' ? 'unionJson' : k].push(p);
  }
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
 * What to do with each line of `git status --porcelain` in a finished build's worktree. A tracking file is never
 * committed for the build (the auto-land commit of them dragged store/journal churn into build branches, PR 733).
 *   reset    a tracking file (tracking-paths@1) changed here: backed up, then put back to the branch's merge-base copy
 *            with main (main and the hub keep the live copy; the build branch never carries it)
 *   commit   other synced data the build wrote (a report, memory, catalog status): committed on its own branch
 *   skip     scratch (.brief.md, logs, jsonl, .axf-* files): left alone, never committed
 *   archive  untracked file that is a copy of a hub file (claude-sync dropped it): moved to /root/archive/<build>/
 *   restore  tracked synced file whose content is the hub's copy (a sync drop, not the build's work): backed up the
 *            same way, then put back to the branch's version (the hub keeps it; nothing is lost)
 *   code     tracked code changed but not committed: the landing waits and says so (never committed for the build)
 *   keep     untracked file that isn't a hub copy: left alone
 * `hubHas(path)` says whether the hub (/projects/<name>/_claude …) has a file at that repo path.
 */
export function strayPlan(porcelain, hubHas = () => false) {
  const plan = { commit: [], reset: [], skip: [], archive: [], restore: [], code: [], keep: [] };
  for (const raw of String(porcelain || '').split('\n')) {
    if (!raw.trim()) continue;
    const xy = raw.slice(0, 2); let p = raw.slice(3).trim();
    if (p.includes(' -> ')) p = p.split(' -> ').pop();
    p = p.replace(/^"|"$/g, '');
    if (any(SCRATCH, p)) { plan.skip.push(p); continue; }
    const untracked = xy === '??'; const deleted = xy.includes('D');
    // an untracked tracking file (a new journal part, an export the branch never had) is the hub's: left alone
    if (isTracking(p)) { (untracked ? plan.skip : plan.reset).push(p); continue; }
    if (!deleted && hubHas(p)) { (untracked ? plan.archive : plan.restore).push(p); continue; }
    if (untracked) { (any(SYNCED, p) ? plan.commit : plan.keep).push(p); continue; }
    (any(SYNCED, p) ? plan.commit : plan.code).push(p);
  }
  return plan;
}

/** Are the commits on main a branch lacks only status data (all `[skip ci]`, all files under _claude/)? */
export function statusOnly(commits, files) {
  if (!Array.isArray(commits) || !commits.length) return true;
  if (!commits.every((m) => String(m || '').includes(STATUS_ONLY_MARK))) return false;
  return Array.isArray(files) && files.every((f) => STATUS_PATHS.test(String(f || '')));
}
