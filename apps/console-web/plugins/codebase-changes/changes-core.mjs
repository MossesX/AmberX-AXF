/**
 * change-log@1 — the record format and the folder store, shared by the CLI (changes.mjs), its Claude Code hook and the
 * tests. The console's server part has the same rules in Python (server/store.py); test.py checks both agree.
 *
 * One entry per request Claude was asked to build, edit, remove or fix something:
 *   { $axf: 'change-log@1', id, createdAt, updatedAt, kind, title, asked, repos[], model, who {session, where, user, host},
 *     state, steps[{text, state, startedAt, finishedAt, note}],
 *     result {state, summary, branch, commits[{sha, message}], filesChanged, tests {name: {before, after, state}}, links {name: url|path}} | null,
 *     closed {at, by} | null }
 * Times are ISO strings. `state` is derived: the result's state, else 'running'. `closed` = dismissed from the banner
 * (everywhere: it's stored in the entry). Schema for editors: schema/change-log.schema.json.
 *
 * Storage: one file per entry, <changes dir>/<YYYY>/<MM>/<id>.json (the date comes from the id), rewritten only to update
 * that entry. No shared index file: the console builds its index from the files (a file per entry syncs cleanly with
 * the hub; one appended index would conflict whenever two copies were written).
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync, constants as C } from 'node:fs';
import { dirname, join } from 'node:path';

export const FORMAT = 'change-log@1';
/** Kinds are an open set; these have labels and icons in the console. */
export const KINDS = ['build', 'edit', 'remove', 'fix', 'other'];
export const STEP_STATES = ['queued', 'running', 'done', 'failed', 'skipped'];
export const RESULT_STATES = ['done', 'failed', 'partial', 'cancelled'];
export const ID_RE = /^chg-(\d{8})-[0-9a-f]{6,16}$/;
export const LIMITS = { title: 160, asked: 4000, model: 40, repos: 10, repo: 100, steps: 100, stepText: 300, note: 1000, summary: 4000, commits: 50, commitMsg: 200, tests: 50, testName: 120, testValue: 60, links: 20, link: 500, branch: 120, who: 80, areas: 40, doing: 160, bytes: 64 * 1024 };

const SECRET = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,}|(?:token|secret|password|passwd|api[_-]?key|key)\s*[=:]\s*\S{6,})/gi;
/** Hide anything that looks like a token or password, drop control characters, cut to `limit` (same rule as activity@1). */
export function redact(s, limit = 400, keepNewlines = false) {
  let t = String(s ?? '').replace(SECRET, '[hidden]');
  t = keepNewlines ? t.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ') : t.replace(/[\u0000-\u001f\u007f]/g, ' ');
  t = t.trim();
  return t.length > limit ? `${t.slice(0, limit - 1)}…` : t;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const REPO_RE = /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,120}$/;
const KIND_RE = /^[a-z][a-z0-9-]{0,23}$/;
const LINK_NAME_RE = /^[a-z][a-z0-9-]{0,23}$/;

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();

/** A new id: chg-<YYYYMMDD>-<10 hex>. With `seed` (e.g. session id + prompt) the same seed gives the same id that day. */
export function newId(seed, ms = Date.now()) {
  const day = nowIso(ms).slice(0, 10).replace(/-/g, '');
  const hex = seed != null ? createHash('sha256').update(String(seed)).digest('hex').slice(0, 10) : randomBytes(5).toString('hex');
  return `chg-${day}-${hex}`;
}
export function relPath(id) {
  const m = ID_RE.exec(String(id ?? ''));
  if (!m) throw new Error(`"${id}" is not a change id (chg-YYYYMMDD-hex)`);
  return join(m[1].slice(0, 4), m[1].slice(4, 6), `${id}.json`);
}

function link(v) {
  const s = String(v ?? '').trim();
  if (!s || s.length > LIMITS.link) return null;
  if (/^https:\/\//i.test(s)) { try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; } }
  // a repo path (e.g. a report in _claude/memory/docs/): relative, no '..', no scheme
  if (/^[A-Za-z0-9_.][A-Za-z0-9_./ -]*$/.test(s) && !s.split('/').includes('..') && !s.includes('//')) return s;
  return null;
}
const isoOr = (v, d) => (typeof v === 'string' && ISO.test(v) ? v : d);
const numIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/**
 * Check + normalise an entry. Returns { entry, errors }: errors are hard problems (bad id, wrong type, too big); values
 * that are only too long are cut and secret-looking text hidden. `state` is recomputed.
 */
export function normalize(raw, { now = nowIso() } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { entry: null, errors: ['an entry is a JSON object'] };
  const e = { $axf: FORMAT };
  if (!ID_RE.test(String(raw.id ?? ''))) errors.push('id must look like chg-YYYYMMDD-hex');
  e.id = String(raw.id ?? '');
  e.createdAt = isoOr(raw.createdAt, now);
  e.updatedAt = isoOr(raw.updatedAt, e.createdAt);
  const kind = String(raw.kind ?? 'other').toLowerCase();
  if (!KIND_RE.test(kind)) errors.push('kind is a short lowercase word (build, edit, remove, fix, other, …)');
  e.kind = kind;
  e.title = redact(raw.title, LIMITS.title);
  if (!e.title) errors.push('title is required');
  e.asked = redact(raw.asked, LIMITS.asked, true);
  const repos = raw.repos == null ? [] : Array.isArray(raw.repos) ? raw.repos : [raw.repos];
  if (repos.length > LIMITS.repos) errors.push(`at most ${LIMITS.repos} repos`);
  e.repos = [...new Set(repos.map(String).filter((r) => { const ok = REPO_RE.test(r); if (!ok) errors.push(`repo "${redact(r, 60)}" is not owner/name`); return ok; }))].slice(0, LIMITS.repos);
  e.model = redact(raw.model, LIMITS.model);
  const who = raw.who && typeof raw.who === 'object' && !Array.isArray(raw.who) ? raw.who : {};
  e.who = {};
  for (const k of ['session', 'where', 'user', 'host']) if (who[k] != null && String(who[k]).trim()) e.who[k] = redact(who[k], LIMITS.who);

  const steps = raw.steps == null ? [] : raw.steps;
  if (!Array.isArray(steps)) errors.push('steps is a list');
  else if (steps.length > LIMITS.steps) errors.push(`at most ${LIMITS.steps} steps`);
  e.steps = (Array.isArray(steps) ? steps : []).slice(0, LIMITS.steps).map((s, i) => {
    const o = typeof s === 'string' ? { text: s } : s && typeof s === 'object' ? s : {};
    const st = String(o.state ?? 'queued');
    if (!STEP_STATES.includes(st)) errors.push(`step ${i + 1}: state is one of ${STEP_STATES.join(', ')}`);
    const out = { text: redact(o.text, LIMITS.stepText), state: STEP_STATES.includes(st) ? st : 'queued' };
    if (!out.text) errors.push(`step ${i + 1} needs text`);
    if (isoOr(o.startedAt)) out.startedAt = o.startedAt;
    if (isoOr(o.finishedAt)) out.finishedAt = o.finishedAt;
    if (o.note != null && String(o.note).trim()) out.note = redact(o.note, LIMITS.note, true);
    if (o.fm != null && String(o.fm).trim()) out.fm = String(o.fm).trim().slice(0, 80); // feature-matrix@1 item id
    return out;
  });

  e.result = null;
  if (raw.result != null) {
    const r = raw.result;
    if (typeof r !== 'object' || Array.isArray(r)) errors.push('result is an object');
    else {
      const rs = String(r.state ?? '');
      if (!RESULT_STATES.includes(rs)) errors.push(`result.state is one of ${RESULT_STATES.join(', ')}`);
      const out = { state: RESULT_STATES.includes(rs) ? rs : 'partial', summary: redact(r.summary, LIMITS.summary, true) };
      if (r.branch != null && String(r.branch)) { if (BRANCH_RE.test(String(r.branch)) && !String(r.branch).includes('..')) out.branch = String(r.branch); else errors.push('result.branch is not a branch name'); }
      const commits = r.commits == null ? [] : r.commits;
      if (!Array.isArray(commits)) errors.push('result.commits is a list');
      else if (commits.length > LIMITS.commits) errors.push(`at most ${LIMITS.commits} commits`);
      out.commits = (Array.isArray(commits) ? commits : []).slice(0, LIMITS.commits).map((c) => {
        const o = typeof c === 'string' ? { sha: c } : c && typeof c === 'object' ? c : {};
        const sha = String(o.sha ?? '').toLowerCase();
        if (!SHA_RE.test(sha)) { errors.push(`commit "${redact(o.sha, 50)}" is not a sha`); return null; }
        return o.message ? { sha, message: redact(o.message, LIMITS.commitMsg) } : { sha };
      }).filter(Boolean);
      if (r.filesChanged != null) { const n = numIn(r.filesChanged, 0, 1_000_000); if (n == null) errors.push('result.filesChanged is a whole number'); else out.filesChanged = n; }
      const tests = r.tests == null ? {} : r.tests;
      if (typeof tests !== 'object' || Array.isArray(tests)) errors.push('result.tests is an object (name → {before, after, state})');
      else {
        const names = Object.keys(tests);
        if (names.length > LIMITS.tests) errors.push(`at most ${LIMITS.tests} tests`);
        out.tests = {};
        for (const name of names.slice(0, LIMITS.tests)) {
          const v = tests[name];
          const o = typeof v === 'string' || typeof v === 'number' ? { after: String(v) } : v && typeof v === 'object' && !Array.isArray(v) ? v : null;
          if (!o) { errors.push(`test "${redact(name, 40)}" is a string or {before, after, state}`); continue; }
          const t = {};
          if (o.before != null) t.before = redact(o.before, LIMITS.testValue);
          if (o.after != null) t.after = redact(o.after, LIMITS.testValue);
          if (o.state != null) { if (['pass', 'fail', 'skip'].includes(o.state)) t.state = o.state; else errors.push(`test "${redact(name, 40)}": state is pass, fail or skip`); }
          const key = redact(name, LIMITS.testName);
          if (key) out.tests[key] = t;
        }
      }
      const links = r.links == null ? {} : r.links;
      if (typeof links !== 'object' || Array.isArray(links)) errors.push('result.links is an object (name → https URL or repo path)');
      else {
        const names = Object.keys(links);
        if (names.length > LIMITS.links) errors.push(`at most ${LIMITS.links} links`);
        out.links = {};
        for (const name of names.slice(0, LIMITS.links)) {
          if (!LINK_NAME_RE.test(name)) { errors.push(`link name "${redact(name, 30)}" is a short lowercase word`); continue; }
          const v = link(links[name]);
          if (!v) { errors.push(`link "${name}" must be an https URL or a repo path`); continue; }
          out.links[name] = v;
        }
      }
      e.result = out;
    }
  }

  e.closed = null;
  if (raw.closed != null) {
    const c = raw.closed;
    if (typeof c !== 'object' || Array.isArray(c)) errors.push('closed is {at, by} or null');
    else e.closed = { at: isoOr(c.at, now), by: redact(c.by ?? 'unknown', LIMITS.who) || 'unknown' };
  }
  e.state = e.result ? e.result.state : 'running';
  normBuild(raw, e, errors);
  normResume(raw, e, errors);
  if (Buffer.byteLength(JSON.stringify(e)) > LIMITS.bytes) errors.push(`an entry is at most ${LIMITS.bytes / 1024} KB`);
  return { entry: errors.length ? null : e, errors, draft: e };
}

/* ---------------- build stats (Oct 21 2026: the Build manager's live + Built views) ---------------- */

/**
 * Optional build fields, all backward compatible (an old entry gains only the derived `status`):
 *   buildRef  {kind: pending|queue|plan|other|…, id}   the build it is about (pending id, queue epic, plan feature)
 *   status    queued|running|done|failed  — derived: result done/partial → done, failed/cancelled → failed; without a
 *             result `queued` when asked for, else running
 *   surface   where it runs: vps-claude-code | claude-code | claude-ai | console-launch | subagent | backfill | … (open)
 *   startedAt, finishedAt, lastSeenAt (heartbeat while running; a running entry not seen for 10 min shows "no word")
 *   estimate  {minutes, costUsd}   actual {minutes, costUsd, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, source}
 *   costEstimated  true when the cost shown is the estimate (default: no actual.costUsd)
 *   branch, areas[] (paths / folders it touches: the overlap check), parent (the entry a subagent reports under),
 *   doing (what the session is doing right now, short), progress 0..1, verify {state pending|running|verified|broken|skipped, at, summary, checks {name: pass|fail|skip}}
 */
export const BUILD_STATUSES = ['queued', 'running', 'done', 'failed'];
export const VERIFY_STATES = ['pending', 'running', 'verified', 'broken', 'skipped'];
export const STALE_MS = 10 * 60_000;
const SURFACE_RE = /^[a-z][a-z0-9-]{0,31}$/;
const REF_ID_RE = /^[A-Za-z0-9._:/-]{1,120}$/;
const AREA_RE = /^[A-Za-z0-9_.@/*+-]{1,200}$/;
const SOURCE_RE = /^[a-z][a-z0-9-]{0,23}$/;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };
const ACTUAL_INTS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function deriveStatus(result, asked) {
  if (result) return ['failed', 'cancelled'].includes(result.state) ? 'failed' : 'done';
  return asked === 'queued' ? 'queued' : 'running';
}

function normBuild(raw, e, errors) {
  e.status = deriveStatus(e.result, raw.status);
  if (raw.status != null && !BUILD_STATUSES.includes(String(raw.status))) errors.push(`status is one of ${BUILD_STATUSES.join(', ')}`);
  if (raw.buildRef != null) {
    const r = raw.buildRef;
    if (!isObj(r) || !KIND_RE.test(String(r.kind ?? '')) || !REF_ID_RE.test(String(r.id ?? ''))) errors.push('buildRef is {kind, id} (kind a short word, id a plain id)');
    else e.buildRef = { kind: String(r.kind), id: String(r.id) };
  }
  if (raw.surface != null && String(raw.surface) !== '') {
    if (!SURFACE_RE.test(String(raw.surface))) errors.push('surface is a short lowercase word (vps-claude-code, claude-ai, …)');
    else e.surface = String(raw.surface);
  }
  for (const k of ['startedAt', 'finishedAt', 'lastSeenAt']) if (isoOr(raw[k])) e[k] = raw[k];
  const money = (v, what) => { if (v == null) return undefined; if (!num(v) || v < 0 || v > 100000) { errors.push(`${what} is a number from 0 to 100000`); return undefined; } return v; };
  if (raw.estimate != null) {
    if (!isObj(raw.estimate)) errors.push('estimate is {minutes, costUsd}');
    else {
      const o = {};
      const m = money(raw.estimate.minutes, 'estimate.minutes'); if (m != null) o.minutes = Math.round(m);
      const c = money(raw.estimate.costUsd, 'estimate.costUsd'); if (c != null) o.costUsd = round(c, 4);
      e.estimate = o;
    }
  }
  if (raw.actual != null) {
    if (!isObj(raw.actual)) errors.push('actual is {minutes, costUsd, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, source}');
    else {
      const a = raw.actual, o = {};
      const m = money(a.minutes, 'actual.minutes'); if (m != null) o.minutes = Math.round(m);
      const c = money(a.costUsd, 'actual.costUsd'); if (c != null) o.costUsd = round(c, 4);
      for (const k of ACTUAL_INTS) { if (a[k] == null) continue; const n = numIn(a[k], 0, 10_000_000_000); if (n == null) errors.push(`actual.${k} is a whole number`); else o[k] = n; }
      if (a.source != null && String(a.source) !== '') { if (SOURCE_RE.test(String(a.source))) o.source = String(a.source); else errors.push('actual.source is a short word (transcript, manual, …)'); }
      e.actual = o;
    }
  }
  if (raw.costEstimated != null) { if (typeof raw.costEstimated !== 'boolean') errors.push('costEstimated is true or false'); else e.costEstimated = raw.costEstimated; }
  else if (e.estimate || e.actual) e.costEstimated = e.actual?.costUsd == null;
  if (raw.branch != null && String(raw.branch) !== '') {
    if (BRANCH_RE.test(String(raw.branch)) && !String(raw.branch).includes('..')) e.branch = String(raw.branch); else errors.push('branch is not a branch name');
  }
  if (raw.areas != null) {
    if (!Array.isArray(raw.areas)) errors.push('areas is a list of paths');
    else {
      if (raw.areas.length > LIMITS.areas) errors.push(`at most ${LIMITS.areas} areas`);
      const out = [];
      for (const a of raw.areas.slice(0, LIMITS.areas)) {
        const s = String(a ?? '');
        if (!AREA_RE.test(s) || s.split('/').includes('..') || s.startsWith('/')) errors.push(`area "${redact(s, 60)}" is a relative repo path`);
        else if (!out.includes(s)) out.push(s);
      }
      e.areas = out;
    }
  }
  if (raw.parent != null && String(raw.parent) !== '') { if (ID_RE.test(String(raw.parent))) e.parent = String(raw.parent); else errors.push('parent is a change id'); }
  if (raw.doing != null && String(raw.doing).trim()) e.doing = redact(raw.doing, LIMITS.doing);
  if (raw.progress != null) { if (!num(raw.progress) || raw.progress < 0 || raw.progress > 1) errors.push('progress is a number from 0 to 1'); else e.progress = round(raw.progress, 3); }
  if (raw.verify != null) {
    const v = raw.verify;
    if (!isObj(v) || !VERIFY_STATES.includes(String(v.state ?? ''))) errors.push(`verify is {state: ${VERIFY_STATES.join('|')}, at, summary, checks}`);
    else {
      const o = { state: String(v.state) };
      if (isoOr(v.at)) o.at = v.at;
      if (v.summary != null && String(v.summary).trim()) o.summary = redact(v.summary, LIMITS.note, true);
      if (v.checks != null) {
        if (!isObj(v.checks)) errors.push('verify.checks is {name: pass|fail|skip}');
        else {
          o.checks = {};
          for (const name of Object.keys(v.checks).slice(0, LIMITS.tests)) {
            const s = String(v.checks[name]);
            if (!['pass', 'fail', 'skip'].includes(s)) { errors.push(`verify check "${redact(name, 40)}" is pass, fail or skip`); continue; }
            const key = redact(name, LIMITS.testName); if (key) o.checks[key] = s;
          }
        }
      }
      e.verify = o;
    }
  }
}

/* ---------------- resume details (Oct 25 2026, Gizmo: "store enough details … so they can resume from a different Claude account") ---------------- */

/**
 * Optional `resume`: what a new session (any machine, any Claude account) needs to pick the work up where it stopped.
 *   repo owner/name · folder (where it ran) · branch · base (sha it started from) · head (last commit) · pushed (head on
 *   the remote) · dirty (uncommitted files) · pr (https URL) · files [repo paths changed] · plan (the approach) ·
 *   next (what's left) · notes · tests [commands that check it] · read [repo paths to read first] · at (when recorded)
 * The hook fills the git part by itself; plan / next / notes / tests / read come from `changes.mjs resume`.
 */
export const RESUME_LIMITS = { folder: 300, plan: 3000, next: 1500, notes: 3000, files: 300, file: 300, tests: 30, test: 300, read: 30 };
const RPATH_RE = /^[A-Za-z0-9_.@+-][A-Za-z0-9_.@+ /-]{0,299}$/;
export const resumePathOk = (s) => RPATH_RE.test(s) && !s.split('/').includes('..') && !s.includes('//');
function normResume(raw, e, errors) {
  const r = raw.resume;
  if (r == null) return;
  if (!isObj(r)) { errors.push('resume is an object'); return; }
  const o = {};
  if (r.repo != null && String(r.repo) !== '') { if (REPO_RE.test(String(r.repo))) o.repo = String(r.repo); else errors.push('resume.repo is owner/name'); }
  if (r.folder != null && String(r.folder).trim()) o.folder = redact(r.folder, RESUME_LIMITS.folder);
  if (r.branch != null && String(r.branch) !== '') { if (BRANCH_RE.test(String(r.branch)) && !String(r.branch).includes('..')) o.branch = String(r.branch); else errors.push('resume.branch is not a branch name'); }
  for (const k of ['base', 'head']) if (r[k] != null && String(r[k]) !== '') { const v = String(r[k]).toLowerCase(); if (SHA_RE.test(v)) o[k] = v; else errors.push(`resume.${k} is a commit sha`); }
  if (r.pushed != null) { if (typeof r.pushed === 'boolean') o.pushed = r.pushed; else errors.push('resume.pushed is true or false'); }
  if (r.dirty != null) { const n = numIn(r.dirty, 0, 1_000_000); if (n == null) errors.push('resume.dirty is a whole number'); else o.dirty = n; }
  if (r.pr != null && String(r.pr) !== '') { const v = link(r.pr); if (v && v.startsWith('https://')) o.pr = v; else errors.push('resume.pr is an https URL'); }
  for (const k of ['plan', 'next', 'notes']) if (r[k] != null && String(r[k]).trim()) o[k] = redact(r[k], RESUME_LIMITS[k], true);
  const list = (k, max, check, what, clean = (x) => String(x ?? '').trim()) => {
    if (r[k] == null) return;
    if (!Array.isArray(r[k])) { errors.push(`resume.${k} is a list`); return; }
    const out = [];
    for (const x of r[k].slice(0, max)) {
      const v = clean(x);
      if (!v) continue;
      if (!check(v)) { errors.push(`resume.${k}: "${redact(v, 60)}" ${what}`); continue; }
      if (!out.includes(v)) out.push(v);
    }
    o[k] = out;
  };
  list('files', RESUME_LIMITS.files, resumePathOk, 'is not a relative repo path');
  list('read', RESUME_LIMITS.read, resumePathOk, 'is not a relative repo path');
  list('tests', RESUME_LIMITS.tests, () => true, '', (x) => redact(x, RESUME_LIMITS.test));
  if (isoOr(r.at)) o.at = r.at;
  e.resume = o;
}

/**
 * The prompt a new session pastes to carry on (the console's "Copy resume prompt", `changes.mjs resume <id> --prompt`).
 * Same text from server/store.py `resume_prompt` (test.py checks both). Never holds a secret: every part is redacted.
 */
export function resumePrompt(e) {
  const r = e.resume ?? {};
  const repo = r.repo || (e.repos ?? [])[0] || '';
  const branch = r.branch || e.result?.branch || e.branch || '';
  const L = [`Resume a piece of work that another Claude session started (Codebase changes entry ${e.id}).`, ''];
  L.push(`Title: ${e.title}`);
  L.push(`Kind: ${e.kind} · state: ${e.result ? e.result.state : 'running'}${e.model ? ` · built so far with ${e.model}` : ''}`);
  if (repo) L.push(`Repo: ${repo}${branch ? ` · branch ${branch}` : ''}`);
  if (r.base || r.head) L.push(`Commits: started from ${r.base || '?'}, last ${r.head || '?'}${r.pushed === false ? ' (NOT pushed: it may only exist on the old machine)' : r.pushed ? ' (pushed)' : ''}`);
  if (r.dirty) L.push(`Uncommitted files on the old machine: ${r.dirty} (they are not in the repo; redo them if needed)`);
  if (r.pr) L.push(`Pull request: ${r.pr}`);
  if (e.asked) L.push('', 'What was asked:', e.asked);
  if (r.plan) L.push('', 'Plan:', r.plan);
  const steps = e.steps ?? [];
  if (steps.length) { L.push('', 'Steps:'); steps.forEach((s, i) => L.push(`  ${i + 1}. [${s.state}] ${s.text}${s.note ? ` (${s.note})` : ''}`)); }
  if (e.result?.summary) L.push('', `Result so far: ${e.result.summary}`);
  if (r.next) L.push('', 'What is left:', r.next);
  if (r.notes) L.push('', 'Notes:', r.notes);
  if (r.files?.length) L.push('', `Files changed (${r.files.length}):`, ...r.files.slice(0, 60).map((f) => `  ${f}`), ...(r.files.length > 60 ? [`  … and ${r.files.length - 60} more`] : []));
  if (r.read?.length) L.push('', 'Read first:', ...r.read.map((f) => `  ${f}`));
  if (r.tests?.length) L.push('', 'Check it with:', ...r.tests.map((t) => `  ${t}`));
  L.push('', 'How to carry on:');
  L.push(`  1. Work in ${repo || 'the same repo'}${branch ? ` on branch ${branch}` : ''}: fetch it and check it out (no new repo, no fork).`);
  L.push('  2. Read the repo\'s CLAUDE.md and rules first; check the Build manager\'s Live list so you don\'t clash with a running session.');
  L.push(`  3. Report on this same entry as you go: node apps/console-web/plugins/codebase-changes/changes.mjs step ${e.id} "<step>" --state running`);
  L.push(`     and keep its resume details current: changes.mjs resume ${e.id} --next "<what's left>"`);
  L.push(`  4. Finish with: changes.mjs result ${e.id} --state done --summary "<what changed>" --branch <branch> --commit <sha>`);
  return L.join('\n');
}

/** Running entries not heard from for STALE_MS (lastSeenAt, else updatedAt) show "no word". */
export function isStale(e, now = Date.now()) {
  if ((e.status ?? deriveStatus(e.result)) !== 'running') return false;
  const t = Date.parse(e.lastSeenAt || e.updatedAt || '');
  return Number.isFinite(t) && now - t > STALE_MS;
}

/** Upsert one step: by index (0-based), else by matching text, else appended. Times stamped on state changes. */
export function upsertStep(steps, { index, text, state, note }, now = nowIso()) {
  const out = (steps ?? []).map((s) => ({ ...s }));
  let i = Number.isInteger(index) ? index : out.findIndex((s) => s.text === text);
  if (i < 0 || i >= out.length) { if (!text) throw new Error('a new step needs text'); out.push({ text, state: 'queued' }); i = out.length - 1; }
  const s = out[i];
  if (text && Number.isInteger(index)) s.text = text;
  if (state && state !== s.state) {
    if (!STEP_STATES.includes(state)) throw new Error(`a step's state is one of ${STEP_STATES.join(', ')}`);
    s.state = state;
    if (state === 'running') { s.startedAt ??= now; delete s.finishedAt; }
    if (['done', 'failed', 'skipped'].includes(state)) { s.startedAt ??= now; s.finishedAt = now; }
  }
  if (note != null) s.note = note;
  return out;
}

/** Short form for lists and the banner. */
export function summary(e) {
  const steps = e.steps ?? [];
  return {
    id: e.id, createdAt: e.createdAt, updatedAt: e.updatedAt, kind: e.kind, title: e.title, asked: (e.asked ?? '').slice(0, 200),
    state: e.state, repos: e.repos ?? [], model: e.model ?? '', where: e.who?.where ?? '',
    steps: { total: steps.length, done: steps.filter((s) => s.state === 'done').length, failed: steps.filter((s) => s.state === 'failed').length, running: steps.find((s) => s.state === 'running')?.text ?? '' },
    result: e.result ? { state: e.result.state, summary: (e.result.summary ?? '').slice(0, 300) } : null,
    closed: e.closed ? e.closed.at : null,
    ...buildSummary(e),
  };
}

/** The build-stats part of a summary (same keys in store.py). Only keys the entry has. */
export function buildSummary(e) {
  const out = { status: e.status ?? deriveStatus(e.result) };
  for (const k of ['buildRef', 'surface', 'startedAt', 'finishedAt', 'lastSeenAt', 'estimate', 'actual', 'costEstimated', 'branch', 'areas', 'parent', 'progress', 'verify', 'doing']) if (e[k] != null) out[k] = e[k];
  const br = e.result?.branch; if (br && !out.branch) out.branch = br;
  if (e.result?.commits?.length) out.commits = e.result.commits.map((c) => c.sha).slice(0, 10);
  if (e.result?.links && Object.keys(e.result.links).length) out.links = e.result.links;
  if (e.who?.host) out.host = e.who.host;
  if (e.who?.session) out.session = e.who.session;
  if (e.who?.user) out.user = e.who.user;
  return out;
}

/* ---------------- Claude Code prompt classifier ---------------- */

/**
 * Does a prompt ask Claude to change code? Simple and documented on purpose:
 *  1. ignore empty prompts, slash commands ("/model") and prompts over 20,000 characters' worth of paste only after the first 2,000;
 *  2. a prompt that opens like a question (what/why/how/where/when/who/which/is/are/does/explain/tell me/show me/list…) is a
 *     question, unless it also says "please", "go ahead" or "can/could/would you";
 *  3. otherwise the first change word decides the kind:
 *       remove: remove, delete, uninstall, drop, get rid of, rip out, take out
 *       fix:    fix, repair, debug, resolve, patch, broken
 *       build:  build, create, add, implement, make, write, scaffold, set up, install, port, generate
 *       edit:   edit, change, update, modify, rename, refactor, move, replace, rework, tweak, adjust, improve, convert, migrate, rebuild
 *     No change word → not recorded.
 * Returns { change: boolean, kind, word }.
 */
const WORDS = [
  ['remove', /\b(remove|delete|uninstall|drop|get rid of|rip out|take out)\b/],
  ['fix', /\b(fix|fixes|repair|debug|resolve|patch|broken)\b/],
  ['build', /\b(build|create|add|implement|make|write|scaffold|set up|setup|install|port|generate)\b/],
  ['edit', /\b(edit|change|update|modify|rename|refactor|move|replace|rework|tweak|adjust|improve|convert|migrate|rebuild)\b/],
];
const QUESTION = /^(what|why|how|where|when|who|which|whose|is|are|was|were|does|do|did|explain|tell me|show me|list|describe|summari[sz]e|compare)\b/;
const ASK = /\b(please|go ahead|can you|could you|would you|will you)\b/;
export function classify(prompt) {
  const p = String(prompt ?? '').slice(0, 2000).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!p || p.startsWith('/')) return { change: false, kind: null, word: null };
  if (QUESTION.test(p) && !ASK.test(p)) return { change: false, kind: null, word: null };
  let best = null;
  for (const [kind, re] of WORDS) { const m = re.exec(p); if (m && (!best || m.index < best.at)) best = { kind, word: m[1], at: m.index }; }
  return best ? { change: true, kind: best.kind, word: best.word } : { change: false, kind: null, word: null };
}
/** A title from a prompt: its first sentence, cut short, secrets hidden. */
export function titleFrom(prompt) {
  const first = String(prompt ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  return redact(first, 100) || 'Untitled change';
}

/* ---------------- the folder store ---------------- */

/** File and folder modes: group-shared in the hub's projects tree (axHub runs as another user), private elsewhere. */
export function modes(shared) { return shared ? { file: 0o660, dir: 0o2770 } : { file: 0o600, dir: 0o700 }; }

function mkdirs(dir, mode) {
  if (existsSync(dir)) return;
  mkdirs(dirname(dir), mode);
  mkdirSync(dir, { mode });
}

export class DirStore {
  constructor(root, { shared = false } = {}) { this.root = root; this.m = modes(shared); }
  pathOf(id) { return join(this.root, relPath(id)); }
  get(id) {
    const p = this.pathOf(id);
    try { if (lstatSync(p).isSymbolicLink()) return null; return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  }
  /** Validate and write one entry atomically (temp file → fsync → rename). Throws with the problems on a bad entry. */
  put(raw) {
    const { entry, errors } = normalize(raw);
    if (!entry) throw new Error(errors.join('; '));
    const p = this.pathOf(entry.id);
    mkdirs(dirname(p), this.m.dir);
    try { if (lstatSync(p).isSymbolicLink()) throw new Error('refusing a symlink'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const tmp = join(dirname(p), `.${entry.id}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`);
    const fd = openSync(tmp, C.O_WRONLY | C.O_CREAT | C.O_EXCL | (C.O_NOFOLLOW ?? 0), this.m.file);
    try { fchmodSync(fd, this.m.file); writeSync(fd, `${JSON.stringify(entry, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    try { renameSync(tmp, p); } catch (e) { try { unlinkSync(tmp); } catch { /* gone */ } throw e; }
    return entry;
  }
  /** Every entry, newest first. */
  all() {
    const out = [];
    if (!existsSync(this.root)) return out;
    for (const y of readdirSync(this.root).filter((n) => /^\d{4}$/.test(n))) {
      for (const m of readdirSync(join(this.root, y)).filter((n) => /^\d{2}$/.test(n))) {
        for (const f of readdirSync(join(this.root, y, m)).filter((n) => n.endsWith('.json') && ID_RE.test(n.slice(0, -5)))) {
          const e = this.get(f.slice(0, -5));
          if (e?.id) out.push(e);
        }
      }
    }
    return out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id));
  }
}
