/**
 * API client core (`ai.amberx.axf.apiclient`): what every AXF web app needs to talk to its own server with a token.
 *
 *   const tokens = createTokenStore({ key: 'my-app:token' });          // localStorage, try/catch, change event
 *   const api = createApiClient({ url: (p) => `/api/${p}`, tokens, messages: { unauthorized: 'Set the token first.' } });
 *   await api.call<T>('items'); await api.post<T>('items', body); await api.download('report', 'report.json');
 *
 * Errors are `ApiError` (message + HTTP status; 0 when the server could not be reached and `unreachable` is set).
 * The token only ever goes in the Authorization header, never in a URL. Nothing here imports React.
 */

/* ================================================================== token store */

export interface TokenStore {
  /** localStorage key the token is kept under */
  readonly key: string;
  /** window event fired after every set/clear (also on `globalThis`) */
  readonly event: string;
  get(): string;
  /** Save (empty clears). Never throws: blocked storage just keeps nothing. Fires `event`. */
  set(token: string): void;
  clear(): void;
  /** Called after a change in this tab (event) or another tab (storage event). Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface TokenStoreOptions {
  key: string;
  /** event name; default `<key>:changed` */
  event?: string;
}

/** A token kept in this browser's localStorage. Every access is wrapped: private windows and blocked storage read as no token. */
export function createTokenStore(opts: TokenStoreOptions): TokenStore {
  const key = opts.key;
  const event = opts.event ?? `${key}:changed`;
  const get = (): string => { try { return globalThis.localStorage?.getItem(key) ?? ''; } catch { return ''; } };
  const set = (t: string): void => {
    try { if (t) globalThis.localStorage?.setItem(key, t); else globalThis.localStorage?.removeItem(key); } catch { /* storage blocked */ }
    try { globalThis.dispatchEvent?.(new Event(event)); } catch { /* no event target (tests, workers) */ }
  };
  return {
    key, event, get, set, clear: () => set(''),
    subscribe(listener) {
      const onStorage = (e: Event) => { if ((e as StorageEvent).key === key || (e as StorageEvent).key === null) listener(); };
      globalThis.addEventListener?.(event, listener);
      globalThis.addEventListener?.('storage', onStorage);
      return () => { globalThis.removeEventListener?.(event, listener); globalThis.removeEventListener?.('storage', onStorage); };
    },
  };
}

/* ================================================================== errors + messages */

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiError'; }
}

export interface ApiMessages {
  /** 401 (no or wrong token) */
  unauthorized?: string;
  /** 404 without a `detail`: the API (or plugin) is switched off or not running. Unset = treated like any failure. */
  unavailable?: string;
  /** fetch itself failed (offline, server down). Unset = the fetch error propagates unchanged. */
  unreachable?: string;
  /** message for a failure without a usable `detail`; default: the JSON of `detail ?? statusText` */
  failed?: (status: number, statusText: string, detail: unknown) => string;
}

/** The standard wording an AXF app's own server answers get. */
export const STANDARD_MESSAGES = {
  unauthorized: (where: string) => `Console token required (${where}).`,
  unavailable: (what: string) => `${what} is disabled or its server part is not running.`,
} as const;

export interface ErrorRules {
  messages: ApiMessages;
  /** true: a string `detail` from the server wins over the fixed 401 message (default false: the fixed message wins) */
  preferDetail?: boolean;
}

/** The message for a failed response with body `j` (already parsed; `{}` when it wasn't JSON). Null when `r` is ok. */
export function errorMessage(status: number, statusText: string, j: { detail?: unknown }, rules: ErrorRules): string | null {
  const m = rules.messages;
  const detail = j?.detail;
  if (status === 401 && m.unauthorized && !(rules.preferDetail && typeof detail === 'string')) return m.unauthorized;
  if (status === 404 && !detail && m.unavailable) return m.unavailable;
  if (status >= 200 && status < 300) return null;
  if (typeof detail === 'string') return detail;
  return m.failed ? m.failed(status, statusText, detail) : JSON.stringify(detail ?? statusText);
}

/* ================================================================== client */

export interface ApiClientOptions extends ErrorRules {
  /** path → URL, e.g. (p) => `/api/plugins/x/${p.replace(/^\/+/, '')}` */
  url: (path: string) => string;
  tokens: TokenStore;
  /** fetch to use (tests); default global fetch */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface ApiClient {
  /** fetch with the token (Bearer), JSON content type when there's a body, `cache: no-store`; the raw Response */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** JSON call; throws ApiError with the standard messages */
  call<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  /** GET a file and save it (name from Content-Disposition, else `fallbackName`) */
  download(path: string, fallbackName: string, init?: RequestInit): Promise<void>;
  /** GET a file as a Blob (e.g. an image that needs the token); `accept` filters the type */
  blob(path: string, init?: RequestInit, accept?: RegExp): Promise<Blob>;
}

/** Headers with the Bearer token and a JSON content type when there's a body (an explicit content type wins). */
export function authHeaders(tokens: TokenStore, init: RequestInit = {}): Headers {
  const headers = new Headers(init.headers);
  const token = tokens.get();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return headers;
}

/** Save a Blob as a file through a temporary link. */
export function saveBlob(blob: Blob, name: string, revokeAfterMs = 30_000): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
}

/** File name from a Content-Disposition header (`filename="…"`), plain names only. */
export function dispositionName(header: string | null, fallback: string): string {
  const m = /filename="([^"/\\]+)"/.exec(header ?? '');
  return m?.[1] ?? fallback;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const doFetch = opts.fetch ?? ((u: string, i: RequestInit) => fetch(u, i));
  const raw = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const req: RequestInit = { ...init, headers: authHeaders(opts.tokens, init), cache: 'no-store' };
    if (opts.messages.unreachable === undefined) return doFetch(opts.url(path), req);
    try { return await doFetch(opts.url(path), req); } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new ApiError(opts.messages.unreachable, 0);
    }
  };
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const r = await raw(path, init);
    const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
    const msg = errorMessage(r.status, r.statusText, j, opts);
    if (msg !== null) throw new ApiError(msg, r.status);
    return j;
  };
  const fileError = async (r: Response, what: string): Promise<ApiError> => {
    let detail: unknown;
    try { detail = ((await r.json()) as { detail?: unknown }).detail; } catch { /* not JSON */ }
    return new ApiError(r.status === 401 && opts.messages.unauthorized && !(opts.preferDetail && typeof detail === 'string') ? opts.messages.unauthorized : typeof detail === 'string' ? detail : `${what} failed (${r.status}).`, r.status);
  };
  return {
    fetch: raw,
    call,
    post: <T>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) => call<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
    del: <T>(path: string) => call<T>(path, { method: 'DELETE' }),
    async download(path, fallbackName, init) {
      const r = await raw(path, init);
      if (!r.ok) throw await fileError(r, 'Download');
      saveBlob(await r.blob(), dispositionName(r.headers.get('content-disposition'), fallbackName));
    },
    async blob(path, init, accept) {
      const r = await raw(path, init);
      if (!r.ok) throw await fileError(r, 'Request');
      const b = await r.blob();
      if (accept && !accept.test(b.type)) throw new ApiError('Unexpected file type.', 415);
      return b;
    },
  };
}
