/** Phone Connect's REST client: every answer is JSON, a wire error is { ok: false, error: { code, message, retryable } }. */
import { pluginApi } from '@console/plugins';

export const FOLDER = 'phone-connect';
const api = pluginApi(FOLDER, 'Phone Connect');

export interface WireError { code: string; message: string; retryable: boolean }
export interface Device {
  deviceId: string; name: string; app: string; appVersion: string; state: 'unpaired' | 'pending' | 'paired' | 'revoked';
  capabilities: string[]; presence: string; online: boolean; pairedAt: string; lastSeenAt: string; revokedAt: string;
  owner: { kind: string; who: string } | ''; watch: { on: boolean; ring: boolean }; urlPolicy: { mode: 'own' | 'allowlist' | 'any'; allowlist: string[] };
  token: { prefix: string; issuedAt: string; rotatedAt: string } | null; capabilityState: Record<string, Record<string, unknown>>;
}
export interface Pairing { code: string; expiresAt: string; secondsLeft: number; state: string; claimUrl: string; pairPage: string }
/** The link in one word: `disconnected` = the console refused the phone's key, so it will not come back until it pairs again. */
export interface Link { state: 'connected' | 'offline' | 'disconnected' | 'not-paired'; message: string; repair: string; rejected: { at: string; count: number; code: string } | null }
/** What the approvals watcher last did (it pushes new axHub approvals to the phone, console open or not). */
export interface Watcher { ok: boolean; watching: boolean; message: string; at: string; code?: string }
export interface Status {
  ok: boolean; paired: boolean; presence: string; online: boolean; device: Device | null; devices: number; pairing: Pairing | null;
  link?: Link; approvals?: Watcher; lastSeenAt?: string;
  features: Record<string, boolean>; recorder: { running?: boolean; session?: string; since?: string; parts?: number; mic?: boolean }; origin: string;
}
export interface Feature { label: string; description: string }

export async function phone<T = Record<string, unknown>>(path: string, body?: unknown, method?: string): Promise<T & { ok?: boolean; error?: WireError }> {
  const r = await api.fetch(path, { method: method ?? (body === undefined ? 'GET' : 'POST'), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    return (await r.json()) as T & { ok?: boolean; error?: WireError };
  } catch {
    return { ok: false, error: { code: 'unexpected', message: `The console answered ${r.status}.`, retryable: false } } as T & { ok?: boolean; error?: WireError };
  }
}
