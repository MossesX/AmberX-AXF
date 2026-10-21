/**
 * The Sandbox page: GitHub (read-only), Pilot (Build Pilot's designer steps, saved only as sandbox files) and
 * Files (the person's own editable files). Nothing here can change real data: the server refuses anything else.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Icon, Note, SelectField, Switch, TextField, ChoiceGrid, useRuntime } from '@console/axf/react';
import { api, errText, fmtAgo, fmtBytes, gh, type FileText, type GhOp, type GhFile, type Me, type PilotCatalog, type SbFile } from './api';

type Tab = 'github' | 'pilot' | 'files';

export function SandboxView() {
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('github');
  const [files, setFiles] = useState<SbFile[]>([]);
  const [usage, setUsage] = useState({ files: 0, bytes: 0 });
  const [openPath, setOpenPath] = useState<string | null>(null);
  const rt = useRuntime();

  const loadMe = useCallback(() => api.call<Me>('me').then(setMe, (e) => setErr(errText(e))), []);
  const loadFiles = useCallback(() => api.call<{ files: SbFile[]; usage: { files: number; bytes: number } }>('files')
    .then((r) => { setFiles(r.files); setUsage(r.usage); }, () => undefined), []);
  useEffect(() => { void loadMe(); }, [loadMe]);
  useEffect(() => { if (me?.allowed) void loadFiles(); }, [me?.allowed, loadFiles]);

  const openFile = (p: string) => { setOpenPath(p); setTab('files'); };

  return (
    <div className="fx-stack fx-stack--lg axp-sandbox">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Signed in as {me?.user ?? '…'}</p>
          <h1>Sandbox</h1>
        </div>
        <div className="fx-row fx-row--wrap">
          <Chip tone="success"><Icon name="shield" /> Read-only</Chip>
          {me?.admin && <Button tone="ghost" icon="settings" onClick={() => rt.dispatch('settings.open:sandbox')}>Manage</Button>}
        </div>
      </header>
      <Note tone="info" icon="lock">
        Try anything here. GitHub is read-only, Pilot designs stay as sandbox files and nothing is built or published.
        Your files are yours alone and stay until an admin clears the sandbox.
      </Note>
      {err && <Note tone="danger">{err}</Note>}
      {me && !me.allowed && <Note tone="warning">{me.reason || 'The sandbox isn\'t open to you.'}</Note>}
      {me?.allowed && (
        <>
          <div className="fx-tabs" role="tablist" aria-label="Sandbox">
            {([['github', 'GitHub', 'github'], ['pilot', 'Pilot', 'rocket'], ['files', `Files (${usage.files})`, 'folder']] as [Tab, string, string][]).map(([id, label, icon]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`fx-tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>
                <Icon name={icon} /> {label}
              </button>
            ))}
          </div>
          {tab === 'github' && <GitHubTab me={me} onCopied={(p) => { void loadFiles(); openFile(p); }} />}
          {tab === 'pilot' && <PilotTab files={files} onSaved={(p) => { void loadFiles(); rt.toast?.(`Saved ${p} in your sandbox`, 'success'); }} />}
          {tab === 'files' && <FilesTab me={me} files={files} usage={usage} reload={loadFiles} openPath={openPath} setOpenPath={setOpenPath} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ GitHub (read-only) */

type GhSub = 'files' | 'commits' | 'branches' | 'pulls' | 'issues' | 'runs' | 'releases';
interface DirEntry { name: string; path: string; type: string; size?: number }
const ghLink = (u: unknown) => (typeof u === 'string' && u.startsWith('https://github.com/') ? u : null);

function GitHubTab({ me, onCopied }: { me: Me; onCopied: (path: string) => void }) {
  const repos = me.github.repos;
  const [repo, setRepo] = useState(repos[0] ?? '');
  const [sub, setSub] = useState<GhSub>('files');
  const [ref, setRef] = useState('');
  if (!me.github.ready) return <Note tone="warning">{me.github.reason}</Note>;
  if (!repos.length) return <Note tone="warning">No repositories are open in the sandbox yet. An admin adds them in Sandbox management.</Note>;
  return (
    <div className="fx-stack">
      <div className="axp-sandbox__bar">
        <SelectField label="Repository" value={repo} onChange={(v) => { setRepo(v); setRef(''); }} options={repos.map((r) => ({ value: r, label: r }))} />
        <TextField label="Branch, tag or commit" value={ref} onChange={setRef} placeholder="default branch" mono />
      </div>
      <div className="fx-tabs" role="tablist" aria-label="GitHub">
        {(['files', 'commits', 'branches', 'pulls', 'issues', 'runs', 'releases'] as GhSub[]).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={sub === s} className={`fx-tab ${sub === s ? 'is-active' : ''}`} onClick={() => setSub(s)}>
            {{ files: 'Files', commits: 'Commits', branches: 'Branches', pulls: 'Pull requests', issues: 'Issues', runs: 'Actions', releases: 'Releases' }[s]}
          </button>
        ))}
      </div>
      {sub === 'files' && <RepoFiles key={`${repo}@${ref}`} repo={repo} gitRef={ref} onCopied={onCopied} />}
      {sub !== 'files' && <RepoList key={`${repo}:${sub}:${ref}`} repo={repo} sub={sub} gitRef={ref} onPickBranch={(b) => { setRef(b); setSub('files'); }} />}
    </div>
  );
}

function RepoFiles({ repo, gitRef, onCopied }: { repo: string; gitRef: string; onCopied: (p: string) => void }) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [file, setFile] = useState<GhFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const openDir = useCallback((p: string) => {
    setBusy(true); setErr(''); setFile(null);
    gh<DirEntry[] | DirEntry>('contents', repo, { path: p, ...(gitRef ? { ref: gitRef } : {}) })
      .then((d) => { if (Array.isArray(d)) { setEntries([...d].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))); setPath(p); } else { void openFile(p); } },
        (e) => setErr(errText(e)))
      .finally(() => setBusy(false));
  }, [repo, gitRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFile = (p: string) => {
    setBusy(true); setErr('');
    return api.post<GhFile>('github/file', { repo, path: p, ref: gitRef || undefined }).then(setFile, (e) => setErr(errText(e))).finally(() => setBusy(false));
  };
  const copy = () => file && api.post<{ path: string }>('github/copy', { repo, path: file.path, ref: gitRef || undefined })
    .then((r) => onCopied(r.path), (e) => setErr(errText(e)));

  useEffect(() => { openDir(''); }, [openDir]);
  const crumbs = path ? path.split('/') : [];

  return (
    <Container title={<span className="axp-sandbox__crumbs">
      <button type="button" className="axp-sandbox__crumb" onClick={() => openDir('')}>{repo.split('/')[1]}</button>
      {crumbs.map((c, i) => <span key={i}> / <button type="button" className="axp-sandbox__crumb" onClick={() => openDir(crumbs.slice(0, i + 1).join('/'))}>{c}</button></span>)}
      {file && <span> / {file.path.split('/').pop()}</span>}
    </span>} icon="folder" actions={busy ? <span className="fx-small fx-muted">Loading…</span> : undefined}>
      {err && <Note tone="danger">{err}</Note>}
      {file ? (
        <div className="fx-stack">
          <div className="fx-row fx-row--wrap">
            <Button icon="arrow-left" tone="ghost" onClick={() => setFile(null)}>Back</Button>
            {file.isText && <Button icon="copy" tone="primary" onClick={() => void copy()}>Copy to my sandbox (editable)</Button>}
            {ghLink(file.htmlUrl) && <a className="fx-btn fx-btn--ghost" href={ghLink(file.htmlUrl)!} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open on GitHub</a>}
            <span className="fx-small fx-muted">{fmtBytes(file.size ?? 0)}</span>
          </div>
          {file.isText ? <pre className="axp-sandbox__code">{file.text}</pre> : <Note tone="info">This file isn't text (or is too big to show).</Note>}
        </div>
      ) : (
        <ul className="axp-sandbox__list">
          {(entries ?? []).map((e) => (
            <li key={e.path}>
              <button type="button" className="axp-sandbox__row" onClick={() => (e.type === 'dir' ? openDir(e.path) : void openFile(e.path))}>
                <Icon name={e.type === 'dir' ? 'folder' : 'file'} />
                <span className="axp-sandbox__grow">{e.name}</span>
                {e.type !== 'dir' && <span className="fx-small fx-muted">{fmtBytes(e.size ?? 0)}</span>}
              </button>
            </li>
          ))}
          {entries && !entries.length && <li className="fx-small fx-muted">Empty folder.</li>}
        </ul>
      )}
    </Container>
  );
}

interface Row { key: string; title: string; meta: string; link: string | null; tone?: 'success' | 'danger' | 'warning' | 'accent'; badge?: string; branch?: string }

function toRows(sub: GhSub, data: unknown): Row[] {
  const arr = Array.isArray(data) ? data : (data && typeof data === 'object' && Array.isArray((data as { workflow_runs?: unknown[] }).workflow_runs)) ? (data as { workflow_runs: unknown[] }).workflow_runs : [];
  return (arr as Record<string, any>[]).map((x, i): Row => { // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (sub) {
      case 'commits': return { key: String(x.sha ?? i), title: String(x.commit?.message ?? '').split('\n')[0] ?? '', meta: `${String(x.sha ?? '').slice(0, 7)} · ${x.commit?.author?.name ?? ''} · ${fmtAgo(x.commit?.author?.date)}`, link: ghLink(x.html_url) };
      case 'branches': return { key: String(x.name), title: String(x.name), meta: `${String(x.commit?.sha ?? '').slice(0, 7)}${x.protected ? ' · protected' : ''}`, link: null, branch: String(x.name) };
      case 'pulls': return { key: String(x.number), title: `#${x.number} ${x.title ?? ''}`, meta: `${x.user?.login ?? ''} · ${x.head?.ref ?? ''} → ${x.base?.ref ?? ''} · ${fmtAgo(x.updated_at)}`, link: ghLink(x.html_url), badge: x.draft ? 'draft' : x.state, tone: x.state === 'open' ? 'success' : undefined };
      case 'issues': return { key: String(x.number), title: `#${x.number} ${x.title ?? ''}`, meta: `${x.pull_request ? 'pull request · ' : ''}${x.user?.login ?? ''} · ${fmtAgo(x.updated_at)}`, link: ghLink(x.html_url), badge: x.state, tone: x.state === 'open' ? 'success' : undefined };
      case 'runs': return { key: String(x.id), title: `${x.name ?? ''} — ${x.display_title ?? ''}`, meta: `${x.head_branch ?? ''} · #${x.run_number ?? ''} · ${fmtAgo(x.updated_at)}`, link: ghLink(x.html_url),
        badge: x.status === 'completed' ? x.conclusion : x.status, tone: x.conclusion === 'success' ? 'success' : x.conclusion === 'failure' ? 'danger' : x.status !== 'completed' ? 'accent' : undefined };
      case 'releases': return { key: String(x.id), title: String(x.name || x.tag_name || ''), meta: `${x.tag_name ?? ''} · ${fmtAgo(x.published_at)}`, link: ghLink(x.html_url), badge: x.prerelease ? 'pre-release' : undefined };
      default: return { key: String(i), title: '', meta: '', link: null };
    }
  });
}

function RepoList({ repo, sub, gitRef, onPickBranch }: { repo: string; sub: GhSub; gitRef: string; onPickBranch: (b: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [state, setState] = useState('open');
  const [page, setPage] = useState(1);
  useEffect(() => {
    setRows(null); setErr('');
    const args: Record<string, unknown> = { per_page: 30, page };
    if (sub === 'commits' && gitRef) args.ref = gitRef;
    if (sub === 'runs' && gitRef) args.branch = gitRef;
    if (sub === 'pulls' || sub === 'issues') args.state = state;
    gh<unknown>(sub as GhOp, repo, args).then((d) => setRows(toRows(sub, d)), (e) => setErr(errText(e)));
  }, [repo, sub, gitRef, state, page]);
  return (
    <Container title={{ commits: 'Commits', branches: 'Branches', pulls: 'Pull requests', issues: 'Issues', runs: 'Actions runs', releases: 'Releases', files: '' }[sub]} icon="list"
      actions={(sub === 'pulls' || sub === 'issues') ? <SelectField label="State" value={state} onChange={(v) => { setState(v); setPage(1); }} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]} /> : undefined}>
      {err && <Note tone="danger">{err}</Note>}
      {!rows && !err && <p className="fx-small fx-muted">Loading…</p>}
      <ul className="axp-sandbox__list">
        {(rows ?? []).map((r) => (
          <li key={r.key} className="axp-sandbox__item">
            <div className="axp-sandbox__grow">
              <div className="axp-sandbox__title">{r.title || '(no title)'}</div>
              <div className="fx-small fx-muted">{r.meta}</div>
            </div>
            {r.badge && <Chip tone={r.tone}>{r.badge}</Chip>}
            {r.branch && <Button tone="ghost" icon="folder" onClick={() => onPickBranch(r.branch!)}>Browse</Button>}
            {r.link && <a className="fx-btn fx-btn--ghost" href={r.link} target="_blank" rel="noopener noreferrer" title="Open on GitHub"><Icon name="external" /></a>}
          </li>
        ))}
        {rows && !rows.length && <li className="fx-small fx-muted">Nothing here.</li>}
      </ul>
      {rows && (
        <div className="fx-row">
          <Button tone="ghost" icon="chevron-left" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
          <span className="fx-small fx-muted">Page {page}</span>
          <Button tone="ghost" icon="chevron-right" disabled={rows.length < 30} onClick={() => setPage((p) => p + 1)}>Older</Button>
        </div>
      )}
    </Container>
  );
}

/* ------------------------------------------------------------------ Pilot (designer steps, sandbox files only) */

export interface SandboxDesign {
  $axf: 'sandbox-design@1';
  name: string;
  template: string;
  boilerplate: string;
  slots: Record<string, string>;
  libraries: string[];
  options: Record<string, boolean>;
  notes: string;
  savedAt?: string;
}

type Step = 'app' | 'boilerplate' | 'look' | 'libraries' | 'options' | 'review';
const STEPS: [Step, string][] = [['app', 'App'], ['boilerplate', 'Boilerplate'], ['look', 'Look'], ['libraries', 'Libraries'], ['options', 'Build options'], ['review', 'Review']];
const LOOK_TYPES = ['color-theme', 'style-theme', 'layout', 'app-menu', 'toolbar', 'nav-menu', 'context-menu', 'banner', 'button', 'container', 'dialog', 'popup', 'slider'];
const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'design';

const blank = (cat: PilotCatalog | null): SandboxDesign => ({
  $axf: 'sandbox-design@1', name: 'My app', template: cat && 'react-ts' in cat.templates ? 'react-ts' : Object.keys(cat?.templates ?? {})[0] ?? '',
  boilerplate: '', slots: Object.fromEntries(LOOK_TYPES.filter((t) => cat?.defaults?.[t]).map((t) => [t, cat!.defaults[t] ?? ''])),
  libraries: [], options: Object.fromEntries(Object.entries(cat?.buildOptions ?? {}).map(([k, o]) => [k, o.default === true])), notes: '',
});

function PilotTab({ files, onSaved }: { files: SbFile[]; onSaved: (p: string) => void }) {
  const [cat, setCat] = useState<PilotCatalog | null>(null);
  const [err, setErr] = useState('');
  const [step, setStep] = useState<Step>('app');
  const [d, setD] = useState<SandboxDesign>(blank(null));
  const designs = useMemo(() => files.filter((f) => f.path.startsWith('pilot/') && f.path.endsWith('.design.json')), [files]);

  useEffect(() => { api.call<PilotCatalog>('pilot/catalog').then((c) => { setCat(c); setD(blank(c)); }, (e) => setErr(errText(e))); }, []);
  const set = (patch: Partial<SandboxDesign>) => setD((x) => ({ ...x, ...patch }));
  const load = (p: string) => api.call<FileText>(`file?path=${encodeURIComponent(p)}`).then((f) => {
    try { const j = JSON.parse(f.text) as SandboxDesign; if (j.$axf !== 'sandbox-design@1') throw new Error('not a sandbox design'); setD({ ...blank(cat), ...j }); setStep('review'); }
    catch (e) { setErr(errText(e)); }
  }, (e) => setErr(errText(e)));
  const save = () => {
    const path = `pilot/${slugName(d.name)}.design.json`;
    const body = { ...d, savedAt: new Date().toISOString() };
    api.put<{ path: string }>('file', { path, text: JSON.stringify(body, null, 2) }).then((r) => onSaved(r.path), (e) => setErr(errText(e)));
  };

  if (err && !cat) return <Note tone="danger">{err}</Note>;
  if (!cat) return <p className="fx-small fx-muted">Loading the framework catalog…</p>;
  const bpItems = cat.boilerplates.items;
  const at = STEPS.findIndex(([s]) => s === step);

  return (
    <div className="fx-stack">
      <Note tone="info" icon="rocket">Build Pilot's designer steps, on the framework's real catalog. A design is saved only in your sandbox files: nothing is built, published or sent to Build Pilot.</Note>
      {err && <Note tone="danger">{err}</Note>}
      {designs.length > 0 && (
        <div className="fx-row fx-row--wrap">
          <span className="fx-small fx-muted">Your designs:</span>
          {designs.map((f) => <Button key={f.path} tone="ghost" icon="file" onClick={() => void load(f.path)}>{f.path.slice(6, -12)}</Button>)}
          <Button tone="ghost" icon="plus" onClick={() => { setD(blank(cat)); setStep('app'); }}>New</Button>
        </div>
      )}
      <div className="fx-tabs" role="tablist" aria-label="Design steps">
        {STEPS.map(([s, label], i) => (
          <button key={s} type="button" role="tab" aria-selected={step === s} className={`fx-tab ${step === s ? 'is-active' : ''}`} onClick={() => setStep(s)}>{i + 1}. {label}</button>
        ))}
      </div>

      {step === 'app' && (
        <Container title="App" icon="box">
          <div className="fx-stack">
            <TextField label="Name" value={d.name} onChange={(v) => set({ name: v.slice(0, 60) })} />
            <SelectField label="Template (stack)" value={d.template} onChange={(v) => set({ template: v })}
              options={Object.entries(cat.templates).map(([id, t]) => ({ value: id, label: `${t.label} (${id})` }))} />
            <TextField label="Notes" value={d.notes} onChange={(v) => set({ notes: v.slice(0, 2000) })} rows={3} />
          </div>
        </Container>
      )}
      {step === 'boilerplate' && (
        <Container title="Boilerplate" icon="layers">
          <ChoiceGrid label="Boilerplate" selected={d.boilerplate ? [d.boilerplate] : []} onToggle={(id) => set({ boilerplate: d.boilerplate === id ? '' : id })}
            choices={bpItems.map((b) => ({ id: b.id, title: b.name, text: b.description, tag: cat.boilerplates.categories.find((c) => c.id === b.category)?.label ?? b.status }))} />
        </Container>
      )}
      {step === 'look' && (
        <Container title="Look" icon="palette">
          <div className="axp-sandbox__grid">
            {LOOK_TYPES.filter((t) => cat.assets[t]?.length).map((t) => (
              <SelectField key={t} label={t} value={d.slots[t] ?? ''} empty="(framework default)" onChange={(v) => set({ slots: { ...d.slots, [t]: v } })}
                options={(cat.assets[t] ?? []).map((a) => ({ value: a.id, label: a.name ?? a.id }))} />
            ))}
          </div>
        </Container>
      )}
      {step === 'libraries' && (
        <Container title="Libraries" icon="package">
          <ChoiceGrid label="Libraries" multiple selected={d.libraries}
            onToggle={(id) => set({ libraries: d.libraries.includes(id) ? d.libraries.filter((x) => x !== id) : [...d.libraries, id] })}
            choices={cat.libraries.map((l) => ({ id: l.id, title: l.name, text: l.description, tag: l.dependsOn.length ? `needs ${l.dependsOn.length}` : undefined }))} />
        </Container>
      )}
      {step === 'options' && (
        <Container title="Build options" icon="sliders">
          <div className="fx-stack">
            {Object.entries(cat.buildOptions).map(([k, o]) => (
              <Switch key={k} label={`--${k}${o.label ? ` · ${o.label}` : ''}`} hint={o.description} checked={!!d.options[k]} onChange={(v) => set({ options: { ...d.options, [k]: v } })} />
            ))}
            {!Object.keys(cat.buildOptions).length && <p className="fx-small fx-muted">No build options yet.</p>}
          </div>
        </Container>
      )}
      {step === 'review' && (
        <Container title="Review" icon="check-circle" actions={<Button tone="primary" icon="save" onClick={save}>Save to my sandbox</Button>}>
          <div className="fx-stack">
            <Note tone="warning" icon="lock">Building and publishing are off in the sandbox. Take this design to Build Pilot to build it for real.</Note>
            <pre className="axp-sandbox__code">{JSON.stringify(d, null, 2)}</pre>
          </div>
        </Container>
      )}
      <div className="fx-row">
        <Button tone="ghost" icon="chevron-left" disabled={at <= 0} onClick={() => { const s = STEPS[at - 1]; if (s) setStep(s[0]); }}>Back</Button>
        <Button tone="ghost" icon="chevron-right" disabled={at >= STEPS.length - 1} onClick={() => { const s = STEPS[at + 1]; if (s) setStep(s[0]); }}>Next</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Files (the person's own) */

function FilesTab({ me, files, usage, reload, openPath, setOpenPath }: {
  me: Me; files: SbFile[]; usage: { files: number; bytes: number }; reload: () => Promise<void>; openPath: string | null; setOpenPath: (p: string | null) => void;
}) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [err, setErr] = useState('');
  const [newName, setNewName] = useState('');
  const [rename, setRename] = useState('');
  const dirty = openPath !== null && text !== saved;

  useEffect(() => {
    setErr('');
    if (!openPath) { setText(''); setSaved(''); return; }
    api.call<FileText>(`file?path=${encodeURIComponent(openPath)}`).then((f) => { setText(f.text); setSaved(f.text); setRename(f.path); }, (e) => setErr(errText(e)));
  }, [openPath]);

  const save = () => openPath && api.put('file', { path: openPath, text }).then(() => { setSaved(text); void reload(); }, (e) => setErr(errText(e)));
  const create = () => {
    const p = newName.trim();
    if (!p) return;
    api.put('file', { path: p, text: '', create: true }).then(() => { setNewName(''); void reload(); setOpenPath(p); }, (e) => setErr(errText(e)));
  };
  const doRename = () => openPath && rename !== openPath && api.post<{ path: string }>('file/rename', { from: openPath, to: rename })
    .then((r) => { void reload(); setOpenPath(r.path); }, (e) => setErr(errText(e)));
  const remove = () => openPath && window.confirm(`Delete ${openPath} from your sandbox?`) && api.del(`file?path=${encodeURIComponent(openPath)}`)
    .then(() => { setOpenPath(null); void reload(); }, (e) => setErr(errText(e)));
  const download = () => {
    if (!openPath) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = openPath.split('/').pop() || 'file.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const pct = Math.min(100, Math.round((usage.bytes / (me.limits.maxTotalMb * 1024 * 1024)) * 100));

  return (
    <div className="axp-sandbox__split">
      <Container title="My files" icon="folder" actions={<span className="fx-small fx-muted">{usage.files}/{me.limits.maxFiles} · {fmtBytes(usage.bytes)}</span>}>
        <div className="fx-stack">
          <div className="axp-sandbox__meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Sandbox space used">
            <span className="axp-sandbox__meter-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="axp-sandbox__bar">
            <TextField label="New file" value={newName} onChange={setNewName} placeholder="notes/idea.md" mono />
            <Button icon="plus" onClick={create} disabled={!newName.trim()}>Create</Button>
          </div>
          <ul className="axp-sandbox__list">
            {files.map((f) => (
              <li key={f.path}>
                <button type="button" className={`axp-sandbox__row ${openPath === f.path ? 'is-active' : ''}`} onClick={() => setOpenPath(f.path)}>
                  <Icon name="file" /><span className="axp-sandbox__grow fx-mono">{f.path}</span><span className="fx-small fx-muted">{fmtBytes(f.size)}</span>
                </button>
              </li>
            ))}
            {!files.length && <li className="fx-small fx-muted">No files yet. Create one, copy one from GitHub, or save a Pilot design.</li>}
          </ul>
        </div>
      </Container>
      <Container title={openPath ?? 'Editor'} icon="edit" actions={openPath ? <span className="fx-small fx-muted">{dirty ? 'Unsaved changes' : 'Saved'}</span> : undefined}>
        {err && <Note tone="danger">{err}</Note>}
        {openPath ? (
          <div className="fx-stack">
            <TextField label="Contents" value={text} onChange={setText} rows={18} mono />
            <div className="fx-row fx-row--wrap">
              <Button tone="primary" icon="save" onClick={() => void save()} disabled={!dirty}>Save</Button>
              <Button tone="ghost" icon="download" onClick={download}>Download</Button>
              <Button tone="danger" icon="trash" onClick={() => void remove()}>Delete</Button>
            </div>
            <div className="axp-sandbox__bar">
              <TextField label="Rename / move" value={rename} onChange={setRename} mono />
              <Button icon="edit" onClick={() => void doRename()} disabled={!rename || rename === openPath}>Rename</Button>
            </div>
          </div>
        ) : <p className="fx-small fx-muted">Pick a file to edit it.</p>}
      </Container>
    </div>
  );
}
