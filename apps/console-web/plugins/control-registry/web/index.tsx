/**
 * Registry page (control-registry@1; build full-api-cli-control-of-everything-plus-an-offli, s15): every controllable
 * thing of every app in one list. Search and filter, open an entry to see where it lives, how it opens, its state read,
 * every action with every parameter and allowed value, the surfaces that reach it and its gaps; run an action; resolve
 * a phrase the way voice does; see whether the Claude fallback is on.
 *
 * Everything here is also reachable without the page: the server part (/api/plugins/registry: state, entries, entry,
 * run, resolve, open, page), the core /api/registry + /api/control routes, MCP and `axf ctl`. The filters go to the
 * server as they change (GET state reads them back), and an `open` from any surface (or ?axf-view=registry&id=…&q=…)
 * sets them here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Container, Note, SelectField, Switch, TextField, type AxfWebLibrary } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './registry.css';

const FOLDER = 'control-registry';
type Page = { q: string; owner: string; type: string; surface: string; gaps: string; id: string };
type Summary = { id: string; type: string; owner: string; label: string; actions: string[]; gaps?: number; needsAI?: boolean; score?: number };
type Param = { name: string; type: string; required?: boolean; default?: unknown; enum?: unknown[]; enumLabels?: Record<string, string>; min?: number; max?: number; pattern?: string; description?: string };
type Action = { id: string; label?: string; effect: string; run: string; params?: Param[]; confirm?: boolean; needsAI?: boolean; phrases?: string[] };
type Entry = { id: string; type: string; owner: string; label: string; description?: string; where: Record<string, string>; open?: { kind?: string; target?: string; deepLink?: string }; state?: { read?: string; shape?: string }; actions: Action[]; gaps?: { what: string; why: string }[] };
type Ways = { rest?: string | null; mcp?: string | null; cli?: string | null; voice?: string[] | null; deepLink?: string | null; state?: string | null; console?: { tool: string | null; show: string | null } | null };
type Answer = { ok: boolean; code?: string; message?: string; confirm?: string; entry?: string; action?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; plan?: Record<string, unknown>; ai?: { available: boolean; why?: string; fallback?: boolean } ; candidates?: Summary[] };

const EMPTY: Page = { q: '', owner: '', type: '', surface: '', gaps: '', id: '' };
const OWNERS = [['console-web', 'Dev Console'], ['molly', 'Molly'], ['axhub-web', 'axHub'], ['hostinger', 'Hostinger'], ['coolify', 'Coolify'], ['vps', 'VPS'], ['amberx-droid', 'AmberX'], ['moshi', 'Moshi']];
const TYPES = ['page', 'app', 'plugin', 'tool', 'behavior', 'display', 'setting'];
const SURFACES = [['rest', 'REST'], ['mcp', 'MCP'], ['cli', 'CLI'], ['voice', 'Voice'], ['deepLink', 'Deep link']];

const getJson = async <T,>(path: string): Promise<T> => (await pluginFetch(FOLDER, path)).json() as Promise<T>;
const postJson = async <T,>(path: string, body: unknown): Promise<T> => (await pluginFetch(FOLDER, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<T>;

/** ?axf-view=registry&id=…&q=…&owner=…&type=… (a deep link) → the page. */
function pageFromUrl(): Partial<Page> {
  try {
    const p = new URLSearchParams(window.location.search);
    const out: Partial<Page> = {};
    for (const k of ['q', 'owner', 'type', 'id'] as const) { const v = p.get(k); if (v) out[k] = v.slice(0, 300); }
    return out;
  } catch { return {}; }
}

function ParamField({ p, value, onChange }: { p: Param; value: string; onChange: (v: string) => void }) {
  const label = `${p.name}${p.required ? ' *' : ''}`;
  const hint = [p.description, p.min !== undefined || p.max !== undefined ? `${p.min ?? '…'} to ${p.max ?? '…'}` : '', p.pattern ? `matches ${p.pattern}` : ''].filter(Boolean).join(' · ');
  if (Array.isArray(p.enum)) return <SelectField label={label} value={value} empty={p.required ? undefined : '(default)'} hint={hint || undefined} onChange={onChange} options={p.enum.map((v) => ({ value: String(v), label: p.enumLabels?.[String(v)] ? `${String(v)} · ${p.enumLabels[String(v)]}` : String(v) }))} />;
  if (p.type === 'boolean') return <Switch label={label} checked={value === 'true'} onChange={(v) => onChange(v ? 'true' : 'false')} hint={hint || undefined} />;
  return <TextField label={label} value={value} onChange={onChange} mono placeholder={p.default !== undefined ? String(JSON.stringify(p.default)) : p.type} hint={hint || undefined} />;
}

function coerce(p: Param, v: string): unknown {
  if (v === '') return undefined;
  if (p.type === 'boolean') return v === 'true';
  if (['number', 'integer', 'duration'].includes(p.type)) return Number(v);
  if (['object', 'array', 'json'].includes(p.type)) { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

function ActionRunner({ entry, action }: { entry: Entry; action: Action }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (dry: boolean, confirm = '') => {
    setBusy(true);
    const params = Object.fromEntries((action.params ?? []).map((p) => [p.name, coerce(p, values[p.name] ?? '')]).filter(([, v]) => v !== undefined));
    try { setAnswer(await postJson<Answer>('run', { id: entry.id, action: action.id, params, dry, ...(confirm ? { confirm } : {}) })); } catch (e) { setAnswer({ ok: false, message: String(e) }); }
    setBusy(false);
  };
  const tone = action.effect === 'destructive' ? 'danger' : action.effect === 'write' ? 'warning' : undefined;
  return (
    <div className="axp-registry__action fx-stack" data-axf-anchor={`registry-action:${action.id}`}>
      <div className="fx-row fx-row--wrap axp-registry__acthead">
        <strong>{action.label ?? action.id}</strong>
        <Chip tone={tone}>{action.effect}</Chip>
        {action.confirm && <Chip tone="danger">confirm</Chip>}
        {action.needsAI && <Chip tone="accent">needs Claude</Chip>}
        <code className="fx-mono axp-registry__ref">{action.run}</code>
      </div>
      {(action.params ?? []).map((p) => <ParamField key={p.name} p={p} value={values[p.name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))} />)}
      {action.phrases?.length ? <p className="fx-muted axp-registry__say">Say: {action.phrases.slice(0, 4).join(' · ')}</p> : null}
      <div className="fx-row fx-row--wrap">
        <Button icon="play" tone={tone === 'danger' ? 'danger' : 'primary'} disabled={busy} onClick={() => void run(false)}>Run</Button>
        <Button icon="eye" disabled={busy} onClick={() => void run(true)}>Plan only</Button>
        {answer?.code === 'confirmation_required' && answer.confirm && <Button icon="check" tone="danger" disabled={busy} onClick={() => void run(false, answer.confirm)}>Confirm and run</Button>}
      </div>
      {answer && <AnswerView answer={answer} />}
    </div>
  );
}

function AnswerView({ answer }: { answer: Answer }) {
  const res = answer.result as { ok?: boolean; code?: string; message?: string; handoff?: { url?: string; uri?: string } } | undefined;
  const ok = answer.ok && res?.ok !== false;
  const link = res?.handoff?.url ?? res?.handoff?.uri;
  return (
    <div className="fx-stack">
      <Note tone={ok ? 'success' : answer.code === 'confirmation_required' || res?.code === 'held' ? 'warning' : 'danger'}>
        {ok ? (link ? 'Ready: open the link below.' : res ? 'Done.' : 'Planned (nothing ran).') : `${answer.code ?? res?.code ?? 'failed'}: ${answer.message ?? res?.message ?? ''}`}
      </Note>
      {link && <code className="fx-mono axp-registry__ref">{link}</code>}
      <pre className="fx-code axp-registry__json">{JSON.stringify(answer.result ?? answer.plan ?? answer, null, 2).slice(0, 6000)}</pre>
    </div>
  );
}

function EntryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<{ entry: Entry; ways: Ways } | null>(null);
  const [err, setErr] = useState('');
  const [stateAnswer, setStateAnswer] = useState<string>('');
  useEffect(() => { setData(null); setErr(''); setStateAnswer(''); getJson<{ ok: boolean; entry: Entry; ways: Ways; detail?: string }>(`entry?id=${encodeURIComponent(id)}`).then((r) => (r.ok ? setData(r) : setErr(r.detail ?? 'not found')), (e) => setErr(String(e))); }, [id]);
  if (err) return <Note tone="danger">{err}</Note>;
  if (!data) return <p className="fx-muted">Loading {id}…</p>;
  const { entry: e, ways: w } = data;
  const readState = async () => {
    const read = e.actions.find((a) => a.effect === 'read');
    if (!read) { setStateAnswer('No state read here: the entry declares none.'); return; }
    const r = await postJson<Answer>('run', { id: e.id, action: read.id, params: {} });
    setStateAnswer(JSON.stringify(r.result ?? r, null, 2).slice(0, 6000));
  };
  return (
    <Container title={e.label} icon="layers" actions={<Button icon="x" onClick={onClose}>Close</Button>}>
      <div className="fx-stack">
        <div className="fx-row fx-row--wrap"><Chip>{e.type}</Chip><Chip>{e.owner}</Chip><code className="fx-mono">{e.id}</code></div>
        {e.description && <p className="axp-registry__desc">{e.description}</p>}
        <dl className="axp-registry__ways">
          <dt>Open</dt><dd><code className="fx-mono">{w.console?.show ? `${w.console.tool} · console_show ${w.console.show}` : e.open?.target ?? 'none'}</code></dd>
          <dt>Deep link</dt><dd><code className="fx-mono">{w.deepLink ?? 'none'}</code></dd>
          <dt>State</dt><dd><code className="fx-mono">{e.state?.read ?? 'none'}</code></dd>
          <dt>REST</dt><dd><code className="fx-mono">{w.rest ?? 'gap'}</code></dd>
          <dt>MCP</dt><dd><code className="fx-mono">{w.mcp ?? 'gap'}</code></dd>
          <dt>CLI</dt><dd><code className="fx-mono">{w.cli ?? 'gap'}</code></dd>
          <dt>Voice</dt><dd>{w.voice?.length ? w.voice.slice(0, 4).join(' · ') : 'gap'}</dd>
        </dl>
        {e.gaps?.length ? <Note tone="warning">{e.gaps.map((g) => `${g.what}: ${g.why}`).join('\n')}</Note> : null}
        {e.state?.read && <div className="fx-row"><Button icon="refresh" onClick={() => void readState()}>Read state</Button></div>}
        {stateAnswer && <pre className="fx-code axp-registry__json">{stateAnswer}</pre>}
        {e.actions.map((a) => <ActionRunner key={a.id} entry={e} action={a} />)}
      </div>
    </Container>
  );
}

function RegistryView() {
  const [page, setPage] = useState<Page>({ ...EMPTY, ...pageFromUrl() });
  const [list, setList] = useState<{ total: number; items: Summary[] }>({ total: 0, items: [] });
  const [ai, setAi] = useState<{ available?: boolean; why?: string; label?: string }>({});
  const [stats, setStats] = useState<{ entries?: number; actions?: number; gaps?: number }>({});
  const [phrase, setPhrase] = useState('');
  const [resolved, setResolved] = useState<Answer | null>(null);
  const applied = useRef(0);
  const set = useCallback((patch: Partial<Page>) => setPage((p) => ({ ...p, ...patch })), []);

  // the server's view of the page: counts, the AI gate, and filters another surface set (open / page)
  const sync = useCallback(async () => {
    try {
      const s = await getJson<{ page: Page & { pending?: string }; at: number; ai: typeof ai; stats: typeof stats }>('state');
      setAi(s.ai ?? {}); setStats(s.stats ?? {});
      if (s.page?.pending && s.at > applied.current) { applied.current = s.at; setPage({ ...EMPTY, ...s.page }); }
    } catch { /* the server part is off */ }
  }, []);
  useEffect(() => { void sync(); const t = setInterval(() => { if (document.visibilityState === 'visible') void sync(); }, 5000); return () => clearInterval(t); }, [sync]);

  // filters → the list, and the page state on the server (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams({ q: page.q, owner: page.owner, type: page.type, surface: page.surface, gaps: page.gaps, limit: '200' });
      getJson<{ total: number; items: Summary[] }>(`entries?${q}`).then((r) => setList({ total: r.total ?? 0, items: r.items ?? [] }), () => setList({ total: 0, items: [] }));
      void postJson('page', page).then(() => { applied.current = Date.now(); }, () => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [page]);

  const resolve = async (run: boolean) => { if (phrase.trim()) setResolved(await postJson<Answer>('resolve', { input: phrase, run })); };
  const counts = useMemo(() => `${list.items.length} shown of ${list.total} · ${stats.entries ?? '…'} entries, ${stats.actions ?? '…'} actions, ${stats.gaps ?? '…'} gaps`, [list, stats]);

  return (
    <div className="fx-stack fx-stack--lg axp-registry">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Control</p><h1>Registry</h1></div></header>
      <Note tone={ai.available ? 'success' : 'info'}>
        {ai.available ? 'Claude fallback is on: when nothing in the registry matches, Claude may propose an entry, and the registry checks it before anything runs.' : `Claude fallback is off: everything resolves from the registry alone${ai.why ? ` (${ai.why})` : ''}. Turn it on in Claude settings → ${ai.label ?? 'Make Claude available to the console'}.`}
      </Note>
      <div className="fx-row fx-row--wrap axp-registry__filters" role="toolbar" aria-label="Registry filters">
        <TextField label="Search" value={page.q} onChange={(q) => set({ q })} placeholder="words, an id or an alias" />
        <SelectField label="App" value={page.owner} empty="All apps" onChange={(owner) => set({ owner })} options={OWNERS.map(([value, label]) => ({ value: value!, label: label! }))} />
        <SelectField label="Type" value={page.type} empty="All types" onChange={(type) => set({ type })} options={TYPES.map((t) => ({ value: t, label: t }))} />
        <SelectField label="Reached by" value={page.surface} empty="Any surface" onChange={(surface) => set({ surface })} options={SURFACES.map(([value, label]) => ({ value: value!, label: label! }))} />
        <SelectField label="Gaps" value={page.gaps} empty="With or without" onChange={(gaps) => set({ gaps })} options={[{ value: 'only', label: 'Only with gaps' }, { value: 'none', label: 'No gaps' }]} />
      </div>
      <p className="fx-muted">{counts}</p>
      <div className="axp-registry__body">
        <div className="axp-registry__list" role="list" aria-label="Registry entries">
          {list.items.map((e) => (
            <Button key={e.id} className={`axp-registry__item${page.id === e.id ? ' is-active' : ''}`} onClick={() => set({ id: e.id })}>
              <span className="axp-registry__itemlabel">{e.label}</span>
              <span className="fx-mono fx-muted axp-registry__itemid">{e.id}</span>
              {e.gaps ? <Chip tone="warning">{e.gaps} gap{e.gaps === 1 ? '' : 's'}</Chip> : null}
            </Button>
          ))}
          {!list.items.length && <p className="fx-muted">Nothing matches.</p>}
        </div>
        <div className="axp-registry__detail">
          {page.id ? <EntryDetail id={page.id} onClose={() => set({ id: '' })} /> : (
            <Container title="Resolve a phrase" icon="mic">
              <div className="fx-stack">
                <TextField label="Say or type" value={phrase} onChange={setPhrase} placeholder="open plan studio · restart the vps · switch color theme to next" />
                <div className="fx-row fx-row--wrap">
                  <Button icon="search" onClick={() => void resolve(false)}>Resolve</Button>
                  <Button icon="play" tone="primary" onClick={() => void resolve(true)}>Resolve and run</Button>
                </div>
                {resolved && (resolved.entry ? <div className="fx-stack"><Button icon="arrow-right" onClick={() => set({ id: resolved.entry! })}>{`${resolved.entry} · ${resolved.action}`}</Button><AnswerView answer={resolved} /></div> : <AnswerView answer={resolved} />)}
              </div>
            </Container>
          )}
        </div>
      </div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.registry',
  label: 'Registry',
  version: '0.1.0',
  appMenu,
  views: { registry: { title: 'Registry', icon: 'layers', keywords: ['registry', 'control', 'api', 'cli', 'everything', 'index'], render: () => <RegistryView /> } },
  nav: { label: 'Plugins', items: [{ id: 'registry', label: 'Registry', icon: 'layers', view: 'registry' }] },
  register: (rt) => { rt.actions.register('registry.open', () => rt.navigate('registry'), { label: 'Open the Registry' }); },
  settingsTabs: [{ id: 'control-registry', label: 'Registry', icon: 'layers', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'control-registry.lifecycle', tab: 'control-registry', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
