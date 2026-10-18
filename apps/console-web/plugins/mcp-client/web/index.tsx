import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Container, Icon, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import './mcp-client.css';

/*
 * MCP client: connects the console to other MCP servers over Streamable HTTP. Servers (URL + how to
 * authenticate) are managed in Settings → Plugins → MCP servers and stored by the server part; tokens never reach the
 * browser. The MCP view browses a server's tools, resources and prompts and calls tools with JSON arguments.
 * Everything a remote server returns is shown as text.
 */

const FOLDER = 'mcp-client';
const ID = 'ai.amberx.axf.console.mcp-client';

interface Server { id: string; name: string; url: string; description: string; tokenEnv: string; auth: 'env' | 'token' | 'none'; envPresent: boolean; createdAt: string; lastCheck?: { at: string; ok: boolean; tools: number } | null }
interface Tool { name: string; title?: string; description?: string; inputSchema?: JsonSchema; annotations?: Record<string, unknown> }
interface Resource { uri: string; name?: string; title?: string; description?: string; mimeType?: string }
interface Prompt { name: string; title?: string; description?: string; arguments?: { name: string; description?: string; required?: boolean }[] }
interface Connected { server?: { name?: string; version?: string; title?: string } | null; instructions: string; protocol?: string | null; tools: Tool[]; resources: Resource[]; prompts: Prompt[]; resourcesError?: string; promptsError?: string }
interface JsonSchema { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; default?: unknown; description?: string; enum?: unknown[]; items?: JsonSchema }
interface ContentItem { type: string; text?: string; mimeType?: string; data?: string; uri?: string; resource?: { uri?: string; text?: string; mimeType?: string } }
interface CallResult { isError: boolean; content: ContentItem[]; structured?: unknown }
interface LogRow { at: string; server: string; op: string; ok: boolean; ms: number; detail: string }

/* ---------------- API ---------------- */

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (r.status === 401) throw new Error('Console token required (Home → Console token).');
  if (r.status === 404 && !j.detail) throw new Error('The MCP client plugin is disabled or its server part is not running.');
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? r.statusText));
  return j;
}
const post = <T,>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

/* ---------------- server list store (shared by the view and the settings panel) ---------------- */

let servers: Server[] | undefined;
let loadError = '';
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
async function reloadServers() {
  try { servers = (await call<{ items: Server[] }>('servers')).items; loadError = ''; } catch (e) { servers = servers ?? []; loadError = (e as Error).message; }
  emit();
}
function useServers() {
  useEffect(() => { if (servers === undefined) void reloadServers(); }, []);
  const list = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => servers, () => servers);
  return { list, error: loadError };
}

/* ---------------- helpers ---------------- */

const fmt = (v?: string) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const typeOf = (s?: JsonSchema) => { const t = s?.type; return Array.isArray(t) ? t[0] : t; };

/** A starting argument object from a tool's input schema: defaults, else an empty value for required fields. */
function skeleton(schema?: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(schema?.properties ?? {})) {
    if (p.default !== undefined) out[k] = p.default;
    else if (schema?.required?.includes(k)) {
      const t = typeOf(p);
      out[k] = p.enum?.length ? p.enum[0] : t === 'number' || t === 'integer' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : t === 'object' ? {} : '';
    }
  }
  return out;
}

/* ---------------- the MCP view ---------------- */

function McpView() {
  const rt = useRuntime();
  const { list, error } = useServers();
  const [sid, setSid] = useState<string>('');
  const [conn, setConn] = useState<Connected | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [tab, setTab] = useState<'tools' | 'resources' | 'prompts' | 'log'>('tools');
  const [q, setQ] = useState('');
  const [tool, setTool] = useState<Tool | null>(null);
  const log = (t: string, l: 'info' | 'ok' | 'warn' | 'error' = 'info') => rt.terminal.log('mcp-client', t, l);

  useEffect(() => { const first = list?.[0]; if (!sid && first) setSid(first.id); }, [list, sid]);
  const server = list?.find((s) => s.id === sid);

  const connect = async () => {
    if (!sid) return;
    setBusy(true); setProblem(''); setConn(null); setTool(null);
    try {
      const c = await post<Connected>(`servers/${sid}/connect`, {});
      setConn(c);
      log(`${server?.name}: connected — ${c.tools.length} tools, ${c.resources.length} resources, ${c.prompts.length} prompts`, 'ok');
      void reloadServers();
    } catch (e) { setProblem((e as Error).message); log((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  useEffect(() => { setConn(null); setTool(null); setProblem(''); }, [sid]);

  const tools = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (conn?.tools ?? []).filter((t) => !needle || `${t.name} ${t.title ?? ''} ${t.description ?? ''}`.toLowerCase().includes(needle));
  }, [conn, q]);

  if (list === undefined) return <div className="fx-empty">Loading MCP servers…</div>;

  return (
    <div className="fx-stack fx-stack--lg axp-mcp-client">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Plugin · MCP client · {list.length} server{list.length === 1 ? '' : 's'}</p>
          <h1>MCP servers</h1>
          <p className="fx-muted">Connect to other MCP servers, browse what they offer and call their tools. Add or edit servers in Settings → Plugins → MCP servers.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="settings" onClick={() => rt.dispatch('settings.open:mcp')}>Manage servers</Button>
        </div>
      </header>

      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}

      {list.length === 0 ? (
        <Container title="No servers yet" icon="cloud">
          <p className="fx-muted" style={{ marginTop: 0 }}>Add a Streamable HTTP MCP server (for example your axHub at https://axhub.amberxai.com/mcp) with a token kept on the console server.</p>
          <Button tone="primary" icon="plus" onClick={() => rt.dispatch('settings.open:mcp')}>Add a server</Button>
        </Container>
      ) : (
        <>
          <div className="axp-mcp-client__bar">
            <label className="axp-mcp-client__field">Server
              <select className="fx-input" value={sid} onChange={(e) => setSid(e.target.value)}>
                {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <Button tone="primary" icon="zap" disabled={busy || !sid} onClick={connect}>{busy ? 'Connecting…' : conn ? 'Reconnect' : 'Connect'}</Button>
            {server && <span className="fx-small fx-muted fx-mono axp-mcp-client__url">{server.url}</span>}
          </div>

          {problem && <div className="pl-note is-warn" role="alert"><Icon name="alert" size={14} />{problem}</div>}

          {conn && (
            <>
              <div className="axp-mcp-client__summary">
                <Chip tone="success">connected</Chip>
                {conn.server?.name && <span><strong>{conn.server.title || conn.server.name}</strong> {conn.server.version}</span>}
                {conn.protocol && <span className="fx-small fx-muted">protocol {conn.protocol}</span>}
              </div>
              {conn.instructions && <details className="axp-mcp-client__instructions"><summary>Server instructions</summary><p>{conn.instructions}</p></details>}
              <div className="axp-mcp-client__tabs" role="tablist">
                {(['tools', 'resources', 'prompts', 'log'] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} className="axp-mcp-client__tab" onClick={() => setTab(t)}>
                    {({ tools: 'Tools', resources: 'Resources', prompts: 'Prompts', log: 'Call log' } as const)[t]}
                    {t !== 'log' && <span className="fx-muted"> {(conn[t] as unknown[]).length}</span>}
                  </button>
                ))}
              </div>

              {tab === 'tools' && (
                <div className="axp-mcp-client__split">
                  <div className="fx-stack">
                    <input className="fx-input" type="search" placeholder="Filter tools…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter tools" />
                    <div className="axp-mcp-client__list" role="list">
                      {tools.map((t) => (
                        <button key={t.name} role="listitem" className={`axp-mcp-client__item ${tool?.name === t.name ? 'is-active' : ''}`} onClick={() => setTool(t)}>
                          <span className="fx-mono">{t.name}</span>
                          {t.annotations?.readOnlyHint === true && <span className="fx-small fx-muted"> read-only</span>}
                          {t.description && <span className="axp-mcp-client__desc">{t.description}</span>}
                        </button>
                      ))}
                      {tools.length === 0 && <p className="fx-muted fx-small">No tools match.</p>}
                    </div>
                  </div>
                  {tool ? <ToolRunner key={`${sid}:${tool.name}`} sid={sid} tool={tool} log={log} /> : <div className="fx-empty">Pick a tool to see its arguments and call it.</div>}
                </div>
              )}
              {tab === 'resources' && <Resources sid={sid} conn={conn} log={log} />}
              {tab === 'prompts' && (
                <div className="fx-stack">
                  {conn.promptsError && <div className="pl-note is-warn"><Icon name="alert" size={14} />{conn.promptsError}</div>}
                  {conn.prompts.length === 0 ? <p className="fx-muted">This server offers no prompts.</p> : conn.prompts.map((p) => (
                    <div key={p.name} className="axp-mcp-client__card">
                      <strong className="fx-mono">{p.name}</strong>{p.description && <p className="fx-small fx-muted">{p.description}</p>}
                      {p.arguments?.length ? <p className="fx-small">Arguments: {p.arguments.map((a) => `${a.name}${a.required ? '*' : ''}`).join(', ')}</p> : null}
                    </div>
                  ))}
                </div>
              )}
              {tab === 'log' && <CallLog />}
            </>
          )}
        </>
      )}
    </div>
  );
}

function ToolRunner({ sid, tool, log }: { sid: string; tool: Tool; log: (t: string, l?: 'info' | 'ok' | 'warn' | 'error') => void }) {
  const [args, setArgs] = useState(() => JSON.stringify(skeleton(tool.inputSchema), null, 2));
  const [result, setResult] = useState<CallResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const props = Object.entries(tool.inputSchema?.properties ?? {});
  const destructive = tool.annotations?.destructiveHint === true;
  const run = async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(args || '{}'); } catch (e) { setErr(`Arguments are not valid JSON: ${(e as Error).message}`); return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { setErr('Arguments must be a JSON object.'); return; }
    if (destructive && !globalThis.confirm(`${tool.name} is marked destructive by its server. Call it?`)) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await post<CallResult>(`servers/${sid}/call`, { tool: tool.name, arguments: parsed });
      setResult(r); log(`${tool.name}: ${r.isError ? 'tool reported an error' : 'ok'}`, r.isError ? 'warn' : 'ok');
    } catch (e) { setErr((e as Error).message); log((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fx-stack axp-mcp-client__runner">
      <div>
        <h2 className="axp-mcp-client__title fx-mono">{tool.name}</h2>
        {tool.description && <p className="fx-small axp-mcp-client__pre">{tool.description}</p>}
        {destructive && <Chip tone="danger">destructive</Chip>}
      </div>
      {props.length > 0 && (
        <table className="fx-table axp-mcp-client__schema"><tbody>
          {props.map(([k, p]) => (
            <tr key={k}><th className="fx-mono">{k}{tool.inputSchema?.required?.includes(k) ? '*' : ''}</th><td className="fx-small"><span className="fx-muted">{typeOf(p) ?? 'any'}{p.enum ? ` · ${p.enum.map(String).join(' | ')}` : ''}</span>{p.description ? ` — ${p.description}` : ''}</td></tr>
          ))}
        </tbody></table>
      )}
      <label className="axp-mcp-client__field">Arguments (JSON)
        <textarea className="fx-input fx-mono" rows={Math.min(14, Math.max(4, args.split('\n').length + 1))} value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} />
      </label>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="play" disabled={busy} onClick={run}>{busy ? 'Calling…' : 'Call tool'}</Button>
        <Button icon="undo" onClick={() => setArgs(JSON.stringify(skeleton(tool.inputSchema), null, 2))}>Reset arguments</Button>
      </div>
      {err && <div className="pl-note is-warn" role="alert"><Icon name="alert" size={14} />{err}</div>}
      {result && <Output result={result} />}
    </div>
  );
}

function Output({ result }: { result: CallResult }) {
  return (
    <div className="fx-stack">
      <div className="fx-row"><Chip tone={result.isError ? 'danger' : 'success'}>{result.isError ? 'tool error' : 'result'}</Chip></div>
      {result.content.map((c, i) => (
        c.type === 'text' ? <pre key={i} className="axp-mcp-client__out">{c.text}</pre>
          : c.type === 'resource' ? <pre key={i} className="axp-mcp-client__out">{`${c.resource?.uri ?? ''}\n${c.resource?.text ?? '(binary resource)'}`}</pre>
          : <pre key={i} className="axp-mcp-client__out">{`${c.type}${c.mimeType ? ` (${c.mimeType})` : ''}${c.uri ? `: ${c.uri}` : ''}${c.data ? ` · ${c.data.length} base64 chars` : ''}`}</pre>
      ))}
      {result.structured != null && <details><summary className="fx-small">Structured content</summary><pre className="axp-mcp-client__out">{JSON.stringify(result.structured, null, 2)}</pre></details>}
    </div>
  );
}

function Resources({ sid, conn, log }: { sid: string; conn: Connected; log: (t: string, l?: 'info' | 'ok' | 'warn' | 'error') => void }) {
  const [open, setOpen] = useState<{ uri: string; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const read = async (uri: string) => {
    setBusy(uri);
    try {
      const r = await post<{ contents: { uri: string; text?: string; blob?: string; mimeType?: string }[] }>(`servers/${sid}/read`, { uri });
      setOpen({ uri, text: r.contents.map((c) => c.text ?? `(binary ${c.mimeType ?? ''}, ${c.blob?.length ?? 0} base64 chars)`).join('\n\n') });
    } catch (e) { log((e as Error).message, 'error'); setOpen({ uri, text: (e as Error).message }); }
    finally { setBusy(''); }
  };
  return (
    <div className="fx-stack">
      {conn.resourcesError && <div className="pl-note is-warn"><Icon name="alert" size={14} />{conn.resourcesError}</div>}
      {conn.resources.length === 0 ? <p className="fx-muted">This server offers no resources.</p> : conn.resources.map((r) => (
        <div key={r.uri} className="axp-mcp-client__card">
          <div className="fx-row fx-row--wrap"><strong className="fx-grow">{r.title || r.name || r.uri}</strong><Button icon="eye" disabled={busy === r.uri} onClick={() => read(r.uri)}>Read</Button></div>
          <span className="fx-small fx-muted fx-mono">{r.uri}{r.mimeType ? ` · ${r.mimeType}` : ''}</span>
          {r.description && <p className="fx-small">{r.description}</p>}
          {open?.uri === r.uri && <pre className="axp-mcp-client__out">{open.text}</pre>}
        </div>
      ))}
    </div>
  );
}

function CallLog() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const load = () => call<{ items: LogRow[] }>('log').then((r) => setRows(r.items), () => setRows([]));
  useEffect(() => { void load(); }, []);
  if (!rows) return <p className="fx-muted">Loading…</p>;
  return (
    <div className="fx-stack">
      <div><Button icon="refresh" onClick={() => void load()}>Refresh</Button></div>
      {rows.length === 0 ? <p className="fx-muted">No calls yet since the console server started.</p> : (
        <table className="fx-table"><thead><tr><th>When</th><th>Server</th><th>Operation</th><th>Result</th></tr></thead><tbody>
          {rows.map((r, i) => <tr key={i}><td className="fx-small">{fmt(r.at)}</td><td className="fx-mono fx-small">{r.server}</td><td className="fx-mono fx-small">{r.op}</td><td className="fx-small">{r.ok ? `ok · ${r.ms} ms` : <span title={r.detail}>failed · {r.detail}</span>}</td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}

/* ---------------- Settings → Plugins → MCP servers ---------------- */

type Auth = 'none' | 'env' | 'token';
interface Draft { id: string; name: string; url: string; description: string; auth: Auth; tokenEnv: string; token: string }
const blank: Draft = { id: '', name: '', url: '', description: '', auth: 'env', tokenEnv: '', token: '' };

function ServersPanel() {
  const rt = useRuntime();
  const { list, error } = useServers();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const edit = (s: Server) => setDraft({ id: s.id, name: s.name, url: s.url, description: s.description, auth: s.auth, tokenEnv: s.tokenEnv, token: '' });
  const save = async () => {
    if (!draft) return;
    setBusy(true); setMsg('');
    try {
      const body: Record<string, unknown> = { id: draft.id, name: draft.name, url: draft.url, description: draft.description, tokenEnv: draft.auth === 'env' ? draft.tokenEnv.trim() : '' };
      if (draft.auth === 'none') body.token = '';
      else if (draft.auth === 'token' && draft.token) body.token = draft.token; // blank = keep the stored token
      await post('servers', body);
      setDraft(null); await reloadServers(); rt.toast(`Saved ${draft.name}`, 'success');
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async (s: Server) => {
    setBusy(true);
    try { await call(`servers/${s.id}`, { method: 'DELETE' }); setConfirm(''); await reloadServers(); rt.toast(`Removed ${s.name}`, 'success'); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  if (list === undefined) return <p className="fx-muted">Loading…</p>;
  return (
    <div className="fx-stack axp-mcp-client">
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      {list.length === 0 && !draft && <p className="fx-muted" style={{ margin: 0 }}>No MCP servers yet.</p>}
      {list.map((s) => (
        <div key={s.id} className="axp-mcp-client__card">
          <div className="fx-row fx-row--wrap">
            <strong className="fx-grow">{s.name}</strong>
            {s.auth === 'env' && <Chip tone={s.envPresent ? 'success' : 'warning'}>{s.envPresent ? `token from ${s.tokenEnv}` : `${s.tokenEnv} not set`}</Chip>}
            {s.auth === 'token' && <Chip tone="accent">token set</Chip>}
            {s.auth === 'none' && <Chip>no auth</Chip>}
          </div>
          <span className="fx-small fx-muted fx-mono axp-mcp-client__url">{s.url}</span>
          {s.description && <p className="fx-small" style={{ margin: 0 }}>{s.description}</p>}
          <span className="fx-small fx-muted">Added {fmt(s.createdAt)}{s.lastCheck ? ` · last connected ${fmt(s.lastCheck.at)} (${s.lastCheck.tools} tools)` : ''}</span>
          {confirm === s.id ? (
            <div className="fx-row fx-row--wrap">Remove {s.name}? <Button tone="danger" icon="trash" disabled={busy} onClick={() => remove(s)}>Remove</Button><Button onClick={() => setConfirm('')}>Keep</Button></div>
          ) : (
            <div className="fx-row fx-row--wrap"><Button icon="edit" onClick={() => edit(s)}>Edit</Button><Button icon="trash" onClick={() => setConfirm(s.id)}>Remove</Button></div>
          )}
        </div>
      ))}
      {draft ? (
        <form className="axp-mcp-client__card fx-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <strong>{draft.id ? `Edit ${draft.name}` : 'Add an MCP server'}</strong>
          <label className="axp-mcp-client__field">Name<input className="fx-input" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="axHub" /></label>
          <label className="axp-mcp-client__field">Streamable HTTP URL<input className="fx-input fx-mono" required type="url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://axhub.amberxai.com/mcp" /></label>
          <label className="axp-mcp-client__field">Description<input className="fx-input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <label className="axp-mcp-client__field">Authentication
            <select className="fx-input" value={draft.auth} onChange={(e) => setDraft({ ...draft, auth: e.target.value as Auth })}>
              <option value="env">Bearer token from a server environment variable (recommended)</option>
              <option value="token">Bearer token stored on the console server</option>
              <option value="none">None</option>
            </select>
          </label>
          {draft.auth === 'env' && <label className="axp-mcp-client__field">Environment variable<input className="fx-input fx-mono" required pattern="[A-Z_][A-Z0-9_]*" value={draft.tokenEnv} onChange={(e) => setDraft({ ...draft, tokenEnv: e.target.value.toUpperCase() })} placeholder="AXHUB_TOKEN" /></label>}
          {draft.auth === 'token' && <label className="axp-mcp-client__field">Token{draft.id ? ' (leave blank to keep the stored one)' : ''}<input className="fx-input" type="password" autoComplete="off" value={draft.token} onChange={(e) => setDraft({ ...draft, token: e.target.value })} /></label>}
          <p className="fx-small fx-muted" style={{ margin: 0 }}>Tokens stay on the console server and are never sent back to the browser.</p>
          {msg && <div className="pl-note is-warn" role="alert"><Icon name="alert" size={14} />{msg}</div>}
          <div className="fx-row fx-row--wrap"><Button tone="primary" icon="save" disabled={busy} type="submit">Save</Button><Button onClick={() => { setDraft(null); setMsg(''); }}>Cancel</Button></div>
        </form>
      ) : <div><Button tone="primary" icon="plus" onClick={() => setDraft({ ...blank })}>Add a server</Button></div>}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'MCP client',
  version: '0.1.0',
  views: { 'mcp-client': { title: 'MCP servers', icon: 'cloud', render: () => <McpView /> } },
  nav: { label: 'Plugins', items: [{ id: 'mcp-client', label: 'MCP servers', icon: 'cloud', view: 'mcp-client' }] },
  settingsTabs: [{ id: 'mcp', label: 'MCP servers', icon: 'cloud', order: 35, description: 'MCP servers this console connects to as a client. Tokens stay on the console server.' }],
  settingsPanels: [{ id: 'mcp-client.servers', tab: 'mcp', title: 'Servers', icon: 'cloud', order: 10, render: () => <ServersPanel /> }],
};
