/*
 * Agent manager wizards, opened anywhere as the console dialog "agent-manager.wizard" with { kind }:
 *   agent     New agent: identity → persona → skills & lingo → tools & delegates → model → memory → review
 *   skill     New skill: template → instructions → triggers & examples → tools → review
 *   tool      New tool: kind → configure → save & test
 *   builder   All-in-one agent builder: create or reuse persona, lingo, skills and tools, configure memory and
 *             training, all in one flow (one /compose call; rolled back if anything fails)
 *   training  Training setup: agent → sources (Firecrawl, URLs, repo, text, MCP) → schedule → run
 */
import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import { AgentForm, Field, LingoForm, PersonaForm, Pick, SKILL_TEMPLATES, SkillForm, ToolForm, TrainingForm } from './forms';
import {
  MEMORY_HELP, getCache, getStatus, post, refresh, save, subscribe,
  type Agent, type Cache, type Lingo, type Persona, type Skill, type Status, type Tool, type Training,
} from './api';

export function useData(): { cache?: Cache; status?: Status } {
  useEffect(() => { if (!getCache()) void refresh().catch(() => undefined); }, []);
  const cache = useSyncExternalStore(subscribe, getCache, getCache);
  const status = useSyncExternalStore(subscribe, getStatus, getStatus);
  return { cache, status };
}

function Shell({ steps, step, setStep, children, canNext = true, onFinish, finishLabel = 'Create', busy, error }: {
  steps: string[]; step: number; setStep: (n: number) => void; children: ReactNode; canNext?: boolean; onFinish: () => void; finishLabel?: string; busy?: boolean; error?: string;
}) {
  const last = step === steps.length - 1;
  return (
    <div className="axp-agent-manager__wizard fx-stack">
      <ol className="axp-agent-manager__steps">{steps.map((s, i) => <li key={s} className={i === step ? 'is-active' : i < step ? 'is-done' : ''}><button type="button" className={`fx-chip${i === step ? ' is-on' : ''}`} onClick={() => i < step && setStep(i)}>{i + 1}. {s}</button></li>)}</ol>
      <div className="axp-agent-manager__wizard-body">{children}</div>
      {error && <div className="axp-agent-manager__note is-warn"><Icon name="alert" size={14} />{error}</div>}
      <div className="fx-row fx-row--wrap axp-agent-manager__wizard-nav">
        <Button icon="undo" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</Button>
        {last ? <Button tone="primary" icon="check" disabled={busy || !canNext} onClick={onFinish}>{busy ? 'Working…' : finishLabel}</Button>
          : <Button tone="primary" icon="play" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</Button>}
      </div>
    </div>
  );
}

function Review({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="axp-agent-manager__facts">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v || '—'}</dd></Fragment>)}</dl>;
}
const names = (ids: string[] | undefined, items: { id: string; name: string }[]) => (ids ?? []).map((i) => items.find((x) => x.id === i)?.name ?? i).join(', ');

/* ---------------------------------------------------------------- new agent */

function NewAgentWizard({ done }: { done: (msg: string) => void }) {
  const { cache, status } = useData();
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Partial<Agent>>({ icon: 'user', memory: { type: 'hybrid', record: 'both' } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!cache) return <p className="fx-muted">Loading…</p>;
  const steps = ['Identity', 'Persona', 'Skills & lingo', 'Tools', 'Model', 'Memory', 'Review'];
  const only = [['identity'], ['persona'], ['skills', 'lingo'], ['tools', 'delegates', 'instructions'], ['model'], ['memory']][step] as never;
  const finish = async () => {
    setBusy(true); setErr('');
    try { const r = await save<Agent>('agents', a); await refresh(); done(`Agent ${r.name} created`); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Shell steps={steps} step={step} setStep={setStep} canNext={!!a.name?.trim()} onFinish={() => void finish()} busy={busy} error={err}>
      {step < 6 ? <AgentForm v={a} set={setA} cache={cache} status={status} only={only} /> : (
        <Review rows={[['Name', a.name], ['Persona', cache.personas.find((p) => p.id === a.personaId)?.name], ['Skills', names(a.skillIds, cache.skills)], ['Lingo', names(a.lingoIds, cache.lingo)],
          ['Tools', names(a.toolIds, cache.tools)], ['Delegates', names(a.delegates, cache.agents)], ['Model', `${a.model?.profile || 'default'} · ${a.model?.model || 'default'}`], ['Memory', `${a.memory?.type} — ${MEMORY_HELP[a.memory?.type ?? 'hybrid']}`]]} />
      )}
    </Shell>
  );
}

/* ---------------------------------------------------------------- new skill */

function NewSkillWizard({ done }: { done: (msg: string) => void }) {
  const { cache } = useData();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<Partial<Skill>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [attach, setAttach] = useState<string[]>([]);
  if (!cache) return <p className="fx-muted">Loading…</p>;
  const finish = async () => {
    setBusy(true); setErr('');
    try {
      const r = await save<Skill>('skills', s);
      for (const id of attach) { const ag = cache.agents.find((x) => x.id === id); if (ag) await save('agents', { ...ag, skillIds: [...(ag.skillIds ?? []), r.id] }); }
      await refresh(); done(`Skill ${r.name} created${attach.length ? ` and given to ${attach.length} agent(s)` : ''}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Shell steps={['Template', 'Skill', 'Give to agents', 'Review']} step={step} setStep={setStep} canNext={step === 0 || !!s.name?.trim()} onFinish={() => void finish()} busy={busy} error={err}>
      {step === 0 && (
        <div className="axp-agent-manager__grid">
          {Object.entries(SKILL_TEMPLATES).map(([k, t]) => <button key={k} type="button" data-fx-row className="axp-agent-manager__tile" onClick={() => { setS({ ...t }); setStep(1); }}><span className="fx-card axp-agent-manager__tile-card"><strong>{t.name ?? 'Blank skill'}</strong><span className="fx-small fx-muted">{t.description ?? 'Start from scratch'}</span></span></button>)}
        </div>
      )}
      {step === 1 && <SkillForm v={s} set={setS} tools={cache.tools} />}
      {step === 2 && <Field label="Add this skill to agents (optional)"><Pick items={cache.agents} value={attach} onChange={setAttach} /></Field>}
      {step === 3 && <Review rows={[['Name', s.name], ['Description', s.description], ['Triggers', (s.triggers ?? []).join(', ')], ['Examples', String(s.examples?.length ?? 0)], ['Tools', names(s.toolIds, cache.tools)], ['Agents', names(attach, cache.agents)]]} />}
    </Shell>
  );
}

/* ---------------------------------------------------------------- new tool */

function NewToolWizard({ done }: { done: (msg: string) => void }) {
  const { cache, status } = useData();
  const [step, setStep] = useState(0);
  const [t, setT] = useState<Partial<Tool>>({ kind: 'builtin', config: {} });
  const [saved, setSaved] = useState<Tool | null>(null);
  const [args, setArgs] = useState('{}');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!cache) return <p className="fx-muted">Loading…</p>;
  const doSave = async () => {
    setBusy(true); setErr('');
    try { const r = await save<Tool>('tools', { ...t, id: saved?.id }); setSaved(r); await refresh(); setStep(2); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { const parsed = JSON.parse(args || '{}'); const r = await post<{ ok: boolean; output: string }>(`tools/${saved!.id}/test`, { args: parsed }); setOut(r.output); } catch (e) { setOut(`Error: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  return (
    <Shell steps={['Kind', 'Configure', 'Test']} step={step} setStep={setStep} canNext={step !== 1 || !!t.name} onFinish={() => done(`Tool ${saved?.name} saved`)} finishLabel="Done" busy={busy} error={err}>
      {step === 0 && <ToolForm v={t} set={(x) => { setT(x); }} status={status} cache={cache} />}
      {step === 1 && (
        <div className="fx-stack">
          <ToolForm v={t} set={setT} status={status} cache={cache} />
          <div><Button tone="primary" icon="save" disabled={busy || !t.name} onClick={() => void doSave()}>Save tool</Button></div>
        </div>
      )}
      {step === 2 && saved && (
        <div className="fx-stack">
          <p className="fx-small">Saved <strong className="fx-mono">{saved.name}</strong>. Try it with arguments:</p>
          <textarea className="fx-input fx-mono" rows={4} value={args} onChange={(e) => setArgs(e.target.value)} aria-label="Arguments (JSON)" />
          <div><Button icon="play" disabled={busy} onClick={() => void test()}>Run test</Button></div>
          {out && <pre className="axp-agent-manager__out">{out}</pre>}
        </div>
      )}
      {step === 2 && !saved && <p className="fx-muted">Save the tool first.</p>}
    </Shell>
  );
}

/* ---------------------------------------------------------------- all-in-one builder */

function BuilderWizard({ done }: { done: (msg: string) => void }) {
  const { cache, status } = useData();
  const [step, setStep] = useState(0);
  const [agent, setAgent] = useState<Partial<Agent>>({ icon: 'sparkles', memory: { type: 'hybrid', record: 'both' } });
  const [personaMode, setPersonaMode] = useState<'pick' | 'new' | 'none'>('new');
  const [persona, setPersona] = useState<Partial<Persona>>({});
  const [lingoPick, setLingoPick] = useState<string[]>([]);
  const [newLingo, setNewLingo] = useState<Partial<Lingo> | null>(null);
  const [skillPick, setSkillPick] = useState<string[]>([]);
  const [newSkills, setNewSkills] = useState<Partial<Skill>[]>([]);
  const [toolPick, setToolPick] = useState<string[]>([]);
  const [newTools, setNewTools] = useState<Partial<Tool>[]>([]);
  const [train, setTrain] = useState<Partial<Training> & { runNow?: boolean }>({ sources: [], schedule: 'manual', runNow: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!cache) return <p className="fx-muted">Loading…</p>;
  const steps = ['Identity', 'Persona', 'Lingo', 'Skills', 'Tools', 'Model & memory', 'Training', 'Review'];
  const finish = async () => {
    setBusy(true); setErr('');
    try {
      const body = {
        agent,
        persona: personaMode === 'new' ? persona : personaMode === 'pick' ? agent.personaId : undefined,
        lingo: [...lingoPick, ...(newLingo?.name ? [newLingo] : [])],
        skills: [...skillPick, ...newSkills.filter((s) => s.name)],
        tools: [...toolPick, ...newTools.filter((t) => t.name)],
        training: train.sources?.length ? train : undefined,
      };
      const r = await post<{ agent: Agent; created: Record<string, string[]> }>('compose', body);
      await refresh();
      const made = Object.entries(r.created).filter(([, v]) => v.length).map(([k, v]) => `${v.length} ${k}`).join(', ');
      done(`Built ${r.agent.name} (${made})`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Shell steps={steps} step={step} setStep={setStep} canNext={!!agent.name?.trim()} onFinish={() => void finish()} finishLabel="Build agent" busy={busy} error={err}>
      {step === 0 && <AgentForm v={agent} set={setAgent} cache={cache} status={status} only={['identity', 'instructions']} />}
      {step === 1 && (
        <div className="fx-stack">
          <div className="axp-agent-manager__picks">{(['new', 'pick', 'none'] as const).map((m) => <button key={m} type="button" className={`fx-chip axp-agent-manager__pick${personaMode === m ? ' is-on' : ''}`} onClick={() => setPersonaMode(m)}>{m === 'new' ? 'Create a persona' : m === 'pick' ? 'Use an existing one' : 'No persona'}</button>)}</div>
          {personaMode === 'new' && <PersonaForm v={persona} set={setPersona} />}
          {personaMode === 'pick' && <AgentForm v={agent} set={setAgent} cache={cache} status={status} only={['persona']} />}
        </div>
      )}
      {step === 2 && (
        <div className="fx-stack">
          <Field label="Use existing lingo packs"><Pick items={cache.lingo} value={lingoPick} onChange={setLingoPick} empty="None yet — create one below." /></Field>
          {newLingo ? <div className="axp-agent-manager__card"><LingoForm v={newLingo} set={setNewLingo} /><Button icon="minus" onClick={() => setNewLingo(null)}>Don't create</Button></div>
            : <div><Button icon="plus" onClick={() => setNewLingo({ name: `${agent.name ?? 'Agent'} lingo` })}>Create a lingo pack</Button></div>}
        </div>
      )}
      {step === 3 && (
        <div className="fx-stack">
          <Field label="Assign existing skills"><Pick items={cache.skills} value={skillPick} onChange={setSkillPick} empty="None yet — create some below." /></Field>
          {newSkills.map((s, i) => (
            <div key={i} className="axp-agent-manager__card fx-stack">
              <SkillForm v={s} set={(x) => setNewSkills(newSkills.map((y, j) => (j === i ? x : y)))} tools={cache.tools} />
              <div><Button icon="minus" onClick={() => setNewSkills(newSkills.filter((_, j) => j !== i))}>Remove this new skill</Button></div>
            </div>
          ))}
          <div className="fx-row fx-row--wrap">
            {Object.entries(SKILL_TEMPLATES).map(([k, t]) => <Button key={k} icon="plus" onClick={() => setNewSkills([...newSkills, { ...t }])}>{t.name ?? 'Blank skill'}</Button>)}
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="fx-stack">
          <Field label="Attach existing tools"><Pick items={cache.tools} value={toolPick} onChange={setToolPick} empty="None yet — build some below." /></Field>
          {newTools.map((t, i) => (
            <div key={i} className="axp-agent-manager__card fx-stack">
              <ToolForm v={t} set={(x) => setNewTools(newTools.map((y, j) => (j === i ? x : y)))} status={status} cache={cache} />
              <div><Button icon="minus" onClick={() => setNewTools(newTools.filter((_, j) => j !== i))}>Remove this new tool</Button></div>
            </div>
          ))}
          <div><Button icon="plus" onClick={() => setNewTools([...newTools, { kind: 'builtin', config: {} }])}>Build a new tool</Button></div>
        </div>
      )}
      {step === 5 && <AgentForm v={agent} set={setAgent} cache={cache} status={status} only={['model', 'memory', 'delegates']} />}
      {step === 6 && (
        <div className="fx-stack">
          <p className="fx-small fx-muted">Optional: give the agent knowledge now. You can add training jobs any time.</p>
          <TrainingForm v={train} set={setTrain} cache={cache} status={status} lockAgent />
          <label className="axp-agent-manager__toggle"><input type="checkbox" checked={!!train.runNow} onChange={(e) => setTrain({ ...train, runNow: e.target.checked })} /> Run the training right after building</label>
        </div>
      )}
      {step === 7 && (
        <Review rows={[
          ['Agent', agent.name], ['Persona', personaMode === 'new' ? `new: ${persona.name ?? '(unnamed)'}` : personaMode === 'pick' ? cache.personas.find((p) => p.id === agent.personaId)?.name : 'none'],
          ['Lingo', [names(lingoPick, cache.lingo), newLingo?.name ? `new: ${newLingo.name}` : ''].filter(Boolean).join(', ')],
          ['Skills', [names(skillPick, cache.skills), ...newSkills.filter((s) => s.name).map((s) => `new: ${s.name}`)].filter(Boolean).join(', ')],
          ['Tools', [names(toolPick, cache.tools), ...newTools.filter((t) => t.name).map((t) => `new: ${t.name}`)].filter(Boolean).join(', ')],
          ['Memory', `${agent.memory?.type} (${agent.memory?.record ?? 'both'})`],
          ['Training', train.sources?.length ? `${train.sources.length} source(s), ${train.schedule}${train.runNow ? ', runs now' : ''}` : 'none'],
        ]} />
      )}
    </Shell>
  );
}

/* ---------------------------------------------------------------- training */

function TrainingWizard({ done, agentId }: { done: (msg: string) => void; agentId?: string }) {
  const { cache, status } = useData();
  const [step, setStep] = useState(agentId ? 1 : 0);
  const [j, setJ] = useState<Partial<Training>>({ agentId, sources: [], schedule: 'manual', replace: true });
  const [runNow, setRunNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!cache) return <p className="fx-muted">Loading…</p>;
  const finish = async () => {
    setBusy(true); setErr('');
    try {
      const r = await save<Training>('training', { ...j, name: j.name || `Train ${cache.agents.find((a) => a.id === j.agentId)?.name}` });
      if (runNow) await post(`training/${r.id}/run`);
      await refresh();
      done(runNow ? `Training started for ${cache.agents.find((a) => a.id === r.agentId)?.name}` : 'Training job saved');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const can = step === 0 ? !!j.agentId : step === 1 ? !!j.sources?.length : true;
  return (
    <Shell steps={['Agent', 'Sources', 'Schedule', 'Review']} step={step} setStep={setStep} canNext={can} onFinish={() => void finish()} finishLabel={runNow ? 'Save & train' : 'Save'} busy={busy} error={err}>
      {step === 0 && <Field label="Which agent learns?"><Pick items={cache.agents} value={j.agentId ? [j.agentId] : []} onChange={(v) => setJ({ ...j, agentId: v[v.length - 1] })} empty="Create an agent first." /></Field>}
      {step === 1 && (
        <div className="fx-stack">
          {!status?.firecrawl && <p className="fx-small fx-muted">Tip: Firecrawl turns whole doc sites into clean Markdown. Add FIRECRAWL_API_KEY (or a key in Settings → Plugins → Agent manager) to unlock the Firecrawl sources; URL, repo, text and MCP sources work without it.</p>}
          <TrainingForm v={j} set={setJ} cache={cache} status={status} lockAgent />
        </div>
      )}
      {step === 2 && (
        <div className="fx-stack">
          <p className="fx-small fx-muted">Scheduled jobs run in the background while the console runs (Settings → Plugins → Agent manager → scheduler).</p>
          <Field label="Schedule"><select className="fx-input" value={j.schedule ?? 'manual'} onChange={(e) => setJ({ ...j, schedule: e.target.value })}>{['manual', 'hourly', 'daily', 'weekly'].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <label className="axp-agent-manager__toggle"><input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} /> Run it now</label>
        </div>
      )}
      {step === 3 && <Review rows={[['Agent', cache.agents.find((a) => a.id === j.agentId)?.name], ['Sources', (j.sources ?? []).map((s) => s.type).join(', ')], ['Schedule', j.schedule], ['Chunking', `${j.chunkSize ?? 1200} chars, overlap ${j.overlap ?? 120}`], ['Replace previous', j.replace === false ? 'no' : 'yes']]} />}
    </Shell>
  );
}

/* ---------------------------------------------------------------- dialog entry */

export const WIZARDS: Record<string, { title: string; icon: string; description: string }> = {
  builder: { title: 'Agent builder (all-in-one)', icon: 'rocket', description: 'Create an agent with new or existing persona, lingo, skills and tools, its memory and training — one flow.' },
  agent: { title: 'New agent', icon: 'user', description: 'Assemble an agent from parts you already have.' },
  skill: { title: 'New skill', icon: 'star', description: 'Teach a reusable skill and hand it to agents.' },
  tool: { title: 'New tool', icon: 'zap', description: 'Built-in, HTTP API, MCP, prompt, delegate or workflow tool — then test it.' },
  training: { title: 'Training setup', icon: 'download', description: 'Feed an agent knowledge from Firecrawl, web pages, the repo, text or MCP, on a schedule.' },
};

export function WizardDialog({ kind, agentId, close }: { kind: string; agentId?: string; close: () => void }) {
  const rt = useRuntime();
  const done = (msg: string) => { rt.toast(msg, 'success', 'Agent manager'); close(); };
  const w = WIZARDS[kind];
  return (
    <div className="axp-agent-manager axp-agent-manager__dialog fx-stack">
      {w && <p className="fx-small fx-muted">{w.description}</p>}
      {kind === 'builder' && <BuilderWizard done={done} />}
      {kind === 'agent' && <NewAgentWizard done={done} />}
      {kind === 'skill' && <NewSkillWizard done={done} />}
      {kind === 'tool' && <NewToolWizard done={done} />}
      {kind === 'training' && <TrainingWizard done={done} agentId={agentId} />}
      {!w && <p>Unknown wizard <Chip>{kind}</Chip></p>}
    </div>
  );
}
