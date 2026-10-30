/**
 * Deny / Approve / Shelve a held call from the Terminal view, and the store hook. The veto banner plugin (console
 * `plugins/approvals-banner`, loaded in AmberX too) owns the notices, the veto screen and the alarm; this view uses the
 * same lib-hub path (`runVetoAction`): the phone's hub session through the host AmberX installs (`installVetoHost`),
 * else the call's page on the hub, the only origin the hub takes an action from.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { runVetoAction, vetoHost, VETO_ACTION_LABELS, type VetoAction } from '../../../axf/libs/hub/veto';
import { native } from '../../../native';
import { HUB } from '../../../hub/useHub';
import { checkVeto, markDenied, subscribeVeto, vetoState, type Track } from './store';
import type { ApprovalDecision, ApprovalItem, DecideResult } from '../../../axf/libs/approvals';

let runtime: AxfRuntime | null = null;
export const setRuntime = (rt: AxfRuntime) => { runtime = rt; };
export const getRuntime = () => runtime;

export const useVeto = () => useSyncExternalStore(subscribeVeto, vetoState, vetoState);

const DONE: Record<VetoAction, string> = { deny: 'Denied', 'approve-now': 'Approved, running now', shelve: 'Shelved' };

export async function actOn(t: Track, action: VetoAction): Promise<void> {
  const r = await runVetoAction(HUB, t.call, action);
  if (r.ok) {
    if (action === 'deny') markDenied(t.call.id);
    runtime?.toast(`${DONE[action]}: ${t.call.title}`, action === 'deny' ? 'success' : 'info', 'Approvals');
  } else if (!r.opened) runtime?.toast(`Couldn't ${VETO_ACTION_LABELS[action].toLowerCase()} it here${r.error ? ` (${r.error})` : ''}.`, 'warning', 'Approvals');
  void checkVeto();
}

export const deny = (t: Track) => actOn(t, 'deny');

/**
 * lib-approvals' deciding path on the phone (the assistant title bar badge): Deny a held call with the phone's hub
 * session (the veto host), falling back to its page; Approve / Decline open the approval in the signed-in hub web view.
 */
export async function decideFromPhone(item: ApprovalItem, d: ApprovalDecision): Promise<DecideResult> {
  const act = vetoHost().act;
  if (d === 'deny' && act) {
    const r = await act(item.id, 'deny').catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (r.ok) { markDenied(item.id); void checkVeto(); return { ok: true, message: `Denied: ${item.title}` }; }
    runtime?.toast(`Couldn't deny it here (${r.error ?? 'hub refused'}). Opening it on the hub.`, 'warning', 'Approvals');
  }
  await native.hubOpen({ url: item.url }).catch(() => undefined);
  void checkVeto();
  return { ok: true, opened: true, message: '' };
}
