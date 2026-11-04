/**
 * Agent voice — the client side of the store: profiles, mic settings, pronunciations, agents and cloud status from the
 * server, kept in one module-level snapshot so the console, the live light, the Assistant mic and the speaker all see
 * the same thing. Saves are per profile, debounced, and the snapshot updates at once (the server answer confirms it).
 */
import { useSyncExternalStore } from 'react';
import { pluginFetch } from '@console/plugins';
import { defaultProfile, normMic, normProfile, normStore, type MicSettings, type Pronunciation, type VoiceProfile, type VoiceStore } from './core';
import { FOLDER } from './engine';

export interface AgentInfo { id: string; name: string; icon: string; description?: string }

export interface VoiceData {
  loaded: boolean;
  loading: boolean;
  error: string;
  store: VoiceStore;
  agents: AgentInfo[];
  agentsService: boolean;
  cloud: { openai: boolean; elevenlabs: boolean };
  saving: number;
}

let data: VoiceData = { loaded: false, loading: false, error: '', store: normStore({}), agents: [], agentsService: false, cloud: { openai: false, elevenlabs: false }, saving: 0 };
const subs = new Set<() => void>();
const set = (patch: Partial<VoiceData>) => { data = { ...data, ...patch }; subs.forEach((f) => f()); };
export const voiceData = (): VoiceData => data;
export function onVoiceData(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; }
export const useVoiceData = (): VoiceData => useSyncExternalStore(onVoiceData, voiceData, voiceData);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await pluginFetch(FOLDER, path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = (await r.json()) as { detail?: string }; if (j.detail) msg = j.detail; } catch { /* not JSON */ }
    if (r.status === 404) msg = 'Agent voice is switched off on the server (or not installed there).';
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

let inflight: Promise<void> | null = null;
export function loadVoice(force = false): Promise<void> {
  if (inflight) return inflight;
  if (data.loaded && !force) return Promise.resolve();
  set({ loading: true });
  inflight = call<{ store: unknown; agents: AgentInfo[]; agentsService: boolean; cloud: VoiceData['cloud'] }>('store')
    .then((r) => set({ loaded: true, loading: false, error: '', store: normStore(r.store), agents: r.agents ?? [], agentsService: !!r.agentsService, cloud: r.cloud ?? data.cloud }))
    .catch((e: Error) => set({ loading: false, error: e.message, loaded: data.loaded }))
    .finally(() => { inflight = null; });
  return inflight;
}

export function profileOf(agentId: string): VoiceProfile | null {
  return agentId ? data.store.profiles[agentId] ?? null : null;
}
export const profileOrDefault = (agentId: string): VoiceProfile => profileOf(agentId) ?? defaultProfile(agentId);
export const agentName = (agentId: string): string => data.agents.find((a) => a.id === agentId)?.name ?? agentId;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
function later(key: string, fn: () => Promise<unknown>, ms = 450) {
  const t = timers.get(key);
  if (t) clearTimeout(t);
  set({ saving: data.saving + (t ? 0 : 1) });
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    fn().then(() => set({ error: '' }), (e: Error) => set({ error: e.message })).finally(() => set({ saving: Math.max(0, data.saving - 1) }));
  }, ms));
}

export function saveProfile(p: VoiceProfile, now = false): void {
  const n = normProfile(p, p.agentId);
  set({ store: { ...data.store, profiles: { ...data.store.profiles, [n.agentId]: n } } });
  later(`p:${n.agentId}`, () => call(`profiles/${encodeURIComponent(n.agentId)}`, { method: 'PUT', body: JSON.stringify(n) }), now ? 0 : 450);
}
export function patchProfile(agentId: string, patch: (p: VoiceProfile) => VoiceProfile, now = false): void { saveProfile(patch(profileOrDefault(agentId)), now); }

export async function removeProfile(agentId: string): Promise<void> {
  const profiles = { ...data.store.profiles };
  delete profiles[agentId];
  set({ store: { ...data.store, profiles } });
  await call(`profiles/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
}

export function saveMic(m: MicSettings): void {
  const n = normMic(m);
  set({ store: { ...data.store, mic: n } });
  later('mic', () => call('mic', { method: 'PUT', body: JSON.stringify(n) }));
}

export function savePronunciations(list: Pronunciation[]): void {
  set({ store: { ...data.store, pronunciations: list } });
  later('pron', () => call('pronunciations', { method: 'PUT', body: JSON.stringify(list) }));
}

export async function importVoice(raw: string): Promise<number> {
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new Error('That file isn\'t JSON.'); }
  const r = await call<{ count: number }>('import', { method: 'PUT', body: JSON.stringify(body) });
  await loadVoice(true);
  return r.count;
}

/* ---------------------------------------------------------------- cloud keys + voices */

export interface KeyInfo { id: 'openai' | 'elevenlabs'; set: boolean; stored: boolean; env: boolean; envName: string }
export const getKeys = () => call<{ providers: KeyInfo[] }>('keys').then((r) => r.providers);
export async function putKey(provider: string, key: string): Promise<void> { await call(`keys/${provider}`, { method: 'PUT', body: JSON.stringify({ key }) }); await loadVoice(true); }
export async function deleteKey(provider: string): Promise<void> { await call(`keys/${provider}`, { method: 'DELETE' }); await loadVoice(true); }
export const cloudVoices = (provider: string) => call<{ voices: { id: string; name: string; category?: string }[]; models: string[] }>(`voices/${provider}`);
export const clearCache = () => call<{ removed: number }>('cache', { method: 'DELETE' });
