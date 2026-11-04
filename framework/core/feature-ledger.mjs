/**
 * feature-ledger@1 — every individual feature ever shipped, where it came from and when it went live (pure, IO-free).
 *
 * Brett, Nov 4 2026 (voice): "Where's the list of features that can be sorted, and when they went live?" …
 * "I need a list of individual features, and you can view the features or you can view the builds that made the
 * features." … "all the features that were built and what PR they belong to … including the prompt that I wrote
 * that spawned it." … "As soon as a prompt goes through that plans on building the features, they go into that
 * list" … "Anytime a feature in that list is getting changed or altered, it will appear as an edit."
 *
 * This module is the contract the Shipped features plugin, its SQLite store, the importer, the grid and every other
 * reader share: record shapes, ONE status lifecycle for features and for edits, ids, merging that never loses a
 * date or a prompt, migration between ledger versions, and the grouping / sort / filter projections every port
 * draws the grid from. No IO, no database, no git here: hosts pass git ancestry in as a function.
 *
 * Records (each `$axf`-tagged):
 *   feature@1        one feature: name, type, app/plugin, repo, status, dates (planned, merged, live per target),
 *                    the builds and PRs that added / changed / fixed / removed it, prompts, edits summary, links
 *   feature-edit@1   one later change to an existing feature: what changed, which build / PR / commit, prompt, its
 *                    own status (same lifecycle), dates
 *   ledger-pr@1      a pull request (repo + number) with merge commit and dates
 *   ledger-build@1   a build (builds@1 id + profile) as the ledger sees it
 *   prompt@1         Brett's words, verbatim (build-origin@1 said / addendum), or marked `mayBeParaphrased`
 *   deploy@1         from deploy-log@1 (imported, not redefined)
 *
 * Lifecycle (features and edits): planned → queued → building → in-pr → merged → live; cancelled (from any pending
 * state) and removed (from merged / live) end it. A step back is allowed only in-pr → building (PR closed unmerged).
 */
import { RECORD as DEPLOY_RECORD, normDeploy, validateDeploy, liveAt as deployLiveAt, firstLive, dateMark, TARGETS as DEPLOY_TARGETS } from './deploy-log.mjs';

export { normDeploy, validateDeploy, dateMark, DEPLOY_RECORD };
export const SCHEMA = 'feature-ledger@1';
export const VERSION = 1;
export const RECORDS = Object.freeze({ feature: 'feature@1', edit: 'feature-edit@1', pr: 'ledger-pr@1', build: 'ledger-build@1', prompt: 'prompt@1', deploy: DEPLOY_RECORD });

// ------------------------------------------------------------------ one lifecycle

export const STATUSES = ['planned', 'queued', 'building', 'in-pr', 'merged', 'live', 'cancelled', 'removed'];
export const PENDING_STATUSES = ['planned', 'queued', 'building', 'in-pr'];
export const COMPLETED_STATUSES = ['merged', 'live', 'removed'];
export const ENDED_STATUSES = ['cancelled', 'removed'];
const RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
export const STATUS_LABEL = Object.freeze({ planned: 'Planned', queued: 'Queued', building: 'Building', 'in-pr': 'In PR', merged: 'Merged', live: 'Live', cancelled: 'Cancelled', removed: 'Removed' });
/** Tone names are theme tokens (the UI maps them to --fx-* colours), never colours. */
export const STATUS_TONE = Object.freeze({ planned: 'muted', queued: 'muted', building: 'info', 'in-pr': 'warn', merged: 'accent', live: 'ok', cancelled: 'muted', removed: 'danger' });
/** Events that move a feature or an edit along. */
export const EVENTS = ['planned', 'queued', 'building', 'pr-opened', 'pr-closed', 'merged', 'deployed', 'cancelled', 'removed'];
const EVENT_TO = { planned: 'planned', queued: 'queued', building: 'building', 'pr-opened': 'in-pr', 'pr-closed': 'building', merged: 'merged', deployed: 'live', cancelled: 'cancelled', removed: 'removed' };

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
export const iso = (v) => { const s = str(v, 40).trim(); return ISO.test(s) ? s : ''; };
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const list = (v) => (Array.isArray(v) ? v : []);
const uniq = (a) => [...new Set(a)];
const clone = (v) => JSON.parse(JSON.stringify(v));

export const normStatus = (v, d = 'planned') => { const s = str(v, 20).trim().toLowerCase().replace(/[\s_]+/g, '-'); if (STATUSES.includes(s)) return s; if (s === 'in-progress' || s === 'running') return 'building'; if (s === 'pr' || s === 'review' || s === 'built') return 'in-pr'; if (s === 'done' || s === 'complete' || s === 'shipped') return 'merged'; if (s === 'deployed') return 'live'; return d; };
export const statusGroup = (s) => (PENDING_STATUSES.includes(s) ? 'pending' : s === 'cancelled' ? 'cancelled' : 'completed');
export const isPending = (s) => PENDING_STATUSES.includes(s);
export const isCompleted = (s) => COMPLETED_STATUSES.includes(s);
/** Forward only, except: any pending → cancelled, merged / live → removed, in-pr → building (PR closed). Same → same is fine. */
export function canTransition(from, to) {
  const f = normStatus(from, ''); const t = normStatus(to, '');
  if (!f || !t) return false;
  if (f === t) return true;
  if (t === 'cancelled') return isPending(f);
  if (t === 'removed') return f === 'merged' || f === 'live';
  if (f === 'cancelled' || f === 'removed') return false;
  if (f === 'in-pr' && t === 'building') return true;
  return RANK[t] > RANK[f] && t !== 'planned';
}
/** The status after an event; unchanged when the move isn't allowed (a deploy of a cancelled feature changes nothing). */
export function advance(status, event) {
  const to = EVENT_TO[event]; if (!to) return normStatus(status);
  const from = normStatus(status);
  return canTransition(from, to) ? to : from;
}
/** The later of two statuses on the one line (used when two copies of a record meet). */
export const laterStatus = (a, b) => { const x = normStatus(a); const y = normStatus(b); if (x === y) return x; if (ENDED_STATUSES.includes(x)) return x; if (ENDED_STATUSES.includes(y)) return y; return RANK[x] >= RANK[y] ? x : y; };

/**
 * A builds@1 record → the ledger status of the features it is building. `live` = already live on at least one target.
 * failed / blocked builds keep their position and are flagged `stalled`.
 */
export function statusFromBuild({ status = '', pr = '', mergedAt = '', live = false, planned = false } = {}) {
  const s = str(status, 20);
  if (live) return { status: 'live', stalled: false };
  if (mergedAt || s === 'complete' || s === 'archived') return { status: 'merged', stalled: false };
  if (s === 'built' || (pr && s !== 'pending')) return { status: 'in-pr', stalled: false };
  if (s === 'running') return { status: 'building', stalled: false };
  if (s === 'failed') return { status: 'building', stalled: true };
  if (s === 'blocked' || s === 'waiting') return { status: 'queued', stalled: s === 'blocked' };
  return { status: planned ? 'planned' : 'queued', stalled: false };
}

// ------------------------------------------------------------------ registries

export const FEATURE_TYPES = ['new-feature', 'fix', 'ui', 'framework-contract', 'infra', 'docs', 'perf', 'refactor', 'test', 'chore', 'removal'];
export const TYPE_LABEL = Object.freeze({ 'new-feature': 'New feature', fix: 'Fix', ui: 'UI', 'framework-contract': 'Framework contract', infra: 'Infra', docs: 'Docs', perf: 'Performance', refactor: 'Refactor', test: 'Tests', chore: 'Chore', removal: 'Removal' });
export const ROLES = ['added', 'changed', 'fixed', 'removed'];
export const EDIT_KINDS = ['changed', 'fixed', 'removed', 'renamed', 'moved', 'reverted', 'restored'];
export const REPOS = Object.freeze({ 'amberx-axf': { label: 'AmberX', github: 'MossesX/AmberX-AXF' }, axhub: { label: 'axHub', github: 'MossesX/axHub' } });
export const SOURCES = ['live', 'import', 'manual'];
export const GROUPINGS = ['pr', 'plugin', 'app', 'type', 'build', 'day', 'repo', 'flat'];
export const GROUPING_LABEL = Object.freeze({ pr: 'PR', plugin: 'Plugin', app: 'App', type: 'Feature type', build: 'Build', day: 'Day', repo: 'Repo', flat: 'Flat (features)' });
export const SORT_KEYS = ['liveAt', 'mergedAt', 'plannedAt', 'lastChangedAt', 'lastEditAt', 'editCount', 'name', 'status', 'app', 'plugin', 'type', 'builds', 'prs', 'repo'];
export const DEFAULT_VIEW = Object.freeze({ by: 'pr', sort: { by: 'liveAt', dir: 'desc' }, hideCompleted: false, hidePending: false, hideCancelled: true, statuses: [], hasEdits: null, beingEdited: false, editStatus: '', search: '', app: '', plugin: '', type: '', repo: '', live: '', from: '', to: '', hiddenColumns: [], expanded: [] });

export const slug = (s) => str(s, 200).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
export const normType = (v) => { const s = str(v, 40).trim().toLowerCase().replace(/[\s_]+/g, '-'); if (FEATURE_TYPES.includes(s)) return s; if (s === 'feature' || s === 'new' || s === 'feat') return 'new-feature'; if (s === 'bug' || s === 'bugfix' || s === 'hotfix') return 'fix'; if (s === 'contract' || s === 'schema' || s === 'engine') return 'framework-contract'; if (s === 'doc' || s === 'documentation') return 'docs'; if (s === 'tests') return 'test'; if (s === 'remove' || s === 'retire' || s === 'kill') return 'removal'; return 'new-feature'; };
export const normRepo = (v) => { const s = str(v, 80).trim().toLowerCase(); if (REPOS[s]) return s; if (/amberx-axf|amberx\b|axf\b/.test(s)) return 'amberx-axf'; if (/axhub/.test(s)) return 'axhub'; return s ? slug(s) : 'amberx-axf'; };
export const normRole = (v, d = 'added') => (ROLES.includes(v) ? v : d);
export const featureId = (name, scope = '') => { const n = slug(name); const sc = slug(scope); return n ? `f-${sc ? `${sc}-` : ''}${n}` : ''; };
export const prKey = (repo, number) => `${normRepo(repo)}#${Number(number) || 0}`;
export const buildKey = (profile, id) => `${slug(profile) || 'main-framework'}:${slug(id)}`;
export const promptId = (buildId, index = 0) => `p-${slug(buildId)}-${Number(index) || 0}`;
export const editId = (featureId_, at, seq = 0) => `e-${str(featureId_, 90).replace(/^f-/, '')}-${Math.floor(new Date(at || 0).getTime() / 1000) || 0}${seq ? `-${seq}` : ''}`;
/** Same feature in two builds = one row: app / plugin + name decide. */
export const featureKey = (f) => `${slug(f?.plugin || f?.app || '')}/${slug(f?.name || '')}`;

// ------------------------------------------------------------------ record shapes

const normLive = (v) => {
  const out = {};
  for (const [t, x] of Object.entries(v && typeof v === 'object' ? v : {})) {
    const target = str(t, 80).toLowerCase(); if (!target) continue;
    const e = typeof x === 'string' ? { at: x } : x && typeof x === 'object' ? x : null;
    const at = iso(e?.at); if (!at) continue;
    out[target] = { at, guessed: bool(e.guessed), deploy: str(e.deploy, 120) };
  }
  return out;
};
const normRef = (r, keys) => { const o = r && typeof r === 'object' ? r : {}; const out = {}; for (const [k, f] of Object.entries(keys)) out[k] = f(o[k]); return out; };
const normBuildRef = (r) => (typeof r === 'string' ? { id: slug(r), profile: '', role: 'added' } : normRef(r, { id: (v) => slug(v), profile: (v) => slug(v), role: (v) => normRole(v) }));
const normPrRef = (r) => (typeof r === 'number' ? { repo: 'amberx-axf', number: r, role: 'added' } : normRef(r, { repo: normRepo, number: (v) => Number(v) || 0, role: (v) => normRole(v) }));
const normPromptRef = (r) => (typeof r === 'string' ? { id: str(r, 120), passage: '' } : normRef(r, { id: (v) => str(v, 120), passage: (v) => str(v, 2000) }));
const normLinks = (v) => { const o = v && typeof v === 'object' ? v : {}; const out = {}; for (const k of ['docs', 'video', 'plan', 'report', 'help']) if (str(o[k])) out[k] = str(o[k], 500); return out; };

/** feature@1 in shape (unknown fields dropped, every field present), or null when it has no name. */
export function normFeature(v, { now = '' } = {}) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const name = str(v.name ?? v.title, 300).trim(); if (!name) return null;
  const app = slug(v.app); const plugin = slug(v.plugin);
  const edits = uniq(list(v.edits).map((e) => str(typeof e === 'string' ? e : e?.id, 120)).filter(Boolean));
  const liveMap = normLive(v.liveAt);
  const mergedAt = iso(v.mergedAt);
  const f = {
    $axf: RECORDS.feature,
    id: str(v.id, 120) || featureId(name, plugin || app),
    name, description: str(v.description, 4000),
    type: normType(v.type), app, plugin,
    repo: normRepo(v.repo), originRepo: v.originRepo ? normRepo(v.originRepo) : normRepo(v.repo), movedIntoAxf: bool(v.movedIntoAxf),
    status: normStatus(v.status), stalled: bool(v.stalled),
    plannedAt: iso(v.plannedAt ?? v.createdAt), mergedAt, mergedAtGuessed: bool(v.mergedAtGuessed),
    liveAt: liveMap, firstLiveAt: firstLive(liveMap), lastChangedAt: iso(v.lastChangedAt) || mergedAt || iso(v.plannedAt ?? v.createdAt),
    builds: list(v.builds).map(normBuildRef).filter((b) => b.id), prs: list(v.prs).map(normPrRef).filter((p) => p.number > 0),
    commits: uniq(list(v.commits).map((s) => str(s, 40).toLowerCase()).filter(Boolean)), mergeCommit: str(v.mergeCommit, 40).toLowerCase(),
    prompts: list(v.prompts).map(normPromptRef).filter((p) => p.id),
    model: str(v.model, 40), thinking: str(v.thinking, 40), agent: str(v.agent, 80), session: str(v.session, 120),
    files: uniq(list(v.files).map((s) => str(s, 300)).filter(Boolean)), links: normLinks(v.links),
    edits, editCount: Math.max(edits.length, Number(v.editCount) || 0), lastEditAt: iso(v.lastEditAt), beingEdited: bool(v.beingEdited),
    tags: uniq(list(v.tags).map((t) => slug(t)).filter(Boolean)),
    source: SOURCES.includes(v.source) ? v.source : 'live', confidence: v.confidence === 'guessed' ? 'guessed' : 'exact',
    createdAt: iso(v.createdAt) || iso(now), updatedAt: iso(v.updatedAt) || iso(now), rev: Math.max(1, Number(v.rev) || 1),
  };
  if (f.firstLiveAt && canTransition(f.status, 'live')) f.status = 'live';
  else if (!f.firstLiveAt && f.status !== 'live' && mergedAt && canTransition(f.status, 'merged')) f.status = 'merged';
  return f;
}

/** feature-edit@1 in shape, or null without a feature id or summary. */
export function normEdit(v, { now = '' } = {}) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const feature = str(v.feature ?? v.featureId, 120); const summary = str(v.summary ?? v.what, 2000).trim();
  if (!feature || !summary) return null;
  const at = iso(v.at) || iso(v.createdAt) || iso(now);
  const liveMap = normLive(v.liveAt);
  const e = {
    $axf: RECORDS.edit,
    id: str(v.id, 160) || editId(feature, at, Number(v.seq) || 0),
    feature, kind: EDIT_KINDS.includes(v.kind) ? v.kind : 'changed', summary,
    build: slug(v.build), profile: slug(v.profile), pr: Number(v.pr) || 0, repo: normRepo(v.repo), commit: str(v.commit, 40).toLowerCase(),
    prompt: str(v.prompt ?? v.promptId, 120), passage: str(v.passage, 2000),
    model: str(v.model, 40), agent: str(v.agent, 80), session: str(v.session, 120),
    status: normStatus(v.status), at, mergedAt: iso(v.mergedAt), liveAt: liveMap, files: uniq(list(v.files).map((s) => str(s, 300)).filter(Boolean)),
    source: SOURCES.includes(v.source) ? v.source : 'live', createdAt: iso(v.createdAt) || at, updatedAt: iso(v.updatedAt) || at, rev: Math.max(1, Number(v.rev) || 1),
  };
  if (firstLive(liveMap) && canTransition(e.status, 'live')) e.status = 'live';
  else if (e.mergedAt && !firstLive(liveMap) && canTransition(e.status, 'merged')) e.status = 'merged';
  return e;
}

export function normPr(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const number = Number(v.number); if (!(number > 0)) return null;
  const repo = normRepo(v.repo);
  const merged = iso(v.mergedAt);
  return {
    $axf: RECORDS.pr, key: prKey(repo, number), repo, number, title: str(v.title, 300), body: str(v.body, 30000), branch: str(v.branch, 200), author: str(v.author, 120),
    url: str(v.url, 300) || (REPOS[repo] ? `https://github.com/${REPOS[repo].github}/pull/${number}` : ''),
    createdAt: iso(v.createdAt), mergedAt: merged, mergeCommit: str(v.mergeCommit, 40).toLowerCase(), closedAt: iso(v.closedAt),
    state: merged ? 'merged' : iso(v.closedAt) ? 'closed' : 'open', build: slug(v.build), profile: slug(v.profile),
    features: uniq(list(v.features).map((f) => str(f, 120)).filter(Boolean)), files: uniq(list(v.files).map((s) => str(s, 300)).filter(Boolean)),
  };
}
export function normBuildRecord(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const id = slug(v.id); if (!id) return null;
  const profile = slug(v.profile) || 'main-framework';
  return {
    $axf: RECORDS.build, key: buildKey(profile, id), id, profile, title: str(v.title, 300), category: str(v.category, 60), status: str(v.status, 20),
    branch: str(v.branch, 200), pr: Number(String(v.pr ?? '').replace(/^#/, '')) || 0, repo: normRepo(v.repo), mergedAt: iso(v.mergedAt), builtAt: iso(v.builtAt), createdAt: iso(v.createdAt),
    model: str(v.model, 40), thinking: str(v.thinking, 40), agent: str(v.agent, 80), session: str(v.session, 120), prompt: str(v.prompt, 120), report: str(v.report, 300),
    features: uniq(list(v.features).map((f) => str(f, 120)).filter(Boolean)),
  };
}
export function normPrompt(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const said = str(v.said ?? v.text, 8000).trim(); if (!said) return null;
  const build = slug(v.build); const index = Number(v.index) || 0;
  const verbatim = v.verbatim !== false && v.mayBeParaphrased !== true;
  return {
    $axf: RECORDS.prompt, id: str(v.id, 120) || promptId(build || 'manual', index), build, profile: slug(v.profile), kind: v.kind === 'addendum' || index > 0 ? 'addendum' : 'origin', index,
    said, at: iso(v.at), source: str(v.source, 20), by: str(v.by, 120), session: str(v.session, 200), link: str(v.link, 500),
    verbatim, mayBeParaphrased: !verbatim, from: str(v.from, 20),
  };
}
/** A build-origin@1 origin → its prompt records (origin first, addenda in order). */
export function promptsFromOrigin(buildId, origin, profile = '') {
  const o = origin && typeof origin === 'object' ? origin : {}; const out = [];
  if (str(o.said).trim()) out.push(normPrompt({ build: buildId, profile, index: 0, kind: 'origin', said: o.said, at: o.at, source: o.source, by: o.by, session: o.session, link: o.link, verbatim: o.verbatim !== false, from: o.from }));
  list(o.addenda).forEach((a, i) => { const p = normPrompt({ build: buildId, profile, index: i + 1, kind: 'addendum', said: a?.said, at: a?.at, source: a?.source, by: a?.by, verbatim: a?.verbatim !== false }); if (p) out.push(p); });
  return out;
}

// ------------------------------------------------------------------ validation (field-named, like ui-review-item@1)

const need = (errors, cond, field, message) => { if (!cond) errors.push({ field, message }); };
export function validateFeature(v) {
  const errors = []; const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  need(errors, str(o.name ?? o.title).trim(), 'name', 'name is missing');
  need(errors, o.status === undefined || normStatus(o.status, '') !== '', 'status', `status must be one of ${STATUSES.join(', ')}`);
  need(errors, o.type === undefined || FEATURE_TYPES.includes(o.type), 'type', `type must be one of ${FEATURE_TYPES.join(', ')}`);
  need(errors, o.repo === undefined || !!normRepo(o.repo), 'repo', 'repo must be a repo id');
  need(errors, o.app || o.plugin || o.repo === 'axhub' || o.type === 'framework-contract' || o.type === 'infra' || o.type === 'docs' || o.type === 'chore', 'app', 'app or plugin is missing (a framework contract, infra, docs or chore feature may have none)');
  for (const k of ['plannedAt', 'mergedAt', 'lastChangedAt', 'lastEditAt', 'createdAt', 'updatedAt']) need(errors, o[k] === undefined || o[k] === '' || iso(o[k]), k, `${k} is not an ISO time`);
  for (const [t, x] of Object.entries(o.liveAt && typeof o.liveAt === 'object' ? o.liveAt : {})) need(errors, iso(typeof x === 'string' ? x : x?.at), `liveAt.${t}`, `liveAt.${t} is not an ISO time`);
  need(errors, o.builds === undefined || (Array.isArray(o.builds) && o.builds.every((b) => (typeof b === 'string' ? slug(b) : slug(b?.id)) && (b?.role === undefined || ROLES.includes(b.role)))), 'builds', `builds must be [{ id, profile, role: ${ROLES.join(' | ')} }]`);
  need(errors, o.prs === undefined || (Array.isArray(o.prs) && o.prs.every((p) => Number(typeof p === 'number' ? p : p?.number) > 0)), 'prs', 'prs must be [{ repo, number, role }]');
  need(errors, o.prompts === undefined || (Array.isArray(o.prompts) && o.prompts.every((p) => str(typeof p === 'string' ? p : p?.id))), 'prompts', 'prompts must be [{ id, passage }]');
  return { ok: !errors.length, errors };
}
export function validateEdit(v) {
  const errors = []; const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  need(errors, str(o.feature ?? o.featureId), 'feature', 'feature (the feature id) is missing');
  need(errors, str(o.summary ?? o.what).trim(), 'summary', 'summary (what changed) is missing');
  need(errors, o.kind === undefined || EDIT_KINDS.includes(o.kind), 'kind', `kind must be one of ${EDIT_KINDS.join(', ')}`);
  need(errors, o.status === undefined || normStatus(o.status, '') !== '', 'status', `status must be one of ${STATUSES.join(', ')}`);
  need(errors, o.build || o.pr || o.commit || o.prompt, 'build', 'an edit names what changed it: build, pr, commit or prompt');
  for (const k of ['at', 'mergedAt', 'createdAt', 'updatedAt']) need(errors, o[k] === undefined || o[k] === '' || iso(o[k]), k, `${k} is not an ISO time`);
  return { ok: !errors.length, errors };
}
export function validatePr(v) {
  const errors = []; const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  need(errors, Number(o.number) > 0, 'number', 'number is missing');
  need(errors, str(o.repo), 'repo', 'repo is missing');
  for (const k of ['createdAt', 'mergedAt', 'closedAt']) need(errors, o[k] === undefined || o[k] === '' || iso(o[k]), k, `${k} is not an ISO time`);
  return { ok: !errors.length, errors };
}
export function validatePrompt(v) {
  const errors = []; const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  need(errors, str(o.said ?? o.text).trim(), 'said', 'said (his words) is missing');
  need(errors, o.at === undefined || o.at === '' || iso(o.at), 'at', 'at is not an ISO time');
  need(errors, o.verbatim !== undefined || o.mayBeParaphrased !== undefined, 'verbatim', 'say whether the words are verbatim (verbatim: true) or may be paraphrased');
  return { ok: !errors.length, errors };
}
export const rejection = (errors) => errors.map((e) => e.message).join('; ');

// ------------------------------------------------------------------ merging never loses a date, a build or a prompt

const earliest = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const latest = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const mergeLive = (a, b) => { const out = { ...a }; for (const [t, x] of Object.entries(b)) { const y = out[t]; if (!y) out[t] = x; else if (y.guessed && !x.guessed) out[t] = x; else if (y.guessed === x.guessed && x.at < y.at) out[t] = x; } return out; };
/** A build ref with no profile is the same build as one with a profile and the same id: fold it in (the profiled one's fields win). */
const foldProfiles = (refs) => { const known = new Set(refs.filter((r) => r.profile).map((r) => r.id)); return refs.filter((r) => r.profile || !known.has(r.id)); };
const unionBy = (a, b, key) => { const m = new Map(); for (const x of [...a, ...b]) { const k = key(x); const prev = m.get(k); m.set(k, prev ? { ...prev, ...Object.fromEntries(Object.entries(x).filter(([, v]) => v !== '' && v !== 'added')) } : x); } return [...m.values()]; };
/**
 * Two copies of one feature → one. `a` is the newer copy (wins text ties); dates: earliest planned, exact beats
 * guessed, earliest live per target; status: the later one on the line; builds / PRs / prompts / edits / files: union.
 */
export function mergeFeature(a, b) {
  const x = normFeature(a); const y = normFeature(b);
  if (!x) return y; if (!y) return x;
  const out = { ...x };
  for (const k of ['description', 'app', 'plugin', 'model', 'thinking', 'agent', 'session', 'mergeCommit']) if (!out[k] && y[k]) out[k] = y[k];
  if (x.type === 'new-feature' && y.type !== 'new-feature') out.type = y.type;
  out.plannedAt = earliest(x.plannedAt, y.plannedAt);
  if (!x.mergedAt || (x.mergedAtGuessed && y.mergedAt && !y.mergedAtGuessed)) { out.mergedAt = y.mergedAt || x.mergedAt; out.mergedAtGuessed = y.mergedAt ? y.mergedAtGuessed : x.mergedAtGuessed; }
  out.liveAt = mergeLive(x.liveAt, y.liveAt); out.firstLiveAt = firstLive(out.liveAt);
  out.lastChangedAt = latest(x.lastChangedAt, y.lastChangedAt); out.lastEditAt = latest(x.lastEditAt, y.lastEditAt);
  out.status = laterStatus(x.status, y.status); out.stalled = x.stalled || y.stalled; out.beingEdited = x.beingEdited || y.beingEdited;
  out.builds = foldProfiles(unionBy(x.builds, y.builds, (r) => `${r.profile}:${r.id}`)); out.prs = unionBy(x.prs, y.prs, (r) => `${r.repo}#${r.number}`); out.prompts = unionBy(x.prompts, y.prompts, (r) => r.id);
  out.commits = uniq([...x.commits, ...y.commits]); out.files = uniq([...x.files, ...y.files]); out.tags = uniq([...x.tags, ...y.tags]); out.edits = uniq([...x.edits, ...y.edits]);
  out.editCount = Math.max(out.edits.length, x.editCount, y.editCount); out.links = { ...y.links, ...x.links };
  out.confidence = x.confidence === 'exact' || y.confidence === 'exact' ? 'exact' : 'guessed'; out.source = x.source === 'live' || y.source === 'live' ? 'live' : x.source;
  out.movedIntoAxf = x.movedIntoAxf || y.movedIntoAxf; out.createdAt = earliest(x.createdAt, y.createdAt); out.updatedAt = latest(x.updatedAt, y.updatedAt); out.rev = Math.max(x.rev, y.rev) + 1;
  return normFeature(out);
}
/** A feature after one of its edits lands or moves: counts, last edit date, being edited, last changed. */
export function applyEdit(feature, edit, now = '') {
  const f = normFeature(feature); const e = normEdit(edit, { now }); if (!f || !e) return f;
  const edits = uniq([...f.edits, e.id]);
  const out = { ...f, edits, editCount: Math.max(edits.length, f.editCount + (f.edits.includes(e.id) ? 0 : 1)), lastEditAt: latest(f.lastEditAt, e.at), lastChangedAt: latest(f.lastChangedAt, e.mergedAt || e.at), updatedAt: iso(now) || f.updatedAt, rev: f.rev + 1 };
  out.beingEdited = isPending(e.status);
  if (e.kind === 'removed' && isCompleted(e.status) && canTransition(f.status, 'removed')) out.status = 'removed';
  if (e.kind === 'restored' && isCompleted(e.status) && f.status === 'removed') out.status = firstLive(f.liveAt) ? 'live' : 'merged';
  return normFeature(out);
}
/** `beingEdited` recomputed from every edit of the feature (an edit that landed or was cancelled no longer counts). */
export function refreshEdits(feature, edits) {
  const f = normFeature(feature); if (!f) return f;
  const mine = list(edits).map((e) => normEdit(e)).filter((e) => e && e.feature === f.id);
  const ids = uniq([...f.edits, ...mine.map((e) => e.id)]);
  return normFeature({ ...f, edits: ids, editCount: ids.length, lastEditAt: mine.map((e) => e.at).sort().pop() || f.lastEditAt, beingEdited: mine.some((e) => isPending(e.status)) });
}
/** Live dates set from the deploy log (deploy-log@1): per target, first successful deploy containing the merge commit. */
export function withLive(feature, deploys, contains) {
  const f = normFeature(feature); if (!f || !f.mergeCommit) return f;
  const live = deployLiveAt(deploys, f.mergeCommit, contains);
  return normFeature({ ...f, liveAt: mergeLive(f.liveAt, live) });
}

// ------------------------------------------------------------------ the ledger document + migration

export function emptyLedger(now = '') { return { $axf: SCHEMA, version: VERSION, since: '', updatedAt: iso(now), repos: clone(REPOS), features: [], edits: [], prs: [], builds: [], prompts: [], deploys: [] }; }
/** Older ledgers (no version = 0) → the current one; nothing is dropped, every record is normalised. */
export const MIGRATIONS = [
  // 0 → 1: the first versioned shape. Features that carried `builds` as id strings or `live` as a plain date get the structured fields.
  (doc) => ({ ...doc, version: 1, features: list(doc.features).map((f) => (f && f.live && !f.liveAt ? { ...f, liveAt: { console: f.live } } : f)) }),
];
export function migrate(doc, now = '') {
  let d = doc && typeof doc === 'object' && !Array.isArray(doc) ? clone(doc) : {};
  let v = Number(d.version) || 0;
  while (v < VERSION) { d = MIGRATIONS[v](d); v = Number(d.version) || v + 1; }
  const out = emptyLedger(now);
  out.since = iso(d.since); out.updatedAt = iso(d.updatedAt) || out.updatedAt; out.repos = { ...out.repos, ...(d.repos && typeof d.repos === 'object' ? d.repos : {}) };
  out.features = list(d.features).map((f) => normFeature(f, { now })).filter(Boolean);
  out.edits = list(d.edits).map((e) => normEdit(e, { now })).filter(Boolean);
  out.prs = list(d.prs).map(normPr).filter(Boolean); out.builds = list(d.builds).map(normBuildRecord).filter(Boolean);
  out.prompts = list(d.prompts).map(normPrompt).filter(Boolean); out.deploys = list(d.deploys).map((x) => normDeploy(x)).filter(Boolean);
  const dates = [...out.features.map((f) => f.plannedAt), ...out.prs.map((p) => p.createdAt), ...out.builds.map((b) => b.createdAt), ...out.prompts.map((p) => p.at)].filter(Boolean).sort();
  if (!out.since && dates.length) out.since = dates[0];
  return out;
}
/** Two ledgers → one (same id = same record, merged). */
export function mergeLedgers(a, b, now = '') {
  const x = migrate(a, now); const y = migrate(b, now);
  const byId = (arr, key = (r) => r.id) => new Map(arr.map((r) => [key(r), r]));
  const fm = byId(x.features); for (const f of y.features) fm.set(f.id, fm.has(f.id) ? mergeFeature(fm.get(f.id), f) : f);
  const em = byId(x.edits); for (const e of y.edits) em.set(e.id, em.has(e.id) ? normEdit({ ...em.get(e.id), ...e, status: laterStatus(em.get(e.id).status, e.status), rev: Math.max(em.get(e.id).rev, e.rev) + 1 }) : e);
  const pm = byId(x.prs, (p) => p.key); for (const p of y.prs) pm.set(p.key, { ...(pm.get(p.key) ?? {}), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length))), features: uniq([...(pm.get(p.key)?.features ?? []), ...p.features]) });
  const bm = byId(x.builds, (b) => b.key); for (const b of y.builds) bm.set(b.key, { ...(bm.get(b.key) ?? {}), ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length))), features: uniq([...(bm.get(b.key)?.features ?? []), ...b.features]) });
  const prm = byId(x.prompts); for (const p of y.prompts) if (!prm.has(p.id) || (!prm.get(p.id).verbatim && p.verbatim)) prm.set(p.id, p);
  const dm = byId(x.deploys); for (const d of y.deploys) dm.set(d.id, d);
  const out = { ...x, features: [...fm.values()], edits: [...em.values()], prs: [...pm.values()], builds: [...bm.values()], prompts: [...prm.values()], deploys: [...dm.values()], since: earliest(x.since, y.since), updatedAt: latest(x.updatedAt, y.updatedAt) };
  return migrate(out, now);
}

// ------------------------------------------------------------------ projections: the grid reads these, on every port

export function normView(v) {
  const o = v && typeof v === 'object' ? v : {};
  const sortBy = SORT_KEYS.includes(o.sort?.by) ? o.sort.by : DEFAULT_VIEW.sort.by;
  return {
    by: GROUPINGS.includes(o.by) ? o.by : DEFAULT_VIEW.by, sort: { by: sortBy, dir: o.sort?.dir === 'asc' ? 'asc' : 'desc' },
    hideCompleted: bool(o.hideCompleted), hidePending: bool(o.hidePending), hideCancelled: bool(o.hideCancelled, true),
    statuses: uniq(list(o.statuses).map((s) => normStatus(s, '')).filter(Boolean)), hasEdits: o.hasEdits === true ? true : o.hasEdits === false ? false : null, beingEdited: bool(o.beingEdited),
    editStatus: normStatus(o.editStatus, ''), search: str(o.search, 200), app: slug(o.app), plugin: slug(o.plugin), type: o.type ? normType(o.type) : '', repo: o.repo ? normRepo(o.repo) : '',
    live: o.live === 'yes' || o.live === 'no' ? o.live : '', from: iso(o.from), to: iso(o.to), hiddenColumns: uniq(list(o.hiddenColumns).map((c) => str(c, 60)).filter(Boolean)), expanded: uniq(list(o.expanded).map((c) => str(c, 200)).filter(Boolean)),
  };
}
const text = (f) => `${f.name}\n${f.description}\n${f.app}\n${f.plugin}\n${f.type}\n${f.tags.join(' ')}\n${f.files.join(' ')}`.toLowerCase();
/**
 * Filter features by a view (status groups, status multi-select, edits, app / plugin / type / repo, live yes/no, date
 * range on the sort date, search across the row, its prompts and its edits). `ctx.prompts` / `ctx.edits` are
 * optional record lists (or Maps by id) the search looks inside.
 */
export function filterFeatures(features, view, ctx = {}) {
  const v = normView(view); const q = v.search.trim().toLowerCase();
  const prompts = ctx.prompts instanceof Map ? ctx.prompts : new Map(list(ctx.prompts).map((p) => [p.id, p]));
  const edits = ctx.edits instanceof Map ? ctx.edits : new Map(list(ctx.edits).map((e) => [e.id, e]));
  return list(features).filter((f) => {
    const g = statusGroup(f.status);
    if (v.hideCompleted && g === 'completed') return false;
    if (v.hidePending && g === 'pending') return false;
    if (v.hideCancelled && g === 'cancelled' && !v.statuses.includes('cancelled')) return false;
    if (v.statuses.length && !v.statuses.includes(f.status)) return false;
    if (v.hasEdits === true && !f.editCount) return false; if (v.hasEdits === false && f.editCount) return false;
    if (v.beingEdited && !f.beingEdited) return false;
    if (v.editStatus && !f.edits.some((id) => edits.get(id)?.status === v.editStatus)) return false;
    if (v.app && f.app !== v.app) return false; if (v.plugin && f.plugin !== v.plugin) return false; if (v.type && f.type !== v.type) return false; if (v.repo && f.repo !== v.repo) return false;
    if (v.live === 'yes' && !f.firstLiveAt) return false; if (v.live === 'no' && f.firstLiveAt) return false;
    const d = sortDate(f, v.sort.by); if (v.from && d && d < v.from) return false; if (v.to && d && d > v.to) return false;
    if (q) {
      if (text(f).includes(q)) return true;
      if (f.prompts.some((p) => (prompts.get(p.id)?.said || p.passage || '').toLowerCase().includes(q))) return true;
      if (f.edits.some((id) => (edits.get(id)?.summary || '').toLowerCase().includes(q))) return true;
      if (f.prs.some((p) => `#${p.number}` === q || String(p.number) === q)) return true;
      if (f.builds.some((b) => b.id.includes(q))) return true;
      return false;
    }
    return true;
  });
}
const sortDate = (f, by) => (by === 'liveAt' ? f.firstLiveAt : by === 'mergedAt' ? f.mergedAt : by === 'plannedAt' ? f.plannedAt : by === 'lastEditAt' ? f.lastEditAt : f.lastChangedAt);
function sortValue(f, by) {
  switch (by) {
    case 'liveAt': case 'mergedAt': case 'plannedAt': case 'lastChangedAt': case 'lastEditAt': return sortDate(f, by);
    case 'editCount': return f.editCount; case 'builds': return f.builds.length; case 'prs': return f.prs.length;
    case 'status': return RANK[f.status]; case 'name': return f.name.toLowerCase(); case 'app': return f.app; case 'plugin': return f.plugin; case 'type': return f.type; case 'repo': return f.repo;
    default: return '';
  }
}
/** Stable sort; empty dates sort last whichever way (a feature with no live date never tops "newest live"). */
export function sortFeatures(features, sort = DEFAULT_VIEW.sort) {
  const by = SORT_KEYS.includes(sort?.by) ? sort.by : 'liveAt'; const dir = sort?.dir === 'asc' ? 1 : -1;
  return list(features).map((f, i) => [f, i]).sort(([a, i], [b, j]) => {
    const x = sortValue(a, by); const y = sortValue(b, by);
    const ex = x === '' || x === undefined; const ey = y === '' || y === undefined;
    if (ex !== ey) return ex ? 1 : -1;
    if (x < y) return -dir; if (x > y) return dir;
    return i - j;
  }).map(([f]) => f);
}
const day = (at) => (at ? at.slice(0, 10) : '');
const groupKeys = (f, by) => {
  switch (by) {
    case 'pr': return f.prs.length ? f.prs.map((p) => `${p.repo}#${p.number}`) : ['no-pr'];
    case 'plugin': return [f.plugin || (f.app ? `app:${f.app}` : 'none')];
    case 'app': return [f.app || (f.plugin ? 'console' : 'framework')];
    case 'type': return [f.type];
    case 'build': return f.builds.length ? f.builds.map((b) => `${b.profile || 'main-framework'}:${b.id}`) : ['no-build'];
    case 'day': return [day(f.firstLiveAt || f.mergedAt || f.lastChangedAt) || 'no-date'];
    case 'repo': return [f.repo];
    default: return ['all'];
  }
};
function groupLabel(key, by, ctx) {
  switch (by) {
    case 'pr': { if (key === 'no-pr') return 'No pull request'; const pr = ctx.prs?.get?.(key); return pr?.title ? `#${pr.number} ${pr.title}` : key.replace(/^amberx-axf/, ''); }
    case 'build': { if (key === 'no-build') return 'No build'; const b = ctx.builds?.get?.(key); return b?.title || key.split(':').pop(); }
    case 'plugin': return key === 'none' ? 'No plugin' : key.startsWith('app:') ? `${key.slice(4)} (app)` : key;
    case 'type': return TYPE_LABEL[key] || key;
    case 'repo': return REPOS[key]?.label || key;
    case 'day': return key === 'no-date' ? 'No date yet' : key;
    case 'flat': return 'All features';
    default: return key;
  }
}
/**
 * Level 1 of the grid: groups of features by the view's `by` (PR default). Each group carries its key, label, the
 * features (sorted by the view's sort), counts by status group, newest live / merged dates, and the record it stands
 * for when the ctx has it (pr / build). Groups are sorted by the same sort as their features (newest first).
 */
export function groupFeatures(features, view, ctx = {}) {
  const v = normView(view);
  const prs = ctx.prs instanceof Map ? ctx.prs : new Map(list(ctx.prs).map((p) => [p.key || prKey(p.repo, p.number), p]));
  const builds = ctx.builds instanceof Map ? ctx.builds : new Map(list(ctx.builds).map((b) => [b.key || buildKey(b.profile, b.id), b]));
  const sorted = sortFeatures(features, v.sort); const m = new Map();
  for (const f of sorted) for (const k of groupKeys(f, v.by)) { if (!m.has(k)) m.set(k, []); m.get(k).push(f); }
  const groups = [...m.entries()].map(([key, fs]) => ({
    key, by: v.by, label: groupLabel(key, v.by, { prs, builds }), count: fs.length, features: fs,
    counts: { pending: fs.filter((f) => statusGroup(f.status) === 'pending').length, completed: fs.filter((f) => statusGroup(f.status) === 'completed').length, cancelled: fs.filter((f) => statusGroup(f.status) === 'cancelled').length, live: fs.filter((f) => f.status === 'live').length, edited: fs.filter((f) => f.editCount > 0).length },
    liveAt: fs.map((f) => f.firstLiveAt).filter(Boolean).sort().pop() || '', mergedAt: fs.map((f) => f.mergedAt).filter(Boolean).sort().pop() || '',
    lastChangedAt: fs.map((f) => f.lastChangedAt).filter(Boolean).sort().pop() || '',
    record: v.by === 'pr' ? prs.get(key) ?? null : v.by === 'build' ? builds.get(key) ?? null : null,
  }));
  const dir = v.sort.dir === 'asc' ? 1 : -1;
  const gv = (g) => (v.sort.by === 'name' || v.sort.by === 'app' || v.sort.by === 'plugin' || v.sort.by === 'type' || v.sort.by === 'repo' ? g.label.toLowerCase() : v.sort.by === 'editCount' ? g.counts.edited : v.sort.by === 'builds' || v.sort.by === 'prs' ? g.count : v.sort.by === 'mergedAt' ? g.mergedAt : v.sort.by === 'liveAt' ? g.liveAt : g.lastChangedAt);
  return groups.map((g, i) => [g, i]).sort(([a, i], [b, j]) => { const x = gv(a); const y = gv(b); const ex = x === '' ; const ey = y === ''; if (ex !== ey) return ex ? 1 : -1; if (x < y) return -dir; if (x > y) return dir; return i - j; }).map(([g]) => g);
}
/** Status chip for a feature or an edit: label + tone token (+ '~' when the date behind it is a guess). */
export function statusChip(rec) {
  const s = normStatus(rec?.status); const guessed = s === 'live' ? Object.values(rec?.liveAt || {}).every((x) => x.guessed) && Object.keys(rec?.liveAt || {}).length > 0 : s === 'merged' ? rec?.mergedAtGuessed === true : false;
  return { status: s, label: `${guessed ? '~' : ''}${STATUS_LABEL[s]}${rec?.stalled ? ' (stalled)' : ''}`, tone: rec?.stalled ? 'warn' : STATUS_TONE[s] };
}
/** 'Edited ×3 · 2026-11-04' / 'Being edited' chip, or null when the feature was never edited. */
export function editedChip(f) {
  if (!f || (!f.editCount && !f.beingEdited)) return null;
  if (f.beingEdited) return { label: `Being edited${f.editCount ? ` · ${f.editCount}` : ''}`, tone: 'info', count: f.editCount, lastEditAt: f.lastEditAt };
  return { label: `Edited ×${f.editCount}${f.lastEditAt ? ` · ${day(f.lastEditAt)}` : ''}`, tone: 'accent', count: f.editCount, lastEditAt: f.lastEditAt };
}
/** Level 3: the "What Brett said" block — prompts of a feature in order, the passage that asked for it marked. */
export function saidBlock(feature, prompts) {
  const pm = prompts instanceof Map ? prompts : new Map(list(prompts).map((p) => [p.id, p]));
  return list(feature?.prompts).map((ref) => {
    const p = pm.get(ref.id); if (!p) return null;
    const passage = ref.passage && p.said.includes(ref.passage) ? ref.passage : '';
    const i = passage ? p.said.indexOf(passage) : -1;
    return { id: p.id, kind: p.kind, index: p.index, at: p.at, source: p.source, verbatim: p.verbatim, mayBeParaphrased: p.mayBeParaphrased, said: p.said, passage, highlight: i >= 0 ? [i, i + passage.length] : null };
  }).filter(Boolean).sort((a, b) => a.index - b.index);
}
/** The columns of the features level, in order; the view hides by id. */
export const COLUMNS = Object.freeze([
  { id: 'name', label: 'Feature', sort: 'name' }, { id: 'status', label: 'Status', sort: 'status' }, { id: 'app', label: 'App', sort: 'app' }, { id: 'plugin', label: 'Plugin', sort: 'plugin' },
  { id: 'type', label: 'Type', sort: 'type' }, { id: 'repo', label: 'Repo', sort: 'repo' }, { id: 'prs', label: 'PR', sort: 'prs' }, { id: 'builds', label: 'Builds', sort: 'builds' },
  { id: 'mergedAt', label: 'Merged', sort: 'mergedAt' }, { id: 'liveAt', label: 'Live', sort: 'liveAt' }, { id: 'lastChangedAt', label: 'Last changed', sort: 'lastChangedAt' },
  { id: 'edits', label: 'Edits', sort: 'editCount' }, { id: 'lastEditAt', label: 'Last edited', sort: 'lastEditAt' }, { id: 'model', label: 'Model' }, { id: 'agent', label: 'Agent' }, { id: 'session', label: 'Session' },
]);
/** Rows for CSV / Markdown export (strings only, '~' on guessed dates). */
export function exportRows(features, { columns = COLUMNS.map((c) => c.id) } = {}) {
  const cell = (f, c) => {
    switch (c) {
      case 'status': return statusChip(f).label; case 'prs': return f.prs.map((p) => `${p.repo === 'amberx-axf' ? '' : p.repo}#${p.number}`).join(' ');
      case 'builds': return f.builds.map((b) => b.id).join(' '); case 'mergedAt': return dateMark(f.mergedAt, f.mergedAtGuessed);
      case 'liveAt': return Object.entries(f.liveAt).map(([t, x]) => `${t}: ${dateMark(x.at, x.guessed)}`).join(' '); case 'edits': return String(f.editCount);
      case 'type': return TYPE_LABEL[f.type] || f.type; default: return str(f[c]);
    }
  };
  return { columns, rows: list(features).map((f) => columns.map((c) => cell(f, c))) };
}
export function toCsv({ columns, rows }) { const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s); return [columns.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n'); }
export function toMarkdown({ columns, rows }) { const esc = (s) => s.replace(/\|/g, '\\|'); return [`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n'); }

// ------------------------------------------------------------------ registry + JSON Schemas (snapshots: schemas/feature-ledger.json, schemas/json/*)

export const REGISTRY = Object.freeze({
  schema: SCHEMA, version: VERSION, records: RECORDS, statuses: STATUSES, pending: PENDING_STATUSES, completed: COMPLETED_STATUSES, ended: ENDED_STATUSES, statusLabel: STATUS_LABEL, statusTone: STATUS_TONE,
  events: EVENTS, eventTo: EVENT_TO, featureTypes: FEATURE_TYPES, typeLabel: TYPE_LABEL, roles: ROLES, editKinds: EDIT_KINDS, repos: REPOS, sources: SOURCES,
  groupings: GROUPINGS, groupingLabel: GROUPING_LABEL, sortKeys: SORT_KEYS, defaultView: DEFAULT_VIEW, columns: COLUMNS, deployTargets: Object.keys(DEPLOY_TARGETS),
});
const S = 'https://json-schema.org/draft/2020-12/schema'; const ID = (n) => `https://amberx.ai/axf/schemas/${n}`;
const isoProp = { type: 'string' }; const strArr = { type: 'array', items: { type: 'string' } };
const liveProp = { type: 'object', additionalProperties: { type: 'object', required: ['at'], properties: { at: isoProp, guessed: { type: 'boolean' }, deploy: { type: 'string' } } } };
export function jsonSchemas() {
  return {
    'feature.schema.json': {
      $schema: S, $id: ID('feature.schema.json'), title: 'feature@1 (feature-ledger@1)', type: 'object', additionalProperties: false, required: ['name', 'status'],
      properties: {
        $axf: { const: RECORDS.feature }, id: { type: 'string' }, name: { type: 'string', minLength: 1 }, description: { type: 'string' }, type: { enum: FEATURE_TYPES }, app: { type: 'string' }, plugin: { type: 'string' },
        repo: { type: 'string' }, originRepo: { type: 'string' }, movedIntoAxf: { type: 'boolean' }, status: { enum: STATUSES }, stalled: { type: 'boolean' },
        plannedAt: isoProp, mergedAt: isoProp, mergedAtGuessed: { type: 'boolean' }, liveAt: liveProp, firstLiveAt: isoProp, lastChangedAt: isoProp,
        builds: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, profile: { type: 'string' }, role: { enum: ROLES } } } },
        prs: { type: 'array', items: { type: 'object', required: ['number'], properties: { repo: { type: 'string' }, number: { type: 'integer', minimum: 1 }, role: { enum: ROLES } } } },
        commits: strArr, mergeCommit: { type: 'string' }, prompts: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, passage: { type: 'string' } } } },
        model: { type: 'string' }, thinking: { type: 'string' }, agent: { type: 'string' }, session: { type: 'string' }, files: strArr, links: { type: 'object', additionalProperties: { type: 'string' } },
        edits: strArr, editCount: { type: 'integer', minimum: 0 }, lastEditAt: isoProp, beingEdited: { type: 'boolean' }, tags: strArr, source: { enum: SOURCES }, confidence: { enum: ['exact', 'guessed'] },
        createdAt: isoProp, updatedAt: isoProp, rev: { type: 'integer', minimum: 1 },
      },
    },
    'feature-edit.schema.json': {
      $schema: S, $id: ID('feature-edit.schema.json'), title: 'feature-edit@1 (feature-ledger@1)', type: 'object', additionalProperties: false, required: ['feature', 'summary'],
      properties: {
        $axf: { const: RECORDS.edit }, id: { type: 'string' }, feature: { type: 'string', minLength: 1 }, kind: { enum: EDIT_KINDS }, summary: { type: 'string', minLength: 1 },
        build: { type: 'string' }, profile: { type: 'string' }, pr: { type: 'integer', minimum: 0 }, repo: { type: 'string' }, commit: { type: 'string' }, prompt: { type: 'string' }, passage: { type: 'string' },
        model: { type: 'string' }, agent: { type: 'string' }, session: { type: 'string' }, status: { enum: STATUSES }, at: isoProp, mergedAt: isoProp, liveAt: liveProp, files: strArr,
        source: { enum: SOURCES }, createdAt: isoProp, updatedAt: isoProp, rev: { type: 'integer', minimum: 1 },
      },
    },
    'ledger-pr.schema.json': {
      $schema: S, $id: ID('ledger-pr.schema.json'), title: 'ledger-pr@1 (feature-ledger@1)', type: 'object', additionalProperties: false, required: ['repo', 'number'],
      properties: { $axf: { const: RECORDS.pr }, key: { type: 'string' }, repo: { type: 'string' }, number: { type: 'integer', minimum: 1 }, title: { type: 'string' }, body: { type: 'string' }, branch: { type: 'string' }, author: { type: 'string' }, url: { type: 'string' }, createdAt: isoProp, mergedAt: isoProp, mergeCommit: { type: 'string' }, closedAt: isoProp, state: { enum: ['open', 'merged', 'closed'] }, build: { type: 'string' }, profile: { type: 'string' }, features: strArr, files: strArr },
    },
    'ledger-build.schema.json': {
      $schema: S, $id: ID('ledger-build.schema.json'), title: 'ledger-build@1 (feature-ledger@1)', type: 'object', additionalProperties: false, required: ['id'],
      properties: { $axf: { const: RECORDS.build }, key: { type: 'string' }, id: { type: 'string' }, profile: { type: 'string' }, title: { type: 'string' }, category: { type: 'string' }, status: { type: 'string' }, branch: { type: 'string' }, pr: { type: 'integer', minimum: 0 }, repo: { type: 'string' }, mergedAt: isoProp, builtAt: isoProp, createdAt: isoProp, model: { type: 'string' }, thinking: { type: 'string' }, agent: { type: 'string' }, session: { type: 'string' }, prompt: { type: 'string' }, report: { type: 'string' }, features: strArr },
    },
    'prompt.schema.json': {
      $schema: S, $id: ID('prompt.schema.json'), title: 'prompt@1 (feature-ledger@1): what Brett said', type: 'object', additionalProperties: false, required: ['said', 'verbatim'],
      properties: { $axf: { const: RECORDS.prompt }, id: { type: 'string' }, build: { type: 'string' }, profile: { type: 'string' }, kind: { enum: ['origin', 'addendum'] }, index: { type: 'integer', minimum: 0 }, said: { type: 'string', minLength: 1 }, at: isoProp, source: { type: 'string' }, by: { type: 'string' }, session: { type: 'string' }, link: { type: 'string' }, verbatim: { type: 'boolean' }, mayBeParaphrased: { type: 'boolean' }, from: { type: 'string' } },
    },
  };
}
