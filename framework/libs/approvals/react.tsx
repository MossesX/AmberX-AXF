/**
 * lib-approvals (web) — the title bar badge and its popover, for any AXF app (Oct 28 2026, Opus).
 *
 *   import { ApprovalsBadge, setApprovalsHost } from '<app>/axf/libs/approvals/react';
 *   <header>… <ApprovalsBadge hub={hub} frame /> …</header>
 *
 * - Nothing is drawn while nothing is waiting (or the app's hub session can't read the feed).
 * - The badge shows the count (urgent colour when a held call is ≤ 30 s from running) and opens a popover: each approval
 *   with Approve / Decline, each held call with its live countdown and Deny (never Approve), "Open on axHub", and a
 *   result toast.
 * - Deciding: an app's own path first ({@link setApprovalsHost} `decide`, e.g. the AmberX phone's hub web view and native
 *   Deny); else directly when the page is on the hub's own origin; else the hub's approval page inside the popover where
 *   the hub allows framing (`frame`, `AXHUB_APPROVALS_FRAME_ANCESTORS`); else the page opens (`window.open`, which
 *   AmberX routes to its hub view). When an item the user acted on leaves the feed, the toast says so.
 * - {@link requestApprovalsOpen} (a notification tap, a push) opens the popover on the next badge on screen.
 *
 * Theme tokens only (approvals.css), framework controls only; the badge is `flex: none` so it snaps beside its
 * neighbours in a title bar and never draws over them; the popover is portalled with fixed coordinates.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, useOptionalRuntime, usePortalRoot } from '../../react';
import { HUB_DEFAULT, normalizeHub } from '../hub/hub';
import { formatCountdown } from '../hub/veto';
import {
  APPROVALS_OPEN_EVENT, DECISION_LABELS, badgeLabel, badgeText, canDecideHere, countdownOf, decideOnHub, freshIds, goneIds, goneMessage, isUrgent, rowOrder,
  approvalsWatcher, type ApprovalDecision, type ApprovalItem, type ApprovalsState, type DecideResult,
} from './index';
import { ApprovalRow } from './row';
import { detailsOfItem } from './details';
import './approvals.css';

export { ApprovalDetailsPanel, ApprovalRow, SourceBadge, RESULT_LINES, type ApprovalDetailsPanelProps, type ApprovalRowProps } from './row';

/* ---------------------------------------------------------------- the host seam */

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
const useHost = () => useSyncExternalStore((f) => { hostSubs.add(f); return () => { hostSubs.delete(f); }; }, () => host, () => host);

let pendingOpen: { id: string | null } | null = null;
let mounted = 0;
/** How many badges are on screen now (0: a notification tap should bring a title bar with one up first). */
export const approvalsBadgesOnScreen = (): number => mounted;
/** Open the popover (on the badge on screen now, or the next one to mount), `id` first. */
export function requestApprovalsOpen(id: string | null = null): void {
  pendingOpen = { id };
  globalThis.dispatchEvent?.(new CustomEvent(APPROVALS_OPEN_EVENT, { detail: { id } }));
}

/* ---------------------------------------------------------------- hooks */

/** The approvals for `hub`, live while mounted (one shared watcher per hub). */
export function useApprovalsFeed(hub: string, everyMs?: number): { state: ApprovalsState; refresh: () => void } {
  const w = approvalsWatcher(hub, { everyMs });
  const state = useSyncExternalStore(w.subscribe, () => w.state, () => w.state);
  useEffect(() => {
    users.set(w, (users.get(w) ?? 0) + 1);
    w.start();
    return () => { const left = (users.get(w) ?? 1) - 1; users.set(w, left); if (left <= 0) w.stop(); };
  }, [w]);
  useEffect(() => { if (everyMs) w.setEvery(everyMs); }, [w, everyMs]);
  return { state, refresh: useCallback(() => void w.check(), [w]) };
}
const users = new Map<ReturnType<typeof approvalsWatcher>, number>();

function useTick(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => setN((n) => n + 1), 1_000); return () => clearInterval(t); }, [on]);
}

/** The hub to use: the app's host, then the prop, then `resolveHub()`, then the default. */
function useHubAddress(prop?: string, resolveHub?: () => Promise<string>): string | null {
  const h = useHost();
  const fixed = normalizeHub(h.hub) ?? normalizeHub(prop);
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    if (fixed || !resolveHub) return;
    let alive = true;
    void resolveHub().then((v) => { if (alive) setResolved(normalizeHub(v) ?? HUB_DEFAULT); }, () => { if (alive) setResolved(HUB_DEFAULT); });
    return () => { alive = false; };
  }, [fixed, resolveHub]);
  return fixed ?? (resolveHub ? resolved : HUB_DEFAULT);
}

/* ---------------------------------------------------------------- the badge */

export interface ApprovalsBadgeProps {
  /** The hub (an app host's `hub` wins). */
  hub?: string;
  /** Where to find the hub when neither is set (e.g. the console's `/api/me`). */
  resolveHub?: () => Promise<string>;
  /** The hub frames its approval page for this origin (an app host's `frame` wins). */
  frame?: boolean;
  className?: string;
}

/** The count in a title bar; nothing when nothing is waiting. Click: the popover. */
export function ApprovalsBadge(props: ApprovalsBadgeProps) {
  const hub = useHubAddress(props.hub, props.resolveHub);
  return hub ? <BadgeFor hub={hub} {...props} /> : null;
}

function BadgeFor({ hub, frame: frameProp, className }: ApprovalsBadgeProps & { hub: string }) {
  const h = useHost();
  const { state } = useApprovalsFeed(hub, h.everyMs);
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const seen = useRef<string[] | null>(null);
  const hasHeld = state.items.some((i) => i.kind === 'held');
  useTick(hasHeld);

  // A new item: the badge pulses once (it pops up in the title bar; the popover opens on a tap or a notification).
  useEffect(() => {
    if (state.status !== 'ok') return;
    const was = seen.current;
    seen.current = state.items.map((i) => i.id);
    if (was && freshIds(was, state.items).length) { setFresh(true); const t = setTimeout(() => setFresh(false), 2_400); return () => clearTimeout(t); }
    return undefined;
  }, [state]);

  useEffect(() => { mounted++; return () => { mounted--; }; }, []);

  // A notification tap / push: open, that item first.
  useEffect(() => {
    const take = () => { if (!pendingOpen) return; setFirst(pendingOpen.id); pendingOpen = null; setOpen(true); };
    take();
    globalThis.addEventListener?.(APPROVALS_OPEN_EVENT, take);
    return () => globalThis.removeEventListener?.(APPROVALS_OPEN_EVENT, take);
  }, []);

  const text = badgeText(state);
  if (!text) return open ? <Popover hub={hub} state={state} anchor={btn} frame={h.frame ?? !!frameProp} first={first} onClose={() => setOpen(false)} /> : null;
  const urgent = isUrgent(state);
  return (
    <span className={`axf-approvals ${className ?? ''}`}>
      <button
        ref={btn} type="button" className={`fx-iconbtn axf-approvals__badge${fresh ? ' is-fresh' : ''}`}
        aria-label={badgeLabel(state)} title={badgeLabel(state)} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setFirst(null); setOpen((v) => !v); }}
      >
        <Icon name={hasHeld ? 'clock' : 'shield'} size={16} />
        <span className={`axf-approvals__count${urgent ? ' is-urgent' : ''}`} data-held={hasHeld ? '1' : undefined}>{hasHeld && state.count === 1 ? formatCountdown(countdownOf(state.items[0]!) ?? 0) : state.count}</span>
      </button>
      {open && <Popover hub={hub} state={state} anchor={btn} frame={h.frame ?? !!frameProp} first={first} onClose={() => setOpen(false)} />}
    </span>
  );
}

/* ---------------------------------------------------------------- the popover */

function Popover({ hub, state, anchor, frame, first, onClose }: { hub: string; state: ApprovalsState; anchor: RefObject<HTMLButtonElement>; frame: boolean; first: string | null; onClose: () => void }) {
  const rt = useOptionalRuntime();
  const root = usePortalRoot();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  const [busy, setBusy] = useState('');
  const [framed, setFramed] = useState<ApprovalItem | null>(null);
  const acted = useRef(new Map<string, ApprovalItem>());
  const prevIds = useRef<string[]>(state.items.map((i) => i.id));
  useTick(true);

  const toast = (msg: string, kind: 'success' | 'danger' | 'info' | 'warning') => rt?.toast(msg, kind, 'Approvals');

  // Items the user acted on that left the feed: decided (or expired) on the hub, so say so; a framed page closes.
  useEffect(() => {
    if (state.status !== 'ok') return;
    for (const id of goneIds(prevIds.current, state.items)) {
      const it = acted.current.get(id);
      if (it) { toast(goneMessage(it), 'success'); acted.current.delete(id); }
      if (framed?.id === id) setFramed(null);
    }
    prevIds.current = state.items.map((i) => i.id);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fixed coordinates under the badge, kept inside the viewport (phone: nearly full width).
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(framed ? 560 : 400, vw - 16);
      const left = r ? Math.max(8, Math.min(r.right - width, vw - width - 8)) : (vw - width) / 2;
      const top = r ? r.bottom + 6 : 56;
      setPos({ left, top, width, maxHeight: Math.max(160, vh - top - 12) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, framed]);

  // Escape or a tap outside closes it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose(); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', down, true);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', down, true); };
  }, [anchor, onClose]);

  const openPage = (url: string) => { if (host.open) host.open(url); else globalThis.open?.(url, '_blank', 'noopener,noreferrer'); };

  const run = async (item: ApprovalItem, d: ApprovalDecision) => {
    setBusy(`${item.id}:${d}`);
    acted.current.set(item.id, item);
    try {
      let r: DecideResult;
      if (host.decide) r = await host.decide(item, d);
      else if (canDecideHere(hub, globalThis.location?.origin)) r = await decideOnHub(hub, item, d);
      else if (frame) { setFramed(item); r = { ok: true, opened: true, message: '' }; }
      else { openPage(item.url); r = { ok: true, opened: true, message: '' }; }
      if (!r.opened) { toast(r.message, r.ok ? 'success' : 'danger'); if (r.ok) acted.current.delete(item.id); }
      void approvalsWatcher(hub).check();
    } catch (e) {
      toast((e as Error)?.message || 'Something went wrong.', 'danger');
    } finally {
      setBusy('');
    }
  };

  const items = first ? [...state.items.filter((i) => i.id === first), ...state.items.filter((i) => i.id !== first)] : state.items;
  const more = state.count - state.items.length;

  return createPortal(
    <div ref={box} className="fx-popover axf-approvals__pop" style={pos} role="dialog" aria-label="Approvals waiting on axHub">
      <div className="axf-approvals__head">
        {framed ? <Button size="sm" icon="arrow-left" onClick={() => setFramed(null)}>Back</Button> : <strong title={badgeLabel(state)}>{state.count ? `${state.count} waiting on axHub` : 'Nothing waiting'}</strong>}
        <button type="button" className="fx-iconbtn" aria-label="Close" title="Close" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      {framed ? (
        <div className="axf-approvals__framed">
          <iframe className="axf-approvals__frame" title={`Approval on axHub: ${framed.title}`} src={framed.url} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" />
          <p className="fx-small fx-muted axf-approvals__note">axHub's own page: {framed.kind === 'held' ? 'Deny' : 'Approve or Decline'} runs there. Blank? <a href={framed.url} target="_blank" rel="noopener noreferrer">Open it on the hub <Icon name="external" size={12} /></a></p>
        </div>
      ) : (
        <ul className="axf-approvals__list">
          {items.map((it) => <Row key={it.id} item={it} hub={hub} busy={busy} onDecide={(d) => void run(it, d)} openPage={openPage} />)}
          {state.items.length === 0 && <li className="fx-muted fx-small">Nothing is waiting on axHub.</li>}
          {more > 0 && <li className="fx-muted fx-small">…and {more} more on the hub.</li>}
        </ul>
      )}
      {!framed && <div className="axf-approvals__foot"><a className="fx-small" href={state.approvalsUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (host.open) { e.preventDefault(); host.open(state.approvalsUrl); } }}>All approvals on axHub <Icon name="external" size={12} /></a></div>}
    </div>,
    root,
  );
}

/** One item: the shared expandable row (caret far right, details in place), Deny / Approve on the collapsed row too. */
function Row({ item, hub, busy, onDecide, openPage, scope = 'popover', stack = true }: { item: ApprovalItem; hub: string; busy: string; onDecide: (d: ApprovalDecision) => void; openPage: (url: string) => void; scope?: string; stack?: boolean }) {
  const left = countdownOf(item);
  const Wrap = stack ? 'li' : 'div';
  return (
    <Wrap className="axf-approvals__li">
      <ApprovalRow
        scope={scope} details={detailsOfItem(item)} hub={hub} busy={busy} onDecide={onDecide} openPage={openPage} compact={stack} stack={stack}
        actions={
          <div className="axf-approvals__actions">
            {/* Approve / Deny on every row (Brett, Oct 30 2026): big targets, green and red, the safe one first. */}
            {rowOrder(item.decisions).map((d) => (
              <Button key={d} tone={d === 'approve' ? 'success' : 'danger'} icon={d === 'approve' ? (item.kind === 'held' ? 'play' : 'check') : d === 'deny' ? 'x-circle' : 'x'}
                busy={busy === `${item.id}:${d}`} disabled={!!busy || (item.kind === 'held' && left === 0)} onClick={() => onDecide(d)}>{DECISION_LABELS[d]}</Button>
            ))}
          </div>
        }
      />
    </Wrap>
  );
}

/* ---------------------------------------------------------------- the list (a page of rows) */

export interface ApprovalsListProps {
  /** The hub (an app host's `hub` wins). */
  hub?: string;
  /** Surface name for the open-row store (default 'list'). */
  scope?: string;
  /** Shown when nothing waits (default a short line). */
  empty?: ReactNode;
}

/**
 * Everything waiting, as expandable rows (AmberX's approvals view, any app page): Deny / Approve on each collapsed row
 * and inside the open one. Deciding: the app host's path, else directly on the hub's own origin, else the hub's page.
 */
export function ApprovalsList({ hub: hubProp, scope = 'list', empty }: ApprovalsListProps) {
  const h = useHost();
  const hub = normalizeHub(h.hub) ?? normalizeHub(hubProp) ?? HUB_DEFAULT;
  const rt = useOptionalRuntime();
  const { state } = useApprovalsFeed(hub, h.everyMs);
  const [busy, setBusy] = useState('');
  const openPage = (url: string) => { if (host.open) host.open(url); else globalThis.open?.(url, '_blank', 'noopener,noreferrer'); };
  const run = async (item: ApprovalItem, d: ApprovalDecision) => {
    setBusy(`${item.id}:${d}`);
    try {
      let r: DecideResult;
      if (host.decide) r = await host.decide(item, d);
      else if (canDecideHere(hub, globalThis.location?.origin)) r = await decideOnHub(hub, item, d);
      else { openPage(item.url); r = { ok: true, opened: true, message: '' }; }
      if (!r.opened) rt?.toast(r.message, r.ok ? 'success' : 'danger', 'Approvals');
      void approvalsWatcher(hub).check();
    } catch (e) {
      rt?.toast((e as Error)?.message || 'Something went wrong.', 'danger', 'Approvals');
    } finally { setBusy(''); }
  };
  if (state.status !== 'ok') return null;
  const more = state.count - state.items.length;
  return (
    <div className="axf-approvals__page">
      {state.items.length === 0 && (empty ?? <p className="fx-muted">Nothing is waiting on axHub.</p>)}
      {state.items.map((it) => <Row key={it.id} item={it} hub={hub} busy={busy} onDecide={(d) => void run(it, d)} openPage={openPage} scope={scope} stack={false} />)}
      {more > 0 && <p className="fx-small fx-muted">…and {more} more on the hub. <a href={state.approvalsUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (host.open) { e.preventDefault(); host.open(state.approvalsUrl); } }}>See them all</a></p>}
    </div>
  );
}
