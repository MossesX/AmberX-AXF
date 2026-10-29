import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import './session-checkin.css';
import { appMenu } from './menu';
import { LoadingSkeleton } from '@console/emptyState';

/** Plugin folder: server routes live at /api/plugins/session-checkin/. */
const FOLDER = 'session-checkin';
const ID = 'ai.amberx.axf.console.session-checkin';
const P = 'axp-session-checkin';

/* ---------------- types (mirror lib.mjs / install.mjs) ---------------- */

type Target = 'local' | 'shared' | 'user';
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type ModelKey = 'fable' | 'opus' | 'sonnet';
interface Question { id: string; label: string; help: string; required?: boolean }
interface Config {
  questions: Record<string, boolean>; sources: string[]; allowSkip: boolean; allowSameAsLast: boolean; unattended: 'log' | 'off';
  expected: { repo: string; project: string; vpsContainer: string }; archive: string; memoryDirs: string[]; defaultEffort: Effort;
}
interface TargetStatus { label: string; settings: string; installed: boolean; config: Config | null }
interface Status { version: string; targets: Record<Target, TargetStatus>; questions: Question[]; defaults: Config; archive: { roots: string[] }; repo: string; terminal: string }
interface Summary { id: string; startedAt: string; location: string; repo: string; branch: string; head: string; project: string; model: string; effort: string; usd: number | null; unattended: boolean; skipped: boolean; flags: string[]; status: 'ok' | 'flag' | 'mismatch' | 'none'; ended: string | null }
interface Estimate { usd: number | null; calibrated: boolean; runs?: number; pricesAsOf?: string | null; stale?: boolean }
interface Baseline { version: string; pricing: { asOf?: string; source?: string; models: Partial<Record<ModelKey, { input: number; output: number; cacheRead?: number }>> }; runs: unknown[]; estimates: Record<ModelKey, Record<Effort, Estimate>> }

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODELS: [ModelKey, string][] = [['fable', 'Fable 5.1'], ['opus', 'Opus 5.5'], ['sonnet', 'Sonnet 5.5']];
const LOCATIONS: Record<string, string> = { vps: 'VPS terminal', cloud: 'Cloud container', desktop: 'Desktop / laptop', console: 'Console server', 'claude-ai': 'claude.ai' };
const modelLabel = (m: string) => MODELS.find(([k]) => k === m)?.[1] ?? (m || '—');
const money = (e?: Estimate) => (!e || e.usd == null ? '—' : `$${e.usd.toFixed(e.usd < 1 ? 3 : 2)}`);

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string; error?: string };
  if (!r.ok) throw new Error(j.detail ?? j.error ?? (r.status === 401 ? 'Set the console token (Settings → Account & security) first.' : r.statusText));
  return j;
}
const post = <T,>(path: string, body: unknown) => getJson<T>(path, { method: 'POST', body: JSON.stringify(body) });

function useStatus() {
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const load = () => getJson<Status>('status').then((s) => { setSt(s); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  return { st, err, reload: load };
}
const installedTargets = (st: Status | null) => (st ? (Object.entries(st.targets) as [Target, TargetStatus][]).filter(([, v]) => v.installed).map(([k]) => k) : []);

/* ================================================================== Sessions view */

type Filter = 'all' | 'vps' | 'cloud' | 'desktop' | 'mismatch' | 'unattended';
const FILTERS: [Filter, string][] = [['all', 'All'], ['vps', 'VPS'], ['cloud', 'Cloud'], ['desktop', 'Desktop'], ['mismatch', 'Mismatches'], ['unattended', 'Unattended']];

function SessionsView() {
  const rt = useRuntime();
  const { st } = useStatus();
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [base, setBase] = useState<Baseline | null>(null);
  const load = () => {
    getJson<{ sessions: Summary[] }>('sessions?limit=500').then((j) => { setRows(j.sessions); setErr(''); }, (e: Error) => setErr(e.message));
    getJson<Baseline>('baseline').then(setBase, () => setBase(null));
  };
  useEffect(load, []);
  const shown = useMemo(() => (rows ?? []).filter((r) => filter === 'all' || (filter === 'mismatch' ? r.status === 'mismatch' || r.status === 'flag' : filter === 'unattended' ? r.unattended : r.location === filter)), [rows, filter]);
  const mismatches = (rows ?? []).filter((r) => r.status === 'mismatch' || r.status === 'flag').length;
  const usual = useMemo(() => {
    const picks = (rows ?? []).filter((r) => !r.unattended && r.model && r.effort);
    const top = <T extends string>(xs: T[]) => xs.sort((a, b) => xs.filter((x) => x === b).length - xs.filter((x) => x === a).length)[0];
    return { model: (top(picks.map((r) => r.model as ModelKey)) ?? 'opus') as ModelKey, effort: (top(picks.map((r) => r.effort as Effort)) ?? 'high') as Effort };
  }, [rows]);
  const installed = installedTargets(st);

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Session archive{rows ? ` · ${rows.length} session${rows.length === 1 ? '' : 's'}` : ''}</p>
          <h1>Sessions</h1>
          <p className="fx-muted">Every session check-in, newest first. Pick one to see what was detected, what was picked and what the baseline build costs.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={load}>Refresh</Button>
          <Button icon="settings" onClick={() => rt.dispatch('settings.open:session-checkin')}>Check-in settings</Button>
        </div>
      </header>

      {st && installed.length === 0 && (
        <div className={`${P}__notice`} role="status">
          <Icon name="info" />
          <span className="fx-grow">The check-in isn't installed yet, so new sessions don't ask the questions. Install it from its settings.</span>
          <Button tone="primary" icon="download" onClick={() => rt.dispatch('settings.open:session-checkin')}>Install…</Button>
        </div>
      )}
      {err && <p className={`${P}__error`}>{err}</p>}

      <div className={`${P}__tiles`}>
        <div className={`${P}__tile`}><strong>{rows?.length ?? '…'}</strong><span>sessions</span></div>
        <div className={`${P}__tile`}><strong className={mismatches ? 'is-warning' : ''}>{rows ? mismatches : '…'}</strong><span>flagged</span></div>
        <div className={`${P}__tile`}><strong>{money(base?.estimates?.[usual.model]?.[usual.effort])}</strong><span>baseline, {modelLabel(usual.model)} · {usual.effort}</span></div>
      </div>

      <div className={`${P}__filters`} role="group" aria-label="Filter sessions">
        {FILTERS.map(([id, label]) => <button key={id} type="button" className={`fx-chip ${filter === id ? 'is-on' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
      </div>

      {rows && shown.length === 0 && <p className="fx-muted">{rows.length ? 'No sessions match this filter.' : 'No check-ins archived yet. They appear here after the next new Claude Code session with the check-in installed.'}</p>}
      {shown.length > 0 && (
        <div className={`${P}__list`} role="list">
          {shown.map((r) => (
            <div key={r.id} role="listitem">
              <button type="button" data-fx-row className={`${P}__row ${sel === r.id ? 'is-selected' : ''}`} onClick={() => setSel(sel === r.id ? null : r.id)} aria-expanded={sel === r.id}>
                <span className={`${P}__when`}>{when(r.startedAt)}</span>
                <span className={`${P}__main`}>
                  <span className={`${P}__where`}>{r.unattended ? 'Unattended' : LOCATIONS[r.location] ?? r.location}{r.skipped ? ' · skipped' : ''}</span>
                  <span className={`${P}__sub`}>{[r.repo, r.branch, r.head].filter(Boolean).join(' · ') || r.project}</span>
                </span>
                {r.model && <Chip tone="accent">{modelLabel(r.model).split(' ')[0]}</Chip>}
                {r.effort && <span className={`${P}__effort`}>{r.effort}</span>}
                <StatusMark s={r.status} flags={r.flags} />
              </button>
              {sel === r.id && <SessionDetail id={r.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return days < 1 && new Date().getDate() === d.getDate() ? `Today ${time}` : days < 2 ? `Yesterday ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function StatusMark({ s, flags }: { s: Summary['status']; flags: string[] }) {
  const title = s === 'ok' ? 'Everything checked out' : s === 'none' ? 'No questions asked' : `Flagged: ${flags.join(', ')}`;
  const icon = s === 'ok' ? 'check' : s === 'mismatch' ? 'x-circle' : s === 'flag' ? 'alert' : 'minus';
  return <span className={`${P}__mark is-${s}`} title={title} aria-label={title}><Icon name={icon} size={16} /></span>;
}

interface Rec { [k: string]: unknown; location?: { answer?: string; detected?: string; host?: string }; repo?: { slug?: string; branch?: string; head?: string; dirty?: number; behind?: number | null; ahead?: number | null; ok?: boolean; answer?: string }; container?: { answer?: string; detected?: string; ok?: boolean }; project?: { answer?: string; detected?: string }; memory?: { source?: string; files?: string[]; opened?: string[] } | null; model?: { recommended?: string; why?: string; picked?: string; running?: string; switchNeeded?: boolean }; effort?: { picked?: string; applied?: string; current?: string }; estimate?: { usd?: number | null; calibrated?: boolean; pricesAsOf?: string; model?: string; effort?: string } | null; pending?: string[]; end?: { at?: string; reason?: string; commits?: string[] } | null; startedAt?: string; unattended?: boolean; skipped?: boolean; sameAsLast?: boolean }

function SessionDetail({ id }: { id: string }) {
  const [r, setR] = useState<Rec | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { getJson<Rec>(`sessions/${encodeURIComponent(id)}`).then(setR, (e: Error) => setErr(e.message)); }, [id]);
  if (err) return <p className={`${P}__error`}>{err}</p>;
  if (!r) return <LoadingSkeleton />;
  const repo = r.repo;
  const notes: string[] = [];
  if (repo?.ok === false) notes.push(`Wrong repo: ${repo.slug} (not the expected one).`);
  if ((repo?.behind ?? 0) > 0) notes.push(`The repo was ${repo?.behind} commit(s) behind GitHub at check-in.`);
  if (r.container?.ok === false) notes.push('The session ran in an unexpected container.');
  if (r.model?.switchNeeded) notes.push(`Model switch needed: running ${r.model.running}, picked ${modelLabel(r.model.picked ?? '')}.`);
  const row = (k: string, v: ReactNode) => (v == null || v === '' ? null : <tr><th>{k}</th><td>{v}</td></tr>);
  return (
    <div className={`${P}__detail`}>
      <table className="fx-table"><tbody>
        {row('Location', `${LOCATIONS[r.location?.answer ?? r.location?.detected ?? ''] ?? r.location?.answer ?? r.location?.detected ?? '—'}${r.location?.host ? ` · ${r.location.host}` : ''}`)}
        {row('Repo', repo?.slug ? `${repo.slug} · ${repo.branch} · ${repo.head}${repo.dirty ? ` · ${repo.dirty} uncommitted` : ''}${repo.behind ? ` · ${repo.behind} behind` : ''}` : repo?.answer)}
        {row('Container', r.container?.answer ?? r.container?.detected)}
        {row('Project', r.project?.answer ?? r.project?.detected)}
        {r.memory && row('Memory', `${r.memory.source ?? ''} · ${r.memory.files?.length ?? 0} files${r.memory.opened?.length ? ` · opened ${r.memory.opened.join(', ')}` : ''}`)}
        {row('Model', r.model ? `recommended ${modelLabel(r.model.recommended ?? '')} · picked ${modelLabel(r.model.picked ?? '')} · running ${r.model.running ?? '—'}` : null)}
        {row('Why', r.model?.why)}
        {row('Effort', r.effort ? `${r.effort.picked ?? '—'}${r.effort.applied && r.effort.applied !== r.effort.picked ? ` (applied: ${r.effort.applied})` : ''}` : null)}
        {row('Baseline', r.estimate ? `${r.estimate.usd == null ? '—' : `$${r.estimate.usd}`}${r.estimate.calibrated ? ' · calibrated' : ' · uncalibrated'}${r.estimate.pricesAsOf ? ` · prices from ${r.estimate.pricesAsOf}` : ''}` : null)}
        {row('Pending', r.pending?.length ? r.pending.join(', ') : null)}
        {row('Ended', r.end?.at ? `${new Date(r.end.at).toLocaleString()}${r.end.commits?.length ? ` · ${r.end.commits.length} commit(s)` : ''}${r.end.reason ? ` · ${r.end.reason}` : ''}` : 'still open, or the client has no end hook')}
        {row('Record', <span className="fx-mono fx-small">{id}</span>)}
      </tbody></table>
      {notes.map((n) => <p key={n} className={`${P}__flag`}><Icon name="alert" size={14} /> {n}</p>)}
    </div>
  );
}

/* ================================================================== Settings → Plugins → Session check-in */

function StatusPanel() {
  const rt = useRuntime();
  const { st, err, reload } = useStatus();
  const [busy, setBusy] = useState('');
  const remove = async (target: Target) => {
    setBusy(target);
    try { const r = await post<{ log: string[] }>('uninstall', { target }); r.log.forEach((l) => rt.terminal.log('session-checkin', l, 'ok')); rt.toast('Check-in removed from that settings file', 'success'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
    setBusy(''); void reload();
  };
  if (err) return <p className={`${P}__error`}>{err}</p>;
  if (!st) return <LoadingSkeleton />;
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => rt.toast('Copied', 'success'), () => rt.toast('Clipboard blocked', 'warning'));
  return (
    <div className="fx-stack">
      <table className="fx-table"><tbody>
        {(Object.entries(st.targets) as [Target, TargetStatus][]).filter(([k]) => k !== 'user').map(([k, v]) => (
          <tr key={k}>
            <th>{k === 'local' ? 'This clone' : 'Every clone'}</th>
            <td><span className="fx-mono fx-small">{v.settings}</span><br /><span className="fx-muted fx-small">{v.label}</span></td>
            <td>{v.installed ? <Chip tone="success">on</Chip> : <Chip>off</Chip>}</td>
            <td>{v.installed && <Button icon="trash" tone="danger" disabled={!!busy} onClick={() => void remove(k)}>Remove</Button>}</td>
          </tr>
        ))}
      </tbody></table>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Clone on the server: <span className="fx-mono">{st.repo}</span> · archive read from {st.archive.roots.map((r) => <span key={r} className="fx-mono"> {r}</span>)}</p>
      <div className={`${P}__device`}>
        <p style={{ margin: 0 }}><strong>On another device or in another folder</strong> (your laptop, the VPS host's user settings): run the same installer there in a terminal. It asks the same questions.</p>
        <div className="fx-row fx-row--wrap"><code className={`${P}__cmd`}>{st.terminal}</code><Button icon="copy" onClick={() => copy(st.terminal)}>Copy</Button></div>
      </div>
    </div>
  );
}

const STEPS = ['Where', 'Questions', 'Behaviour', 'Expected', 'Review'] as const;

function InstallWizard() {
  const rt = useRuntime();
  const { st, reload } = useStatus();
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<'local' | 'shared'>('local');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [preview, setPreview] = useState<{ settings: string; config: string; after: unknown; configJson: unknown } | null>(null);
  const [out, setOut] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!st || cfg) return;
    const inst = installedTargets(st).find((t): t is 'local' | 'shared' => t !== 'user');
    if (inst) setTarget(inst);
    setCfg(structuredClone((inst && st.targets[inst].config) || st.defaults));
  }, [st, cfg]);
  if (!st || !cfg) return <LoadingSkeleton />;
  const set = (p: Partial<Config>) => setCfg({ ...cfg, ...p });
  const go = async (n: number) => {
    setErr('');
    if (n === 4) {
      setBusy(true);
      try { const r = await post<{ preview: typeof preview }>('preview', { target, config: cfg }); setPreview(r.preview); } catch (e) { setErr((e as Error).message); setBusy(false); return; }
      setBusy(false);
    }
    setStep(n);
  };
  const install = async () => {
    setBusy(true); setErr('');
    try {
      const r = await post<{ log: string[] }>('install', { target, config: cfg });
      setOut(r.log); r.log.forEach((l) => rt.terminal.log('session-checkin', l, 'ok'));
      rt.toast('Session check-in installed', 'success'); void reload();
    } catch (e) { setErr((e as Error).message); setOut([`error: ${(e as Error).message}`]); }
    setBusy(false);
  };
  const already = st.targets[target].installed;

  return (
    <div className="fx-stack">
      <ol className={`${P}__steps`}>
        {STEPS.map((s, i) => <li key={s} className={`${P}__step ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`}><button type="button" className={`fx-chip ${i === step ? 'is-on' : ''}`} onClick={() => void go(i)} disabled={busy}>{i + 1}. {s}</button></li>)}
      </ol>

      {step === 0 && (
        <fieldset className={`${P}__fieldset`}>
          <legend>Where should new sessions ask the questions?</legend>
          {(['local', 'shared'] as const).map((t) => (
            <label key={t} className={`${P}__choice`}>
              <input type="radio" name="sc-target" checked={target === t} onChange={() => setTarget(t)} />
              <span><strong>{t === 'local' ? 'This clone only' : 'Every clone of the repo'}</strong>{st.targets[t].installed ? ' · installed' : ''}<br />
                <span className="fx-muted fx-small">{t === 'local' ? `Claude Code sessions started in ${st.repo} on the server. Not committed (.claude/settings.local.json).` : 'Commits .claude/settings.json to GitHub from here, so every clone gets it: phone/cloud sessions, the VPS, your laptop. Needs the console\'s GITHUB_TOKEN with write access.'}</span></span>
            </label>
          ))}
          <p className="fx-small fx-muted" style={{ margin: 0 }}>For your user settings on a device (every folder there), run the installer on that device: see Status above.</p>
        </fieldset>
      )}

      {step === 1 && (
        <fieldset className={`${P}__fieldset`}>
          <legend>Which questions? Location is always asked first.</legend>
          {st.questions.map((q) => (
            <label key={q.id} className={`${P}__choice`}>
              <input type="checkbox" checked={q.required || cfg.questions[q.id] !== false} disabled={q.required} onChange={(e) => set({ questions: { ...cfg.questions, [q.id]: e.target.checked } })} />
              <span><strong>{q.label}</strong>{q.required ? ' · always' : ''}<br /><span className="fx-muted fx-small">{q.help}</span></span>
            </label>
          ))}
        </fieldset>
      )}

      {step === 2 && (
        <fieldset className={`${P}__fieldset`}>
          <legend>Behaviour</legend>
          <Check on={cfg.sources.includes('resume')} set={(v) => set({ sources: v ? ['startup', 'resume'] : ['startup'] })} label="Also when a session is resumed" help="Off: only brand-new sessions ask." />
          <Check on={cfg.allowSkip} set={(v) => set({ allowSkip: v })} label='Allow "skip"' help="Logs the session with what was detected, asks nothing." />
          <Check on={cfg.allowSameAsLast} set={(v) => set({ allowSameAsLast: v })} label='Allow "same as last"' help="Reuses the previous answers for the same location; mismatches are still flagged." />
          <Check on={cfg.unattended === 'log'} set={(v) => set({ unattended: v ? 'log' : 'off' })} label="Log unattended runs" help="claude -p and scheduled runs are logged without asking." />
          <label className={`${P}__field`}>Default effort
            <select className="fx-input" value={cfg.defaultEffort} onChange={(e) => set({ defaultEffort: e.target.value as Effort })}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
        </fieldset>
      )}

      {step === 3 && (
        <fieldset className={`${P}__fieldset`}>
          <legend>Expected values (anything else is flagged)</legend>
          <label className={`${P}__field`}>Repo<input className="fx-input" value={cfg.expected.repo} onChange={(e) => set({ expected: { ...cfg.expected, repo: e.target.value } })} /></label>
          <label className={`${P}__field`}>Project<input className="fx-input" value={cfg.expected.project} onChange={(e) => set({ expected: { ...cfg.expected, project: e.target.value } })} /></label>
          <label className={`${P}__field`}>On the VPS, sessions run on<input className="fx-input" value={cfg.expected.vpsContainer} onChange={(e) => set({ expected: { ...cfg.expected, vpsContainer: e.target.value } })} placeholder="host or docker:<name>" /></label>
          <label className={`${P}__field`}>Archive folder<input className="fx-input" value={cfg.archive} onChange={(e) => set({ archive: e.target.value })} placeholder='auto, or an absolute folder' />
            <span className="fx-small fx-muted">auto = the hub's /projects/amberx-axf/_data/sessions where it's mounted, else the repo's sessions/ folder (committed).</span></label>
        </fieldset>
      )}

      {step === 4 && preview && (
        <div className="fx-stack">
          <p style={{ margin: 0 }}>{already ? 'Update' : 'Install'} the check-in in <span className="fx-mono">{preview.settings}</span>{target === 'shared' ? ' and push it to GitHub' : ''}. Only the check-in's own hook entries change; everything else in that file stays as it is, and the old file is kept as <span className="fx-mono">.bak</span>.</p>
          <details className={`${P}__preview`}><summary>Settings file after install</summary><pre className={`${P}__pre`}>{JSON.stringify(preview.after, null, 2)}</pre></details>
          <details className={`${P}__preview`}><summary>Check-in config ({preview.config})</summary><pre className={`${P}__pre`}>{JSON.stringify(preview.configJson, null, 2)}</pre></details>
          <div className="fx-row fx-row--wrap"><Button tone="primary" icon="download" disabled={busy} onClick={() => void install()}>{busy ? (target === 'shared' ? 'Pushing to GitHub…' : 'Installing…') : already ? 'Update' : 'Install'}</Button></div>
          {out.length > 0 && <pre className={`${P}__pre ${P}__out`} aria-live="polite">{out.join('\n')}</pre>}
        </div>
      )}

      {err && <p className={`${P}__error`}>{err}</p>}
      <div className="fx-row fx-row--wrap">
        {step > 0 && <Button icon="arrow-left" disabled={busy} onClick={() => void go(step - 1)}>Back</Button>}
        {step < 4 && <Button tone="primary" icon="arrow-right" disabled={busy} onClick={() => void go(step + 1)}>{step === 3 ? 'Review' : 'Next'}</Button>}
      </div>
    </div>
  );
}

function Check({ on, set, label, help }: { on: boolean; set: (v: boolean) => void; label: string; help: string }) {
  return <label className={`${P}__choice`}><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /><span><strong>{label}</strong><br /><span className="fx-muted fx-small">{help}</span></span></label>;
}

function BaselinePanel() {
  const rt = useRuntime();
  const [b, setB] = useState<Baseline | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [asOf, setAsOf] = useState('');
  const [source, setSource] = useState('');
  const load = () => getJson<Baseline>('baseline').then((x) => {
    setB(x); setAsOf(x.pricing.asOf ?? new Date().toISOString().slice(0, 10)); setSource(x.pricing.source ?? '');
    const e: Record<string, string> = {};
    for (const [m] of MODELS) for (const k of ['input', 'output', 'cacheRead'] as const) e[`${m}.${k}`] = String(x.pricing.models?.[m]?.[k] ?? '');
    setEdit(e);
  }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const save = async () => {
    const models: Record<string, { input: number; output: number; cacheRead?: number }> = {};
    for (const [m] of MODELS) {
      const i = Number(edit[`${m}.input`]), o = Number(edit[`${m}.output`]), c = edit[`${m}.cacheRead`];
      if (!edit[`${m}.input`] || !edit[`${m}.output`] || Number.isNaN(i) || Number.isNaN(o)) continue;
      models[m] = { input: i, output: o, ...(c ? { cacheRead: Number(c) } : {}) };
    }
    try { await post('pricing', { asOf, source, models }); rt.toast('Prices saved', 'success'); void load(); } catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  if (err) return <p className={`${P}__error`}>{err}</p>;
  if (!b) return <LoadingSkeleton />;
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>The cost of one fixed reference build ({b.version}, <span className="fx-mono">baseline/BASELINE-v1.md</span>) per model and effort, so every check-in quotes comparable numbers. "uncalibrated" = placeholder token counts until a real run is measured with <span className="fx-mono">checkin.mjs calibrate</span> ({b.runs.length} run{b.runs.length === 1 ? '' : 's'} so far).</p>
      <div className={`${P}__scroll`}>
        <table className="fx-table"><thead><tr><th>Model</th>{EFFORTS.map((e) => <th key={e}>{e}</th>)}</tr></thead><tbody>
          {MODELS.map(([m, label]) => <tr key={m}><th>{label}</th>{EFFORTS.map((e) => { const x = b.estimates[m]?.[e]; return <td key={e}>{money(x)}{x && x.usd != null && !x.calibrated ? <span className="fx-muted fx-small"> est.</span> : null}</td>; })}</tr>)}
        </tbody></table>
      </div>
      <p className="fx-small" style={{ margin: 0 }}>Prices {b.pricing.asOf ? `from ${b.pricing.asOf}${b.pricing.source ? ` (${b.pricing.source})` : ''}` : 'not set yet'}. USD per million tokens; copy them from docs.claude.com.</p>
      <div className={`${P}__scroll`}>
        <table className="fx-table"><thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cache read</th></tr></thead><tbody>
          {MODELS.map(([m, label]) => <tr key={m}><th>{label}</th>{(['input', 'output', 'cacheRead'] as const).map((k) => <td key={k}><input className={`fx-input ${P}__num`} inputMode="decimal" value={edit[`${m}.${k}`] ?? ''} onChange={(e) => setEdit({ ...edit, [`${m}.${k}`]: e.target.value })} aria-label={`${label} ${k} price`} /></td>)}</tr>)}
        </tbody></table>
      </div>
      <div className="fx-row fx-row--wrap">
        <label className={`${P}__field`}>Prices as of<input className="fx-input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <label className={`${P}__field fx-grow`}>Source<input className="fx-input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://docs.claude.com/…" /></label>
      </div>
      <div className="fx-row"><Button tone="primary" icon="save" onClick={() => void save()}>Save prices</Button></div>
    </div>
  );
}

/* ================================================================== plugin */

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Session check-in',
  version: '1.0.0',
  appMenu,
  views: { 'session-checkin': { title: 'Sessions', icon: 'list', render: () => <SessionsView /> } },
  nav: { label: 'Plugins', items: [{ id: 'session-checkin', label: 'Sessions', icon: 'list', view: 'session-checkin' }] },
  settingsTabs: [{ id: 'session-checkin', label: 'Session check-in', icon: 'check-circle', order: 36, description: 'The questions every new Claude Code session opens with, where they are installed, and the baseline build costs they quote.' }],
  settingsPanels: [
    { id: 'session-checkin.status', tab: 'session-checkin', title: 'Status', icon: 'info', order: 10, render: () => <StatusPanel /> },
    { id: 'session-checkin.install', tab: 'session-checkin', title: 'Install or change', icon: 'download', order: 20, render: () => <InstallWizard /> },
    { id: 'session-checkin.baseline', tab: 'session-checkin', title: 'Baseline build costs', icon: 'chart', order: 30, render: () => <BaselinePanel /> },
  ],
};

