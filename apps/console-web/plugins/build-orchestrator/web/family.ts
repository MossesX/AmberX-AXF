import type { GridGroup } from '@console/axf/libs/datagrid';
import { familyLine, parallelFamily, type ParallelFamily } from './orchestrator-core.mjs';

/**
 * Parallel split families in a build list (Nov 13 2026, build orchestrator-settings-collapsible-split): the lead and its
 * parts sit together in one sub-group under the list, lead first, then the parts in part order; the sub-group shows the
 * family's combined progress (every step of the lead and of every part) and how it lands. `all` = every build the
 * family's figures are counted over (the list may show only some of them, e.g. one pipeline tab).
 */
type Member = { id: string; title: string; pipeline?: { parallel?: { role?: string; lead?: string; part?: number } | null } | null };

export function familyOf<R extends Member>(r: R, all: readonly Member[]): ParallelFamily | null {
  return parallelFamily(r, all as Member[]);
}

export function splitFamilies<R extends Member>(rows: R[], all: readonly Member[], prefix: string, collapsed: readonly string[]): { singles: R[]; groups: GridGroup<R>[] } {
  const singles: R[] = []; const by = new Map<string, R[]>();
  for (const r of rows) {
    const p = r.pipeline?.parallel;
    const lead = p?.role === 'lead' ? r.id : p?.role === 'part' ? p.lead ?? '' : '';
    if (!lead) { singles.push(r); continue; }
    by.set(lead, [...(by.get(lead) ?? []), r]);
  }
  const order = (r: R) => (r.pipeline?.parallel?.role === 'lead' ? 0 : r.pipeline?.parallel?.part ?? 99);
  const groups = [...by.entries()].map(([lead, members]) => {
    const head = members.find((m) => m.id === lead) ?? members[0]!;
    const f = familyOf(head, all);
    const id = `${prefix}family:${lead}`;
    return { id, title: `Parallel: ${f?.leadTitle || lead} (${members.length} of ${(f?.of ?? 0) + 1} here)`, icon: 'layers', rows: [...members].sort((a, b) => order(a) - order(b)), groups: [],
      collapsed: collapsed.includes(id), summary: familyLine(f), progress: f && f.total ? f.percent : undefined } as GridGroup<R>;
  });
  return { singles, groups };
}
