/**
 * Molly's credential seam (build molly-sign-in-once, s1): one place that knows, per app Molly holds, where that app's
 * API is and how a call to it is authenticated, so a native screen (an app's page Molly draws itself instead of
 * framing it) reaches the app's backend from molly.amberxai.com without knowing that app's sign-in scheme.
 *
 *   - Console: a bearer token (the console's AXF_TOKEN), kept in this browser for Molly's origin (localStorage, the
 *     framework's token store), sent as `Authorization`; cookies never ride along.
 *   - axHub: the browser's own hub session cookie (`credentials: 'include'`), the CSRF value from `/auth/api/session`
 *     on writes (`X-AxHub-CSRF`), sign-in on the hub's own page.
 *   - Expenses: the browser's `axs_session` cookie, or a pasted API bearer token with the `X-Expenses-User` header.
 *   - AmberX: no backend of its own (it reads the hub); nothing to sign in to.
 *
 * Per app: the API base in force (the app's default or the `molly.auth.<app>.base` setting), an {@link AuthProvider}
 * (prepare a request, check who we are, sign in, sign out), and the last known {@link AppConnection}. A plugin may
 * replace an app's provider (a single sign-on that derives every credential from the hub session, later) through
 * {@link CredentialSeam.set}; removing the plugin restores the default. Nothing here imports React or touches the
 * DOM at load, so `framework/spec/check-molly-credentials.mts` replays it in Node with a fake fetch.
 *
 * A browser cannot tell "offline" from "the app's server refused Molly's origin" (both are a failed fetch), so both
 * read as `unreachable` with a line that names the second cause; the server-side allowances are listed as their own
 * builds. No secret is ever written to a URL, a log line or the repo.
 */
import { createApiClient, createTokenStore, STANDARD_MESSAGES, type ApiClient, type TokenStore } from '../axf/libs/apiclient/client';
import { loginUrl } from '../axf/libs/hub/hub';
import { MOLLY_APPS, mollyApp } from './apps';

/* ================================================================== contract */

export const CREDENTIALS_CONTRACT = 'molly-credentials@1';

/** How an app's backend recognises a caller. */
export type AuthScheme = 'bearer' | 'session' | 'none';
export const AUTH_SCHEMES: readonly AuthScheme[] = ['bearer', 'session', 'none'];

/**
 * What the last check said. `unknown` until the first check; `none` for an app without a backend of its own;
 * `unreachable` covers offline and a server that refuses Molly's origin (a browser cannot tell them apart).
 */
export type ConnectionState = 'signed-in' | 'signed-out' | 'unreachable' | 'unknown' | 'none';
export const CONNECTION_STATES: readonly ConnectionState[] = ['signed-in', 'signed-out', 'unreachable', 'unknown', 'none'];

/** Methods that change something: a session provider adds its CSRF header to these. */
export const WRITE_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** One app's connection as the seam last saw it (data only, safe to show and to return from an action). */
export interface AppConnection {
  app: string;
  label: string;
  scheme: AuthScheme;
  /** the API base in force */
  apiBase: string;
  /** true when the base is the `molly.auth.<app>.base` setting rather than the app's default */
  baseOverridden: boolean;
  state: ConnectionState;
  /** who the backend says we are ('' when it doesn't say) */
  who: string;
  /** one line for a status row ('' when there is nothing to add) */
  detail: string;
  /** the page to sign in on (session), '' for bearer (paste a token) and none */
  signInUrl: string;
  /** bearer, or a session app that also takes a token: whether a token is saved in this browser */
  hasToken: boolean;
  checkedAt: string | null;
}

/** What the `whoami` reply means. */
export interface Identity {
  signedIn: boolean;
  who: string;
  csrf?: string;
  /** the backend's own sign-in page when it names one */
  signInUrl?: string;
  detail?: string;
}

/** One app's backend: where it is and how it is called. The table is {@link MOLLY_BACKENDS}. */
export interface AppBackend {
  app: string;
  scheme: AuthScheme;
  /** default API base (https, no trailing slash) */
  apiBase: string;
  /** GET path under the base that says who we are ('' when there is nothing to ask) */
  whoami: string;
  /** the sign-in page for the base in force ('' when a token is pasted instead) */
  signInUrl: (apiBase: string) => string;
  /** how to end the backend's session (session scheme only) */
  signOut?: { path: string; method: 'POST' };
  /** header carrying the CSRF value on writes (session scheme) */
  csrfHeader?: string;
  /** localStorage key of a bearer token (bearer; optional for a session app that also takes one) */
  tokenKey?: string;
  /** header naming the user a bearer call acts as (Expenses) */
  userHeader?: string;
  /** read the `whoami` reply (status + parsed JSON, `null` when it wasn't JSON) */
  identify: (status: number, json: unknown) => Identity;
}

/** The settings an app's connection reads: `base` (API base override) and `user` (the user a bearer call acts as). */
export const authSettingKeys = (app: string) => ({ base: `molly.auth.${app}.base`, user: `molly.auth.${app}.user` });

/** The origin (`https://host[:port]`) of an API base, for sign-in pages. */
export const originOf = (base: string): string => { try { return new URL(base).origin; } catch { return ''; } };

/** A usable API base: https, no query, fragment or user info; trailing slashes dropped. Null otherwise. */
export function normalizeApiBase(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
}

/** `<base>/<path>` with one slash between them; an empty path is the base itself. */
export const joinUrl = (base: string, path: string): string => { const p = path.replace(/^\/+/, ''); return p ? `${base}/${p}` : base; };

const str = (v: unknown, cap = 120): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, cap) : '');
const unexpected = (status: number): Identity => ({ signedIn: false, who: '', detail: status === 404 ? 'The API is not there (older server, or switched off).' : `The server answered ${status}.` });

/* ================================================================== the apps' backends */

const CONSOLE = 'https://console.amberxai.com/api';
const HUB = 'https://axhub.amberxai.com';
const EXPENSES = 'https://expenses.amberxai.com/api/expenses/v1';

/** In Molly's app order (apps.ts), so a status list reads like the navigation. */
export const MOLLY_BACKENDS: readonly AppBackend[] = [
  {
    app: 'amberx', scheme: 'none', apiBase: 'https://amberx.amberxai.com', whoami: '',
    signInUrl: () => '',
    identify: () => ({ signedIn: true, who: '', detail: 'No backend of its own; it reads the hub.' }),
  },
  {
    app: 'console', scheme: 'bearer', apiBase: CONSOLE, whoami: 'me', tokenKey: 'molly:console-token',
    signInUrl: () => '',
    identify(status, json) {
      if (status === 200 && json && typeof json === 'object') {
        const o = json as { role?: unknown; user?: { username?: unknown } | null; wall?: unknown };
        const signedIn = typeof o.role === 'string' && !!o.role;
        return { signedIn, who: str(o.user?.username) || (signedIn ? 'console token' : ''), detail: signedIn ? '' : 'The token was not accepted.' };
      }
      if (status === 401) return { signedIn: false, who: '', detail: 'Console token required.' };
      return unexpected(status);
    },
  },
  {
    app: 'axhub', scheme: 'session', apiBase: HUB, whoami: 'auth/api/session', csrfHeader: 'X-AxHub-CSRF',
    signOut: { path: 'auth/api/logout', method: 'POST' },
    signInUrl: (base) => loginUrl(originOf(base), '/'),
    identify(status, json) {
      if (status === 200 && json && typeof json === 'object') {
        const s = json as { signedIn?: unknown; user?: { username?: unknown } | null; csrf?: unknown; loginUrl?: unknown };
        if (typeof s.signedIn !== 'boolean') return unexpected(status);
        return { signedIn: s.signedIn, who: str(s.user?.username), csrf: str(s.csrf, 400), signInUrl: str(s.loginUrl, 400) || undefined, detail: s.signedIn ? '' : 'Signed out of the hub.' };
      }
      if (status === 404) return { signedIn: false, who: '', detail: "This hub hasn't got its JSON API yet." };
      return unexpected(status);
    },
  },
  {
    app: 'expenses', scheme: 'session', apiBase: EXPENSES, whoami: 'entries?limit=1', tokenKey: 'molly:expenses-token', userHeader: 'X-Expenses-User',
    signInUrl: (base) => `${originOf(base)}/login`,
    identify(status, json) {
      if (status === 200) return { signedIn: true, who: '', detail: '' };
      if (status === 401) return { signedIn: false, who: '', detail: str((json as { error?: unknown } | null)?.error) || 'Signed out of Expenses.' };
      if (status === 400) return { signedIn: false, who: '', detail: str((json as { error?: unknown } | null)?.error) || 'The token needs a user (X-Expenses-User).' };
      return unexpected(status);
    },
  },
];

export const backendOf = (app: string): AppBackend | undefined => MOLLY_BACKENDS.find((b) => b.app === app);

/* ================================================================== provider */

/** Where the seam reads its settings (the runtime's SettingsRegistry fits; tests pass a Map). */
export interface SettingsReader {
  get(key: string): unknown;
  /** called after `key` changes; returns unsubscribe (optional: a plain reader is re-read on every call anyway) */
  onChange?(key: string, fn: () => void): () => void;
}

export interface SeamDeps {
  settings: SettingsReader;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** token store per key (default: the framework's localStorage store) */
  tokens?: (key: string) => TokenStore;
  now?: () => string;
}

/**
 * One app's credentials. `prepare` is synchronous and never does I/O; `check` is the only call that asks the backend
 * who we are. Everything observable is in `connection()`.
 */
export interface AuthProvider {
  readonly app: string;
  readonly scheme: AuthScheme;
  /** the API base in force (setting override, else the app's default) */
  apiBase(): string;
  /** `<base>/<path>` */
  url(path: string): string;
  /** the request with this app's credentials: Authorization, cookies, CSRF on writes, no caching, no redirects */
  prepare(init?: RequestInit): RequestInit;
  /** the last known connection (no network) */
  connection(): AppConnection;
  /** ask the backend who we are and update the connection */
  check(): Promise<AppConnection>;
  /**
   * Bearer (or a session app given a token): save the token (empty forgets it) and check. Session: `open` is the page
   * to sign in on; the connection updates on the next check.
   */
  signIn(secret?: string): Promise<{ connection: AppConnection; open: string | null }>;
  /** forget the token and / or end the backend's session, then check */
  signOut(): Promise<AppConnection>;
  subscribe(fn: () => void): () => void;
}

/** An in-memory token store (tests, and the default for an app without a token key). */
export function memoryTokens(key = 'memory'): TokenStore {
  let value = '';
  const listeners = new Set<() => void>();
  const set = (t: string) => { value = t || ''; listeners.forEach((f) => f()); };
  return {
    key, event: `${key}:changed`, get: () => value, set, clear: () => set(''),
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

class BackendProvider implements AuthProvider {
  readonly app: string;
  readonly scheme: AuthScheme;
  private readonly tokens: TokenStore | null;
  private readonly f: (url: string, init: RequestInit) => Promise<Response>;
  private readonly now: () => string;
  private listeners = new Set<() => void>();
  private csrf = '';
  private last: { state: ConnectionState; who: string; detail: string; signInUrl: string; checkedAt: string | null };

  constructor(private readonly b: AppBackend, private readonly deps: SeamDeps) {
    this.app = b.app; this.scheme = b.scheme;
    this.tokens = b.tokenKey ? (deps.tokens ?? ((k) => createTokenStore({ key: k })))(b.tokenKey) : null;
    this.f = deps.fetch ?? ((u, i) => fetch(u, i));
    this.now = deps.now ?? (() => new Date().toISOString());
    this.last = { state: b.scheme === 'none' ? 'none' : 'unknown', who: '', detail: b.scheme === 'none' ? b.identify(0, null).detail ?? '' : '', signInUrl: '', checkedAt: null };
    this.tokens?.subscribe(() => this.notify());
    deps.settings.onChange?.(authSettingKeys(b.app).base, () => this.notify());
  }

  private notify() { this.listeners.forEach((f) => f()); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  private override(): string | null { return normalizeApiBase(this.deps.settings.get(authSettingKeys(this.app).base)); }
  apiBase(): string { return this.override() ?? this.b.apiBase; }
  url(path: string): string { return joinUrl(this.apiBase(), path); }

  /** true when this call rides a bearer token (bearer scheme, or a session app with a token saved) */
  private usesToken(): boolean { return !!this.tokens?.get(); }

  prepare(init: RequestInit = {}): RequestInit {
    const headers = new Headers(init.headers);
    if (!headers.has('accept')) headers.set('accept', 'application/json');
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const method = (init.method ?? 'GET').toUpperCase();
    const out: RequestInit = { ...init, method, headers, cache: 'no-store', redirect: 'error' };
    if (this.b.scheme === 'none') return { ...out, credentials: 'omit' };
    if (this.usesToken()) {
      headers.set('authorization', `Bearer ${this.tokens!.get()}`);
      const user = str(this.deps.settings.get(authSettingKeys(this.app).user), 64);
      if (this.b.userHeader && user) headers.set(this.b.userHeader, user);
      // a token call never carries cookies: the server may answer any origin, and the cookie would make that unsafe
      return { ...out, credentials: 'omit' };
    }
    if (this.b.scheme === 'bearer') return { ...out, credentials: 'omit' };
    if (this.b.csrfHeader && this.csrf && WRITE_METHODS.includes(method)) headers.set(this.b.csrfHeader, this.csrf);
    return { ...out, credentials: 'include' };
  }

  connection(): AppConnection {
    const base = this.apiBase();
    // a page to sign in on only while there is something to sign in to (a session app, no token, not signed in)
    const signInUrl = this.b.scheme === 'session' && !this.usesToken() && this.last.state !== 'signed-in' ? (this.last.signInUrl || this.b.signInUrl(base)) : '';
    return {
      app: this.app, label: mollyApp(this.app)?.label ?? this.app, scheme: this.scheme, apiBase: base, baseOverridden: this.override() !== null,
      state: this.last.state, who: this.last.who, detail: this.last.detail, signInUrl, hasToken: this.usesToken(), checkedAt: this.last.checkedAt,
    };
  }

  /** needs a CSRF value before a write and hasn't got one yet */
  needsCsrf(method: string): boolean { return this.b.scheme === 'session' && !!this.b.csrfHeader && !this.usesToken() && !this.csrf && WRITE_METHODS.includes(method.toUpperCase()); }

  async check(): Promise<AppConnection> {
    if (this.b.scheme === 'none' || !this.b.whoami) { this.last = { ...this.last, state: 'none', checkedAt: this.now() }; this.notify(); return this.connection(); }
    let state: ConnectionState; let who = ''; let detail = ''; let signInUrl = '';
    let r: Response | null = null;
    try { r = await this.f(this.url(this.b.whoami), this.prepare()); } catch { r = null; }
    if (!r) {
      state = 'unreachable';
      detail = `Can't reach ${mollyApp(this.app)?.label ?? this.app} from Molly (offline, or its server doesn't allow calls from Molly's address).`;
    } else {
      let json: unknown = null;
      try { json = await r.json(); } catch { json = null; }
      const id = this.b.identify(r.status, json);
      state = id.signedIn ? 'signed-in' : 'signed-out';
      who = id.who; detail = id.detail ?? ''; signInUrl = id.signInUrl ?? '';
      if (id.csrf !== undefined) this.csrf = id.csrf;
      if (!id.signedIn) this.csrf = '';
    }
    this.last = { state, who, detail, signInUrl, checkedAt: this.now() };
    this.notify();
    return this.connection();
  }

  async signIn(secret?: string): Promise<{ connection: AppConnection; open: string | null }> {
    if (this.b.scheme === 'none') return { connection: this.connection(), open: null };
    if (this.tokens && (secret !== undefined || this.b.scheme === 'bearer')) {
      this.tokens.set((secret ?? '').trim());
      return { connection: await this.check(), open: null };
    }
    const open = this.connection().signInUrl || null;
    return { connection: this.connection(), open };
  }

  async signOut(): Promise<AppConnection> {
    if (this.b.scheme === 'none') return this.connection();
    const hadToken = this.usesToken();
    this.tokens?.clear();
    if (this.b.scheme === 'session' && this.b.signOut && !hadToken) {
      if (!this.csrf && this.b.csrfHeader) await this.check();
      try { await this.f(this.url(this.b.signOut.path), this.prepare({ method: this.b.signOut.method, body: '{}' })); } catch { /* the check below says where we are */ }
      this.csrf = '';
    }
    return this.check();
  }
}

/* ================================================================== the seam */

/** Molly's one credential seam: a provider per app, plugin overrides, fetch / API client through them. */
export class CredentialSeam {
  private readonly defaults = new Map<string, AuthProvider>();
  private readonly overrides = new Map<string, { owner: string; provider: AuthProvider }>();
  private readonly listeners = new Set<() => void>();
  private rev = 0;

  constructor(readonly deps: SeamDeps, backends: readonly AppBackend[] = MOLLY_BACKENDS) {
    for (const b of backends) {
      const p = new BackendProvider(b, deps);
      p.subscribe(() => this.changed());
      this.defaults.set(b.app, p);
    }
  }

  private changed() { this.rev++; this.listeners.forEach((f) => f()); }
  /** changes whenever any connection changes (a render dependency) */
  revision(): number { return this.rev; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** the apps the seam knows (every Molly app with a backend entry) */
  apps(): string[] { return [...this.defaults.keys()]; }
  /** the provider in force for `app` (a plugin's, else the default); null for an app Molly doesn't hold */
  provider(app: string): AuthProvider | null { return this.overrides.get(app)?.provider ?? this.defaults.get(app) ?? null; }

  /** A plugin (`owner`) supplies `app`'s provider; the last one wins. Returns a function that restores the default. */
  set(owner: string, app: string, provider: AuthProvider): () => void {
    this.overrides.set(app, { owner, provider });
    const off = provider.subscribe(() => this.changed());
    this.changed();
    return () => { off(); if (this.overrides.get(app)?.provider === provider) { this.overrides.delete(app); this.changed(); } };
  }

  /** Drop every provider `owner` supplied (its plugin was switched off). */
  clearOwner(owner: string): void {
    let any = false;
    for (const [app, o] of this.overrides) if (o.owner === owner) { this.overrides.delete(app); any = true; }
    if (any) this.changed();
  }

  connections(): AppConnection[] { return this.apps().map((a) => this.provider(a)!.connection()); }
  connection(app: string): AppConnection | null { return this.provider(app)?.connection() ?? null; }
  async check(app: string): Promise<AppConnection | null> { return this.provider(app)?.check() ?? null; }
  async checkAll(): Promise<AppConnection[]> { return Promise.all(this.apps().map((a) => this.provider(a)!.check())); }

  /** fetch `path` on `app`'s API with its credentials (a write on a CSRF-protected session checks first for the value) */
  async fetch(app: string, path: string, init: RequestInit = {}): Promise<Response> {
    const p = this.provider(app);
    if (!p) throw new Error(`Molly doesn't hold an app "${app}".`);
    if (p instanceof BackendProvider && p.needsCsrf(init.method ?? 'GET')) await p.check();
    const f = this.deps.fetch ?? ((u, i) => fetch(u, i));
    return f(p.url(path), p.prepare(init));
  }

  /** The framework API client (`call` / `post` / `download`…) over `app`'s credentials, for native screens. */
  api(app: string): ApiClient {
    const p = this.provider(app);
    if (!p) throw new Error(`Molly doesn't hold an app "${app}".`);
    const label = mollyApp(app)?.label ?? app;
    const f = this.deps.fetch ?? ((u, i) => fetch(u, i));
    return createApiClient({
      url: (path) => p.url(path),
      // the provider sets Authorization itself; the client's own store stays empty so nothing is sent twice
      tokens: memoryTokens(`${app}:none`),
      fetch: async (url, init) => {
        if (p instanceof BackendProvider && p.needsCsrf(init.method ?? 'GET')) await p.check();
        return f(url, p.prepare(init));
      },
      messages: {
        unauthorized: p.scheme === 'bearer' ? STANDARD_MESSAGES.unauthorized(label) : `Sign in to ${label} first.`,
        unavailable: STANDARD_MESSAGES.unavailable(`${label}'s API`),
        unreachable: `Can't reach ${label} from Molly.`,
      },
      preferDetail: true,
    });
  }
}

/** Every Molly app has a backend entry and every entry names a Molly app: the two lists stay in step. */
export function backendErrors(apps: readonly { id: string }[] = MOLLY_APPS, backends: readonly AppBackend[] = MOLLY_BACKENDS): string[] {
  const out: string[] = [];
  for (const a of apps) if (!backends.some((b) => b.app === a.id)) out.push(`app ${a.id} has no backend entry`);
  for (const b of backends) {
    if (!apps.some((a) => a.id === b.app)) out.push(`backend ${b.app} is not a Molly app`);
    if (normalizeApiBase(b.apiBase) !== b.apiBase) out.push(`backend ${b.app}: apiBase must be https with no query, fragment or trailing slash`);
    if (b.scheme === 'bearer' && !b.tokenKey) out.push(`backend ${b.app}: a bearer backend needs a tokenKey`);
    if (b.scheme !== 'none' && !b.whoami) out.push(`backend ${b.app}: needs a whoami path`);
    if (b.scheme === 'none' && b.whoami) out.push(`backend ${b.app}: a backend without sign-in has no whoami`);
  }
  return out;
}

/* ================================================================== status, the systems check way */

/** A connection's status in the systems check's words: ok, warn (sign in), error (can't reach), unknown (not checked). */
export type ConnectionStatus = 'ok' | 'warn' | 'error' | 'unknown';
export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = { ok: 'OK', warn: 'Sign in', error: "Can't reach", unknown: 'Not checked' };

export function connectionStatus(c: AppConnection): ConnectionStatus {
  if (c.state === 'signed-in' || c.state === 'none') return 'ok';
  if (c.state === 'signed-out') return 'warn';
  if (c.state === 'unreachable') return 'error';
  return 'unknown';
}

/** Counts per status and the issues first (error, warn, unknown, ok), app order kept within each. */
export function connectionSummary(cs: readonly AppConnection[]): { counts: Record<ConnectionStatus, number>; issues: number; ordered: AppConnection[] } {
  const rank: Record<ConnectionStatus, number> = { error: 0, warn: 1, unknown: 2, ok: 3 };
  const counts: Record<ConnectionStatus, number> = { ok: 0, warn: 0, error: 0, unknown: 0 };
  for (const c of cs) counts[connectionStatus(c)]++;
  const ordered = cs.map((c, i) => ({ c, i })).sort((a, b) => rank[connectionStatus(a.c)] - rank[connectionStatus(b.c)] || a.i - b.i).map((x) => x.c);
  return { counts, issues: counts.error + counts.warn, ordered };
}

/** What a connection offers right now (the screen's buttons and the actions agree on this). */
export function connectionOffers(c: AppConnection, b: AppBackend | undefined = backendOf(c.app)): { token: boolean; signInPage: boolean; signOut: boolean; check: boolean } {
  if (c.scheme === 'none' || !b) return { token: false, signInPage: false, signOut: false, check: false };
  return {
    token: !!b.tokenKey,
    signInPage: !!c.signInUrl,
    signOut: c.hasToken || (c.scheme === 'session' && !!b.signOut && c.state === 'signed-in'),
    check: true,
  };
}

/** One line per connection, the way the status action and the CLI say it. */
export function connectionLine(c: AppConnection): string {
  const state = c.state === 'signed-in' ? `signed in${c.who ? ` as ${c.who}` : ''}` : c.state === 'none' ? 'no sign-in' : c.state.replace('-', ' ');
  const how = c.scheme === 'none' ? '' : c.hasToken ? ' (token)' : c.scheme === 'session' ? ' (session)' : ' (no token)';
  return `${c.label}: ${state}${how}${c.detail ? ` · ${c.detail}` : ''}`;
}
