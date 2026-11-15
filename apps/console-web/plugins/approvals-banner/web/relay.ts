/**
 * Approve / Deny in place (Brett, Nov 6 2026: "How come when I click approve, it's going back to axHub, not staying on
 * console?"). In the console the tap goes to this plugin's server relay, which posts it to the hub with the browser's
 * own hub session; the answer comes back here and shows where he tapped. The relay is lent through the same two seams
 * AmberX's phone uses (lib-hub's veto host, lib-approvals' host), so the banner, the menus, the review and veto dialogs
 * and Follow Amber's pop-up all decide the same way and nothing opens a window.
 *
 * Only a person's tap reaches it: a browser that reports no user activation is refused here, on top of the actions
 * being `personOnly` (a remote console command can't run them) and the server refusing anything but his browser session.
 * AmberX forwards plugin routes with the console token, so its probe answers no and its own hosts stay in charge.
 */
import type { VetoActionResult, VetoAction, VetoHost } from '@console/axf/libs/hub/veto';
import type { ApprovalDecision, ApprovalItem, DecideResult } from '@console/axf/libs/approvals';
import type { ApprovalsHost } from '@console/axf/libs/approvals/react';

export type RelayAction = VetoAction | 'approve' | 'decline';
export interface RelayAnswer { ok: boolean; state?: string | null; message?: string; code?: string }
/** POST <plugin>/decide; → the parsed reply (a transport failure throws). */
export type RelayPost = (body: { id: string; action: RelayAction; rev?: number }) => Promise<{ status: number; json: unknown }>;

const NOT_A_TAP = 'That needs your own tap on the button.';
const FAILED = "That didn't go through. Nothing was decided.";

/** Is a person tapping right now? Browsers without the API rely on the server and on `personOnly`. */
export function personTapping(): boolean {
  const a = (globalThis.navigator as { userActivation?: { isActive?: boolean } } | undefined)?.userActivation;
  return a ? a.isActive === true : true;
}

/** One decision through the relay; never throws, and never answers ok unless the hub did. */
export async function relayDecide(post: RelayPost, id: string, action: RelayAction, rev: number | null = null, tapping: boolean = personTapping()): Promise<RelayAnswer> {
  if (!tapping) return { ok: false, code: 'no_tap', message: NOT_A_TAP };
  try {
    const r = await post({ id, action, ...(rev === null ? {} : { rev }) });
    const j = (r.json && typeof r.json === 'object' ? r.json : {}) as { ok?: unknown; state?: unknown; message?: unknown; code?: unknown; detail?: unknown };
    const message = typeof j.message === 'string' ? j.message : typeof j.detail === 'string' ? j.detail : '';
    return { ok: r.status === 200 && j.ok === true, ...(typeof j.state === 'string' ? { state: j.state } : {}), ...(typeof j.code === 'string' ? { code: j.code } : {}), message: message || (r.status === 200 && j.ok === true ? '' : FAILED) };
  } catch (e) {
    return { ok: false, code: 'unreachable', message: `Couldn't reach the console (${(e as Error)?.message ?? e}). Nothing was decided.` };
  }
}

/** The action a decision on an item takes: held calls have their own (Approve = run it now), Deny = decline on an approval. */
export const relayAction = (item: Pick<ApprovalItem, 'kind'>, d: ApprovalDecision): RelayAction =>
  item.kind === 'held' ? (d === 'approve' ? 'approve-now' : 'deny') : d === 'approve' ? 'approve' : 'decline';

/** The two seams, lent by the plugin only where the probe says this browser can decide through the relay. */
export function relayHosts(post: RelayPost): { veto: VetoHost; approvals: ApprovalsHost } {
  const act = async (id: string, action: VetoAction): Promise<VetoActionResult> => {
    const r = await relayDecide(post, id, action);
    return { ok: r.ok, ...(r.state === 'approved-now' || r.state === 'denied' || r.state === 'shelved' ? { state: r.state } : {}), ...(r.ok ? {} : { error: r.message ?? FAILED }) };
  };
  const decide = async (item: ApprovalItem, d: ApprovalDecision): Promise<DecideResult> => {
    const r = await relayDecide(post, item.id, relayAction(item, d), item.revision);
    return { ok: r.ok, message: r.ok ? `${d === 'approve' ? (item.kind === 'held' ? 'Approved, running now' : 'Approved') : 'Denied'}: ${item.title}` : (r.message ?? FAILED) };
  };
  return { veto: { act }, approvals: { frame: false, decide } };
}
