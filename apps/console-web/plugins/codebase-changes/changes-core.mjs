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
export const LIMITS = { title: 160, asked: 600, model: 40, repos: 10, repo: 100, steps: 100, stepText: 300, note: 1000, summary: 4000, commits: 50, commitMsg: 200, tests: 50, testName: 120, testValue: 60, links: 20, link: 500, branch: 120, who: 80, bytes: 64 * 1024 };

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
  if (Buffer.byteLength(JSON.stringify(e)) > LIMITS.bytes) errors.push(`an entry is at most ${LIMITS.bytes / 1024} KB`);
  return { entry: errors.length ? null : e, errors, draft: e };
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
  };
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
