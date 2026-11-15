/**
 * Open a shipped feature in the live console (the Open button, the row context item, the feature.open action, the
 * deep link). The target comes from the server (GET features/{id}/open-target: a console-control@1 address checked
 * against the console's registry, or the reason there is none), so the page, REST, MCP, the CLI and voice agree.
 * Pressing it sends POST features/{id}/open (console-control open, audited); when no console answers that way (the
 * Console commands plugin is off), this console opens the address itself.
 */
import type { AxfRuntime } from '@console/axf/core';
import { executeControl } from '@console/control/executor';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'shipped-features';
const api = pluginApi(FOLDER, 'Shipped features', { unavailable: 'Shipped features is switched off or its server part is not running.' });

export interface OpenTarget { feature?: string; name?: string; status?: string; target: string | null; label?: string; via?: string; code?: string; reason?: string }
export interface FindAnswer { q: string; match: { id: string; name: string; status: string } | null; alternatives: { id: string; name: string; status: string }[]; ambiguous: boolean }

const cache = new Map<string, Promise<OpenTarget>>();
let all: Promise<Record<string, OpenTarget>> | null = null;
let allAt = 0;
const ALL_TTL_MS = 120_000;

/** Every feature's target in one call (the grid's Open buttons), kept for two minutes. */
export function allOpenTargets(fresh = false): Promise<Record<string, OpenTarget>> {
  if (fresh || !all || Date.now() - allAt > ALL_TTL_MS) {
    allAt = Date.now();
    all = api.call<{ targets: Record<string, OpenTarget> }>('features/open-targets').then((r) => r.targets, () => { all = null; return {}; });
  }
  return all;
}

/** Where a feature opens (from the grid's batch when it has it, else asked alone; `fresh` asks again). */
export function openTarget(id: string, fresh = false): Promise<OpenTarget> {
  if (fresh || !cache.has(id)) {
    cache.set(id, (fresh ? Promise.resolve<Record<string, OpenTarget>>({}) : allOpenTargets()).then((m) => m[id] ?? api.call<OpenTarget>(`features/${encodeURIComponent(id)}/open-target`))
      .catch((e: Error) => { cache.delete(id); return { target: null, code: 'error', reason: e.message }; }));
  }
  return cache.get(id)!;
}

/** The targets of one build's features (the Gate's Pending features rows, through the feature.open slot). */
export const buildOpenTargets = (build: string) => api.call<{ build: string; features: OpenTarget[] }>(`builds/${encodeURIComponent(build)}/open-targets`).then((r) => r.features);

/** A feature named by id or in words. */
export const findFeature = (q: string) => api.call<FindAnswer>(`features/find?q=${encodeURIComponent(q)}`);

/** Open one feature by id: the console-control open through the server, else this console. Says what happened. */
export async function openFeature(rt: AxfRuntime, id: string): Promise<boolean> {
  const t = { name: id, ...(await openTarget(id)) };
  if (!t.target) { rt.toast(`${t.name || id} can't be opened: ${t.reason}`, 'warning', 'Shipped features'); return false; }
  let delivered = false;
  try {
    const r = await api.post<{ status?: string }>(`features/${encodeURIComponent(id)}/open`, { by: 'console' });
    delivered = r.status === 'delivered';
  } catch { /* opened here instead */ }
  if (!delivered) {
    const a = await executeControl(rt, { $axf: 'console-control@1', verb: 'open', address: t.target });
    if (!a.ok) { rt.toast(`Couldn't open ${t.label || t.target}: ${(a as { message?: string }).message ?? a.code}`, 'danger', 'Shipped features'); return false; }
  }
  return true;
}

/** feature.open:<id or words>: the best match opens; when the words fit several, the others are named. */
export async function openByName(rt: AxfRuntime, ref: string): Promise<void> {
  const q = ref.trim();
  if (!q) { rt.toast('Say which feature, e.g. feature.open:choices tab.', 'warning', 'Shipped features'); return; }
  let r: FindAnswer;
  try { r = await findFeature(q); } catch (e) { rt.toast((e as Error).message, 'danger', 'Shipped features'); return; }
  if (!r.match) { rt.toast(`No feature matches "${q}".`, 'warning', 'Shipped features'); return; }
  const ok = await openFeature(rt, r.match.id);
  if (ok && r.ambiguous) rt.toast(`Opened ${r.match.name}. Also close: ${r.alternatives.slice(0, 3).map((a) => a.name).join(' · ')}`, 'info', 'Shipped features');
}
