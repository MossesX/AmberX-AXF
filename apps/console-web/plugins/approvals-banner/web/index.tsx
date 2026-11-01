/**
 * Approvals banner console plugin (ai.amberx.axf.console.approvals-banner).
 *
 * Shows a banner at the top of every view while axHub has calls waiting for approval (axHub decision #85). The browser
 * reads the hub's feed `GET <hub>/auth/admin/approvals.json` with its own hub session cookie (same site, credentials
 * included); the console server isn't involved and never sees the session. Only signed-in hub admins get an answer:
 * anyone else (or a console opened with just the console token) sees nothing. The banner never approves: Review opens
 * the request on the hub's own page, where Approve/Reject live.
 *
 * Polls every 5 s while the page is visible, again on focus. Hiding it lasts until something new arrives.
 *
 * Hub address rules, the feed read (credentials included, redirects refused, reply size-capped), the status mapping and
 * every hub link come from the framework's lib-hub (`framework/libs/hub`, Oct 20 2026 harvest), the same rules the AXHub
 * phone app uses; only items whose link points at the hub are kept, and links are rebuilt from the approval id.
 *
 * Opens by itself (Oct 20 2026, axHub decision #87): each new request opens once in the `approvals.review` dialog, which
 * shows the hub's own approval page in a frame (the hub allows that only for the console's origin, set in
 * AXHUB_APPROVALS_FRAME_ANCESTORS). Approve/Reject run on the hub's page with its Origin + CSRF checks, so the console
 * still never approves anything itself. When the request is decided the dialog closes. "Open new approvals by
 * themselves" can be switched off in its settings (per browser).
 *
 * Held commands (veto@1, Brett Oct 28 2026): a command Claude sends through Vinnie is held by the hub for a countdown
 * (90 s since axHub decision 104) and then run, unless Brett stops it. The feed lists those with `status: "held"`;
 * lib-hub's `veto.ts` splits them off. Held entries show a live countdown with **Deny**, **Approve** (run it now) and
 * **Shelve** (pause the countdown until he decides), decision 104; tapping one opens the veto screen (`approvals.veto`).
 *
 * The veto banner (Brett, Oct 30 2026): the veto notices, the veto screen and the alarm belong to this plugin, so they
 * work in every app it is installed in (`targets`: the console and AmberX, whose phone app shows the AmberX web app).
 * Actions use the app's host when it has one (AmberX's phone shell posts with its own hub session, rings the alarm on
 * the alarm stream through silent mode and puts Deny / Approve / Shelve on its notifications), else a page on the hub's
 * origin, else the call's page on the hub. See `veto.tsx` and `alarm.ts`.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Icon, useBannerLaunchOpen, BannerIcon } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { HUB_DEFAULT, approvalUrl, normalizeHub, approvalsUrl, type HubApproval, type HubFeedStatus } from '@console/axf/libs/hub/hub';
import { onVetoHost, vetoHost, VETO_ACTIONS, type VetoAction, type VetoCall } from '@console/axf/libs/hub/veto';
import { ALARM_KEYS, START_AT, TONES, VIBRATIONS, ALARM_DEFAULTS } from './alarm';
import { act, actResult, AlarmPanel, syncNativeAlarm, VetoButtons, VetoScreen, watch, type VetoDeps } from './veto';
import { approvalsHost, ApprovalRow } from '@console/axf/libs/approvals/react';
import { approvalExpandKey, detailsOfItem, fetchApprovals, heldDecisions, registerApprovalsLookup, type ApprovalDecision, type ApprovalItem, type DecideResult } from '@console/axf/libs/approvals';
import { decidedState, decisionButtons } from '@console/axf/libs/approvals/menu';
import type { MenuActResult, MenuItem } from '@console/axf/core';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { WatchLiveFor } from '@console/watchLive';
import './approvals-banner.css';
import { appMenu, WAITING, WAITING_LIST } from './menu';

const ID = 'ai.amberx.axf.console.approvals-banner';
const FOLDER = 'approvals-banner';
const POLL_MS = 5_000;
const AUTO_KEY = 'approvals-banner.autoOpen';
const OPENED_KEY = 'approvals-banner.opened';
let runtime: AxfRuntime | null = null;
/** Per-browser conveniences; storage can be missing or throw, so everything falls back to defaults. */
const load = (k: string) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } };
const save = (k: string, v: string) => { try { globalThis.localStorage?.setItem(k, v); } catch { /* fine */ } };
export const autoOpenOn = () => load(AUTO_KEY) !== 'off';
const opened = new Set<string>((load(OPENED_KEY) ?? '').split(',').filter(Boolean));
let reviewing: string | null = null;
/** Open each new request once, in the console, unless switched off or one is already on screen. */
function autoOpen(pending: { id: string }[]) {
  if (!runtime || !autoOpenOn() || reviewing) return;
  const next = pending.find((p) => !opened.has(p.id));
  if (!next) return;
  opened.add(next.id);
  save(OPENED_KEY, [...opened].slice(-50).join(','));
  openReview(next.id);
}
export function openReview(id: string) {
  // A held call opens the veto screen (Deny / Approve / Shelve), a call waiting for an approval the hub's page.
  if (st.held.some((c) => c.id === id)) { openVeto(id); return; }
  reviewing = id; runtime?.openDialog('approvals.review', { id });
}
export function openVeto(id: string) { reviewing = id; runtime?.openDialog('approvals.veto', { id }); }
const deps: VetoDeps = {
  hub: () => st.hub,
  toast: (text, kind) => runtime?.toast(text, kind, 'Approvals'),
  refresh: () => { void checkNow(); },
};
const DEFAULT_HUB = HUB_DEFAULT;

type Pending = HubApproval;
type Status = 'idle' | HubFeedStatus;
interface State { status: Status; hub: string; count: number; pending: Pending[]; held: VetoCall[]; items: ApprovalItem[]; approvalsUrl: string; checkedAt: string | null; hiddenIds: string; error: string }

/* ---------------- a tiny store shared by the banner and the settings panel ---------------- */

let st: State = { status: 'idle', hub: DEFAULT_HUB, count: 0, pending: [], held: [], items: [], approvalsUrl: approvalsUrl(DEFAULT_HUB), checkedAt: null, hiddenIds: '', error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; runtime?.setBadge(WAITING, st.status === 'ok' ? st.count + st.held.length : 0); subs.forEach((f) => f()); };
const useApprovals = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

/** The hub's address, from the console's own account endpoint (AXF_WALL_HUB on the server); https only. */
async function hubUrl(): Promise<string> {
  try {
    const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    const j = (await r.json()) as { hub?: string };
    const hub = normalizeHub(j.hub);
    if (hub) return hub;
  } catch { /* fall back */ }
  return DEFAULT_HUB;
}

let inflight = false;
export async function checkNow(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const hub = st.status === 'idle' ? await hubUrl() : st.hub;
    // lib-approvals over lib-hub: the browser's own hub session (credentials included), redirects refused, reply capped,
    // links checked; held commands (countdown + Deny) split off the calls waiting for an approval; each item keeps its
    // feed entry for the expanded row (who asked, timeline).
    const a = await fetchApprovals(hub);
    const ok = a.status === 'ok';
    const items = ok ? a.items : [];
    const held = items.flatMap((i) => (i.kind === 'held' && i.veto ? [i.veto] : []));
    const pending: Pending[] = items.filter((i) => i.kind === 'approval').map((i) => ({ id: i.id, tool: i.tool, summary: i.summary, createdAt: i.createdAt, expiresAt: i.expiresAt, url: i.url }));
    const status: Status = a.status === 'idle' ? 'unreachable' : a.status;
    set({ hub, status, count: ok ? Math.max(pending.length, a.count - held.length) : 0, pending, held, items, approvalsUrl: a.approvalsUrl, checkedAt: new Date().toISOString(), error: a.error });
    watch.update(held);
    // Shelved calls wait quietly: they don't pop up again.
    autoOpen([...held.filter((c) => !c.shelved && !c.approvedNow), ...pending]);
  } finally {
    inflight = false;
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  void checkNow();
  setInterval(() => { if (document.visibilityState === 'visible') void checkNow(); }, POLL_MS);
  // Notices + alarm follow the local countdown between reads (the alarm also rings with the page in the background).
  setInterval(() => { if (st.status === 'ok') watch.update(st.held); }, 1_000);
  globalThis.addEventListener('focus', () => void checkNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkNow(); });
}

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
/** The command (or arguments) out of the hub's summary, for one short line. */
const shortSummary = (p: Pending) => {
  const m = /"command":"((?:[^"\\]|\\.)*)"/.exec(p.summary);
  const name = /"name":"([^"\\]{1,60})"/.exec(p.summary)?.[1];
  const target = /"target":"([^"\\]{1,120})"/.exec(p.summary)?.[1];
  const text = m ? m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : name ? `${name}${target ? ` ${target}` : ''}` : p.summary.replace(/^\S+ with arguments /, '');
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

/* ---------------- the banner ---------------- */

/** Re-renders every second while a held command counts down (the countdown runs on this browser's clock). */
function useTick(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => setN((n) => n + 1), 1_000); return () => clearInterval(t); }, [on]);
}

/** The feed item behind a row (for the expanded details), or one built from what the banner holds. */
const itemOf = (id: string): ApprovalItem | undefined => st.items.find((i) => i.id === id);

/**
 * One held command: the shared expandable row (lib-approvals, Brett Nov 1 2026): who asked, the title, the live countdown
 * and Deny / Approve / Shelve on the collapsed row; a tap or the caret on the far right opens the details in place
 * (Deny / Approve inside too). The veto screen is one tap away inside ("Full approval page").
 */
function HeldRow({ c }: { c: VetoCall }) {
  const it = itemOf(c.id);
  const [busy, setBusy] = useState('');
  if (!it) return null;
  const decide = (d: ApprovalDecision) => { setBusy(`${c.id}:${d}`); void act(deps, c, d === 'approve' ? 'approve-now' : 'deny').finally(() => setBusy('')); };
  return (
    <ApprovalRow scope="banner" className="axp-approvals-banner__xrow" compact details={detailsOfItem(it)} hub={st.hub} busy={busy} onDecide={decide}
      openPage={() => openVeto(c.id)} actions={<VetoButtons c={c} deps={deps} row />} />
  );
}

/**
 * Approve / Deny for a call waiting for an approval (Brett, Oct 30 2026: on every row). The hub takes a decision only
 * from its own pages (Origin + CSRF), so the app's own deciding path goes first (AmberX: the signed-in hub web view);
 * otherwise the hub's page opens in the review dialog, where the tap is confirmed. The console never approves itself.
 */
async function decidePending(p: Pending, d: ApprovalDecision): Promise<DecideResult> {
  const decide = approvalsHost().decide;
  if (!decide) { openReview(p.id); return { ok: true, opened: true, message: '' }; }
  const item: ApprovalItem = itemOf(p.id) ?? {
    kind: 'approval', id: p.id, tool: p.tool, title: `${p.tool}: ${shortSummary(p)}`, description: '', summary: p.summary, command: '',
    createdAt: p.createdAt, expiresAt: p.expiresAt, url: p.url, decisions: ['approve', 'decline'], revision: null, veto: null,
  };
  let r: DecideResult;
  try {
    r = await decide(item, d);
    if (!r.opened) runtime?.toast(r.message, r.ok ? 'success' : 'danger', 'Approvals');
  } catch (e) { r = { ok: false, message: (e as Error)?.message || 'Something went wrong.' }; runtime?.toast(r.message, 'danger', 'Approvals'); }
  void checkNow();
  return r;
}

/* ---------------- the application menu's live list: Deny / Approve on every row ---------------- */

/**
 * Rows for Console → Approvals waiting and Apps → axHub → Waiting for approval: held calls (live countdown, Shelved
 * when paused) then calls waiting for an approval, each with red Deny and green Approve on the row (framework AppMenu
 * LiveRow). Approve on a held call runs it now (veto@1 approve-now), Deny stops it; an approval decides through the
 * app's own path or opens the review dialog (the row stays). The row reads Running / Denied in place, then drops off.
 */
export function menuRows(s: Pick<State, 'held' | 'pending'>): MenuItem[] {
  return [
    ...s.held.map((x): MenuItem => ({
      id: `held:${x.id}`, label: x.title, icon: x.shelved ? 'pause' : 'clock', action: `approvals.veto:${x.id}`, detail: x.command || x.tool,
      deadline: x.readAt + x.secondsLeft * 1000, ...(x.shelved ? { paused: 'Shelved' } : {}),
      buttons: decisionButtons({ kind: 'held', decisions: heldDecisions(x) }), expand: approvalExpandKey(x.id),
    })),
    ...s.pending.map((x): MenuItem => ({
      id: `approval:${x.id}`, label: `${x.tool}: ${shortSummary(x)}`, icon: 'shield', action: `approvals.review:${x.id}`, detail: x.tool,
      buttons: decisionButtons({ kind: 'approval', decisions: ['approve', 'decline'] }), expand: approvalExpandKey(x.id),
    })),
  ];
}

/**
 * The menu rows expand in place (caret on the far right, lib-approvals' details panel); the panel finds the item and
 * decides through the banner's own routes (veto@1 for held calls, the deciding path or the review dialog for approvals).
 */
registerApprovalsLookup({
  hub: () => st.hub,
  find: (id) => itemOf(id),
  decide: async (item, d) => {
    if (item.kind === 'held') {
      const c = st.held.find((x) => x.id === item.id);
      if (!c) return { ok: false, message: 'That call is no longer held.' };
      const r = await actResult(deps, c, d === 'approve' ? 'approve-now' : 'deny'); // toasts by itself
      return { ok: r.ok, message: '', opened: true };
    }
    const p = st.pending.find((x) => x.id === item.id);
    if (!p) return { ok: false, message: 'That one is no longer waiting.' };
    await decidePending(p, d); // toasts by itself
    return { ok: true, message: '', opened: true };
  },
});

/** One row button: the same routes as the banner's buttons (veto@1 for held calls, the deciding path for approvals). */
export async function menuAct(rowId: string, buttonId: string): Promise<MenuActResult> {
  const [kind, id] = [rowId.slice(0, rowId.indexOf(':')), rowId.slice(rowId.indexOf(':') + 1)];
  const d = buttonId as ApprovalDecision;
  if (kind === 'held') {
    const c = st.held.find((x) => x.id === id);
    if (!c) return { ok: false, message: 'That call is no longer held.' };
    const r = await actResult(deps, c, d === 'approve' ? 'approve-now' : 'deny'); // toasts by itself
    return r.ok ? { ok: true, state: decidedState({ kind: 'held' }, d) } : r.opened ? { ok: true, keep: true } : { ok: false };
  }
  const p = st.pending.find((x) => x.id === id);
  if (!p) return { ok: false, message: 'That one is no longer waiting.' };
  const r = await decidePending(p, d === 'approve' ? 'approve' : 'decline'); // toasts by itself
  return r.opened ? { ok: true, keep: true } : r.ok ? { ok: true, state: decidedState({ kind: 'approval' }, d) } : { ok: false };
}

/** Deny (red) and Approve (green), big targets that never shrink: the row's text gives way first. */
function PendingButtons({ p }: { p: Pending }) {
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const run = (d: ApprovalDecision) => { setBusy(d); void decidePending(p, d).finally(() => setBusy(null)); };
  return (
    <div className="fx-row axp-approvals-banner__acts">
      <Button tone="danger" icon="x-circle" busy={busy === 'decline'} disabled={busy !== null} aria-label={`Deny: ${p.tool}`} onClick={() => run('decline')}>Deny</Button>
      <Button tone="success" icon="check" busy={busy === 'approve'} disabled={busy !== null} aria-label={`Approve: ${p.tool}`} onClick={() => run('approve')}>Approve</Button>
    </div>
  );
}

/**
 * One call waiting for an approval: the shared expandable row: who asked, the reason title, the tool, then Deny /
 * Approve (and the hide button); a tap or the caret opens the details in place, Deny / Approve inside too.
 */
function PendingRow({ p, hide }: { p: Pending; hide?: () => void }) {
  const it = itemOf(p.id);
  const [busy, setBusy] = useState('');
  if (!it) return null;
  const decide = (d: ApprovalDecision) => { setBusy(`${p.id}:${d}`); void decidePending(p, d).finally(() => setBusy('')); };
  return (
    <ApprovalRow scope="banner" className="axp-approvals-banner__xrow" compact details={detailsOfItem(it)} hub={st.hub} busy={busy} onDecide={decide}
      openPage={() => openReview(p.id)}
      actions={<>
        <PendingButtons p={p} />
        {hide && <button type="button" className="fx-iconbtn" aria-label="Hide until something new is waiting" title="Hide until something new is waiting" onClick={hide}><Icon name="x" size={16} /></button>}
      </>} />
  );
}

/** Calls waiting for an approval shown as rows while the banner is collapsed (all of them once it's opened). */
const COLLAPSED_ROWS = 3;

function ApprovalsBanner() {
  const s = useApprovals();
  const [open, setOpen] = useBannerLaunchOpen(); // launches expanded unless its Banner settings say minimized
  useEffect(() => { start(); }, []);
  useTick(s.held.length > 0);
  if (s.status !== 'ok' || (s.count === 0 && s.held.length === 0)) return null;
  const ids = [...s.held, ...s.pending].map((p) => p.id).join(',');
  if (ids && ids === s.hiddenIds) return null;
  if (s.count === 0) {
    return (
      <div className="axp-approvals-banner" role="alert">
        {s.held.map((c) => <HeldRow key={c.id} c={c} />)}
      </div>
    );
  }
  const hide = () => set({ hiddenIds: ids });
  // One call waiting: its own row with Deny / Approve and the hide button. More: a summary row (open / close, all on
  // the hub, hide), then one row each with Deny / Approve, the first few while collapsed and all once opened.
  if (s.count === 1 && s.pending.length === 1) {
    return (
      <div className="axp-approvals-banner" role="alert">
        {s.held.map((c) => <HeldRow key={c.id} c={c} />)}
        <PendingRow p={s.pending[0]!} hide={hide} />
      </div>
    );
  }
  const shown = open ? s.pending : s.pending.slice(0, COLLAPSED_ROWS);
  const more = s.count - shown.length;
  return (
    <div className="axp-approvals-banner" role="alert">
      {s.held.map((c) => <HeldRow key={c.id} c={c} />)}
      <div className="axp-approvals-banner__row">
        <BannerIcon icon="shield" working={s.count > 0} size={20} />
        <button type="button" data-fx-row className="axp-approvals-banner__text" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="axp-approvals-banner__head">{s.count} call{s.count === 1 ? '' : 's'} waiting for your approval in axHub</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
        </button>
        <a className="fx-btn fx-btn--neutral axp-approvals-banner__go" href={s.approvalsUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} /> All</a>
        <button type="button" className="fx-iconbtn" aria-label="Hide until something new is waiting" title="Hide until something new is waiting" onClick={hide}><Icon name="x" size={16} /></button>
      </div>
      {shown.map((p) => <PendingRow key={p.id} p={p} />)}
      {more > 0 && (
        <button type="button" data-fx-row className="axp-approvals-banner__more fx-small fx-muted" onClick={() => (open || s.pending.length <= shown.length ? globalThis.open(s.approvalsUrl, '_blank', 'noopener') : setOpen(true))}>
          …and {more} more{open || s.pending.length <= shown.length ? ' on the hub' : ''}
        </button>
      )}
    </div>
  );
}

/* ---------------- the review dialog: the hub's own page, in a frame ---------------- */

/** How long the hub's page gets to load in the frame before the dialog shows the Open-on-the-hub card instead. */
export const FRAME_LOAD_MS = 8_000;

function ReviewDialog({ id }: { id: string }) {
  const s = useApprovals();
  const [decided, setDecided] = useState(false);
  // The frame's state: loading → loaded, or stuck (no load in FRAME_LOAD_MS: the hub refused to be framed here, or the
  // network is gone). Stuck = no dead frame: a plain card with the Open-on-the-hub button.
  const [frame, setFrame] = useState<'loading' | 'loaded' | 'stuck'>('loading');
  const p = s.pending.find((x) => x.id === id) ?? s.held.find((x) => x.id === id);
  const url = p?.url ?? approvalUrl(s.hub, id) ?? s.approvalsUrl;
  const openOnHub = () => { const h = vetoHost(); if (h.open) h.open(url); else globalThis.open(url, '_blank', 'noopener,noreferrer'); };
  useEffect(() => {
    setFrame('loading');
    const t = setTimeout(() => setFrame((f) => (f === 'loading' ? 'stuck' : f)), FRAME_LOAD_MS);
    return () => clearTimeout(t);
  }, [url]);
  // Fast checks while it's open; once the request leaves the waiting list it was decided (or expired): close.
  useEffect(() => { const t = setInterval(() => void checkNow(), 2_000); return () => { clearInterval(t); if (reviewing === id) reviewing = null; }; }, [id]);
  useEffect(() => {
    if (s.status !== 'ok' || p) return;
    setDecided(true);
    const t = setTimeout(() => { if (reviewing === id) reviewing = null; runtime?.closeDialog(); }, 2_500);
    return () => clearTimeout(t);
  }, [s.status, s.checkedAt, p, id]);
  return (
    <div className="fx-stack axp-approvals-review">
      {decided && <p className="fx-small" role="status" style={{ margin: 0 }}><Icon name="check" size={14} /> Decided. Closing…</p>}
      {frame === 'stuck' ? (
        <div className="fx-stack axp-approvals-review__stuck" role="status">
          <Icon name="shield" size={24} />
          <strong>{p ? `${p.tool}` : 'Approval waiting'}</strong>
          <p className="fx-small fx-muted" style={{ margin: 0 }}>axHub's page didn't open in here. Open it on the hub to approve or decline.</p>
          <Button tone="primary" icon="external" onClick={openOnHub}>Open on the hub</Button>
        </div>
      ) : (
        <iframe className="axp-approvals-review__frame" title="Approval on axHub" src={url} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" onLoad={() => setFrame('loaded')} />
      )}
      {frame !== 'stuck' && (
        <div className="fx-row fx-row--wrap axp-approvals-review__foot">
          <p className="fx-small fx-muted" style={{ margin: 0 }}>This is axHub's own page: Approve or Decline runs there.</p>
          {p && <WatchLiveFor text={JSON.stringify(p)} />}
          <Button size="sm" icon="external" onClick={openOnHub}>Open on the hub</Button>
        </div>
      )}
    </div>
  );
}

/* ---------------- the veto screen ---------------- */

function VetoDialog({ id }: { id: string }) {
  const s = useApprovals();
  const c = s.held.find((x) => x.id === id) ?? null;
  useEffect(() => { const t = setInterval(() => void checkNow(), 3_000); return () => { clearInterval(t); if (reviewing === id) reviewing = null; }; }, [id]);
  return <VetoScreen c={c} deps={deps} onClose={() => { if (reviewing === id) reviewing = null; runtime?.closeDialog(); }} />;
}

/* ---------------- settings ---------------- */

function AutoOpenSwitch() {
  const [on, setOn] = useState(autoOpenOn());
  return (
    <label className="fx-row" style={{ alignItems: 'flex-start' }}>
      <input type="checkbox" checked={on} onChange={(e) => { save(AUTO_KEY, e.target.checked ? 'on' : 'off'); setOn(e.target.checked); }} />
      <span><strong>Open new approvals by themselves</strong><br /><span className="fx-small fx-muted">Each new request pops up here once, showing the hub's approval page, so you can approve without leaving the console. This browser only.</span></span>
    </label>
  );
}

function StatusPanel() {
  const s = useApprovals();
  useEffect(() => { start(); }, []);
  const line: Record<Status, string> = {
    idle: 'Checking…',
    ok: `${s.count ? `${s.count} waiting.` : 'Nothing is waiting.'}${s.held.length ? ` ${s.held.length} held (${s.held.filter((c) => c.shelved).length} shelved).` : ''}`,
    'signed-out': 'This browser isn\'t signed in to axHub, so the banner stays hidden. Sign in on the hub (the console\'s sign-in wall does it) to see approvals here.',
    'not-admin': 'Signed in to axHub, but not as an admin: approvals are for admins only.',
    unreachable: `Couldn't reach axHub${s.error ? ` (${s.error})` : ''}.`,
  };
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>A banner at the top of the app while axHub holds a call on its countdown (veto) or has one waiting for your approval. A held call runs by itself when its countdown ends: tap Deny to stop it, Approve to run it now, or Shelve to pause the countdown until you decide. Notices and the alarm come from this plugin too.</p>
      <p className="fx-small" style={{ margin: 0 }}><strong>{line[s.status]}</strong>{s.checkedAt ? <span className="fx-muted"> · checked {ago(s.checkedAt)} · every {POLL_MS / 1000} s while the console is open</span> : null}</p>
      <AutoOpenSwitch />
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="refresh" onClick={() => void checkNow()}>Check now</Button>
        <a className="fx-btn fx-btn--neutral" style={{ textDecoration: 'none' }} href={s.approvalsUrl} target="_blank" rel="noopener noreferrer">Open the approvals page</a>
      </div>
      <p className="fx-muted fx-small" style={{ margin: 0 }}>Hub: {s.hub}. The console server never sees your hub session: your browser asks the hub directly.</p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Approvals banner',
  version: '0.5.1',
  appMenu,
  appMenuProviders: {
    [WAITING_LIST]: {
      max: 10, moreAction: 'approvals.open', moreLabel: 'All approvals on axHub…',
      items: async () => {
        await checkNow();
        if (st.status !== 'ok') return [{ id: 'status', label: st.status === 'signed-out' ? 'Sign in to axHub to see approvals' : st.status === 'not-admin' ? 'Approvals are for hub admins' : 'axHub not reachable', icon: 'info', action: 'approvals.open' }];
        return menuRows(st);
      },
      act: menuAct,
    },
  },
  register(rt) {
    runtime = rt;
    watch.setup((k) => rt.settings.get(k), (id) => openVeto(id));
    start();
    // approvals.veto:<id> — the veto screen; approvals.deny|approve-now|shelve:<id> — one action (a person's tap only)
    rt.actions.register('approvals.veto', ([id]) => { if (id) openVeto(id); }, { label: 'Open a held call', params: true, searchable: false });
    for (const a of VETO_ACTIONS) {
      rt.actions.register(`approvals.${a}`, ([id]) => {
        const c = st.held.find((x) => x.id === id);
        if (c) void act(deps, c, a as VetoAction); else rt.toast('That call is no longer held.', 'info', 'Approvals');
      }, { label: `${a === 'deny' ? 'Deny' : a === 'shelve' ? 'Shelve' : 'Approve'} a held call`, params: true, searchable: false });
    }
    // The app's native side (AmberX phone): notification taps open the veto screen; actions taken there refresh.
    let offEvents: (() => void) | undefined;
    const sync = syncNativeAlarm((k) => rt.settings.get(k));
    const hook = () => {
      offEvents?.();
      offEvents = vetoHost().onEvent?.((e) => {
        if (e.action === 'open') openVeto(e.id);
        else if (e.action === 'failed') rt.toast(`That didn't go through on the phone${e.error ? ` (${e.error})` : ''}: open it on axHub.`, 'danger', 'Approvals');
        else watch.silence(e.id);
        void checkNow();
      });
      sync();
    };
    onVetoHost(hook);
    hook();
    rt.subscribe(sync);
    rt.actions.register('approvals.check', () => void checkNow(), { label: 'Check axHub approvals' });
    rt.actions.register('approvals.open', () => { globalThis.open(st.approvalsUrl, '_blank', 'noopener'); }, { label: 'Open axHub approvals' });
    // approvals.review:<id> — that request on the hub's own page, in the review dialog (menu live list)
    rt.actions.register('approvals.review', ([id]) => { if (id && (st.pending.some((x) => x.id === id) || st.held.some((x) => x.id === id))) openReview(id); else globalThis.open(st.approvalsUrl, '_blank', 'noopener'); }, { label: 'Review an axHub approval', params: true, searchable: false });
  },
  banners: [{ id: 'approvals', label: 'Approvals', icon: 'shield', settingsTab: 'approvals-banner', order: 5, render: () => <ApprovalsBanner /> }],
  dialogs: {
    'approvals.review': { title: 'Approval waiting', icon: 'shield', render: (p) => <ReviewDialog id={typeof p.id === 'string' ? p.id : ''} /> },
    'approvals.veto': { title: 'Held call', icon: 'clock', render: (p) => <VetoDialog id={typeof p.id === 'string' ? p.id : ''} /> },
  },
  settings: [
    {
      id: 'approvals-banner.alarm', label: 'Veto alarm', icon: 'bell', tab: 'approvals-banner', order: 10,
      description: 'Rings for a held call until you Deny, Approve or Shelve it (or it ends).',
      settings: [
        { key: ALARM_KEYS.enabled, label: 'Alarm', kind: 'toggle', default: ALARM_DEFAULTS.enabled },
        { key: ALARM_KEYS.startAt, label: 'Starts', kind: 'choice', default: ALARM_DEFAULTS.startAt, options: START_AT.map(({ value, label }) => ({ value, label })) },
        { key: ALARM_KEYS.tone, label: 'Tone', kind: 'choice', default: ALARM_DEFAULTS.tone, options: TONES.map(({ value, label }) => ({ value, label })), description: 'My own sound file: pick it below.' },
        { key: ALARM_KEYS.volume, label: 'Volume', kind: 'slider', default: ALARM_DEFAULTS.volume, min: 0, max: 100, step: 5 },
        { key: ALARM_KEYS.louder, label: 'Gets louder over time', kind: 'toggle', default: ALARM_DEFAULTS.louder },
        { key: ALARM_KEYS.louderSeconds, label: 'Seconds to full volume', kind: 'number', default: ALARM_DEFAULTS.louderSeconds, min: 1, max: 120 },
        { key: ALARM_KEYS.ringSeconds, label: 'Rings for (seconds)', kind: 'number', default: ALARM_DEFAULTS.ringSeconds, min: 1, max: 300 },
        { key: ALARM_KEYS.repeat, label: 'Rings (1 = no repeat)', kind: 'number', default: ALARM_DEFAULTS.repeat, min: 1, max: 10 },
        { key: ALARM_KEYS.repeatGapSeconds, label: 'Quiet between rings (seconds)', kind: 'number', default: ALARM_DEFAULTS.repeatGapSeconds, min: 0, max: 300 },
        { key: ALARM_KEYS.vibration, label: 'Vibration', kind: 'choice', default: ALARM_DEFAULTS.vibration, options: VIBRATIONS.map(({ value, label }) => ({ value, label })) },
        { key: ALARM_KEYS.throughSilent, label: 'Ring through silent mode (phone)', kind: 'toggle', default: ALARM_DEFAULTS.throughSilent, description: 'AmberX on Android plays it on the alarm channel, which sounds even when the phone is on silent.' },
        { key: ALARM_KEYS.notices, label: 'Notices (timer started, 30 s left, running)', kind: 'toggle', default: true, description: 'On the phone AmberX raises them with Deny, Approve and Shelve buttons; in a browser, while this page is open.' },
      ],
    },
  ],
  settingsTabs: [{ id: 'approvals-banner', label: 'Approvals banner', icon: 'shield', order: 8, parent: 'plugins' }],
  settingsPanels: [
    { id: 'approvals-banner.status', tab: 'approvals-banner', title: 'Approvals', icon: 'shield', order: 5, render: () => <StatusPanel /> },
    { id: 'approvals-banner.alarm.panel', tab: 'approvals-banner', title: 'Alarm sound and test', icon: 'bell', order: 11, render: () => <AlarmPanel get={(k) => runtime?.settings.get(k)} set={(k, v) => runtime?.settings.set(k, v)} /> },
    { id: 'approvals-banner.lifecycle', tab: 'approvals-banner', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
