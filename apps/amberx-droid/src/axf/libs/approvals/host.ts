/**
 * lib-approvals (web) — the host seam and the one deciding path, without React (the badge popover and the application
 * menu's Approve / Deny buttons both use it).
 *
 * Deciding: the app's own path first ({@link setApprovalsHost} `decide`, e.g. the AmberX phone's hub web view and native
 * Deny); else directly when the page is on the hub's own origin (`decideOnHub`: veto@1 Deny / Approve now, the hub's
 * decide route); else the approval page opens on the hub (`opened: true`: the result shows when it leaves the feed).
 */
import { approvalsWatcher } from './index';
import { canDecideHere, decideOnHub, type ApprovalDecision, type ApprovalItem, type DecideResult } from './core';

/** What an app plugs in: its hub, whether the hub frames its approval page for this origin, its own deciding path. */
export interface ApprovalsHost {
  hub?: string;
  /** The hub allows this app's origin to frame its approval page (AXHUB_APPROVALS_FRAME_ANCESTORS). */
  frame?: boolean;
  /** The app's own way to decide (resolves with the result, or `opened: true` when it showed the hub page). */
  decide?: (item: ApprovalItem, decision: ApprovalDecision) => Promise<DecideResult>;
  /** How hub pages open (default `window.open`). */
  open?: (url: string) => void;
  /** Poll period (ms). */
  everyMs?: number;
}

let host: ApprovalsHost = {};
const hostSubs = new Set<() => void>();
/** Merges into the app's approvals host (later calls win per key). */
export function setApprovalsHost(h: ApprovalsHost): void { host = { ...host, ...h }; hostSubs.forEach((f) => f()); }
export const approvalsHost = (): ApprovalsHost => host;
/** Called whenever the host changes; returns the remover. */
export const onApprovalsHost = (f: () => void): (() => void) => { hostSubs.add(f); return () => { hostSubs.delete(f); }; };

/** Opens a hub page the app's way (its host's `open`, else a new tab without an opener). */
export const openHubPage = (url: string): void => { if (host.open) host.open(url); else globalThis.open?.(url, '_blank', 'noopener,noreferrer'); };

/**
 * Decides one item: the app's own path, else from a page on the hub's own origin, else opens its page on the hub
 * (`frame` callers show it framed instead and pass `openPage`). Reads the feed again afterwards.
 */
export async function decideApproval(hub: string, item: ApprovalItem, d: ApprovalDecision, opts: { openPage?: (item: ApprovalItem) => void; origin?: string } = {}): Promise<DecideResult> {
  let r: DecideResult;
  if (host.decide) r = await host.decide(item, d);
  else if (canDecideHere(hub, opts.origin ?? globalThis.location?.origin)) r = await decideOnHub(hub, item, d);
  else { (opts.openPage ?? ((i) => openHubPage(i.url)))(item); r = { ok: true, opened: true, message: '' }; }
  void approvalsWatcher(hub).check();
  return r;
}
