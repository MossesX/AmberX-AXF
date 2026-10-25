/**
 * lib-hubsync pure rules (no fetch, no storage): one app's whole sync with axHub — the shared look (appearance@1,
 * `shared/settings/appearance.json`, the same document every developer app reads), this app's settings
 * (hub-settings@1 at `shared/settings/apps/<app>.json`, the same on every device) and, if picked, its data tables
 * (hub-table@1 in `shared/data-<app>/`). The connection (hub address, project, what syncs) is the one thing kept on the
 * device: it's what finds the hub. `index.tsx` holds the runtime side and the settings interface.
 */
import { hubOriginOf, isSafeName } from '../hubstore/core';

export const HUBSYNC_LIBRARY_ID = 'ai.amberx.axf.hubsync';
export const HUBSYNC_DEFAULT_HUB = 'https://axhub.amberxai.com';
export const HUBSYNC_DEFAULT_PROJECT = 'shared';
/** The device-only setting holding the connection (never mirrored to the hub). */
export const CONNECTION_KEY = 'axf.hubsync.connection';
export const MAX_TABLES = 40;

/**
 * look: `required` = the app waits for the hub (developer apps, same as manifest `developer.hub`); `follow` = the
 * same document, applied and saved, but the app runs while the hub is down; `off` = this app keeps its own look.
 */
export type LookMode = 'required' | 'follow' | 'off';
export type DataMode = 'off' | 'all' | 'some';

export interface HubSyncConfig {
  hub: string;
  project: string;
  look: LookMode;
  settings: boolean;
  data: DataMode;
  tables: string[];
}

export const LOOK_MODES: { id: LookMode; label: string; hint: string }[] = [
  { id: 'required', label: 'Always from axHub', hint: 'The app waits for axHub before it opens, so its look always matches.' },
  { id: 'follow', label: 'Follow axHub', hint: 'Same look as every other app, but the app still opens while axHub is down.' },
  { id: 'off', label: 'Off', hint: 'This app keeps its own look on this device.' },
];
export const DATA_MODES: { id: DataMode; label: string; hint: string }[] = [
  { id: 'off', label: 'On this device', hint: 'App data stays on this device.' },
  { id: 'all', label: 'All on axHub', hint: 'Every table the app keeps lives on axHub.' },
  { id: 'some', label: 'Some on axHub', hint: 'Only the tables listed below live on axHub.' },
];

const DEFAULTS: HubSyncConfig = { hub: HUBSYNC_DEFAULT_HUB, project: HUBSYNC_DEFAULT_PROJECT, look: 'follow', settings: true, data: 'off', tables: [] };

const asLook = (v: unknown, d: LookMode): LookMode => (v === 'required' || v === 'follow' || v === 'off' ? v : d);
const asData = (v: unknown, d: DataMode): DataMode => {
  if (v === 'off' || v === 'all' || v === 'some') return v;
  if (v === false) return 'off';
  if (v === true) return 'all';
  if (Array.isArray(v)) return 'some';
  return d;
};
const asTables = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(isSafeName))].slice(0, MAX_TABLES);

/**
 * The config in force: built-in defaults ← the app's manifest (`libraries.hubsync`) ← what the person saved on this
 * device. Anything unusable falls back to the layer below; an http hub is refused (except localhost).
 */
export function resolveHubSync(manifest: unknown, saved?: unknown): HubSyncConfig {
  const layer = (base: HubSyncConfig, raw: unknown): HubSyncConfig => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    const o = raw as Record<string, unknown>;
    const data = 'data' in o ? asData(o.data, base.data) : base.data;
    const tables = Array.isArray(o.data) ? asTables(o.data) : 'tables' in o ? asTables(o.tables) : base.tables;
    return {
      hub: hubOriginOf(o.hub ?? base.hub) ?? base.hub,
      project: isSafeName(o.project) ? o.project : base.project,
      look: asLook(o.look, base.look),
      settings: typeof o.settings === 'boolean' ? o.settings : base.settings,
      data,
      tables,
    };
  };
  return layer(layer(DEFAULTS, manifest), saved);
}

/** Problems with a config typed into the settings interface (empty = fine). */
export function hubSyncErrors(raw: { hub?: unknown; project?: unknown; data?: unknown; tables?: unknown }): string[] {
  const out: string[] = [];
  if (raw.hub !== undefined && !hubOriginOf(raw.hub)) out.push('The axHub address must start with https:// (http only for localhost).');
  if (raw.project !== undefined && !isSafeName(raw.project)) out.push('The hub project is a folder name: letters, digits, dots, dashes, underscores.');
  if (raw.data === 'some' && asTables(raw.tables).length === 0) out.push('List at least one table, or pick All on axHub.');
  return out;
}

/** Where this app's settings and data live inside the hub project (shared by every device of the app). */
export const settingsFileFor = (appId: string) => `settings/apps/${isSafeName(appId) ? appId : 'app'}.json`;
export const dataFolderFor = (appId: string) => `data-${isSafeName(appId) ? appId : 'app'}`.slice(0, 64);

/** The hub's sign-in page, coming back to its home page. */
export const signInUrl = (hub: string) => `${hub}/auth/login?rd=%2F`;

/** Plain-words summary for the status line. */
export function describeSync(c: HubSyncConfig): string {
  const parts: string[] = [];
  if (c.look !== 'off') parts.push(c.look === 'required' ? 'look (waits for axHub)' : 'look');
  if (c.settings) parts.push('settings');
  if (c.data === 'all') parts.push('all data');
  if (c.data === 'some') parts.push(`data: ${c.tables.join(', ')}`);
  return parts.length ? `Syncing ${parts.join(', ')} with ${c.hub}` : 'Nothing syncs with axHub';
}

/**
 * A "follow" look source never makes the app wait: the runtime sees `ready` whatever the hub says (the real state is
 * kept for the settings interface). Pure mapping, shared with the Kotlin twin in Voice Vault.
 */
export function followState<S extends { status: string }>(real: S): { status: 'ready'; version: string | null } {
  return { status: 'ready', version: real.status === 'ready' ? ((real as unknown as { version?: string | null }).version ?? null) : null };
}
