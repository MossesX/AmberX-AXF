/**
 * `@console/api` in Patches: the few console calls the banner plugins make (the build manager reads the pending list,
 * plan and build queue and ticks steps; the systems check asks whether the console answers). All of them go through
 * Patches' console proxy (`/api/console/<path>`, server/main.py: an allowlist, admins only).
 */
import type { PendingState } from '../axf/plan/pending-core.mjs';
import type { QueueState } from '../axf/plan/build-queue-core.mjs';
import { patchesTokens } from './tokens';

export interface EngineResult { ok: boolean; log?: string[]; error?: string; unauthorized?: boolean; [k: string]: unknown }
export interface PlanFeature { id: string; title?: string; status?: string; [k: string]: unknown }
export interface Plan { generatedAt: string; features: PlanFeature[] }

/** The banner plugins check this before calling: in Patches the console is reached through Patches' own server. */
let backendUp: boolean | null = null;
export const isBackendUp = () => backendUp !== false;
export const getToken = () => patchesTokens.get();
export const TOKEN_CHANGED = patchesTokens.event;

const headers = (json: boolean): Record<string, string> => {
  const h: Record<string, string> = json ? { 'content-type': 'application/json' } : {};
  const t = getToken();
  if (t) h.authorization = `Bearer ${t}`;
  return h;
};

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`/api/console/${path}`, { cache: 'no-store', credentials: 'same-origin', headers: headers(false) });
  backendUp = r.ok || r.status === 401 || r.status === 403;
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

export async function post(path: string, body: unknown): Promise<EngineResult> {
  try {
    const r = await fetch(`/api/console/${path}`, { method: 'POST', credentials: 'same-origin', headers: headers(true), body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as EngineResult & { detail?: string };
    if (r.status === 401) return { ...j, ok: false, unauthorized: true, error: 'Sign in to axHub (or set Patches’ app token).' };
    return r.ok ? { ...j, ok: true } : { ...j, ok: false, error: j.error ?? j.detail ?? r.statusText };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const loadPlan = () => getJson<Plan>('plan');
export const loadPending = () => getJson<PendingState>('pending');
export const loadBuildQueueState = async (): Promise<QueueState | null> => {
  try { const x = await getJson<{ state: QueueState } | QueueState>('build-queue'); return 'state' in x && x.state ? x.state : (x as QueueState); } catch { return null; }
};
