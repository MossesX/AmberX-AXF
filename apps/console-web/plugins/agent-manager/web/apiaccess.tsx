/*
 * Per-agent console API control (agent-api-access@1, Nov 10 2026). Brett: "I want the individual agents and the AI
 * assistant to have API access, not all of them, just a couple. I need to be able to give it to them in their employee
 * control panel. Give Amber and Molly control by default."
 *
 *  - ApiControlPanel   one employee's switch + scopes + why + reset + audit (agent editor, the API control tab)
 *  - ApiControlTab     every employee (Amber = the AI assistant, the agents, the crew) with its grant
 *  - ApiControlChip    the grant on the Crew employee cards (slot `swarm.agent.actions`), with a quick switch
 * Everything here is also the REST API (GET/PUT /api/plugins/agent-manager/api-access[/{id}], POST …/{id}/reset,
 * GET …/api-access/audit), so plugin commands, MCP, the CLI and voice reach the same thing.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Switch, TextField, useRuntime } from '@console/axf/react';
import { LoadingSkeleton } from '@console/emptyState';
import { call, fmtTime, post, put } from './api';

export type ApiScope = 'screens' | 'settings' | 'commands' | 'builds';
export interface ApiGrant { agent: string; on: boolean; scopes: ApiScope[]; default: boolean; by: string; at: number; note: string }
export interface ApiAudit { at: number; agent: string; by: string; source: string; from: { on: boolean; scopes: ApiScope[] }; to: { on: boolean; scopes: ApiScope[] }; reason: string }
export interface ApiScopeInfo { id: ApiScope; label: string; hint: string }
export interface ApiRow { id: string; name: string; kind: 'assistant' | 'agent' | 'crew'; role: string; grant: ApiGrant; summary: string; lastChange: ApiAudit | null }
interface One { grant: ApiGrant; summary: string; audit: ApiAudit[]; scopes?: ApiScopeInfo[] }

/** Window event the agent-manager.api-control action sends (an agent id or ''): the view opens its API control tab. */
export const API_EVENT = 'axf-agent-manager:api-control';
let pendingAgent: string | null = null;
/** The agent the API control tab should open on (set by the deep link before the view mounts). */
export const takePendingApiAgent = () => { const a = pendingAgent; pendingAgent = null; return a; };
export const openApiControl = (agent: string) => { pendingAgent = agent; window.dispatchEvent(new CustomEvent(API_EVENT, { detail: agent })); };

const KIND_LABEL: Record<ApiRow['kind'], string> = { assistant: 'AI assistant', agent: 'Agent', crew: 'Crew' };
const scopeText = (scopes: ApiScope[], all: ApiScopeInfo[]) => (scopes.length === all.length && all.length ? 'full' : all.filter((s) => scopes.includes(s.id)).map((s) => s.label.toLowerCase()).join(', '));
const auditLine = (a: ApiAudit, all: ApiScopeInfo[]) =>
  `${a.to.on ? `on (${scopeText(a.to.scopes, all)})` : 'off'} ← ${a.from.on ? `on (${scopeText(a.from.scopes, all)})` : 'off'} · by ${a.by}${a.source && a.source !== 'console' ? ` via ${a.source}` : ''}${a.reason ? ` · ${a.reason}` : ''}`;

/** One employee's API control: the switch, its scopes, why, reset to default, and the audit trail. */
export function ApiControlPanel({ agentId, name, onChanged }: { agentId: string; name: string; onChanged?: () => void }) {
  const rt = useRuntime();
  const [one, setOne] = useState<One | null>(null);
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => call<One>(`api-access/${encodeURIComponent(agentId)}`).then((r) => { setOne(r); setScopes(r.grant.on ? r.grant.scopes : (r.scopes ?? []).map((s) => s.id)); }), [agentId]);
  useEffect(() => { setOne(null); setWhy(''); void load().catch((e: Error) => rt.toast(e.message, 'danger')); }, [load, rt]);
  if (!one) return <LoadingSkeleton />;
  const all = one.scopes ?? [];
  const apply = async (on: boolean, picked: ApiScope[]) => {
    setBusy(true);
    try {
      const r = await put<One>(`api-access/${encodeURIComponent(agentId)}`, { on, scopes: on ? picked : [], reason: why.trim(), source: 'console' });
      setOne({ ...r, scopes: all }); setWhy(''); onChanged?.();
      rt.toast(`${name}: API control ${r.summary}`, 'success');
    } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { const r = await post<One>(`api-access/${encodeURIComponent(agentId)}/reset`, { reason: why.trim(), source: 'console' }); setOne({ ...r, scopes: all }); setScopes(r.grant.on ? r.grant.scopes : all.map((s) => s.id)); setWhy(''); onChanged?.(); }
    catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); }
  };
  const g = one.grant;
  const dirty = g.on && (scopes.length !== g.scopes.length || scopes.some((s) => !g.scopes.includes(s)));
  return (
    <section className="axp-agent-manager__card axp-agent-manager__api fx-stack" aria-label={`API control for ${name}`}>
      <Switch label="API control" checked={g.on} disabled={busy} onChange={(on) => void apply(on, scopes.length ? scopes : all.map((s) => s.id))}
        hint={g.on ? `${name} can drive the console through its API: ${scopeText(g.scopes, all)}.` : `${name} can't open screens, change settings, run commands or file builds through the console API.`} />
      <div className="axp-agent-manager__picks" role="group" aria-label="What API control covers">
        {all.map((s) => <Checkbox key={s.id} label={s.label} title={s.hint} checked={scopes.includes(s.id)} disabled={busy || !g.on} onChange={(v) => setScopes(v ? [...scopes, s.id] : scopes.filter((x) => x !== s.id))} />)}
      </div>
      <TextField label="Why (kept in the audit)" value={why} onChange={setWhy} placeholder="Optional" />
      <div className="axp-agent-manager__row">
        {dirty && <Button tone="primary" icon="save" busy={busy} disabled={!scopes.length} onClick={() => void apply(true, scopes)}>Save scopes</Button>}
        <Button icon="undo" disabled={busy || g.default} title="Amber and Molly are on by default, everyone else off" onClick={() => void reset()}>Reset to default</Button>
        <Chip tone={g.on ? 'success' : undefined}>{g.default ? 'default' : `set by ${g.by}${g.at ? ` · ${fmtTime(g.at)}` : ''}`}</Chip>
      </div>
      {one.audit.length > 0 && (
        <details>
          <summary className="fx-small">Changes ({one.audit.length})</summary>
          <ul className="axp-agent-manager__api-audit">{one.audit.map((a, i) => <li key={i} className="fx-small"><span className="fx-muted">{fmtTime(a.at)}</span> {auditLine(a, all)}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

/** Every employee and its API control; pick one to change it. */
export function ApiControlTab({ initial }: { initial?: string }) {
  const rt = useRuntime();
  const [rows, setRows] = useState<ApiRow[] | null>(null);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [sel, setSel] = useState(initial || 'amber');
  const load = useCallback(() => call<{ agents: ApiRow[]; defaults: string[] }>('api-access').then((r) => { setRows(r.agents); setDefaults(r.defaults); }), []);
  useEffect(() => { void load().catch((e: Error) => rt.toast(e.message, 'danger')); }, [load, rt]);
  useEffect(() => { const on = (e: Event) => setSel(String((e as CustomEvent).detail || 'amber')); window.addEventListener(API_EVENT, on); return () => window.removeEventListener(API_EVENT, on); }, []);
  if (!rows) return <LoadingSkeleton />;
  const row = rows.find((r) => r.id === sel) ?? rows[0];
  const on = rows.filter((r) => r.grant.on).length;
  return (
    <section className="axp-agent-manager__split">
      <div className="axp-agent-manager__list fx-stack">
        <div className="axp-agent-manager__row"><strong className="fx-grow">API control ({on} of {rows.length} on)</strong></div>
        <p className="fx-small fx-muted">Who may drive the console through its API. Off by default; {defaults.map((d) => rows.find((r) => r.id === d)?.name ?? d).join(' and ')} on until you change them.</p>
        {rows.map((r) => (
          <button key={r.id} type="button" data-fx-row className={`axp-agent-manager__item${row?.id === r.id ? ' is-active' : ''}`} onClick={() => setSel(r.id)}>
            <strong>{r.name}<Chip tone={r.grant.on ? 'success' : undefined}>{r.grant.on ? 'API on' : 'off'}</Chip></strong>
            <span className="fx-small fx-muted">{KIND_LABEL[r.kind]}{r.role ? ` · ${r.role}` : ''} · {r.summary}</span>
          </button>
        ))}
      </div>
      <div className="axp-agent-manager__editor fx-stack">
        {row && <><h3 className="axp-agent-manager__h">{row.name}</h3><ApiControlPanel key={row.id} agentId={row.id} name={row.name} onChanged={() => void load()} /></>}
      </div>
    </section>
  );
}

/** On a Crew employee card (slot `swarm.agent.actions`): the grant, its last change, and a quick switch. */
export function ApiControlChip({ agentId, name }: { agentId: string; name: string }) {
  const rt = useRuntime();
  const [one, setOne] = useState<One | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (agentId) void call<One>(`api-access/${encodeURIComponent(agentId)}`).then(setOne, () => setOne(null)); }, [agentId]);
  if (!one) return null;
  const last = one.audit[0];
  const flip = async (on: boolean) => {
    setBusy(true);
    try { const r = await put<One>(`api-access/${encodeURIComponent(agentId)}`, { on, reason: 'from the employee card', source: 'employee-card' }); setOne(r); rt.toast(`${name}: API control ${r.summary}`, 'success'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); }
  };
  return (
    <div className="axp-agent-manager__row axp-agent-manager__api-chip">
      <Switch label={`API control for ${name}`} hideLabel checked={one.grant.on} disabled={busy} onChange={(v) => void flip(v)} text={`API ${one.summary}`} />
      {last && <span className="fx-small fx-muted" title={last.reason}>changed {fmtTime(last.at)} by {last.by}</span>}
      <Button size="sm" tone="quiet" icon="shield" onClick={() => { openApiControl(agentId); rt.navigate('agent-manager'); }}>Scopes…</Button>
    </div>
  );
}
