#!/usr/bin/env node
/**
 * Schema test for notes-tasks@1: `node apps/console-web/plugins/notes-tasks/test.mjs`.
 *
 * - nesting: one item type holds any other through `parent`, to any depth (12 and 1 000 levels, every look mixed);
 * - backward compatibility: amberx-notes@1 rows and documents written under the first notes-tasks@1 design
 *   (Nov 12 2026: `lists` required, settings key `types`) stay valid;
 * - the rules the format does enforce (looks, legacy types, unknown fields) still refuse bad input.
 *
 * The validator below implements exactly the JSON Schema 2020-12 keywords the schema uses and refuses any other,
 * so a keyword added to the schema later can never be skipped silently.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, 'schema/notes-tasks.schema.json'), 'utf8'));

let ok = 0;
const check = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } ok++; console.log(`  ✓ ${msg}`); };
console.log('notes-tasks test.mjs');

// ---------------------------------------------------------------- minimal JSON Schema validator
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs']);
const KEYWORDS = new Set(['$ref', 'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'propertyNames',
  'maxProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum']);

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const typeMatches = (v, t) => t === typeOf(v) || (t === 'number' && typeOf(v) === 'integer');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const resolve = (ref) => {
  if (!ref.startsWith('#/')) throw new Error(`external $ref not supported: ${ref}`);
  return ref.slice(2).split('/').reduce((n, k) => n?.[k], schema);
};

/** Errors of `v` against schema node `s`; iterative over the instance, so instance depth never hits a stack limit. */
function validate(root, v) {
  const errors = [];
  const stack = [[root, v, '$']];
  while (stack.length) {
    const [s, val, at] = stack.pop();
    for (const k of Object.keys(s)) if (!ANNOTATIONS.has(k) && !KEYWORDS.has(k)) throw new Error(`unsupported keyword ${k} at ${at}`);
    if (s.$ref) { const t = resolve(s.$ref); if (!t) throw new Error(`unresolved $ref ${s.$ref}`); stack.push([t, val, at]); }
    if (s.type && ![].concat(s.type).some((t) => typeMatches(val, t))) { errors.push(`${at}: not ${s.type}`); continue; }
    if ('const' in s && !same(val, s.const)) errors.push(`${at}: not ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.some((e) => same(e, val))) errors.push(`${at}: ${JSON.stringify(val)} not in enum`);
    if (typeof val === 'string') {
      if (s.minLength != null && [...val].length < s.minLength) errors.push(`${at}: shorter than ${s.minLength}`);
      if (s.maxLength != null && [...val].length > s.maxLength) errors.push(`${at}: longer than ${s.maxLength}`);
      if (s.pattern && !new RegExp(s.pattern, 'u').test(val)) errors.push(`${at}: does not match ${s.pattern}`);
    }
    if (typeof val === 'number') {
      if (s.minimum != null && val < s.minimum) errors.push(`${at}: below ${s.minimum}`);
      if (s.maximum != null && val > s.maximum) errors.push(`${at}: above ${s.maximum}`);
    }
    if (Array.isArray(val)) {
      if (s.minItems != null && val.length < s.minItems) errors.push(`${at}: fewer than ${s.minItems} items`);
      if (s.maxItems != null && val.length > s.maxItems) errors.push(`${at}: more than ${s.maxItems} items`);
      if (s.uniqueItems && new Set(val.map((x) => JSON.stringify(x))).size !== val.length) errors.push(`${at}: items not unique`);
      if (s.items) val.forEach((x, i) => stack.push([s.items, x, `${at}[${i}]`]));
    }
    if (typeOf(val) === 'object') {
      const keys = Object.keys(val);
      for (const r of s.required || []) if (!(r in val)) errors.push(`${at}: missing ${r}`);
      if (s.maxProperties != null && keys.length > s.maxProperties) errors.push(`${at}: more than ${s.maxProperties} keys`);
      for (const k of keys) {
        if (s.propertyNames) stack.push([s.propertyNames, k, `${at} key ${k}`]);
        if (s.properties && k in s.properties) stack.push([s.properties[k], val[k], `${at}.${k}`]);
        else if (s.additionalProperties === false) errors.push(`${at}: unknown key ${k}`);
        else if (typeOf(s.additionalProperties) === 'object') stack.push([s.additionalProperties, val[k], `${at}.${k}`]);
      }
    }
  }
  return errors;
}
const valid = (doc) => validate(schema, doc);

// ---------------------------------------------------------------- fixtures
const T = '2026-11-13T09:00:00.000Z';
const show = (body, status, priority, due, tags) => ({ body, status, priority, due, tags });
const look = (label, icon, tone, checkbox, s, statuses, childLook) =>
  ({ label, icon, tone, checkbox, show: s, statuses, defaultStatus: 'open', defaultPriority: 0, childLook, fields: [] });
const LOOKS = {
  note: look('Note', 'note', 'neutral', false, show('optional', 'hidden', 'hidden', 'hidden', 'optional'), ['open'], 'note'),
  todo: look('To-do', 'check', 'accent', true, show('optional', 'optional', 'hidden', 'optional', 'optional'), ['open', 'done'], 'todo'),
  task: look('Task', 'task', 'info', true, show('optional', 'required', 'optional', 'optional', 'optional'), ['open', 'doing', 'blocked', 'done'], 'task'),
  list: look('List', 'list', 'neutral', false, show('hidden', 'hidden', 'hidden', 'hidden', 'optional'), ['open'], 'todo'),
  idea: look('Idea', 'bulb', 'warning', false, show('optional', 'hidden', 'hidden', 'hidden', 'optional'), ['open'], 'note'),
};
const item = (id, parent, extra = {}) => ({ id, parent, order: 0, title: id, text: '', createdAt: T, updatedAt: T, ...extra });
const doc = (items, extra = {}) => ({ $axf: 'notes-tasks@1', project: 'amberx-axf', items, looks: LOOKS, ...extra });

/** A single chain `depth` levels deep, cycling through every look; returns the store and the deepest id. */
function chain(depth) {
  const ids = Object.keys(LOOKS);
  const items = {};
  let parent = '';
  for (let d = 0; d < depth; d++) {
    const id = `n${d}`;
    items[id] = item(id, parent, { look: ids[d % ids.length], childLook: ids[(d + 1) % ids.length], ...(d % 2 ? { status: 'open' } : {}) });
    parent = id;
  }
  return { items, leaf: parent };
}
/** Depth of `id` by walking `parent` (iterative; refuses a loop). */
function depthOf(items, id) {
  const seen = new Set();
  let d = 0;
  for (let cur = items[id]; cur && cur.parent; cur = items[cur.parent]) {
    if (seen.has(cur.id)) throw new Error(`cycle at ${cur.id}`);
    seen.add(cur.id);
    d++;
  }
  return d + 1;
}

// ---------------------------------------------------------------- schema shape
check(schema.properties.$axf.const === 'notes-tasks@1', 'format id is notes-tasks@1');
check(same(schema.required, ['$axf', 'items']), 'only $axf and items are required (lists are legacy)');
const itemDef = schema.$defs.item;
check(!['depth', 'level', 'path'].some((k) => k in itemDef.properties), 'depth / path are computed, never stored or capped');
check(Object.keys(itemDef.properties.parent).every((k) => k === 'type' || k === 'description'), 'parent carries no rule limiting what may hold what');
check(!JSON.stringify(schema).includes('maxDepth'), 'no depth limit anywhere in the format');

// ---------------------------------------------------------------- nesting to any depth
{
  const { items, leaf } = chain(12);
  check(depthOf(items, leaf) === 12, 'fixture: chain is 12 levels deep');
  const errs = valid(doc(items));
  check(errs.length === 0, `12 levels, every look holding the next: valid${errs.length ? ` (${errs[0]})` : ''}`);
}
{
  // 10+ levels mixed: at level 11 a list holds one item of every look, each of which holds a note.
  const { items, leaf } = chain(11);
  for (const id of Object.keys(LOOKS)) {
    items[`${leaf}-${id}`] = item(`${leaf}-${id}`, leaf, { look: id });
    items[`${leaf}-${id}-note`] = item(`${leaf}-${id}-note`, `${leaf}-${id}`, { look: 'note', text: 'deep' });
  }
  check(depthOf(items, `${leaf}-task-note`) === 13, 'fixture: mixed tree reaches 13 levels');
  check(valid(doc(items)).length === 0, 'mixed tree at levels 11-13 (every look holds every look): valid');
}
{
  const { items, leaf } = chain(1000);
  check(depthOf(items, leaf) === 1000, 'fixture: chain is 1 000 levels deep');
  check(valid(doc(items)).length === 0, '1 000 levels: valid (the format has no depth limit)');
}
{
  // A to-do nested deep still carries every field (status, priority, due, fields) whatever its depth or holder.
  const { items, leaf } = chain(15);
  items.deepTodo = item('deepTodo', leaf, { look: 'todo', status: 'done', priority: 3, due: '2026-11-20', doneAt: T, fields: { estimate: 2 } });
  check(valid(doc(items)).length === 0, 'a done to-do at level 16 with priority, due and custom fields: valid');
}

// ---------------------------------------------------------------- backward compatibility
{
  // amberx-notes@1 as the phone writes it: lists + items with kind / list / checklist, no look, parent '' or a task id.
  const legacy = {
    $axf: 'notes-tasks@1',
    lists: {
      inbox: { id: 'inbox', name: 'Inbox', parent: null, order: 0, system: 'inbox', createdAt: T, updatedAt: T },
      trip: { id: 'trip', name: 'Trip', parent: 'inbox', order: 1, tone: 'info', aliases: ['holiday'], createdAt: T, updatedAt: T },
    },
    items: {
      t1: { id: 't1', kind: 'task', list: 'trip', title: 'Pack', text: '', tags: [], status: 'doing', priority: 2, due: '',
        checklist: [{ id: 'c1', text: 'socks', done: false }], parent: '', order: 0, createdAt: T, updatedAt: T },
      t2: { id: 't2', kind: 'todo', list: 'trip', title: 'Passport', text: '', tags: [], status: 'open', priority: 0, due: '',
        checklist: [], parent: 't1', order: 1, createdAt: T, updatedAt: T, source: 'voice' },
    },
  };
  const errs = valid(legacy);
  check(errs.length === 0, `amberx-notes@1 rows (lists, kind, list, checklist): valid${errs.length ? ` (${errs[0]})` : ''}`);
}
{
  // The first notes-tasks@1 design (main, Nov 12 2026): settings key `types` with core.checklist / core.subtasks.
  const core = { body: 'optional', status: 'optional', priority: 'optional', due: 'optional', tags: 'optional', checklist: 'optional', subtasks: 'hidden' };
  const kindType = (label) => ({ label, icon: 'note', tone: 'neutral', core, statuses: ['open', 'done'], defaultStatus: 'open', defaultPriority: 0, fields: [] });
  const types = { note: kindType('Note'), todo: kindType('To-do'), task: kindType('Task') };
  const first = { $axf: 'notes-tasks@1', lists: {}, items: {}, types };
  check(valid(first).length === 0, 'first-design document with `types`: valid');
  check(valid({ ...first, looks: LOOKS }).length === 0, 'a document carrying both `types` and `looks`: valid');
  const { task: _drop, ...noTask } = types;
  check(valid({ ...first, types: noTask }).length > 0, 'legacy `types` is still checked (missing task refused)');
  check(valid({ ...first, types: { ...types, idea: kindType('Idea') } }).length > 0, 'legacy `types` has no added kinds');
}

// ---------------------------------------------------------------- what the format still refuses
{
  const { items } = chain(3);
  check(valid(doc({ ...items, x: item('x', 'n2', { look: 'Bad Look' }) })).length > 0, 'a look id that is not a key refuses');
  check(valid(doc({ ...items, x: item('x', 'n2', { depth: 3 }) })).length > 0, 'unknown item field refuses');
  const { list: _l, ...noList } = LOOKS;
  check(valid(doc(items, { looks: noList })).length > 0, 'looks without the built-in `list` refuses');
  const many = { ...LOOKS };
  for (let i = 0; i < 12; i++) many[`extra-${i}`] = LOOKS.idea;
  check(valid(doc(items, { looks: many })).length > 0, 'more than 16 looks refuses');
  check(valid(doc({ ...items, x: item('x', 'n2', { status: '' }) })).length > 0, "status '' refuses");
}

console.log(`notes-tasks: ${ok} checks passed`);
