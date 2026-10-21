/* Feature assistant — web API layer and a tiny status cache the context menu reads synchronously. */
import { pluginApi } from '@console/plugins';

export const FOLDER = 'feature-assist';
export const ID = 'ai.amberx.axf.console.feature-assist';

export interface Status { assistant: boolean; agents: boolean; expert: boolean; mosses: boolean; mossesName?: string; expertName?: string; containers: boolean; snapshots: boolean; describe: boolean; build: boolean; building: Record<string, { model: string; at: number; title?: string }> }
export interface Draft { title: string; summary: string; area: string; kind: 'epic' | 'feature' | 'task'; parent: string; dependsOn: string[]; ports: Record<string, string>; capabilities: string[]; acceptance: string[]; priority: string; model: 'fable' | 'opus' | 'sonnet'; modelReason: string; where: string; subFeatures: Draft[] }
export interface DraftResult { features: Draft[]; clashes: { text: string; featureId?: string }[]; notes: string; agent?: string; llmModel?: string }
export interface BuildPlan {
  feature: { id: string; title: string; summary?: string; status?: string };
  plan: { summary: string; steps: string[]; files: string[]; modules: string[]; assets: string[]; risks: string[]; prerequisites: string[] };
  order: { target: string | null; before: string[]; after: string[]; moved: string[]; titles: Record<string, string>; changed: boolean };
  model: { recommend: 'fable' | 'opus' | 'sonnet'; reason: string }; agent?: string; llmModel?: string;
}

const api = pluginApi(FOLDER, 'The feature assistant');
export const call = <T,>(path: string, init?: RequestInit) => api.call<T>(path, init);
export const post = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

/* status + plan-feature statuses, cached for the context menu (which must answer synchronously) */
let status: Status | null = null;
const featureStatus = new Map<string, string>();
const subs = new Set<() => void>();
export const getStatus = () => status;
export const onStatus = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export async function refreshStatus() {
  try { status = await call<Status>('status'); } catch { status = null; }
  subs.forEach((f) => f());
  return status;
}
export const rememberFeatures = (fs: { id: string; status: string }[]) => { for (const f of fs) featureStatus.set(f.id, f.status); };
export const featureBuilt = (id: string) => featureStatus.get(id) === 'built';
export const knownFeature = (id: string) => featureStatus.has(id);
export const planChanged = () => globalThis.dispatchEvent(new Event('axf:plan-changed'));
