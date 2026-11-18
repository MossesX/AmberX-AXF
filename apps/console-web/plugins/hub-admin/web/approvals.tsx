/**
 * Hub → Approvals (hub-console@1 screen `approvals`): every call axHub is holding or asking about, live. Held calls
 * count down on the row; the reason title comes first, the tool as a small chip; the open row is lib-approvals' shared
 * details panel (the reason, the exact call in its own fold with Copy, who asked, tool / policy / risk, the timeline,
 * the result). Approve / Deny / Shelve are Brett's own tap: they go through the approvals-banner relay (lib-approvals'
 * host seam and lib-hub's veto host, lent by that plugin), never through the console token. The rows are the framework
 * DataGrid; the status filter is a TabGroup row on the tab-group asset; every control is a framework control.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Note, TabGroup, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import { ApprovalDetailsPanel, SourceBadge, decideApproval } from '@console/axf/libs/approvals/react';
import { approvalsOpenStore, commandOfSummary, decisionsOf, detailsOfHubEntry, heldDecisions, type ApprovalDecision, type ApprovalItem as LibItem } from '@console/axf/libs/approvals';
import { formatCountdown, secondsLeftNow, vetoHost, vetoOf } from '@console/axf/libs/hub/veto';
import { approvalUrl, parseSource } from '@console/axf/libs/hub';
import type { HubScreen } from '@console/axf/core/hub-console.mjs';
import { readScreen, relTime, useHubRead, UNAVAILABLE_WORDS, type Read } from './data';
import { clearFocus, useFocus } from './store';

/** One entry as the hub's `/auth/api/approvals` answers it (apps/axhub-web/src/hub/types.ts, approval-grid@1). */
export interface HubRawItem {
  id: string; tool: string; title: string; description?: string; summary: string; status: string; statusLabel: string; actions: string[];
  revision: number; createdAt: string; expiresAt: string; showExpires: boolean; callerId?: string; whole?: boolean;
  veto?: { runsAt: string; secondsLeft: number; countdownSeconds: number; state?: string; actions?: string[] };
  source?: { kind: string; label: string; who: string; session?: string; client?: string };
  code?: { service: string; tool: string; qualified: string; arguments: string; command?: string };
  reviewRequired?: boolean; postponed?: { waitingFor: string; lastNote?: string };
}
export interface ApprovalGrid {
  filters: { id: string; label: string }[]; filter: string; page: number; pages: number; total: number; waiting: number; heldCount?: number; postponed: number;
  items: HubRawItem[]; auto: { available: boolean; minutes: number[]; window?: { until: string; by: string; approvedCount: number } }; log: boolean;
}

export const GRID_ID = 'hub.approvals';
export const FILTER_ROW = 'hub.approvals.filter';
const SCOPE = 'hub';
const POLL_KEY = 'axf.hub.poll';
const STATUS_TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  pending: 'accent', held: 'warning', running: 'accent', ran: 'success', failed: 'danger', approved: 'success', consumed: 'success', rejected: 'danger', revoked: 'danger', postponed: 'warning',
};

export const isHeld = (r: HubRawItem) => r.status === 'held' && !!r.veto;

/** The library's item from a raw grid entry, so deciding goes down the same path as the banner's. */
export function itemOf(hub: string, r: HubRawItem): LibItem | null {
  const url = approvalUrl(hub, r.id);
  if (!url) return null;
  const veto = isHeld(r) ? vetoOf(hub, r) : null;
  return {
    kind: veto ? 'held' : 'approval', id: r.id, tool: r.tool, title: r.title || `Run ${r.tool}`, description: r.description ?? '', summary: r.summary ?? '',
    command: r.code?.command ?? commandOfSummary(r.summary ?? ''), createdAt: r.createdAt, expiresAt: veto ? veto.runsAt : r.expiresAt, url,
    decisions: veto ? heldDecisions(veto) : decisionsOf(r.actions ?? null), revision: typeof r.revision === 'number' ? r.revision : null, veto,
    entry: r as unknown as Record<string, unknown>, source: parseSource(r.source),
  };
}

function useTick(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}

/** How often the hub is read: the registered setting, else the table's poll. */
function usePoll(screen: HubScreen): { idleMs: number; heldMs: number } {
  const rt = useRuntime();
  const d = screen.state.poll ?? { idleMs: 10000, heldMs: 3000 };
  const v = rt.settings.get(POLL_KEY) as unknown;
  const o = v && typeof v === 'object' ? (v as { idleMs?: unknown; heldMs?: unknown }) : {};
  const num = (x: unknown, dflt: number, min: number) => (typeof x === 'number' && Number.isFinite(x) && x >= min ? x : dflt);
  return { idleMs: num(o.idleMs, d.idleMs, 1000), heldMs: num(o.heldMs, d.heldMs ?? 3000, 500) };
}

export function UnavailableNote({ r }: { r: { code: string; message: string; proposed?: string } }) {
  const tone = r.code === 'signed_out' || r.code === 'relay_off' || r.code === 'hub_missing' ? 'warning' : 'danger';
  return (
    <Note tone={tone}>
      {UNAVAILABLE_WORDS[r.code] ?? r.message}{r.message && UNAVAILABLE_WORDS[r.code] ? ` (${r.message})` : ''}
      {r.proposed ? <> Route to grow on axHub: <span className="fx-mono">{r.proposed}</span></> : null}
    </Note>
  );
}

export function ApprovalsScreen({ screen }: { screen: HubScreen }) {
  const poll = usePoll(screen);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [fast, setFast] = useState(false);
  const focus = useFocus();
  // A deep link to one request (`row:<id>`, `hub.open:approvals:<id>`): show every status so the row is there, and open it.
  useEffect(() => { if (focus?.screen === 'approvals' && focus.row) { setStatus('all'); setPage(1); approvalsOpenStore.set(SCOPE, focus.row, true); } }, [focus]);
  const { data, stale, reload } = useHubRead<ApprovalGrid>('approvals', { status, page }, fast ? poll.heldMs : poll.idleMs);
  const g = data && data.ok ? data : null;
  useEffect(() => {
    if (!focus || focus.screen !== 'approvals' || !focus.row || !g) return;
    const el = document.querySelector(`[data-axf-hub-screen="approvals"] [data-axf-row="${focus.row}"]`);
    el?.scrollIntoView({ block: 'center' });
    if (g.items.some((i) => i.id === focus.row)) clearFocus();
  }, [focus, g]);
  const anyHeld = !!g && g.items.some(isHeld);
  useEffect(() => setFast(anyHeld), [anyHeld]);
  const waiting = g ? (g.waiting ?? 0) + (g.heldCount ?? 0) : 0;
  const filters = g?.filters?.length ? g.filters : (screen.state.params?.status as string[] | undefined ?? ['all']).map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }));

  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen="approvals">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub{g ? ` · ${g.hub.replace(/^https:\/\//, '')}` : ''}</p>
          <h1>{g ? (waiting <= 0 ? 'Nothing waiting' : `${waiting} waiting`) : 'Approvals'}</h1>
          <p className="fx-muted">Every call that changes something waits here. Approve, Deny and Shelve are your own tap; no session can press them.{g && g.postponed > 0 ? ` ${g.postponed} postponed.` : ''}</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void reload()}>Check now</Button>
        </div>
      </header>

      {data && !data.ok && <UnavailableNote r={data} />}
      {stale && <Note tone="warning">The last read failed ({UNAVAILABLE_WORDS[stale.code] ?? stale.message}); showing the previous answer.</Note>}
      {g && <p className="axp-hub-admin-status">Read through {g.via === 'owner' ? "the console's own hub sign-in" : g.via === 'browser' ? "this browser's hub session" : 'the hub'} · page {g.page} of {g.pages} · {g.total} requests</p>}

      <TabGroup id={FILTER_ROW} label="Show" value={status} onChange={(v) => { setPage(1); setStatus(v); }} size="sm"
        tabs={filters.map((f) => ({ value: f.id, label: f.label, title: f.label }))}>
        {!data && <p className="fx-muted">Reading the hub…</p>}
        {g && g.items.length === 0 && <Note tone="success">{g.filter === 'all' ? 'No requests yet.' : 'None with this status.'}</Note>}
        {g && g.items.length > 0 && <ApprovalsTable hub={g.hub} items={g.items} onDone={() => void reload()} />}
      </TabGroup>

      {g && g.pages > 1 && (
        <div className="fx-row fx-row--wrap">
          <Button size="sm" icon="chevron-left" disabled={g.page <= 1} onClick={() => setPage(g.page - 1)}>Newer</Button>
          <span className="fx-muted">Page {g.page} of {g.pages}</span>
          <Button size="sm" icon="chevron-right" disabled={g.page >= g.pages} onClick={() => setPage(g.page + 1)}>Older</Button>
        </div>
      )}
    </div>
  );
}

function ApprovalsTable({ hub, items, onDone }: { hub: string; items: HubRawItem[]; onDone: () => void }) {
  const [sort, setSort] = useState<GridSort>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>(() => items.filter((i) => approvalsOpenStore.isOpen(SCOPE, i.id)).map((i) => i.id));
  const toggleRow = useCallback((id: string) => setExpanded((e) => { const on = !e.includes(id); approvalsOpenStore.set(SCOPE, id, on); return on ? [...e, id] : e.filter((x) => x !== id); }), []);
  const now = useTick(items.some(isHeld));
  const columns: GridColumn<HubRawItem>[] = [
    { id: 'source', label: 'Source', width: 'minmax(max-content, 1fr)', sortable: true, sortValue: (r) => r.source?.kind ?? 'zz', render: (r) => <SourceCell hub={hub} item={r} /> },
    { id: 'who', label: 'Who', width: 'minmax(calc(var(--fx-space) * 8), 1.2fr)', sortable: true, sortValue: (r) => (r.source?.who ?? '').toLowerCase(), render: (r) => <span className="axp-hub-admin-who" title={r.source?.who || undefined}>{r.source?.who || '—'}</span> },
    { id: 'what', label: 'What', width: 'minmax(calc(var(--fx-space) * 14), 4fr)', fixed: true, sortable: true, sortValue: (r) => (r.title || '').toLowerCase(), render: (r) => <WhatCell item={r} /> },
    { id: 'requested', label: 'Requested', width: 'minmax(max-content, 1fr)', sortable: true, sortValue: (r) => Date.parse(r.createdAt) || 0, render: (r) => <span className="fx-muted" title={r.createdAt}>{relTime(r.createdAt, now)}</span> },
    { id: 'countdown', label: 'Countdown', width: 'minmax(max-content, 1fr)', sortable: true, sortValue: (r) => (isHeld(r) ? Date.parse(r.veto!.runsAt) || 0 : Number.MAX_SAFE_INTEGER), render: (r) => <CountdownCell hub={hub} item={r} now={now} /> },
    { id: 'decide', label: 'Decide', width: 'max-content', render: (r) => <DecideCell hub={hub} item={r} onDone={onDone} /> },
  ];
  const waiting = items.filter((r) => isHeld(r) || r.status === 'pending' || r.status === 'postponed');
  const rest = items.filter((r) => !waiting.includes(r));
  const groups: GridGroup<HubRawItem>[] = [
    ...(waiting.length ? [{ id: 'waiting', title: 'Waiting on you', icon: 'shield', rows: waiting, groups: [], fixed: true }] : []),
    ...(rest.length ? [{ id: 'earlier', title: 'Earlier', icon: 'list', rows: rest, groups: [], fixed: true }] : []),
  ];
  return (
    <DataGrid<HubRawItem>
      id={GRID_ID}
      label="Approvals"
      groups={groups}
      columns={columns}
      rowId={(r) => r.id}
      rowLabel={(r) => `${r.title} ${r.source?.who ?? ''} ${r.tool}`}
      hidden={hidden}
      onToggleColumn={(c, show) => setHidden((h) => (show ?? h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))}
      onShowAll={() => setHidden([])}
      sort={sort}
      onSort={(c) => setSort((s0) => (c === null ? null : s0 && s0.col === c ? (s0.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}
      expanded={expanded}
      onToggleExpand={toggleRow}
      onRowClick={(r, e) => { if (!(e.target as Element).closest?.('button, a, input, select, textarea')) toggleRow(r.id); }}
      renderDetail={(r) => <RowDetail hub={hub} item={r} onDone={onDone} />}
      rowTone={(r) => (isHeld(r) ? 'warning' : r.status === 'pending' ? 'accent' : STATUS_TONE[r.status] ?? 'muted')}
      empty="No requests."
    />
  );
}

const SourceCell = memo(function SourceCell({ hub, item }: { hub: string; item: HubRawItem }) {
  const d = useMemo(() => detailsOfHubEntry(hub, item), [hub, item]);
  return d && d.source ? <SourceBadge details={d} /> : <Chip>{item.source?.label ?? 'Unknown'}</Chip>;
});

/** The reason title first (it truncates first), then the tool as a small chip. */
const WhatCell = memo(function WhatCell({ item }: { item: HubRawItem }) {
  return (
    <span className="axp-hub-admin-what">
      <strong className="axp-hub-admin-what__title" title={item.title}>{item.title || `Run ${item.tool}`}</strong>
      <span className="axp-hub-admin-what__tool"><Chip>{item.tool}</Chip></span>
    </span>
  );
});

function CountdownCell({ hub, item, now }: { hub: string; item: HubRawItem; now: number }) {
  if (isHeld(item)) {
    const v = vetoOf(hub, item);
    if (v) {
      const left = secondsLeftNow(v, now);
      if (v.shelved) return <Chip tone="warning">Shelved</Chip>;
      return <span className={`axp-hub-admin-count${left <= 30 ? ' is-urgent' : ''}`} aria-label="Runs in">{left > 0 ? formatCountdown(left) : 'Running'}</span>;
    }
  }
  if (item.showExpires) return <Chip tone={STATUS_TONE[item.status]}>{relTime(item.expiresAt, now)}</Chip>;
  return <Chip tone={STATUS_TONE[item.status]}>{item.statusLabel}</Chip>;
}

/** Deny / Approve (and Shelve on a held call) on the row: Brett's tap through the relay. */
function useDecide(hub: string, item: HubRawItem, onDone: () => void) {
  const rt = useRuntime();
  const [busy, setBusy] = useState('');
  const lib = useMemo(() => itemOf(hub, item), [hub, item]);
  const decide = async (d: ApprovalDecision) => {
    if (!lib) return;
    setBusy(`${item.id}:${d}`);
    try {
      const r = await decideApproval(hub, lib, d);
      rt.toast(r.ok ? (r.message || (d === 'approve' ? `Approved: ${lib.title}` : `Denied: ${lib.title}`)) : r.message || 'Nothing was decided.', r.ok ? (d === 'approve' ? 'success' : 'info') : 'danger', 'Hub');
    } finally { setBusy(''); onDone(); }
  };
  const shelve = async () => {
    const act = vetoHost().act;
    if (!act) { rt.toast('Shelve needs the approvals-banner relay (the plugin is off).', 'warning', 'Hub'); return; }
    setBusy(`${item.id}:shelve`);
    try {
      const r = await act(item.id, 'shelve');
      rt.toast(r.ok ? `Shelved: ${item.title}. The countdown is paused until you decide.` : r.error || 'Nothing was shelved.', r.ok ? 'info' : 'danger', 'Hub');
    } finally { setBusy(''); onDone(); }
  };
  return { busy, lib, decide, shelve };
}

function DecideCell({ hub, item, onDone }: { hub: string; item: HubRawItem; onDone: () => void }) {
  const { busy, lib, decide, shelve } = useDecide(hub, item, onDone);
  if (!lib || !lib.decisions.length) return <Chip tone={STATUS_TONE[item.status]}>{item.statusLabel}</Chip>;
  const can = (d: ApprovalDecision) => lib.decisions.includes(d);
  const held = lib.kind === 'held';
  const canShelve = held && !!item.veto?.actions?.includes('shelve') && !lib.veto?.shelved;
  return (
    <span className="axp-hub-admin-pair" data-axf-anchor="approval-actions">
      {(can('deny') || can('decline')) && <Button tone="danger" icon="x-circle" disabled={!!busy} aria-label={`Deny: ${lib.title}`} onClick={() => void decide(held ? 'deny' : 'decline')}>Deny</Button>}
      {canShelve && <Button tone="neutral" icon="pause" disabled={!!busy} aria-label={`Shelve: ${lib.title}`} title="Pause the countdown until you decide" onClick={() => void shelve()}>Shelve</Button>}
      {can('approve') && <Button tone="success" icon="check" disabled={!!busy} aria-label={`Approve: ${lib.title}`} onClick={() => void decide('approve')}>{held ? 'Approve' : 'Approve now'}</Button>}
    </span>
  );
}

/** The open row: lib-approvals' details panel (reason, exact call with Copy, who asked, policy, timeline, result). */
function RowDetail({ hub, item, onDone }: { hub: string; item: HubRawItem; onDone: () => void }) {
  const { busy, decide } = useDecide(hub, item, onDone);
  const details = useMemo(() => detailsOfHubEntry(hub, item), [hub, item]);
  if (!details) return null;
  return (
    <ApprovalDetailsPanel className="axp-hub-admin-detail" details={details} hub={hub} busy={busy} onDecide={(d) => void decide(d)}>
      {item.postponed && <p className="fx-muted">Waiting for {item.postponed.waitingFor}{item.postponed.lastNote ? ` · ${item.postponed.lastNote}` : ''}</p>}
      {item.reviewRequired && <Note tone="warning">Postponed for over 2 hours: look at it again.</Note>}
    </ApprovalDetailsPanel>
  );
}

/** One approval, read on its own (deep links `row:<id>`; the Approvals API's row read uses the same route). */
export async function readApproval(id: string): Promise<Read<{ item: HubRawItem; auto: ApprovalGrid['auto'] }>> {
  return readScreen<{ item: HubRawItem; auto: ApprovalGrid['auto'] }>('approvals', {}, id);
}

export function ApprovalsEmptyHint() {
  return <Container title="How deciding works" icon="shield"><p className="fx-muted">Approve, Deny and Shelve reach axHub through your own hub session (the approvals-banner relay). A session, tool or voice command can open this screen and read it, never press them.</p></Container>;
}
