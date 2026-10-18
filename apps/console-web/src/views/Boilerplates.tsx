import { useState } from 'react';
import { Button, Chip, Container, Icon, Slider, useRuntime } from '../axf/react';
import { BUILD_OPTIONS, buildOptionFlags, resolveBuildOptions, type BuildOptionValues } from '../axf/core';
import { useStore } from '../store';
import * as api from '../api';
import type { Boilerplate, BoilerplateScreen } from '../api';

const SCREEN_KINDS = ['landing', 'list-detail', 'dashboard', 'settings', 'feed', 'editor', 'player', 'map', 'chat', 'profile', 'wizard', 'custom'];

/** Boilerplate manager: browse by category, assemble a new one from catalog features with a live preview, import third-party boilerplates for porting, build an app from one. */
export function Boilerplates() {
  const [mode, setMode] = useState<'browse' | 'build' | 'import'>('browse');
  return (
    <div className="fx-stack fx-stack--lg">
      <div className="fx-row">{(['browse', 'build', 'import'] as const).map((m) => <button key={m} className={`fx-chip ${mode === m ? 'is-selected' : ''}`} onClick={() => setMode(m)}>{m === 'browse' ? 'Browse' : m === 'build' ? 'Build a boilerplate' : 'Import third-party'}</button>)}</div>
      {mode === 'browse' ? <Browse /> : mode === 'build' ? <Build /> : <Import />}
    </div>
  );
}

function Browse() {
  const s = useStore();
  const rt = useRuntime();
  const [cat, setCat] = useState('all');
  const [sel, setSel] = useState<string | null>(null);
  const cats = [{ id: 'all', label: 'All' }, ...s.boilerplateIndex.categories, { id: 'custom', label: 'My boilerplates' }];
  const list = s.boilerplates.filter((b) => cat === 'all' || b.category === cat || (cat === 'custom' && b.source === 'console'));
  const cur = s.boilerplates.find((b) => b.id === sel) ?? list[0];
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">{s.boilerplates.length} boilerplates · {s.boilerplateIndex.categories.length} categories</p><h1>Boilerplates</h1><p className="fx-muted">Categorized starting points built on the framework. Pick one, preview its screens live, and create an app from it.</p></div></header>
      <div className="fx-row fx-row--wrap">{cats.map((c) => <button key={c.id} className={`fx-chip ${cat === c.id ? 'is-selected' : ''}`} onClick={() => setCat(c.id)}>{c.label}</button>)}</div>
      <div className="cx-panes fx-grid">
        <Container title="Catalog" icon="package">
          <ul className="cx-list">{list.map((b) => <li key={b.id} className={`cx-item ${cur?.id === b.id ? 'is-selected' : ''}`} onClick={() => setSel(b.id)} style={{ cursor: 'pointer' }}><Icon name="layout" /><div className="fx-grow">{b.name}<div className="fx-muted fx-small">{b.description} · {b.screens.length} screens · {b.features.length} features{b.libraries?.length ? ` · libraries: ${b.libraries.map((l) => (typeof l === 'string' ? l : l.library)).join(', ')}` : ''}</div></div><Chip tone={b.status === 'built' ? 'success' : b.source === 'import' ? 'warning' : undefined}>{b.source === 'import' ? 'imported' : b.status}</Chip></li>)}</ul>
        </Container>
        {cur && <Container title={`Preview — ${cur.name}`} icon="eye" actions={<Button tone="primary" icon="rocket" onClick={() => rt.openDialog('newapp', { boilerplate: cur.id })}>Create app</Button>}><PreviewPane b={cur} /></Container>}
      </div>
    </div>
  );
}

/** Live preview: a phone frame cycling through the boilerplate's screens, rendered with the active assets (so hot swaps restyle it). */
export function PreviewPane({ b }: { b: Boilerplate }) {
  const [i, setI] = useState(0);
  const screen = b.screens[i] ?? b.screens[0];
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">{b.screens.map((sc, k) => <button key={sc.id} className={`fx-chip ${k === i ? 'is-selected' : ''}`} onClick={() => setI(k)}>{sc.label} <span className="fx-muted fx-small">{sc.kind}</span></button>)}</div>
      <div className="cx-phone">{screen ? <ScreenKindPreview s={screen} /> : <div className="fx-empty">No screens</div>}</div>
      <p className="fx-muted fx-small" style={{ margin: 0 }}>Features: {b.features.join(', ') || '—'} · modules: {b.modules.join(', ') || '—'} · defaults: {Object.entries(b.defaults).map(([k, v]) => `${k}=${v}`).join(' ') || 'framework'}</p>
    </div>
  );
}

function ScreenKindPreview({ s }: { s: BoilerplateScreen }) {
  const rows = (n: number) => Array.from({ length: n }, (_, k) => <div key={k} className="cx-item"><Icon name="file" /><div className="fx-grow">Item {k + 1}<div className="fx-muted fx-small">Subtitle</div></div><Chip>{k === 0 ? 'new' : ''}</Chip></div>);
  switch (s.kind) {
    case 'landing': return <div className="fx-stack" style={{ alignItems: 'center', textAlign: 'center' }}><span className="cx-brandmark" /><h3 style={{ margin: 0 }}>{s.label}</h3><p className="fx-muted fx-small">Landing / loading screen with brand mark and primary action</p><Button tone="primary">Get started</Button></div>;
    case 'list-detail': return <div className="fx-stack"><div className="fx-search"><Icon name="search" /><input placeholder={`Search ${s.label.toLowerCase()}`} readOnly /></div>{rows(4)}</div>;
    case 'dashboard': return <div className="fx-stack"><div className="fx-grid cx-tiles">{['Users', 'Revenue', 'Errors', 'Uptime'].map((t, k) => <Container key={t} title={t}><strong>{[1284, '$9.1k', 3, '99.98%'][k]}</strong></Container>)}</div><div className="cx-chart">{[40, 70, 55, 90, 30, 60].map((h, k) => <span key={k} style={{ height: `${h}%` }} />)}</div></div>;
    case 'settings': return <div className="fx-stack">{['Appearance', 'Account', 'Notifications', 'Privacy'].map((t) => <div key={t} className="cx-item"><Icon name="settings" /><div className="fx-grow">{t}</div><label className="cx-switch"><input type="checkbox" defaultChecked readOnly /><span /></label></div>)}</div>;
    case 'feed': return <div className="fx-stack">{[1, 2].map((k) => <Container key={k} title={`Post ${k}`} icon="user"><div className="cx-imageph" /><p className="fx-small fx-muted" style={{ margin: 0 }}>Caption text for the feed post.</p></Container>)}</div>;
    case 'editor': return <div className="fx-stack"><div className="fx-row">{['B', 'I', 'U', '•', '#'].map((t) => <button key={t} className="fx-iconbtn">{t}</button>)}</div><textarea className="fx-input fx-mono" rows={8} readOnly defaultValue={`# ${s.label}\n\nType here…`} /></div>;
    case 'player': return <div className="fx-stack"><div className="cx-video"><Icon name="play" size={28} /></div><Slider label="Position" value={35} onChange={() => {}} /><div className="fx-row" style={{ justifyContent: 'center' }}><button className="fx-iconbtn"><Icon name="chevron-left" /></button><Button tone="primary" icon="play">Play</Button><button className="fx-iconbtn"><Icon name="chevron-right" /></button></div></div>;
    case 'map': return <div className="fx-stack"><div className="cx-map"><span className="cx-pin" /></div><div className="cx-item"><Icon name="monitor" /><div className="fx-grow">Current location<div className="fx-muted fx-small">42.36, -71.06 · 12 m</div></div></div></div>;
    case 'chat': return <div className="fx-stack">{['Hello!', 'Hi — how can I help?', 'Show me the framework'].map((m, k) => <div key={k} className={`cx-bubble ${k % 2 ? 'is-me' : ''}`}>{m}</div>)}<input className="fx-input" placeholder="Message" readOnly /></div>;
    case 'profile': return <div className="fx-stack" style={{ alignItems: 'center' }}><span className="cx-avatar" /><strong>Jane Doe</strong><span className="fx-muted fx-small">jane@example.com</span><div className="fx-row"><Button>Edit</Button><Button tone="primary">Share</Button></div></div>;
    case 'wizard': return <div className="fx-stack"><div className="fx-row">{[1, 2, 3].map((k) => <span key={k} className={`fx-badge ${k === 1 ? 'is-selected' : ''}`}>{k}</span>)}</div><h4 style={{ margin: 0 }}>Step 1 — {s.label}</h4><input className="fx-input" placeholder="Answer" readOnly /><div className="fx-row fx-row--end"><Button>Back</Button><Button tone="primary" icon="arrow-right">Next</Button></div></div>;
    default: return <div className="fx-empty">{s.label} — custom screen</div>;
  }
}

/** Assemble a boilerplate: check required features from the catalog, add screens (kind + label), pick libraries; the preview pane renders live. */
function Build() {
  const s = useStore();
  const rt = useRuntime();
  const [b, setB] = useState<Boilerplate>({ id: 'my-app', name: 'My App', category: 'productivity', description: '', features: [], screens: [{ id: 'home', label: 'Home', kind: 'landing' }, { id: 'settings', label: 'Settings', kind: 'settings' }], modules: [], libraries: [], defaults: {}, status: 'planned', source: 'console' });
  const [q, setQ] = useState('');
  const items = s.catalog.tabs.flatMap((t) => t.groups.flatMap((g) => g.items));
  const needle = q.toLowerCase();
  const patch = (p: Partial<Boilerplate>) => setB({ ...b, ...p });
  const toggleF = (id: string) => patch({ features: b.features.includes(id) ? b.features.filter((x) => x !== id) : [...b.features, id] });
  const toggleL = (slug: string) => patch({ libraries: (b.libraries ?? []).some((l) => (typeof l === 'string' ? l : l.library) === slug) ? (b.libraries ?? []).filter((l) => (typeof l === 'string' ? l : l.library) !== slug) : [...(b.libraries ?? []), { library: slug }] });
  return (
    <div className="cx-panes fx-grid">
      <div className="fx-stack">
        <Container title="Boilerplate" icon="package">
          <div className="fx-grid cx-tiles"><label className="fx-field">Id<input className="fx-input fx-mono" value={b.id} onChange={(e) => patch({ id: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-') })} /></label><label className="fx-field">Name<input className="fx-input" value={b.name} onChange={(e) => patch({ name: e.target.value })} /></label></div>
          <label className="fx-field">Description<input className="fx-input" value={b.description} onChange={(e) => patch({ description: e.target.value })} /></label>
          <div className="fx-row fx-row--wrap">{s.boilerplateIndex.categories.map((c) => <button key={c.id} className={`fx-chip ${b.category === c.id ? 'is-selected' : ''}`} onClick={() => patch({ category: c.id })}>{c.label}</button>)}</div>
        </Container>
        <Container title="Screens" icon="layout" actions={<Button icon="plus" onClick={() => patch({ screens: [...b.screens, { id: `screen-${b.screens.length + 1}`, label: `Screen ${b.screens.length + 1}`, kind: 'list-detail' }] })}>Add</Button>}>
          {b.screens.map((sc, i) => <div key={i} className="fx-row"><input className="fx-input" value={sc.label} onChange={(e) => patch({ screens: b.screens.map((x, k) => (k === i ? { ...x, label: e.target.value, id: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') } : x)) })} /><select className="fx-input" value={sc.kind} onChange={(e) => patch({ screens: b.screens.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)) })}>{SCREEN_KINDS.map((k) => <option key={k}>{k}</option>)}</select><button className="fx-iconbtn" onClick={() => patch({ screens: b.screens.filter((_, k) => k !== i) })}><Icon name="x" /></button></div>)}
        </Container>
        <Container title="Libraries (installed with their wizard defaults)" icon="download"><div className="fx-row fx-row--wrap">{s.libraries.map((l) => { const slug = l.module.replace(/^lib-/, ''); const on = (b.libraries ?? []).some((x) => (typeof x === 'string' ? x : x.library) === slug); return <button key={l.id} className={`fx-chip ${on ? 'is-selected' : ''}`} title={l.description} onClick={() => toggleL(slug)}>{l.name}</button>; })}{s.libraries.length === 0 && <span className="fx-muted fx-small">No installable libraries found.</span>}</div></Container>
        <Container title={`Required features (${b.features.length})`} icon="layers" actions={<input className="fx-input" placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 180 }} />}>
          <div className="cx-scroll">{items.filter((i) => !needle || i.title.toLowerCase().includes(needle) || i.id.includes(needle)).slice(0, 120).map((i) => <label key={i.id} className="cx-item" style={{ cursor: 'pointer' }}><input type="checkbox" checked={b.features.includes(i.id)} onChange={() => toggleF(i.id)} /><span className="fx-grow">{i.title} <span className="fx-muted fx-mono fx-small">{i.id}</span></span><Chip tone={api.statusTone(s.status(i.id))}>{s.status(i.id)}</Chip></label>)}</div>
        </Container>
        <div className="fx-row fx-row--end"><Button icon="copy" onClick={() => navigator.clipboard?.writeText(JSON.stringify({ $axf: 'boilerplate@1', ...b }, null, 2)).then(() => rt.toast('boilerplate.json copied.', 'success'))}>Copy JSON</Button><Button tone="primary" icon="save" onClick={() => { s.saveBoilerplate(b); rt.toast(`${b.name} saved${s.backend ? ' to framework/boilerplates' : ' locally'}.`, 'success'); }}>Save boilerplate</Button><Button icon="rocket" onClick={() => { s.saveBoilerplate(b); rt.openDialog('newapp', { boilerplate: b.id }); }}>Create app</Button></div>
      </div>
      <Container title="Live preview" icon="eye"><PreviewPane b={b} /></Container>
    </div>
  );
}

/** Stage a third-party boilerplate (its screens + stack) for porting to AXF: the engine's templates map the screens to AXF screen kinds. */
function Import() {
  const s = useStore();
  const rt = useRuntime();
  const [src, setSrc] = useState({ name: '', url: '', stack: 'react-ts', screens: 'home:landing, items:list-detail, settings:settings', notes: '' });
  const screens = src.screens.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [id, kind = 'custom'] = x.split(':').map((y) => y.trim()); return { id: id!, label: id![0]!.toUpperCase() + id!.slice(1), kind }; });
  const b: Boilerplate = { id: src.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported', name: src.name || 'Imported boilerplate', category: 'starter', description: `${src.notes || 'Imported'} (from ${src.url || src.stack})`, features: [], screens, modules: [], libraries: [], defaults: {}, status: 'planned', source: 'import' };
  return (
    <div className="cx-panes fx-grid">
      <Container title="Third-party boilerplate" icon="upload">
        <label className="fx-field">Name<input className="fx-input" value={src.name} onChange={(e) => setSrc({ ...src, name: e.target.value })} placeholder="Vendor Starter Kit" /></label>
        <label className="fx-field">Repository / package URL<input className="fx-input fx-mono" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} placeholder="https://github.com/vendor/starter" /></label>
        <div className="fx-row fx-row--wrap">{['react-ts', 'next', 'android-compose', 'flutter', 'pyqt6', 'other'].map((k) => <button key={k} className={`fx-chip ${src.stack === k ? 'is-selected' : ''}`} onClick={() => setSrc({ ...src, stack: k })}>{k}</button>)}</div>
        <label className="fx-field">Screens (id:kind, …)<input className="fx-input fx-mono" value={src.screens} onChange={(e) => setSrc({ ...src, screens: e.target.value })} /></label>
        <label className="fx-field">Porting notes<textarea className="fx-input" rows={3} value={src.notes} onChange={(e) => setSrc({ ...src, notes: e.target.value })} placeholder="What to keep, what maps to which AXF library…" /></label>
        <div className="fx-row fx-row--end"><Button tone="primary" icon="download" disabled={!src.name} onClick={() => { s.saveBoilerplate(b); rt.terminal.log('import', `boilerplate "${b.name}" staged for porting (${screens.length} screens, stack ${src.stack})`); rt.toast(`${b.name} staged for porting.`, 'success'); }}>Stage for porting</Button></div>
      </Container>
      <Container title="How it will port" icon="eye"><PreviewPane b={b} /><p className="fx-muted fx-small">Screens become AXF screen kinds with placeholder views; the stack decides the template (react-ts / android-compose); features you check later drive which libraries get installed.</p></Container>
    </div>
  );
}

/** Dialog `newapp`: create an app from a boilerplate through the build engine (template + libraries + screens). */
export function NewAppDialog({ boilerplateId, close }: { boilerplateId: string; close: () => void }) {
  const s = useStore();
  const rt = useRuntime();
  const b = s.boilerplates.find((x) => x.id === boilerplateId);
  const [name, setName] = useState(b?.name ?? 'My App');
  const [template, setTemplate] = useState<'react-ts' | 'android-compose'>('react-ts');
  const [dir, setDir] = useState(`apps/${boilerplateId}`);
  const [log, setLog] = useState('');
  const [options, setOptions] = useState<BuildOptionValues>(() => resolveBuildOptions());
  if (!b) return <p>Unknown boilerplate.</p>;
  const flags = buildOptionFlags(options);
  const script = `node framework/cli/axf.mjs init ${dir} --name "${name}" --template ${template} --boilerplate ${b.id}${flags ? ` ${flags}` : ''}`;
  const run = async () => {
    rt.terminal.log('init', `▶ ${name} from ${b.id} (${template}) → ${dir}`); rt.dispatch('terminal.open:init');
    const r = await api.post('init', { dir, name, template, boilerplate: b.id, options, libraries: (b.libraries ?? []).map((l) => (typeof l === 'string' ? { library: l } : l)) });
    if (r.log) rt.terminal.many('init', r.log);
    if (r.ok) { rt.terminal.ok('init', `${name} created at ${String(r.dir)}`); s.openProject(String(r.dir)); } else { rt.terminal.error('init', r.error ?? 'failed'); if (!s.backend) rt.terminal.many('init', script); }
    setLog(r.ok ? `✓ ${String(r.dir)} — project opened` : `✗ ${r.error}`);
    s.addPort({ id: `init-${b.id}-${Date.now().toString(36)}`, kind: 'init', name, source: `boilerplate ${b.id} · ${template}`, project: dir, status: r.ok ? 'created' : 'recorded', createdAt: new Date().toISOString(), log: r.ok ? JSON.stringify(r.log ?? []) : script });
    rt.toast(r.ok ? `${name} created and opened as the project.` : r.error ?? 'Recorded', r.ok ? 'success' : 'warning');
  };
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}><strong>{b.name}</strong> <span className="fx-muted fx-small">{b.screens.length} screens · {b.features.length} features · libraries {(b.libraries ?? []).map((l) => (typeof l === 'string' ? l : l.library)).join(', ') || '—'}</span></p>
      <label className="fx-field">App name<input className="fx-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="fx-row">{(['react-ts', 'android-compose'] as const).map((t) => <button key={t} className={`fx-chip ${template === t ? 'is-selected' : ''}`} onClick={() => setTemplate(t)}>{t}</button>)}</div>
      <label className="fx-field">Directory<input className="fx-input fx-mono" value={dir} onChange={(e) => setDir(e.target.value)} /></label>
      <fieldset className="fx-stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="fx-muted fx-small">Build options</legend>
        {Object.entries(BUILD_OPTIONS).map(([n, o]) => (
          <label key={n} className="fx-row" style={{ gap: 'calc(var(--fx-space) * 0.75)', alignItems: 'flex-start' }} title={o.description}>
            <input id={`newapp-opt-${n}`} type="checkbox" checked={!!options[n]} onChange={(e) => setOptions({ ...options, [n]: e.target.checked })} />
            <span>{o.label} <span className="fx-mono fx-muted fx-small">--{n}</span><br /><span className="fx-muted fx-small">{o.description}</span></span>
          </label>
        ))}
      </fieldset>
      <pre className="fx-code" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{script}{log ? `\n${log}` : ''}</pre>
      <div className="fx-row fx-row--end"><Button icon="copy" onClick={() => navigator.clipboard?.writeText(script).then(() => rt.toast('Command copied.', 'success'))}>Copy</Button><Button tone="primary" icon="rocket" onClick={run}>{s.backend ? 'Create app' : 'Record'}</Button><Button onClick={close}>Close</Button></div>
    </div>
  );
}
