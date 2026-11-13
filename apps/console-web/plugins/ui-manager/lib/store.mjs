/**
 * The UI Manager's saved state, all of it in the plugin's data folder (plugin-lifecycle@1):
 *   overrides.json   ui-overrides@1: what Brett applied (only the properties that differ from the skin / default)
 *   changes.jsonl    ui-change@1 entries, one per Apply (who, when, element, property, old → new), undo per entry
 * AXF_UI_MANAGER_DIR points the folder somewhere else (tests).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { changeEntry, diffOverrides, normalizeOverrides, undoChange } from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { DATA_DIR } from './common.mjs';

export const OVERRIDES_FILE = () => join(DATA_DIR, 'overrides.json');
export const CHANGES_FILE = () => join(DATA_DIR, 'changes.jsonl');
export const CHANGES_MAX = 2000;

export function readOverrides() {
  try { return normalizeOverrides(JSON.parse(readFileSync(OVERRIDES_FILE(), 'utf8'))); } catch { return normalizeOverrides(null); }
}

function writeJson(file, value) {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Save a document and log what changed against the saved one. → { doc, entry | null } (no entry when nothing changed). */
export function saveOverrides(nextRaw, { by = 'brett', at = new Date().toISOString(), note = '' } = {}) {
  const before = readOverrides();
  const doc = normalizeOverrides(nextRaw);
  const changes = diffOverrides(before, doc);
  if (!changes.length) return { doc: before, entry: null };
  doc.updatedAt = at;
  doc.updatedBy = by;
  writeJson(OVERRIDES_FILE(), doc);
  const entry = changeEntry(changes, { by, at, note });
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  appendFileSync(CHANGES_FILE(), `${JSON.stringify(entry)}\n`);
  return { doc, entry };
}

export function readChanges({ limit = 200 } = {}) {
  if (!existsSync(CHANGES_FILE())) return [];
  const rows = readFileSync(CHANGES_FILE(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.$axf === 'ui-change@1');
  const undone = new Set(rows.filter((e) => e.undoes).map((e) => e.undoes));
  return rows.map((e) => ({ ...e, undone: e.undone || undone.has(e.id) })).reverse().slice(0, Math.max(1, Math.min(limit, CHANGES_MAX)));
}

/** Undo one entry: the overrides go back to that entry's `from` values; the undo is itself logged (and points at it). */
export function undoEntry(id, { by = 'brett', at = new Date().toISOString() } = {}) {
  const entry = readChanges({ limit: CHANGES_MAX }).find((e) => e.id === id);
  if (!entry) return { error: `no change ${id}` };
  if (entry.undone) return { error: `change ${id} is already undone` };
  const before = readOverrides();
  const doc = undoChange(before, entry);
  const changes = diffOverrides(before, doc);
  doc.updatedAt = at;
  doc.updatedBy = by;
  writeJson(OVERRIDES_FILE(), doc);
  const undo = { ...changeEntry(changes, { by, at, note: `undo ${id}` }), undoes: id };
  appendFileSync(CHANGES_FILE(), `${JSON.stringify(undo)}\n`);
  return { doc, entry: undo };
}
