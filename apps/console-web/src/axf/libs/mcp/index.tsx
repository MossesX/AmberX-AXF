/**
 * MCP client library (`ai.amberx.axf.mcp`) — any AXF app can be an MCP client.
 *
 * - **MCP servers view** (nav → MCP servers, action `mcp.open`): pick a server, connect, browse its tools, resources
 *   and prompts, call tools with JSON arguments (write tools need `mcp.call.write`, destructive ones `mcp.call.destructive`
 *   and a confirmation first), read resources, get prompts, and see the call log.
 * - **Settings → MCP servers** (`mcp`, panel `mcp.servers`): add / edit / remove servers. Tokens are write-only: the UI
 *   sends them to the host once and never gets them back.
 * - Protocol core: `./client.ts` (`McpClient` over Streamable HTTP, through an `McpTransport` the host implements) and
 *   the pure engine `core/engines/mcp.ts` (framing, SSE, pagination, error codes, the call gate), mirrored by the Kotlin
 *   `lib-mcp` and the Python `axf_libs.mcp`.
 *
 * `createMcpLibrary({ host })` takes an `McpHost` (registry + sessions + log). `localHost()` is the browser-only default;
 * the Dev Console passes a host that proxies to its own server so tokens stay there.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MCP_PERMISSIONS, argumentSkeleton, callGate, contentText, mcpHasPermission, toolEffect, type McpPermissionSet, type McpToolEffect } from '../../core/engines/mcp';
import { Button, Chip, Container, Icon, useAxfState, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import type { McpConnected, McpPrompt, McpResource, McpTool } from './client';
import { describe } from './client';
import { localHost, type McpAuthKind, type McpHost, type McpLogRow, type McpServerRecord, type McpSession } from './host';
import './mcp.css';

export * from '../../core/engines/mcp';
export * from './client';
export * from './host';

export const MCP_LIBRARY_ID = 'ai.amberx.axf.mcp';
export const MCP_VIEW = 'mcp';
export const MCP_SETTINGS_TAB = 'mcp';
const P = 'axf-mcp';

/* ================================================================== server list store (view + settings panel share it) */

class ServerStore {
  servers: McpServerRecord[] | undefined;
  error = '';
  private subs = new Set<() => void>();
  constructor(private host: McpHost) {}
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  get = () => this.servers;
  async reload() {
    try { this.servers = await this.host.registry.list(); this.error = ''; } catch (e) { this.servers = this.servers ?? []; this.error = describe(e); }
    this.subs.forEach((f) => f());
  }
}

function useServers(store: ServerStore) {
  useEffect(() => { if (store.servers === undefined) void store.reload(); }, [store]);
  const list = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { list, error: store.error };
}

const fmt = (v?: string) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const typeOf = (p: { type?: string | string[] }) => (Array.isArray(p.type) ? p.type[0] : p.type);
type Level = 'info' | 'ok' | 'warn' | 'error';
type Schema = { properties?: Record<string, { type?: string | string[]; default?: unknown; enum?: unknown[]; description?: string }>; required?: string[] };

function Note({ tone = 'warn', children }: { tone?: 'warn' | 'danger' | 'info'; children: React.ReactNode }) {
  return <div className={`${P}__note ${tone === 'warn' ? 'is-warn' : tone === 'danger' ? 'is-danger' : ''}`} role="alert"><Icon name="alert" size={14} />{children}</div>;
}

/* ================================================================== the MCP servers view */

function McpView({ host, store, perms }: { host: McpHost; store: ServerStore; perms: McpPermissionSet }) {
  const rt = useRuntime();
  useAxfState(); // re-render on role changes (the call gate reads the role)
  const { list, error } = useServers(store);
  const [sid, setSid] = useState('');
  const [conn, setConn] = useState<McpConnected | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [tab, setTab] = useState<'tools' | 'resources' | 'prompts' | 'log'>('tools');
  const [q, setQ] = useState('');
  const [tool, setTool] = useState<McpTool | null>(null);
  const session = useRef<McpSession | null>(null);
  const log = (t: string, l: Level = 'info') => rt.terminal.log('mcp', t, l);
  const granted = rt.permissions();

  useEffect(() => { const first = list?.[0]; if (!sid && first) setSid(first.id); }, [list, sid]);
  useEffect(() => { void session.current?.close(); session.current = null; setConn(null); setTool(null); setProblem(''); }, [sid]);
  useEffect(() => () => { void session.current?.close(); }, []);
  const server = list?.find((s) => s.id === sid);

  const connect = async () => {
    if (!server) return;
    setBusy(true); setProblem(''); setConn(null); setTool(null);
    try {
      await session.current?.close();
      session.current = host.open(server);
      const c = await session.current.connect();
      setConn(c);
      log(`${server.name}: connected — ${c.tools.length} tools, ${c.resources.length} resources, ${c.prompts.length} prompts`, 'ok');
      await host.registry.touch?.(server.id, { ok: true, tools: c.tools.length });
      void store.reload();
    } catch (e) { setProblem(describe(e)); log(describe(e), 'error'); }
    finally { setBusy(false); }
  };

  const tools = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (conn?.tools ?? []).filter((t) => !needle || `${t.name} ${t.title ?? ''} ${t.description ?? ''}`.toLowerCase().includes(needle));
  }, [conn, q]);

  if (list === undefined) return <div className="fx-empty">Loading MCP servers…</div>;

  return (
    <div className={`fx-stack fx-stack--lg ${P}`}>
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">MCP client · {list.length} server{list.length === 1 ? '' : 's'}</p>
          <h1>MCP servers</h1>
          <p className="fx-muted">Connect to MCP servers over Streamable HTTP, browse what they offer and call their tools. Add or edit servers in Settings → MCP servers.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="settings" onClick={() => rt.dispatch(`settings.open:${MCP_SETTINGS_TAB}`)}>Manage servers</Button>
        </div>
      </header>

      {error && <Note>{error}</Note>}

      {list.length === 0 ? (
        <Container title="No servers yet" icon="cloud">
          <p className="fx-muted" style={{ marginTop: 0 }}>Add a Streamable HTTP MCP server (for example an axHub at https://axhub.amberxai.com/mcp). Credentials are kept by {host.registry.label}, never shown again.</p>
          <Button tone="primary" icon="plus" requires={perms.MANAGE} onClick={() => rt.dispatch(`settings.open:${MCP_SETTINGS_TAB}`)}>Add a server</Button>
        </Container>
      ) : (
        <>
          <div className={`${P}__bar`}>
            <label className={`${P}__field`}>Server
              <select className="fx-input" value={sid} onChange={(e) => setSid(e.target.value)}>
                {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <Button tone="primary" icon="zap" disabled={busy || !sid} onClick={connect}>{busy ? 'Connecting…' : conn ? 'Reconnect' : 'Connect'}</Button>
            {server && <span className={`fx-small fx-muted fx-mono ${P}__url`}>{server.url}</span>}
          </div>

          {problem && <Note>{problem}</Note>}

          {conn && (
            <>
              <div className={`${P}__summary`}>
                <Chip tone="success">connected</Chip>
                {conn.serverInfo?.name && <span><strong>{conn.serverInfo.title || conn.serverInfo.name}</strong> {conn.serverInfo.version}</span>}
                <span className="fx-small fx-muted">protocol {conn.protocolVersion}{conn.sessionId ? ' · session' : ' · stateless'}</span>
              </div>
              {conn.instructions && <details className={`${P}__instructions`}><summary>Server instructions</summary><p>{conn.instructions}</p></details>}
              <div className={`${P}__tabs`} role="tablist">
                {(['tools', 'resources', 'prompts', 'log'] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} className={`${P}__tab`} onClick={() => setTab(t)}>
                    {({ tools: 'Tools', resources: 'Resources', prompts: 'Prompts', log: 'Call log' } as const)[t]}
                    {t !== 'log' && <span className="fx-muted"> {(conn[t] as unknown[]).length}</span>}
                  </button>
                ))}
              </div>

              {tab === 'tools' && (
                <div className={`${P}__split`}>
                  <div className="fx-stack">
                    <input className="fx-input" type="search" placeholder="Filter tools…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter tools" />
                    <div className={`${P}__list`} role="list">
                      {tools.map((t) => {
                        const effect = toolEffect(t.annotations);
                        const gate = callGate(effect, granted, perms);
                        return (
                          <button key={t.name} role="listitem" className={`${P}__item ${tool?.name === t.name ? 'is-active' : ''} ${gate.allowed ? '' : 'is-denied'}`} onClick={() => setTool(t)} title={gate.allowed ? undefined : gate.error?.message}>
                            <span className="fx-mono">{t.name} <span className={`${P}__effect is-${effect}`}>{effect}</span></span>
                            {t.description && <span className={`${P}__desc`}>{t.description}</span>}
                          </button>
                        );
                      })}
                      {tools.length === 0 && <p className="fx-muted fx-small">No tools match.</p>}
                    </div>
                  </div>
                  {tool && session.current ? <ToolRunner key={`${sid}:${tool.name}`} session={session.current} tool={tool} granted={granted} perms={perms} log={log} /> : <div className="fx-empty">Pick a tool to see its arguments and call it.</div>}
                </div>
              )}
              {tab === 'resources' && session.current && <Resources session={session.current} conn={conn} granted={granted} perms={perms} log={log} />}
              {tab === 'prompts' && session.current && <Prompts session={session.current} prompts={conn.prompts} error={conn.promptsError} granted={granted} perms={perms} log={log} />}
              {tab === 'log' && <CallLog host={host} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

function ToolRunner({ session, tool, granted, perms, log }: { session: McpSession; tool: McpTool; granted: Set<string>; perms: McpPermissionSet; log: (t: string, l?: Level) => void }) {
  const schema = tool.inputSchema as Schema | undefined;
  const [args, setArgs] = useState(() => JSON.stringify(argumentSkeleton(schema), null, 2));
  const [result, setResult] = useState<{ isError: boolean; text: string; structured?: unknown } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const props = Object.entries(schema?.properties ?? {});
  const effect: McpToolEffect = toolEffect(tool.annotations);
  const gate = callGate(effect, granted, perms);

  const parse = (): Record<string, unknown> | null => {
    let parsed: unknown;
    try { parsed = JSON.parse(args || '{}'); } catch (e) { setErr(`Arguments are not valid JSON: ${describe(e)}`); return null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { setErr('Arguments must be a JSON object.'); return null; }
    return parsed as Record<string, unknown>;
  };
  const run = async (confirmed = false) => {
    const parsed = parse();
    if (!parsed) return;
    if (!gate.allowed) { setErr(gate.error?.message ?? 'Not allowed'); return; }
    if (gate.confirm && !confirmed) { setConfirming(true); return; }
    setConfirming(false); setBusy(true); setErr(''); setResult(null);
    abort.current = new AbortController();
    try {
      const r = await session.callTool(tool.name, parsed, abort.current.signal);
      setResult({ isError: r.isError, text: contentText(r.content), structured: r.structured });
      log(`${tool.name}: ${r.isError ? 'tool reported an error' : 'ok'}`, r.isError ? 'warn' : 'ok');
    } catch (e) { setErr(describe(e)); log(describe(e), 'error'); }
    finally { setBusy(false); abort.current = null; }
  };
  return (
    <div className={`fx-stack ${P}__runner`}>
      <div>
        <h2 className={`${P}__title fx-mono`}>{tool.title ?? tool.name}</h2>
        {tool.description && <p className={`fx-small ${P}__pre`}>{tool.description}</p>}
        <div className="fx-row fx-row--wrap">
          <Chip tone={effect === 'destructive' ? 'danger' : effect === 'write' ? 'warning' : 'success'}>{effect}</Chip>
          {!gate.allowed && <Chip tone="danger">needs {gate.requires}</Chip>}
        </div>
      </div>
      {props.length > 0 && (
        <table className={`fx-table ${P}__schema`}><tbody>
          {props.map(([k, p]) => (
            <tr key={k}><th className="fx-mono">{k}{schema?.required?.includes(k) ? '*' : ''}</th><td className="fx-small"><span className="fx-muted">{typeOf(p) ?? 'any'}{p.enum ? ` · ${p.enum.map(String).join(' | ')}` : ''}</span>{p.description ? ` — ${p.description}` : ''}</td></tr>
          ))}
        </tbody></table>
      )}
      <label className={`${P}__field`}>Arguments (JSON)
        <textarea className="fx-input fx-mono" rows={Math.min(14, Math.max(4, args.split('\n').length + 1))} value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} />
      </label>
      {confirming ? (
        <div className={`${P}__card ${P}__confirm fx-stack`}>
          <strong>{tool.name} is marked destructive by its server.</strong>
          <p className="fx-small">It may delete or irreversibly change something. Call it with these arguments?</p>
          <div className="fx-row fx-row--wrap"><Button tone="danger" icon="play" onClick={() => void run(true)}>Call it</Button><Button onClick={() => setConfirming(false)}>Keep</Button></div>
        </div>
      ) : (
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="play" disabled={busy || !gate.allowed} onClick={() => void run()}>{busy ? 'Calling…' : 'Call tool'}</Button>
          {busy && <Button icon="x" onClick={() => abort.current?.abort()}>Cancel</Button>}
          <Button icon="undo" onClick={() => setArgs(JSON.stringify(argumentSkeleton(schema), null, 2))}>Reset arguments</Button>
        </div>
      )}
      {err && <Note>{err}</Note>}
      {result && (
        <div className="fx-stack">
          <div className="fx-row"><Chip tone={result.isError ? 'danger' : 'success'}>{result.isError ? 'tool error' : 'result'}</Chip></div>
          <pre className={`${P}__out`}>{result.text || '(no content)'}</pre>
          {result.structured != null && <details><summary className="fx-small">Structured content</summary><pre className={`${P}__out`}>{JSON.stringify(result.structured, null, 2)}</pre></details>}
        </div>
      )}
    </div>
  );
}

function Resources({ session, conn, granted, perms, log }: { session: McpSession; conn: McpConnected; granted: Set<string>; perms: McpPermissionSet; log: (t: string, l?: Level) => void }) {
  const [open, setOpen] = useState<{ uri: string; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const may = mcpHasPermission(granted, perms.CALL);
  const read = async (uri: string) => {
    setBusy(uri);
    try {
      const r = await session.readResource(uri);
      setOpen({ uri, text: r.map((c) => c.text ?? `(binary ${c.mimeType ?? ''}, ${c.blob?.length ?? 0} base64 chars)`).join('\n\n') });
    } catch (e) { log(describe(e), 'error'); setOpen({ uri, text: describe(e) }); }
    finally { setBusy(''); }
  };
  const row = (r: McpResource) => (
    <div key={r.uri} className={`${P}__card`}>
      <div className="fx-row fx-row--wrap"><strong className="fx-grow">{r.title || r.name || r.uri}</strong><Button icon="eye" disabled={busy === r.uri || !may} requires={perms.CALL} onClick={() => read(r.uri)}>Read</Button></div>
      <span className={`fx-small fx-muted fx-mono ${P}__url`}>{r.uri}{r.mimeType ? ` · ${r.mimeType}` : ''}</span>
      {r.description && <p className="fx-small">{r.description}</p>}
      {open?.uri === r.uri && <pre className={`${P}__out`}>{open.text}</pre>}
    </div>
  );
  return (
    <div className="fx-stack">
      {conn.resourcesError && <Note>{conn.resourcesError}</Note>}
      {conn.resources.length === 0 && conn.resourceTemplates.length === 0 ? <p className="fx-muted">This server offers no resources.</p> : conn.resources.map(row)}
      {conn.resourceTemplates.map((t) => (
        <div key={t.uriTemplate} className={`${P}__card`}>
          <strong>{t.title || t.name || t.uriTemplate} <span className="fx-small fx-muted">template</span></strong>
          <span className={`fx-small fx-muted fx-mono ${P}__url`}>{t.uriTemplate}</span>
          {t.description && <p className="fx-small">{t.description}</p>}
        </div>
      ))}
    </div>
  );
}

function Prompts({ session, prompts, error, granted, perms, log }: { session: McpSession; prompts: McpPrompt[]; error?: string; granted: Set<string>; perms: McpPermissionSet; log: (t: string, l?: Level) => void }) {
  const [open, setOpen] = useState<{ name: string; text: string } | null>(null);
  const [args, setArgs] = useState<Record<string, Record<string, string>>>({});
  const may = mcpHasPermission(granted, perms.CALL);
  const get = async (p: McpPrompt) => {
    try {
      const r = await session.getPrompt(p.name, args[p.name] ?? {});
      setOpen({ name: p.name, text: `${r.description ? `${r.description}\n\n` : ''}${r.messages.map((m) => `[${m.role}] ${contentText([m.content])}`).join('\n\n')}` });
    } catch (e) { log(describe(e), 'error'); setOpen({ name: p.name, text: describe(e) }); }
  };
  return (
    <div className="fx-stack">
      {error && <Note>{error}</Note>}
      {prompts.length === 0 ? <p className="fx-muted">This server offers no prompts.</p> : prompts.map((p) => (
        <div key={p.name} className={`${P}__card`}>
          <div className="fx-row fx-row--wrap"><strong className="fx-mono fx-grow">{p.title ?? p.name}</strong><Button icon="eye" disabled={!may} requires={perms.CALL} onClick={() => void get(p)}>Get</Button></div>
          {p.description && <p className="fx-small fx-muted">{p.description}</p>}
          {p.arguments?.map((a) => (
            <label key={a.name} className={`${P}__field`}>{a.name}{a.required ? '*' : ''}{a.description ? ` — ${a.description}` : ''}
              <input className="fx-input" value={args[p.name]?.[a.name] ?? ''} onChange={(e) => setArgs({ ...args, [p.name]: { ...(args[p.name] ?? {}), [a.name]: e.target.value } })} />
            </label>
          ))}
          {open?.name === p.name && <pre className={`${P}__out`}>{open.text}</pre>}
        </div>
      ))}
    </div>
  );
}

function CallLog({ host }: { host: McpHost }) {
  const [rows, setRows] = useState<McpLogRow[] | null>(null);
  const load = () => host.log.list().then(setRows, () => setRows([]));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <p className="fx-muted">Loading…</p>;
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap"><Button icon="refresh" onClick={() => void load()}>Refresh</Button>{host.log.clear && <Button icon="trash" onClick={() => host.log.clear?.().then(load)}>Clear</Button>}</div>
      {rows.length === 0 ? <p className="fx-muted">No calls yet.</p> : (
        <table className="fx-table"><thead><tr><th>When</th><th>Server</th><th>Operation</th><th>Result</th></tr></thead><tbody>
          {rows.map((r, i) => <tr key={i}><td className="fx-small">{fmt(r.at)}</td><td className="fx-mono fx-small">{r.server}</td><td className="fx-mono fx-small">{r.op}</td><td className="fx-small">{r.ok ? `ok · ${r.ms} ms` : <span title={r.detail}>failed · {r.detail}</span>}</td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}

/* ================================================================== Settings → MCP servers */

interface Draft { id: string; name: string; url: string; description: string; auth: McpAuthKind; tokenEnv: string; token: string }
const blank: Draft = { id: '', name: '', url: '', description: '', auth: 'token', tokenEnv: '', token: '' };

function ServersPanel({ host, store, envAuth, perms }: { host: McpHost; store: ServerStore; envAuth: boolean; perms: McpPermissionSet }) {
  const rt = useRuntime();
  useAxfState();
  const { list, error } = useServers(store);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const manage = rt.can(perms.MANAGE);
  const edit = (s: McpServerRecord) => setDraft({ id: s.id, name: s.name, url: s.url, description: s.description, auth: s.auth, tokenEnv: s.tokenEnv, token: '' });
  const save = async () => {
    if (!draft) return;
    setBusy(true); setMsg('');
    try {
      const input: Parameters<typeof host.registry.save>[0] = { id: draft.id, name: draft.name, url: draft.url, description: draft.description, tokenEnv: draft.auth === 'env' ? draft.tokenEnv.trim() : '' };
      if (draft.auth === 'none') input.token = '';
      else if (draft.auth === 'token' && draft.token) input.token = draft.token; // blank = keep the stored token
      await host.registry.save(input);
      setDraft(null); await store.reload(); rt.toast(`Saved ${draft.name}`, 'success');
    } catch (e) { setMsg(describe(e)); }
    finally { setBusy(false); }
  };
  const remove = async (s: McpServerRecord) => {
    setBusy(true);
    try { await host.registry.remove(s.id); setConfirm(''); await store.reload(); rt.toast(`Removed ${s.name}`, 'success'); }
    catch (e) { setMsg(describe(e)); }
    finally { setBusy(false); }
  };
  if (list === undefined) return <p className="fx-muted">Loading…</p>;
  return (
    <div className={`fx-stack ${P}`}>
      {error && <Note>{error}</Note>}
      {!manage && <Note tone="info">Your role can view servers; adding or changing them needs {perms.MANAGE}.</Note>}
      {list.length === 0 && !draft && <p className="fx-muted" style={{ margin: 0 }}>No MCP servers yet.</p>}
      {list.map((s) => (
        <div key={s.id} className={`${P}__card`}>
          <div className="fx-row fx-row--wrap">
            <strong className="fx-grow">{s.name}</strong>
            {s.auth === 'env' && <Chip tone={s.envPresent ? 'success' : 'warning'}>{s.envPresent ? `token from ${s.tokenEnv}` : `${s.tokenEnv} not set`}</Chip>}
            {s.auth === 'token' && <Chip tone="accent">token set</Chip>}
            {s.auth === 'none' && <Chip>no auth</Chip>}
          </div>
          <span className={`fx-small fx-muted fx-mono ${P}__url`}>{s.url}</span>
          {s.description && <p className="fx-small" style={{ margin: 0 }}>{s.description}</p>}
          <span className="fx-small fx-muted">Added {fmt(s.createdAt)}{s.lastCheck ? ` · last connected ${fmt(s.lastCheck.at)} (${s.lastCheck.tools} tools)` : ''}</span>
          {confirm === s.id ? (
            <div className="fx-row fx-row--wrap">Remove {s.name}? <Button tone="danger" icon="trash" disabled={busy} onClick={() => remove(s)}>Remove</Button><Button onClick={() => setConfirm('')}>Keep</Button></div>
          ) : (
            <div className="fx-row fx-row--wrap"><Button icon="edit" requires={perms.MANAGE} onClick={() => edit(s)}>Edit</Button><Button icon="trash" requires={perms.MANAGE} onClick={() => setConfirm(s.id)}>Remove</Button></div>
          )}
        </div>
      ))}
      {draft ? (
        <form className={`${P}__card fx-stack`} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <strong>{draft.id ? `Edit ${draft.name}` : 'Add an MCP server'}</strong>
          <label className={`${P}__field`}>Name<input className="fx-input" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="axHub" /></label>
          <label className={`${P}__field`}>Streamable HTTP URL<input className="fx-input fx-mono" required type="url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://axhub.amberxai.com/mcp" /></label>
          <label className={`${P}__field`}>Description<input className="fx-input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <label className={`${P}__field`}>Authentication
            <select className="fx-input" value={draft.auth} onChange={(e) => setDraft({ ...draft, auth: e.target.value as McpAuthKind })}>
              {envAuth && <option value="env">Bearer token from an environment variable on the server (recommended)</option>}
              <option value="token">Bearer token kept by {host.registry.label}</option>
              <option value="none">None</option>
            </select>
          </label>
          {draft.auth === 'env' && <label className={`${P}__field`}>Environment variable<input className="fx-input fx-mono" required pattern="[A-Z_][A-Z0-9_]*" value={draft.tokenEnv} onChange={(e) => setDraft({ ...draft, tokenEnv: e.target.value.toUpperCase() })} placeholder="AXHUB_TOKEN" /></label>}
          {draft.auth === 'token' && <label className={`${P}__field`}>Token{draft.id ? ' (leave blank to keep the stored one)' : ''}<input className="fx-input" type="password" autoComplete="off" value={draft.token} onChange={(e) => setDraft({ ...draft, token: e.target.value })} /></label>}
          <p className="fx-small fx-muted" style={{ margin: 0 }}>Tokens are write-only: kept by {host.registry.label} and never shown again.</p>
          {msg && <Note>{msg}</Note>}
          <div className="fx-row fx-row--wrap"><Button tone="primary" icon="save" disabled={busy} type="submit">Save</Button><Button onClick={() => { setDraft(null); setMsg(''); }}>Cancel</Button></div>
        </form>
      ) : <div><Button tone="primary" icon="plus" requires={perms.MANAGE} onClick={() => setDraft({ ...blank, auth: envAuth ? 'env' : 'token' })}>Add a server</Button></div>}
    </div>
  );
}

/* ================================================================== the library */

export interface McpLibraryOptions {
  host?: McpHost;
  /** offer "token from an environment variable" (only hosts with a server can honour it) */
  envAuth?: boolean;
  /** nav section label; the items go under it (the console puts library views under "Plugins") */
  navLabel?: string;
  /** settings tab order (default 35) */
  settingsOrder?: number;
  /** map the four MCP permissions onto the app's own policy (default: `mcp.servers.manage`, `mcp.call`, `mcp.call.write`, `mcp.call.destructive`) */
  permissions?: Partial<McpPermissionSet>;
}

export function createMcpLibrary(o: McpLibraryOptions = {}): AxfWebLibrary {
  const host = o.host ?? localHost();
  const store = new ServerStore(host);
  const envAuth = o.envAuth ?? false;
  const perms: McpPermissionSet = { ...MCP_PERMISSIONS, ...(o.permissions ?? {}) };
  return {
    id: MCP_LIBRARY_ID,
    label: 'MCP client',
    version: '0.2.0',
    provides: ['axf.remote.mcp'],
    register(rt) {
      rt.actions.register('mcp.open', () => rt.navigate(MCP_VIEW), { label: 'MCP servers', searchable: true });
      rt.actions.register('mcp.reload', () => { void store.reload(); }, { label: 'Reload MCP servers' });
    },
    views: { [MCP_VIEW]: { title: 'MCP servers', icon: 'cloud', keywords: ['mcp', 'tools', 'model context protocol', 'axhub'], render: () => <McpView host={host} store={store} perms={perms} /> } },
    nav: { label: o.navLabel ?? 'Connect', items: [{ id: MCP_VIEW, label: 'MCP servers', icon: 'cloud', view: MCP_VIEW }] },
    settingsTabs: [{ id: MCP_SETTINGS_TAB, label: 'MCP servers', icon: 'cloud', order: o.settingsOrder ?? 35, description: `MCP servers this app connects to as a client. Credentials are kept by ${host.registry.label}.` }],
    settingsPanels: [{ id: 'mcp.servers', tab: MCP_SETTINGS_TAB, title: 'Servers', icon: 'cloud', order: 10, render: () => <ServersPanel host={host} store={store} envAuth={envAuth} perms={perms} /> }],
  };
}

/** The library with the browser-only host (tokens forgotten on reload unless the app passes a secret store). */
export const library: AxfWebLibrary = createMcpLibrary();
