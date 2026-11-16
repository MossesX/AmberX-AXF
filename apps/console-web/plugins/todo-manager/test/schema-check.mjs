/**
 * A small JSON Schema 2020-12 checker for the tests: it implements exactly the keywords schema/todo-tree.json uses and
 * refuses any other, so a keyword added to the schema later can never be skipped silently.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../core/todo-tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const schema = JSON.parse(readFileSync(join(here, '../schema/todo-tree.json'), 'utf8'));

const KNOWN = new Set(['$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'minimum', 'maxItems', 'minItems', 'required', 'properties', 'additionalProperties', 'oneOf', '$ref', 'items', '$defs']);

function resolve(ref) {
  assert.ok(ref.startsWith('#/'), `only local refs: ${ref}`);
  return ref.slice(2).split('/').reduce((o, k) => o[k], schema);
}

export function check(value, sch, path, errors) {
  for (const k of Object.keys(sch)) assert.ok(KNOWN.has(k), `schema keyword ${k} at ${path} is not implemented by this test`);
  if (sch.$ref) return check(value, resolve(sch.$ref), path, errors);
  if (sch.oneOf) {
    const hits = sch.oneOf.filter((s) => { const e = []; check(value, s, path, e); return e.length === 0; }).length;
    if (hits !== 1) errors.push(`${path}: matches ${hits} of oneOf`);
    return;
  }
  if (sch.const !== undefined && value !== sch.const) errors.push(`${path}: expected ${JSON.stringify(sch.const)}`);
  if (sch.enum && !sch.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (sch.type) {
    const t = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) && sch.type === 'integer' ? 'integer' : typeof value;
    if (t !== sch.type) { errors.push(`${path}: expected ${sch.type}, got ${t}`); return; }
  }
  if (typeof value === 'string') {
    if (sch.pattern && !new RegExp(sch.pattern).test(value)) errors.push(`${path}: "${value.slice(0, 30)}" fails ${sch.pattern}`);
    if (sch.minLength != null && value.length < sch.minLength) errors.push(`${path}: too short`);
    if (sch.maxLength != null && value.length > sch.maxLength) errors.push(`${path}: too long`);
  }
  if (typeof value === 'number' && sch.minimum != null && value < sch.minimum) errors.push(`${path}: below minimum`);
  if (Array.isArray(value)) {
    if (sch.maxItems != null && value.length > sch.maxItems) errors.push(`${path}: too many items`);
    if (sch.minItems != null && value.length < sch.minItems) errors.push(`${path}: too few items`);
    if (sch.items) value.forEach((v, i) => check(v, sch.items, `${path}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of sch.required ?? []) if (!(r in value)) errors.push(`${path}: missing ${r}`);
    for (const [k, v] of Object.entries(value)) {
      if (sch.properties && k in sch.properties) check(v, sch.properties[k], `${path}.${k}`, errors);
      else if (sch.additionalProperties === false) errors.push(`${path}: unknown property ${k}`);
      else if (sch.additionalProperties && typeof sch.additionalProperties === 'object') check(v, sch.additionalProperties, `${path}.${k}`, errors);
    }
  }
}

/** Asserts the document matches schema/todo-tree.json (after a JSON round trip) and the engine's validate(). */
export function conforms(doc, label) {
  const errors = [];
  check(JSON.parse(JSON.stringify(doc)), schema, '$', errors);
  assert.deepEqual(errors, [], `${label}: schema errors`);
  const v = validate(doc);
  assert.deepEqual(v.errors, [], `${label}: validate errors`);
}
