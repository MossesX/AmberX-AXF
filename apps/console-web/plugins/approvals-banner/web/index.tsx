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
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Icon } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { HUB_DEFAULT, approvalUrl, fetchHubFeed, normalizeHub, approvalsUrl, type HubApproval, type HubFeedStatus } from '@console/axf/libs/hub/hub';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './approvals-banner.css';

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
function autoOpen(pending: Pending[]) {
  if (!runtime || !autoOpenOn() || reviewing) return;
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
interface State { status: Status; hub: string; count: number; pending: Pending[]; approvalsUrl: string; checkedAt: string | null; hiddenIds: string; error: string }

/* ---------------- a tiny store shared by the banner and the settings panel ---------------- */

let st: State = { status: 'idle', hub: DEFAULT_HUB, count: 0, pending: [], approvalsUrl: approvalsUrl(DEFAULT_HUB), checkedAt: null, hiddenIds: '', error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
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
    set({ hub, status: feed.status, count: feed.count, pending, approvalsUrl: feed.approvalsUrl, checkedAt: new Date().toISOString(), error: feed.error });
    autoOpen(pending);
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
          {s.count} call{s.count === 1 ? '' : 's'} waiting for your approval in axHub
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
  version: '0.2.1',
  register(rt) {
    runtime = rt;
    start();
    rt.actions.register('approvals.check', () => void checkNow(), { label: 'Check axHub approvals' });
    rt.actions.register('approvals.open', () => { globalThis.open(st.approvalsUrl, '_blank', 'noopener'); }, { label: 'Open axHub approvals' });
  },
  banners: [{ id: 'approvals', order: 5, render: () => <ApprovalsBanner /> }],
  dialogs: {
    'approvals.review': { title: 'Approval waiting', icon: 'shield', render: (p) => <ReviewDialog id={typeof p.id === 'string' ? p.id : ''} /> },
  },
  settingsTabs: [{ id: 'approvals-banner', label: 'Approvals banner', icon: 'shield', order: 8, parent: 'plugins' }],
  settingsPanels: [
    { id: 'approvals-banner.status', tab: 'approvals-banner', title: 'Approvals', icon: 'shield', order: 5, render: () => <StatusPanel /> },
    { id: 'approvals-banner.lifecycle', tab: 'approvals-banner', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
