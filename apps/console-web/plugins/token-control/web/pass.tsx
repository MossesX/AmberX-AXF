/**
 * Veto passes in the console (control-pass@1; builds theme-veto-pass, pass-all): the banner chip with a live countdown
 * while a pass is on ("Everything: 29:41 left"; Extend, Revoke, Undo; a warning two minutes before it ends) and the
 * waiting requests Brett approves or denies. Starting a pass, the scopes, the recent passes and the longest-pass setting
 * moved to Builds → VPS Configuration → Passes (the gate plugin, Nov 21 2026), which calls the same pass routes.
 * A pass is for everything unless a narrower scope is picked.
 *
 * Owner actions (grant, extend, approve, deny) go out WITHOUT the console token first, so the server sees Brett's
 * signed-in axHub session (a bearer token is what agents hold, and it can only file a request). Without a session
 * (no wall) they fall back to the token, and the server answers what that may do.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import { ownerFetch, pluginFetch } from '@console/plugins';
import { openPass } from './pass-approval';

const FOLDER = 'token-control';
const POLL_MS = 5_000;
const WARN_MS = 2 * 60 * 1000;

export interface PassView { id: string; scope: string; label?: string; state: string; minutes: number; reason: string; include_irreversible?: boolean; requestedBy: string; requestedAt: string; approvedBy?: string; approvedVia?: string; grantedAt?: string; expiresAt?: string; remainingMs: number; warn: boolean; changes: number; undoable?: number; notUndoable?: number; text: string }
interface ScopeRow { id: string; label: string; targets: string[]; active: PassView | null; pending: PassView | null; text: string }
interface Status { ok: boolean; items?: ScopeRow[]; maxMinutes?: number; recent?: (PassView | null)[]; text?: string; message?: string }

/* ---------------- one shared poll + a one-second clock for the countdown ---------------- */

let st: { status: Status | null; error: string; at: number } = { status: null, error: '', at: 0 };
const subs = new Set<() => void>();
const emit = (p: Partial<typeof st>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
let timer: ReturnType<typeof setInterval> | null = null;

let inFlight = false;
let again = false;
export async function loadPasses(): Promise<void> {
  if (inFlight) { again = true; return; } // one request at a time; a call made meanwhile (after a grant) runs once after it
  inFlight = true;
  try {
    const r = await pluginFetch(FOLDER, 'pass/status');
    const j = (await r.json()) as Status;
    emit(j.ok ? { status: j, error: '', at: Date.now() } : { error: j.message ?? `HTTP ${r.status}` });
  } catch (e) { emit({ error: (e as Error).message }); } finally { inFlight = false; }
  if (again) { again = false; await loadPasses(); }
}
/* Module-level on purpose: an inline subscribe is a new function every render, so React re-subscribes after every
   emit; with one consumer that stopped the timer and loaded again at once (a request storm). */
function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) { void loadPasses(); timer = setInterval(() => { if (document.visibilityState === 'visible') void loadPasses(); }, POLL_MS); }
  return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
const snapshot = () => st;
export function usePasses() {
  return useSyncExternalStore(subscribe, snapshot);
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

interface Answer { ok: boolean; text?: string; message?: string; code?: string; approval?: { required: boolean }; notUndoable?: { what: string }[] }

/** Brett's own action: his session first (no bearer token), the console token only when there is no session. */
async function ownerCall(path: string, body: unknown): Promise<Answer> {
  const r = await ownerFetch(FOLDER, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, message: `HTTP ${r.status}` }))) as Answer;
}
async function tokenCall(path: string, body: unknown): Promise<Answer> {
  const r = await pluginFetch(FOLDER, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, message: `HTTP ${r.status}` }))) as Answer;
}
export const passCalls = {
  grant: (scope: string, minutes: number, reason = '', includeIrreversible = false) => ownerCall('pass/grant', { scope, minutes, reason, by: 'console', ...(includeIrreversible ? { include_irreversible: true } : {}) }),
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
      // undo names what it couldn't roll back: a warning toast, so Brett sees it
      rt.toast(a.ok ? (a.text ?? 'Done') : `${a.code ?? 'failed'}: ${a.message ?? ''}`, a.ok ? (a.approval?.required || a.notUndoable?.length ? 'warning' : 'success') : 'danger');
      await loadPasses();
    } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(''); }
  };
  return { busy, act };
}

/* ---------------- the banner ---------------- */

const SCOPE_WORD: Record<string, string> = { all: 'Everything', 'tokens.theme': 'Theme', 'tokens.style': 'Style', 'tokens.layout': 'Layout', 'tokens.*': 'All tokens' };
const scopeWord = (p: { scope: string; label?: string }) => p.label ?? SCOPE_WORD[p.scope] ?? p.scope;
/** What a waiting request asks for, in words: "everything" / "theme changes", plus irreversible deletes when included. */
const askWord = (p: PassView) => `${p.scope === 'all' ? 'everything' : `${scopeWord(p).toLowerCase()} changes`}${p.include_irreversible ? ' (irreversible deletes too)' : ''}`;

export function PassBanner() {
  const rt = useRuntime();
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
          <span key={p.id} className="axp-pass-chip" title={`${p.text} Approved by ${p.approvedBy ?? '?'}; ${p.changes} change(s) so far${p.notUndoable ? `, ${p.notUndoable} of them can't be rolled back` : ''}.`}>
            <span><b>{scopeWord(p)}</b>{p.include_irreversible ? ' +irreversible' : ''}:</span>
            <span className="fx-mono axp-pass-chip__time">{countdown(p.expiresAt, now)} left</span>
            {left(p) <= WARN_MS && <span className="axp-pass-chip__warn">ending soon</span>}
            <Button size="sm" tone="ghost" icon="plus" disabled={!!busy} onClick={() => void act(`x${p.id}`, () => passCalls.grant(p.scope, p.minutes || 30, 'extended from the banner', !!p.include_irreversible))}>Extend</Button>
            {p.changes > 0 && <Button size="sm" tone="ghost" icon="undo" disabled={!!busy} onClick={() => void act(`u${p.id}`, () => passCalls.undo(p.scope))}>Undo {p.changes}</Button>}
            <Button size="sm" tone="ghost" icon="x" disabled={!!busy} onClick={() => void act(`r${p.id}`, () => passCalls.revoke(p.scope))}>Revoke</Button>
          </span>
        ))}
        {pending.map((p) => (
          <span key={p.id} className="axp-pass-chip axp-pass-chip--ask" title={p.reason || p.text}>
            <span><b>{p.requestedBy}</b> asks: {askWord(p)} without veto for {p.minutes} min</span>
            <Button size="sm" tone="primary" icon="check" disabled={!!busy} onClick={() => void act(`a${p.id}`, () => passCalls.approve(p.scope, p.id))}>Approve</Button>
            <Button size="sm" tone="ghost" icon="x" disabled={!!busy} onClick={() => void act(`d${p.id}`, () => passCalls.deny(p.scope, p.id))}>Deny</Button>
            <Button size="sm" tone="ghost" icon="shield" title="Open this pass (its own page: who asks, scope, veto window)" onClick={() => { openPass(p.id); rt.navigate('token-control'); }}>Open</Button>
          </span>
        ))}
      </div>
    </div>
  );
}
