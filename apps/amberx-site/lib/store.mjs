/** Tiny JSON file store: read with a default, write atomically (temp file + rename). */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson(file, dflt) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return structuredClone(dflt); }
}

export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}
