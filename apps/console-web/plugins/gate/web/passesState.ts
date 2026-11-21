/**
 * Veto passes (control-pass@1) for VPS Configuration → Passes: one shared poll of the pass status, the calls, and the
 * longest-pass setting. The passes themselves stay with the control@1 runner (the Token control plugin's server:
 * `pass/status | grant | approve | deny | revoke | undo | settings`), the same routes MCP (pass_grant, pass_revoke …),
 * the CLI (`axf pass …`) and the pass banner use; this file is their one home in the UI.
 *
 * Owner actions (grant, extend, approve, deny, the longest-pass setting) go out without the console token first, so the
 * server sees Brett's signed-in session; a bearer token (what agents hold) can only file a request.
 * console-control@1 (registered at start): `setting:vps.passes.maxMinutes | timeZone`; actions `vps.passes.open[:tab]`,
 * `vps.passes.status`, `vps.passes.grant:<minutes>[:<scope>]`, `vps.passes.revoke[:<scope>]`, `vps.passes.max:<minutes>`.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { ownerFetch, pluginFetch } from '@console/plugins';
import { showTab } from './api';

const RUNNER = 'token-control'; // axf-plugin:token-control
const POLL_MS = 5_000;

export interface PassView { id: string; scope: string; label?: string; state: string; minutes: number; reason: string; include_irreversible?: boolean; requestedBy: string; requestedAt: string; approvedBy?: string; grantedAt?: string; expiresAt?: string; changes: number; notUndoable?: number; text: string }
export interface ScopeRow { id: string; label: string; targets: string[]; active: PassView | null; pending: PassView | null; text: string }
export interface PassStatus { ok: boolean; items?: ScopeRow[]; maxMinutes?: number; recent?: (PassView | null)[]; text?: string; message?: string }
export interface PassAnswer { ok: boolean; text?: string; message?: string; code?: string; approval?: { required: boolean }; notUndoable?: { what: string }[] }
export interface PassSettings { ok?: boolean; maxMinutes?: number; timeZone?: string }
export const PASS_TABS = ['veto', 'hub', 'go'] as const;
export type PassTab = (typeof PASS_TABS)[number];
export const isPassTab = (t: unknown): t is PassTab => typeof t === 'string' && (PASS_TABS as readonly string[]).includes(t);

/* ---------------- one shared poll ---------------- */

let st: { status: PassStatus | null; error: string } = { status: null, error: '' };
const subs = new Set<() => void>();
const emit = (p: Partial<typeof st>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let again = false;
export async function loadPasses(): Promise<PassStatus | null> {
  if (inFlight) { again = true; return st.status; } // one request at a time; a call made meanwhile runs once after it
  inFlight = true;
  try {
    const r = await pluginFetch(RUNNER, 'pass/status');
    const j = (await r.json()) as PassStatus;
    emit(j.ok ? { status: j, error: '' } : { error: j.message ?? `HTTP ${r.status}` });
  } catch (e) { emit({ error: (e as Error).message }); } finally { inFlight = false; }
  if (again) { again = false; await loadPasses(); }
  return st.status;
}
// module-level on purpose: an inline subscribe is a new function every render and would restart the poll each time
function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) { void loadPasses(); timer = setInterval(() => { if (document.visibilityState === 'visible') void loadPasses(); }, POLL_MS); }
  return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
const snapshot = () => st;
export function usePasses() { return useSyncExternalStore(subscribe, snapshot); }
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return now;
}
/** mm:ss (or h:mm:ss) left until `iso`. */
export function countdown(iso: string | undefined, now: number): string {
  const s = Math.max(0, Math.round(((iso ? Date.parse(iso) : now) - now) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
}
/** Minutes asked for, held to 1…the longest-pass setting. */
export const clampMinutes = (minutes: unknown, max = 240): number => Math.min(Math.max(1, max), Math.max(1, Math.round(Number(minutes)) || 30));

/* ---------------- calls ---------------- */

const post = async (fetcher: typeof pluginFetch, path: string, body: unknown, method = 'POST'): Promise<PassAnswer> => {
  const r = await fetcher(RUNNER, path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, message: `HTTP ${r.status}` }))) as PassAnswer;
};
export const passCalls = {
  grant: (scope: string, minutes: number, reason = '', includeIrreversible = false) => post(ownerFetch, 'pass/grant', { scope, minutes, reason, by: 'console', ...(includeIrreversible ? { include_irreversible: true } : {}) }),
  approve: (scope: string, request: string) => post(ownerFetch, 'pass/approve', { scope, request }),
  deny: (scope: string, request: string) => post(ownerFetch, 'pass/deny', { scope, request }),
  revoke: (scope: string) => post(pluginFetch, 'pass/revoke', { scope, by: 'console' }),
  undo: (scope: string) => post(pluginFetch, 'pass/undo', { scope, by: 'console' }),
};

let settings: PassSettings | null = null;
export const cachedPassSettings = () => settings;
export async function loadPassSettings(): Promise<PassSettings> { settings = (await (await pluginFetch(RUNNER, 'pass/settings')).json()) as PassSettings; return settings; }
export async function savePassSettings(patch: { maxMinutes?: number; timeZone?: string }): Promise<PassSettings> {
  const r = await ownerFetch(RUNNER, 'pass/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const s = (await r.json().catch(() => ({ ok: false }))) as PassSettings & { error?: string };
  if (!s.ok) throw new Error(s.error || 'The pass settings were not saved.');
  settings = { ...settings, ...s }; void loadPasses();
  return settings;
}

/* ---------------- the open sub-tab (deep links, actions, the old axHub pages' addresses) ---------------- */

let wanted: PassTab | null = null;
const tabListeners = new Set<(t: PassTab) => void>();
export function showPassTab(tab: PassTab): void { wanted = tab; for (const l of tabListeners) l(tab); }
export function takeWantedPassTab(): PassTab | null { const t = wanted; wanted = null; return t; }
export function onShowPassTab(l: (t: PassTab) => void): () => void { tabListeners.add(l); return () => { tabListeners.delete(l); }; }

export const passLine = (s: PassStatus | null): string => {
  const rows = s?.items ?? [];
  const on = rows.filter((r) => r.active); const ask = rows.filter((r) => r.pending);
  return `${on.length ? on.map((r) => r.text).join(' ') : 'No pass is on.'}${ask.length ? ` ${ask.length} waiting for approval.` : ''} Longest pass: ${s?.maxMinutes ?? '?'} minutes.`;
};

export function registerPasses(rt: AxfRuntime): void {
  const T = 'Passes';
  const reg = controlRegistry(rt);
  const open = (tab?: string) => { rt.navigate('gate'); showTab('passes'); if (isPassTab(tab)) showPassTab(tab); };
  const said = (a: PassAnswer) => rt.toast(a.ok ? (a.text ?? 'Done.') : `${a.code ?? 'failed'}: ${a.message ?? ''}`, a.ok ? (a.approval?.required ? 'warning' : 'success') : 'danger', T);
  const failed = (e: Error) => rt.toast(e.message, 'danger', T);
  reg.register({
    address: 'setting:vps.passes.maxMinutes', kind: 'setting', label: 'Passes: longest pass (minutes)', detail: 'How long a veto pass may last at most; a longer request is cut to this.',
    keywords: ['vps configuration', 'veto pass', 'passes', 'longest', 'minutes'],
    get: () => settings?.maxMinutes ?? null, set: async (v: unknown) => (await savePassSettings({ maxMinutes: Number(v) })).maxMinutes ?? null, open: () => open('veto'),
  });
  reg.register({
    address: 'setting:vps.passes.timeZone', kind: 'setting', label: 'Passes: time zone', detail: 'The time zone the plain answers use ("until 10:42 AM").',
    keywords: ['vps configuration', 'veto pass', 'passes', 'time zone'],
    get: () => settings?.timeZone ?? null, set: async (v: unknown) => (await savePassSettings({ timeZone: String(v) })).timeZone ?? null, open: () => open('veto'),
  });
  void loadPassSettings().catch(() => { /* the runner may be off: the targets answer null */ });
  rt.actions.register('vps.passes.open', ([tab]) => open(tab), { label: 'Open the veto passes', params: true, effect: 'navigate' });
  rt.actions.register('vps.passes.status', () => { void loadPasses().then((s) => rt.toast(passLine(s), 'info', T), failed); }, { label: 'Which veto passes are on', effect: 'read' });
  rt.actions.register('vps.passes.grant', ([minutes = '', scope = 'all']) => {
    void loadPasses().then((s) => passCalls.grant(scope || 'all', clampMinutes(minutes || 30, s?.maxMinutes), 'asked for by voice or an action')).then((a) => { said(a); void loadPasses(); }, failed);
  }, { label: 'Start a veto pass', params: true, effect: 'write' });
  rt.actions.register('vps.passes.revoke', ([scope = 'all']) => {
    void passCalls.revoke(scope || 'all').then((a) => { said(a); void loadPasses(); }, failed);
  }, { label: 'Revoke a veto pass', params: true, effect: 'write' });
  rt.actions.register('vps.passes.max', ([minutes = '']) => {
    if (!minutes) { rt.toast('Say how many minutes, for example vps.passes.max:120.', 'warning', T); return; }
    void savePassSettings({ maxMinutes: Number(minutes) }).then((s) => rt.toast(`Passes now last at most ${s.maxMinutes} minutes.`, 'success', T), failed);
  }, { label: 'Set the longest veto pass', params: true, effect: 'write' });
  // the addresses of the axHub passes plugin this tab replaced: kept, so its links, phrases and the hub pages' own
  // `go(rt, 'passes')` still open the same pages
  rt.actions.register('axhub-passes.open', () => open('hub'), { label: "Open the hub's passes", effect: 'navigate' });
  rt.actions.register('axhub-go-pass.open', () => open('go'), { label: 'Open the Go pass', effect: 'navigate' });
}
