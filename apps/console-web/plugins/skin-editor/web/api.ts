/* Skin editor — web API layer. The server part keeps the registry reads, the snapshot sessions and the exported skins. */
import { pluginApi } from '@console/plugins';
import type { RegistryToken, RegistrySummary, SkinSnapshot, SkinState, SnapshotRow, SkinVoiceIntent } from '@console/axf/core/engines/token-registry.mjs';

export const FOLDER = 'skin-editor';
export const ID = 'ai.amberx.axf.console.skin-editor';

export interface UiPick { kind: 'view' | 'dialog' | 'plugin' | 'element' | 'screen'; id: string; label: string }
export interface Session { ui: UiPick; head: string; chain: SkinSnapshot[]; rows: SnapshotRow[]; state: SkinState; updatedAt: string }
export interface SessionSummary { key: string; ui: UiPick; head: string; snapshots: number; tokens: number; updatedAt: string }
export interface ExportResult { asset: { id: string; name: string; data: Record<string, unknown> & { preview?: { caption?: string; image?: string } } }; mapped: string[]; unmapped: string[]; file: string; hub: HubQueued }
export interface VoiceResult { intent: SkinVoiceIntent | null; ran: boolean; result?: unknown; say: string }
export interface UiListItem extends UiPick { source: string }

const api = pluginApi(FOLDER, 'The skin editor');
const call = <T,>(path: string, init?: RequestInit) => api.call<T>(path, init);
const post = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
const qs = (params: Record<string, string | undefined>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v) u.set(k, v); const s = u.toString(); return s ? `?${s}` : ''; };

export const uiKey = (ui: Pick<UiPick, 'kind' | 'id'>) => `${ui.kind}:${ui.id}`;

export const registry = (params: Record<string, string | undefined> = {}) => call<{ total: number; hits: number; tokens: RegistryToken[] }>(`registry${qs(params)}`);
export const registrySummary = () => call<RegistrySummary>('registry/summary');
export const uis = () => call<{ uis: UiListItem[] }>('uis');
export const state = () => call<{ current: SessionSummary | null; sessions: number }>('state');
export const sessions = () => call<{ sessions: SessionSummary[] }>('sessions');
export const session = (ui: UiPick) => call<Session>(`sessions/${encodeURIComponent(uiKey(ui))}`);
export const pick = (ui: UiPick) => post<Session>(`sessions/${encodeURIComponent(uiKey(ui))}/pick`, { label: ui.label });
export const edit = (ui: UiPick, edits: { token: string; to: string | number | null }[], by = 'skin-editor') => post<Session & { snapshot: SkinSnapshot | null }>(`sessions/${encodeURIComponent(uiKey(ui))}/edit`, { edits, by });
export interface SnapshotHead { id: string; label: string; at: string; by: string; kind: string }
export interface SnapshotDetail extends SnapshotHead { parent: string | null; edits: { token: string; from: string | number | boolean | null; to: string | number | boolean | null }[]; state: SkinState; tokens: number }
export interface Comparison { a: SnapshotHead; b: SnapshotHead; changes: SnapshotDetail['edits'] }
export const snapshot = (ui: UiPick, id: string) => call<SnapshotDetail>(`sessions/${encodeURIComponent(uiKey(ui))}/snapshots/${encodeURIComponent(id)}`);
export const compare = (ui: UiPick, a: string, b = 'head') => call<Comparison>(`sessions/${encodeURIComponent(uiKey(ui))}/compare${qs({ a, b })}`);
export const revert = (ui: UiPick, body: { snapshot?: string; minutesAgo?: number; at?: string }) => post<Session & { snapshot: SkinSnapshot | null }>(`sessions/${encodeURIComponent(uiKey(ui))}/revert`, body);
export const undo = (ui: UiPick) => post<Session & { snapshot: SkinSnapshot | null }>(`sessions/${encodeURIComponent(uiKey(ui))}/undo`);
export const exportSkin = (ui: UiPick, body: { id?: string; name: string; description?: string; snapshot?: string; base?: Record<string, unknown> }) => post<ExportResult>(`sessions/${encodeURIComponent(uiKey(ui))}/export`, body);
export interface SkinListItem { id: string; name: string; description: string; tokens: number; file: string; locked: boolean; builtIn: boolean }
export const skins = () => call<{ skins: SkinListItem[] }>('skins');
export interface HubItem { id: string; status: 'queued' | 'sent' | 'failed'; queuedAt: string; sentAt: string; error: string }
export interface HubQueued { queued: boolean; project?: string; folder?: string; table?: string }
export const skin = (id: string) => call<Record<string, unknown>>(`skins/${encodeURIComponent(id)}`);
export const hub = () => call<{ project: string; folder: string; table: string; items: HubItem[]; queued: number }>('hub');
export const sendToHub = (id: string) => post<HubQueued>(`skins/${encodeURIComponent(id)}/hub`);
export const hubResult = (id: string, body: { ok: boolean; error?: string }) => post<HubItem>(`hub/${encodeURIComponent(id)}/result`, body);
export const deleteSkin = (id: string) => call<{ ok: true }>(`skins/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const voice = (phrase: string, ui?: UiPick, dry = false) => post<VoiceResult>('voice', { phrase, ui: ui ? uiKey(ui) : undefined, dry });
