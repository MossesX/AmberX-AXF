/**
 * lib-approvals (web) — the application menu's "Waiting for approval" list, with **Approve** and **Deny** on every row
 * (Brett, Nov 1 2026: "each waiting call shows there but has no buttons. Add them right there").
 *
 *   installApprovalsMenu(rt, { hub });                       // replaces lib-hub's read-only `hub.approvals` list
 *   installApprovalsMenu(rt, { hub, id: 'approvals.list', act: myOwnDecide });  // an app with its own routes
 *
 * Each waiting item (held veto calls with their live countdown, then calls waiting for an approval) is one menu row:
 * title (cut first), the command or tool under it, the countdown (`deadline`, `Shelved` when paused), then red Deny and
 * green Approve as row buttons (framework controls, big tap targets: framework/react/components/AppMenu.tsx LiveRow).
 * Approve on a held call = run it now (veto@1 approve-now), on an approval = the hub's approve; Deny = veto@1 deny or
 * the hub's decline. The tap goes through the same deciding path as the title bar badge (`decideApproval`: the app's
 * own host, a page on the hub's origin, else the call's page on the hub, which keeps the row). The row then reads
 * Running / Approved / Denied in place and drops off; the list itself isn't reloaded, so nothing flickers.
 *
 * Pure rows (`approvalMenuRows`) are tested in Node by framework/spec/check-approvals-menu.mts.
 */
import type { AxfRuntime, MenuActResult, MenuItem, MenuItemButton } from '../../core';
import { HUB_DEFAULT, normalizeHub } from '../hub/hub';
import { HUB_SOURCE_TONE } from '../hub/source';
import { approvalsWatcher } from './index';
import { DECISION_LABELS, rowOrder, rowTimes, type ApprovalDecision, type ApprovalItem, type ApprovalsState, type DecideResult } from './core';
import { decideApproval } from './host';
import { approvalExpandKey, registerApprovalsLookup } from './details';

export const APPROVALS_MENU_MODULE = 'ai.amberx.axf.approvals';
/** The live list's id in lib-hub's menus (axhub-web, AmberX); the console's plugin uses `approvals.list`. */
export const APPROVALS_MENU_PROVIDER = 'hub.approvals';
/** Row ids: `approval-<hub id>`. */
export const APPROVALS_ROW_PREFIX = 'approval-';

/** The two buttons, in row order (Deny first: the safe one; Approve last). */
export function decisionButtons(item: Pick<ApprovalItem, 'kind' | 'decisions'>): MenuItemButton[] {
  return rowOrder(item.decisions).map((d) => d === 'approve'
    ? { id: 'approve', label: DECISION_LABELS.approve, icon: item.kind === 'held' ? 'play' : 'check', tone: 'success' as const }
    : { id: d, label: DECISION_LABELS[d], icon: 'x-circle', tone: 'danger' as const });
}

/** What the row reads after a decision went through. */
export const decidedState = (item: Pick<ApprovalItem, 'kind'>, d: ApprovalDecision): string =>
  d === 'approve' ? (item.kind === 'held' ? 'Running' : 'Approved') : 'Denied';

export interface ApprovalRowsOptions {
  /** The row's own tap (default `hub.review:<id>`: the request on the hub). */
  review?: (item: ApprovalItem) => string;
  /** Sign-in action for the signed-out row (default `hub.open:sign-in`). */
  signIn?: string;
}

/** The row's second line: who asked (session / build / agent name), when, then the command; the tool when nothing else. */
export function whoLine(it: Pick<ApprovalItem, 'source' | 'createdAt' | 'expiresAt' | 'veto' | 'command' | 'tool'>, now: number = Date.now()): string {
  const who = it.source && it.source.who !== it.source.label ? it.source.who : '';
  const asked = rowTimes(it, now).asked;
  return [who, asked, it.command].filter(Boolean).join(' · ') || it.tool;
}

/** The menu rows for one read of the feed (status rows when it can't be read, `Nothing waiting` when empty). */
export function approvalMenuRows(st: ApprovalsState, opts: ApprovalRowsOptions = {}): MenuItem[] {
  if (st.status === 'signed-out') return [{ id: 'hub-sign-in', label: 'Sign in to axHub to see them', icon: 'shield', action: opts.signIn ?? 'hub.open:sign-in' }];
  if (st.status === 'not-admin') return [{ id: 'hub-not-admin', label: 'Only hub admins see approvals', icon: 'shield' }];
  if (st.status !== 'ok') return [{ id: 'hub-unreachable', label: st.error || "Can't reach the hub", icon: 'alert' }];
  if (!st.items.length) return [{ id: 'hub-none', label: 'Nothing waiting', icon: 'check' }];
  const review = opts.review ?? ((i: ApprovalItem) => `hub.review:${i.id}`);
  return st.items.map((it) => {
    const v = it.veto;
    const row: MenuItem = {
      id: `${APPROVALS_ROW_PREFIX}${it.id}`, label: it.title, icon: it.kind === 'held' ? (v?.shelved ? 'pause' : 'clock') : 'shield',
      action: review(it), detail: whoLine(it),
      // Expands in place (caret on the far right): lib-approvals' details panel (row.tsx registers the renderer).
      expand: approvalExpandKey(it.id),
    };
    // Who asked (axHub decision 109): the source badge and the tool as chips, the title stays first.
    if (it.source) row.tag = { label: it.source.label, tone: HUB_SOURCE_TONE[it.source.kind], ...(it.source.client ? { title: `${it.source.label} · ${it.source.client}` } : {}) };
    if (it.title !== `Run ${it.tool}`) row.chip = it.tool;
    if (v) { row.deadline = v.readAt + v.secondsLeft * 1000; if (v.shelved) row.paused = 'Shelved'; }
    const buttons = decisionButtons(it);
    if (buttons.length) row.buttons = buttons;
    return row;
  });
}

/** A decision's result as the menu row shows it. */
export function rowResult(item: ApprovalItem, d: ApprovalDecision, r: DecideResult): MenuActResult {
  if (!r.ok) return { ok: false, message: r.message || 'The hub refused.' };
  if (r.opened) return { ok: true, keep: true };
  return { ok: true, state: decidedState(item, d) };
}

export interface ApprovalsMenuOptions extends ApprovalRowsOptions {
  hub?: string;
  /** Live-list id (default `hub.approvals`). */
  id?: string;
  /** Rows before More… (default 12). */
  max?: number;
  moreAction?: string;
  moreLabel?: string;
  /** The app's own decision (default `decideApproval`). */
  decide?: (item: ApprovalItem, d: ApprovalDecision) => Promise<DecideResult>;
  /** Reads the feed (default: the shared watcher, read now). */
  read?: () => Promise<ApprovalsState>;
}

/** Registers the live list (replacing one of the same id) on `rt`; returns its remover. */
export function installApprovalsMenu(rt: AxfRuntime, opts: ApprovalsMenuOptions = {}): () => void {
  const hub = normalizeHub(opts.hub) ?? HUB_DEFAULT;
  const read = opts.read ?? (() => approvalsWatcher(hub).check());
  const decide = opts.decide ?? ((item: ApprovalItem, d: ApprovalDecision) => decideApproval(hub, item, d));
  /** The items the open menu shows (a button acts on what the row showed, not on a later read). */
  let shown = new Map<string, ApprovalItem>();
  // The open row's details find the item here: what the menu showed, else the watcher's latest read.
  const offLookup = registerApprovalsLookup({
    hub: () => hub, decide,
    find: (id) => shown.get(`${APPROVALS_ROW_PREFIX}${id}`) && (approvalsWatcher(hub).state.items.find((i) => i.id === id) ?? shown.get(`${APPROVALS_ROW_PREFIX}${id}`)),
  });
  const offProvider = rt.registerAppMenuProvider(opts.id ?? APPROVALS_MENU_PROVIDER, {
    module: APPROVALS_MENU_MODULE, max: opts.max ?? 12, moreAction: opts.moreAction ?? 'hub.open:approvals', moreLabel: opts.moreLabel ?? 'All approvals…',
    items: async () => {
      const st = await read();
      shown = new Map(st.status === 'ok' ? st.items.map((i) => [`${APPROVALS_ROW_PREFIX}${i.id}`, i]) : []);
      return approvalMenuRows(st, opts);
    },
    act: async (rowId, buttonId) => {
      const item = shown.get(rowId);
      if (!item) return { ok: false, message: 'That one is no longer waiting.' };
      const d = buttonId as ApprovalDecision;
      if (!item.decisions.includes(d)) return { ok: false, message: `The hub doesn't offer ${DECISION_LABELS[d] ?? buttonId} for this one now.` };
      const r = rowResult(item, d, await decide(item, d));
      if (r.ok && !r.keep) shown.delete(rowId);
      return r;
    },
  });
  return () => { offProvider(); offLookup(); };
}
