/* Settings → Plugins → Systems check: AI switches (with what's missing + install links), the saved AI routine, banners. */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, SelectField, Switch, useRuntime } from '@console/axf/react';
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

interface ClaudeJob { id: string; state: 'asking' | 'waiting' | 'launched' | 'failed'; message: string; title?: string; changeId?: string; branch?: string; startedAt?: number }
interface ClaudeState { on: boolean; shell: boolean; hubToken: boolean; mosses?: boolean; mossesWhy?: string; changes: boolean; jobs: Record<string, ClaudeJob> }

/** Claude on failure: hand a failed fix to headless Claude Code on the VPS (through axHub, approved per launch). */
export function ClaudePanel() {
  const rt = useRuntime();
  const [s, setS] = useState<ClaudeState | null>(null);
  const [err, setErr] = useState('');
  const load = () => call<ClaudeState>('claude').then((x) => { setS(x); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); const t = setInterval(() => void load(), 10_000); return () => clearInterval(t); }, []);
  if (err) return <p className="axp-systems-check-bad">{err}</p>;
  if (!s) return <p className="fx-muted">Loading…</p>;
  const save = async (patch: Partial<Record<'claudeOnFail' | 'claudeShell', boolean>>) => {
    try { await call('settings', { method: 'PUT', body: JSON.stringify(patch) }); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const jobs = Object.values(s.jobs).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return (
    <div className="fx-stack">
      <Switch label="Hand failed fixes to Mosses (Claude Code on the VPS)" checked={s.on} onChange={(v) => void save({ claudeOnFail: v })}
        hint="When an Auto fix, a console fix or a Fix all item fails, it's handed to Mosses (every Auto fix goes through him), who asks axHub to start headless Claude Code (Opus) on the VPS with the check's details, on its own branch fix/syscheck-<check>. Nothing starts until you approve it on axHub. It shows in the building banner while it works." />
      <Switch label="Let it run shell commands on the VPS" checked={s.shell} disabled={!s.on} onChange={(v) => void save({ claudeShell: v })}
        hint="Off: it can read and edit files only, and ends with the commands for you to run. On: it may run commands on the VPS as root (each launch still needs your approval). Never pushes to main or merges." />
      {s.mosses === false && <p className="fx-small axp-systems-check-bad"><Icon name="alert" size={12} /> {s.mossesWhy} Every Auto fix goes through Mosses.</p>}
      {s.on && !s.hubToken && <p className="fx-small axp-systems-check-bad"><Icon name="alert" size={12} /> Needs the axHub token (Keys needed → axHub connection) to start anything.</p>}
      {s.on && !s.changes && <p className="fx-small fx-muted"><Icon name="info" size={12} /> The Codebase changes plugin is off, so the session won’t show in the building banner (Activity still shows the launch).</p>}
      {jobs.length > 0 && (
        <ul className="axp-systems-check-routine">
          {jobs.map((j) => (
            <li key={j.id}>
              <Chip tone={j.state === 'launched' ? 'success' : j.state === 'failed' ? 'danger' : 'warning'}>{j.state}</Chip> <strong>{j.title ?? j.id}</strong>
              <span className="fx-muted"> · {j.message}</span>
              {j.branch && <span className="fx-mono fx-small"> · {j.branch}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="fx-row fx-row--wrap">
        <Button icon="hammer" onClick={() => rt.dispatch('build-manager.open')}>Open the Build manager</Button>
      </div>
    </div>
  );
}

export function BannersPanel() {
  const rt = useRuntime();
  const [on, setOn] = useState<boolean | null>(null);
  const [wn, setWn] = useState<{ head: string; canClear?: boolean; seen?: { at: number; by?: string } | null } | null>(null);
  useEffect(() => { void call<AiState>('ai').then((x) => setOn(x.settings.whatsNewBanner !== false), () => setOn(true)); }, []);
  useEffect(() => { void call<{ head: string; canClear?: boolean; seen?: { at: number; by?: string } | null }>('whats-new').then(setWn, () => setWn(null)); }, []);
  if (on === null) return <p className="fx-muted">Loading…</p>;
  const flip = async (v: boolean) => { await call('settings', { method: 'PUT', body: JSON.stringify({ whatsNewBanner: v }) }); setOn(v); void loadWhatsNew(); };
  const reset = async () => {
    if (!wn?.head) return;
    try {
      const r = await call<{ seen: { at: number; by?: string } }>('whats-new/seen', { method: 'POST', body: JSON.stringify({ head: wn.head }) });
      setWn({ ...wn, seen: r.seen }); rt.toast('What’s new cleared for everyone', 'success'); void loadWhatsNew();
    } catch (e) { rt.toast(`Couldn’t clear: ${(e as Error).message}`, 'danger'); }
  };
  return (
    <div className="fx-stack">
      <label className="axp-systems-check-switch">
        <input type="checkbox" checked={on} onChange={(e) => void flip(e.target.checked)} />
        <span className="axp-systems-check-switch__text"><strong>Show What’s new when the console loads</strong><span className="fx-small fx-muted">Changes since an admin last cleared it: commits on the console’s clone and plugins added, updated or removed. Everyone sees the same list; only an admin can clear it.</span></span>
      </label>
      <div className="fx-row fx-row--wrap">
        <Button icon="shield" onClick={() => rt.openDialog('system-check', {})}>Open the systems check</Button>
        {wn?.canClear && <Button tone="ghost" icon="check" onClick={() => void reset()}>Clear What’s new for everyone</Button>}
      </div>
      {wn?.seen?.at ? <p className="fx-small fx-muted">Last cleared {new Date(wn.seen.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}{wn.seen.by ? ` by ${wn.seen.by}` : ''}.{wn.canClear ? '' : ' Only an admin can clear it.'}</p> : null}
    </div>
  );
}

/* ---------------- Fix it yourself (Oct 30 2026): auto-fix per check, the GitHub route, the history ---------------- */

interface AutoFix { id: string; label: string; owner: string; mode: 'auto' | 'ask' | 'off'; default: 'auto' | 'ask' | 'off' }
interface FixEntry { at: number; check: string; title: string; label: string; state: 'done' | 'started' | 'failed'; message: string; by: string; mitigated?: boolean }
interface Health { autoFixes: AutoFix[]; history: FixEntry[] }
interface GitHubRoute { ok: boolean; route: 'hub' | 'local'; login?: string; why?: string; local: boolean }

const MODES = [{ value: 'auto', label: 'On: fix it first, then tell me' }, { value: 'ask', label: 'Ask first (show the Auto fix button)' }, { value: 'off', label: 'Off' }];

export function AutoFixPanel() {
  const [h, setH] = useState<Health | null>(null);
  const [g, setG] = useState<GitHubRoute | null>(null);
  const [err, setErr] = useState('');
  const load = () => Promise.all([call<Health>('health').then(setH), call<GitHubRoute>('github').then(setG)]).then(() => setErr(''), (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  if (err) return <p className="axp-systems-check-bad">{err}</p>;
  if (!h || !g) return <p className="fx-muted">Loading…</p>;
  const mode = async (id: string, v: string) => { try { await call('settings', { method: 'PUT', body: JSON.stringify({ autoFix: { [id]: v } }) }); await load(); } catch (e) { setErr((e as Error).message); } };
  const route = async (v: string) => { try { setG(await call<GitHubRoute>('github', { method: 'PUT', body: JSON.stringify({ route: v }) })); } catch (e) { setErr((e as Error).message); } };
  const test = async () => { try { setG(await call<GitHubRoute>('github?refresh=1')); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>When a check turns red and it has a fix the console can run, the fix runs first (commands on the VPS go as a veto call you can stop on the countdown), the check runs again, and only what's still broken shows red and reaches your phone.</p>
      <SelectField label="GitHub route (github@1)" value={g.route} onChange={(v) => void route(v)}
        options={[{ value: 'hub', label: 'Through axHub first, local token as fallback' }, { value: 'local', label: 'Local GITHUB_TOKEN first, axHub as fallback' }]}
        hint={g.ok ? `GitHub through axHub works${g.login ? ` (as ${g.login})` : ''}. The hub's GitHub token stays in the hub vault.` : `GitHub through axHub doesn't work right now: ${g.why ?? 'no answer'}.`} />
      <div className="fx-row fx-row--wrap"><Button icon="refresh" onClick={() => void test()}>Test the hub route</Button>
        <Chip tone={g.ok ? 'success' : 'danger'}>{g.ok ? 'axHub route ok' : 'axHub route down'}</Chip><Chip tone={g.local ? undefined : 'warning'}>{g.local ? 'local token set' : 'no local token'}</Chip></div>
      {h.autoFixes.map((f) => (
        <SelectField key={f.id} label={`${f.id}: ${f.label}`} value={f.mode} options={MODES} onChange={(v) => void mode(f.id, v)} hint={f.default !== 'auto' ? `Default: ${MODES.find((m) => m.value === f.default)?.label ?? f.default}.` : undefined} />
      ))}
      {h.history.length > 0 && (
        <>
          <h4 className="axp-systems-check-h">Auto-fix history</h4>
          <ul className="axp-systems-check-routine">
            {h.history.slice(0, 20).map((e) => (
              <li key={`${e.at}-${e.check}`}>
                <Chip tone={e.state === 'done' ? 'success' : e.state === 'failed' ? 'danger' : 'warning'}>{e.mitigated ? 'worked around' : e.state}</Chip> <strong>{e.title}</strong>
                <span className="fx-muted"> · {e.message} · {new Date(e.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
