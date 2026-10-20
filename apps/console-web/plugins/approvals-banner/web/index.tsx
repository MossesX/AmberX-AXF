/**
 * Approvals banner console plugin (ai.amberx.axf.console.approvals-banner).
 *
 * Shows a banner at the top of every view while axHub has calls waiting for approval (axHub decision #85). The browser
 * reads the hub's feed `GET <hub>/auth/admin/approvals.json` with its own hub session cookie (same site, credentials
 * included); the console server isn't involved and never sees the session. Only signed-in hub admins get an answer:
 * anyone else (or a console opened with just the console token) sees nothing. The banner never approves: Review opens
 * the request on the hub's own page, where Approve/Reject live.
 *
 * Polls every 20 s while the page is visible, again on focus and when the hub tab is closed (window focus). Hiding it
 * lasts until something new arrives.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Icon } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './approvals-banner.css';

const ID = 'ai.amberx.axf.console.approvals-banner';
const FOLDER = 'approvals-banner';
const POLL_MS = 20_000;
const DEFAULT_HUB = 'https://axhub.amberxai.com';

interface Pending { id: string; tool: string; summary: string; createdAt: string; expiresAt: string; url: string }
type Status = 'idle' | 'ok' | 'signed-out' | 'not-admin' | 'unreachable';
interface State { status: Status; hub: string; count: number; pending: Pending[]; approvalsUrl: string; checkedAt: string | null; hiddenIds: string; error: string }

/* ---------------- a tiny store shared by the banner and the settings panel ---------------- */

let st: State = { status: 'idle', hub: DEFAULT_HUB, count: 0, pending: [], approvalsUrl: `${DEFAULT_HUB}/auth/admin/approvals`, checkedAt: null, hiddenIds: '', error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useApprovals = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

/** The hub's address, from the console's own account endpoint (AXF_WALL_HUB on the server); https only. */
async function hubUrl(): Promise<string> {
  try {
    const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    const j = (await r.json()) as { hub?: string };
    const u = new URL(String(j.hub ?? ''));
    if (u.protocol === 'https:' && !u.username && !u.password) return u.origin;
  } catch { /* fall back */ }
  return DEFAULT_HUB;
}

let inflight = false;
export async function checkNow(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const hub = st.status === 'idle' ? await hubUrl() : st.hub;
    let r: Response;
    try {
      r = await fetch(`${hub}/auth/admin/approvals.json`, { credentials: 'include', cache: 'no-store', redirect: 'error' });
    } catch (e) {
      return set({ hub, status: 'unreachable', error: (e as Error).message, checkedAt: new Date().toISOString(), count: 0, pending: [] });
    }
    if (r.status === 401) return set({ hub, status: 'signed-out', count: 0, pending: [], checkedAt: new Date().toISOString(), error: '' });
    if (r.status === 403) return set({ hub, status: 'not-admin', count: 0, pending: [], checkedAt: new Date().toISOString(), error: '' });
    if (!r.ok) return set({ hub, status: 'unreachable', error: `HTTP ${r.status}`, checkedAt: new Date().toISOString(), count: 0, pending: [] });
    const j = (await r.json()) as { count?: number; pending?: Pending[]; approvalsUrl?: string };
    // Only links back to the hub itself are used.
    const sameHub = (u: unknown) => { try { return new URL(String(u)).origin === hub; } catch { return false; } };
    const pending = (Array.isArray(j.pending) ? j.pending : []).filter((p) => p && typeof p.id === 'string' && sameHub(p.url));
    set({
      hub, status: 'ok', count: Math.max(0, Number(j.count) || 0), pending,
      approvalsUrl: sameHub(j.approvalsUrl) ? String(j.approvalsUrl) : `${hub}/auth/admin/approvals`,
      checkedAt: new Date().toISOString(), error: '',
    });
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
        <a className="fx-btn fx-btn--primary axp-approvals-banner__go" href={review} target="_blank" rel="noopener noreferrer">
          <Icon name="external" size={14} /> Review
        </a>
        <button type="button" className="fx-iconbtn" aria-label="Hide until something new is waiting" title="Hide until something new is waiting" onClick={() => set({ hiddenIds: ids })}><Icon name="x" size={16} /></button>
      </div>
      {open && (
        <ul className="axp-approvals-banner__list">
          {s.pending.map((p) => (
            <li key={p.id}>
              <a className="axp-approvals-banner__item" href={p.url} target="_blank" rel="noopener noreferrer">
                <span className="axp-approvals-banner__tool">{p.tool}</span>
                <span className="axp-approvals-banner__cmd">{shortSummary(p)}</span>
                <span className="axp-approvals-banner__when">{ago(p.createdAt)}</span>
              </a>
            </li>
          ))}
          {s.count > s.pending.length && <li className="fx-muted fx-small">…and {s.count - s.pending.length} more on the hub.</li>}
        </ul>
      )}
    </div>
  );
}

/* ---------------- settings ---------------- */

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
      <p style={{ margin: 0 }}>A banner at the top of the console while axHub has calls waiting for your approval (shell commands, deploys and anything else set to confirm). Review opens the request on the hub; you approve or reject it there.</p>
      <p className="fx-small" style={{ margin: 0 }}><strong>{line[s.status]}</strong>{s.checkedAt ? <span className="fx-muted"> · checked {ago(s.checkedAt)} · every {POLL_MS / 1000} s while the console is open</span> : null}</p>
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
  version: '0.1.0',
  register(rt) {
    rt.actions.register('approvals.check', () => void checkNow(), { label: 'Check axHub approvals' });
    rt.actions.register('approvals.open', () => { globalThis.open(st.approvalsUrl, '_blank', 'noopener'); }, { label: 'Open axHub approvals' });
  },
  banners: [{ id: 'approvals', order: 5, render: () => <ApprovalsBanner /> }],
  settingsTabs: [{ id: 'approvals-banner', label: 'Approvals banner', icon: 'shield', order: 8, parent: 'plugins' }],
  settingsPanels: [
    { id: 'approvals-banner.status', tab: 'approvals-banner', title: 'Approvals', icon: 'shield', order: 5, render: () => <StatusPanel /> },
    { id: 'approvals-banner.lifecycle', tab: 'approvals-banner', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
