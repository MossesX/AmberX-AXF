/**
 * Held calls and waiting approvals in the console's decision queue (decision@1; build decision-dialog-ui-review-other).
 *
 * Brett, Nov 13 2026: one approve / deny control panel for everything that needs him. The banner offers each held call
 * (type `veto`) and each waiting approval (type `approval`) to whichever plugin keeps the decision queue, through the
 * generic window events `axf:decision` / `axf:decision-withdraw` (no plugin is named; with none installed nothing
 * listens). The buttons run this plugin's own person-only actions on his tap, so the deciding stays in the browser with
 * his hub session, exactly as the banner's own buttons do. Pure diff here; index.tsx fires the events.
 */
import type { VetoCall } from '@console/axf/libs/hub/veto';
import type { HubApproval } from '@console/axf/libs/hub/hub';

export const SOURCE = 'approvals-banner';

export interface DecisionOffer { type: 'veto' | 'approval'; source: string; ref: string; title: string; body: string; buttons: { id: string; label: string; kind: 'primary' | 'danger' | 'neutral'; action: string; icon: string }[] }

export function vetoOffer(c: VetoCall): DecisionOffer {
  return {
    type: 'veto', source: SOURCE, ref: c.id, title: c.title || c.tool || 'Held call', body: [c.summary, c.command].filter(Boolean).join('\n').slice(0, 2000),
    buttons: [
      { id: 'approve-now', label: 'Approve now', kind: 'primary', action: `approvals.approve-now:${c.id}`, icon: 'check' },
      { id: 'deny', label: 'Deny', kind: 'danger', action: `approvals.deny:${c.id}`, icon: 'x' },
      { id: 'shelve', label: 'Shelve', kind: 'neutral', action: `approvals.shelve:${c.id}`, icon: 'pause' },
    ],
  };
}

export function approvalOffer(p: HubApproval): DecisionOffer {
  return {
    type: 'approval', source: SOURCE, ref: p.id, title: p.title || p.tool || 'Approval', body: (p.summary || '').slice(0, 2000),
    buttons: [
      { id: 'approve', label: 'Approve', kind: 'primary', action: `approvals.approve:${p.id}`, icon: 'check' },
      { id: 'deny', label: 'Deny', kind: 'danger', action: `approvals.decline:${p.id}`, icon: 'x' },
    ],
  };
}

/** What to offer and what to take back, given the ids offered before. Only on a good read (`ok`). */
export function decisionDiff(offered: ReadonlySet<string>, held: readonly VetoCall[], pending: readonly HubApproval[], ok: boolean): { offer: DecisionOffer[]; withdraw: string[] } {
  if (!ok) return { offer: [], withdraw: [] };
  const now = [...held.map(vetoOffer), ...pending.filter((p) => !held.some((c) => c.id === p.id)).map(approvalOffer)];
  const ids = new Set(now.map((o) => o.ref));
  return { offer: now.filter((o) => !offered.has(o.ref)), withdraw: [...offered].filter((id) => !ids.has(id)) };
}
