/**
 * Waiting approvals in collapsible groups (Brett, Nov 9 2026: "collapsible containers on the approvals page"): one group
 * per build / session / agent that asked (the hub's `source.who` when it names one), else per service (the part of the
 * tool before the first dot: `axf-console.control_set` → axf-console). Groups keep the order their first item came in.
 */
export interface GroupSource { label?: string; who?: string }
export interface Groupable { id: string; tool: string; source?: GroupSource | null }
export interface ApprovalGroup<T> { id: string; title: string; kind: 'build' | 'service'; items: T[] }

/** The service a tool belongs to (`vps.run` → vps; a bare tool is its own service). */
export const serviceOf = (tool: string): string => {
  const t = String(tool ?? '').trim();
  const i = t.indexOf('.');
  return (i > 0 ? t.slice(0, i) : t) || 'other';
};

/** The group an item goes in: the build / session that asked when the hub names one, else its service. */
export function groupKey(item: Groupable): { id: string; title: string; kind: 'build' | 'service' } {
  const who = item.source?.who?.trim() ?? '';
  if (who && who !== item.source?.label) return { id: `build:${who}`, title: who, kind: 'build' };
  const svc = serviceOf(item.tool);
  return { id: `service:${svc}`, title: svc, kind: 'service' };
}

export function groupApprovals<T extends Groupable>(items: T[]): ApprovalGroup<T>[] {
  const out = new Map<string, ApprovalGroup<T>>();
  for (const it of items) {
    const k = groupKey(it);
    const g = out.get(k.id) ?? { ...k, items: [] };
    g.items.push(it);
    out.set(k.id, g);
  }
  return [...out.values()];
}
