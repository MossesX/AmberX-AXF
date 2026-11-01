/**
 * Approvals — every request axHub has asked about (decision #95 grid, moved here from the hub's own page by #96):
 * pending first, then postponed, newest first; a filter per status, pages of 20, the auto-approve window
 * (decision #94) and the log.
 *
 * Deciding happens here now, through the hub's `/auth/api/approvals/<id>` with this browser's admin session, the
 * hub's Origin and the session's CSRF value, the revision this page showed (a request that changed meanwhile is
 * refused) — never with a token, so an AI client can't approve its own call. Approve sits on a row only when the row
 * shows the complete call; a longer one opens its page first.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Container, Note, useRuntime } from '../axf/react';
import { checkHubNow } from '../axf/libs/hub/react';
import { hubPost } from '../hub/api';
import { countdownKey, nextSort, relTime, replyBase, requestedKey, sameJson, showReading, shownRow, sourceChips, sourceKind, sourceWho, SOURCE_LABEL, SOURCE_ORDER, waitingCount, waitingTitle, type KeptReply } from '../hub/core';
import { clearDatasetTransform, DataGrid, setDatasetTransform, type GridColumn, type GridGroup, type GridSort } from '../axf/libs/datagrid';
import { go, useRouteParams } from '../hub/route';
import { ACTION_LABELS, SOURCE_TONE, STATUS_TONE, type ActionReply, type ApprovalAction, type ApprovalGrid, type ApprovalItem, type AutoState } from '../hub/types';
import { HUB } from '../hub/useHub';
import { CodeSection, WhatItDoes } from './ApprovalParts';
import { HubGate, TapTwice, useHubJson } from './hubPage';
import { HeldBar, HeldChip, isHeld } from './HeldCall';

export function Approvals() {
  return (
    <HubGate admin what="approvals">
      {() => <ApprovalsGrid />}
    </HubGate>
  );
}

function ApprovalsGrid() {
  const rt = useRuntime();
  const params = useRouteParams('home');
  const status = params.status ?? 'all';
  const [page, setPage] = useState(1);
  const path = `/auth/api/approvals?status=${encodeURIComponent(status)}&page=${page}`;
  const [fast, setFast] = useState(false);
  // A held call counts down: read the hub every 3 s while one is on the page, so a run or a Deny elsewhere shows quickly.
  const grid = useHubJson<ApprovalGrid>(path, fast ? 3_000 : 10_000);
  const g = grid.data;
  const anyHeld = !!g && g.items.some(isHeld);
  useEffect(() => setFast(anyHeld), [anyHeld]);
  // Pending requests + held calls counting down (the hub's `waiting` is pending only): matches the banner's count.
  const waiting = waitingCount(g);

  const reload = grid.reload;
  // One function for the page's life (per address), so the rows (memo) don't re-render because the parent did.
  const after = useCallback(async () => { await reload(); checkHubNow(); }, [reload]);
  const onRowDone = useCallback(() => void after(), [after]);

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub · {HUB.replace(/^https:\/\//, '')}</p>
          <h1>{g ? waitingTitle(waiting) : 'Approvals'}</h1>
          <p className="fx-muted">
            Every call that changes something waits here for you. Approve or decline it here; a long call opens its own
            page so you see all of it first.
            {g && g.postponed > 0 ? ` ${g.postponed} postponed.` : ''}
          </p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void after()}>Check now</Button>
          {g?.log && <Button icon="list" onClick={() => go(rt, 'approvals-log')}>Log</Button>}
        </div>
      </header>

      {grid.error && <Note tone="danger" icon="alert">{grid.error}</Note>}
      {g && g.auto.available && <AutoApprove auto={g.auto} onChange={() => void after()} />}

      {g && (
        <div className="fx-row fx-row--wrap" role="group" aria-label="Show">
          {g.filters.map((f) => (
            <button key={f.id} type="button" className={`fx-chip${f.id === g.filter ? ' is-on' : ''}`} aria-pressed={f.id === g.filter}
              onClick={() => { setPage(1); go(rt, 'home', f.id === 'all' ? {} : { status: f.id }); }}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Only before the first answer: a refresh keeps the list on screen and updates its rows in place. */}
      {showReading(g, grid.error) && <p className="fx-muted">Reading the hub…</p>}
      {g && g.items.length === 0 && <Note tone="success" icon="check">{g.filter === 'all' ? 'No requests yet.' : 'None with this status.'}</Note>}
      {g && g.items.length > 0 && <ApprovalsTable items={g.items} onDone={onRowDone} />}

      {g && g.pages > 1 && (
        <div className="fx-row fx-row--wrap">
          <Button size="sm" icon="chevron-left" disabled={g.page <= 1} onClick={() => setPage(g.page - 1)}>Newer</Button>
          <span className="fx-muted">Page {g.page} of {g.pages} · {g.total} requests</span>
          <Button size="sm" icon="chevron-right" disabled={g.page >= g.pages} onClick={() => setPage(g.page + 1)}>Older</Button>
        </div>
      )}
    </div>
  );
}

/** The 5 / 10 / 30 minute window that approves everything (decision #94). Deny policies still deny; Stop any time. */
function AutoApprove({ auto, onChange }: { auto: AutoState; onChange: () => void }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const send = async (path: string, body: unknown) => {
    setBusy(true);
    try { const r = await hubPost<{ message: string }>(path, body); rt.toast(r.message || 'Done.', 'success'); onChange(); }
    catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); }
    finally { setBusy(false); }
  };
  const w = auto.window;
  return (
    <Container title="Approve everything automatically" icon="clock">
      {w ? (
        <div className="fx-stack">
          <Note tone="warning" icon="alert">
            Approving every request until {new Date(w.until).toLocaleTimeString()} ({relTime(w.until)}), started by {w.by}.
            {' '}{w.approvedCount} approved so far.
          </Note>
          <div className="fx-row"><Button tone="danger" icon="x" disabled={busy} onClick={() => void send('/auth/api/approvals/auto/stop', {})}>Stop now</Button></div>
        </div>
      ) : (
        <div className="fx-stack">
          <p className="fx-muted">For a few minutes, every call that asks is approved by itself, what's waiting now too. Services set to deny stay denied. Tap twice.</p>
          <div className="fx-row fx-row--wrap">
            {auto.minutes.map((m) => (
              <TapTwice key={m} label={`${m} min`} again={`Approve all for ${m} min`} icon="clock" disabled={busy} onConfirm={() => void send('/auth/api/approvals/auto', { minutes: m })} />
            ))}
          </div>
        </div>
      )}
    </Container>
  );
}

/** Sends one action with the revision the page showed. */
export async function act(item: ApprovalItem, action: ApprovalAction, extra: Record<string, unknown> = {}): Promise<ActionReply> {
  return hubPost<ActionReply>(`/auth/api/approvals/${item.id}`, { action, rev: item.revision, ...extra });
}

/**
 * Deny / Approve now on the collapsed row (Brett, Oct 30 + 31 2026): one pair, the same size, big targets, red Deny (the
 * hub's decline) and green Approve now; Approve now sends straight away only when the row has the complete call, else
 * it opens the request's page with Approve now picked (the whole call first, then one tap).
 */
function RowDecide({ item, busy, run }: { item: ApprovalItem; busy: boolean; run: (a: ApprovalAction) => void }) {
  const rt = useRuntime();
  const can = (a: ApprovalAction) => item.actions.includes(a);
  if (!can('approve') && !can('decline')) return <Chip tone={STATUS_TONE[item.status]}>{item.statusLabel}</Chip>;
  return (
    <div className="axp-axhub-pair">
      {can('decline') && <Button tone="danger" icon="x-circle" disabled={busy} aria-label={`Deny: ${item.title}`} onClick={() => run('decline')}>Deny</Button>}
      {can('approve') && (item.whole
        ? <Button tone="success" icon="check" disabled={busy} aria-label={`Approve now: ${item.title}`} onClick={() => run('approve')}>Approve now</Button>
        : <Button tone="success" icon="chevron-right" disabled={busy} aria-label={`Approve now: ${item.title} (see the whole call first)`} title="The call is long: see all of it first" onClick={() => go(rt, 'approval', { id: item.id, do: 'approve' })}>Approve now</Button>)}
    </div>
  );
}

/** Grid id = dataset id: plugins may attach filters and sorts to it too (lib-datagrid datasets). */
export const APPROVALS_GRID = 'axhub-approvals';
const SOURCE_FILTER_OWNER = 'axhub-web.source';

/**
 * Every request in the framework grid (Brett, Nov 1 2026: "WHO asked and WHAT it is"): Source badge, Who (session,
 * build or agent name), What (the reason title first, the tool as a small chip), Requested, Countdown, and the row's
 * Deny / Approve now. Columns sort from their header and hide from its menu; the source chips filter through the grid's
 * dataset. Rows are keyed by request id and every cell reads the latest read, so a poll updates them in place.
 */
function ApprovalsTable({ items, onDone }: { items: ApprovalItem[]; onDone: () => void }) {
  const [sort, setSort] = useState<GridSort>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [only, setOnly] = useState<string>('');
  const [replies, setReplies] = useState<Record<string, KeptReply<ApprovalItem>>>({});
  // Same JSON as the last read = the same object (flicker fix, Nov 1 2026): memoised cells of unchanged rows don't redraw.
  const kept = useRef(new Map<string, ApprovalItem>());
  const rows = useMemo(() => {
    const next = new Map<string, ApprovalItem>();
    const out = items.map((i) => {
      const was = kept.current.get(i.id);
      const base = was && sameJson(was, i) ? was : i;
      next.set(i.id, base);
      return shownRow(base, replies[i.id]);
    });
    kept.current = next;
    return out;
  }, [items, replies]);
  const chips = sourceChips(items);

  // The source filter is a transform on the grid's dataset, so the grid (and anything else showing it) agrees.
  useEffect(() => {
    if (!only) { clearDatasetTransform(APPROVALS_GRID, SOURCE_FILTER_OWNER); return; }
    setDatasetTransform<ApprovalItem>(APPROVALS_GRID, SOURCE_FILTER_OWNER, { filter: (r) => sourceKind(r) === only, active: true, label: `Source: ${SOURCE_LABEL[only] ?? only}` });
  }, [only]);
  useEffect(() => () => clearDatasetTransform(APPROVALS_GRID, SOURCE_FILTER_OWNER), []);
  useEffect(() => { if (only && !chips.some((c) => c.kind === only)) setOnly(''); }, [only, chips]);

  const done = (from: ApprovalItem) => (next?: ApprovalItem) => {
    if (next) setReplies((r) => ({ ...r, [from.id]: { base: replyBase(from), item: next } }));
    onDone();
  };
  const columns: GridColumn<ApprovalItem>[] = [
    { id: 'source', label: 'Source', width: 'minmax(max-content, 1fr)', sortable: true, sortValue: (r) => `${SOURCE_ORDER.indexOf(sourceKind(r) as (typeof SOURCE_ORDER)[number])}`, render: (r) => <SourceCell item={r} /> },
    { id: 'who', label: 'Who', width: 'minmax(calc(var(--fx-space) * 8), 1.2fr)', sortable: true, sortValue: (r) => sourceWho(r).toLowerCase(), render: (r) => <span className="axp-axhub-who" title={sourceWho(r) || undefined}>{sourceWho(r) || '—'}</span> },
    { id: 'what', label: 'What', width: 'minmax(calc(var(--fx-space) * 14), 4fr)', fixed: true, sortable: true, sortValue: (r) => r.title.toLowerCase(), render: (r) => <WhatCell item={r} /> },
    { id: 'requested', label: 'Requested', width: 'minmax(max-content, 1fr)', sortable: true, sortValue: requestedKey, render: (r) => <span className="fx-muted" title={new Date(r.createdAt).toLocaleString()}>{relTime(r.createdAt)}</span> },
    { id: 'countdown', label: 'Countdown', width: 'minmax(max-content, 1fr)', sortable: true, sortValue: (r) => countdownKey(r), render: (r) => <CountdownCell item={r} /> },
    { id: 'decide', label: 'Decide', width: 'max-content', render: (r) => (isHeld(r) ? <HeldBar item={r} onDone={done(r)} /> : <RowDecideCell item={r} onDone={done(r)} />) },
  ];
  const waiting = rows.filter((r) => isHeld(r) || r.status === 'pending');
  const rest = rows.filter((r) => !waiting.includes(r));
  const groups: GridGroup<ApprovalItem>[] = [
    ...(waiting.length ? [{ id: 'waiting', title: 'Waiting on you', icon: 'shield', rows: waiting, groups: [], fixed: true }] : []),
    ...(rest.length ? [{ id: 'earlier', title: 'Earlier', icon: 'list', rows: rest, groups: [], fixed: true }] : []),
  ];
  return (
    <div className="fx-stack">
      {chips.length > 1 && (
        <div className="fx-row fx-row--wrap" role="group" aria-label="Source">
          <button type="button" className={`fx-chip${only ? '' : ' is-on'}`} aria-pressed={!only} onClick={() => setOnly('')}>Every source</button>
          {chips.map((c) => (
            <button key={c.kind} type="button" className={`fx-chip${only === c.kind ? ' is-on' : ''}`} aria-pressed={only === c.kind} onClick={() => setOnly(only === c.kind ? '' : c.kind)}>
              {c.label} · {c.count}
            </button>
          ))}
        </div>
      )}
      <DataGrid<ApprovalItem>
        id={APPROVALS_GRID}
        label="Approvals"
        groups={groups}
        columns={columns}
        rowId={(r) => r.id}
        rowLabel={(r) => `${r.title} ${sourceWho(r)} ${r.tool}`}
        hidden={hidden}
        onToggleColumn={(c, show) => setHidden((h) => (show ?? h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))}
        onShowAll={() => setHidden([])}
        sort={sort}
        onSort={(c) => setSort((s0) => nextSort(s0, c))}
        expanded={expanded}
        onToggleExpand={(id) => setExpanded((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))}
        renderDetail={(r) => <RowDetail item={r} onDone={onDone} />}
        rowTone={(r) => (isHeld(r) ? 'warning' : r.status === 'pending' ? 'accent' : STATUS_TONE[r.status] ?? 'muted')}
        empty="No requests."
      />
    </div>
  );
}

/** Source badge (Claude.ai / Claude Code / Headless / Console / Agent / System); the client in its tooltip. */
const SourceCell = memo(function SourceCell({ item }: { item: ApprovalItem }) {
  const kind = sourceKind(item);
  const label = item.source?.label || SOURCE_LABEL[kind]!;
  const client = [item.source?.client, item.source?.clientVersion].filter(Boolean).join(' ');
  return <span title={client ? `${label} · ${client}` : label} data-source={kind}><Chip tone={SOURCE_TONE[kind]}>{label}</Chip></span>;
});

/** The reason title first (truncates first), then the tool as a small chip. The row opens below (or Details). */
const WhatCell = memo(function WhatCell({ item }: { item: ApprovalItem }) {
  return (
    <span className="axp-axhub-what">
      <strong className="axp-axhub-what__title" title={item.title}>{item.title}</strong>
      <span className="axp-axhub-what__tool"><Chip>{item.tool}</Chip></span>
    </span>
  );
});

/** Held: the live countdown; waiting: the time left; decided: its status. */
const CountdownCell = memo(function CountdownCell({ item }: { item: ApprovalItem }) {
  if (isHeld(item)) return <HeldChip item={item} />;
  if (item.showExpires) return <Chip tone={STATUS_TONE[item.status]}>{relTime(item.expiresAt)}</Chip>;
  return <Chip tone={STATUS_TONE[item.status]}>{item.statusLabel}</Chip>;
});

/** Deny / Approve now on a waiting row (the hub's reply shows at once). */
function RowDecideCell({ item, onDone }: { item: ApprovalItem; onDone: (next?: ApprovalItem) => void }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const run = async (a: ApprovalAction) => {
    setBusy(true);
    try { const r = await act(item, a); rt.toast(r.message || 'Done.', a === 'approve' ? 'success' : 'info'); onDone(r.item); }
    catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); onDone(); }
    finally { setBusy(false); }
  };
  return <RowDecide item={item} busy={busy} run={(a) => void run(a)} />;
}

/** An opened row: what it does, the code, who and when, and the rest of its actions. */
function RowDetail({ item, onDone }: { item: ApprovalItem; onDone: () => void }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const held = isHeld(item);
  // Approve / Deny sit on the row; the rest (postpone, ignore, revoke, reopen) here. A held call has only its own buttons.
  const quick = held ? [] : item.actions.filter((a) => a !== 'approve' && a !== 'decline');
  const run = async (a: ApprovalAction) => {
    if (a === 'postpone') { go(rt, 'approval', { id: item.id, postpone: '1' }); return; }
    setBusy(true);
    try { const r = await act(item, a); rt.toast(r.message || 'Done.', 'info'); }
    catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); }
    finally { setBusy(false); onDone(); }
  };
  return (
    <div className="fx-stack">
      <WhatItDoes item={item} />
      <CodeSection item={item} />
      <p className="fx-muted">
        Asked {relTime(item.createdAt)}{sourceWho(item) ? ` by ${sourceWho(item)}` : ''} ({item.source?.label ?? 'Unknown'}{item.source?.client ? `, ${item.source.client}${item.source.clientVersion ? ` ${item.source.clientVersion}` : ''}` : ''}) · caller {item.callerId}
        {item.showExpires ? ` · expires ${relTime(item.expiresAt)}` : ''}
        {item.decidedBy ? ` · by ${item.decidedBy}` : ''}
      </p>
      {item.postponed && (
        <p className="fx-muted">Waiting for {item.postponed.waitingFor}{item.postponed.lastNote ? ` · ${item.postponed.lastNote}` : ''}</p>
      )}
      {item.reviewRequired && <Note tone="warning" icon="alert">Postponed for over 2 hours: look at it again.</Note>}
      <div className="fx-row fx-row--wrap">
        {quick.map((a) => (
          <Button key={a} size="sm" disabled={busy} tone={a === 'revoke' ? 'danger' : 'neutral'} onClick={() => void run(a)}>
            {ACTION_LABELS[a]}
          </Button>
        ))}
        <Button size="sm" tone="ghost" icon="chevron-right" onClick={() => go(rt, 'approval', { id: item.id })}>
          {item.actions.includes('approve') && !item.whole ? 'Review the whole call' : 'Details'}
        </Button>
      </div>
    </div>
  );
}
