/**
 * Veto passes in the console (control-pass@1; build theme-veto-pass): the banner chip with a live countdown while a
 * pass is on (Extend, Revoke, Undo; a warning two minutes before it ends) and the waiting requests Brett approves or
 * denies, plus the Passes tab on the Token control page and the max-minutes setting.
 *
 * Owner actions (grant, extend, approve, deny) go out WITHOUT the console token first, so the server sees Brett's
 * signed-in axHub session (a bearer token is what agents hold, and it can only file a request). Without a session
 * (no wall) they fall back to the token, and the server answers what that may do.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Container, Icon, Note, SelectField, TextField, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';

const FOLDER = 'token-control';
const POLL_MS = 5_000;
const WARN_MS = 2 * 60 * 1000;

export interface PassView { id: string; scope: string; state: string; minutes: number; reason: string; requestedBy: string; requestedAt: string; approvedBy?: string; approvedVia?: string; grantedAt?: string; expiresAt?: string; remainingMs: number; warn: boolean; changes: number; text: string }
interface ScopeRow { id: string; label: string; targets: string[]; active: PassView | null; pending: PassView | null; text: string }
interface Status { ok: boolean; items?: ScopeRow[]; maxMinutes?: number; recent?: (PassView | null)[]; text?: string; message?: string }

/* ---------------- one shared poll + a one-second clock for the countdown ---------------- */

let st: { status: Status | null; error: string; at: number } = { status: null, error: '', at: 0 };
const subs = new Set<() => void>();
const emit = (p: Partial<typeof st>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
let timer: ReturnType<typeof setInterval> | null = null;

export async function loadPasses() {
  try {
    const r = await pluginFetch(FOLDER, 'pass/status');
    const j = (await r.json()) as Status;
    emit(j.ok ? { status: j, error: '', at: Date.now() } : { error: j.message ?? `HTTP ${r.status}` });
  } catch (e) { emit({ error: (e as Error).message }); }
}
export function usePasses() {
  return useSyncExternalStore((f) => {
    subs.add(f);
    if (!timer) { void loadPasses(); timer = setInterval(() => { if (document.visibilityState === 'visible') void loadPasses(); }, POLL_MS); }
    return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
  }, () => st);
}
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}

/** mm:ss (or h:mm:ss) left until `iso`. */
export function countdown(iso: string | undefined, now: number): string {
  const s = Math.max(0, Math.round(((iso ? Date.parse(iso) : now) - now) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
}

/* ---------------- calls ---------------- */

interface Answer { ok: boolean; text?: string; message?: string; code?: string; approval?: { required: boolean } }

/** Brett's own action: his session first (no bearer token), the console token only when there is no session. */
async function ownerCall(path: string, body: unknown): Promise<Answer> {
  const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' };
  let r = await fetch(`/api/plugins/${FOLDER}/${path}`, init);
  if (r.status === 401) r = await pluginFetch(FOLDER, path, init);
  return (await r.json().catch(() => ({ ok: false, message: `HTTP ${r.status}` }))) as Answer;
}
async function tokenCall(path: string, body: unknown): Promise<Answer> {
  const r = await pluginFetch(FOLDER, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, message: `HTTP ${r.status}` }))) as Answer;
}
export const passCalls = {
  grant: (scope: string, minutes: number, reason = '') => ownerCall('pass/grant', { scope, minutes, reason, by: 'console' }),
  approve: (scope: string, request: string) => ownerCall('pass/approve', { scope, request }),
  deny: (scope: string, request: string) => ownerCall('pass/deny', { scope, request }),
  revoke: (scope: string) => tokenCall('pass/revoke', { scope, by: 'console' }),
  undo: (scope: string) => tokenCall('pass/undo', { scope, by: 'console' }),
};

function useAct() {
  const rt = useRuntime();
  const [busy, setBusy] = useState('');
  const act = async (key: string, run: () => Promise<Answer>) => {
    setBusy(key);
    try {
      const a = await run();
      rt.toast(a.ok ? (a.text ?? 'Done') : `${a.code ?? 'failed'}: ${a.message ?? ''}`, a.ok ? (a.approval?.required ? 'warning' : 'success') : 'danger');
      await loadPasses();
    } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(''); }
  };
  return { busy, act };
}

/* ---------------- the banner ---------------- */

const SCOPE_WORD: Record<string, string> = { 'tokens.theme': 'Theme', 'tokens.style': 'Style', 'tokens.layout': 'Layout', 'tokens.*': 'All tokens' };

export function PassBanner() {
  const { status } = usePasses();
  const rows = status?.items ?? [];
  const active = rows.filter((r) => r.active).map((r) => r.active!);
  const pending = rows.filter((r) => r.pending).map((r) => r.pending!);
  const now = useNow(active.length > 0);
  const { busy, act } = useAct();
  if (!active.length && !pending.length) return null;
  const left = (p: PassView) => (p.expiresAt ? Date.parse(p.expiresAt) - now : 0);
  const live = active.filter((p) => left(p) > 0);
  const warn = live.some((p) => left(p) <= WARN_MS);
  return (
    <div className={`axp-pass-banner${warn ? ' is-warn' : ''}${pending.length && !live.length ? ' is-ask' : ''}`} role="status" aria-live="polite">
      <span className="axp-pass-banner__icon"><Icon name={pending.length && !live.length ? 'shield' : 'key'} size={16} /></span>
      <div className="axp-pass-banner__main">
        {live.map((p) => (
          <span key={p.id} className="axp-pass-chip" title={`${p.text} Approved by ${p.approvedBy ?? '?'}; ${p.changes} change(s) so far.`}>
            <span><b>{SCOPE_WORD[p.scope] ?? p.scope}</b> no veto</span>
            <span className="fx-mono axp-pass-chip__time">{countdown(p.expiresAt, now)}</span>
            {left(p) <= WARN_MS && <span className="axp-pass-chip__warn">ending soon</span>}
            <Button size="sm" tone="ghost" icon="plus" disabled={!!busy} onClick={() => void act(`x${p.id}`, () => passCalls.grant(p.scope, p.minutes || 30, 'extended from the banner'))}>Extend</Button>
            {p.changes > 0 && <Button size="sm" tone="ghost" icon="undo" disabled={!!busy} onClick={() => void act(`u${p.id}`, () => passCalls.undo(p.scope))}>Undo {p.changes}</Button>}
            <Button size="sm" tone="ghost" icon="x" disabled={!!busy} onClick={() => void act(`r${p.id}`, () => passCalls.revoke(p.scope))}>Revoke</Button>
          </span>
        ))}
        {pending.map((p) => (
          <span key={p.id} className="axp-pass-chip axp-pass-chip--ask" title={p.reason || p.text}>
            <span><b>{p.requestedBy}</b> asks: {(SCOPE_WORD[p.scope] ?? p.scope).toLowerCase()} changes without veto for {p.minutes} min</span>
            <Button size="sm" tone="primary" icon="check" disabled={!!busy} onClick={() => void act(`a${p.id}`, () => passCalls.approve(p.scope, p.id))}>Approve</Button>
            <Button size="sm" tone="ghost" icon="x" disabled={!!busy} onClick={() => void act(`d${p.id}`, () => passCalls.deny(p.scope, p.id))}>Deny</Button>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Token control → Passes ---------------- */

export function PassesTab() {
  const { status, error } = usePasses();
  const now = useNow(true);
  const { busy, act } = useAct();
  const [scope, setScope] = useState('tokens.theme');
  const [minutes, setMinutes] = useState('30');
  const [reason, setReason] = useState('');
  const rows = status?.items ?? [];
  return (
    <div className="fx-stack">
      {error && <Note tone="danger">{error}</Note>}
      <Note tone="info">A pass lets token changes in one scope run without axHub's veto for a while ("allow theme changes for the next 30 minutes"). Brett approves each pass once; deletes are never covered. Every change made under a pass is logged and can be undone in one go.</Note>
      <Container title="Start a pass" icon="key">
        <div className="fx-row axf-tc-wrap">
          <SelectField label="Scope" value={scope} onChange={setScope} className="axf-tc-pick" options={rows.map((r) => ({ value: r.id, label: r.label }))} />
          <TextField label="Minutes" value={minutes} onChange={setMinutes} mono hint={`1–${status?.maxMinutes ?? 240}`} />
          <TextField label="Reason" value={reason} onChange={setReason} className="axf-tc-pick" />
        </div>
        <div className="fx-row"><Button tone="primary" icon="check" disabled={!!busy} onClick={() => void act('grant', () => passCalls.grant(scope, Number(minutes) || 30, reason))}>Start pass</Button></div>
      </Container>
      <Container title="Scopes" icon="shield">
        <table className="fx-table"><tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td><b>{r.label}</b><div className="fx-muted fx-mono axf-tc-small">{r.id}</div></td>
            <td>{r.active ? <>{r.text} <span className="fx-mono">{countdown(r.active.expiresAt, now)}</span></> : r.text}</td>
            <td><div className="fx-row fx-row--tight fx-row--end">
              {r.pending && <Button size="sm" tone="primary" icon="check" disabled={!!busy} onClick={() => void act('a', () => passCalls.approve(r.id, r.pending!.id))}>Approve</Button>}
              {r.active && <Button size="sm" tone="ghost" icon="undo" disabled={!!busy || !r.active.changes} onClick={() => void act('u', () => passCalls.undo(r.id))}>Undo {r.active.changes}</Button>}
              {(r.active || r.pending) && <Button size="sm" tone="ghost" icon="x" disabled={!!busy} onClick={() => void act('r', () => passCalls.revoke(r.id))}>Revoke</Button>}
            </div></td>
          </tr>
        ))}</tbody></table>
      </Container>
      {!!status?.recent?.length && (
        <Container title="Recent passes" icon="clock">
          <table className="fx-table"><tbody>{status.recent.filter(Boolean).map((p) => <tr key={p!.id}><td className="fx-mono axf-tc-small">{p!.id}</td><td>{p!.scope}</td><td>{p!.state}</td><td className="fx-muted">{p!.text}</td></tr>)}</tbody></table>
        </Container>
      )}
    </div>
  );
}

/* ---------------- Settings → Plugins → Token control ---------------- */

export function PassSettings() {
  const rt = useRuntime();
  const [max, setMax] = useState('');
  const [tz, setTz] = useState('');
  useEffect(() => { void pluginFetch(FOLDER, 'pass/settings').then((r) => r.json()).then((s: { maxMinutes?: number; timeZone?: string }) => { setMax(String(s.maxMinutes ?? 240)); setTz(s.timeZone ?? ''); }); }, []);
  const save = async () => {
    const r = await pluginFetch(FOLDER, 'pass/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxMinutes: Number(max) || 240, timeZone: tz }) });
    const s = (await r.json()) as { ok?: boolean; maxMinutes?: number };
    rt.toast(s.ok ? `Passes now last at most ${s.maxMinutes} min` : 'Not saved', s.ok ? 'success' : 'danger');
    if (s.maxMinutes) setMax(String(s.maxMinutes));
  };
  return (
    <div className="fx-stack">
      <p className="fx-muted">How long a veto pass may last at most (1–240 minutes; a longer request is cut to this), and the time zone the plain answers use ("until 10:42 AM").</p>
      <div className="fx-row axf-tc-wrap">
        <TextField label="Longest pass (minutes)" value={max} onChange={setMax} mono />
        <TextField label="Time zone" value={tz} onChange={setTz} hint="e.g. America/New_York" />
      </div>
      <div className="fx-row"><Button icon="check" onClick={() => void save()}>Save</Button></div>
    </div>
  );
}
