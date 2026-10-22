/**
 * Browser client for this app's own API (server/main.py, same origin under /api).
 *
 * Behind axHub's sign-in wall a signed-in hub admin needs nothing here: the proxy adds the hub's signed headers and
 * the server trusts them. Without the wall (local dev, or the wall is off) every /api route needs the app token
 * (APP_TOKEN on the server); paste it once and it stays in this browser only.
 */
const TOKEN_KEY = 'patches-web:token';

export function savedToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function saveToken(token: string): void {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

export interface ApiResult<T> { ok: boolean; status: number; data: T | null; error?: string }

export async function api<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  const tok = savedToken();
  if (tok) headers.set('authorization', `Bearer ${tok}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  try {
    const r = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
    const isJson = (r.headers.get('content-type') ?? '').includes('json');
    const body = isJson ? await r.json() : null;
    if (!r.ok) return { ok: false, status: r.status, data: null, error: (body as { detail?: string } | null)?.detail ?? r.statusText };
    return { ok: true, status: r.status, data: body as T };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Who is calling, from GET /api/me. `role` is the hub-accounts policy role (admin | themes | user). */
export interface Me {
  wall: boolean;
  hub: string;
  user: { name: string; role: 'admin' | 'user'; perms: string[]; via: string } | null;
  role: 'admin' | 'themes' | 'user' | null;
}
