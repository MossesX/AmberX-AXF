/**
 * lib-hubstore pure rules (no fetch, no storage): config from the installed library, names and paths, which tables
 * live on axHub, the settings document and per-key merge, table documents and chunking. `index.ts` holds the classes.
 */
import { partOn, partParams, type LibraryPart } from '../../core/library';
import spec from './library.json';

export const HUBSTORE_LIBRARY_ID = 'ai.amberx.axf.hubstore';
export const HUBSTORE_DEFAULT_HUB = 'https://axhub.amberxai.com';
/** axHub's data server refuses files over 64 KB; tables are split well under it. */
export const HUB_FILE_MAX = 64_000;
export const TABLE_CHUNK = 48_000;
export const SETTINGS_FORMAT = 'hub-settings@1';
export const TABLE_FORMAT = 'hub-table@1';
export const PARTS = (spec as { parts: LibraryPart[] }).parts;

export type DataMode = 'all' | 'some';
export interface HubstoreConfig {
  hub: string;
  project: string;
  settings: false | { file: string; mirror: boolean };
  data: false | { mode: DataMode; tables: string[]; folder: string };
}

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
/** A table, project or folder name: letters, digits, `.`, `_`, `-`, starting with a letter or digit, ≤ 64 chars, no `..`. */
export const isSafeName = (s: unknown): s is string => typeof s === 'string' && NAME.test(s) && !s.includes('..');
/** A path inside a hub project: safe names joined by `/`, ending in `.json`. */
export const isSafePath = (s: unknown): s is string => typeof s === 'string' && s.endsWith('.json') && s.split('/').every(isSafeName);

/** The hub's origin, https only (http for localhost/127.0.0.1); null when refused. */
export function hubOriginOf(url: unknown): string | null {
  try {
    const u = new URL(String(url));
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.username || u.password) return null;
    if (u.protocol === 'https:' || (local && u.protocol === 'http:')) return u.origin;
  } catch { /* not a URL */ }
  return null;
}

export function dataUrl(hub: string, project: string, path: string): string {
  if (!isSafeName(project)) throw new Error(`hubstore: "${project}" isn't a hub project name`);
  if (!isSafePath(path)) throw new Error(`hubstore: "${path}" isn't a safe path inside the project`);
  return `${hub}/data/${project}/${path}`;
}

/** Read an installed `libraries.hubstore` block (parts missing = the defaults: settings on, data off). */
export function resolveHubstoreConfig(installed: ({ parts?: Record<string, unknown> } & Record<string, unknown>) | null | undefined, appProject = ''): HubstoreConfig {
  const on = (id: string) => partOn(installed, id, PARTS);
  const pp = (id: string) => partParams(installed, id, PARTS.find((p) => p.id === id));
  const hub = hubOriginOf(installed?.hub ?? HUBSTORE_DEFAULT_HUB) ?? HUBSTORE_DEFAULT_HUB;
  const project = String(installed?.project || appProject || '');
  const s = pp('settings');
  const d = pp('data');
  const tables = (Array.isArray(d.tables) ? d.tables : String(d.tables ?? '').split(',')).map((x) => String(x).trim()).filter(isSafeName);
  return {
    hub, project,
    settings: on('settings') ? { file: isSafePath(s.file) ? s.file : 'settings/app.json', mirror: s.mirror !== false } : false,
    data: on('data') ? { mode: d.mode === 'some' ? 'some' : 'all', tables: [...new Set(tables)], folder: isSafeName(d.folder) ? d.folder : 'data' } : false,
  };
}

/** Is this table kept on axHub (else on this device)? */
export function tableOnHub(cfg: Pick<HubstoreConfig, 'data'>, table: string): boolean {
  if (!cfg.data) return false;
  return cfg.data.mode === 'all' || cfg.data.tables.includes(table);
}

/* ---------- settings document ---------- */

export type HubValue = string | number | boolean | null | HubValue[] | { [k: string]: HubValue };
export interface SettingsDoc { $axf: typeof SETTINGS_FORMAT; values: Record<string, HubValue>; updatedAt: string; updatedBy: string }

export const emptySettings = (): SettingsDoc => ({ $axf: SETTINGS_FORMAT, values: {}, updatedAt: '', updatedBy: '' });

/** Text from the hub → a settings document; anything else (wrong frame, not an object) → an empty one. */
export function parseSettings(raw: unknown): SettingsDoc {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o || o.$axf !== SETTINGS_FORMAT || !o.values || typeof o.values !== 'object' || Array.isArray(o.values)) return emptySettings();
  return { $axf: SETTINGS_FORMAT, values: { ...(o.values as Record<string, HubValue>) }, updatedAt: String(o.updatedAt ?? ''), updatedBy: String(o.updatedBy ?? '') };
}

/** One app's change over the latest document: per key, last save wins; `null` removes a key; other keys are kept. */
export function mergeSettings(base: SettingsDoc, change: Record<string, HubValue | undefined>, by: string, now: string): SettingsDoc {
  const values = { ...base.values };
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined) continue;
    if (v === null) delete values[k]; else values[k] = v;
  }
  return { $axf: SETTINGS_FORMAT, values, updatedAt: now, updatedBy: by };
}

/* ---------- tables ---------- */

export type Row = Record<string, HubValue>;
export interface TableHead { $axf: typeof TABLE_FORMAT; table: string; chunks: number; count: number; updatedAt: string }

/** Split rows into pieces whose JSON stays under `max` bytes (a single oversized row gets a piece of its own). */
export function chunkRows(rows: Record<string, Row>, max = TABLE_CHUNK): Record<string, Row>[] {
  const out: Record<string, Row>[] = [{}];
  let size = 2;
  for (const [k, v] of Object.entries(rows)) {
    const n = JSON.stringify(k).length + JSON.stringify(v).length + 2;
    if (size + n > max && Object.keys(out[out.length - 1]!).length) { out.push({}); size = 2; }
    out[out.length - 1]![k] = v;
    size += n;
  }
  return out;
}

export const tableHeadPath = (folder: string, table: string) => `${folder}/${table}/head.json`;
export const tableChunkPath = (folder: string, table: string, i: number) => `${folder}/${table}/rows-${i}.json`;
