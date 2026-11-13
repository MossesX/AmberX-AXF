/** Shared bits of the Icon map plugin: server calls, the pack list, the selected slot. */
import type { AxfRuntime } from '@console/axf/core';
import { pluginFetch } from '@console/plugins';
import { createHubData, type HubValue } from '@console/axf/libs/hubstore';
import { resolveHubSync, savedConnection } from '@console/axf/libs/hubsync';

/** The folder under plugins/ — the server routes live at /api/plugins/icon-map/. */
export const FOLDER = 'icon-map';
export const VIEW = 'icon-map';
/** Fired on window when the state changed (the page re-reads). */
export const CHANGED = 'axf:icon-map-changed';
/** Fired on window when another place asked to open a slot (the page shows its panel). */
export const SELECTED = 'axf:icon-map-selected';

export interface Slot { id: string; kind: string; role: string; glyph: string; surface: string; label: string; app: string; owner: string; ownerKind: string; screen: string; source: string; file: string; line: number; picked?: string }
export interface MapAnswer { ok: boolean; slots: Slot[]; total: number; counts?: { bySurface?: Record<string, number>; byApp?: Record<string, number>; byKind?: Record<string, number> }; pack: string }
export interface State { ok: boolean; pack: string; slots: Record<string, string>; skinPacks?: Record<string, string>; hubPacks?: HubPackRow[] }
export interface HubPackRow { id: string; name: string; style: string; themable: boolean; by?: string; at?: string }
export interface PackRow { id: string; name: string; style: string; themable: boolean; covers: string[] }

const json = async <T,>(r: Response): Promise<T> => { if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`); return (await r.json()) as T; };
export const get = <T,>(path: string) => pluginFetch(FOLDER, path).then((r) => json<T>(r));
export const send = <T,>(method: 'PUT' | 'DELETE' | 'POST', path: string, body: unknown = {}) => pluginFetch(FOLDER, path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<T>(r));
export const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');

/** The icon packs this app ships (registry assets of type icon-pack). */
export function packsOf(rt: AxfRuntime): PackRow[] {
  return rt.registry.all().filter((a) => a.type === 'icon-pack').map((a) => {
    const d = (a.data ?? {}) as { style?: string; themable?: boolean; covers?: string[] };
    return { id: a.id, name: a.name || a.id, style: d.style ?? 'outline', themable: d.themable !== false, covers: d.covers ?? ['icons'] };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

let selected: string | null = null;
/** The slot the page's panel shows (set by a click, the icon-map.slot.open action or the axf.icon-map@1 service). */
export const selectedSlot = () => selected;
export function setSelectedSlot(id: string | null): void {
  selected = id;
  window.dispatchEvent(new Event(SELECTED));
}

/** A shared icon pack on axHub: the summary plus the whole asset. */
export type HubPack = { id: string; name: string; style: string; themable: boolean; by: string; at: string; pack: HubValue } & Record<string, HubValue>;

/**
 * The axHub table of shared icon packs (hubstore data API, the axHub sync connection's hub and project, folder
 * icon-packs, table packs; 64 KB per file, the browser's own hub session). Every app on that project sees the same rows.
 */
export function hubPacks(rt: AxfRuntime) {
  const c = resolveHubSync(null, savedConnection(rt));
  return createHubData({ hub: c.hub, project: c.project, mode: 'all', folder: 'icon-packs', appId: 'console' }).table<HubPack>('packs');
}
