/**
 * The offline index on disk (control-registry@1): _claude/builds/registry/index.json, written by `index.mjs build`,
 * read by anything that must work without the console (the CLI offline, a phone, a build). Change detection compares
 * the file with a fresh collection; export / import move the file whole, checked against the schema and its hashes.
 * No AI anywhere here.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildIndex, diffIndex, exportIndex, importIndex, serializeIndex, validateIndex } from '../../../../framework/core/engines/control-registry.mjs';
import { ROOT, collectAll } from './collect.mjs';

export const REGISTRY_DIR = process.env.AXF_REGISTRY_DIR || join(ROOT, '_claude', 'builds', 'registry');
export const INDEX_FILE = process.env.AXF_REGISTRY_INDEX || join(REGISTRY_DIR, 'index.json');
export const SCHEMA_FILE = join(ROOT, 'contracts', 'control-registry@1.schema.json');

let schemaCache = null;
/** The contract's JSON Schema (cached). */
export function loadSchema() { if (!schemaCache) schemaCache = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')); return schemaCache; }

/** The commit the sources are at ('' outside git). */
export function headCommit() { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } }

/** A fresh index from the collectors. → { index, errors } (errors = declaration problems, the index is still built). */
export function freshIndex({ apps = null, collectors, now = new Date() } = {}) {
  const r = collectAll({ apps, ...(collectors ? { collectors } : {}) });
  const index = buildIndex(r.entries, { now, commit: headCommit(), collectors: r.collectors, owners: r.owners });
  return { index, errors: r.errors };
}

/** The index on disk, or null when there is none (or it does not read). */
export function readIndex(file = INDEX_FILE) {
  if (!existsSync(file)) return null;
  const r = importIndex(readFileSync(file, 'utf8'), null);
  return r.ok ? r.index : null;
}

/** Write an index atomically. */
export function writeIndex(index, file = INDEX_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, serializeIndex(index));
  renameSync(tmp, file);
  return file;
}

/** What changed since the index on disk was written: { stale, diff, fresh, stored }. No file = everything is new. */
export function changes({ file = INDEX_FILE, apps = null } = {}) {
  const stored = readIndex(file);
  const { index: fresh, errors } = freshIndex({ apps });
  const diff = diffIndex(stored ?? { entries: [] }, fresh);
  return { stale: !stored || !diff.same, diff, fresh, stored, errors };
}

/** The index as an export file (the index plus exportedAt), written to `to`. */
export function exportTo(to, index = readIndex() ?? freshIndex().index) {
  mkdirSync(dirname(resolve(to)), { recursive: true });
  writeFileSync(to, exportIndex(index));
  return { file: to, hash: index.hash, entries: index.entries.length };
}

/** An export back in: validated against the schema and its hashes before it replaces the index on disk. → { ok, errors, hash? }. */
export function importFrom(from, { file = INDEX_FILE, write = true } = {}) {
  if (!existsSync(from)) return { ok: false, errors: [`${from} does not exist`] };
  const r = importIndex(readFileSync(from, 'utf8'), loadSchema());
  if (!r.ok) return r;
  if (write) writeIndex(r.index, file);
  return { ok: true, errors: [], hash: r.index.hash, entries: r.index.entries.length, written: write ? file : '' };
}

/** Validate the index on disk (or a given one) against the schema and the hash rules. */
export function checkIndex(index = readIndex()) {
  if (!index) return { ok: false, errors: [`no index at ${INDEX_FILE} (run: node apps/console-web/lib/registry/index.mjs build)`] };
  const errors = validateIndex(loadSchema(), index);
  return { ok: !errors.length, errors };
}

export const here = () => dirname(fileURLToPath(import.meta.url));
