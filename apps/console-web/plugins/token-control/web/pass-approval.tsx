/**
 * The pass-approval view (pass-approval@1, docs/contracts/pass-approval.md; Brett, Nov 10 2026: "I'm gonna need a link to
 * the pass, a hook to it."): one veto pass, opened straight from its link, with who asks, for what, the veto window and
 * Approve / Deny.
 *
 * Reached by: the deep link `#/pass/<id>[/approve|/deny]` (this module watches the hash), console_show / console_open
 * `pass:<id>` (the server resolves it to the Token control screen focused on `pass:<id>`, which runs
 * `token-control.focus:pass:<id>`), the action `token-control.pass:<id>[/decision]`, the banner's Open and Token control
 * → Passes. State: GET pass/<id>; decisions: POST pass/<id>/approve | deny with Brett's own session (the same routes the
 * API, MCP, CLI and voice use). A primed link (`/approve`) only highlights the button: the tap decides, never the link.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Container, Note, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PASS_REQUEST_TTL_MS, parsePassRoute, parsePassTarget } from '../../../../../packages/shared/pass-approval/index.mjs';
import { countdown, loadPasses, type PassView } from './pass';

const FOLDER = 'token-control';
const POLL_MS = 5_000;

export interface PassLinks { deep_link?: string; approve_url?: string; deny_url?: string; molly_url?: string; target?: string; hand_over?: string }
type Decision = 'approve' | 'deny';
interface Focus { id: string; decision?: Decision; at: number }
interface Answer { ok: boolean; text?: string; message?: string; code?: string; already?: boolean; pass?: PassView & PassLinks }

/* ---------------- which pass is open (one per console; the hash, an action or a click sets it) ---------------- */

let focus: Focus | null = null;
const subs = new Set<() => void>();
const set = (f: Focus | null) => { focus = f; subs.forEach((s) => s()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const usePassFocus = () => useSyncExternalStore(subscribe, () => focus);

/** Open the pass-approval view on `id` (decision = primed button). Returns false when `id` is no pass id. */
export function openPass(id: string, decision?: string): boolean {
  const pid = parsePassTarget(id);
  if (!pid) return false;
  set({ id: pid, ...(decision === 'approve' || decision === 'deny' ? { decision } : {}), at: Date.now() });
  return true;
}
/** Close the view (and drop a pass route from the address bar, so a reload doesn't reopen it). */
export function closePass(): void {
  set(null);
  if (parsePassRoute(window.location.hash)) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}
/** `#/pass/<id>[/approve|/deny]` in the address bar → the open pass, or null. */
export function passFromHash(hash: string = window.location.hash): { id: string; decision?: string } | null {
  return parsePassRoute(hash);
}

/* ---------------- calls (Brett's session first, the console token only when there is none) ---------------- */

async function call(path: string, init?: RequestInit): Promise<Answer> {
  const opts: RequestInit = { ...init, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } };
  let r = await fetch(`/api/plugins/${FOLDER}/${path}`, opts);
  if (r.status === 401) r = await pluginFetch(FOLDER, path, opts);
  return (await r.json().catch(() => ({ ok: false, message: `HTTP ${r.status}` }))) as Answer;
}
export const passApprovalCalls = {
  get: (id: string) => call(`pass/${encodeURIComponent(id)}`),
  decide: (id: string, decision: Decision) => call(`pass/${encodeURIComponent(id)}/${decision}`, { method: 'POST', body: '{}' }),
};

/* ---------------- the view ---------------- */

const STATE_WORD: Record<string, string> = { pending: 'Waiting for you', active: 'Approved, on now', denied: 'Denied', revoked: 'Revoked', expired: 'Ended', lapsed: 'Lapsed (not approved in time)' };

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return now;
}

export function PassApprovalView({ id, decision }: { id: string; decision?: string }) {
  const rt = useRuntime();
  const now = useNow();
  const [pass, setPass] = useState<(PassView & PassLinks) | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const a = await passApprovalCalls.get(id);
        if (!live) return;
        if (a.ok && a.pass) { setPass(a.pass); setErr(''); } else setErr(a.message ?? a.code ?? 'not found');
      } catch (e) { if (live) setErr((e as Error).message); }
    };
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [id]);
  const decide = async (d: Decision) => {
    setBusy(d);
    try {
      const a = await passApprovalCalls.decide(id, d);
      rt.toast(a.ok ? (a.text ?? 'Done') : `${a.code ?? 'failed'}: ${a.message ?? ''}`, a.ok ? 'success' : 'danger');
      if (a.pass) setPass(a.pass);
      void loadPasses();
    } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(''); }
  };
  const pending = pass?.state === 'pending';
  const lapse = pass ? Date.parse(pass.requestedAt) + PASS_REQUEST_TTL_MS : now;
  const vetoWindow = pass?.state === 'active' && pass.expiresAt ? `${countdown(pass.expiresAt, now)} left (until ${new Date(pass.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})` : `${pass?.minutes ?? 0} min once approved`;
  return (
    <div className="axf-tc-pass" data-pass={id}>
    <Container title="Pass approval" icon="shield">
      <div className="fx-stack">
        {err && <Note tone="danger">{err}</Note>}
        {pass && (
          <>
            <Note tone={pending ? 'warning' : pass.state === 'active' ? 'success' : 'info'}>{STATE_WORD[pass.state] ?? pass.state}: {pass.text}</Note>
            <table className="fx-table axf-tc-table"><tbody>
              <tr><th scope="row">Requested by</th><td>{pass.requestedBy || 'unknown'} <span className="fx-muted">at {new Date(pass.requestedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></td></tr>
              <tr><th scope="row">Scope</th><td><b>{pass.label ?? pass.scope}</b>{pass.include_irreversible ? ' (irreversible deletes included)' : ''} <span className="fx-muted fx-mono axf-tc-small">{pass.scope}</span></td></tr>
              <tr><th scope="row">Veto window</th><td>{vetoWindow}</td></tr>
              {pending && <tr><th scope="row">Request lapses</th><td className="fx-mono axf-tc-small">{countdown(new Date(lapse).toISOString(), now)}</td></tr>}
              {pass.reason && <tr><th scope="row">Reason</th><td>{pass.reason}</td></tr>}
              {pass.approvedBy && <tr><th scope="row">Approved by</th><td>{pass.approvedBy} ({pass.approvedVia})</td></tr>}
              {pass.deep_link && <tr><th scope="row">Link</th><td className="fx-mono axf-tc-small">{pass.deep_link}</td></tr>}
            </tbody></table>
            {pending && decision && <p className="fx-muted">The link opened this with {decision === 'approve' ? 'Approve' : 'Deny'} ready: tap it to decide.</p>}
            <div className="fx-row" role="toolbar" aria-label="Pass approval">
              <Button tone={decision === 'deny' ? 'ghost' : 'primary'} icon="check" disabled={!pending || !!busy} onClick={() => void decide('approve')}>Approve</Button>
              <Button tone={decision === 'deny' ? 'danger' : 'ghost'} icon="x" disabled={!pending || !!busy} onClick={() => void decide('deny')}>Deny</Button>
              <Button tone="ghost" icon="arrow-left" onClick={closePass}>All passes</Button>
            </div>
          </>
        )}
        {!pass && !err && <p className="fx-muted">Loading {id}…</p>}
      </div>
    </Container>
    </div>
  );
}
