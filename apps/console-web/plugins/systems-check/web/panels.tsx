/* Settings → Plugins → Systems check: AI switches (with what's missing + install links), the saved AI routine, banners. */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import * as api from '@console/api';
import { loadSystemCheck, refreshRoutine } from './SystemCheck';
import { loadWhatsNew } from './WhatsNew';

interface Provider { folder: string; name: string; tab: string | null; loaded: boolean; enabled: boolean }
interface Req { ok: boolean; assistant: { ok: boolean; ready: boolean; providers: Provider[] }; mosses: { ok: boolean; agentManager: boolean; providers: Provider[]; name?: string } }
interface AiState { requirements: Req; settings: { ai: { systems: boolean; whatsnew: boolean }; whatsNewBanner: boolean }; effective: { systems: boolean; whatsnew: boolean } }
interface RoutineCheck { id: string; kind: string; title: string; severity: string; why?: string; params: Record<string, unknown> }
interface Routine { source: string; agent?: string; model?: string; generatedAt: number; head?: string; checks: RoutineCheck[]; rejected?: string[]; seconds?: number }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const t = api.getToken();
  if (t) headers.set('authorization', `Bearer ${t}`);
  if (init.body) headers.set('content-type', 'application/json');
  const r = await fetch(`/api/plugins/systems-check/${path}`, { ...init, headers, cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string };
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : r.statusText);
  return j;
}

/** One missing requirement, with the link that fixes it. */
function Need({ what, providers, extra }: { what: string; providers: Provider[]; extra?: { label: string; tab: string } }) {
  const rt = useRuntime();
  const p = providers[0];
  return (
    <div className="axp-systems-check-need__row">
      <Icon name="alert" size={14} />
      <span className="fx-grow">{what}</span>
      {extra ? <Button icon="download" onClick={() => rt.dispatch(`settings.open:${extra.tab}`)}>{extra.label}</Button>
        : p ? <Button icon="download" onClick={() => rt.dispatch(`settings.open:${p.enabled && p.loaded && p.tab ? p.tab : 'plugins'}`)}>{p.enabled ? `Set up ${p.name}` : `Install ${p.name}`}</Button>
          : <span className="fx-small fx-muted">No plugin in this console provides it yet.</span>}
    </div>
  );
}

interface TestResult { ok: boolean; agent?: string; model?: string; profile?: string; ms?: number; reply?: string; error?: string }

/** "Test AI connection": one tiny request through the AI assistant, as Mosses (the same path the AI switches use). */
function AiTest({ disabled, why }: { disabled: boolean; why: string }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<TestResult | null>(null);
  const run = async () => {
    setBusy(true); setR(null);
    try { setR(await call<TestResult>('ai/test', { method: 'POST' })); }
    catch (e) { setR({ ok: false, error: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <div className="axp-systems-check-aitest">
      <div className="fx-row fx-row--wrap">
        <Button icon="zap" disabled={disabled || busy} onClick={() => void run()}>{busy ? 'Testing…' : 'Test AI connection'}</Button>
        {disabled && <span className="fx-small fx-muted">{why}</span>}
        {!disabled && !r && !busy && <span className="fx-small fx-muted">Sends one tiny message through the AI assistant as Mosses, the way the AI switches do.</span>}
        {r && <Chip tone={r.ok ? 'success' : 'danger'}>{r.ok ? 'connected' : 'failed'}</Chip>}
      </div>
      {r && (
        <dl aria-live="polite">
          {r.agent && <><dt>Agent</dt><dd>{r.agent}</dd></>}
          {r.model && <><dt>Model</dt><dd className="fx-mono">{r.model}</dd></>}
          {r.profile && <><dt>Provider</dt><dd>{r.profile}</dd></>}
          {r.ms != null && <><dt>Time</dt><dd>{(r.ms / 1000).toFixed(1)} s</dd></>}
          {r.reply && <><dt>Reply</dt><dd>{r.reply}</dd></>}
          {r.error && <><dt>Error</dt><dd className="axp-systems-check-bad">{r.error}</dd></>}
        </dl>
      )}
    </div>
  );
}

export function AiPanel() {
  const [s, setS] = useState<AiState | null>(null);
  const [err, setErr] = useState('');
  const load = () => call<AiState>('ai').then((x) => { setS(x); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  if (err) return <p className="axp-systems-check-bad">{err}</p>;
  if (!s) return <p className="fx-muted">Loading…</p>;
  const req = s.requirements;
  const flip = async (k: 'systems' | 'whatsnew', on: boolean) => {
    try {
      await call('settings', { method: 'PUT', body: JSON.stringify({ ai: { [k]: on } }) });
      await load();
      if (k === 'systems') void loadSystemCheck(true); else void loadWhatsNew();
    } catch (e) { setErr((e as Error).message); }
  };
  const missing = !req.ok;
  const agentManager = req.mosses.providers[0];
  const sw = (k: 'systems' | 'whatsnew', title: string, text: string) => (
    <label className={`axp-systems-check-switch ${missing ? 'is-off' : ''}`}>
      <input type="checkbox" disabled={missing} checked={!missing && s.settings.ai[k]} onChange={(e) => void flip(k, e.target.checked)} aria-describedby={missing ? 'syscheck-ai-needs' : undefined} />
      <span className="axp-systems-check-switch__text"><strong>{title}</strong><span className="fx-small fx-muted">{text}</span></span>
      {!missing && <Chip tone={s.effective[k] ? 'success' : undefined}>{s.effective[k] ? 'on' : 'off'}</Chip>}
    </label>
  );
  return (
    <div className="axp-systems-check-ai">
      {missing && (
        <div className="axp-systems-check-need" id="syscheck-ai-needs">
          <strong>AI needs the AI assistant and the Mosses agent. Missing:</strong>
          {!req.assistant.ok && <Need what="The AI assistant (provides models: axf.llm@1)" providers={req.assistant.providers} />}
          {!req.mosses.ok && (req.mosses.agentManager
            ? <Need what="Mosses, the coding agent (the agent manager's “coder” add-on)" providers={req.mosses.providers}
                extra={agentManager?.tab ? { label: 'Install Mosses (Add-on agents)', tab: agentManager.tab } : undefined} />
            : <Need what="The agent manager with Mosses (provides agents: axf.agents@1)" providers={req.mosses.providers} />)}
        </div>
      )}
      {!missing && !req.assistant.ready && <p className="fx-small fx-muted"><Icon name="info" size={12} /> The AI assistant has no provider with a working key yet; AI runs will fail until one is set up.</p>}
      {sw('systems', 'Use AI for the systems check', `${req.mosses.name ?? 'Mosses'} reads the codebase and adds checks, saved as a routine. When AI is off, the saved routine still runs, with no model. Refreshed when the code changes.`)}
      {sw('whatsnew', 'Use AI for What’s new', `${req.mosses.name ?? 'Mosses'} writes a plain-English summary of what changed since your last visit. Summaries are saved, so they stay when AI is off.`)}
      <AiTest disabled={missing} why="Install what's missing above to test the connection." />
      <p className="fx-small fx-muted">Without AI, the checks come from reading the codebase: every plugin, the services it needs and its own declared self-checks, every project manifest and the shared data files, plus the built-in checks.</p>
    </div>
  );
}

export function RoutinePanel() {
  const [r, setR] = useState<{ routine: Routine | null; stale: boolean } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => call<{ routine: Routine | null; stale: boolean }>('routine').then(setR, (e: Error) => setMsg(e.message));
  useEffect(() => { void load(); }, []);
  const run = async () => { setBusy(true); setMsg('Mosses is reading the codebase…'); await refreshRoutine(); setMsg(''); setBusy(false); void load(); };
  const clear = async () => { await call('routine', { method: 'DELETE' }); void load(); void loadSystemCheck(true); };
  const rt = r?.routine;
  return (
    <div className="fx-stack">
      {!rt ? <p className="fx-small fx-muted">No AI routine saved yet. Turn on “Use AI for the systems check”, then run it.</p> : (
        <>
          <p className="fx-small">
            {rt.checks.length} checks by {rt.agent ?? 'Mosses'}{rt.model ? ` (${rt.model})` : ''}, {new Date(rt.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            {rt.head ? <> for commit <span className="fx-mono">{rt.head.slice(0, 7)}</span></> : null}{r?.stale ? ' · the code has changed since' : ''}
          </p>
          <ul className="axp-systems-check-routine">
            {rt.checks.map((c) => <li key={c.id}><Chip tone={c.severity === 'error' ? 'danger' : c.severity === 'warn' ? 'warning' : undefined}>{c.kind}</Chip> <strong>{c.title}</strong>{c.why ? <span className="fx-muted"> · {c.why}</span> : null}</li>)}
          </ul>
          {!!rt.rejected?.length && <details><summary className="fx-small">{rt.rejected.length} proposals rejected (wrong format)</summary><ul className="axp-systems-check-routine">{rt.rejected.map((x) => <li key={x}>{x}</li>)}</ul></details>}
        </>
      )}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="sparkles" disabled={busy} onClick={() => void run()}>{busy ? 'Running…' : rt ? 'Run again with AI' : 'Run with AI'}</Button>
        {rt && <Button tone="ghost" icon="trash" disabled={busy} onClick={() => void clear()}>Delete the routine</Button>}
        {msg && <span className="fx-small">{msg}</span>}
      </div>
      <p className="fx-small fx-muted">The routine is data, never code: only env, file, json, service, plugin and https checks exist, and each is validated before it’s saved.</p>
    </div>
  );
}

export function BannersPanel() {
  const rt = useRuntime();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { void call<AiState>('ai').then((x) => setOn(x.settings.whatsNewBanner !== false), () => setOn(true)); }, []);
  if (on === null) return <p className="fx-muted">Loading…</p>;
  const flip = async (v: boolean) => { await call('settings', { method: 'PUT', body: JSON.stringify({ whatsNewBanner: v }) }); setOn(v); void loadWhatsNew(); };
  const reset = () => { try { localStorage.removeItem('axf-console:whats-new'); } catch { /* blocked */ } rt.toast('This browser starts counting changes from now', 'success'); void loadWhatsNew(); };
  return (
    <div className="fx-stack">
      <label className="axp-systems-check-switch">
        <input type="checkbox" checked={on} onChange={(e) => void flip(e.target.checked)} />
        <span className="axp-systems-check-switch__text"><strong>Show What’s new when the console loads</strong><span className="fx-small fx-muted">Changes since this browser last opened the console: commits on the console’s clone and plugins added, updated or removed.</span></span>
      </label>
      <div className="fx-row fx-row--wrap">
        <Button icon="shield" onClick={() => rt.openDialog('system-check', {})}>Open the systems check</Button>
        <Button tone="ghost" icon="refresh" onClick={reset}>Mark everything seen in this browser</Button>
      </div>
    </div>
  );
}
