/**
 * The one boundary between UI Review's working records and what it stores and serves: ui-review-item@1 /
 * ui-review-group@1 (framework/core/ui-review-schema.mjs). The page, review.mjs, shots.mjs and the tests use it; the
 * server's conform.py mirrors it.
 *
 * Working shapes (what the views and the stores' code use):
 *   review  { id, kind: <section>, title, app, build, branch, pr, screen, shots: [{ src, device, name }], notes, status:
 *             waiting|changes|rejected|approved, comment, history, source, submittedBy, submittedAt, updatedAt, group: <id> }
 *   shot    { id, title, source, session, build, agent, app, screen, viewport, takenAt, addedAt, pair, side, note, branch,
 *             pr, by, file, size, promoted, submittedBy, group: <id> }
 * Stored / served: ui-review-item@1 (kind review | screenshot), groups as ui-review-group@1.
 * toStored* return { item, errors }; a store refuses to write when errors is not empty.
 */
import * as S from '../../../../../framework/core/ui-review-schema.mjs';

export { S as schema };
export const ITEM_TAG = S.ITEM_TAG;
export const GROUP_TAG = S.GROUP_TAG;

const s = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : '');
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const prOf = (v) => { const n = Number(String(v ?? '').replace(/^#/, '')); return Number.isInteger(n) && n > 0 ? n : undefined; };
const drop = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === '') delete o[k]; return o; };

/** Who sent it: an explicit submittedBy wins, else the session / build / agent / user the caller named. */
export function submitterOf(o) {
  const by = S.parseSubmitter(o?.submittedBy);
  if (by && by.type && by.id) return by;
  if (s(o?.session)) return { type: 'session', id: s(o.session, 120) };
  if (s(o?.agent)) return { type: 'agent', id: s(o.agent, 120) };
  if (s(o?.build)) return { type: 'build', id: s(o.build, 120) };
  if (s(o?.by)) return { type: o.by === 'brett' || o.source === 'manual' || o.source === 'console' ? 'user' : 'build', id: s(o.by, 120) };
  return by;
}

const groupRef = (gid, groups) => { const g = (groups ?? []).find((x) => x?.id === gid); return g ? { id: g.id, name: g.name } : gid ? { id: gid } : undefined; };
const STATUS_IN = { waiting: 'pending' };
const STATUS_OUT = { pending: 'waiting' };
const WORK_STATUSES = ['waiting', 'changes', 'rejected', 'approved'];

/* ------------------------------------------------------------------ review items */

export function reviewToStored(r, groups = []) {
  const shots = Array.isArray(r.shots) ? r.shots : [];
  const extra = { ...r };
  for (const k of ['$axf', 'kind', 'title', 'shots', 'notes', 'status', 'submittedAt', 'group', 'groupName', 'groupSession', 'build', 'step', 'by', 'pr', 'name']) delete extra[k];
  const item = drop({
    ...extra, $axf: ITEM_TAG, id: r.id, name: s(r.title, S.REGISTRY.maxName), group: groupRef(r.group, groups), createdAt: r.submittedAt || r.createdAt,
    kind: 'review', section: s(r.kind, 41) || 'other', source: r.source, submittedBy: submitterOf(r), app: s(r.app, 80), screen: s(r.screen, 200),
    viewport: S.viewportOf({ after: shots.map((x) => ({ viewport: x.device })) }) || undefined,
    files: { before: [], after: shots.map((x) => drop({ src: x.src, name: x.name, viewport: x.device })) },
    status: STATUS_IN[r.status] ?? r.status, note: r.notes || undefined, pr: prOf(r.pr), build: s(r.build) ? drop({ id: s(r.build, 120), step: s(r.step, 80) }) : undefined, comment: r.comment ?? '',
  });
  if (!item.files.after.length) item.files = { before: [], after: [] };
  return { item, errors: S.validateItem(item).errors };
}

export function storedToReview(it) {
  if (!isObj(it) || it.$axf !== ITEM_TAG) return it; // older record: the migration rewrites it
  const files = [...(it.files?.before ?? []).map((f) => ({ ...f, side: 'before' })), ...(it.files?.after ?? [])];
  const out = { ...it, kind: it.section || 'other', title: it.name, shots: files.map((f) => ({ src: f.src, device: f.viewport ?? 'desktop', name: f.name || f.src })), notes: it.note ?? '',
    status: STATUS_OUT[it.status] ?? (WORK_STATUSES.includes(it.status) ? it.status : 'waiting'), submittedAt: it.createdAt, group: it.group?.id ?? '', groupName: it.group?.name ?? '', build: it.build?.id ?? '', step: it.build?.step ?? '', pr: it.pr ?? null };
  for (const k of ['$axf', 'name', 'files', 'note', 'createdAt', 'section']) delete out[k];
  out.$axf = 'review-item@1';
  return out;
}

/* ------------------------------------------------------------------ screenshots */

export function shotToStored(x, groups = []) {
  const extra = { ...x };
  for (const k of ['$axf', 'title', 'takenAt', 'file', 'group', 'groupName', 'pair', 'side', 'build', 'pr', 'by', 'name', 'status']) delete extra[k];
  const item = drop({
    ...extra, $axf: ITEM_TAG, id: x.id, name: s(x.title, S.REGISTRY.maxName), group: groupRef(x.group, groups), createdAt: x.takenAt || x.createdAt,
    kind: 'screenshot', source: x.source, submittedBy: submitterOf(x), app: s(x.app, 80), screen: s(x.screen, 200), viewport: x.viewport,
    files: { before: [], after: x.file ? [{ src: x.file, viewport: x.viewport }] : [] }, pairId: s(x.pair, 80) || undefined, side: x.pair ? x.side : undefined,
    pr: prOf(x.pr), build: s(x.build) ? { id: s(x.build, 120) } : undefined, by: undefined,
  });
  if (s(x.by)) item.by = s(x.by, 60);
  return { item, errors: S.validateItem(item).errors };
}

export function storedToShot(it) {
  if (!isObj(it) || it.$axf !== ITEM_TAG) return it;
  const f = it.files?.after?.[0] ?? it.files?.before?.[0] ?? {};
  const out = { ...it, $axf: 'ui-screenshot@1', title: it.name, takenAt: it.createdAt, file: f.src ?? '', group: it.group?.id ?? '', groupName: it.group?.name ?? '', pair: it.pairId ?? '', side: it.side ?? '',
    build: it.build?.id ?? '', pr: it.pr ?? null, session: it.session ?? (it.submittedBy?.type === 'session' ? it.submittedBy.id : ''), agent: it.agent ?? (it.submittedBy?.type === 'agent' ? it.submittedBy.id : ''),
    by: it.by ?? '', note: it.note ?? '', addedAt: it.addedAt ?? it.createdAt, promoted: Array.isArray(it.promoted) ? it.promoted : [], size: it.size ?? 0 };
  for (const k of ['name', 'files', 'createdAt', 'pairId', 'kind']) delete out[k];
  return out;
}

/* ------------------------------------------------------------------ groups */

export function groupToStored(g) {
  const out = drop({ ...g, $axf: GROUP_TAG, source: S.REGISTRY.sources.includes(g?.source) ? g.source : g?.source || undefined });
  return { group: out, errors: S.validateGroup(out).errors };
}

/** Errors of a whole store (items + groups), each prefixed with the record id: [] when everything conforms. */
export function storeErrors(items, groups = []) {
  const out = [];
  for (const g of groups) for (const e of S.validateGroup(g).errors) out.push({ ...e, id: g?.id, message: `group ${g?.id ?? '?'}: ${e.message}` });
  const ids = new Set(groups.map((g) => g?.id));
  for (const it of items) {
    for (const e of S.validateItem(it).errors) out.push({ ...e, id: it?.id, message: `${it?.id ?? '?'}: ${e.message}` });
    if (it?.group?.id && groups.length && !ids.has(it.group.id)) out.push({ field: 'group.id', code: 'invalid', id: it.id, message: `${it.id}: group.id "${it.group.id}" is not a known group` });
  }
  return out;
}

/** Throws one readable error naming every bad field (what a store raises instead of writing). */
export function refuse(errors) { if (errors.length) throw new S.UiReviewSchemaError(errors); }
