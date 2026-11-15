/**
 * merge-watch@1 — the VPS watches main and sends a shipped-manifest@1 for every merge the moment it lands (pure, IO-free).
 *
 * Brett, Nov 15 2026: "Why are there no shipped features for the past 2 days. No, the VPS has to send shipped features
 * as soon as a merge to main succeeds since it now controls the orchestrator"
 *
 * Until now a manifest went out only when the orchestrator's tick saw a builds@1 record marked merged (shipLanded: store
 * status, a few per tick, three-day window). A merge the store never learned about (a build_land fast-forward, a merge
 * queue batch, a hotfix, a PR the reconciler had not matched) shipped nothing, and nothing retried. The watch turns the
 * source of truth around: main's first-parent history. Every commit on it since the last seen sha is classified,
 * grouped into landings (one per merge commit) and each landing is sent as a manifest, with retries. The merge commit
 * sha is the idempotency key: an entry that is `sent` is never sent again, whatever the store says.
 *
 *   merge-watch@1 = {
 *     $axf, version, repo, ref ('origin/main'), startedFrom (the main sha the watch began at), updatedAt
 *     lastSeen: { sha, at, checkedAt }                     the newest main commit processed (at = its commit time)
 *     entries:  { [merge commit sha]: merge-watch-entry@1 }
 *   }
 *   merge-watch-entry@1 = {
 *     sha        the landing's commit on main (the key; landedCommit of the manifest)
 *     base       main just before the landing (first parent of its oldest commit): `base..sha` is the landing's range
 *     kind       pr-merge | batch | build-land | direct
 *     at         commit time (ISO, UTC) = mergedAt = landedAt
 *     subject    the landing commit's subject line
 *     pr         PR number (0 = none), branch ('' = unknown), build (the id the branch names; '' = unknown)
 *     guess      a build id read from a "<id> sN:" subject prefix (untrusted: only used when the store knows it)
 *     commits    the landing's own commits on main's first-parent line, newest first (the merge commit included)
 *     state      pending | sent | failed | skipped;  reason: '' | status-only | revert | folded;  into: the sha a folded entry joined
 *     attempts, lastAttemptAt, nextRetryAt, error    retries: RETRY_MINUTES after each failure, MAX_ATTEMPTS then it waits for a hand
 *     manifest: { id, rev }, sentAt                   what was sent
 *     seenAt     when the watch first saw it
 *   }
 *
 * What main's first-parent line looks like (1658 commits in the three days before Nov 15 2026, 1608 of them status-only):
 *   pr-merge    "Merge pull request #654 from claude/<branch> (merge queue: …)"  two parents; PR and branch from the subject.
 *               The branch's work is on the second parent: the host reads it as `base..sha`.
 *   batch       "Merge queue batch: #552 on top of #548, #549, #550, #551"     two parents; one landing per PR.
 *   build-land  "Merge origin/main into claude/<branch> (build_land)"           two parents; main was fast-forwarded to the
 *               branch tip, so the branch's own commits sit right before it on the first-parent line and belong to the
 *               same landing (as does a second build_land merge of the same branch made seconds earlier).
 *   direct      a plain commit with no build_land merge after it (a hotfix push, "THREADS: …"). Consecutive plain commits
 *               with the same subject prefix form one landing keyed by the newest. A fresh one is held HOLD_MINUTES, so
 *               a build_land merge arriving in the next tick can claim it (`folded`).
 *   skipped     "Builds live: … [skip ci]" status commits (builds-live.mjs) and the merge queue's status folds: never
 *               shipped. "Revert "…"" commits are recorded and skipped too (the ledger has no un-ship).
 *
 * How a landing becomes a shipped-manifest@1 (toManifestOverlay + the host's shipped.mjs gather):
 *   build.id      the branch minus claude/ (trusted); else the subject prefix when the store knows it; else main-<sha9>
 *   pr            { repo, number } from the subject;  branch from the subject
 *   landedCommit  sha;  commits: the landing's commits (+ the branch's own, found by git);  mergedAt = landedAt = at
 *   files         git: names changed in `base..sha`;  areas: shipped-manifest areasOf(files)
 *   tests, open   parsed from the build report (_claude/builds/reports/<build>.md), which is also `report`
 *   said          the builds@1 record's origin (Brett's words, verbatim); without one the subjects stand in, verbatim: false
 */
import { REPOS, iso } from './shipped-manifest.mjs';

export const SCHEMA = 'merge-watch@1';
export const ENTRY = 'merge-watch-entry@1';
export const VERSION = 1;
export const KINDS = ['pr-merge', 'batch', 'build-land', 'direct'];
export const STATES = ['pending', 'sent', 'failed', 'skipped'];
export const SKIP_REASONS = ['status-only', 'revert', 'folded'];
/** Minutes to wait after the n-th failed attempt (the last one repeats). */
export const RETRY_MINUTES = [1, 5, 15, 60, 240, 1440];
export const MAX_ATTEMPTS = 8;
/** A fresh direct landing waits this long before it is sent, in case its build_land merge is still on its way. */
export const HOLD_MINUTES = 10;
export const KEEP_DAYS = 30;
export const DEFAULT_REF = 'origin/main';
export const DEFAULT_REPO = 'amberx-axf';
/** The state file, relative to the data root the resolver picks (framework/cli/merge-watch-files.mjs). */
export const STATE_REL = '_claude/builds/merge-watch/state.json';

/** Subject patterns every port reads (sources in REGISTRY.subjects). */
export const SUBJECTS = {
  prMerge: /^Merge pull request #(\d+) from (\S+)/,
  squash: /\(#(\d+)\)\s*$/,
  batch: /^Merge queue batch: #(\d+)\b/,
  buildLand: /^Merge (?:origin\/main|main|remote-tracking branch 'origin\/main') into (\S+) \(build_land\)/,
  status: /^(?:Builds live:|Merge queue: main'?s status commits)/,
  skipCi: /\[skip ci\]\s*$/,
  revert: /^Revert "/,
  buildPrefix: /^([a-z0-9][a-z0-9-]{2,60}?)(?: s\d+)?:\s/,
};

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const int0 = (v) => Math.max(0, Math.floor(num(v)));
const uniq = (a) => [...new Set(a)];
export const sha = (v) => { const s = str(v, 40).trim().toLowerCase(); return /^[0-9a-f]{7,40}$/.test(s) ? s : ''; };
export const slug = (s) => str(s, 200).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const plus = (at, minutes) => { const t = Date.parse(at); return Number.isFinite(t) ? new Date(t + minutes * 60000).toISOString().replace('.000Z', 'Z') : ''; };

/** 'claude/x', 'MossesX/claude/x', 'refs/heads/claude/x' → 'claude/x'. */
export function normBranch(v) {
  const s = str(v, 200).trim().replace(/^refs\/heads\//, '').replace(/[.,;:)]+$/, '');
  const m = /(?:^|\/)(claude\/.+)$/.exec(s);
  return m ? m[1] : s;
}
/** The build a branch names: claude/<id> → <id> (build-id@1 branches are made from the id), '' otherwise. */
export const buildOfBranch = (branch) => { const b = normBranch(branch); return b.startsWith('claude/') ? slug(b.slice(7)) : ''; };

// ------------------------------------------------------------------ classifying one commit on main's first-parent line

/**
 * What one first-parent commit is: { kind, pr, branch, build, guess, skip, merge }. `skip` names why it never ships
 * ('' when it does); `kind: 'direct'` with no skip is a plain commit that joins a run (see landingsOf).
 */
export function classifyCommit(c) {
  const o = isObj(c) ? c : {};
  const s = str(o.subject ?? o.message, 500).split('\n')[0].trim();
  const merge = list(o.parents).filter(Boolean).length > 1;
  const base = { kind: 'direct', pr: 0, branch: '', build: '', guess: '', skip: '', merge };
  if (SUBJECTS.status.test(s) || (SUBJECTS.skipCi.test(s) && /^Builds\b/.test(s))) return { ...base, skip: 'status-only' };
  if (SUBJECTS.revert.test(s)) return { ...base, skip: 'revert' };
  let m = SUBJECTS.prMerge.exec(s);
  if (m) { const branch = normBranch(m[2]); return { ...base, kind: 'pr-merge', pr: Number(m[1]), branch, build: buildOfBranch(branch) }; }
  m = SUBJECTS.batch.exec(s);
  if (m) return { ...base, kind: 'batch', pr: Number(m[1]) };
  m = SUBJECTS.buildLand.exec(s);
  if (m) { const branch = normBranch(m[1]); return { ...base, kind: 'build-land', branch, build: buildOfBranch(branch) }; }
  m = !merge && SUBJECTS.squash.exec(s);
  if (m) return { ...base, kind: 'pr-merge', pr: Number(m[1]) };
  const g = SUBJECTS.buildPrefix.exec(s);
  return { ...base, guess: g ? g[1] : '' };
}

// ------------------------------------------------------------------ record shapes

/** merge-watch-entry@1 in shape, or null without a sha. */
export function normEntry(v, { now = '' } = {}) {
  if (!isObj(v)) return null;
  const id = sha(v.sha); if (!id) return null;
  const state = STATES.includes(v.state) ? v.state : 'pending';
  const commits = uniq([id, ...list(v.commits).map(sha)].filter(Boolean));
  const branch = normBranch(v.branch);
  return {
    $axf: ENTRY, sha: id, base: sha(v.base), kind: KINDS.includes(v.kind) ? v.kind : 'direct', at: iso(v.at), subject: str(v.subject, 300),
    pr: Number.isInteger(Number(v.pr)) && Number(v.pr) > 0 ? Number(v.pr) : 0, branch, build: slug(v.build) || buildOfBranch(branch), guess: slug(v.guess), commits,
    state, reason: state === 'skipped' && SKIP_REASONS.includes(v.reason) ? v.reason : '', into: state === 'skipped' ? sha(v.into) : '',
    attempts: int0(v.attempts), lastAttemptAt: iso(v.lastAttemptAt), nextRetryAt: iso(v.nextRetryAt), error: str(v.error, 500),
    manifest: isObj(v.manifest) && str(v.manifest.id, 120) ? { id: str(v.manifest.id, 120), rev: Math.max(1, int0(v.manifest.rev) || 1) } : null, sentAt: iso(v.sentAt),
    seenAt: iso(v.seenAt) || iso(now),
  };
}
const byTime = (a, b) => a.at.localeCompare(b.at) || a.sha.localeCompare(b.sha);
/** merge-watch@1 in shape (entries keyed by sha, oldest first), or null when it is not one. */
export function normState(v, { now = '' } = {}) {
  if (!isObj(v)) return null;
  if (v.$axf !== undefined && v.$axf !== SCHEMA) return null;
  const ls = isObj(v.lastSeen) ? v.lastSeen : {};
  const raw = isObj(v.entries) ? Object.values(v.entries) : list(v.entries);
  const entries = {};
  for (const e of raw.map((x) => normEntry(x, { now })).filter(Boolean).sort(byTime)) entries[e.sha] = e;
  return {
    $axf: SCHEMA, version: VERSION, repo: REPOS.includes(v.repo) ? v.repo : DEFAULT_REPO, ref: str(v.ref, 120) || DEFAULT_REF, startedFrom: sha(v.startedFrom),
    lastSeen: { sha: sha(ls.sha), at: iso(ls.at), checkedAt: iso(ls.checkedAt) }, updatedAt: iso(v.updatedAt) || iso(now), entries,
  };
}
/** A new state that starts watching at `from` (the current main tip: nothing before it is shipped by the watch; backfill covers that). */
export const startState = ({ repo = DEFAULT_REPO, ref = DEFAULT_REF, from = {}, now = '' } = {}) => normState({ repo, ref, startedFrom: from.sha, lastSeen: { sha: from.sha, at: from.at, checkedAt: now }, updatedAt: now, entries: {} }, { now });

const need = (errors, cond, field, message) => { if (!cond) errors.push({ field, message }); };
/** Field-named problems with a state record (as given). */
export function validateState(v) {
  const errors = []; const o = isObj(v) ? v : {};
  need(errors, o.$axf === undefined || o.$axf === SCHEMA, '$axf', `$axf must be ${SCHEMA}`);
  need(errors, o.lastSeen === undefined || (isObj(o.lastSeen) && (o.lastSeen.sha === undefined || o.lastSeen.sha === '' || sha(o.lastSeen.sha))), 'lastSeen.sha', 'lastSeen.sha must be a git sha');
  need(errors, o.ref === undefined || typeof o.ref === 'string', 'ref', 'ref is the git ref watched (origin/main)');
  const entries = isObj(o.entries) ? Object.entries(o.entries) : o.entries === undefined ? [] : null;
  need(errors, entries !== null, 'entries', 'entries must be an object keyed by merge commit sha');
  for (const [k, e] of entries || []) {
    const f = `entries.${k.slice(0, 9)}`;
    need(errors, isObj(e) && sha(e.sha) && (sha(k) === sha(e.sha)), f, 'an entry is keyed by its own sha');
    if (!isObj(e)) continue;
    need(errors, e.kind === undefined || KINDS.includes(e.kind), `${f}.kind`, `kind must be one of ${KINDS.join(', ')}`);
    need(errors, e.state === undefined || STATES.includes(e.state), `${f}.state`, `state must be one of ${STATES.join(', ')}`);
    need(errors, e.state !== 'skipped' || SKIP_REASONS.includes(e.reason), `${f}.reason`, `a skipped entry says why: ${SKIP_REASONS.join(', ')}`);
    need(errors, e.state !== 'sent' || (isObj(e.manifest) && str(e.manifest.id)), `${f}.manifest`, 'a sent entry names the manifest it sent');
    need(errors, e.attempts === undefined || (Number.isInteger(e.attempts) && e.attempts >= 0), `${f}.attempts`, 'attempts is a count');
    for (const t of ['at', 'nextRetryAt', 'lastAttemptAt', 'sentAt', 'seenAt']) need(errors, e[t] === undefined || e[t] === '' || iso(e[t]), `${f}.${t}`, `${t} is not an ISO time`);
  }
  return { ok: !errors.length, errors };
}
export const rejection = (errors) => errors.map((e) => `${e.field}: ${e.message}`).join('; ');

// ------------------------------------------------------------------ landings: first-parent commits → entries

const mkEntry = (c, cls, extra, now) => normEntry({ sha: c.sha, base: list(c.parents)[0], kind: cls.kind, at: c.at, subject: str(c.subject ?? c.message, 500).split('\n')[0], pr: cls.pr, branch: cls.branch, build: cls.build, guess: cls.guess, seenAt: now, ...extra }, { now });
const fresh = (at, now) => { const a = Date.parse(at); const n = Date.parse(now); return Number.isFinite(a) && Number.isFinite(n) && n - a < HOLD_MINUTES * 60000; };

/**
 * Commits on main's first-parent line ({ sha, parents, subject, at }, newest first as `git rev-list --first-parent`
 * prints them) → entries, oldest first: one per landing, plus a skipped entry per status / revert commit. A run of
 * plain commits folds into the build_land merge that follows it; a trailing run becomes direct landings (one per
 * subject-prefix group, keyed by the newest commit), held HOLD_MINUTES when fresh.
 */
export function landingsOf(commits, { now = '', oldestFirst = false } = {}) {
  const cs = list(commits).filter((c) => isObj(c) && sha(c.sha)); if (!oldestFirst) cs.reverse();
  const out = []; let run = [];
  const flush = () => {
    const groups = []; let g = null;
    for (const c of run) { if (!g || g.guess !== c.cls.guess) { g = { guess: c.cls.guess, cs: [] }; groups.push(g); } g.cs.push(c); }
    for (const grp of groups) {
      const newest = grp.cs[grp.cs.length - 1];
      out.push(mkEntry(newest, newest.cls, { base: list(grp.cs[0].parents)[0], commits: grp.cs.map((c) => c.sha).reverse(), nextRetryAt: fresh(newest.at, now) ? plus(now, HOLD_MINUTES) : '' }, now));
    }
    run = [];
  };
  for (const c of cs) {
    const cls = classifyCommit(c);
    if (cls.skip) { out.push(mkEntry(c, { ...cls, kind: 'direct' }, { state: 'skipped', reason: cls.skip, commits: [c.sha] }, now)); continue; }
    if (cls.kind === 'direct') { run.push({ ...c, cls }); continue; }
    let base = run.length ? list(run[0].parents)[0] : list(c.parents)[0];
    let own = [c.sha, ...run.map((x) => x.sha).reverse()];
    if (cls.kind === 'build-land') {
      // the same branch merged main twice in one landing: the earlier merge and its commits join this one
      const prev = out[out.length - 1];
      if (prev && prev.kind === 'build-land' && prev.state === 'pending' && prev.branch === cls.branch) { out.pop(); own = [...own, ...prev.commits]; base = prev.base; }
    } else if (run.length) { flush(); base = list(c.parents)[0]; own = [c.sha]; }
    run = [];
    out.push(mkEntry(c, cls, { base, commits: own }, now));
  }
  if (run.length) flush();
  return out;
}

/**
 * Take the commits newer than lastSeen into the state (idempotent: a sha already there is left as it is, sent stays
 * sent). A build_land landing claims the held direct entries right below it (`folded`). lastSeen moves to the newest
 * commit. Returns { state, added: [entries], folded: [sha] }.
 */
export function advance(state, commits, { now = '' } = {}) {
  const s = normState(state, { now }) || startState({ now });
  const entries = { ...s.entries }; const added = []; const folded = [];
  const cs = list(commits).filter((c) => isObj(c) && sha(c.sha));
  for (const e of landingsOf(cs, { now })) {
    if (entries[e.sha]) continue;
    if (e.kind === 'build-land') {
      // the plain commits of this branch seen in an earlier tick sit right below the landing's base, still on hold
      for (let held = entries[e.base]; held && held.kind === 'direct' && held.state === 'pending' && held.attempts === 0; held = entries[e.base]) {
        e.commits = uniq([...e.commits, ...held.commits]); e.base = held.base;
        entries[held.sha] = { ...held, state: 'skipped', reason: 'folded', into: e.sha, nextRetryAt: '' }; folded.push(held.sha);
      }
    }
    entries[e.sha] = e; added.push(e);
  }
  const newest = cs.length ? (Date.parse(cs[0].at || '') >= Date.parse(cs[cs.length - 1].at || '') ? cs[0] : cs[cs.length - 1]) : null;
  const lastSeen = newest ? { sha: sha(newest.sha), at: iso(newest.at), checkedAt: iso(now) } : { ...s.lastSeen, checkedAt: iso(now) || s.lastSeen.checkedAt };
  return { state: normState({ ...s, lastSeen, updatedAt: now, entries }, { now }), added, folded };
}

// ------------------------------------------------------------------ sending: due, sent, failed, prune

/** Entries to send now, oldest first: pending ones whose hold is over, failed ones whose retry time has come. */
export function due(state, now) {
  const s = normState(state); if (!s) return [];
  const t = iso(now);
  return Object.values(s.entries).filter((e) => (e.state === 'pending' || (e.state === 'failed' && e.nextRetryAt)) && (!e.nextRetryAt || e.nextRetryAt <= t)).sort(byTime);
}
const retryAt = (attempts, now) => (attempts >= MAX_ATTEMPTS ? '' : plus(now, RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length) - 1]));
const update = (state, id, fn, now) => {
  const s = normState(state, { now }); const k = sha(id);
  if (!s || !s.entries[k]) return s;
  return normState({ ...s, updatedAt: now, entries: { ...s.entries, [k]: fn(s.entries[k]) } }, { now });
};
/** The manifest went out: the sha is settled for good. */
export const markSent = (state, id, manifest, now) => update(state, id, (e) => ({ ...e, state: 'sent', attempts: e.attempts + 1, lastAttemptAt: now, nextRetryAt: '', error: '', manifest: { id: manifest?.id, rev: manifest?.rev }, sentAt: now }), now);
/** The send failed: back off (RETRY_MINUTES), and after MAX_ATTEMPTS stop retrying (nextRetryAt '') until a hand resets it. */
export const markFailed = (state, id, error, now) => update(state, id, (e) => { const attempts = e.attempts + 1; return { ...e, state: 'failed', attempts, lastAttemptAt: now, nextRetryAt: retryAt(attempts, now), error: str(error, 500) }; }, now);
/** Put a failed (or skipped) entry back in line, attempts reset. */
export const reset = (state, id, now) => update(state, id, (e) => ({ ...e, state: 'pending', reason: '', into: '', attempts: 0, nextRetryAt: '', error: '' }), now);
/** Drop settled entries (sent / skipped) older than keepDays; pending and failed ones are never dropped. */
export function prune(state, { now = '', keepDays = KEEP_DAYS } = {}) {
  const s = normState(state, { now }); if (!s) return s;
  const cut = plus(now, -keepDays * 1440); if (!cut) return s;
  const entries = Object.fromEntries(Object.entries(s.entries).filter(([, e]) => !(['sent', 'skipped'].includes(e.state) && e.at && e.at < cut)));
  return normState({ ...s, entries }, { now });
}

// ------------------------------------------------------------------ to a shipped-manifest@1

const knows = (known, id) => !!id && !!known && (typeof known.has === 'function' ? known.has(id) : !!known[id]);
/**
 * The build id a landing ships under: the branch's (trusted); the store's build for the PR number (`byPr`: { [pr]: id },
 * batches and squash merges name only the PR); the subject prefix when the store knows it; else main-<sha9>.
 */
export const buildIdOf = (e, known = null, byPr = null) => e.build || (e.pr && byPr ? slug(typeof byPr.get === 'function' ? byPr.get(e.pr) : byPr[e.pr]) : '') || (e.guess && (!known || knows(known, e.guess)) ? e.guess : '') || `main-${e.sha.slice(0, 9)}`;
/**
 * The partial shipped-manifest@1 the host hands shipped.mjs `ship(id, { manifest })` for a landing: what git already
 * knows (landed commit, commits, PR, branch, times). Never `said`: Brett's words come from the builds@1 record, and only
 * a build the store never had falls back to fallbackSaid.
 */
export function toManifestOverlay(e, { repo = DEFAULT_REPO, known = null, byPr = null } = {}) {
  const n = normEntry(e); if (!n) return null;
  const r = REPOS.includes(repo) ? repo : DEFAULT_REPO;
  const id = buildIdOf(n, known, byPr);
  return {
    build: { id, title: id.startsWith('main-') ? n.subject : '', repo: r },
    ...(n.branch ? { branch: n.branch } : {}), ...(n.pr ? { pr: { repo: r, number: n.pr } } : {}),
    landedCommit: n.sha, commits: n.commits, mergedAt: n.at, landedAt: n.at, source: 'orchestrator',
  };
}
/** Brett's words when the store has none for a landing: the commit subjects, marked not verbatim. */
export const fallbackSaid = (e, subjects = []) => { const n = normEntry(e); return n ? { text: uniq([n.subject, ...list(subjects).map((s) => str(s, 300))].filter(Boolean)).join('\n').slice(0, 4000), verbatim: false, source: 'git', at: n.at } : null; };

/** Counts and the open items, for the console, the CLI, voice and a systems check banner. */
export function summaryOf(state, now = '') {
  const s = normState(state); if (!s) return null;
  const es = Object.values(s.entries);
  const count = (st) => es.filter((e) => e.state === st).length;
  const pending = es.filter((e) => e.state === 'pending').sort(byTime); const failed = es.filter((e) => e.state === 'failed').sort(byTime);
  return {
    repo: s.repo, ref: s.ref, lastSeen: s.lastSeen, startedFrom: s.startedFrom, total: es.length,
    counts: { pending: count('pending'), sent: count('sent'), failed: count('failed'), skipped: count('skipped') }, due: now ? due(s, now).length : pending.length,
    oldestPending: pending[0] ? { sha: pending[0].sha, at: pending[0].at, build: buildIdOf(pending[0]) } : null,
    failed: failed.map((e) => ({ sha: e.sha, build: buildIdOf(e), attempts: e.attempts, nextRetryAt: e.nextRetryAt, gaveUp: !e.nextRetryAt, error: e.error })),
    lastSent: es.filter((e) => e.state === 'sent').sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0]?.sentAt || '',
  };
}

// ------------------------------------------------------------------ registry + JSON Schema

export const REGISTRY = Object.freeze({
  schema: SCHEMA, entry: ENTRY, version: VERSION, kinds: KINDS, states: STATES, skipReasons: SKIP_REASONS, retryMinutes: RETRY_MINUTES, maxAttempts: MAX_ATTEMPTS, holdMinutes: HOLD_MINUTES, keepDays: KEEP_DAYS,
  ref: DEFAULT_REF, repo: DEFAULT_REPO, stateFile: STATE_REL, idempotencyKey: 'sha (the merge commit on main)',
  subjects: Object.fromEntries(Object.entries(SUBJECTS).map(([k, re]) => [k, re.source])),
  dataDir: ['AXF_MERGE_WATCH_DIR', 'AXF_BUILDS_STORE sibling (<store>.merge-watch/)', 'AXF_DATA_DIR/<stateFile>', 'hub /projects/<project>/_data/<stateFile>', 'repo/<stateFile>'],
});
export function jsonSchemas() {
  const s = { type: 'string' }; const shaT = { type: 'string', pattern: '^[0-9a-f]{7,40}$' }; const int0T = { type: 'integer', minimum: 0 };
  const entry = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/merge-watch-entry.schema.json',
    title: 'merge-watch-entry@1: one landing on main and whether its shipped manifest went out', type: 'object', additionalProperties: false, required: ['sha'],
    properties: {
      $axf: { const: ENTRY }, sha: shaT, base: { type: 'string' }, kind: { enum: KINDS }, at: s, subject: s, pr: int0T, branch: s, build: s, guess: s, commits: { type: 'array', items: shaT },
      state: { enum: STATES }, reason: { enum: ['', ...SKIP_REASONS] }, into: { type: 'string' }, attempts: int0T, lastAttemptAt: s, nextRetryAt: s, error: s,
      manifest: { type: ['object', 'null'], additionalProperties: false, properties: { id: s, rev: { type: 'integer', minimum: 1 } } }, sentAt: s, seenAt: s,
    },
  };
  return {
    'merge-watch.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/merge-watch.schema.json',
      title: 'merge-watch@1: the VPS watches main and sends a shipped manifest for every merge', type: 'object', additionalProperties: false, required: ['lastSeen', 'entries'],
      properties: {
        $axf: { const: SCHEMA }, version: { const: VERSION }, repo: { enum: REPOS }, ref: s, startedFrom: { type: 'string' }, updatedAt: s,
        lastSeen: { type: 'object', additionalProperties: false, properties: { sha: { type: 'string' }, at: s, checkedAt: s } },
        entries: { type: 'object', additionalProperties: { $ref: 'https://amberx.ai/axf/schemas/merge-watch-entry.schema.json' } },
      },
    },
    'merge-watch-entry.schema.json': entry,
  };
}
