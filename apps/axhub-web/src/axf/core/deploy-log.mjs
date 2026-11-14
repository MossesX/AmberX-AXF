/**
 * deploy-log@1 — what got deployed where, and when (pure, IO-free).
 *
 * Brett, Nov 4 2026 (voice): "Where's the list of features that can be sorted, and when they went live?"
 * Nothing recorded when a change actually went live, only when a build finished. Every deploy script now appends
 * one record to the deploy log on the data volume (`<data>/deploys/log.jsonl`, one JSON object per line):
 *
 *   deploy@1 = {
 *     id:      'd-<target>-<unix seconds>-<sha7>'          stable for one deploy
 *     target:  console | site | axhub | axhub-web | amberx | molly | walkthrough | expenses | apk:<app> | maven | <own id>
 *     sha:     the commit now live on that target (full or short sha)
 *     from:    the commit it replaced ('' on a first install)
 *     at:      when (ISO, UTC)
 *     who:     what deployed it: install | update | ci | manual | rollback | <free text>
 *     host:    machine name, if known
 *     kind:    deploy | rollback | publish
 *     state:   done | failed                                 a failed deploy is logged too (it never makes a feature live)
 *     version: app / APK version when there is one
 *     note:    free text
 *     guessed: true when the time was reconstructed afterwards (backfill), shown as '~' in every date
 *   }
 *
 * A feature is live on a target when that target's deployed commit contains the feature's merge commit. Ancestry is
 * git's business: the host passes `contains(deploySha, mergeSha)` and this module only picks the first such deploy.
 * The ledger (feature-ledger@1) imports this shape rather than defining its own.
 */

export const SCHEMA = 'deploy-log@1';
export const RECORD = 'deploy@1';
export const VERSION = 1;
export const KINDS = ['deploy', 'rollback', 'publish'];
export const STATES = ['done', 'failed'];
/** Targets every port knows. A target not listed here is still accepted (own ids: lowercase, digits, dash, one optional `:` part). */
export const TARGETS = {
  console: { label: 'Dev Console', url: 'https://console.amberxai.com', repo: 'amberx-axf' },
  site: { label: 'Demo site', url: 'https://axf.amberxai.com', repo: 'amberx-axf' },
  axhub: { label: 'axHub', url: 'https://axhub.amberxai.com', repo: 'axhub' },
  'axhub-web': { label: 'axHub web', url: 'https://axhub.amberxai.com', repo: 'amberx-axf' },
  amberx: { label: 'AmberX', url: 'https://amberx.amberxai.com', repo: 'amberx-axf' },
  molly: { label: 'Molly', url: 'https://molly.amberxai.com', repo: 'amberx-axf' },
  walkthrough: { label: 'Walkthrough Studio', url: 'https://walkthrough.amberxai.com', repo: 'amberx-axf' },
  expenses: { label: 'Expense Tracker', url: 'https://expenses.amberxai.com', repo: 'amberx-axf' },
  'apk:amberx': { label: 'AmberX APK', url: '', repo: 'amberx-axf' },
  'apk:console': { label: 'Console APK', url: '', repo: 'amberx-axf' },
  maven: { label: 'Maven packages', url: '', repo: 'amberx-axf' },
};
export const TARGET_RE = /^[a-z0-9][a-z0-9-]{0,39}(:[a-z0-9][a-z0-9-]{0,39})?$/;
export const SHA_RE = /^[0-9a-f]{7,40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
/** An ISO time as given; one with a UTC offset is folded to `Z`, so deploys from any host sort as text. */
export const iso = (v) => {
  const s = str(v, 40).trim(); if (!ISO.test(s)) return '';
  if (!/[+-]\d{2}:\d{2}$/.test(s)) return s;
  const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().replace('.000Z', 'Z') : '';
};
/** A target name folded to its id ('Console' → 'console', 'APK amberx' → 'apk:amberx'); '' when it can't be one. */
export function normTarget(v) {
  let s = str(v, 80).trim().toLowerCase().replace(/\s+/g, '-');
  const m = /^apk[-:]?(.*)$/.exec(s); if (m && m[1]) s = `apk:${m[1].replace(/^[-:]+/, '')}`;
  return TARGET_RE.test(s) ? s : '';
}
export const normSha = (v) => { const s = str(v, 40).trim().toLowerCase(); return SHA_RE.test(s) ? s : ''; };
/** Two shas name the same commit when one is a prefix of the other (7+ chars). */
export const sameSha = (a, b) => { const x = normSha(a); const y = normSha(b); return !!x && !!y && (x.startsWith(y) || y.startsWith(x)); };
export const deployId = (target, at, sha) => `d-${target.replace(':', '-')}-${Math.floor(new Date(at || 0).getTime() / 1000) || 0}-${normSha(sha).slice(0, 7) || 'nosha'}`;

/** deploy@1 in shape (unknown fields dropped, every field present), or null when there is no target and no sha. */
export function normDeploy(v, { now = '' } = {}) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const target = normTarget(v.target); const sha = normSha(v.sha ?? v.commit);
  if (!target && !sha) return null;
  const at = iso(v.at ?? v.time ?? v.deployedAt) || (typeof v.at === 'number' && Number.isFinite(v.at) ? new Date(v.at * (v.at < 1e12 ? 1000 : 1)).toISOString() : '') || iso(now);
  const d = {
    $axf: RECORD,
    id: str(v.id, 120) || deployId(target || 'unknown', at, sha),
    target, sha, from: normSha(v.from ?? v.previous),
    at, who: str(v.who ?? v.by, 120), host: str(v.host, 120),
    kind: KINDS.includes(v.kind) ? v.kind : 'deploy',
    state: STATES.includes(v.state) ? v.state : v.ok === false || v.state === 'fail' ? 'failed' : 'done',
    version: str(v.version, 60), note: str(v.note, 1000), guessed: v.guessed === true,
  };
  return d;
}

/** Field-named errors; `ok` only when the record would be accepted by every port. */
export function validateDeploy(v) {
  const errors = [];
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  if (!normTarget(o.target)) errors.push({ field: 'target', message: `target is missing or not a target id (${Object.keys(TARGETS).slice(0, 4).join(', ')}, … or lowercase-dash)` });
  if (!normSha(o.sha ?? o.commit)) errors.push({ field: 'sha', message: 'sha is missing or not a git commit sha (7-40 hex)' });
  if (!iso(o.at)) errors.push({ field: 'at', message: 'at is missing or not an ISO time' });
  if (o.from !== undefined && o.from !== '' && !normSha(o.from)) errors.push({ field: 'from', message: 'from is not a git commit sha' });
  if (o.kind !== undefined && !KINDS.includes(o.kind)) errors.push({ field: 'kind', message: `kind must be one of ${KINDS.join(', ')}` });
  if (o.state !== undefined && !STATES.includes(o.state)) errors.push({ field: 'state', message: `state must be one of ${STATES.join(', ')}` });
  return { ok: !errors.length, errors };
}
export const rejection = (errors) => errors.map((e) => e.message).join('; ');

/** JSONL text → deploy records (bad lines skipped, counted). */
export function parseLog(text) {
  const records = []; let skipped = 0;
  for (const line of str(text, 50_000_000).split('\n')) {
    const t = line.trim(); if (!t) continue;
    try { const d = normDeploy(JSON.parse(t)); if (d && d.target && d.sha) records.push(d); else skipped++; } catch { skipped++; }
  }
  return { records: sortDeploys(records), skipped };
}
export const toLine = (d) => JSON.stringify(normDeploy(d));
/** Oldest first; ties keep input order. Raw objects are normalised on the way (bad ones dropped). */
export const sortDeploys = (records) => (Array.isArray(records) ? records : []).map((d) => normDeploy(d)).filter((d) => d && d.target && d.sha).map((d, i) => [d, i]).sort((a, b) => (a[0].at < b[0].at ? -1 : a[0].at > b[0].at ? 1 : a[1] - b[1])).map((x) => x[0]);
/** Two logs → one (same id = same deploy; the later line wins). */
export function mergeLogs(a, b) {
  const m = new Map(); for (const d of [...a, ...b]) { const x = normDeploy(d); if (x) m.set(x.id, x); }
  return sortDeploys([...m.values()]);
}
/** The newest successful deploy per target. */
export function latestPerTarget(records) {
  const out = {};
  for (const d of sortDeploys(records)) if (d.state === 'done') out[d.target] = d;
  return out;
}
/** Every target the log knows, listed ones first. */
export const targetsIn = (records) => { const rs = sortDeploys(records); return [...new Set([...Object.keys(TARGETS).filter((t) => rs.some((d) => d.target === t)), ...rs.map((d) => d.target)])]; };

/**
 * The first successful deploy on `target` whose commit contains `mergeSha`, by `contains(deploySha, mergeSha)` (git
 * ancestry, supplied by the host; a Map of 'deploySha|mergeSha' → bool also works). Null when it is not live there.
 */
export function firstContaining(records, target, mergeSha, contains) {
  const ms = normSha(mergeSha); if (!ms) return null;
  const test = typeof contains === 'function' ? contains : (d, m) => contains?.get?.(`${d}|${m}`) === true || sameSha(d, m);
  for (const d of sortDeploys(records)) {
    if (d.target !== target || d.state !== 'done') continue;
    if (sameSha(d.sha, ms) || test(d.sha, ms)) return d;
  }
  return null;
}
/** { target: { at, guessed, deploy } } for every target the merge commit reached. */
export function liveAt(records, mergeSha, contains) {
  const out = {};
  for (const t of targetsIn(records)) { const d = firstContaining(records, t, mergeSha, contains); if (d) out[t] = { at: d.at, guessed: d.guessed, deploy: d.id }; }
  return out;
}
/** The earliest live time across targets ('' when not live anywhere). */
export const firstLive = (live) => Object.values(live || {}).map((x) => x.at).filter(Boolean).sort()[0] || '';
/** '2026-11-03T10:00Z' + guessed → '~2026-11-03T10:00Z'. */
export const dateMark = (at, guessed) => (at ? `${guessed ? '~' : ''}${at}` : '');

export const REGISTRY = Object.freeze({ schema: SCHEMA, record: RECORD, version: VERSION, kinds: KINDS, states: STATES, targets: TARGETS, targetPattern: TARGET_RE.source, shaPattern: SHA_RE.source });

export function jsonSchemas() {
  return {
    'deploy.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://amberx.ai/axf/schemas/deploy.schema.json',
      title: 'deploy@1 (deploy-log@1 record)', type: 'object', additionalProperties: false,
      required: ['target', 'sha', 'at'],
      properties: {
        $axf: { const: RECORD }, id: { type: 'string' }, target: { type: 'string', pattern: TARGET_RE.source }, sha: { type: 'string', pattern: SHA_RE.source },
        from: { type: 'string' }, at: { type: 'string', format: 'date-time' }, who: { type: 'string' }, host: { type: 'string' },
        kind: { enum: KINDS }, state: { enum: STATES }, version: { type: 'string' }, note: { type: 'string' }, guessed: { type: 'boolean' },
      },
    },
  };
}
