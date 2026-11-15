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

/** What AmberX's server answers for one decision (`/api/approvals/decide`, axf_server.approvals_relay). */
interface ServerDecision { ok: boolean; state?: string; code?: string; message?: string }

/**
 * One decision through AmberX's own server, signed with this page's hub session (the hub's cookie reaches AmberX's
 * domain). Used when the phone has no native way (an older APK, AmberX in a browser), so a tap never just opens axHub.
 */
export async function serverDecide(id: string, action: VetoAction | 'approve' | 'decline', rev?: number | null, f: typeof fetch = fetch): Promise<ServerDecision> {
  try {
    const r = await f('/api/approvals/decide', {
      method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action, ...(typeof rev === 'number' ? { rev } : {}) }),
    });
    const j = (await r.json().catch(() => null)) as (ServerDecision & { detail?: string }) | null;
    if (!r.ok) return { ok: false, message: j?.detail ?? `AmberX answered ${r.status}.` };
    return j && typeof j.ok === 'boolean' ? j : { ok: false, message: 'AmberX gave no answer.' };
  } catch (e) {
    return { ok: false, message: `Couldn't reach AmberX (${(e as Error)?.message ?? e}). Nothing was decided.` };
  }
}

/**
 * lib-approvals' deciding path on the phone (the assistant title bar badge, the banner, the veto screen, the console's
 * approval pop-up): Deny or Approve (run it now) a held call through the veto host, Approve / Decline a call waiting for
 * an approval through the native side, both with the phone's hub session and the result shown in place (Brett, Nov 7
 * 2026). Where the phone has no native way (an older APK, a browser) the tap goes through AmberX's server with the
 * page's own hub session (Brett, Nov 8 2026: "The approve and deny dialogue is still saying open"): it never just opens
 * axHub and calls that done.
 */
export async function decideFromPhone(item: ApprovalItem, d: ApprovalDecision, f: typeof fetch = fetch): Promise<DecideResult> {
  const act = vetoHost().act;
  const action: VetoAction | null = item.kind === 'held' ? (d === 'approve' ? 'approve-now' : 'deny') : null;
  const done = (message: string): DecideResult => { if (action === 'deny') markDenied(item.id); void checkVeto(); return { ok: true, message }; };
  if (action) {
    if (act) {
      const r = await act(item.id, action).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
      if (r.ok) return done(`${DONE[action]}: ${item.title}`);
      return { ok: false, message: `Couldn't ${VETO_ACTION_LABELS[action].toLowerCase()} it (${r.error ?? 'hub refused'}).` };
    }
    const r = await serverDecide(item.id, action, item.revision, f);
    return r.ok ? done(`${DONE[action]}: ${item.title}`) : { ok: false, message: `Couldn't ${VETO_ACTION_LABELS[action].toLowerCase()} it (${r.message ?? 'hub refused'}).` };
  }
  const word = d === 'approve' ? 'approve' : 'decline';
  const nat = await native.approvalDecide({ id: item.id, action: word }).catch(() => null);
  if (nat?.ok) return done(`${d === 'approve' ? 'Approved' : 'Denied'}: ${item.title}`);
  const r = await serverDecide(item.id, word, item.revision, f);
  if (r.ok) return done(`${d === 'approve' ? 'Approved' : 'Denied'}: ${item.title}`);
  return { ok: false, message: `That didn't go through (${r.message ?? 'hub refused'}).` };
}
