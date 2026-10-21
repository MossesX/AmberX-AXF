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
 * Postponed requests (Oct 21 2026, axHub decision #90): the feed also lists requests Brett postponed on the hub (until a
 * time or a condition; the hub checks every 5 minutes and puts them back to pending, never approving). Every 30
 * minutes one stays postponed, this plugin raises an alert (alert@1, source `approvals`) so the bell, ntfy and web push
 * deliver it; after 2 hours postponed the console shows a **mandatory review** that can't be closed: for each such
 * request Approve, Decline, Postpone again or Revoke, each opening the hub's own page for it (in a frame, or a new tab
 * when framing is refused). It goes away only once the hub no longer lists a request as needing review, so the choice
 * really is made on the hub. Pure planning in `reminders.mjs` (tested by `test.mjs`).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Icon } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { createPortal } from 'react-dom';
import {
  HUB_DEFAULT, approvalUrl, fetchHubFeed, normalizeHub, approvalsUrl, postponeUrl, postponedNeedsReview, postponedSlot,
  type HubApproval, type HubFeedStatus, type HubPostponed,
} from '@console/axf/libs/hub/hub';
import { alertsOf } from '@console/axf/libs/alerts';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './approvals-banner.css';
import { appMenu, WAITING, WAITING_LIST } from './menu';
import { REVIEW_CHOICES, age, reminderPlan, reviewState, type ReminderItem, type ReviewChoice } from './reminders.mjs';

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
const REMINDED_KEY = 'approvals-banner.reminded';
const CHOICES_KEY = 'approvals-banner.review-choices';
const readJson = <T,>(k: string, fallback: T): T => { try { const v = JSON.parse(load(k) ?? 'null') as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback; } catch { return fallback; } };
/** Open each new request once, in the console, unless switched off, one is already on screen or a review is due. */
function autoOpen(pending: Pending[]) {
  if (!runtime || !autoOpenOn() || reviewing || st.reviewItems.length) return;
  const next = pending.find((p) => !opened.has(p.id));
  if (!next) return;
  opened.add(next.id);
  save(OPENED_KEY, [...opened].slice(-50).join(','));
  openReview(next.id);
}
export function openReview(id: string) { reviewing = id; runtime?.openDialog('approvals.review', { id }); }
const DEFAULT_HUB = HUB_DEFAULT;

type Pending = HubApproval;
type Status = 'idle' | HubFeedStatus;
/** A postponed request with what this browser computes from it (reminder slot, minutes postponed, review due). */
type Postponed = HubPostponed & ReminderItem;
interface State {
  status: Status; hub: string; count: number; pending: Pending[]; approvalsUrl: string; checkedAt: string | null; hiddenIds: string; error: string;
  postponed: Postponed[]; postponedCount: number;
  /** Postponed requests that need the mandatory review now. */
  reviewItems: Postponed[];
}

/* ---------------- a tiny store shared by the banner and the settings panel ---------------- */

let st: State = { status: 'idle', hub: DEFAULT_HUB, count: 0, pending: [], approvalsUrl: approvalsUrl(DEFAULT_HUB), checkedAt: null, hiddenIds: '', error: '', postponed: [], postponedCount: 0, reviewItems: [] };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; runtime?.setBadge(WAITING, st.status === 'ok' ? st.count : 0); subs.forEach((f) => f()); };
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
    // lib-hub: the browser's own hub session (credentials included), redirects refused, reply capped, links checked.
    const feed = await fetchHubFeed(hub);
    const pending = feed.status === 'ok' ? feed.pending : [];
    const now = Date.now();
    const postponed: Postponed[] = (feed.status === 'ok' ? feed.postponed : []).map((p) => ({
      ...p,
      slot: postponedSlot(p, now),
      minutes: p.since && Number.isFinite(Date.parse(p.since)) ? Math.max(0, (now - Date.parse(p.since)) / 60_000) : 0,
      review: postponedNeedsReview(p, now),
    }));
    set({
      hub, status: feed.status, count: feed.count, pending, approvalsUrl: feed.approvalsUrl, checkedAt: new Date().toISOString(), error: feed.error,
      postponed, postponedCount: feed.status === 'ok' ? feed.postponedCount : 0, reviewItems: postponed.filter((p) => p.review),
    });
    // Reminders only from a real answer: signed out / unreachable says nothing about the postponed requests.
    if (feed.status === 'ok') await remind(postponed);
    autoOpen(pending);
  } finally {
    inflight = false;
  }
}

/** Raise this half hour's alert for each postponed request (once per browser) and resolve the one before. */
async function remind(postponed: Postponed[]): Promise<void> {
  const alerts = runtime ? alertsOf(runtime) : null;
  const remembered = readJson<Record<string, number>>(REMINDED_KEY, {});
  const plan = reminderPlan(postponed, remembered);
  if (!alerts) return; // the alerts library isn't installed: nothing to deliver through (remembered stays as it was)
  for (const a of plan.raise) await alerts.raise(a);
  if (plan.resolve.length) await alerts.resolve(plan.resolve);
  save(REMINDED_KEY, JSON.stringify(plan.next));
}

let started = false;
function start() {
  if (started) return;
  started = true;
  void checkNow();
  setInterval(() => { if (document.visibilityState === 'visible') void checkNow(); }, POLL_MS);
  globalThis.addEventListener('focus', () => void checkNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkNow(); });
}

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
/** The command (or arguments) out of the hub's summary, for one short line. */
const shortSummary = (p: Pick<Pending, 'summary'>) => {
  const m = /"command":"((?:[^"\\]|\\.)*)"/.exec(p.summary);
  const name = /"name":"([^"\\]{1,60})"/.exec(p.summary)?.[1];
  const target = /"target":"([^"\\]{1,120})"/.exec(p.summary)?.[1];
  const text = m ? m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : name ? `${name}${target ? ` ${target}` : ''}` : p.summary.replace(/^\S+ with arguments /, '');
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

/* ---------------- the banner ---------------- */

function ApprovalsBanner() {
  const s = useApprovals();
  const [open, setOpen] = useState(false);
  useEffect(() => { start(); }, []);
  if (s.status !== 'ok' || s.count === 0) return null;
  const ids = s.pending.map((p) => p.id).join(',');
  if (ids && ids === s.hiddenIds) return null;
  const first = s.pending[0];
  const review = s.count === 1 && first ? first.url : s.approvalsUrl;
  return (
    <div className="axp-approvals-banner" role="alert">
      <div className="axp-approvals-banner__row">
        <Icon name="shield" />
        <button type="button" className="axp-approvals-banner__text" aria-expanded={open} onClick={() => setOpen(!open)}>
          {s.count} call{s.count === 1 ? '' : 's'} waiting for your approval in axHub{s.postponedCount ? ` · ${s.postponedCount} postponed` : ''}
          {first && s.count === 1 ? <span className="axp-approvals-banner__sum">{first.tool}: {shortSummary(first)}</span> : null}
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
        </button>
        {first ? <Button tone="primary" icon="shield" onClick={() => openReview(first.id)}>Review</Button>
          : <a className="fx-btn fx-btn--primary axp-approvals-banner__go" href={review} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} /> Review</a>}
        <button type="button" className="fx-iconbtn" aria-label="Hide until something new is waiting" title="Hide until something new is waiting" onClick={() => set({ hiddenIds: ids })}><Icon name="x" size={16} /></button>
      </div>
      {open && (
        <ul className="axp-approvals-banner__list">
          {s.pending.map((p) => (
            <li key={p.id}>
              <button type="button" className="axp-approvals-banner__item" onClick={() => openReview(p.id)}>
                <span className="axp-approvals-banner__tool">{p.tool}</span>
                <span className="axp-approvals-banner__cmd">{shortSummary(p)}</span>
                <span className="axp-approvals-banner__when">{ago(p.createdAt)}</span>
              </button>
            </li>
          ))}
          {s.count > s.pending.length && <li className="fx-muted fx-small">…and {s.count - s.pending.length} more on the hub.</li>}
          {s.postponed.map((p) => (
            <li key={p.id}>
              <a className="axp-approvals-banner__item" href={p.url} target="_blank" rel="noopener noreferrer">
                <span className="axp-approvals-banner__tool">{p.tool}</span>
                <span className="axp-approvals-banner__cmd">postponed {age(p.minutes)}{p.waitingFor ? ` · waiting for ${p.waitingFor}` : ''}</span>
                <span className="axp-approvals-banner__when">{p.review ? 'review now' : 'postponed'}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- the review dialog: the hub's own page, in a frame ---------------- */

function ReviewDialog({ id }: { id: string }) {
  const s = useApprovals();
  const [decided, setDecided] = useState(false);
  const p = s.pending.find((x) => x.id === id);
  const url = p?.url ?? approvalUrl(s.hub, id) ?? s.approvalsUrl;
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
      <iframe className="axp-approvals-review__frame" title="Approval on axHub" src={url} sandbox="allow-forms allow-same-origin" referrerPolicy="no-referrer" />
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        This is axHub's own page: Approve or Reject runs there. Blank? <a href={url} target="_blank" rel="noopener noreferrer">Open it on the hub <Icon name="external" size={12} /></a>
      </p>
    </div>
  );
}

/* ---------------- the mandatory review (postponed ≥ 2 h) ---------------- */

const useChoices = () => {
  const [choices, setChoices] = useState<Record<string, string>>(() => readJson<Record<string, string>>(CHOICES_KEY, {}));
  const pick = (id: string, choice: string) => setChoices((c) => { const n = { ...c, [id]: choice }; save(CHOICES_KEY, JSON.stringify(n)); return n; });
  return [choices, pick] as const;
};

/**
 * A blocking overlay (no close button, Escape does nothing) while any postponed request needs a review. Each choice opens
 * the hub's own page for that request; the overlay leaves only when the hub no longer lists a request as needing review.
 */
function MandatoryReview() {
  const s = useApprovals();
  const [choices, pick] = useChoices();
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { start(); }, []);
  const review = reviewState(s.reviewItems, choices);
  // forget choices for requests that were reviewed (or left) on the hub
  useEffect(() => { if (s.status === 'ok') save(CHOICES_KEY, JSON.stringify(review.choices)); }, [s.checkedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // check fast while it is up, so a choice made on the hub clears it within seconds
  useEffect(() => { if (!review.blocking) return; const t = setInterval(() => void checkNow(), 3_000); return () => clearInterval(t); }, [review.blocking]);
  if (s.status !== 'ok' || !review.blocking || typeof document === 'undefined') return null;
  const shown = review.rows.find((r) => r.id === openId && r.choice) ?? review.rows.find((r) => r.choice);
  const frameUrl = (r: (typeof review.rows)[number]) => (REVIEW_CHOICES.find((c) => c.id === r.choice)?.page === 'postpone' ? postponeUrl(s.hub, r.id) : approvalUrl(s.hub, r.id)) ?? s.approvalsUrl;
  return createPortal(
    <div className="fx-backdrop axp-approvals-mandatory" onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }}>
      <div className="fx-dialog axp-approvals-mandatory__panel" role="alertdialog" aria-modal="true" aria-labelledby="axp-approvals-mandatory-title" tabIndex={-1}>
        <header className="fx-dialog__head">
          <Icon name="shield" size={18} />
          <h2 id="axp-approvals-mandatory-title">Review postponed approvals</h2>
        </header>
        <div className="fx-dialog__body fx-stack">
          <p style={{ margin: 0 }}>
            {review.rows.length === 1 ? 'This call has' : `These ${review.rows.length} calls have`} been postponed for 2 hours or more. Choose for each one before you go on; the choice runs on axHub's own page.
          </p>
          <ul className="axp-approvals-mandatory__list">
            {review.rows.map((r) => (
              <li key={r.id} className={`axp-approvals-mandatory__item${shown?.id === r.id ? ' is-active' : ''}`}>
                <div className="axp-approvals-mandatory__what">
                  <span className="axp-approvals-banner__tool">{r.tool}</span>
                  <span className="axp-approvals-banner__cmd">{shortSummary(r)}</span>
                  <span className="fx-small fx-muted">Postponed {age(r.minutes)}{r.waitingFor ? ` · waiting for ${r.waitingFor}` : ''}</span>
                </div>
                <div className="fx-row fx-row--wrap axp-approvals-mandatory__acts">
                  {REVIEW_CHOICES.map((c: ReviewChoice) => (
                    <Button key={c.id} tone={r.choice === c.id ? 'primary' : 'neutral'} onClick={() => { pick(r.id, c.id); setOpenId(r.id); }}>{c.label}</Button>
                  ))}
                </div>
                <p className="fx-small" style={{ margin: 0 }} role="status">
                  {r.choice ? <><Icon name="arrow-right" size={12} /> {REVIEW_CHOICES.find((c) => c.id === r.choice)?.hint} This clears once the hub has it.</> : <span className="fx-muted">Waiting for your choice.</span>}
                </p>
              </li>
            ))}
          </ul>
          {shown && (
            <>
              <iframe key={`${shown.id}:${shown.choice}`} className="axp-approvals-review__frame" title="Postponed approval on axHub" src={frameUrl(shown)} sandbox="allow-forms allow-same-origin" referrerPolicy="no-referrer" />
              <p className="fx-small fx-muted" style={{ margin: 0 }}>
                Blank? <a href={frameUrl(shown)} target="_blank" rel="noopener noreferrer">Open it on the hub <Icon name="external" size={12} /></a>, then come back here.
              </p>
            </>
          )}
          <p className="fx-small fx-muted" style={{ margin: 0 }}>{review.chosen} of {review.rows.length} chosen · checks the hub every few seconds.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
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
    ok: s.count ? `${s.count} waiting.` : 'Nothing is waiting.',
    'signed-out': 'This browser isn\'t signed in to axHub, so the banner stays hidden. Sign in on the hub (the console\'s sign-in wall does it) to see approvals here.',
    'not-admin': 'Signed in to axHub, but not as an admin: approvals are for admins only.',
    unreachable: `Couldn't reach axHub${s.error ? ` (${s.error})` : ''}.`,
  };
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>A banner at the top of the console while axHub has calls waiting for your approval (shell commands, deploys and anything else set to confirm). New requests open here by themselves, on the hub's own page; you approve or reject them there.</p>
      <p className="fx-small" style={{ margin: 0 }}><strong>{line[s.status]}</strong>{s.checkedAt ? <span className="fx-muted"> · checked {ago(s.checkedAt)} · every {POLL_MS / 1000} s while the console is open</span> : null}</p>
      {s.status === 'ok' && <p className="fx-small" style={{ margin: 0 }}>{s.postponedCount ? `${s.postponedCount} postponed${s.reviewItems.length ? `, ${s.reviewItems.length} needing your review` : ''}.` : 'Nothing is postponed.'}</p>}
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Postponed requests: an alert every 30 minutes while one stays postponed (source <code>approvals</code> in Settings → Alerts decides which reach your phone), and after 2 hours the console asks you to review each one before you go on.</p>
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
  version: '0.3.0',
  appMenu,
  appMenuProviders: {
    [WAITING_LIST]: {
      max: 10, moreAction: 'approvals.open', moreLabel: 'All approvals on axHub…',
      items: async () => {
        await checkNow();
        if (st.status !== 'ok') return [{ id: 'status', label: st.status === 'signed-out' ? 'Sign in to axHub to see approvals' : st.status === 'not-admin' ? 'Approvals are for hub admins' : 'axHub not reachable', icon: 'info', action: 'approvals.open' }];
        return st.pending.map((x) => ({ id: `approval:${x.id}`, label: `${x.tool}: ${shortSummary(x)}`, icon: 'shield', action: `approvals.review:${x.id}` }));
      },
    },
  },
  register(rt) {
    runtime = rt;
    start();
    rt.actions.register('approvals.check', () => void checkNow(), { label: 'Check axHub approvals' });
    rt.actions.register('approvals.open', () => { globalThis.open(st.approvalsUrl, '_blank', 'noopener'); }, { label: 'Open axHub approvals' });
    // approvals.review:<id> — that request on the hub's own page, in the review dialog (menu live list)
    rt.actions.register('approvals.review', ([id]) => { if (id && st.pending.some((x) => x.id === id)) openReview(id); else globalThis.open(st.approvalsUrl, '_blank', 'noopener'); }, { label: 'Review an axHub approval', params: true, searchable: false });
  },
  banners: [
    { id: 'approvals', order: 5, render: () => <ApprovalsBanner /> },
    // renders nothing until a postponed request needs a review; then a blocking overlay (portalled to the page body)
    { id: 'approvals-review', order: 5.1, render: () => <MandatoryReview /> },
  ],
  dialogs: {
    'approvals.review': { title: 'Approval waiting', icon: 'shield', render: (p) => <ReviewDialog id={typeof p.id === 'string' ? p.id : ''} /> },
  },
  settingsTabs: [{ id: 'approvals-banner', label: 'Approvals banner', icon: 'shield', order: 8, parent: 'plugins' }],
  settingsPanels: [
    { id: 'approvals-banner.status', tab: 'approvals-banner', title: 'Approvals', icon: 'shield', order: 5, render: () => <StatusPanel /> },
    { id: 'approvals-banner.lifecycle', tab: 'approvals-banner', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
