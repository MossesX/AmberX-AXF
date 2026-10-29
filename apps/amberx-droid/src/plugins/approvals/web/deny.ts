/**
 * Deny a held call (veto@1) and the store hook, shared by the plugin's settings and the Terminal view. The phone posts the
 * Deny with its hub session (hub Origin + CSRF, `VetoAlerts.deny`); a browser opens the call on the hub, the only origin
 * the hub takes a Deny from.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { isNative, native } from '../../../native';
import { checkVeto, markDenied, subscribeVeto, vetoState, type Track } from './store';

let runtime: AxfRuntime | null = null;
export const setRuntime = (rt: AxfRuntime) => { runtime = rt; };
export const getRuntime = () => runtime;

export const useVeto = () => useSyncExternalStore(subscribeVeto, vetoState, vetoState);

export async function deny(t: Track): Promise<void> {
  const rt = runtime;
  if (isNative()) {
    const r = await native.vetoDeny({ id: t.call.id }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (r.ok) { markDenied(t.call.id); rt?.toast(`Denied: ${t.call.title}`, 'success', 'Approvals'); void checkVeto(); return; }
    rt?.toast(`Couldn't deny it here (${r.error ?? 'hub refused'}). Opening it on the hub.`, 'warning', 'Approvals');
    void native.hubOpen({ url: t.call.url }).finally(() => void checkVeto());
    return;
  }
  window.open(t.call.url, '_blank', 'noopener,noreferrer');
}
