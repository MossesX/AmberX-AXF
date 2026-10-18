import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Icon, useRuntime } from '../axf/react';
import { useStore } from '../store';
import * as api from '../api';
import type { EngineResult, LibraryTemplate } from '../api';

const PORTS = ['android', 'web', 'python'] as const;
type Port = (typeof PORTS)[number];
const now = () => new Date().toISOString();
const slugOf = (s: string) => s.toLowerCase().replace(/^lib-/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pascal = (slug: string) => slug.split('-').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');

/** Echo the engine's log on the output terminal and open it. */
function report(rt: ReturnType<typeof useRuntime>, r: EngineResult, ok: string) {
  if (r.log) rt.terminal.many('libraries', r.log);
  if (r.ok) rt.terminal.ok('libraries', ok); else rt.terminal.error('libraries', r.error ?? 'failed');
}

/**
 * Library templates: boilerplates for building new libraries. Each template generates an Android module,
 * a web library and a Python package from the same parameters; generated libraries can be compiled per port
 * and ported to a port they don't have yet.
 */
export function LibraryTemplates() {
  const rt = useRuntime();
  const s = useStore();
  const [templates, setTemplates] = useState<LibraryTemplate[]>([]);
  const [sel, setSel] = useState<string>('feature-screens');
  const [cat, setCat] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api.loadLibraryTemplates().then(setTemplates, (e) => rt.terminal.error('libraries', String(e))); }, [rt]);
  const cats = useMemo(() => ['all', ...new Set(templates.map((t) => t.category))], [templates]);
  const cur = templates.find((t) => t.id === sel) ?? templates[0];
  const generated = s.libraries.filter((l) => (l as unknown as { template?: string }).template);

  const compile = async (slug: string, name: string) => {
    setBusy(slug);
    rt.terminal.log('libraries', `▶ compile ${name}`); rt.dispatch('terminal.open:libraries');
    const r = await api.post('compile-library', { slug });
    report(rt, r, `${name} compile finished`);
    const results = (r.results ?? {}) as Record<string, { status: string; output: string }>;
    for (const [p, x] of Object.entries(results)) rt.terminal.log('libraries', `${p}: ${x.status}${x.output ? ` — ${x.output.split('\n')[0]}` : ''}`, x.status === 'passed' ? 'ok' : x.status === 'failed' ? 'error' : 'warn');
    if (!r.ok && !s.backend) rt.terminal.many('libraries', `node framework/cli/axf.mjs compile-library ${slug}`);
    setBusy(null); s.refresh();
  };
  const port = async (slug: string, name: string, to: Port) => {
    setBusy(slug);
    rt.terminal.log('libraries', `▶ port ${name} → ${to}`); rt.dispatch('terminal.open:libraries');
    const r = await api.post('port-library', { slug, to });
    report(rt, r, `${name} ported to ${to}`);
    if (!r.ok && !s.backend) rt.terminal.many('libraries', `node framework/cli/axf.mjs port-library ${slug} --to ${to}`);
    s.addPort({ id: `port-${slug}-${to}-${Date.now().toString(36)}`, kind: 'build', name: `${name} → ${to}`, source: slug, project: '', status: r.ok ? 'ported' : 'recorded', createdAt: now(), log: JSON.stringify(r.log ?? []) });
    setBusy(null); s.refresh();
  };

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">{templates.length} templates · Android + web + Python · {generated.length} generated libraries</p><h1>Library templates</h1>
          <p className="fx-muted">Boilerplates for libraries. Pick a template, name the library and choose its ports: the build engine generates an Android module, a web library and a Python package from the same parameters, registers them, and compiles each one. Libraries made here can be ported to a port they're missing.</p></div>
        <div className="fx-row fx-row--wrap"><Button tone="primary" icon="plus" disabled={!cur} onClick={() => cur && rt.openDialog('newlib', { template: cur.id })}>New library</Button><Button icon="terminal" onClick={() => rt.dispatch('terminal.open:libraries')}>Terminal</Button></div>
      </header>
      <div className="fx-row fx-row--wrap">{cats.map((c) => <button key={c} className={`fx-chip ${cat === c ? 'is-selected' : ''}`} onClick={() => setCat(c)}>{c === 'all' ? 'All' : c}</button>)}</div>
      <div className="lt-grid">
        <div className="lt-list">{templates.filter((t) => cat === 'all' || t.category === cat).map((t) => (
          <button key={t.id} className={`lt-card ${cur?.id === t.id ? 'is-selected' : ''}`} onClick={() => setSel(t.id)}>
            <span className="lt-card__icon"><Icon name={t.icon} size={20} /></span>
            <span className="lt-card__body"><strong>{t.name}</strong><span className="fx-muted fx-small">{t.description}</span>
              <span className="fx-row fx-row--wrap" style={{ gap: 'calc(var(--fx-space) * 0.5)' }}>{t.produces.map((p) => <span key={p} className="fx-badge">{p}</span>)}</span></span>
          </button>))}</div>
        {cur && <Container title={cur.name} icon={cur.icon} actions={<Button tone="primary" icon="plus" onClick={() => rt.openDialog('newlib', { template: cur.id })}>Use template</Button>}>
          <p className="fx-muted" style={{ marginTop: 0 }}>{cur.description}</p>
          {cur.params.length > 0 && <><p className="fx-eyebrow">Parameters</p><ul className="lt-params">{cur.params.map((p) => <li key={p.key}><span className="fx-mono">{p.key}</span> — {p.label} <span className="fx-muted">(default {String(p.default ?? '—')})</span></li>)}</ul></>}
          {cur.deps.length > 0 && <p className="fx-small">Depends on <span className="fx-mono">{cur.deps.join(', ')}</span></p>}
          <p className="fx-eyebrow">Files it generates</p>
          <div className="lt-files">{PORTS.map((p) => (
            <div key={p}><strong className="fx-small">{p}</strong><ul>{(cur.files[p] ?? []).map((f) => <li key={f} className="fx-mono fx-small">{p === 'android' ? f.replace('kotlin/', 'src/main/kotlin/<package>/').replace('AndroidManifest.xml', 'src/main/AndroidManifest.xml').replace('{{CLASS}}', '<Name>') : p === 'web' ? `framework/libs/<slug>/${f}` : `framework/python/axf_libs/<slug>/${f}`}</li>)}<li className="fx-mono fx-small fx-muted">library.json</li></ul></div>))}</div>
        </Container>}
      </div>

      <Container title="Libraries generated from templates" icon="box" actions={<Chip>{generated.length}</Chip>}>
        {generated.length === 0 ? <p className="fx-muted" style={{ margin: 0 }}>None yet. Use a template above; its libraries show up here with compile and port actions.</p> : (
          <table className="fx-table"><tbody>{generated.map((l) => { const lib = l as unknown as { id: string; name: string; module: string; template: string; ports?: Record<string, { status: string }> }; const slug = lib.module.replace(/^lib-/, ''); return (
            <tr key={lib.id}><th>{lib.name}<div className="fx-mono fx-small fx-muted">{lib.module} · {lib.template}</div></th>
              <td>{PORTS.map((p) => { const st = lib.ports?.[p]?.status; return st ? <Chip key={p} tone={st === 'compiled' ? 'success' : st === 'failed' ? 'danger' : 'accent'}>{p} {st}</Chip> : <button key={p} className="fx-chip" disabled={busy === slug} onClick={() => port(slug, lib.name, p)}>+ {p}</button>; })}</td>
              <td><Button icon="play" disabled={busy === slug} onClick={() => compile(slug, lib.name)}>{busy === slug ? 'Working…' : 'Compile'}</Button></td></tr>); })}</tbody></table>)}
      </Container>
    </div>
  );
}

/** Dialog `newlib`: name the library, choose ports and parameters, generate (and optionally compile). */
export function NewLibraryDialog({ templateId, close }: { templateId: string; close: () => void }) {
  const rt = useRuntime();
  const s = useStore();
  const [templates, setTemplates] = useState<LibraryTemplate[]>([]);
  const [tid, setTid] = useState(templateId || 'feature-screens');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [ports, setPorts] = useState<Set<Port>>(new Set(['android', 'web']));
  const [params, setParams] = useState<Record<string, string>>({});
  const [features, setFeatures] = useState<Set<string>>(new Set());
  const [thenCompile, setThenCompile] = useState(true);
  const [log, setLog] = useState('');
  useEffect(() => { api.loadLibraryTemplates().then(setTemplates); }, []);
  const t = templates.find((x) => x.id === tid);
  useEffect(() => { if (t) setParams(Object.fromEntries(t.params.map((p) => [p.key, api.paramDefaultText(p)]))); }, [t]);
  const slug = slugOf(label);
  const exists = s.libraries.some((l) => l.module === `lib-${slug}`) || s.modules.some((m) => m.name === `lib-${slug}`);
  const catalogItems = s.catalog.tabs.flatMap((x) => x.groups.flatMap((g) => g.items));
  const [fq, setFq] = useState('');
  const matches = fq.trim() ? catalogItems.filter((i) => !features.has(i.id) && (i.title.toLowerCase().includes(fq.toLowerCase()) || i.id.includes(fq))).slice(0, 6) : [];
  const portList = PORTS.filter((p) => ports.has(p));
  const script = `node framework/cli/axf.mjs new-library ${slug || '<name>'} --template ${tid} --ports ${portList.join(',')}${label ? ` --label "${label}"` : ''}${Object.entries(params).map(([k, v]) => ` --param ${k}=${v}`).join('')}${features.size ? ` --features ${[...features].join(',')}` : ''}`;
  const create = async () => {
    rt.terminal.log('libraries', `▶ new library ${label} (${tid}: ${portList.join(', ')})`); rt.dispatch('terminal.open:libraries');
    const r = await api.post('new-library', { name: slug, label, description, template: tid, ports: portList, features: [...features], params });
    report(rt, r, `${label} generated`);
    let out = r.ok ? `✓ generated lib-${slug}: ${portList.join(', ')}` : `✗ ${r.error}`;
    if (r.ok && thenCompile) {
      const c = await api.post('compile-library', { slug });
      const results = (c.results ?? {}) as Record<string, { status: string; output: string }>;
      for (const [p, x] of Object.entries(results)) { rt.terminal.log('libraries', `${p}: ${x.status}`, x.status === 'passed' ? 'ok' : x.status === 'failed' ? 'error' : 'warn'); out += `\n${p}: ${x.status}${x.output ? ` — ${x.output.split('\n')[0]}` : ''}`; }
    }
    if (!r.ok && !s.backend) rt.terminal.many('libraries', script);
    setLog(out);
    s.addPort({ id: `newlib-${slug}-${Date.now().toString(36)}`, kind: 'build', name: label, source: `template ${tid}`, project: '', status: r.ok ? 'generated' : 'recorded', createdAt: now(), log: r.ok ? JSON.stringify(r.log ?? []) : script });
    if (r.ok) s.refresh();
  };
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">{templates.map((x) => <button key={x.id} className={`fx-chip ${tid === x.id ? 'is-selected' : ''}`} onClick={() => setTid(x.id)}><Icon name={x.icon} size={14} /> {x.name}</button>)}</div>
      {t && <p className="fx-muted fx-small" style={{ margin: 0 }}>{t.description}</p>}
      <label className="fx-field">Library name *<input id="newlib-label" className="fx-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="GPS tracker" autoFocus /></label>
      <p className="fx-mono fx-small fx-muted" style={{ margin: 0 }}>{slug ? `lib-${slug} · ai.amberx.axf.${slug.replace(/-/g, '.')} · ${pascal(slug)}Module · view "${slug}"` : 'module name appears here'}{exists ? ' — already exists' : ''}</p>
      <label className="fx-field">Description<input id="newlib-desc" className="fx-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t?.description} /></label>
      <div><p className="fx-eyebrow">Ports</p><div className="fx-row fx-row--wrap">{PORTS.map((p) => <button key={p} className={`fx-chip ${ports.has(p) ? 'is-selected' : ''}`} onClick={() => setPorts((x) => { const n = new Set(x); if (n.has(p)) n.delete(p); else n.add(p); return n; })}>{p}</button>)}</div></div>
      {t && t.params.length > 0 && <div className="fx-stack" style={{ gap: 'calc(var(--fx-space) * 0.75)' }}><p className="fx-eyebrow" style={{ margin: 0 }}>Parameters</p>{t.params.map((p) => <label key={p.key} className="fx-field">{p.label}<input id={`newlib-p-${p.key}`} className="fx-input fx-mono" value={params[p.key] ?? ''} onChange={(e) => setParams({ ...params, [p.key]: e.target.value })} />{p.help && <span className="fx-muted fx-small">{p.help}</span>}</label>)}</div>}
      <div><p className="fx-eyebrow">Catalog features it covers</p>
        <div className="fx-row fx-row--wrap">{[...features].map((f) => <button key={f} className="fx-chip is-selected" onClick={() => setFeatures((x) => { const n = new Set(x); n.delete(f); return n; })}>{f} ×</button>)}</div>
        <input id="newlib-features" className="fx-input" placeholder="Search the catalog…" value={fq} onChange={(e) => setFq(e.target.value)} />
        {matches.map((i) => <button key={i.id} className="pl-dep pl-dep--add" onClick={() => { setFeatures((x) => new Set([...x, i.id])); setFq(''); }}><Icon name="plus" size={14} /> {i.title} <span className="fx-mono fx-small fx-muted">{i.id}</span></button>)}
      </div>
      <label className="fx-row"><input type="checkbox" checked={thenCompile} onChange={(e) => setThenCompile(e.target.checked)} /> Compile every port after generating</label>
      <pre className="fx-code" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{script}{log ? `\n\n${log}` : ''}</pre>
      <div className="fx-row fx-row--end">
        <Button icon="copy" onClick={() => navigator.clipboard?.writeText(script).then(() => rt.toast('Command copied.', 'success'))}>Copy</Button>
        <Button tone="primary" icon="plus" disabled={!slug || exists || portList.length === 0} onClick={create}>{s.backend ? 'Generate' : 'Record'}</Button>
        <Button onClick={close}>Close</Button>
      </div>
    </div>
  );
}
