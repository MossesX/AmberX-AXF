/**
 * shipped-manifest@1 — what the orchestrator sends the Shipped features ledger when a build lands (pure, IO-free).
 *
 * Brett, Nov 9 2026: "The orchestrator should send a manifest with the information on the shipped feature. Including
 * the prompt that created it and everything."
 *
 * One manifest per landed build. It is gathered by the orchestrator (framework/cli/shipped.mjs, IO: builds store, git,
 * headless session meters, UI Review, the build report), written next to the builds store as a sidecar
 * (_claude/builds/shipped/<build>.json, committed) and announced through the store: the build record carries a small
 * `shipped` ref ({ id, rev, at, landedCommit }), so every write goes through builds@1 and build-hook@1 fires a
 * `shipped` event. The ledger (feature-ledger@1) reads the manifest and moves the build's features to Merged with the
 * commit, files, model and report, keeping Brett's words verbatim.
 *
 *   shipped-manifest@1 = {
 *     $axf, version, id ('sm-<build>'), rev, source (orchestrator | backfill | api | manual), by, shippedAt
 *     build:    { id, title, profile, category, priority, repo }
 *     said:     { text, verbatim, at, source, by, addenda: [{ text, at, source, verbatim }] }   Brett's words, never paraphrased
 *               (a fallback from the build's detail is marked verbatim: false)
 *     brief:    the full brief the session ran on
 *     models:   ['Opus' | 'Fable'], accounts: ['account-3', …]
 *     runs:     [{ session, account, model, startedAt, endedAt, exit, costUsd }]
 *     steps:    [{ id, text, model, estimate, estimateMin, startedAt, doneAt, actualMin, done }]
 *     branch, pr: { repo, number, url }, landedCommit, commits: [sha], mergedAt, landedAt
 *     files:    [path], areas: [{ kind: plugin | app | framework | deploy | docs | builds | other, id, files }]
 *     tests:    [{ name, command, result: pass | fail | skip | unknown, detail }]
 *     uiReview: [{ id, name, status, group, url }]
 *     cost:     { usd, estimated, tokens: { input, output, cacheRead, cacheWrite } }
 *     report:   repo-relative path of the build report
 *     open:     [what is still open]
 *   }
 *   shipped-ref = { id, rev, at, landedCommit }   (on the builds@1 record)
 */
import { coerceModel, DEFAULT_MODEL } from './model-policy.mjs';

export const SCHEMA = 'shipped-manifest@1';
export const VERSION = 1;
export const SOURCES = ['orchestrator', 'backfill', 'api', 'manual'];
export const TEST_RESULTS = ['pass', 'fail', 'skip', 'unknown'];
export const AREA_KINDS = ['plugin', 'app', 'framework', 'deploy', 'docs', 'builds', 'other'];
export const MODELS = ['Opus', 'Fable'];
export const REPOS = ['amberx-axf', 'axhub'];
const GITHUB = { 'amberx-axf': 'MossesX/AmberX-AXF', axhub: 'MossesX/axHub' };
export const MAX_BRIEF = 40000;
export const MAX_SAID = 20000;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const uniq = (a) => [...new Set(a)];
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
/** An ISO time folded to UTC `Z` without milliseconds, or '' when it is not one. */
export const iso = (v) => { const s = str(v, 40).trim(); if (!ISO.test(s)) return ''; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().replace('.000Z', 'Z') : ''; };
const slug = (s) => str(s, 200).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const sha = (v) => { const s = str(v, 40).trim().toLowerCase(); return /^[0-9a-f]{7,40}$/.test(s) ? s : ''; };
/** 'opus', 'claude-fable-5-1', '[Fable]' → 'Opus' / 'Fable' (model-policy@1; a blocked model reads as the default). */
export const modelName = (v) => { const k = coerceModel(v, DEFAULT_MODEL); return MODELS.find((m) => m.toLowerCase() === k) || 'Opus'; };
export const manifestId = (buildId) => `sm-${slug(buildId)}`;

/** '30 min', '~20m', '1.5 h', '2h', '1 h 30 min', 45 → minutes (0 when unknown). */
export function estimateMinutes(v) {
  if (typeof v === 'number') return v > 0 ? Math.round(v) : 0;
  const s = str(v, 40).toLowerCase(); if (!s.trim()) return 0;
  let m = 0; let hit = false;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/g)) { hit = true; m += Number(n) * (u.startsWith('h') ? 60 : 1); }
  if (!hit) { const n = /^\s*~?\s*(\d+(?:\.\d+)?)\s*$/.exec(s); if (n) m = Number(n[1]); }
  return Math.round(m);
}
const minutesBetween = (a, b) => { const x = Date.parse(a); const y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / 60000) : 0; };

/** Where a changed file lives: a plugin, an app, the framework, deploy, docs, the builds data, or other. */
export function areaOf(path) {
  const p = str(path, 300);
  let m = /^apps\/([^/]+)\/(?:src\/)?plugins\/([^/]+)\//.exec(p); if (m) return { kind: 'plugin', id: m[2] };
  m = /^apps\/([^/]+)\//.exec(p); if (m) return { kind: 'app', id: m[1] };
  m = /^framework\/([^/]+)\//.exec(p); if (m) return { kind: 'framework', id: m[1] };
  if (/^deploy\//.test(p)) return { kind: 'deploy', id: 'deploy' };
  if (/^_claude\/builds\//.test(p) || /^changes\//.test(p)) return { kind: 'builds', id: 'builds' };
  if (/^(docs\/|_claude\/)|\.md$/.test(p)) return { kind: 'docs', id: 'docs' };
  return { kind: 'other', id: p.split('/')[0] || 'root' };
}
/** Files grouped by area, biggest first (ties: kind order, then id). */
export function areasOf(files) {
  const m = new Map();
  for (const f of uniq(list(files).map((x) => str(x, 300)).filter(Boolean))) { const a = areaOf(f); const k = `${a.kind}:${a.id}`; if (!m.has(k)) m.set(k, { ...a, files: [] }); m.get(k).files.push(f); }
  return [...m.values()].sort((a, b) => b.files.length - a.files.length || AREA_KINDS.indexOf(a.kind) - AREA_KINDS.indexOf(b.kind) || a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------ record shapes

const normSaid = (v) => {
  const o = isObj(v) ? v : { text: v };
  return {
    text: str(o.text ?? o.said, MAX_SAID), verbatim: o.verbatim !== false && o.mayBeParaphrased !== true, at: iso(o.at), source: str(o.source, 40), by: str(o.by, 120),
    addenda: list(o.addenda).map((a) => ({ text: str(a?.text ?? a?.said, MAX_SAID), at: iso(a?.at), source: str(a?.source, 40), verbatim: a?.verbatim !== false && a?.mayBeParaphrased !== true })).filter((a) => a.text.trim()),
  };
};
const normPr = (v) => {
  const o = isObj(v) ? v : { number: v };
  const raw = str(o.url ?? o.number, 300);
  const number = Number(o.number) > 0 && Number.isInteger(Number(o.number)) ? Number(o.number) : Number((/\/pull\/(\d+)/.exec(raw) || /#?(\d+)\s*$/.exec(raw) || [])[1]) || 0;
  const repo = REPOS.includes(o.repo) ? o.repo : /axhub/i.test(raw) ? 'axhub' : 'amberx-axf';
  return { repo, number, url: number ? (str(o.url, 300).startsWith('https://') ? str(o.url, 300) : `https://github.com/${GITHUB[repo]}/pull/${number}`) : '' };
};
const normStep = (s, i) => {
  const o = isObj(s) ? s : {};
  const estimate = str(o.estimate, 20); const startedAt = iso(o.startedAt); const doneAt = o.done === false ? '' : iso(o.doneAt);
  return {
    id: str(o.id, 40) || `s${i + 1}`, text: str(o.text || o.title, 2000), model: modelName(o.model), estimate, estimateMin: num(o.estimateMin) > 0 ? Math.round(num(o.estimateMin)) : estimateMinutes(estimate),
    startedAt, doneAt, actualMin: num(o.actualMin) > 0 ? Math.round(num(o.actualMin)) : minutesBetween(startedAt, doneAt), done: o.done === true || (o.done === undefined && !!doneAt),
  };
};
const normRun = (r) => {
  const o = isObj(r) ? r : {};
  return { session: str(o.session, 120), account: str(o.account, 80), model: o.model ? modelName(o.model) : '', startedAt: iso(o.startedAt), endedAt: iso(o.endedAt), exit: Number.isInteger(o.exit) ? o.exit : null, costUsd: Math.round(num(o.costUsd) * 10000) / 10000 };
};
const normTest = (t) => {
  const o = isObj(t) ? t : { name: t };
  const result = TEST_RESULTS.includes(o.result) ? o.result : 'unknown';
  return { name: str(o.name || o.command, 300), command: str(o.command, 500), result, detail: str(o.detail, 1000) };
};
const normReview = (r) => { const o = isObj(r) ? r : {}; return { id: str(o.id, 120), name: str(o.name, 300), status: str(o.status, 40), group: str(o.group, 200), url: str(o.url, 500) }; };
const normCost = (c) => {
  const o = isObj(c) ? c : {}; const t = isObj(o.tokens) ? o.tokens : {};
  return { usd: Math.round(num(o.usd) * 10000) / 10000, estimated: o.estimated === true, tokens: { input: Math.max(0, Math.round(num(t.input))), output: Math.max(0, Math.round(num(t.output))), cacheRead: Math.max(0, Math.round(num(t.cacheRead))), cacheWrite: Math.max(0, Math.round(num(t.cacheWrite))) } };
};

/** shipped-manifest@1 in shape (every field present, unknown ones dropped), or null without a build id. */
export function normManifest(v, { now = '' } = {}) {
  if (!isObj(v)) return null;
  const b = isObj(v.build) ? v.build : {};
  const id = slug(b.id); if (!id) return null;
  const steps = list(v.steps).map(normStep);
  const files = uniq(list(v.files).map((f) => str(f, 300)).filter(Boolean));
  const runs = list(v.runs).map(normRun).filter((r) => r.session || r.account);
  const models = uniq([...list(v.models).map(modelName), ...steps.filter((s) => s.done).map((s) => s.model), ...runs.map((r) => r.model).filter(Boolean)]);
  return {
    $axf: SCHEMA, version: VERSION, id: str(v.id, 120) || manifestId(id), rev: Math.max(1, Math.floor(num(v.rev)) || 1),
    source: SOURCES.includes(v.source) ? v.source : 'orchestrator', by: str(v.by, 120), shippedAt: iso(v.shippedAt) || iso(now),
    build: { id, title: str(b.title, 300), profile: str(b.profile, 40), category: str(b.category, 60), priority: str(b.priority, 4), repo: REPOS.includes(b.repo) ? b.repo : 'amberx-axf' },
    said: normSaid(v.said), brief: str(v.brief, MAX_BRIEF),
    models, accounts: uniq([...list(v.accounts).map((a) => str(a, 80)), ...runs.map((r) => r.account)].filter(Boolean)), runs, steps,
    branch: str(v.branch, 200), pr: normPr(v.pr), landedCommit: sha(v.landedCommit), commits: uniq(list(v.commits).map(sha).filter(Boolean)),
    mergedAt: iso(v.mergedAt), landedAt: iso(v.landedAt) || iso(v.mergedAt),
    files, areas: list(v.areas).length ? list(v.areas).filter(isObj).map((a) => ({ kind: AREA_KINDS.includes(a.kind) ? a.kind : 'other', id: str(a.id, 120), files: uniq(list(a.files).map((f) => str(f, 300)).filter(Boolean)) })) : areasOf(files),
    tests: list(v.tests).map(normTest).filter((t) => t.name), uiReview: list(v.uiReview).map(normReview).filter((r) => r.id || r.name),
    cost: normCost(v.cost), report: str(v.report, 300), open: uniq(list(v.open).map((o) => str(o, 500).trim()).filter(Boolean)),
  };
}

const need = (errors, cond, field, message) => { if (!cond) errors.push({ field, message }); };
/** Field-named problems with a manifest (as given, before normalising). */
export function validateManifest(v) {
  const errors = []; const o = isObj(v) ? v : {};
  need(errors, o.$axf === undefined || o.$axf === SCHEMA, '$axf', `$axf must be ${SCHEMA}`);
  need(errors, slug(o.build?.id), 'build.id', 'build.id is missing');
  const said = isObj(o.said) ? o.said : { text: o.said };
  need(errors, str(said.text ?? said.said, MAX_SAID).trim(), 'said.text', "said.text (Brett's words that started the build) is missing");
  need(errors, said.verbatim === undefined || typeof said.verbatim === 'boolean', 'said.verbatim', 'said.verbatim must be true or false');
  need(errors, sha(o.landedCommit) || normPr(o.pr).number > 0 || iso(o.mergedAt), 'landedCommit', 'a shipped manifest names what landed: landedCommit, pr or mergedAt');
  need(errors, o.landedCommit === undefined || o.landedCommit === '' || sha(o.landedCommit), 'landedCommit', 'landedCommit must be a git sha');
  need(errors, o.source === undefined || SOURCES.includes(o.source), 'source', `source must be one of ${SOURCES.join(', ')}`);
  for (const k of ['shippedAt', 'mergedAt', 'landedAt']) need(errors, o[k] === undefined || o[k] === '' || iso(o[k]), k, `${k} is not an ISO time`);
  need(errors, o.steps === undefined || (Array.isArray(o.steps) && o.steps.every((s) => isObj(s) && (o.steps.length < 1 || s.doneAt === undefined || s.doneAt === '' || iso(s.doneAt)))), 'steps', 'steps must be [{ id, text, model, estimate, doneAt }] with ISO times');
  need(errors, o.models === undefined || (Array.isArray(o.models) && o.models.every((m) => MODELS.includes(m))), 'models', `models must be from ${MODELS.join(', ')} (model-policy@1)`);
  need(errors, o.tests === undefined || (Array.isArray(o.tests) && o.tests.every((t) => isObj(t) && (t.result === undefined || TEST_RESULTS.includes(t.result)))), 'tests', `tests must be [{ name, command, result: ${TEST_RESULTS.join(' | ')} }]`);
  need(errors, o.files === undefined || (Array.isArray(o.files) && o.files.every((f) => typeof f === 'string')), 'files', 'files must be a list of paths');
  need(errors, o.cost === undefined || isObj(o.cost), 'cost', 'cost must be { usd, tokens }');
  return { ok: !errors.length, errors };
}
export const rejection = (errors) => errors.map((e) => `${e.field}: ${e.message}`).join('; ');

/** The ref a builds@1 record carries (small: the manifest itself is the sidecar). */
export function normRef(v) {
  if (!isObj(v)) return null;
  const id = str(v.id, 120); if (!id) return null;
  return { id, rev: Math.max(1, Math.floor(num(v.rev)) || 1), at: iso(v.at), landedCommit: sha(v.landedCommit) };
}
export const refOf = (m) => normRef({ id: m.id, rev: m.rev, at: m.shippedAt, landedCommit: m.landedCommit });

/** A build whose work is on main: merged, complete, or with a landed commit. */
export const isLanded = (b) => !!b && !b.deleted && (!!iso(b.mergedAt) || b.status === 'complete');

// ------------------------------------------------------------------ from a builds@1 record + what the host found

/**
 * A manifest from a builds@1 record and the facts the IO side gathered (`found`: runs, commits, files, landedCommit,
 * landedAt, tests, uiReview, cost, report, brief, open). Step start times: the previous done step's doneAt, else the
 * first run's start. Brett's words: origin.said (verbatim), else the build's detail marked verbatim: false.
 */
export function manifestFromBuild(build, found = {}, { now = '', source = 'orchestrator', by = '', prev = null } = {}) {
  const b = isObj(build) ? build : {}; const f = isObj(found) ? found : {};
  const o = isObj(b.origin) ? b.origin : {};
  const runs = list(f.runs).map(normRun);
  const firstStart = runs.map((r) => r.startedAt).filter(Boolean).sort()[0] || iso(b.pipeline?.launchedAt) || '';
  const doneSorted = list(b.steps).filter((s) => s?.done && iso(s.doneAt)).map((s) => iso(s.doneAt)).sort();
  const steps = list(b.steps).filter((s) => isObj(s) && !s.skip).map((s, i) => {
    const doneAt = s.done ? iso(s.doneAt) : '';
    const before = doneAt ? doneSorted.filter((d) => d < doneAt).pop() : '';
    return { id: s.id || `s${i + 1}`, text: s.title || s.text, model: s.model, estimate: s.estimate, startedAt: doneAt ? (before || firstStart) : '', doneAt, done: !!s.done };
  });
  const said = str(o.said, MAX_SAID).trim()
    ? { text: o.said, verbatim: o.verbatim !== false, at: o.at, source: o.source, by: o.by, addenda: list(o.addenda).map((a) => ({ text: a?.said, at: a?.at, source: a?.source, verbatim: a?.verbatim !== false })) }
    : { text: str(b.detail, MAX_SAID) || str(b.title, 300), verbatim: false };
  const open = [...steps.filter((s) => !s.done).map((s) => `${s.id}: ${str(s.text, 200)}`), ...list(f.open)];
  return normManifest({
    id: prev?.id, rev: prev ? (prev.rev || 1) + 1 : 1, source, by, shippedAt: now,
    build: { id: b.id, title: b.title, profile: list(b.profiles)[0] || b.profile, category: b.category, priority: b.priority, repo: f.repo || (/axhub/i.test(str(b.pr, 300)) ? 'axhub' : 'amberx-axf') },
    said, brief: f.brief || o.brief || '', models: f.models, accounts: f.accounts, runs, steps,
    branch: b.branch || f.branch, pr: f.pr || b.pr, landedCommit: f.landedCommit, commits: f.commits, mergedAt: b.mergedAt || f.mergedAt, landedAt: f.landedAt,
    files: f.files, tests: f.tests, uiReview: f.uiReview, cost: f.cost, report: f.report, open,
  }, { now });
}

// ------------------------------------------------------------------ to the ledger (feature-ledger@1 inputs)

const FEATURE_TYPE_HINTS = [[/\bfix|bug|broken|crash|urgent\b/i, 'fix'], [/\bschema|contract|engine|@\d\b/i, 'framework-contract'], [/\bdocs?\b|readme/i, 'docs'], [/\bperf|faster|slow\b/i, 'perf'], [/\brefactor\b/i, 'refactor'], [/\bremove|retire\b/i, 'removal']];
/**
 * What the ledger writes for a manifest: the build and PR records, Brett's prompts (origin + addenda), the fields every
 * feature of the build takes (merged, commit, files, model), an edit summary for edits of the build, and a feature to
 * create when the build planned none (title as name, the one plugin / app it touched).
 */
export function toLedger(manifest) {
  const m = normManifest(manifest); if (!m) return null;
  const b = m.build;
  const promptRecs = m.said.text.trim() ? [
    { build: b.id, profile: b.profile, index: 0, kind: 'origin', said: m.said.text, at: m.said.at, source: m.said.source, by: m.said.by, verbatim: m.said.verbatim, from: m.said.verbatim ? '' : 'detail' },
    ...m.said.addenda.map((a, i) => ({ build: b.id, profile: b.profile, index: i + 1, kind: 'addendum', said: a.text, at: a.at, source: a.source, verbatim: a.verbatim })),
  ] : [];
  const model = m.models.includes('Fable') ? 'Fable' : m.models[0] || '';
  const agent = m.runs.map((r) => r.session).filter(Boolean).pop() || '';
  const mergedAt = m.mergedAt || m.landedAt;
  const plugins = m.areas.filter((a) => a.kind === 'plugin'); const apps = m.areas.filter((a) => a.kind === 'app');
  const type = (FEATURE_TYPE_HINTS.find(([re]) => re.test(`${b.title} ${b.category}`)) || [null, 'new-feature'])[1];
  const prRef = m.pr.number ? { repo: m.pr.repo, number: m.pr.number, role: 'added' } : null;
  const fields = { mergedAt, mergeCommit: m.landedCommit, commits: m.commits, files: m.files, model, session: agent, links: m.report ? { report: m.report } : {}, ...(prRef ? { prs: [prRef] } : {}) };
  return {
    manifest: m,
    build: { id: b.id, profile: b.profile, title: b.title, category: b.category, status: mergedAt ? 'complete' : 'built', branch: m.branch, pr: m.pr.number, repo: b.repo, mergedAt, model, session: agent, prompt: promptRecs.length ? `p-${slug(b.id)}-0` : '', report: m.report },
    pr: m.pr.number ? { repo: m.pr.repo, number: m.pr.number, title: b.title, branch: m.branch, build: b.id, profile: b.profile, mergedAt, mergeCommit: m.landedCommit, files: m.files, url: m.pr.url } : null,
    prompts: promptRecs,
    featureFields: fields,
    edit: { kind: type === 'fix' ? 'fixed' : 'changed', summary: b.title, build: b.id, profile: b.profile, pr: m.pr.number, repo: m.pr.repo, commit: m.landedCommit, model, session: agent, status: mergedAt ? 'merged' : 'in-pr', mergedAt, files: m.files },
    feature: {
      name: b.title || b.id, description: m.said.verbatim ? '' : m.said.text.slice(0, 2000), type, repo: b.repo,
      plugin: plugins.length === 1 ? plugins[0].id : '', app: plugins.length === 1 ? 'console-web' : apps.length === 1 ? apps[0].id : '',
      status: mergedAt ? 'merged' : 'in-pr', plannedAt: m.steps.map((s) => s.startedAt).filter(Boolean).sort()[0] || mergedAt,
      builds: [{ id: b.id, profile: b.profile, role: 'added' }], prompts: promptRecs.length ? [{ id: `p-${slug(b.id)}-0`, passage: '' }] : [],
      ...fields, source: m.source === 'backfill' ? 'import' : 'live', tags: ['shipped-manifest'],
    },
  };
}

/** One line per manifest for lists and voice: "<title> · PR #n · <commit> · <when>". */
export function summaryOf(manifest) {
  const m = normManifest(manifest); if (!m) return null;
  const done = m.steps.filter((s) => s.done);
  return {
    id: m.id, build: m.build.id, title: m.build.title, said: m.said.text.slice(0, 280), verbatim: m.said.verbatim, pr: m.pr.number, landedCommit: m.landedCommit, landedAt: m.landedAt, shippedAt: m.shippedAt,
    models: m.models, accounts: m.accounts, files: m.files.length, areas: m.areas.map((a) => `${a.kind}:${a.id}`), tests: { pass: m.tests.filter((t) => t.result === 'pass').length, fail: m.tests.filter((t) => t.result === 'fail').length, total: m.tests.length },
    steps: { done: done.length, total: m.steps.length, estimateMin: m.steps.reduce((a, s) => a + s.estimateMin, 0), actualMin: done.reduce((a, s) => a + s.actualMin, 0) }, costUsd: m.cost.usd, open: m.open.length, report: m.report, source: m.source,
  };
}
/** Search text of a manifest (prompt, title, files, commits, accounts…), lower case. */
export const searchText = (manifest) => { const m = normManifest(manifest); return m ? [m.build.id, m.build.title, m.said.text, ...m.said.addenda.map((a) => a.text), m.branch, `#${m.pr.number}`, m.landedCommit, ...m.commits, ...m.files, ...m.accounts, ...m.models, ...m.open].join('\n').toLowerCase() : ''; };

// ------------------------------------------------------------------ registry + JSON Schema

export const REGISTRY = Object.freeze({ schema: SCHEMA, version: VERSION, sources: SOURCES, testResults: TEST_RESULTS, areaKinds: AREA_KINDS, models: MODELS, repos: REPOS, maxBrief: MAX_BRIEF, maxSaid: MAX_SAID, sidecar: '_claude/builds/shipped/<build>.json', ref: ['id', 'rev', 'at', 'landedCommit'] });
export function jsonSchemas() {
  const s = { type: 'string' }; const strArr = { type: 'array', items: s }; const int0 = { type: 'integer', minimum: 0 };
  return {
    'shipped-manifest.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/shipped-manifest.schema.json',
      title: 'shipped-manifest@1: what the orchestrator sends the Shipped features ledger when a build lands', type: 'object', additionalProperties: false, required: ['build', 'said'],
      properties: {
        $axf: { const: SCHEMA }, version: { const: VERSION }, id: s, rev: { type: 'integer', minimum: 1 }, source: { enum: SOURCES }, by: s, shippedAt: s,
        build: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', minLength: 1 }, title: s, profile: s, category: s, priority: s, repo: { enum: REPOS } } },
        said: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', minLength: 1 }, verbatim: { type: 'boolean' }, at: s, source: s, by: s, addenda: { type: 'array', items: { type: 'object', required: ['text'], properties: { text: s, at: s, source: s, verbatim: { type: 'boolean' } } } } } },
        brief: { type: 'string', maxLength: MAX_BRIEF }, models: { type: 'array', items: { enum: MODELS } }, accounts: strArr,
        runs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { session: s, account: s, model: { enum: [...MODELS, ''] }, startedAt: s, endedAt: s, exit: { type: ['integer', 'null'] }, costUsd: { type: 'number' } } } },
        steps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: s, text: s, model: { enum: MODELS }, estimate: s, estimateMin: int0, startedAt: s, doneAt: s, actualMin: int0, done: { type: 'boolean' } } } },
        branch: s, pr: { type: 'object', additionalProperties: false, properties: { repo: { enum: REPOS }, number: int0, url: s } }, landedCommit: s, commits: strArr, mergedAt: s, landedAt: s,
        files: strArr, areas: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { kind: { enum: AREA_KINDS }, id: s, files: strArr } } },
        tests: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: s, command: s, result: { enum: TEST_RESULTS }, detail: s } } },
        uiReview: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: s, name: s, status: s, group: s, url: s } } },
        cost: { type: 'object', additionalProperties: false, properties: { usd: { type: 'number', minimum: 0 }, estimated: { type: 'boolean' }, tokens: { type: 'object', additionalProperties: false, properties: { input: int0, output: int0, cacheRead: int0, cacheWrite: int0 } } } },
        report: s, open: strArr,
      },
    },
  };
}
