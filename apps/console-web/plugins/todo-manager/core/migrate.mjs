#!/usr/bin/env node
/**
 * todo-store@1 → todo-tree@1 migration. Contract: ../SPEC.md §9.
 *
 * `convert(store)` is pure and deterministic: lists become list nodes, entries become todo / task / note nodes under
 * their parent entry or their list, checklist items become child to-do nodes; ids, dates and done state are kept.
 * `migrateFile(path)` backs the old file up first (same folder, `.todo-store-v1.<stamp>.bak`, 0600), writes the new
 * document atomically, and is idempotent: a todo-tree@1 file is left alone. `dryRun` reports and writes nothing.
 * `migrateAll(dataDir)` does the base store and every `projects/<id>/store.json`.
 *
 * CLI: node core/migrate.mjs <dataDir | store.json> [--dry-run] [--json]
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT, KINDS, PRIORITIES, TodoError, dueFromMs, emptyDoc, load, orderKeys, stats } from './todo-tree.mjs';

export const OLD_FORMAT = 'todo-store@1';
const STATUS_MAP = { open: 'open', in_progress: 'doing', blocked: 'blocked', done: 'done' };

const isInt = (v) => typeof v === 'number' && Number.isInteger(v) && !Number.isNaN(v);
const ms = (v, fallback) => (isInt(v) && v >= 0 ? v : fallback);
const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;

/** Is this a todo-store@1 document (or close enough to one to convert)? */
export function isOldStore(raw) {
  return !!raw && typeof raw === 'object' && (raw.$axf === OLD_FORMAT || (raw.$axf == null && Array.isArray(raw.lists) && Array.isArray(raw.entries)));
}

/**
 * convert(store, { now, project }) → { doc, counts, warnings }. Pure. Same input (and `now`) → same document.
 * Nothing is dropped: an entry whose list is missing becomes a root node with a warning, and so does a list whose
 * parent is missing.
 */
export function convert(store, { now = Date.now(), project = '' } = {}) {
  if (!isOldStore(store)) throw new TodoError('not-old-store', `Not a ${OLD_FORMAT} document`);
  const warnings = [];
  const lists = (Array.isArray(store.lists) ? store.lists : []).filter((l) => l && isInt(l.id));
  const entries = (Array.isArray(store.entries) ? store.entries : []).filter((e) => e && isInt(e.id));
  const listIds = new Set(lists.map((l) => l.id));
  const entryIds = new Set(entries.map((e) => e.id));
  const nodes = [];
  const counts = { lists: lists.length, entries: entries.length, checklistItems: 0, orphans: 0, nodes: 0 };

  // parents, as strings; anything missing goes to the root
  const listParent = (l) => {
    if (l.parentId == null) return null;
    if (listIds.has(l.parentId)) return String(l.parentId);
    warnings.push(`list ${l.id} ("${l.title}"): parent list ${l.parentId} is missing, moved to the root`);
    counts.orphans++;
    return null;
  };
  const entryParent = (e) => {
    if (e.parentId != null && entryIds.has(e.parentId)) return String(e.parentId);
    if (e.parentId != null) warnings.push(`entry ${e.id} ("${e.title}"): parent entry ${e.parentId} is missing, placed in its list`);
    if (listIds.has(e.listId)) return String(e.listId);
    warnings.push(`entry ${e.id} ("${e.title}"): list ${e.listId} is missing, moved to the root`);
    counts.orphans++;
    return null;
  };

  // siblings per parent: entries first (as the old export rendered them), then child lists, each by sortOrder
  const sibs = new Map();
  const put = (parentId, rec) => {
    const k = parentId ?? '';
    if (!sibs.has(k)) sibs.set(k, []);
    sibs.get(k).push(rec);
  };
  for (const e of entries) put(entryParent(e), { group: 0, sort: e, node: entryNode(e, now, warnings) });
  for (const l of lists) put(listParent(l), { group: 1, sort: l, node: listNode(l, now) });
  for (const [k, recs] of sibs) {
    recs.sort((a, b) => a.group - b.group || bySort(a.sort, b.sort));
    const keys = orderKeys(recs.length);
    recs.forEach((r, i) => { r.node.parentId = k === '' ? null : k; r.node.order = keys[i]; nodes.push(r.node); });
  }
  // checklist items → child to-do nodes of their entry, after its subtasks
  for (const e of entries) {
    const items = (Array.isArray(e.checklist) ? e.checklist : []).filter((c) => c && typeof c === 'object');
    if (!items.length) continue;
    const existing = (sibs.get(String(e.id)) ?? []).length;
    const keys = orderKeys(items.length, existing ? nodes.filter((n) => n.parentId === String(e.id)).map((n) => n.order).sort().at(-1) : null);
    items.forEach((c, i) => {
      const cid = `${e.id}.${String(c.id ?? `c${i + 1}`).replace(/[^A-Za-z0-9._:-]/g, '')}`;
      nodes.push({
        id: cid, kind: 'todo', parentId: String(e.id), order: keys[i], title: String(c.text ?? '').trim() || 'Untitled todo', body: '',
        done: c.done === true, doneAt: c.done === true ? ms(e.completedAt, ms(e.updatedAt, now)) : null, status: c.done === true ? 'done' : 'open',
        due: null, priority: 'normal', collapsed: false, source: 'import', createdAt: ms(e.createdAt, now), updatedAt: ms(e.updatedAt, ms(e.createdAt, now)),
      });
      counts.checklistItems++;
    });
  }

  const draft = emptyDoc(project, now);
  for (const n of nodes) draft.nodes[n.id] = n;
  draft.meta = { createdAt: now, migratedFrom: OLD_FORMAT, migratedAt: now };
  if (store.types && typeof store.types === 'object') draft.meta.legacyTypes = store.types;
  const { doc, warnings: repairs } = load(draft, now);
  warnings.push(...repairs);
  counts.nodes = Object.keys(doc.nodes).length;
  const op = { seq: 1, token: `migrate-${now.toString(36)}`, at: now, op: 'migrate', nodeId: null, args: { from: OLD_FORMAT, ...counts }, touched: [], by: 'migrate' };
  doc.ops = [op];
  doc.seq = 1;
  return { doc, counts, warnings };
}

function listNode(l, now) {
  const n = {
    id: String(l.id), kind: 'list', parentId: null, order: '', title: String(l.title ?? '').trim() || 'Untitled list', body: '',
    done: false, doneAt: null, status: 'open', due: null, priority: 'normal', collapsed: false, source: 'import',
    createdAt: ms(l.createdAt, now), updatedAt: ms(l.updatedAt, ms(l.createdAt, now)),
  };
  if (l.tone) n.tone = l.tone;
  if (l.icon) n.icon = l.icon;
  return n;
}

function entryNode(e, now, warnings) {
  const kind = KINDS.includes(e.kind) ? e.kind : 'note';
  if (kind !== e.kind) warnings.push(`entry ${e.id} ("${e.title}"): kind "${e.kind}" is unknown, read as a note`);
  const status = STATUS_MAP[e.status] ?? 'open';
  const done = status === 'done';
  const n = {
    id: String(e.id), kind, parentId: null, order: '', title: String(e.title ?? '').trim() || `Untitled ${kind}`, body: typeof e.body === 'string' ? e.body : '',
    done, doneAt: done ? ms(e.completedAt, ms(e.updatedAt, now)) : null, status,
    due: isInt(e.dueAt) ? dueFromMs(e.dueAt) : null,
    priority: PRIORITIES.includes(e.priority) ? e.priority : 'normal', collapsed: false, source: 'import',
    createdAt: ms(e.createdAt, now), updatedAt: ms(e.updatedAt, ms(e.createdAt, now)),
  };
  if (Array.isArray(e.tags) && e.tags.length) n.tags = e.tags;
  if (e.fields && typeof e.fields === 'object' && Object.values(e.fields).some((v) => v !== '' && v != null && v !== false)) n.fields = { ...e.fields };
  return n;
}

// ------------------------------------------------------------------------------------------------ files

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

export function backupName(path, now = Date.now()) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${path}.todo-store-v1.${stamp}.bak`;
}

/**
 * migrateFile(path, { dryRun, now, project }) → { path, status, backup, counts, warnings, stats }.
 * status: 'migrated' | 'dry-run' | 'already' (todo-tree@1 already) | 'missing' (no file) | 'unreadable' (not JSON or not a store).
 */
export function migrateFile(path, { dryRun = false, now = Date.now(), project = '' } = {}) {
  const out = { path, status: '', backup: '', counts: null, warnings: [], stats: null };
  if (!existsSync(path)) return { ...out, status: 'missing' };
  const raw = readJson(path);
  if (raw && raw.$axf === FORMAT) return { ...out, status: 'already', stats: stats(load(raw, now).doc) };
  if (!isOldStore(raw)) return { ...out, status: 'unreadable', warnings: ['not JSON, or neither todo-store@1 nor todo-tree@1'] };
  const { doc, counts, warnings } = convert(raw, { now, project });
  out.counts = counts;
  out.warnings = warnings;
  out.stats = stats(doc);
  if (dryRun) return { ...out, status: 'dry-run' };
  const backup = backupName(path, now);
  copyFileSync(path, backup);
  chmodSync(backup, 0o600);
  doc.meta.backup = basename(backup);
  writeJsonAtomic(path, doc);
  return { ...out, status: 'migrated', backup };
}

/** Every store under a data dir: `store.json` (base project) and `projects/<id>/store.json`. */
export function storeFiles(dataDir) {
  const files = [{ path: join(dataDir, 'store.json'), project: '' }];
  const projects = join(dataDir, 'projects');
  if (existsSync(projects)) {
    for (const id of readdirSync(projects).sort()) {
      const p = join(projects, id, 'store.json');
      if (existsSync(p) && statSync(p).isFile()) files.push({ path: p, project: id });
    }
  }
  return files;
}

export function migrateAll(dataDir, opts = {}) {
  return storeFiles(dataDir).map((f) => migrateFile(f.path, { ...opts, project: f.project }));
}

// ------------------------------------------------------------------------------------------------ CLI

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const dryRun = argv.includes('--dry-run');
  const json = argv.includes('--json');
  const target = args[0] || process.env.AXF_TODO_DIR;
  if (!target) {
    console.error('usage: node core/migrate.mjs <dataDir | store.json> [--dry-run] [--json]');
    return 2;
  }
  const results = existsSync(target) && statSync(target).isFile() ? [migrateFile(target, { dryRun })] : migrateAll(target, { dryRun });
  if (json) console.log(JSON.stringify(results, null, 2));
  else {
    for (const r of results) {
      const c = r.counts ? ` ${r.counts.lists} lists, ${r.counts.entries} entries, ${r.counts.checklistItems} checklist items → ${r.counts.nodes} nodes` : '';
      console.log(`${r.status.padEnd(10)} ${r.path}${c}${r.backup ? `  (backup ${basename(r.backup)})` : ''}`);
      for (const w of r.warnings) console.log(`           ! ${w}`);
    }
  }
  return results.some((r) => r.status === 'unreadable') ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
