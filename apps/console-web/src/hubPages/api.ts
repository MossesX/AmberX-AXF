/**
 * The hub's JSON API for its own pages (`/auth/api/*`, axHub decision #96), reached from the console (hub-pages@1).
 *
 * The console's axHub plugins (Approvals, Passes, Users, Handoff, Apps, Account …) call the console server's relay
 * (`/api/hub-pages/<path>`, server/hub_pages.py), which calls the hub with this browser's hub session, or with the
 * console's owner sign-in when the browser's session doesn't reach the console. The relay reads the session's CSRF
 * value itself, so nothing here holds a token or a CSRF value; only a wall admin's browser may use it (the console
 * token alone is refused there), so nothing an AI client holds can decide a call through these pages.
 *
 * Moved from apps/axhub-web/src/hub/api.ts (Nov 20 2026): same exports, so the pages read the same.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { HUB_DEFAULT, normalizeHub } from '../axf/libs/hub/hub';
import { errorText, keepSessionOnFailure, sameJson } from './core';

export interface HubUser {
  id: string; username: string; role: 'admin' | 'user'; disabled: boolean; createdAt: string; passwordChangedAt: string;
  weakPassword: boolean; permissions: string[]; name: string; email: string; mustChangePassword: boolean;
}

export interface HubSession {
  signedIn: boolean;
  hub: string;
  loginUrl: string;
  mustChangePassword?: boolean;
  firstUrl?: string;
  user?: HubUser;
  admin?: boolean;
  can?: { approvals: boolean; approvalLog: boolean; users: boolean; apps: boolean; handoff: boolean };
  /** Which sign-in the console's relay used: this browser's own hub session, or the console's owner sign-in. */
  via?: 'browser' | 'owner' | '';
  /** Why there is no session at all (no browser session and no owner sign-in on the console server). */
  reason?: string;
}

export class HubApiError extends Error {
  constructor(readonly status: number, message: string, readonly code: string = '') { super(message); }
}

/** What the pages say on a hub from before decision #96 (no JSON API yet). */
export const OLD_HUB = "This hub hasn't got its JSON pages yet. Use its own approvals page until it is updated.";

let hubBase = HUB_DEFAULT;
/** The hub the console's wall belongs to (read from the relay's state; the default hub until then). */
export const hub = (): string => hubBase;

type SessionState = { phase: 'loading' } | { phase: 'ready'; session: HubSession } | { phase: 'error'; error: string };

let state: SessionState = { phase: 'loading' };
let loading: Promise<HubSession | null> | null = null;
const listeners = new Set<() => void>();
const emit = (s: SessionState) => { state = s; listeners.forEach((l) => l()); };

/** The relay's address for a hub path (`/auth/api/users?x=1` → `/api/hub-pages/auth/api/users?x=1`). */
export const relayUrl = (path: string): string => `/api/hub-pages/${path.replace(/^\/+/, '')}`;

async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await fetch(relayUrl(path), {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    return { status: 0, json: null };
  }
  const text = await res.text().catch(() => '');
  if (text.length > 2_000_000) return { status: res.status, json: { error: { message: 'Reply too large.' } } };
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  // The console's own refusals (FastAPI `detail`) read like the hub's errors.
  if (json && typeof json === 'object' && typeof (json as { detail?: unknown }).detail === 'string' && !(json as { error?: unknown }).error) {
    json = { error: { code: 'console', message: (json as { detail: string }).detail } };
  }
  return { status: res.status, json };
}

/** Reads the session again (after a write the hub refused, coming back to the tab). */
export function refreshSession(): Promise<HubSession | null> {
  if (loading) return loading;
  loading = (async () => {
    const r = await request('GET', '/auth/api/session');
    loading = null;
    const s = r.json as HubSession | null;
    if (r.status === 200 && s && typeof s.signedIn === 'boolean') {
      const h = normalizeHub(s.hub);
      if (h) hubBase = h;
      if (state.phase === 'ready' && sameJson(state.session, s)) return state.session;
      emit({ phase: 'ready', session: s });
      return s;
    }
    if (keepSessionOnFailure(state.phase, r.status)) return state.phase === 'ready' ? state.session : null;
    emit({ phase: 'error', error: r.status === 404 ? OLD_HUB : errorText(r.status, r.json) });
    return null;
  })();
  return loading;
}

function fail(r: { status: number; json: unknown }): never {
  const code = (r.json as { error?: { code?: string } } | null)?.error?.code ?? '';
  if (r.status === 401 || (r.json as { mustChangePassword?: boolean } | null)?.mustChangePassword) void refreshSession();
  throw new HubApiError(r.status, errorText(r.status, r.json), code);
}

export async function hubGet<T>(path: string): Promise<T> {
  const r = await request('GET', path);
  if (r.status !== 200) fail(r);
  return r.json as T;
}

/** A write: JSON body; the relay adds the session's CSRF value and the hub's Origin. */
export async function hubPost<T>(path: string, body: unknown = {}): Promise<T> {
  const r = await request('POST', path, body);
  if (r.status !== 200) fail(r);
  return r.json as T;
}

/** The signed-in session: loads on first use and again whenever the tab comes back into view. */
export function useHubSession(): SessionState & { refresh: () => void } {
  const s = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
  useEffect(() => {
    if (state.phase === 'loading' && !loading) void refreshSession();
    const back = () => { if (document.visibilityState === 'visible') void refreshSession(); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);
  return { ...s, refresh: () => { void refreshSession(); } };
}

/** Signs this session out of the hub, then reads the session again. */
export async function signOut(): Promise<string> {
  const r = await hubPost<{ message?: string }>('/auth/api/logout');
  await refreshSession();
  return r.message ?? 'Signed out.';
}
