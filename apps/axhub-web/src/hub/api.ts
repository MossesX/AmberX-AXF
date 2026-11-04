/**
 * The hub's JSON API for its own pages (`/auth/api/*`, decision #96 on axHub).
 *
 * This app is served on the hub's own address, so every call is same-origin with the browser's hub session cookie.
 * There is no token here: writes carry the session's CSRF value (`X-AxHub-CSRF`, read from `/auth/api/session`) and
 * the browser's Origin, which the hub checks; the MCP bearer token never reaches these routes, so nothing an AI client
 * holds can decide a call. Redirects are refused and replies are never cached.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { errorText, keepSessionOnFailure, sameJson } from './core';
import { HUB } from './useHub';

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
  csrf?: string;
  can?: { approvals: boolean; approvalLog: boolean; users: boolean; apps: boolean; handoff: boolean };
}

export class HubApiError extends Error {
  constructor(readonly status: number, message: string, readonly code: string = '') { super(message); }
}

/** What the pages say on a hub from before decision #96 (no JSON API yet). */
export const OLD_HUB = "This hub hasn't got its new pages yet. Use its own approvals page until it is updated.";

type SessionState = { phase: 'loading' } | { phase: 'ready'; session: HubSession } | { phase: 'error'; error: string };

let state: SessionState = { phase: 'loading' };
let loading: Promise<HubSession | null> | null = null;
const listeners = new Set<() => void>();
const emit = (s: SessionState) => { state = s; listeners.forEach((l) => l()); };

async function request(method: 'GET' | 'POST', path: string, body?: unknown, csrf?: string): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${HUB}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-AxHub-CSRF': csrf ?? '' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    return { status: 0, json: null };
  }
  const text = await res.text().catch(() => '');
  if (text.length > 2_000_000) return { status: res.status, json: { error: { message: 'Reply too large.' } } };
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json };
}

/** Reads `/auth/api/session` again (after sign-in, sign-out, an expired CSRF value, coming back to the tab). */
export function refreshSession(): Promise<HubSession | null> {
  if (loading) return loading;
  loading = (async () => {
    const r = await request('GET', '/auth/api/session');
    loading = null;
    const s = r.json as HubSession | null;
    if (r.status === 200 && s && typeof s.signedIn === 'boolean') {
      // The same session again (every tab-back re-read) is not news: no re-render of every page under the gate.
      if (state.phase === 'ready' && sameJson(state.session, s)) return state.session;
      emit({ phase: 'ready', session: s });
      return s;
    }
    // A blip while signed in keeps the page; the next read (or the next write's own check) tries again.
    if (keepSessionOnFailure(state.phase, r.status)) return state.phase === 'ready' ? state.session : null;
    // A hub that hasn't been updated yet has no /auth/api: say so, its own pages still work meanwhile.
    emit({ phase: 'error', error: r.status === 404 ? OLD_HUB : errorText(r.status, r.json) });
    return null;
  })();
  return loading;
}

const current = () => (state.phase === 'ready' ? state.session : null);

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

/** A write: JSON body, the session's CSRF value; an expired value is read again and the write tried once more. */
export async function hubPost<T>(path: string, body: unknown = {}): Promise<T> {
  let csrf = current()?.csrf ?? (await refreshSession())?.csrf;
  let r = await request('POST', path, body, csrf);
  if (r.status === 403 && (r.json as { error?: { code?: string } } | null)?.error?.code === 'expired') {
    csrf = (await refreshSession())?.csrf;
    r = await request('POST', path, body, csrf);
  }
  if (r.status !== 200) fail(r);
  return r.json as T;
}

/** The signed-in browser: loads on first use and again whenever the tab comes back into view. */
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

/** Signs this browser out of the hub (every hub page and app behind the wall), then reads the session again. */
export async function signOut(): Promise<string> {
  const r = await hubPost<{ message?: string }>('/auth/api/logout');
  await refreshSession();
  return r.message ?? 'Signed out.';
}
