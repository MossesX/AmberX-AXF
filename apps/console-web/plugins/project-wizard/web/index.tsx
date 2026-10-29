import { useEffect, useState, type ReactNode } from 'react';
import { Button, Chip, Container, Icon, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import './project-wizard.css';
import { appMenu } from './menu';
import { LoadingSkeleton, EmptyState } from '@console/emptyState';

/** Plugin folder: server routes live at /api/plugins/project-wizard/. */
const FOLDER = 'project-wizard';
const ID = 'ai.amberx.axf.console.project-wizard';
const P = 'axp-project-wizard';

/* ---------------- types (mirror wizard.mjs) ---------------- */

type SourceKind = 'github' | 'vps' | 'folder' | 'new';
type HomeMode = 'new' | 'existing' | 'skip' | 'keep';
interface Source { kind: SourceKind; repo: string; path: string; template: string; boilerplate: string }
interface Home { mode: HomeMode; owner: string; name: string; path: string }
interface Plan {
  source: Source; display: string; name: string; description: string; kind: string; visibility: 'private' | 'public';
  port: 'bake' | 'rebuild' | 'no'; homes: { github: Home; vps: Home; local: Home }; sync: boolean; commitAll: boolean;
}
interface Step { ok: boolean; note: string; at: string }
interface Project { name: string; display: string; description?: string; dir: string; github?: string; vps?: string; claudeAi?: string; source: { kind: SourceKind; repo?: string; path?: string; template?: string }; steps: Record<string, Step>; kit?: { files: string[] }; failed?: string; updatedAt?: string }
interface Status {
  github: { token: boolean; login: string; error: string }; vps: { mode: 'local' | 'ssh' | 'off'; dir: string; host: string; why: string };
  workspace: string; roots: string[]; templates: { id: string; label: string; targets: string[] }[];
  boilerplates: { id: string; name: string; category: string; description: string; status: string }[]; claudeNewProjectUrl: string; projects: Project[];
}
interface Inspect { kind: SourceKind; repo?: string; path?: string; state?: string; stack?: string[]; relation?: string; axfNote?: string; git?: boolean; empty?: boolean; hasManifest?: boolean; origin?: string; suggest: { display: string; name: string; description: string; owner?: string; repoName?: string; visibility?: 'private' | 'public' } }
interface Check { ok: boolean; problems: string[]; warnings: string[]; plan: { name: string; dir: string; homes: { github?: { owner: string; name: string; state: string; isSource: boolean }; vps?: { path: string; state: string }; local: { path: string } } } }
interface KitFile { path: string; bytes: number; text: string }
interface RunResult { ok: boolean; error?: string; log: string[]; project: Project; kit?: { files: KitFile[] } }
interface Item { id: string; label: string; note: string }

const empty = (mode: HomeMode = 'skip'): Home => ({ mode, owner: '', name: '', path: '' });
const freshPlan = (): Plan => ({ source: { kind: 'github', repo: '', path: '', template: 'react-ts', boilerplate: 'blank' }, display: '', name: '', description: '', kind: 'app', visibility: 'private', port: 'no', homes: { github: empty('new'), vps: empty('skip'), local: empty('keep') }, sync: true, commitAll: false });
/** "owner/name", a github.com link or a bare name (then the current owner) → [owner, name]. */
function splitRepo(val: string, owner: string): [string, string] {
  const t = val.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = t.match(/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)?([^/\s:]+)\/([^/\s]+)$/i);
  return m ? [m[1] ?? owner, m[2] ?? t] : [owner, t];
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown; error?: string };
  if (!r.ok) {
    const d = j.detail;
    throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: { msg?: string }) => x.msg).join('; ') : j.error ?? (r.status === 401 ? 'Set the console token (Settings → Account & security) first.' : r.statusText));
  }
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

function copyText(rt: ReturnType<typeof useRuntime>, t: string) {
  navigator.clipboard?.writeText(t).then(() => rt.toast('Copied', 'success'), () => rt.toast('Clipboard blocked', 'warning'));
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url; a.download = name.replace(/\//g, '_'); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ================================================================== main view */

const STEPS = ['Source', 'Details', 'Homes', 'Claude project', 'Review'] as const;

function ProjectWizardView() {
  const { st, err, reload } = useStatus();
  const [wizardKey, setWizardKey] = useState(0);
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Plugin · ported from xGallery</p>
          <h1>New project</h1>
          <p className="fx-muted">Take a repo or a folder (or start a new AXF app), give it a home on GitHub, the VPS or a local git folder, and get it ready as a Claude project with its instructions and context files.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => { void reload(); setWizardKey((k) => k + 1); }}>Start over</Button>
        </div>
      </header>
      {err && <p className={`${P}__error`}>{err}</p>}
      {st && <Readiness st={st} />}
      {st && <Container title="Make a project" icon="rocket"><Wizard key={wizardKey} st={st} onDone={() => void reload()} /></Container>}
      {st && <Container title={`Made with the wizard${st.projects.length ? ` · ${st.projects.length}` : ''}`} icon="list"><Projects st={st} reload={() => void reload()} /></Container>}
    </div>
  );
}

function Readiness({ st }: { st: Status }) {
  const rt = useRuntime();
  const issues: ReactNode[] = [];
  if (!st.github.token) issues.push(<>No GitHub token on the console server, so GitHub sources and homes are off. Add one in the Systems check.</>);
  else if (st.github.error) issues.push(<>GitHub token problem: {st.github.error}</>);
  if (st.vps.mode === 'off') issues.push(<>VPS git is off: {st.vps.why}. See Settings → Plugins → Project wizard.</>);
  if (!issues.length) return null;
  return (
    <div className={`${P}__notice`} role="status">
      <Icon name="info" />
      <div className="fx-grow">{issues.map((i, n) => <p key={n} style={{ margin: 0 }}>{i}</p>)}</div>
      <Button icon="settings" onClick={() => rt.dispatch('settings.open:project-wizard')}>Settings</Button>
    </div>
  );
}

/* ---------------- the wizard ---------------- */

function Wizard({ st, onDone }: { st: Status; onDone: () => void }) {
  const rt = useRuntime();
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState<Plan>(() => ({ ...freshPlan(), homes: { github: { ...empty(st.github.token ? 'new' : 'skip'), owner: st.github.login }, vps: empty('skip'), local: empty('keep') } }));
  const [info, setInfo] = useState<Inspect | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const set = (p: Partial<Plan>) => setPlan((x) => ({ ...x, ...p }));
  const setSource = (p: Partial<Source>) => { setInfo(null); setPlan((x) => ({ ...x, source: { ...x.source, ...p } })); };
  const setHome = (k: keyof Plan['homes'], p: Partial<Home>) => setPlan((x) => ({ ...x, homes: { ...x.homes, [k]: { ...x.homes[k], ...p } } }));

  const inspect = async () => {
    setBusy('inspect'); setErr('');
    try {
      const r = await post<Inspect>('inspect', plan.source);
      setInfo(r);
      const s = r.suggest;
      setPlan((x) => {
        const github = { ...x.homes.github };
        // a GitHub source stays its own GitHub home by default; a folder with a GitHub origin offers that repo
        if (r.kind === 'github') Object.assign(github, { mode: 'existing', owner: s.owner ?? github.owner, name: s.repoName ?? '' });
        else if (r.kind === 'folder' && s.owner) Object.assign(github, { mode: 'existing', owner: s.owner, name: s.repoName ?? '' });
        const vps = r.kind === 'vps' ? { ...x.homes.vps, mode: 'existing' as HomeMode, name: s.repoName ?? '' } : x.homes.vps;
        return { ...x, display: x.display || s.display, name: x.name || s.name, description: x.description || s.description, visibility: s.visibility ?? x.visibility, homes: { ...x.homes, github, vps } };
      });
      setStep(1);
    } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  const review = async () => {
    setBusy('check'); setErr('');
    try { setCheck(await post<Check>('check', { plan })); setStep(4); } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  const run = async () => {
    setBusy('run'); setErr(''); setResult(null);
    rt.terminal.log('project-wizard', `▶ making ${plan.display}`);
    try {
      const r = await post<RunResult>('run', { plan });
      setResult(r);
      rt.terminal.many?.('project-wizard', r.log);
      if (r.ok) { rt.toast(`${plan.display} is a Claude project`, 'success'); onDone(); } else rt.toast(r.error ?? 'The run stopped', 'danger');
    } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  const canNext = [!!info, plan.display.trim().length >= 2, true, true][step] ?? true;

  if (result?.ok) return <Done st={st} result={result} />;
  return (
    <div className="fx-stack">
      <ol className={`${P}__steps`}>
        {STEPS.map((s, i) => <li key={s} className={`${P}__step ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`}><button type="button" className={`fx-chip ${i === step ? 'is-on' : ''}`} disabled={!!busy || (i > 0 && !info)} onClick={() => (i === 4 ? void review() : setStep(i))}>{i + 1}. {s}</button></li>)}
      </ol>

      {step === 0 && <SourceStep st={st} plan={plan} setSource={setSource} info={info} />}
      {step === 1 && <DetailsStep plan={plan} set={set} info={info} />}
      {step === 2 && <HomesStep st={st} plan={plan} setHome={setHome} set={set} info={info} />}
      {step === 3 && <ClaudeStep plan={plan} set={set} info={info} />}
      {step === 4 && check && <ReviewStep plan={plan} check={check} />}

      {result && !result.ok && <RunLog result={result} />}
      {err && <p className={`${P}__error`}>{err}</p>}
      <div className="fx-row fx-row--wrap">
        {step > 0 && <Button icon="arrow-left" disabled={!!busy} onClick={() => setStep(step - 1)}>Back</Button>}
        {step === 0 && <Button tone="primary" icon="search" disabled={!!busy} onClick={() => void inspect()}>{busy === 'inspect' ? 'Looking…' : 'Look at it'}</Button>}
        {step > 0 && step < 3 && <Button tone="primary" icon="arrow-right" disabled={!!busy || !canNext} onClick={() => setStep(step + 1)}>Next</Button>}
        {step === 3 && <Button tone="primary" icon="check" disabled={!!busy} onClick={() => void review()}>{busy === 'check' ? 'Checking…' : 'Review'}</Button>}
        {step === 4 && <Button tone="primary" icon="rocket" disabled={!!busy || !check?.ok} onClick={() => void run()}>{busy === 'run' ? 'Making the project… (can take a few minutes)' : 'Make the project'}</Button>}
      </div>
    </div>
  );
}

const SOURCES: [SourceKind, string, string, string][] = [
  ['github', 'GitHub repo', 'Clone a repo from GitHub into the workspace.', 'github'],
  ['vps', 'VPS repo', 'A git repo on the VPS (/srv/git).', 'cloud'],
  ['folder', 'Folder', 'A folder on the console server.', 'folder'],
  ['new', 'New AXF app', 'axf init from a template and boilerplate.', 'sparkles'],
];

function SourceStep({ st, plan, setSource, info }: { st: Status; plan: Plan; setSource: (p: Partial<Source>) => void; info: Inspect | null }) {
  const s = plan.source;
  const off = (k: SourceKind) => (k === 'github' && !st.github.token) || (k === 'vps' && st.vps.mode === 'off');
  return (
    <fieldset className={`${P}__fieldset`}>
      <legend>Where does the project come from?</legend>
      <div className={`${P}__cards`} role="radiogroup" aria-label="Source">
        {SOURCES.map(([k, label, help, icon]) => (
          <button key={k} type="button" role="radio" aria-checked={s.kind === k} data-fx-row disabled={off(k)} className={`${P}__card ${s.kind === k ? 'is-selected' : ''}`} onClick={() => setSource({ kind: k })}>
            <Icon name={icon} /><strong>{label}</strong><span>{off(k) ? 'not available here' : help}</span>
          </button>
        ))}
      </div>
      {s.kind === 'github' && <Picker location="github" label="Repository (owner/name or link)" value={s.repo} onChange={(v) => setSource({ repo: v })} placeholder="MossesX/my-app" />}
      {s.kind === 'vps' && <Picker location="vps" label={`Repository in ${st.vps.dir}`} value={s.repo} onChange={(v) => setSource({ repo: v })} placeholder="my-app" />}
      {s.kind === 'folder' && <Picker location="local" label="Folder on the console server" value={s.path} onChange={(v) => setSource({ path: v })} placeholder={`${st.workspace}/my-app`} hint={`Allowed under: ${st.roots.join(', ')}`} />}
      {s.kind === 'new' && (
        <div className={`${P}__grid`}>
          <label className={`${P}__field`}>Template
            <select className="fx-input" value={s.template} onChange={(e) => setSource({ template: e.target.value })}>{st.templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          </label>
          <label className={`${P}__field`}>Boilerplate
            <select className="fx-input" value={s.boilerplate} onChange={(e) => setSource({ boilerplate: e.target.value })}>
              <option value="">none</option>
              {st.boilerplates.map((b) => <option key={b.id} value={b.id}>{b.name}{b.status && b.status !== 'built' ? ` (${b.status})` : ''}</option>)}
            </select>
          </label>
        </div>
      )}
      {info && <p className={`${P}__found`}><Icon name="check-circle" size={16} /> {foundText(info)}</p>}
    </fieldset>
  );
}

function foundText(i: Inspect) {
  if (i.kind === 'github') return `${i.repo} found on GitHub${i.state === 'empty' ? ' (empty)' : ''}.`;
  if (i.kind === 'vps') return `${i.repo} found on the VPS${i.state === 'empty' ? ' (empty)' : ''}.`;
  if (i.kind === 'folder') return `${i.path}: ${i.stack?.length ? i.stack.join(', ') : 'no known stack'}${i.git ? ' · git' : ' · not a git repo yet'}${i.hasManifest ? ' · has a project manifest' : ''}${i.relation && i.relation !== 'none' ? ` · AXF ${i.relation}` : ''}${i.origin ? ` · origin ${i.origin}` : ''}.`;
  return 'A new AmberX AXF app will be made in the local folder.';
}

/** Text field with a "Browse" list from the server (GitHub repos, VPS repos, local git folders). */
function Picker({ location, label, value, onChange, placeholder, hint }: { location: 'github' | 'vps' | 'local'; label: string; value: string; onChange: (v: string) => void; placeholder: string; hint?: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const browse = async () => {
    setOpen(!open); setErr('');
    if (!items && !open) { try { setItems((await getJson<{ items: Item[] }>(`list/${location}`)).items); } catch (e) { setErr((e as Error).message); } }
  };
  const shown = (items ?? []).filter((i) => !filter || `${i.label} ${i.note}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="fx-stack">
      <label className={`${P}__field`}>{label}
        <span className="fx-row">
          <input className="fx-input fx-mono fx-grow" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
          <Button icon={open ? 'chevron-up' : 'list'} onClick={() => void browse()} aria-expanded={open}>Browse</Button>
        </span>
        {hint && <span className="fx-small fx-muted">{hint}</span>}
      </label>
      {open && (
        <div className={`${P}__browse`}>
          {err && <p className={`${P}__error`}>{err}</p>}
          {!items && !err && <p className="fx-muted" style={{ margin: 0 }}>Loading…</p>}
          {items && items.length > 8 && <input className="fx-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter" />}
          {items && !shown.length && <p className="fx-muted" style={{ margin: 0 }}>Nothing found.</p>}
          <div className={`${P}__items`} role="listbox" aria-label={label}>
            {shown.slice(0, 80).map((i) => (
              <button key={i.id} type="button" role="option" aria-selected={value === i.id} data-fx-row className={`${P}__item ${value === i.id ? 'is-selected' : ''}`} onClick={() => { onChange(i.id); setOpen(false); }}>
                <span className={`${P}__item-label`}>{i.label}</span><span className={`${P}__item-note`}>{i.note}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailsStep({ plan, set, info }: { plan: Plan; set: (p: Partial<Plan>) => void; info: Inspect | null }) {
  const id = plan.name || slug(plan.display);
  return (
    <fieldset className={`${P}__fieldset`}>
      <legend>What is it?</legend>
      <label className={`${P}__field`}>Project name<input className="fx-input" value={plan.display} onChange={(e) => set({ display: e.target.value })} placeholder="Notes Pad" autoFocus /></label>
      <label className={`${P}__field`}>Project id
        <input className="fx-input fx-mono" value={plan.name} onChange={(e) => set({ name: slug(e.target.value) })} placeholder={slug(plan.display) || 'notes-pad'} />
        <span className="fx-small fx-muted">The hub folder /projects/{id || '<id>'}/ and the default repo name.</span>
      </label>
      <label className={`${P}__field`}>Description<textarea className="fx-input" rows={2} value={plan.description} onChange={(e) => set({ description: e.target.value })} placeholder="One sentence: what it is for" maxLength={300} /></label>
      <div className={`${P}__grid`}>
        <label className={`${P}__field`}>Kind
          <select className="fx-input" value={plan.kind} onChange={(e) => set({ kind: e.target.value })}>{['app', 'library', 'service', 'tool', 'site', 'other'].map((k) => <option key={k}>{k}</option>)}</select>
        </label>
        <label className={`${P}__field`}>Visibility (new repos)
          <select className="fx-input" value={plan.visibility} onChange={(e) => set({ visibility: e.target.value as Plan['visibility'] })}><option value="private">private</option><option value="public">public</option></select>
        </label>
      </div>
      {info?.hasManifest && <p className="fx-small fx-muted" style={{ margin: 0 }}>It already has a project manifest: its name and id are kept unless you change them here.</p>}
    </fieldset>
  );
}

const MODES: Record<'github' | 'vps', [HomeMode, string][]> = {
  github: [['new', 'New repo'], ['existing', 'Existing repo'], ['skip', 'Not on GitHub']],
  vps: [['new', 'New repo'], ['existing', 'Existing repo'], ['skip', 'Not on the VPS']],
};

function HomesStep({ st, plan, setHome, set, info }: { st: Status; plan: Plan; setHome: (k: keyof Plan['homes'], p: Partial<Home>) => void; set: (p: Partial<Plan>) => void; info: Inspect | null }) {
  const id = plan.name || slug(plan.display);
  const g = plan.homes.github;
  const v = plan.homes.vps;
  return (
    <div className="fx-stack">
      <fieldset className={`${P}__fieldset`}>
        <legend><Icon name="github" size={16} /> GitHub</legend>
        <Modes value={g.mode} modes={MODES.github} disabled={!st.github.token} onChange={(m) => setHome('github', { mode: m })} name="home-github" />
        {g.mode !== 'skip' && (
          <div className={`${P}__grid`}>
            <label className={`${P}__field`}>Owner<input className="fx-input fx-mono" value={g.owner} onChange={(e) => setHome('github', { owner: e.target.value.trim() })} placeholder={st.github.login || 'MossesX'} /></label>
            {g.mode === 'existing'
              ? <Picker location="github" label="Repository" value={g.owner && g.name ? `${g.owner}/${g.name}` : g.name} onChange={(val) => { const [o, n] = splitRepo(val, g.owner); setHome('github', { owner: o, name: n }); }} placeholder="owner/name" />
              : <label className={`${P}__field`}>Repository name<input className="fx-input fx-mono" value={g.name} onChange={(e) => setHome('github', { name: e.target.value.trim() })} placeholder={id} /></label>}
          </div>
        )}
        {g.mode !== 'skip' && <p className="fx-small fx-muted" style={{ margin: 0 }}>The Claude GitHub app gets access, so the repo can be attached to the Claude.ai project and opened in Claude Code on the web.</p>}
      </fieldset>

      <fieldset className={`${P}__fieldset`}>
        <legend><Icon name="cloud" size={16} /> VPS git</legend>
        <Modes value={v.mode} modes={MODES.vps} disabled={st.vps.mode === 'off'} onChange={(m) => setHome('vps', { mode: m })} name="home-vps" />
        {st.vps.mode === 'off' && <p className="fx-small fx-muted" style={{ margin: 0 }}>{st.vps.why}.</p>}
        {v.mode === 'new' && <label className={`${P}__field`}>Repository name<input className="fx-input fx-mono" value={v.name} onChange={(e) => setHome('vps', { name: e.target.value.trim() })} placeholder={id} /><span className="fx-small fx-muted">{st.vps.dir}/{v.name || id}.git{st.vps.mode === 'ssh' ? `, working folder ~/projects/${id} on ${st.vps.host}` : ''}</span></label>}
        {v.mode === 'existing' && <Picker location="vps" label="Repository" value={v.name} onChange={(val) => setHome('vps', { name: val })} placeholder={id} />}
      </fieldset>

      <fieldset className={`${P}__fieldset`}>
        <legend><Icon name="folder" size={16} /> Local git folder</legend>
        {plan.source.kind === 'folder'
          ? <>
            <p style={{ margin: 0 }}>Stays in <span className="fx-mono">{info?.path ?? plan.source.path}</span>{info?.git ? ' (its own git repo).' : ' (made a git repo).'}</p>
            {info && !info.git && !info.empty && (
              <label className={`${P}__choice`}><input type="checkbox" checked={plan.commitAll} onChange={(e) => set({ commitAll: e.target.checked })} /><span><strong>Commit everything in this folder</strong><br /><span className="fx-muted fx-small">It isn't a git repo yet, so every file in it is committed and pushed to the homes above. Files that look like secrets (.env, keys, secrets.env, credentials) are left out, but check it first.</span></span></label>
            )}
          </>
          : <label className={`${P}__field`}>Folder on the console server<input className="fx-input fx-mono" value={plan.homes.local.path} onChange={(e) => setHome('local', { path: e.target.value })} placeholder={`${st.workspace}/${id || '<id>'}`} /><span className="fx-small fx-muted">Must be new or empty, under {st.roots.join(' or ')}.</span></label>}
      </fieldset>
      <label className={`${P}__choice`}><input type="checkbox" checked={plan.sync} onChange={(e) => set({ sync: e.target.checked })} /><span><strong>Sync _claude/ with the hub</strong><br /><span className="fx-muted fx-small">Runs claude-sync when it's installed on the console server, so /projects/{id || '<id>'}/ gets the Claude files.</span></span></label>
    </div>
  );
}

function Modes({ value, modes, onChange, disabled, name }: { value: HomeMode; modes: [HomeMode, string][]; onChange: (m: HomeMode) => void; disabled?: boolean; name: string }) {
  return (
    <div className={`${P}__modes`} role="radiogroup">
      {modes.map(([m, label]) => (
        <label key={m} className={`${P}__mode ${value === m ? 'is-selected' : ''}`}>
          <input type="radio" name={name} checked={value === m} disabled={disabled && m !== 'skip'} onChange={() => onChange(m)} /> {label}
        </label>
      ))}
    </div>
  );
}

function ClaudeStep({ plan, set, info }: { plan: Plan; set: (p: Partial<Plan>) => void; info: Inspect | null }) {
  const id = plan.name || slug(plan.display);
  const notAxf = plan.source.kind !== 'new' && (info?.relation ?? 'none') === 'none';
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>The wizard writes these into the project and commits them:</p>
      <table className="fx-table"><tbody>
        <tr><th className="fx-mono">project.manifest.json</th><td>Validated project manifest (name, repo, homes, AXF relation). Kept if it already exists.</td></tr>
        <tr><th className="fx-mono">CLAUDE.md</th><td>Instructions for Claude Code, with Brett's rules imported. An existing one only gets the import line.</td></tr>
        <tr><th className="fx-mono">_claude/</th><td>rules/, instructions/, memory/ (decisions.md, {id || '<id>'}.md) and the shared rules.</td></tr>
        <tr><th className="fx-mono">docs/FIRST_SESSION.md</th><td>The first message for a new Claude Code session.</td></tr>
        <tr><th className="fx-mono">_claude/claude-ai/</th><td><strong>Claude.ai project kit:</strong> INSTRUCTIONS.md for the project's instructions, and context/ (PROJECT, CLAUDE, RULES, DECISIONS, FIRST_SESSION) to upload as project files.</td></tr>
      </tbody></table>
      <p className={`${P}__found`}><Icon name="info" size={16} /> claude.ai has no way for the console to create the Project itself. After the run you get the kit with copy and download buttons and a button that opens claude.ai's new-project page; then paste the project's link back here so it's recorded.</p>
      {notAxf && (
        <fieldset className={`${P}__fieldset`}>
          <legend>It isn't built on AmberX AXF. Port it?</legend>
          {([['no', 'No', 'Leave it as it is.'], ['bake', 'Bake AXF into it', 'Keep the code, move its look into AXF assets.'], ['rebuild', 'Rebuild from a boilerplate', 'Fresh AXF app, rebuilt feature by feature.']] as const).map(([k, label, help]) => (
            <label key={k} className={`${P}__choice`}><input type="radio" name="port" checked={plan.port === k} onChange={() => set({ port: k })} /><span><strong>{label}</strong><br /><span className="fx-muted fx-small">{help}{k !== 'no' ? ' Parked for Fable on the pending list, not started.' : ''}</span></span></label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

function ReviewStep({ plan, check }: { plan: Plan; check: Check }) {
  const h = check.plan.homes;
  const row = (k: string, v: ReactNode) => <tr><th>{k}</th><td>{v}</td></tr>;
  const src = plan.source;
  return (
    <div className="fx-stack">
      <table className="fx-table"><tbody>
        {row('Project', <>{plan.display} <span className="fx-mono fx-muted">({check.plan.name})</span></>)}
        {plan.description && row('Description', plan.description)}
        {row('Source', src.kind === 'new' ? `new AXF app: ${src.template}${src.boilerplate ? ` + ${src.boilerplate}` : ''}` : src.kind === 'folder' ? src.path : `${src.kind === 'github' ? 'GitHub' : 'VPS'} ${src.repo}`)}
        {row('GitHub', h.github ? <>{h.github.owner}/{h.github.name} <Chip tone={h.github.state === 'free' ? 'accent' : h.github.isSource ? 'success' : 'warning'}>{h.github.state === 'free' ? 'will be created' : h.github.isSource ? 'the source' : h.github.state}</Chip></> : '—')}
        {row('VPS', h.vps ? <><span className="fx-mono">{h.vps.path}</span> <Chip tone={h.vps.state === 'free' ? 'accent' : 'warning'}>{h.vps.state === 'free' ? 'will be created' : h.vps.state}</Chip></> : '—')}
        {row('Local', <span className="fx-mono">{h.local.path}</span>)}
        {plan.port !== 'no' && row('Port to AXF', `${plan.port}, parked for Fable`)}
      </tbody></table>
      {check.problems.map((p) => <p key={p} className={`${P}__problem`}><Icon name="x-circle" size={16} /> {p}</p>)}
      {check.warnings.map((w) => <p key={w} className={`${P}__warning`}><Icon name="alert" size={16} /> {w}</p>)}
      {check.ok && <p className={`${P}__found`}><Icon name="check-circle" size={16} /> Ready. Nothing changes until you press Make the project.</p>}
    </div>
  );
}

function RunLog({ result }: { result: RunResult }) {
  return (
    <div className="fx-stack">
      {!result.ok && <p className={`${P}__problem`}><Icon name="x-circle" size={16} /> {result.error}</p>}
      <details className={`${P}__details`} open={!result.ok}><summary>Run log</summary><pre className={`${P}__pre`}>{result.log.join('\n')}</pre></details>
    </div>
  );
}

/* ---------------- after the run ---------------- */

function Done({ st, result }: { st: Status; result: RunResult }) {
  const p = result.project;
  const app = p.steps['claude-app'];
  return (
    <div className="fx-stack">
      <p className={`${P}__found`}><Icon name="check-circle" size={16} /> <span><strong>{p.display}</strong> is a Claude project.</span></p>
      <table className="fx-table"><tbody>
        {p.github && <tr><th>GitHub</th><td><a href={p.github} target="_blank" rel="noreferrer">{p.github.replace('https://github.com/', '')}</a></td></tr>}
        {p.vps && <tr><th>VPS git</th><td className="fx-mono">{p.vps}</td></tr>}
        <tr><th>Local</th><td className="fx-mono">{p.dir}</td></tr>
      </tbody></table>
      {app && !app.ok && <p className={`${P}__warning`}><Icon name="alert" size={16} /> {app.note}</p>}
      <KitPanel st={st} project={p} files={result.kit?.files} />
      <RunLog result={result} />
    </div>
  );
}

/** The Claude.ai project kit: instructions + context files, copy/download, open claude.ai, record the link. */
function KitPanel({ st, project, files: initial, onChange }: { st: Status; project: Project; files?: KitFile[]; onChange?: () => void }) {
  const rt = useRuntime();
  const [files, setFiles] = useState<KitFile[] | null>(initial ?? null);
  const [link, setLink] = useState(project.claudeAi ?? '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (!initial) post<{ files: KitFile[] }>('kit', { name: project.name }).then((r) => setFiles(r.files), (e: Error) => setErr(e.message)); }, [initial, project.name]);
  const rebuild = async () => {
    setBusy('rebuild'); setErr('');
    try { setFiles((await post<{ files: KitFile[] }>('kit', { name: project.name, rebuild: true })).files); rt.toast('Kit rebuilt and pushed', 'success'); onChange?.(); } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  const save = async () => {
    setBusy('link'); setErr('');
    try { const r = await post<{ pushed: boolean }>('link', { name: project.name, url: link.trim() }); rt.toast(r.pushed ? 'Linked and pushed' : 'Linked (push it later)', 'success'); onChange?.(); } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  const instructions = files?.find((f) => f.path === 'INSTRUCTIONS.md');
  const context = (files ?? []).filter((f) => f.path.startsWith('context/'));
  return (
    <div className={`${P}__kit`}>
      <p className={`${P}__kit-title`}><Icon name="sparkles" size={16} /> Claude.ai project</p>
      <ol className={`${P}__howto`}>
        <li>Open claude.ai's new project page and name it <strong>{project.display}</strong>.</li>
        <li>Copy the instructions into the project's instructions.</li>
        <li>Download the context files and upload them to the project{project.github ? `, and add ${project.github.replace('https://github.com/', '')} from GitHub` : ''}.</li>
        <li>Paste the project's link below.</li>
      </ol>
      <div className="fx-row fx-row--wrap">
        <a className="fx-btn fx-btn--primary" href={st.claudeNewProjectUrl} target="_blank" rel="noreferrer"><Icon name="external" size={16} /> Open claude.ai</a>
        <Button icon="copy" disabled={!instructions} onClick={() => instructions && copyText(rt, instructions.text)}>Copy instructions</Button>
        <Button icon="download" disabled={!context.length} onClick={() => context.forEach((f, i) => setTimeout(() => download(`${project.name}-${f.path.replace('context/', '')}`, f.text), i * 250))}>Download context files</Button>
        <Button icon="refresh" disabled={!!busy} onClick={() => void rebuild()}>{busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild kit'}</Button>
      </div>
      {!files && !err && <p className="fx-muted" style={{ margin: 0 }}>Loading the kit…</p>}
      {files && (
        <div className={`${P}__files`}>
          {files.map((f) => (
            <details key={f.path} className={`${P}__details`}>
              <summary><span className="fx-mono">{f.path}</span> <span className="fx-muted fx-small">{Math.max(1, Math.round(f.bytes / 1024))} KB</span></summary>
              <div className="fx-row fx-row--wrap"><Button icon="copy" onClick={() => copyText(rt, f.text)}>Copy</Button><Button icon="download" onClick={() => download(`${project.name}-${f.path}`, f.text)}>Download</Button></div>
              <pre className={`${P}__pre`}>{f.text}</pre>
            </details>
          ))}
        </div>
      )}
      <label className={`${P}__field`}>Claude.ai project link
        <span className="fx-row">
          <input className="fx-input fx-mono fx-grow" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://claude.ai/project/…" />
          <Button tone="primary" icon="save" disabled={!!busy || !link.trim()} onClick={() => void save()}>Save link</Button>
        </span>
        <span className="fx-small fx-muted">Recorded in project.manifest.json (x.claudeAi.url) and pushed.</span>
      </label>
      {err && <p className={`${P}__error`}>{err}</p>}
    </div>
  );
}

/* ---------------- projects made with the wizard ---------------- */

function Projects({ st, reload }: { st: Status; reload: () => void }) {
  const rt = useRuntime();
  const [open, setOpen] = useState<string | null>(null);
  if (!st.projects.length) return <EmptyState icon="folder" compact>No projects yet — the ones you make here are listed with their homes and Claude.ai kit.</EmptyState>;
  const forget = async (name: string) => {
    try { await post('forget', { name }); rt.toast('Removed from the list (nothing was deleted)', 'success'); reload(); } catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  return (
    <div className={`${P}__list`} role="list">
      {st.projects.map((p) => (
        <div key={p.name} role="listitem">
          <button type="button" data-fx-row className={`${P}__row ${open === p.name ? 'is-selected' : ''}`} aria-expanded={open === p.name} onClick={() => setOpen(open === p.name ? null : p.name)}>
            <span className={`${P}__main`}>
              <span className={`${P}__name`}>{p.display}</span>
              <span className={`${P}__sub`}>{[p.github?.replace('https://github.com/', ''), p.vps ? 'VPS' : '', p.dir].filter(Boolean).join(' · ')}</span>
            </span>
            {p.failed ? <Chip tone="danger">stopped</Chip> : p.claudeAi ? <Chip tone="success">on claude.ai</Chip> : <Chip tone="accent">kit ready</Chip>}
          </button>
          {open === p.name && (
            <div className={`${P}__detail`}>
              {p.failed && <p className={`${P}__problem`}><Icon name="x-circle" size={16} /> {p.failed}</p>}
              {p.claudeAi && <p style={{ margin: 0 }}>Claude.ai: <a href={p.claudeAi} target="_blank" rel="noreferrer">{p.claudeAi}</a></p>}
              {!p.failed && <KitPanel st={st} project={p} onChange={reload} />}
              <div className="fx-row fx-row--wrap"><Button icon="trash" tone="ghost" onClick={() => void forget(p.name)}>Remove from list</Button></div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ================================================================== Settings → Plugins → Project wizard */

function SettingsPanel() {
  const { st, err, reload } = useStatus();
  if (err) return <p className={`${P}__error`}>{err}</p>;
  if (!st) return <LoadingSkeleton />;
  const row = (k: string, v: ReactNode, ok: boolean) => <tr><th>{k}</th><td>{v}</td><td>{ok ? <Chip tone="success">ok</Chip> : <Chip tone="warning">off</Chip>}</td></tr>;
  return (
    <div className="fx-stack">
      <table className="fx-table"><tbody>
        {row('GitHub', st.github.token ? (st.github.error || `signed in as ${st.github.login}`) : 'no GITHUB_TOKEN on the console server', st.github.token && !st.github.error)}
        {row('VPS git', st.vps.mode === 'ssh' ? `over SSH: ${st.vps.host}:${st.vps.dir}` : st.vps.mode === 'local' ? `on this machine: ${st.vps.dir}` : st.vps.why, st.vps.mode !== 'off')}
        {row('Workspace', <span className="fx-mono">{st.workspace}</span>, true)}
        {row('Folders allowed', st.roots.map((r) => <span key={r} className="fx-mono">{r} </span>), true)}
      </tbody></table>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Set on the console server (environment, or <span className="fx-mono">.axf-console/secrets.env</span> for tokens): <span className="fx-mono">GITHUB_TOKEN</span> (classic, repo + workflow), <span className="fx-mono">AXF_WIZARD_WORKSPACE</span> (where clones and new apps go), <span className="fx-mono">AXF_WIZARD_ROOTS</span> (extra folders a folder source may come from, colon separated), <span className="fx-mono">AXF_VPS_HOST</span> / <span className="fx-mono">AXF_VPS_USER</span> (VPS git over SSH; needs the console's SSH key on the VPS), <span className="fx-mono">AXF_VPS_GIT_DIR</span> (default /srv/git). The same steps run in a terminal with <span className="fx-mono">claude-project</span>.</p>
      <div className="fx-row"><Button icon="refresh" onClick={() => void reload()}>Check again</Button></div>
    </div>
  );
}

/* ================================================================== plugin */

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Project wizard',
  version: '1.0.0',
  appMenu,
  views: { 'project-wizard': { title: 'New project', icon: 'rocket', render: () => <ProjectWizardView /> } },
  nav: { label: 'Plugins', items: [{ id: 'project-wizard', label: 'New project', icon: 'rocket', view: 'project-wizard' }] },
  settingsTabs: [{ id: 'project-wizard', label: 'Project wizard', icon: 'rocket', order: 37, description: 'What the New project wizard can reach from the console server: GitHub, VPS git, the workspace and allowed folders.' }],
  settingsPanels: [{ id: 'project-wizard.status', tab: 'project-wizard', title: 'Connections and folders', icon: 'info', order: 10, render: () => <SettingsPanel /> }],
};
