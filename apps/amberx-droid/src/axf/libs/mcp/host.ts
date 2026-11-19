/**
 * The host contract of the MCP client library: what an app gives the library so its views can list servers, open
 * sessions and keep a call log, without the UI ever holding a credential.
 *
 *   registry   server records (ids, names, URLs, how each authenticates) — never the token itself
 *   open(id)   a session for one server; the host decides whether that is a direct `McpClient` with a credential
 *              provider (a browser-only app, tokens in its secure store) or a proxy to its own server (the Dev
 *              Console: tokens stay on the console server)
 *   log        the call log (local by default, the host's own when it keeps one server-side)
 *
 * `localHost()` is the default for apps without a server: records in localStorage, secrets in a store the app
 * supplies (`McpSecretStore`), sessions through `fetchTransport`.
 */
import { MCP_WIRE, serverIdFor, validateServerInput, wire } from '../../core/engines/mcp';
import { McpClient, McpError, fetchTransport, type McpCallResult, type McpConnected, type McpCredentialProvider, type McpPromptResult, type McpResourceContents, type McpTransport } from './client';

/* ================================================================== server records */

export type McpAuthKind = 'none' | 'env' | 'token';

/** What UI code may see about a server. Never the token. */
export interface McpServerRecord {
  id: string;
  name: string;
  url: string;
  description: string;
  /** how the host authenticates: nothing, a bearer token from an environment variable on the host, or a stored token */
  auth: McpAuthKind;
  tokenEnv: string;
  /** for `env`: whether the host currently has that variable */
  envPresent?: boolean;
  createdAt: string;
  lastCheck?: { at: string; ok: boolean; tools: number } | null;
}

export interface McpServerInput {
  /** empty = new server (id made from the name) */
  id?: string;
  name: string;
  url: string;
  description?: string;
  /** bearer token from this environment variable on the host (preferred where the host has one) */
  tokenEnv?: string;
  /** undefined = keep the stored token; '' = clear it; a value = store it (write-only) */
  token?: string | null;
}

export interface McpServerRegistry {
  /** short words for the settings page ("this browser", "the console server") */
  label: string;
  list(): Promise<McpServerRecord[]>;
  save(input: McpServerInput): Promise<McpServerRecord>;
  remove(id: string): Promise<void>;
  /** record the outcome of a connect (shown in the list) */
  touch?(id: string, check: { ok: boolean; tools: number }): Promise<void>;
}

/* ================================================================== sessions and the log */

/** The operations the views need from one connected server; `McpClient` satisfies it. */
export interface McpSession {
  connect(signal?: AbortSignal): Promise<McpConnected>;
  callTool(name: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>;
  readResource(uri: string, signal?: AbortSignal): Promise<McpResourceContents[]>;
  getPrompt(name: string, args?: Record<string, string>, signal?: AbortSignal): Promise<McpPromptResult>;
  close(): Promise<void>;
}

export interface McpLogRow { at: string; server: string; op: string; ok: boolean; ms: number; detail: string }
export interface McpCallLog {
  list(): Promise<McpLogRow[]>;
  add?(row: McpLogRow): void;
  clear?(): Promise<void>;
}

export interface McpHost {
  registry: McpServerRegistry;
  open(server: McpServerRecord): McpSession;
  log: McpCallLog;
  /** per-call timeout the host applies (shown in the UI) */
  timeoutMs?: number;
}

/** A bounded in-memory call log (newest first). */
export function memoryLog(max = 200): McpCallLog {
  const rows: McpLogRow[] = [];
  return {
    list: async () => rows.slice(),
    add: (row) => { rows.unshift({ ...row, detail: row.detail.slice(0, 300) }); if (rows.length > max) rows.length = max; },
    clear: async () => { rows.length = 0; },
  };
}

/* ================================================================== local host (apps without a server) */

/** Where a browser-only app keeps tokens. Implement it over the platform's secure store; `memorySecrets` forgets on reload. */
export interface McpSecretStore {
  get(serverId: string): Promise<string | null>;
  set(serverId: string, token: string | null): Promise<void>;
}

export function memorySecrets(): McpSecretStore {
  const m = new Map<string, string>();
  return { get: async (id) => m.get(id) ?? null, set: async (id, t) => { if (t) m.set(id, t); else m.delete(id); } };
}

interface StoredServer { id: string; name: string; url: string; description: string; tokenEnv: string; hasToken: boolean; createdAt: string; lastCheck?: McpServerRecord['lastCheck'] }

/** Server records in localStorage (`mcp-servers@1`), tokens in `secrets`, never in the records. */
export function localRegistry(secrets: McpSecretStore, storageKey = 'axf:mcp-servers'): McpServerRegistry {
  const read = (): StoredServer[] => { try { const raw = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? 'null') as { servers?: StoredServer[] } | null; return Array.isArray(raw?.servers) ? raw.servers : []; } catch { return []; } };
  const write = (servers: StoredServer[]) => { try { globalThis.localStorage?.setItem(storageKey, JSON.stringify({ $axf: 'mcp-servers@1', servers })); } catch { /* storage blocked */ } };
  const pub = (s: StoredServer): McpServerRecord => ({ id: s.id, name: s.name, url: s.url, description: s.description, tokenEnv: s.tokenEnv, auth: s.tokenEnv ? 'env' : s.hasToken ? 'token' : 'none', envPresent: false, createdAt: s.createdAt, lastCheck: s.lastCheck ?? null });
  return {
    label: 'this browser',
    list: async () => read().map(pub).sort((a, b) => a.name.localeCompare(b.name)),
    async save(input) {
      const problems = validateServerInput(input);
      if (problems.length) throw new McpError(wire(MCP_WIRE.VALIDATION, problems.join('; ')));
      const servers = read();
      const id = input.id || serverIdFor(input.name, servers.map((s) => s.id));
      const old = servers.find((s) => s.id === id);
      const rec: StoredServer = { id, name: input.name.trim(), url: input.url.trim(), description: (input.description ?? '').trim(), tokenEnv: input.tokenEnv ?? '', hasToken: old?.hasToken ?? false, createdAt: old?.createdAt ?? new Date().toISOString(), lastCheck: old?.lastCheck ?? null };
      if (input.token !== undefined && input.token !== null) { await secrets.set(id, input.token || null); rec.hasToken = !!input.token; }
      if (rec.tokenEnv) { await secrets.set(id, null); rec.hasToken = false; }
      write(old ? servers.map((s) => (s.id === id ? rec : s)) : [...servers, rec]);
      return pub(rec);
    },
    async remove(id) { await secrets.set(id, null); write(read().filter((s) => s.id !== id)); },
    async touch(id, check) { write(read().map((s) => (s.id === id ? { ...s, lastCheck: { at: new Date().toISOString(), ...check } } : s))); },
  };
}

/** Credentials for `fetchTransport` from a secret store: a stored token becomes `Bearer …`; `env` has no meaning in a browser. */
export function secretCredentials(secrets: McpSecretStore): McpCredentialProvider {
  return { authorization: async (id) => { const t = await secrets.get(id); return t ? `Bearer ${t}` : null; } };
}

export interface LocalHostOptions { secrets?: McpSecretStore; storageKey?: string; transport?: McpTransport; timeoutMs?: number; log?: McpCallLog }

/** Everything in this browser: records in localStorage, tokens in `secrets`, direct Streamable HTTP sessions. */
export function localHost(o: LocalHostOptions = {}): McpHost {
  const secrets = o.secrets ?? memorySecrets();
  const registry = localRegistry(secrets, o.storageKey);
  const log = o.log ?? memoryLog();
  const transport = o.transport ?? fetchTransport(secretCredentials(secrets));
  return {
    registry, log, timeoutMs: o.timeoutMs,
    open: (server) => new McpClient({ serverId: server.id, url: server.url, transport, timeoutMs: o.timeoutMs, onCall: (op, ok, ms, detail) => log.add?.({ at: new Date().toISOString(), server: server.id, op, ok, ms, detail: detail ?? '' }) }),
  };
}
