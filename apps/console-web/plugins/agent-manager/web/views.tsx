/*
 * The Agent manager view: tabs for agents (with playground, prompt preview, memory, export), skills, personas & lingo,
 * tools (with test), training jobs, workflows (with runs), memory browser, add-ons and run history.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import { AgentForm, LingoForm, OriginChip, PersonaForm, SkillForm, ToolForm, TrainingForm, WorkflowForm } from './forms';
import { useData, WIZARDS } from './wizards';
import {
  MEMORY_HELP, call, del, download, fmtTime, post, refresh, remove, save,
  type Addon, type Agent, type Cache, type Coll, type MemItem, type MemStats, type Run, type Status, type Training, type Workflow,
} from './api';

type Tab = 'agents' | 'skills' | 'personas' | 'tools' | 'training' | 'workflows' | 'memory' | 'addons' | 'runs';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'agents', label: 'Agents', icon: 'user' }, { id: 'skills', label: 'Skills', icon: 'star' }, { id: 'personas', label: 'Personas & lingo', icon: 'palette' },
  { id: 'tools', label: 'Tools', icon: 'zap' }, { id: 'training', label: 'Training', icon: 'download' }, { id: 'workflows', label: 'Workflows', icon: 'branch' },
  { id: 'memory', label: 'Memory', icon: 'layers' }, { id: 'addons', label: 'Add-ons', icon: 'package' }, { id: 'runs', label: 'Runs', icon: 'clock' },
];

export function AgentManagerView() {
  const rt = useRuntime();
  const { cache, status } = useData();
  const [tab, setTab] = useState<Tab>('agents');
  const [err, setErr] = useState('');
  useEffect(() => { void refresh().catch((e: Error) => setErr(e.message)); }, []);
  const wizard = (kind: string, agentId?: string) => rt.openDialog('agent-manager.wizard', { kind, agentId });
  return (
    <div className="axp-agent-manager fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Plugin</p><h1>Agent manager</h1></div>
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="rocket" onClick={() => wizard('builder')}>Agent builder</Button>
          <Button icon="user" onClick={() => wizard('agent')}>New agent</Button>
          <Button icon="star" onClick={() => wizard('skill')}>New skill</Button>
          <Button icon="zap" onClick={() => wizard('tool')}>New tool</Button>
          <Button icon="download" onClick={() => wizard('training')}>Training</Button>
        </div>
      </header>
      {err && <div className="axp-agent-manager__note is-warn"><Icon name="alert" size={14} />{err}</div>}
      {status && (
        <div className="fx-row fx-row--wrap">
          <Chip tone={status.llm.source === 'assistant' ? 'success' : status.llm.ready ? 'accent' : 'warning'}>{status.llm.source === 'assistant' ? 'models from the AI assistant' : status.llm.ready ? `own model: ${status.llm.model}` : 'no model set up'}</Chip>
          <Chip tone={status.firecrawl ? 'success' : undefined}>{status.firecrawl ? 'Firecrawl ready' : 'Firecrawl not set'}</Chip>
          {status.trainingRunning.length > 0 && <Chip tone="accent">training: {status.trainingRunning.join(', ')}</Chip>}
          <span className="fx-small fx-muted">{status.counts.agents} agents · {status.counts.skills} skills · {status.counts.tools} tools · {status.addons.installed}/{status.addons.available} add-ons</span>
        </div>
      )}
      <div className="axp-agent-manager__tabs" role="tablist">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="axp-agent-manager__tab" onClick={() => setTab(t.id)}><Icon name={t.icon} size={13} /> {t.label}</button>)}
      </div>
      {!cache ? <p className="fx-muted">Loading…</p> : (
        <>
          {tab === 'agents' && <AgentsTab cache={cache} status={status} wizard={wizard} />}
          {tab === 'skills' && <CollTab coll="skills" cache={cache} status={status} wizardKind="skill" render={(v, set) => <SkillForm v={v} set={set} tools={cache.tools} />} />}
          {tab === 'personas' && <div className="fx-stack fx-stack--lg"><CollTab coll="personas" cache={cache} status={status} render={(v, set) => <PersonaForm v={v} set={set} />} /><CollTab coll="lingo" cache={cache} status={status} render={(v, set) => <LingoForm v={v} set={set} />} /></div>}
          {tab === 'tools' && <CollTab coll="tools" cache={cache} status={status} wizardKind="tool" render={(v, set) => <ToolForm key={String(v.id ?? 'new')} v={v} set={set} status={status} cache={cache} />} extra={(v) => v.id ? <ToolTester id={String(v.id)} /> : null} blank={{ kind: 'builtin', config: {} }} />}
          {tab === 'training' && <CollTab coll="training" cache={cache} status={status} wizardKind="training" render={(v, set) => <TrainingForm v={v} set={set} cache={cache} status={status} />} extra={(v) => v.id ? <TrainingRunner job={v as unknown as Training} /> : null} blank={{ sources: [], schedule: 'manual' }} />}
          {tab === 'workflows' && <CollTab coll="workflows" cache={cache} status={status} render={(v, set) => <WorkflowForm v={v} set={set} cache={cache} />} extra={(v) => v.id ? <WorkflowRunner wf={v as unknown as Workflow} /> : null} blank={{ mode: 'sequential', steps: [] }} />}
          {tab === 'memory' && <MemoryTab cache={cache} />}
          {tab === 'addons' && <AddonsTab />}
          {tab === 'runs' && <RunsTab cache={cache} />}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- generic list + editor */

type Rec = Record<string, unknown> & { id?: string; name?: string; origin?: string };

function CollTab({ coll, cache, render, extra, wizardKind, blank = {} }: {
  coll: Coll; cache: Cache; status?: Status; render: (v: Rec, set: (v: Rec) => void) => ReactNode; extra?: (v: Rec) => ReactNode; wizardKind?: string; blank?: Rec;
}) {
  const rt = useRuntime();
  const items = cache[coll] as unknown as Rec[];
  const [sel, setSel] = useState<string>('');
  const [draft, setDraft] = useState<Rec | null>(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = items.filter((i) => !q || JSON.stringify(i).toLowerCase().includes(q.toLowerCase()));
  const open = (it: Rec) => { setSel(String(it.id)); setDraft(structuredClone(it)); setMsg(''); };
  const label = coll === 'lingo' ? 'Lingo pack' : coll === 'training' ? 'Training job' : coll.slice(0, -1).replace(/^\w/, (c) => c.toUpperCase());
  const doSave = async () => {
    if (!draft) return;
    setBusy(true); setMsg('');
    try { const r = await save<Rec>(coll, draft); await refresh(); open(r); rt.toast(`${label} saved`, 'success'); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const doDelete = async () => {
    if (!draft?.id || !confirm(`Delete ${draft.name ?? draft.id}?`)) return;
    try { await remove(coll, String(draft.id)); setDraft(null); setSel(''); await refresh(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="axp-agent-manager__split">
      <div className="axp-agent-manager__list fx-stack">
        <div className="fx-row fx-row--wrap">
          <strong className="fx-grow">{label}s ({items.length})</strong>
          <Button icon="plus" onClick={() => { setSel(''); setDraft({ ...blank }); setMsg(''); }}>New</Button>
          {wizardKind && <Button icon="rocket" onClick={() => rt.openDialog('agent-manager.wizard', { kind: wizardKind })}>Wizard</Button>}
        </div>
        <input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter" />
        {shown.map((it) => (
          <button key={String(it.id)} type="button" className={`axp-agent-manager__item${sel === it.id ? ' is-active' : ''}`} onClick={() => open(it)}>
            <strong>{String(it.name ?? it.id)}</strong>
            <span className="fx-small fx-muted">{String(it.description ?? it.role ?? it.kind ?? it.mode ?? (it as unknown as Training).status ?? '')}{it.origin && it.origin !== 'user' ? ` · ${String(it.origin).replace('addon:', 'add-on ')}` : ''}</span>
          </button>
        ))}
        {!shown.length && <p className="fx-small fx-muted">{q ? 'No matches.' : `No ${label.toLowerCase()}s yet.`}</p>}
      </div>
      <div className="axp-agent-manager__editor fx-stack">
        {!draft ? <p className="fx-muted">Pick one on the left, or create a new {label.toLowerCase()}.</p> : (
          <>
            <div className="fx-row fx-row--wrap"><h3 className="fx-grow axp-agent-manager__h">{draft.id ? String(draft.name ?? draft.id) : `New ${label.toLowerCase()}`}</h3><OriginChip origin={draft.origin} /></div>
            {draft.origin?.startsWith('addon:') && <p className="fx-small fx-muted">Part of an add-on: your edits are kept until the add-on is reinstalled or updated.</p>}
            {render(draft, setDraft)}
            {msg && <div className="axp-agent-manager__note is-warn"><Icon name="alert" size={14} />{msg}</div>}
            <div className="fx-row fx-row--wrap">
              <Button tone="primary" icon="save" disabled={busy} onClick={() => void doSave()}>Save</Button>
              {draft.id && <Button icon="trash" onClick={() => void doDelete()}>Delete</Button>}
            </div>
            {extra?.(draft)}
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- agents */

interface Resolved { system: string; tools: { name: string; kind: string; description: string }[]; memory: { type: string; scope: string }; stats: MemStats }

function AgentsTab({ cache, status, wizard }: { cache: Cache; status?: Status; wizard: (kind: string, agentId?: string) => void }) {
  const rt = useRuntime();
  const [sel, setSel] = useState('');
  const [draft, setDraft] = useState<Partial<Agent> | null>(null);
  const [view, setView] = useState<'edit' | 'chat' | 'prompt'>('edit');
  const [msg, setMsg] = useState('');
  const open = (a: Agent) => { setSel(a.id); setDraft(structuredClone(a)); setMsg(''); };
  const doSave = async () => {
    if (!draft) return;
    try { const r = await save<Agent>('agents', draft); await refresh(); open(r); rt.toast('Agent saved', 'success'); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="axp-agent-manager__split">
      <div className="axp-agent-manager__list fx-stack">
        <div className="fx-row fx-row--wrap"><strong className="fx-grow">Agents ({cache.agents.length})</strong><Button icon="rocket" onClick={() => wizard('builder')}>Build</Button></div>
        {cache.agents.map((a) => (
          <button key={a.id} type="button" className={`axp-agent-manager__item${sel === a.id ? ' is-active' : ''}`} onClick={() => open(a)}>
            <strong><Icon name={a.icon || 'user'} size={13} /> {a.name}{a.enabled === false ? ' (off)' : ''}</strong>
            <span className="fx-small fx-muted">{a.memory?.type ?? 'hybrid'} memory · {(a.skillIds ?? []).length} skills{a.origin && a.origin !== 'user' ? ` · ${a.origin.replace('addon:', 'add-on ')}` : ''}</span>
          </button>
        ))}
        {!cache.agents.length && <div className="fx-stack"><p className="fx-small fx-muted">No agents yet. Build one, or install the add-on agents.</p><Button icon="package" onClick={() => rt.dispatch('settings.open:agent-manager')}>Add-ons…</Button></div>}
      </div>
      <div className="axp-agent-manager__editor fx-stack">
        {!draft ? <p className="fx-muted">Pick an agent, or use the agent builder.</p> : (
          <>
            <div className="fx-row fx-row--wrap">
              <h3 className="fx-grow axp-agent-manager__h"><Icon name={draft.icon || 'user'} size={16} /> {draft.name}</h3>
              <OriginChip origin={draft.origin} />
              <div className="axp-agent-manager__seg" role="tablist">
                {(['edit', 'chat', 'prompt'] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>{v === 'edit' ? 'Edit' : v === 'chat' ? 'Playground' : 'Prompt & tools'}</button>)}
              </div>
            </div>
            {view === 'edit' && (
              <>
                <AgentForm v={draft} set={setDraft} cache={cache} status={status} />
                {msg && <div className="axp-agent-manager__note is-warn"><Icon name="alert" size={14} />{msg}</div>}
                <div className="fx-row fx-row--wrap">
                  <Button tone="primary" icon="save" onClick={() => void doSave()}>Save</Button>
                  {draft.id && <Button icon="copy" onClick={() => void post<{ item: Agent }>(`agents/${draft.id}/clone`).then(async (r) => { await refresh(); open(r.item); })}>Clone</Button>}
                  {draft.id && <Button icon="download" onClick={() => void call(`agents/${draft.id}/export`).then((b) => download(`${draft.id}.agent-addon.json`, b))}>Export</Button>}
                  {draft.id && <Button icon="download" onClick={() => wizard('training', draft.id)}>Train…</Button>}
                  {draft.id && <Button icon="trash" onClick={() => { if (confirm(`Delete ${draft.name}? Its memory and training jobs go too.`)) void remove('agents', draft.id!).then(async () => { setDraft(null); setSel(''); await refresh(); }); }}>Delete</Button>}
                </div>
              </>
            )}
            {view === 'chat' && draft.id && <Playground agent={draft as Agent} />}
            {view === 'prompt' && draft.id && <PromptPreview id={draft.id} />}
          </>
        )}
      </div>
    </section>
  );
}

function Playground({ agent }: { agent: Agent }) {
  const [hist, setHist] = useState<{ role: 'user' | 'assistant'; content: string; tools?: { tool: string; ok: boolean; preview: string }[] }[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [useMem, setUseMem] = useState(true);
  useEffect(() => setHist([]), [agent.id]);
  const send = async () => {
    const m = text.trim();
    if (!m || busy) return;
    setText(''); setBusy(true);
    const before = hist;
    setHist([...before, { role: 'user', content: m }]);
    try {
      const r = await post<{ text: string; tools: { tool: string; ok: boolean; preview: string }[] }>(`agents/${agent.id}/chat`, { message: m, history: before, memory: useMem });
      setHist([...before, { role: 'user', content: m }, { role: 'assistant', content: r.text, tools: r.tools }]);
    } catch (e) { setHist([...before, { role: 'user', content: m }, { role: 'assistant', content: `Error: ${(e as Error).message}` }]); } finally { setBusy(false); }
  };
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Talk to {agent.name} with its persona, skills, tools and memory. For streaming and conversations, pick it in the AI assistant.</p>
      <div className="axp-agent-manager__chat">
        {hist.map((h, i) => (
          <div key={i} className={`axp-agent-manager__bubble ${h.role === 'user' ? 'is-user' : ''}`}>
            {h.tools?.map((t, j) => <span key={j} className="fx-chip"><Icon name={t.ok ? 'zap' : 'alert'} size={10} /> {t.tool}: {t.preview.slice(0, 60)}</span>)}
            <p>{h.content}</p>
          </div>
        ))}
        {busy && <p className="fx-muted fx-small">{agent.name} is thinking…</p>}
      </div>
      <div className="axp-agent-manager__row">
        <textarea className="fx-input fx-grow" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder={`Message ${agent.name}`} aria-label="Message" />
        <Button tone="primary" icon="play" disabled={busy || !text.trim()} onClick={() => void send()}>Send</Button>
      </div>
      <label className="axp-agent-manager__toggle"><input type="checkbox" checked={useMem} onChange={(e) => setUseMem(e.target.checked)} /> Use and update memory</label>
    </div>
  );
}

function PromptPreview({ id }: { id: string }) {
  const [r, setR] = useState<Resolved | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void call<Resolved>(`agents/${id}/resolved`).then(setR, (e: Error) => setErr(e.message)); }, [id]);
  if (err) return <p className="axp-agent-manager__bad">{err}</p>;
  if (!r) return <p className="fx-muted">Loading…</p>;
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap"><Chip tone="accent">{r.memory.type} memory</Chip><Chip>{r.stats.items} items</Chip><Chip>scope {r.memory.scope}</Chip></div>
      <span className="fx-small fx-muted">{MEMORY_HELP[r.memory.type]}</span>
      <strong>Tools ({r.tools.length})</strong>
      <div className="axp-agent-manager__picks">{r.tools.map((t) => <span key={t.name} className="fx-chip" title={t.description}>{t.name} · {t.kind}</span>)}</div>
      <strong>System prompt</strong>
      <pre className="axp-agent-manager__out">{r.system}</pre>
    </div>
  );
}

/* ---------------------------------------------------------------- tools, training, workflows */

function ToolTester({ id }: { id: string }) {
  const [args, setArgs] = useState('{}');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await post<{ ok: boolean; output: string }>(`tools/${id}/test`, { args: JSON.parse(args || '{}') }); setOut(r.output); } catch (e) { setOut(`Error: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  return (
    <div className="axp-agent-manager__card fx-stack">
      <strong>Test</strong>
      <textarea className="fx-input fx-mono" rows={3} value={args} onChange={(e) => setArgs(e.target.value)} aria-label="Arguments (JSON)" />
      <div><Button icon="play" disabled={busy} onClick={() => void run()}>{busy ? 'Running…' : 'Run'}</Button></div>
      {out && <pre className="axp-agent-manager__out">{out}</pre>}
    </div>
  );
}

function TrainingRunner({ job }: { job: Training }) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>(job.log ?? []);
  useEffect(() => setLog(job.log ?? []), [job.id, job.log]);
  const run = async () => {
    setBusy(true);
    try { const r = await post<{ status: string; added: number; log: string[] }>(`training/${job.id}/run`, { wait: true }); setLog(r.log); await refresh(); } catch (e) { setLog([...(log ?? []), `✗ ${(e as Error).message}`]); } finally { setBusy(false); }
  };
  return (
    <div className="axp-agent-manager__card fx-stack">
      <div className="fx-row fx-row--wrap">
        <strong className="fx-grow">Runs</strong>
        {job.status && <Chip tone={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'danger' : 'warning'}>{job.status}</Chip>}
        <span className="fx-small fx-muted">last {fmtTime(job.lastRun)}{job.lastAdded !== undefined ? ` · ${job.lastAdded} chunks` : ''}{job.nextRun ? ` · next ${fmtTime(job.nextRun)}` : ''}</span>
      </div>
      <div><Button tone="primary" icon="play" disabled={busy} onClick={() => void run()}>{busy ? 'Training…' : 'Run now'}</Button></div>
      {log.length > 0 && <pre className="axp-agent-manager__out">{log.join('\n')}</pre>}
    </div>
  );
}

function WorkflowRunner({ wf }: { wf: Workflow }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ output: string; trace: { step: string; agent: string; output: string; chosen?: string[] }[] } | null>(null);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr(''); setRes(null);
    try { setRes(await post(`workflows/${wf.id}/run`, { input })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="axp-agent-manager__card fx-stack">
      <strong>Run</strong>
      <textarea className="fx-input" rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Input" aria-label="Workflow input" />
      <div><Button tone="primary" icon="play" disabled={busy || !input.trim()} onClick={() => void run()}>{busy ? 'Running…' : 'Run workflow'}</Button></div>
      {err && <p className="axp-agent-manager__bad">{err}</p>}
      {res && (
        <div className="fx-stack">
          {res.trace.map((t, i) => <details key={i} className="axp-agent-manager__trace"><summary><span className="fx-mono">{t.step}</span> · {t.agent}{t.chosen ? ` → ${t.chosen.join(', ')}` : ''}</summary><pre className="axp-agent-manager__out">{t.output}</pre></details>)}
          <strong>Output</strong>
          <pre className="axp-agent-manager__out">{res.output}</pre>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- memory */

function MemoryTab({ cache }: { cache: Cache }) {
  const [aid, setAid] = useState(cache.agents[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [data, setData] = useState<{ items: MemItem[]; summary: string; stats: MemStats; scope: string } | null>(null);
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState('');
  const [err, setErr] = useState('');
  const load = () => { if (aid) void call<{ items: MemItem[]; summary: string; stats: MemStats; scope: string }>(`memory/${aid}?q=${encodeURIComponent(q)}&kind=${kind}`).then((d) => { setData(d); setSummary(d.summary); setErr(''); }, (e: Error) => setErr(e.message)); };
  useEffect(load, [aid, kind]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [q]);
  const agent = cache.agents.find((a) => a.id === aid);
  if (!cache.agents.length) return <p className="fx-muted">No agents yet.</p>;
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <select className="fx-input axp-agent-manager__narrow" value={aid} onChange={(e) => setAid(e.target.value)} aria-label="Agent">{cache.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input className="fx-input fx-grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memory (keyword / semantic)" aria-label="Search memory" />
        <select className="fx-input axp-agent-manager__narrow" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="">all kinds</option>{['fact', 'knowledge', 'episode', 'note'].map((k) => <option key={k}>{k}</option>)}</select>
      </div>
      {err && <p className="axp-agent-manager__bad">{err}</p>}
      {data && (
        <>
          <div className="fx-row fx-row--wrap">
            <Chip tone="accent">{agent?.memory?.type ?? 'hybrid'}</Chip><Chip>scope {data.scope}</Chip><Chip>{data.stats.items} items</Chip>
            {Object.entries(data.stats.byKind).map(([k, n]) => <Chip key={k}>{k}: {n}</Chip>)}
            {data.stats.vectors > 0 && <Chip tone="success">{data.stats.vectors} embedded</Chip>}
          </div>
          <details className="axp-agent-manager__card">
            <summary>Rolling summary</summary>
            <textarea className="fx-input" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} aria-label="Summary" />
            <Button icon="save" onClick={() => void call(`memory/${aid}/summary`, { method: 'PUT', body: JSON.stringify({ summary }) }).then(load)}>Save summary</Button>
          </details>
          <div className="axp-agent-manager__row">
            <input className="fx-input fx-grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a fact or note the agent should remember" aria-label="New memory" />
            <Button icon="plus" disabled={!note.trim()} onClick={() => void post(`memory/${aid}`, { text: note, kind: 'fact' }).then(() => { setNote(''); load(); })}>Remember</Button>
          </div>
          <div className="axp-agent-manager__mem">
            {data.items.map((m) => (
              <div key={m.id} className="axp-agent-manager__memitem">
                <div className="fx-row fx-row--wrap"><Chip>{m.kind}</Chip>{m.score !== undefined && <span className="fx-small fx-muted">score {m.score}</span>}<span className="fx-small fx-muted fx-grow">{m.source} · {fmtTime(m.createdAt)}{m.hits ? ` · used ${m.hits}×` : ''}</span>
                  <button type="button" className="fx-iconbtn" aria-label="Forget" onClick={() => void del(`memory/${aid}/${m.id}`).then(load)}><Icon name="trash" size={12} /></button></div>
                <p>{m.text.length > 600 ? `${m.text.slice(0, 600)}…` : m.text}</p>
              </div>
            ))}
            {!data.items.length && <p className="fx-small fx-muted">{q ? 'Nothing matches.' : 'Empty — chat with the agent, or train it.'}</p>}
          </div>
          <div className="fx-row fx-row--wrap">
            {['episode', 'knowledge', 'fact'].map((k) => <Button key={k} icon="trash" onClick={() => { if (confirm(`Forget every ${k}?`)) void post(`memory/${aid}/clear`, { kind: k }).then(load); }}>Clear {k}s</Button>)}
            <Button icon="trash" onClick={() => { if (confirm(`Erase all of ${agent?.name}'s memory?`)) void post(`memory/${aid}/clear`).then(load); }}>Erase all</Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- add-ons, runs */

export function AddonsTab() {
  const rt = useRuntime();
  const [items, setItems] = useState<Addon[] | null>(null);
  const [busy, setBusy] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const load = () => call<{ items: Addon[] }>('addons').then((r) => setItems(r.items), (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const act = async (id: string, what: 'install' | 'uninstall', body: Record<string, unknown> = {}) => {
    setBusy(id); setErr('');
    try {
      const r = await post<{ created?: Record<string, string[]>; training?: string[]; skipped?: string[] }>(`addons/${id}/${what}`, body);
      rt.toast(what === 'install' ? `Installed${r.training?.length ? ' — training started' : ''}${r.skipped?.length ? ` (${r.skipped.length} skipped)` : ''}` : 'Uninstalled', 'success', id);
      await Promise.all([load(), refresh()]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const report = (r: { warnings: string[]; stripped: boolean }) => {
    rt.toast('Add-on imported — install it below', 'success');
    if (r.stripped) setErr(`For safety these were removed from the imported add-on (re-import with trust to keep them): ${r.warnings.join('; ')}`);
  };
  const importJson = async (f: File) => {
    try { const r = await post<{ warnings: string[]; stripped: boolean }>('addons/import', { bundle: JSON.parse(await f.text()) }); await load(); report(r); } catch (e) { setErr((e as Error).message); }
  };
  if (!items) return <p className="fx-muted">Loading…</p>;
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Add-ons are bundles of agents with their personas, lingo, skills, tools, workflows, training and seed memory. Uninstalling one removes exactly what it added.</p>
      {err && <div className="axp-agent-manager__note is-warn"><Icon name="alert" size={14} />{err}</div>}
      <div className="axp-agent-manager__grid">
        {items.map((a) => (
          <div key={a.id} className="axp-agent-manager__card fx-stack">
            <div className="fx-row fx-row--wrap"><Icon name={a.icon || 'package'} size={18} /><strong className="fx-grow">{a.name}</strong>{a.installed ? <Chip tone="success">installed</Chip> : <Chip>{a.source}</Chip>}{a.updateAvailable && <Chip tone="warning">update {a.version}</Chip>}</div>
            <p className="fx-small">{a.description}</p>
            <span className="fx-small fx-muted">{Object.entries(a.provides).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(' · ')} · v{a.installedVersion ?? a.version}</span>
            <div className="fx-row fx-row--wrap">
              {!a.installed && <Button tone="primary" icon="download" disabled={!!busy} onClick={() => void act(a.id, 'install')}>{busy === a.id ? 'Installing…' : 'Install'}</Button>}
              {a.updateAvailable && <Button tone="primary" icon="refresh" disabled={!!busy} onClick={() => void act(a.id, 'install')}>Update (keeps memory)</Button>}
              {a.installed && <Button icon="trash" disabled={!!busy} onClick={() => { if (confirm(`Uninstall ${a.name}? Its agents, skills, tools and memory are removed.`)) void act(a.id, 'uninstall'); }}>Uninstall</Button>}
              {a.installed && <Button icon="refresh" disabled={!!busy} onClick={() => void act(a.id, 'install')}>Reinstall</Button>}
              {a.source === 'imported' && !a.installed && <Button icon="minus" onClick={() => void del(`addons/${a.id}`).then(load)}>Forget</Button>}
            </div>
          </div>
        ))}
      </div>
      <div className="axp-agent-manager__card fx-stack">
        <strong>Add more</strong>
        <div className="axp-agent-manager__row">
          <input className="fx-input fx-mono fx-grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/my-agent.addon.json" aria-label="Add-on URL" />
          <Button icon="download" disabled={!url.trim()} onClick={() => void post<{ warnings: string[]; stripped: boolean }>('addons/import', { url }).then((r) => { setUrl(''); report(r); return load(); }, (e: Error) => setErr(e.message))}>Import URL</Button>
          <label className="fx-btn fx-btn--neutral axp-agent-manager__file"><Icon name="upload" size={14} /> Import file<input type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }} /></label>
        </div>
        <span className="fx-small fx-muted">Format: agent-addon@1 (see the plugin README). Export any agent from its editor to make one.</span>
      </div>
    </div>
  );
}

function RunsTab({ cache }: { cache: Cache }) {
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<Run[]>([]);
  useEffect(() => { void call<{ items: Run[] }>(`runs?kind=${kind}`).then((r) => setItems(r.items)); }, [kind]);
  const agentName = useMemo(() => Object.fromEntries(cache.agents.map((a) => [a.id, a.name])), [cache.agents]);
  return (
    <div className="fx-stack">
      <select className="fx-input axp-agent-manager__narrow" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Run kind"><option value="">all runs</option><option value="workflow">workflows</option><option value="training">training</option><option value="playground">playground</option></select>
      {items.map((r) => (
        <details key={r.id} className="axp-agent-manager__card">
          <summary><Chip>{r.kind}</Chip> {r.name ?? agentName[r.agentId ?? ''] ?? r.workflowId ?? r.agentId} · <span className="fx-small fx-muted">{fmtTime(r.at)}{r.status ? ` · ${r.status}` : ''}{r.added !== undefined ? ` · ${r.added} chunks` : ''}</span></summary>
          {r.input && <><strong className="fx-small">Input</strong><pre className="axp-agent-manager__out">{r.input}</pre></>}
          {r.output && <><strong className="fx-small">Output</strong><pre className="axp-agent-manager__out">{r.output}</pre></>}
          {r.log && <pre className="axp-agent-manager__out">{r.log.join('\n')}</pre>}
        </details>
      ))}
      {!items.length && <p className="fx-muted fx-small">No runs yet.</p>}
    </div>
  );
}

export const WIZARD_LIST = WIZARDS;
