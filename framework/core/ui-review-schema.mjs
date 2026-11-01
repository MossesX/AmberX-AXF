/**
 * ui-review-item@1 + ui-review-group@1 — the one schema for everything that goes into UI Review (the approve/reject
 * queue AND Screenshots), from any source: Claude chat or voice, Claude Code, headless builds, agents, the console,
 * plugins, manual uploads, Watch live. Brett, Nov 1 2026: "anything that goes into UI Review must have a NAME and a
 * TIMESTAMP and conform to ONE schema. No exceptions."
 *
 * Pure and dependency-free (no DOM, no Node APIs), so the console page, the review.mjs / shot.mjs CLIs, rebuild-shots,
 * the build hooks and the tests all run the same checks. The console plugin providing ui-review@1 mirrors it in Python
 * on its server from framework/schemas/ui-review.json, which `axf schemas` writes from REGISTRY below (and
 * framework/spec/check-ui-review.mjs keeps in step). Fixtures: framework/spec/fixtures/ui-review-item.json.
 *
 * The only defaults an intake path may fill are createdAt = now and, when the caller can't ask Brett for a group
 * name, an automatic group named "<source or session> - <YYYY-MM-DD HH:mm>". Everything else missing is rejected
 * with a message naming the field.
 */

export const ITEM_TAG = 'ui-review-item@1';
export const GROUP_TAG = 'ui-review-group@1';

export const REGISTRY = {
  $id: 'axf/ui-review',
  item: ITEM_TAG,
  group: GROUP_TAG,
  kinds: ['review', 'screenshot'],
  sources: ['claude-chat', 'claude-voice', 'claude-code', 'headless', 'agent', 'console', 'plugin', 'manual', 'watch-live'],
  statuses: ['pending', 'approved', 'rejected', 'changes'],
  /** Older names still accepted on intake and rewritten (never stored). */
  statusAliases: { waiting: 'pending' },
  submitterTypes: ['session', 'build', 'agent', 'user'],
  viewports: ['phone', 'desktop', 'tablet', 'mixed'],
  idPattern: '^[a-z0-9][a-z0-9:._-]{0,80}$',
  sectionPattern: '^[a-z0-9][a-z0-9-]{0,40}$',
  maxName: 200,
  maxFiles: 60,
  itemRequired: ['$axf', 'id', 'name', 'group', 'createdAt', 'kind', 'source', 'submittedBy', 'app', 'screen', 'viewport', 'files'],
  /** Required only on review items (kind review). */
  reviewRequired: ['status'],
  groupRequired: ['$axf', 'id', 'name', 'createdAt', 'source'],
  itemOptional: ['note', 'pr', 'branch', 'build', 'section', 'comment', 'history', 'updatedAt', 'pairId'],
  groupOptional: ['submittedBy', 'app', 'note', 'build', 'session', 'updatedAt'],
};

const ID_RE = new RegExp(REGISTRY.idPattern);
const SECTION_RE = new RegExp(REGISTRY.sectionPattern);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const FILE_NAME_RE = /\.(png|jpe?g|webp|gif)$/i;
const SLUG_ID_RE = /^[a-z0-9]+(?:[-_.:][a-z0-9]+)+$/;
const IMG_SRC_RE = /^[^\0\n\r]{1,300}$/;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export const isId = (v) => typeof v === 'string' && ID_RE.test(v);
export const isTimestamp = (v) => typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Why a name is not a human name, or '' when it is. A human name has a letter in it and is not a file name, an id,
 * or a bare slug with digits ("r-20261101-ab12").
 */
export function nameProblem(name, id) {
  if (typeof name !== 'string' || !name.trim()) return 'missing';
  const n = name.trim();
  if (n.length > REGISTRY.maxName) return `longer than ${REGISTRY.maxName} characters`;
  if (!/\p{L}/u.test(n)) return 'has no letters (give it a human name)';
  if (FILE_NAME_RE.test(n)) return 'is a file name (give it a human name)';
  if (id && n === id) return 'is the id (give it a human name)';
  if (SLUG_ID_RE.test(n) && /\d/.test(n)) return 'looks like an id (give it a human name)';
  return '';
}

const HINTS = {
  name: 'every UI Review item needs a human name, e.g. "Breakroom phone check"',
  createdAt: 'an ISO timestamp, e.g. 2026-11-01T08:20:00Z',
  group: 'a group { id, name } (ask Brett for its name, or let the intake make "<source> - <date time>")',
  kind: `one of ${REGISTRY.kinds.join(', ')}`,
  source: `one of ${REGISTRY.sources.join(', ')}`,
  submittedBy: `{ type: ${REGISTRY.submitterTypes.join('|')}, id } — the session, build, agent or user sending it`,
  app: 'the app the UI belongs to, e.g. "Console"',
  screen: 'the screen or route shown, e.g. "Breakroom" or "/settings/plugins"',
  viewport: `one of ${REGISTRY.viewports.join(', ')}`,
  files: '{ before: [...], after: [...] } with at least one screenshot',
  status: `one of ${REGISTRY.statuses.join(', ')} (review items)`,
};

const err = (field, code, message) => ({ field, code, message });
const missingErr = (field) => err(field, 'missing', `${field} is missing — ${HINTS[field] ?? 'required'}`);
const badErr = (field, why) => err(field, 'invalid', `${field} ${why}${HINTS[field] ? ` — ${HINTS[field]}` : ''}`);

function fileErrors(list, where) {
  const out = [];
  if (!Array.isArray(list)) { out.push(badErr(`files.${where}`, 'must be a list')); return out; }
  list.forEach((f, i) => {
    const at = `files.${where}[${i}]`;
    if (!isObj(f)) { out.push(badErr(at, 'must be { src, name?, viewport? }')); return; }
    if (blank(f.src) || typeof f.src !== 'string' || !IMG_SRC_RE.test(f.src)) out.push(err(`${at}.src`, blank(f.src) ? 'missing' : 'invalid', `${at}.src ${blank(f.src) ? 'is missing' : 'is not a file path'}`));
    if (f.viewport !== undefined && !REGISTRY.viewports.includes(f.viewport)) out.push(badErr(`${at}.viewport`, `"${f.viewport}" is not a viewport`));
  });
  return out;
}

/** Group check (ui-review-group@1, or the { id, name } reference an item carries when `ref` is true). */
export function validateGroup(g, { ref = false } = {}) {
  const errors = [];
  if (!isObj(g)) return { ok: false, errors: [missingErr('group')] };
  const p = ref ? 'group.' : '';
  if (!ref && g.$axf !== GROUP_TAG) errors.push(g.$axf === undefined ? err('$axf', 'missing', `$axf is missing — "${GROUP_TAG}"`) : badErr('$axf', `must be "${GROUP_TAG}"`));
  if (blank(g.id)) errors.push(err(`${p}id`, 'missing', `${p}id is missing — the group needs an id`));
  else if (!isId(g.id)) errors.push(badErr(`${p}id`, `"${g.id}" must be lowercase letters, digits and - _ . :`));
  const np = nameProblem(g.name, g.id);
  if (np === 'missing') errors.push(err(`${p}name`, 'missing', `${p}name is missing — every group needs a human name, e.g. "Breakroom check - Oct 31 8:20 PM"`));
  else if (np) errors.push(badErr(`${p}name`, np));
  if (!ref) {
    if (blank(g.createdAt)) errors.push(missingErr('createdAt'));
    else if (!isTimestamp(g.createdAt)) errors.push(badErr('createdAt', `"${g.createdAt}" is not an ISO timestamp`));
    if (blank(g.source)) errors.push(missingErr('source'));
    else if (!REGISTRY.sources.includes(g.source)) errors.push(badErr('source', `"${g.source}" is not a source`));
  }
  return { ok: !errors.length, errors };
}

/** Full item check. Returns { ok, errors: [{ field, code: missing|invalid, message }] }. */
export function validateItem(it) {
  if (!isObj(it)) return { ok: false, errors: [err('item', 'invalid', 'the item must be a JSON object')] };
  const errors = [];
  if (it.$axf !== ITEM_TAG) errors.push(it.$axf === undefined ? err('$axf', 'missing', `$axf is missing — "${ITEM_TAG}"`) : badErr('$axf', `must be "${ITEM_TAG}"`));
  if (blank(it.id)) errors.push(err('id', 'missing', 'id is missing'));
  else if (!isId(it.id)) errors.push(badErr('id', `"${it.id}" must be lowercase letters, digits and - _ . :`));
  const np = nameProblem(it.name, it.id);
  if (np === 'missing') errors.push(missingErr('name')); else if (np) errors.push(badErr('name', np));
  if (it.group === undefined || it.group === null) errors.push(missingErr('group')); else errors.push(...validateGroup(it.group, { ref: true }).errors);
  if (blank(it.createdAt)) errors.push(missingErr('createdAt'));
  else if (!isTimestamp(it.createdAt)) errors.push(badErr('createdAt', `"${it.createdAt}" is not an ISO timestamp`));
  if (blank(it.kind)) errors.push(missingErr('kind')); else if (!REGISTRY.kinds.includes(it.kind)) errors.push(badErr('kind', `"${it.kind}" is not a kind`));
  if (blank(it.source)) errors.push(missingErr('source')); else if (!REGISTRY.sources.includes(it.source)) errors.push(badErr('source', `"${it.source}" is not a source`));
  if (it.submittedBy === undefined || it.submittedBy === null || it.submittedBy === '') errors.push(missingErr('submittedBy'));
  else if (!isObj(it.submittedBy)) errors.push(badErr('submittedBy', 'must be an object'));
  else {
    if (!REGISTRY.submitterTypes.includes(it.submittedBy.type)) errors.push(err('submittedBy.type', blank(it.submittedBy.type) ? 'missing' : 'invalid', `submittedBy.type ${blank(it.submittedBy.type) ? 'is missing' : `"${it.submittedBy.type}" is not a submitter type`} — one of ${REGISTRY.submitterTypes.join(', ')}`));
    if (blank(it.submittedBy.id) || typeof it.submittedBy.id !== 'string') errors.push(err('submittedBy.id', 'missing', 'submittedBy.id is missing — which session, build, agent or user sent it'));
  }
  for (const f of ['app', 'screen']) { if (blank(it[f])) errors.push(missingErr(f)); else if (typeof it[f] !== 'string') errors.push(badErr(f, 'must be text')); }
  if (blank(it.viewport)) errors.push(missingErr('viewport')); else if (!REGISTRY.viewports.includes(it.viewport)) errors.push(badErr('viewport', `"${it.viewport}" is not a viewport`));
  if (it.files === undefined || it.files === null) errors.push(missingErr('files'));
  else if (!isObj(it.files)) errors.push(badErr('files', 'must be { before: [...], after: [...] }'));
  else {
    const fe = [...fileErrors(it.files.before ?? [], 'before'), ...fileErrors(it.files.after ?? [], 'after')];
    errors.push(...fe);
    const n = (Array.isArray(it.files.before) ? it.files.before.length : 0) + (Array.isArray(it.files.after) ? it.files.after.length : 0);
    if (!fe.length && n === 0) errors.push(err('files', 'missing', `files has no screenshots — ${HINTS.files}`));
    if (n > REGISTRY.maxFiles) errors.push(badErr('files', `has ${n} screenshots (at most ${REGISTRY.maxFiles})`));
  }
  if (it.kind === 'review') { if (blank(it.status)) errors.push(missingErr('status')); else if (!REGISTRY.statuses.includes(it.status)) errors.push(badErr('status', `"${it.status}" is not a status`)); }
  else if (it.kind === 'screenshot' && it.status !== undefined) errors.push(badErr('status', 'is only for review items (screenshots are never approved or rejected)'));
  if (it.pr !== undefined && it.pr !== null && !(Number.isInteger(it.pr) && it.pr > 0)) errors.push(badErr('pr', 'must be a PR number'));
  if (it.section !== undefined && it.section !== '' && !(typeof it.section === 'string' && SECTION_RE.test(it.section))) errors.push(badErr('section', 'must be lowercase letters, digits and dashes'));
  if (it.build !== undefined && it.build !== null && !isObj(it.build)) errors.push(badErr('build', 'must be { id, step? }'));
  if (it.updatedAt !== undefined && it.updatedAt !== '' && !isTimestamp(it.updatedAt)) errors.push(badErr('updatedAt', `"${it.updatedAt}" is not an ISO timestamp`));
  for (const f of ['note', 'branch', 'comment', 'pairId']) if (it[f] !== undefined && it[f] !== null && typeof it[f] !== 'string') errors.push(badErr(f, 'must be text'));
  return { ok: !errors.length, errors };
}

/** One readable line for a rejection: "ui-review-item@1 rejected: name is missing — …; createdAt is missing — …". */
export const rejection = (errors, tag = ITEM_TAG) => `${tag} rejected: ${errors.map((e) => e.message).join('; ')}`;

export class UiReviewSchemaError extends Error {
  constructor(errors, tag = ITEM_TAG) { super(rejection(errors, tag)); this.name = 'UiReviewSchemaError'; this.errors = errors; this.fields = errors.map((e) => e.field); }
}

/** Throws UiReviewSchemaError unless the item conforms; returns it otherwise. */
export function assertItem(it) { const v = validateItem(it); if (!v.ok) throw new UiReviewSchemaError(v.errors); return it; }
export function assertGroup(g) { const v = validateGroup(g); if (!v.ok) throw new UiReviewSchemaError(v.errors, GROUP_TAG); return g; }

/* ------------------------------------------------------------------ groups */

const pad = (n) => String(n).padStart(2, '0');
/** "2026-11-01 08:20" (UTC) for a timestamp. */
export function stamp(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
export const slug = (s, n = 48) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '') || 'group';
/** Group id from its name and day: the same name on the same day is the same group. */
export const groupId = (name, iso) => `g-${String(iso).slice(0, 10).replace(/-/g, '')}-${slug(name)}`;

/** The automatic group name when nobody could ask Brett: "<source or session> - <YYYY-MM-DD HH:mm>". */
export function autoGroupName({ source = '', session = '', now }) {
  const who = str(session, 80) || str(source, 40) || 'UI Review';
  return `${who} - ${stamp(now)}`;
}

/** A full ui-review-group@1 for a name (or the automatic one). */
export function makeGroup({ name, now, source, submittedBy, app, note, build, session }) {
  const n = str(name, REGISTRY.maxName) || autoGroupName({ source, session, now });
  const g = { $axf: GROUP_TAG, id: groupId(n, now), name: n, createdAt: now, source };
  if (submittedBy) g.submittedBy = submittedBy;
  if (app) g.app = app;
  if (note) g.note = note;
  if (build) g.build = build;
  if (session) g.session = session;
  return g;
}

/* ------------------------------------------------------------------ intake */

/** "build:claude/x" → { type: 'build', id: 'claude/x' }; objects pass through; '' stays missing. */
export function parseSubmitter(v) {
  if (isObj(v)) return { ...v, type: str(v.type, 20), id: str(v.id, 120) };
  const s = str(v, 160);
  if (!s) return undefined;
  const m = /^(session|build|agent|user):(.+)$/.exec(s);
  return m ? { type: m[1], id: m[2].trim() } : { type: '', id: s };
}

const fileOf = (f) => (typeof f === 'string' ? { src: f } : isObj(f) ? { ...f } : f);
/** Viewport of a set of files, when every file says it (phone + desktop = mixed). '' when unknown. */
export function viewportOf(files) {
  const v = new Set([...(files.before ?? []), ...(files.after ?? [])].map((f) => f?.viewport).filter(Boolean));
  if (!v.size) return '';
  return v.size === 1 ? [...v][0] : 'mixed';
}

/**
 * The one intake step every path runs: take a caller's fields, apply only the allowed defaults, validate.
 *   raw: the item as sent (name, group as a string name or { id, name }, files { before, after } or a flat list …)
 *   opts.now: the intake time (createdAt default) · opts.autoGroup: true when the caller can't ask Brett for a group
 *   name (headless, agents, CLIs without --group) · opts.session: label for the automatic group name
 * Returns { item, group, errors, ok }. `group` is the full ui-review-group@1 for the item's group.
 * Legacy spellings accepted (same value, not a default): title → name, notes → note, waiting → pending,
 * a flat files/shots list → files.after.
 */
export function prepareItem(raw, { now = new Date().toISOString(), autoGroup = false, session = '' } = {}) {
  const o = isObj(raw) ? { ...raw } : {};
  const item = { ...o, $axf: ITEM_TAG };
  if (blank(item.name) && !blank(o.title)) item.name = str(o.title, REGISTRY.maxName);
  delete item.title;
  if (typeof item.name === 'string') item.name = item.name.trim();
  if (item.note === undefined && typeof o.notes === 'string') item.note = o.notes;
  delete item.notes;
  if (blank(item.createdAt)) item.createdAt = now;
  if (typeof item.status === 'string' && REGISTRY.statusAliases[item.status]) item.status = REGISTRY.statusAliases[item.status];
  if (item.kind === 'review' && item.status === undefined) item.status = 'pending';
  const by = parseSubmitter(o.submittedBy);
  if (by) item.submittedBy = by; else delete item.submittedBy;
  if (o.pr !== undefined && o.pr !== null && o.pr !== '') { const n = Number(String(o.pr).replace(/^#/, '')); item.pr = Number.isInteger(n) && n > 0 ? n : o.pr; } else delete item.pr;
  // files: { before, after } or a flat list (= after)
  const flat = Array.isArray(o.files) ? o.files : Array.isArray(o.shots) ? o.shots : null;
  if (flat) item.files = { before: [], after: flat.map(fileOf) };
  else if (isObj(o.files)) item.files = { before: (Array.isArray(o.files.before) ? o.files.before : []).map(fileOf), after: (Array.isArray(o.files.after) ? o.files.after : []).map(fileOf) };
  delete item.shots;
  if (blank(item.viewport) && isObj(item.files)) { const v = viewportOf(item.files); if (v) item.viewport = v; }
  // group: a name (string), a { id?, name } reference, or (autoGroup only) the automatic one
  const gIn = o.group;
  let group;
  const at = item.createdAt;
  if (typeof gIn === 'string' && gIn.trim()) group = makeGroup({ name: gIn, now: isTimestamp(at) ? at : now, source: item.source, submittedBy: item.submittedBy, app: item.app, session });
  else if (isObj(gIn) && !blank(gIn.name)) group = { ...makeGroup({ name: gIn.name, now: isTimestamp(gIn.createdAt) ? gIn.createdAt : isTimestamp(at) ? at : now, source: gIn.source ?? item.source, submittedBy: item.submittedBy, app: item.app, session }), ...gIn, $axf: GROUP_TAG, name: str(gIn.name, REGISTRY.maxName) };
  else if (blank(gIn) && autoGroup) group = makeGroup({ name: '', now, source: item.source, submittedBy: item.submittedBy, app: item.app, session: session || item.submittedBy?.id || '' });
  if (group) { if (blank(group.id)) group.id = groupId(group.name, group.createdAt); item.group = { id: group.id, name: group.name }; }
  else if (isObj(gIn)) item.group = gIn;
  else delete item.group;
  const v = validateItem(item);
  return { ok: v.ok, item, group, errors: v.errors };
}

/* ------------------------------------------------------------------ migration of older items */

const LEGACY_SOURCE = { cli: 'claude-code', api: 'console', pack: 'plugin', build: 'headless', check: 'claude-code', pr: 'headless', manual: 'manual', 'watch-live': 'watch-live', upload: 'manual' };
/** A legacy source word → a ui-review-item@1 source. */
export const sourceFrom = (s) => (REGISTRY.sources.includes(s) ? s : LEGACY_SOURCE[s] ?? 'console');

/** "shots/breakroom-cards-phone.png" → "Breakroom cards" ('' when nothing readable is left). */
export function readableName(src) {
  const stem = String(src ?? '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/(^|[-_.])(phone|desktop|tablet|before|after)$/i, '').replace(/[-_.]+/g, ' ').trim();
  return stem ? stem[0].toUpperCase() + stem.slice(1) : '';
}

const DAY_FMT = (iso) => String(iso).slice(0, 10);
/**
 * Rewrites one older UI Review item (review-item@1 from the queue, or a screenshot record) to ui-review-item@1.
 *   ctx.kind: 'review' | 'screenshot' · ctx.fileTime(src) → ISO time of a file (when the item has no timestamp)
 *   ctx.groupFor(old, createdAt) → { id, name } (default: by build/branch, else by day)
 * Returns { item, changes: [what was filled] }. Never invents a name: the title (or the screen, or the first file's
 * readable name) is the name.
 */
export function migrateLegacy(old, { kind = 'review', fileTime = () => '', groupFor, now = new Date().toISOString() } = {}) {
  const o = isObj(old) ? old : {};
  if (o.$axf === ITEM_TAG && validateItem(o).ok) return { item: o, changes: [] };
  const changes = [];
  const shotsIn = Array.isArray(o.shots) ? o.shots : [];
  const files = isObj(o.files) && !Array.isArray(o.files) ? { before: o.files.before ?? [], after: o.files.after ?? [] }
    : { before: shotsIn.filter((s) => s?.pair === 'before' || s?.side === 'before').map(fileOf), after: shotsIn.filter((s) => !(s?.pair === 'before' || s?.side === 'before')).map(fileOf) };
  if (Array.isArray(o.files)) { files.before = []; files.after = o.files.map(fileOf); }
  const one = typeof o.file === 'string' && o.file ? o.file : typeof o.src === 'string' ? o.src : '';
  if (!shotsIn.length && !Array.isArray(o.files) && !isObj(o.files) && one) files.after = [{ src: one, ...(REGISTRY.viewports.includes(o.viewport) ? { viewport: o.viewport } : {}) }];
  for (const f of [...files.before, ...files.after]) { if (f && f.viewport === undefined && f.device) { f.viewport = f.device; } if (f) delete f.device; }
  let createdAt = [o.createdAt, o.submittedAt, o.takenAt, o.at, o.updatedAt].find(isTimestamp);
  if (!createdAt) { const t = [...files.after, ...files.before].map((f) => fileTime(f.src)).find(isTimestamp); createdAt = t || now; changes.push(t ? 'createdAt from the file time' : 'createdAt = migration time (no file time)'); }
  else if (!o.createdAt) changes.push('createdAt from submittedAt/takenAt');
  let name = str(o.name, REGISTRY.maxName) || str(o.title, REGISTRY.maxName);
  if (nameProblem(name, o.id)) {
    const first = files.after[0] ?? files.before[0];
    const cands = [[str(o.screen ?? o.route, 120), 'screen'], [str(first?.name, 120), 'screenshot name'], [readableName(first?.src), 'file name']];
    const hit = cands.find(([c]) => c && !nameProblem(c));
    name = hit ? hit[0] : `${str(o.app, 60) || (kind === 'screenshot' ? 'Screenshot' : 'UI review')} ${stamp(createdAt)}`;
    changes.push(`name from ${hit ? hit[1] : 'app + time (nothing else to go on)'}`);
  } else if (!o.name) changes.push('name from title');
  const source = sourceFrom(o.source);
  if (source !== o.source) changes.push(`source ${o.source ?? '(none)'} → ${source}`);
  const histBy = Array.isArray(o.history) ? o.history.find((h) => h?.action === 'submitted')?.by : '';
  const who = isObj(o.submittedBy) ? o.submittedBy : parseSubmitter(o.submittedBy) ?? (o.session ? { type: 'session', id: str(o.session, 120) } : o.agent ? { type: 'agent', id: str(o.agent, 120) } : str(o.build, 120) || str(o.branch, 120) ? { type: 'build', id: str(o.branch, 120) || str(o.build, 120) } : { type: histBy === 'brett' ? 'user' : 'build', id: str(histBy, 60) || source });
  if (!REGISTRY.submitterTypes.includes(who.type)) who.type = 'build';
  if (!isObj(o.submittedBy)) changes.push('submittedBy filled');
  const group = isObj(o.group) && !blank(o.group.name) ? { id: isId(o.group.id) ? o.group.id : groupId(o.group.name, createdAt), name: str(o.group.name, REGISTRY.maxName) }
    : groupFor ? groupFor(o, createdAt) : (() => { const b = str(o.build, 120) || str(o.branch, 120); const n = b ? `${b} - ${DAY_FMT(createdAt)}` : `UI Review - ${DAY_FMT(createdAt)}`; return { id: groupId(n, createdAt), name: n }; })();
  if (!isObj(o.group)) changes.push(`group "${group.name}"`);
  const viewport = REGISTRY.viewports.includes(o.viewport) ? o.viewport : viewportOf(files) || 'desktop';
  const item = { ...o, $axf: ITEM_TAG, id: isId(o.id) ? o.id : `r-${createdAt.slice(0, 10).replace(/-/g, '')}-${slug(name, 20)}`, name, group, createdAt, kind, source, submittedBy: who,
    app: str(o.app, 80) || 'Unspecified', screen: str(o.screen ?? o.route, 200) || str(files.after[0]?.name ?? files.before[0]?.name, 120) || name, viewport, files };
  if (!str(o.app, 80)) changes.push('app = Unspecified');
  if (kind === 'review') { item.status = REGISTRY.statusAliases[o.status] ?? (REGISTRY.statuses.includes(o.status) ? o.status : 'pending'); if (o.status !== item.status) changes.push(`status ${o.status ?? '(none)'} → ${item.status}`); }
  else delete item.status;
  if (typeof o.notes === 'string' && item.note === undefined) item.note = o.notes;
  if (o.kind && o.kind !== kind && !item.section && SECTION_RE.test(String(o.kind))) { item.section = o.kind; changes.push(`section = ${o.kind}`); }
  if (typeof o.build === 'string') item.build = o.build ? { id: o.build } : undefined;
  if (item.build === undefined) delete item.build;
  if (item.pr === null || item.pr === '') delete item.pr;
  if (typeof o.pair === 'string' && o.pair && !item.pairId) item.pairId = o.pair;
  if (!item.pairId) delete item.side;
  for (const k of ['title', 'notes', 'shots', 'submittedAt', 'takenAt', 'device', 'src', 'file', 'route', 'pair', 'groupName']) delete item[k];
  if (o.session === '') delete item.session;
  if (o.agent === '') delete item.agent;
  return { item, changes };
}

/* ------------------------------------------------------------------ JSON Schemas (written by `axf schemas`) */

export function jsonSchemas() {
  const R = REGISTRY;
  const ts = { type: 'string', format: 'date-time', pattern: ISO_RE.source };
  const name = { type: 'string', minLength: 1, maxLength: R.maxName, pattern: '\\S' };
  const file = { type: 'object', required: ['src'], properties: { src: { type: 'string', minLength: 1 }, name: { type: 'string' }, viewport: { enum: R.viewports } } };
  const submitter = { type: 'object', required: ['type', 'id'], properties: { type: { enum: R.submitterTypes }, id: { type: 'string', minLength: 1 }, label: { type: 'string' } } };
  const item = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'axf/ui-review-item.schema.json', title: `AmberX AXF UI Review item (${ITEM_TAG})`,
    description: 'Generated from framework/core/ui-review-schema.mjs. Everything in UI Review (queue and Screenshots) is one of these.',
    type: 'object', required: R.itemRequired,
    properties: {
      $axf: { const: ITEM_TAG }, id: { type: 'string', pattern: R.idPattern }, name,
      group: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string', pattern: R.idPattern }, name } },
      createdAt: ts, updatedAt: ts, kind: { enum: R.kinds }, source: { enum: R.sources }, submittedBy: submitter,
      app: { type: 'string', minLength: 1 }, screen: { type: 'string', minLength: 1 }, viewport: { enum: R.viewports },
      files: { type: 'object', properties: { before: { type: 'array', items: file }, after: { type: 'array', items: file } } },
      status: { enum: R.statuses }, note: { type: 'string' }, pr: { type: 'integer', minimum: 1 }, branch: { type: 'string' },
      build: { type: 'object', properties: { id: { type: 'string' }, step: { type: 'string' } } }, section: { type: 'string', pattern: R.sectionPattern },
      comment: { type: 'string' }, history: { type: 'array' }, pairId: { type: 'string' },
    },
    allOf: [{ if: { properties: { kind: { const: 'review' } } }, then: { required: R.reviewRequired } }, { if: { properties: { kind: { const: 'screenshot' } } }, then: { not: { required: ['status'] } } }],
  };
  const group = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'axf/ui-review-group.schema.json', title: `AmberX AXF UI Review group (${GROUP_TAG})`,
    description: 'Generated from framework/core/ui-review-schema.mjs. Every UI Review item belongs to exactly one group.',
    type: 'object', required: R.groupRequired,
    properties: { $axf: { const: GROUP_TAG }, id: { type: 'string', pattern: R.idPattern }, name, createdAt: ts, updatedAt: ts, source: { enum: R.sources }, submittedBy: submitter, app: { type: 'string' }, note: { type: 'string' }, session: { type: 'string' }, build: {} },
  };
  return { 'ui-review-item.schema.json': item, 'ui-review-group.schema.json': group };
}
