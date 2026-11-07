/**
 * AmberX targets of control@1 (amberx.items, amberx.lists): every note, to-do, task and list, through the AmberX
 * notes core's own rules (lib/amberx-core.gen.mjs = that core, types stripped).
 *
 * Where: the hub tables the AmberX app and every device read (lib-hubstore, hub project `amberx-axf`, folder
 * `amberx-notes/`, tables `lists` and `items`): `/projects/amberx-axf/_data/amberx-notes/<table>/head.json` (+ rows-N.json
 * when a table outgrows one file) where /projects is mounted. AXF_AMBERX_NOTES_DIR points elsewhere (tests); without
 * /projects the plugin's data folder keeps a local copy. Written the way HubTable.write does (inline under 64 KB, else
 * chunks), so the app reads our rows like its own.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as core from './amberx-core.gen.mjs';
import { DATA_DIR, ControlError } from './common.mjs';

const TABLE_FORMAT = 'hub-table@1';
const HUB_FILE_MAX = 64_000;
const TABLE_CHUNK = 48_000;

export function notesDir() {
  if (process.env.AXF_AMBERX_NOTES_DIR) return process.env.AXF_AMBERX_NOTES_DIR;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  if (existsSync(projects)) return join(projects, core.HUB_PROJECT, '_data', core.DATA_FOLDER);
  return join(DATA_DIR, core.DATA_FOLDER);
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(v)); renameSync(tmp, f); }

function readTable(name) {
  const dir = join(notesDir(), name);
  const head = readJson(join(dir, 'head.json'));
  if (!head || head.$axf !== TABLE_FORMAT) return {};
  if (head.rows) return { ...head.rows };
  const out = {};
  for (let i = 0; i < (head.chunks ?? 0); i++) Object.assign(out, readJson(join(dir, `rows-${i}.json`)) ?? {});
  return out;
}

function chunkRows(rows) {
  const out = [{}]; let size = 2;
  for (const [k, v] of Object.entries(rows)) {
    const n = JSON.stringify(k).length + JSON.stringify(v).length + 2;
    if (size + n > TABLE_CHUNK && Object.keys(out[out.length - 1]).length) { out.push({}); size = 2; }
    out[out.length - 1][k] = v; size += n;
  }
  return out;
}

function writeTable(name, rows) {
  const dir = join(notesDir(), name);
  const base = { $axf: TABLE_FORMAT, table: name, count: Object.keys(rows).length, updatedAt: new Date().toISOString() };
  const inline = { ...base, chunks: 0, rows };
  if (JSON.stringify(inline).length <= HUB_FILE_MAX - 500) return writeJson(join(dir, 'head.json'), inline);
  const parts = chunkRows(rows);
  parts.forEach((p, i) => writeJson(join(dir, `rows-${i}.json`), p));
  writeJson(join(dir, 'head.json'), { ...base, chunks: parts.length });
}

/** The store as the notes core sees it (rows normalised: rows from the hub are untrusted). */
export function loadStore() {
  const now = new Date().toISOString();
  const s = { lists: {}, items: {} };
  for (const [id, raw] of Object.entries(readTable(core.LISTS_TABLE))) { const l = core.normalizeList(raw, id, now); if (l) s.lists[id] = l; }
  for (const [id, raw] of Object.entries(readTable(core.ITEMS_TABLE))) { const it = core.normalizeItem(raw, id, now); if (it) s.items[id] = it; }
  core.ensureSystemLists(s, now);
  return s;
}
function saveStore(s, { lists = true, items = true } = {}) {
  if (lists) writeTable(core.LISTS_TABLE, s.lists);
  if (items) writeTable(core.ITEMS_TABLE, s.items);
}

const wrap = (fn) => { try { return fn(); } catch (e) { if (e instanceof ControlError) throw e; throw new ControlError('validation', e.message); } };
const itemOut = (s, it) => ({ ...it, listName: s.lists[it.list]?.name ?? '', listPath: s.lists[it.list] ? core.pathOf(s, it.list) : '' });
const listOut = (s, l) => ({ ...l, path: core.pathOf(s, l.id), items: core.itemsIn(s, l.id).length });

export function runAmberx(c, preset = {}) {
  return c.target === 'amberx.lists' ? runLists(c) : runItems(c, preset);
}

function runItems(c, preset) {
  const s = loadStore();
  const need = () => { const it = s.items[c.path]; if (!it) throw new ControlError('not_found', `no AmberX item ${c.path}`); return it; };
  switch (c.op) {
    case 'list': {
      const f = { ...preset, ...(c.select ?? {}) };
      let items = core.search(s, { q: f.q, list: f.list, deep: f.deep, kind: f.kind, status: f.status, tag: f.tag, pinned: f.pinned, starred: f.starred });
      if (f.due) items = items.filter((i) => core.dueBucket(i.due ?? '') === f.due);
      const total = items.length;
      const limit = Math.max(1, Math.min(Number(f.limit) || 100, 500));
      return { items: items.slice(0, limit).map((i) => itemOut(s, i)), total };
    }
    case 'get': return { item: itemOut(s, need()) };
    case 'add': {
      const it = wrap(() => core.addItem(s, { source: 'ai', by: c.by ?? '', device: 'token-control', ...preset, ...c.value }));
      saveStore(s, { lists: false });
      return { changed: true, item: itemOut(s, it) };
    }
    case 'set': {
      need();
      const it = wrap(() => core.updateItem(s, c.path, c.value));
      saveStore(s, { lists: false });
      return { changed: true, item: itemOut(s, it) };
    }
    case 'remove': {
      need();
      const n = core.removeItems(s, [c.path]);
      saveStore(s, { lists: false });
      return { removed: n };
    }
    case 'act': {
      const cur = need();
      const input = c.input ?? {};
      let it;
      switch (c.action) {
        case 'done': it = wrap(() => core.updateItem(s, c.path, { status: 'done' })); break;
        case 'undone': it = wrap(() => core.updateItem(s, c.path, { status: 'open' })); break;
        case 'pin': it = wrap(() => core.updateItem(s, c.path, { pinned: !!input.on })); break;
        case 'star': it = wrap(() => core.updateItem(s, c.path, { starred: !!input.on })); break;
        case 'move': {
          const list = s.lists[input.list] ? input.list : core.findList(s, String(input.list ?? ''))?.id;
          if (!list) throw new ControlError('not_found', `no AmberX list ${input.list}`);
          wrap(() => core.moveItems(s, [c.path], list)); it = s.items[c.path]; break;
        }
        case 'merge': it = wrap(() => core.mergeItems(s, [c.path, ...(input.ids ?? []).filter((x) => x !== c.path)])); break;
        case 'check': {
          const box = cur.checklist.find((b) => b.id === input.item || b.text === input.item);
          if (!box) throw new ControlError('not_found', `${c.path} has no checklist item ${input.item}`);
          it = wrap(() => core.updateItem(s, c.path, { checklist: cur.checklist.map((b) => (b === box ? { ...b, done: !!input.done } : b)) })); break;
        }
        default: throw new ControlError('invalid', `amberx.items has no action ${c.action}`);
      }
      saveStore(s, { lists: false });
      return { changed: true, item: itemOut(s, it) };
    }
    default: throw new ControlError('invalid', `amberx.items does not take ${c.op}`);
  }
}

function runLists(c) {
  const s = loadStore();
  const need = () => { const l = s.lists[c.path]; if (!l) throw new ControlError('not_found', `no AmberX list ${c.path}`); return l; };
  switch (c.op) {
    case 'list': {
      const f = c.select ?? {};
      const words = core.norm(f.q ?? '').split(' ').filter(Boolean);
      let rows = core.flatTree(s).map((r) => r.list);
      if ('parent' in f) rows = rows.filter((l) => (l.parent ?? null) === (f.parent ?? null));
      if (words.length) rows = rows.filter((l) => words.every((w) => core.norm(`${l.name} ${(l.aliases ?? []).join(' ')}`).includes(w)));
      return { items: rows.map((l) => listOut(s, l)), total: rows.length };
    }
    case 'get': return { item: listOut(s, need()) };
    case 'add': {
      const v = c.value;
      const l = wrap(() => core.addList(s, v.name, v.parent ?? null));
      if (v.icon || v.aliases) Object.assign(l, core.normalizeList({ ...l, icon: v.icon, aliases: v.aliases }, l.id) ?? {});
      saveStore(s, { items: false });
      return { changed: true, item: listOut(s, l) };
    }
    case 'set': {
      const l = need();
      const v = c.value;
      wrap(() => {
        if (typeof v.name === 'string') core.renameList(s, l.id, v.name);
        if ('parent' in v) core.moveList(s, l.id, v.parent ?? null);
        if (typeof v.order === 'number') l.order = v.order;
        if (v.icon !== undefined || v.aliases !== undefined) Object.assign(l, core.normalizeList({ ...l, ...(v.icon !== undefined ? { icon: v.icon } : {}), ...(v.aliases !== undefined ? { aliases: v.aliases } : {}) }, l.id) ?? {});
      });
      saveStore(s, { items: false });
      return { changed: true, item: listOut(s, s.lists[l.id]) };
    }
    case 'remove': {
      need();
      wrap(() => core.removeList(s, c.path));
      saveStore(s);
      return { removed: 1 };
    }
    case 'act': {
      const l = need();
      const input = c.input ?? {};
      wrap(() => {
        if (c.action === 'rename') core.renameList(s, l.id, input.name);
        else if (c.action === 'move') core.moveList(s, l.id, input.parent ?? null);
        else if (c.action === 'reorder') core.reorderLists(s, input.ids ?? []);
        else throw new ControlError('invalid', `amberx.lists has no action ${c.action}`);
      });
      saveStore(s, { items: false });
      return { changed: true, item: listOut(s, s.lists[l.id]) };
    }
    default: throw new ControlError('invalid', `amberx.lists does not take ${c.op}`);
  }
}
