/**
 * data-rows — per-row writes of a deploy document through data-store@1 (framework/core/data-files.mjs).
 *
 * A document axf-data keeps as rows (a DocTable: services/axf-data/tables.py plugin_doc, one row per item of each of its
 * lists, the other fields in the head) is changed with one data-patch@1 call naming only the rows that changed, never a
 * whole-document put for one change:
 *
 *   writeRows(file, before, after, { claims: MAP, limits: MAP, rules: 'id' })
 *
 * `lists` names each list of the document: MAP for an `id → object` map, or the item field that keys a list of objects.
 * Every other top-level field is a head field. The path goes through the data layer's map (keyFor / modeOf):
 *   cutover   one `patch` with the changed, added and removed rows and the changed head fields (nothing when nothing
 *             changed). A record axf-data has not seen yet, a server without row tables, or a reordered keyed list (row
 *             positions are kept by patch) is written once whole through writeJsonSync.
 *   other     writeJsonSync: a path no rule maps is not data (test and scratch folders); rollback refuses the write.
 */
import { callSync, keyFor, modeOf, writeJsonSync } from '../framework/core/data-files.mjs';

export const MAP = '\0map';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * The data-patch@1 body that turns `before` into `after`: { head?, lists? }, undefined when nothing changed, null when a
 * keyed list changed order (a patch keeps every row's position: the whole document is written instead).
 */
export function rowPatch(before, after, lists) {
  const b = obj(before); const a = obj(after);
  const out = {};
  for (const [name, by] of Object.entries(lists)) {
    const changes = [];
    if (by === MAP) {
      const was = obj(b[name]); const now = obj(a[name]);
      for (const [k, v] of Object.entries(now)) if (!same(was[k], v)) changes.push({ key: k, item: v });
      for (const k of Object.keys(was)) if (!(k in now)) changes.push({ key: k, delete: true });
    } else {
      const id = (x) => (x && typeof x === 'object' ? String(x[by] ?? '') : '');
      const was = arr(b[name]); const now = arr(a[name]);
      const wasBy = new Map(was.map((x) => [id(x), x])); const nowIds = new Set(now.map(id));
      if (nowIds.has('') || nowIds.size !== now.length) return null;
      const kept = was.map(id).filter((k) => nowIds.has(k));
      const added = now.map(id).filter((k) => !wasBy.has(k));
      // positions stay as they are; new rows go to the end: any other order is a move of the whole list
      if (!same(now.map(id), [...kept, ...added])) return null;
      for (const x of now) if (!same(wasBy.get(id(x)), x)) changes.push({ key: id(x), item: x });
      for (const k of wasBy.keys()) if (!nowIds.has(k)) changes.push({ key: k, delete: true });
    }
    if (changes.length) (out.lists ||= {})[name] = changes;
  }
  for (const [k, v] of Object.entries(a)) if (!(k in lists) && !same(b[k], v)) (out.head ||= {})[k] = v;
  return out.lists || out.head ? out : undefined;
}

/** Write `after` over `before` at `file`: one row patch on axf-data, the file only where the path is not data. */
export function writeRows(file, before, after, lists, { indent = 1 } = {}) {
  const key = keyFor(file);
  if (!key || modeOf(key) !== 'cutover') { writeJsonSync(file, after, indent); return 'document'; }
  const body = rowPatch(before, after, lists);
  if (body === undefined) return 'unchanged';
  if (body === null) { writeJsonSync(file, after, indent); return 'document'; }
  try { callSync({ op: 'patch', key, body }); return 'rows'; }
  catch (e) {
    if (e.code !== 'not_found' && e.code !== 'invalid_body') throw e;
    writeJsonSync(file, after, indent); return 'document';
  }
}
