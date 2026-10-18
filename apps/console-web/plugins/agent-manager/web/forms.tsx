/*
 * Agent manager forms. Each form edits a draft object and reports changes; editors add Save/Delete around them and
 * the wizards reuse the same forms step by step, so there is exactly one way to edit each kind of thing.
 */
import { useState, type ReactNode } from 'react';
import { Button, Chip, Icon, ICON_NAMES } from '@console/axf/react';
import {
  KIND_HELP, MEMORY_HELP, RECORD_HELP, SOURCE_HELP, lines, unlines,
  type Agent, type Cache, type JsonSchema, type Lingo, type Persona, type Skill, type Source, type Status, type Step, type Tool, type Training, type Workflow,
} from './api';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="axp-agent-manager__field"><span>{label}</span>{children}{hint && <span className="fx-small fx-muted">{hint}</span>}</label>;
}
export function Text({ value, onChange, placeholder, mono }: { value?: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <input className={`fx-input${mono ? ' fx-mono' : ''}`} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}
export function Area({ value, onChange, rows = 4, placeholder }: { value?: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea className="fx-input" rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}
export function Lines({ value, onChange, rows = 3, placeholder }: { value?: string[]; onChange: (v: string[]) => void; rows?: number; placeholder?: string }) {
  const [raw, setRaw] = useState(lines(value));
  return <textarea className="fx-input" rows={rows} value={raw} placeholder={placeholder ?? 'one per line'} onChange={(e) => { setRaw(e.target.value); onChange(unlines(e.target.value)); }} />;
}
export function Num({ value, onChange, min, max, step, placeholder }: { value?: number; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; placeholder?: string }) {
  return <input className="fx-input" type="number" min={min} max={max} step={step} placeholder={placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />;
}

/** Chips to toggle ids from a list. */
export function Pick<T extends { id: string; name: string; origin?: string }>({ items, value, onChange, empty }: { items: T[]; value?: string[]; onChange: (v: string[]) => void; empty?: string }) {
  const v = value ?? [];
  if (!items.length) return <p className="fx-small fx-muted">{empty ?? 'Nothing to choose yet.'}</p>;
  return (
    <div className="axp-agent-manager__picks">
      {items.map((it) => {
        const on = v.includes(it.id);
        return <button key={it.id} type="button" className={`axp-agent-manager__pick${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => onChange(on ? v.filter((x) => x !== it.id) : [...v, it.id])}>{on && <Icon name="check" size={11} />}{it.name}</button>;
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- persona, lingo, skill */

export function PersonaForm({ v, set }: { v: Partial<Persona>; set: (p: Partial<Persona>) => void }) {
  return (
    <div className="fx-stack">
      <div className="axp-agent-manager__cols">
        <Field label="Name"><Text value={v.name} onChange={(name) => set({ ...v, name })} placeholder="Senior reviewer" /></Field>
        <Field label="Role"><Text value={v.role} onChange={(role) => set({ ...v, role })} placeholder="What this persona is" /></Field>
        <Field label="Voice"><Text value={v.voice} onChange={(voice) => set({ ...v, voice })} placeholder="Direct, precise" /></Field>
        <Field label="Tone"><Text value={v.tone} onChange={(tone) => set({ ...v, tone })} placeholder="Calm, encouraging" /></Field>
      </div>
      <Field label="Traits" hint="One per line"><Lines value={v.traits} onChange={(traits) => set({ ...v, traits })} /></Field>
      <Field label="Rules" hint="Things this persona always / never does"><Lines value={v.rules} onChange={(rules) => set({ ...v, rules })} rows={4} /></Field>
    </div>
  );
}

export function LingoForm({ v, set }: { v: Partial<Lingo>; set: (p: Partial<Lingo>) => void }) {
  const g = v.glossary ?? [];
  return (
    <div className="fx-stack">
      <div className="axp-agent-manager__cols">
        <Field label="Name"><Text value={v.name} onChange={(name) => set({ ...v, name })} placeholder="Team vocabulary" /></Field>
        <Field label="Description"><Text value={v.description} onChange={(description) => set({ ...v, description })} /></Field>
      </div>
      <Field label="Style" hint="How replies should read"><Text value={v.style} onChange={(style) => set({ ...v, style })} placeholder="Short paragraphs, code blocks for code" /></Field>
      <Field label="Glossary" hint="Terms the agent must use exactly">
        <div className="fx-stack">
          {g.map((row, i) => (
            <div key={i} className="axp-agent-manager__row">
              <input className="fx-input" value={row.term} placeholder="term" aria-label="Term" onChange={(e) => set({ ...v, glossary: g.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)) })} />
              <input className="fx-input fx-grow" value={row.meaning} placeholder="meaning" aria-label="Meaning" onChange={(e) => set({ ...v, glossary: g.map((x, j) => (j === i ? { ...x, meaning: e.target.value } : x)) })} />
              <button type="button" className="fx-iconbtn" aria-label="Remove term" onClick={() => set({ ...v, glossary: g.filter((_, j) => j !== i) })}><Icon name="minus" size={12} /></button>
            </div>
          ))}
          <div><Button icon="plus" onClick={() => set({ ...v, glossary: [...g, { term: '', meaning: '' }] })}>Add term</Button></div>
        </div>
      </Field>
      <div className="axp-agent-manager__cols">
        <Field label="Preferred phrases"><Lines value={v.phrases} onChange={(phrases) => set({ ...v, phrases })} /></Field>
        <Field label="Avoid"><Lines value={v.avoid} onChange={(avoid) => set({ ...v, avoid })} /></Field>
      </div>
    </div>
  );
}

export const SKILL_TEMPLATES: Record<string, Partial<Skill>> = {
  blank: {},
  reviewer: { name: 'Code review', description: 'Find bugs and risks by severity', instructions: 'Review for correctness, security, data loss, performance, then readability. Report: severity · location · issue · fix. End with a corrected snippet for the top issue.', triggers: ['review', 'diff', 'PR'] },
  researcher: { name: 'Research', description: 'Answer with sources', instructions: 'Search before answering, read the best 2-3 sources, then answer with citations (title + URL). Say what is uncertain or out of date.', triggers: ['research', 'find out', 'latest'] },
  writer: { name: 'Technical writing', description: 'Clear docs and explanations', instructions: 'Lead with the answer, then details. Short paragraphs, lists for steps, code blocks for commands. Define terms on first use.', triggers: ['document', 'explain', 'write up'] },
  planner: { name: 'Planning', description: 'Turn a goal into steps', instructions: 'Restate the goal, list assumptions, then numbered steps with owners/files, risks and a test plan.', triggers: ['plan', 'roadmap', 'steps'] },
};

export function SkillForm({ v, set, tools }: { v: Partial<Skill>; set: (p: Partial<Skill>) => void; tools: Tool[] }) {
  const ex = v.examples ?? [];
  return (
    <div className="fx-stack">
      <div className="axp-agent-manager__cols">
        <Field label="Name"><Text value={v.name} onChange={(name) => set({ ...v, name })} placeholder="Code review" /></Field>
        <Field label="Description"><Text value={v.description} onChange={(description) => set({ ...v, description })} placeholder="One line: what it's for" /></Field>
      </div>
      <Field label="Instructions" hint="How the agent performs this skill — added to its system prompt"><Area value={v.instructions} onChange={(instructions) => set({ ...v, instructions })} rows={6} /></Field>
      <Field label="Triggers" hint="Words or situations where the skill applies"><Lines value={v.triggers} onChange={(triggers) => set({ ...v, triggers })} rows={2} /></Field>
      <Field label="Examples (few-shot)">
        <div className="fx-stack">
          {ex.map((e, i) => (
            <div key={i} className="axp-agent-manager__example">
              <textarea className="fx-input" rows={2} placeholder="input" value={e.input} aria-label="Example input" onChange={(x) => set({ ...v, examples: ex.map((y, j) => (j === i ? { ...y, input: x.target.value } : y)) })} />
              <textarea className="fx-input" rows={2} placeholder="ideal output" value={e.output} aria-label="Example output" onChange={(x) => set({ ...v, examples: ex.map((y, j) => (j === i ? { ...y, output: x.target.value } : y)) })} />
              <button type="button" className="fx-iconbtn" aria-label="Remove example" onClick={() => set({ ...v, examples: ex.filter((_, j) => j !== i) })}><Icon name="minus" size={12} /></button>
            </div>
          ))}
          <div><Button icon="plus" onClick={() => set({ ...v, examples: [...ex, { input: '', output: '' }] })}>Add example</Button></div>
        </div>
      </Field>
      <Field label="Tools this skill needs" hint="Attached to any agent that has the skill"><Pick items={tools} value={v.toolIds} onChange={(toolIds) => set({ ...v, toolIds })} empty="No tools yet — create one in Tools." /></Field>
    </div>
  );
}

/* ---------------------------------------------------------------- tool */

interface Param { name: string; type: string; description: string; required: boolean }
const toParams = (s?: JsonSchema): Param[] => Object.entries(s?.properties ?? {}).map(([name, p]) => ({ name, type: p.type ?? 'string', description: p.description ?? '', required: (s?.required ?? []).includes(name) }));
const toSchema = (ps: Param[]): JsonSchema => ({ type: 'object', properties: Object.fromEntries(ps.filter((p) => p.name).map((p) => [p.name, { type: p.type, ...(p.description ? { description: p.description } : {}) }])), required: ps.filter((p) => p.required && p.name).map((p) => p.name) });

export function ToolForm({ v, set, status, cache }: { v: Partial<Tool>; set: (p: Partial<Tool>) => void; status?: Status; cache?: Cache }) {
  const kind = v.kind ?? 'builtin';
  const cfg = (v.config ?? {}) as Record<string, string | boolean | number | Record<string, string>>;
  const setCfg = (patch: Record<string, unknown>) => set({ ...v, config: { ...cfg, ...patch } });
  const [params, setParams] = useState<Param[]>(() => toParams(v.parameters));
  const upd = (ps: Param[]) => { setParams(ps); set({ ...v, parameters: toSchema(ps) }); };
  const headers = (cfg.headers as Record<string, string> | undefined) ?? {};
  return (
    <div className="fx-stack">
      <Field label="Kind">
        <div className="axp-agent-manager__picks">
          {(status?.toolKinds ?? Object.keys(KIND_HELP)).map((k) => <button key={k} type="button" className={`axp-agent-manager__pick${kind === k ? ' is-active' : ''}`} aria-pressed={kind === k} title={KIND_HELP[k]} onClick={() => set({ ...v, kind: k, config: {} })}>{k}</button>)}
        </div>
        <span className="fx-small fx-muted">{KIND_HELP[kind]}</span>
      </Field>
      <div className="axp-agent-manager__cols">
        <Field label="Function name" hint="What the model calls: letters, digits, underscores"><Text mono value={v.name} onChange={(name) => set({ ...v, name: name.replace(/[^a-zA-Z0-9_]/g, '_') })} placeholder="get_weather" /></Field>
        <Field label="Description" hint="Tell the model when to use it"><Text value={v.description} onChange={(description) => set({ ...v, description })} /></Field>
      </div>
      {kind === 'builtin' && (
        <Field label="Built-in tool">
          <select className="fx-input" value={String(cfg.builtin ?? '')} onChange={(e) => set({ ...v, name: v.name || e.target.value, config: { builtin: e.target.value }, description: v.description || status?.builtins[e.target.value] })}>
            <option value="">Choose…</option>
            {Object.entries(status?.builtins ?? {}).map(([k, d]) => <option key={k} value={k}>{k} — {d.slice(0, 70)}</option>)}
          </select>
        </Field>
      )}
      {kind === 'http' && (
        <>
          <div className="axp-agent-manager__cols">
            <Field label="Method"><select className="fx-input" value={String(cfg.method ?? 'GET')} onChange={(e) => setCfg({ method: e.target.value })}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</select></Field>
            <Field label="URL" hint="Use {{param}} for arguments"><Text mono value={String(cfg.url ?? '')} onChange={(url) => setCfg({ url })} placeholder="https://api.example.com/items/{{id}}" /></Field>
          </div>
          <Field label="Headers" hint="Secrets: write env:MY_VAR and set it on the console server">
            <div className="fx-stack">
              {Object.entries(headers).map(([k, val], i) => (
                <div key={i} className="axp-agent-manager__row">
                  <input className="fx-input" value={k} aria-label="Header" onChange={(e) => { const h = { ...headers }; delete h[k]; h[e.target.value] = val; setCfg({ headers: h }); }} />
                  <input className="fx-input fx-mono fx-grow" value={val} aria-label="Value" onChange={(e) => setCfg({ headers: { ...headers, [k]: e.target.value } })} />
                  <button type="button" className="fx-iconbtn" aria-label="Remove header" onClick={() => { const h = { ...headers }; delete h[k]; setCfg({ headers: h }); }}><Icon name="minus" size={12} /></button>
                </div>
              ))}
              <div><Button icon="plus" onClick={() => setCfg({ headers: { ...headers, [`X-Header-${Object.keys(headers).length + 1}`]: '' } })}>Add header</Button></div>
            </div>
          </Field>
          <Field label="JSON body template (optional)" hint="Leave empty to send the arguments as JSON"><Area value={String(cfg.body ?? '')} onChange={(body) => setCfg({ body })} rows={3} placeholder='{"q": "{{query}}"}' /></Field>
          <label className="axp-agent-manager__toggle"><input type="checkbox" checked={!!cfg.allowPrivate} onChange={(e) => setCfg({ allowPrivate: e.target.checked })} /> Allow private/internal addresses (only for services on your VPS you trust)</label>
        </>
      )}
      {kind === 'mcp' && (
        <div className="axp-agent-manager__cols">
          <Field label="MCP server URL (Streamable HTTP)"><Text mono value={String(cfg.url ?? '')} onChange={(url) => setCfg({ url })} placeholder="https://axhub.amberxai.com/mcp" /></Field>
          <Field label="Token environment variable"><Text mono value={String(cfg.tokenEnv ?? '')} onChange={(tokenEnv) => setCfg({ tokenEnv: tokenEnv.toUpperCase() })} placeholder="AXHUB_TOKEN" /></Field>
          <Field label="Remote tool name"><Text mono value={String(cfg.tool ?? '')} onChange={(tool) => setCfg({ tool })} placeholder="list_services" /></Field>
        </div>
      )}
      {kind === 'prompt' && (
        <>
          <Field label="Prompt template" hint="{{param}} placeholders are filled from the arguments"><Area value={String(cfg.template ?? '')} onChange={(template) => setCfg({ template })} rows={4} placeholder="Translate to {{language}}: {{text}}" /></Field>
          <div className="axp-agent-manager__cols">
            <Field label="System prompt (optional)"><Text value={String(cfg.system ?? '')} onChange={(system) => setCfg({ system })} /></Field>
            <Field label="Model (optional)"><Text mono value={String(cfg.model ?? '')} onChange={(model) => setCfg({ model })} placeholder="default" /></Field>
          </div>
        </>
      )}
      {kind === 'agent' && (
        <Field label="Delegate to agent" hint="The tool takes a `task` argument"><select className="fx-input" value={String(cfg.agentId ?? '')} onChange={(e) => set({ ...v, config: { agentId: e.target.value }, parameters: toSchema([{ name: 'task', type: 'string', description: 'What to do', required: true }]) })}><option value="">Choose…</option>{cache?.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      )}
      {kind === 'workflow' && (
        <Field label="Run workflow" hint="The tool takes an `input` argument"><select className="fx-input" value={String(cfg.workflowId ?? '')} onChange={(e) => set({ ...v, config: { workflowId: e.target.value }, parameters: toSchema([{ name: 'input', type: 'string', description: 'Input for the workflow', required: true }]) })}><option value="">Choose…</option>{cache?.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      )}
      {kind !== 'builtin' && kind !== 'agent' && kind !== 'workflow' && (
        <Field label="Parameters" hint="What the model must pass; becomes the tool's JSON Schema">
          <div className="fx-stack">
            {params.map((p, i) => (
              <div key={i} className="axp-agent-manager__row">
                <input className="fx-input fx-mono" value={p.name} placeholder="name" aria-label="Parameter name" onChange={(e) => upd(params.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') } : x)))} />
                <select className="fx-input" value={p.type} aria-label="Type" onChange={(e) => upd(params.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>{['string', 'number', 'integer', 'boolean', 'array', 'object'].map((t) => <option key={t}>{t}</option>)}</select>
                <input className="fx-input fx-grow" value={p.description} placeholder="description" aria-label="Description" onChange={(e) => upd(params.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <label className="axp-agent-manager__toggle"><input type="checkbox" checked={p.required} onChange={(e) => upd(params.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />req.</label>
                <button type="button" className="fx-iconbtn" aria-label="Remove parameter" onClick={() => upd(params.filter((_, j) => j !== i))}><Icon name="minus" size={12} /></button>
              </div>
            ))}
            <div><Button icon="plus" onClick={() => upd([...params, { name: '', type: 'string', description: '', required: false }])}>Add parameter</Button></div>
          </div>
        </Field>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- agent */

export type AgentSection = 'identity' | 'persona' | 'lingo' | 'skills' | 'tools' | 'model' | 'memory' | 'delegates' | 'instructions';
const ALL: AgentSection[] = ['identity', 'persona', 'lingo', 'skills', 'tools', 'delegates', 'instructions', 'model', 'memory'];
const ICONS = ['user', 'code', 'layers', 'sparkles', 'zap', 'shield', 'terminal', 'chart', 'rocket', 'star', 'help', 'cloud', 'github', 'palette', 'package', 'file'];

export function AgentForm({ v, set, cache, status, only }: { v: Partial<Agent>; set: (p: Partial<Agent>) => void; cache: Cache; status?: Status; only?: AgentSection[] }) {
  const show = (s: AgentSection) => (only ?? ALL).includes(s);
  const m = v.model ?? {};
  const mem = v.memory ?? {};
  const setM = (p: Partial<typeof m>) => set({ ...v, model: { ...m, ...p } });
  const setMem = (p: Partial<typeof mem>) => set({ ...v, memory: { ...mem, ...p } });
  return (
    <div className="fx-stack">
      {show('identity') && (
        <>
          <div className="axp-agent-manager__cols">
            <Field label="Name"><Text value={v.name} onChange={(name) => set({ ...v, name })} placeholder="Release manager" /></Field>
            <Field label="Icon">
              <select className="fx-input" value={v.icon ?? 'user'} onChange={(e) => set({ ...v, icon: e.target.value })}>{ICONS.filter((i) => ICON_NAMES.includes(i)).map((i) => <option key={i}>{i}</option>)}</select>
            </Field>
          </div>
          <Field label="Description" hint="Shown in pickers; also tells other agents when to delegate"><Text value={v.description} onChange={(description) => set({ ...v, description })} /></Field>
          <label className="axp-agent-manager__toggle"><input type="checkbox" checked={v.enabled !== false} onChange={(e) => set({ ...v, enabled: e.target.checked })} /> Enabled (available in the assistant and workflows)</label>
        </>
      )}
      {show('persona') && (
        <Field label="Persona">
          <select className="fx-input" value={v.personaId ?? ''} onChange={(e) => set({ ...v, personaId: e.target.value })}><option value="">None</option>{cache.personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </Field>
      )}
      {show('lingo') && <Field label="Lingo packs"><Pick items={cache.lingo} value={v.lingoIds} onChange={(lingoIds) => set({ ...v, lingoIds })} empty="No lingo packs yet." /></Field>}
      {show('skills') && <Field label="Skills"><Pick items={cache.skills} value={v.skillIds} onChange={(skillIds) => set({ ...v, skillIds })} empty="No skills yet." /></Field>}
      {show('tools') && <Field label="Tools" hint="Plus the tools its skills need, and memory tools when memory is on"><Pick items={cache.tools} value={v.toolIds} onChange={(toolIds) => set({ ...v, toolIds })} empty="No tools yet." /></Field>}
      {show('delegates') && <Field label="Can delegate to" hint="Each becomes an ask_<agent> tool"><Pick items={cache.agents.filter((a) => a.id !== v.id)} value={v.delegates} onChange={(delegates) => set({ ...v, delegates })} empty="No other agents yet." /></Field>}
      {show('instructions') && <Field label="Extra instructions"><Area value={v.instructions} onChange={(instructions) => set({ ...v, instructions })} rows={4} /></Field>}
      {show('model') && (
        <div className="axp-agent-manager__cols">
          {status?.llm.source === 'assistant' ? (
            <Field label="Provider" hint="From the AI assistant's profiles">
              <select className="fx-input" value={m.profile ?? ''} onChange={(e) => setM({ profile: e.target.value })}><option value="">Assistant default</option>{status.llm.profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            </Field>
          ) : <Field label="Provider" hint="Settings → Agent manager → Model"><input className="fx-input" disabled value={status?.llm.kind ?? 'own'} /></Field>}
          <Field label="Model"><Text mono value={m.model} onChange={(model) => setM({ model })} placeholder={status?.llm.profiles.find((p) => p.id === m.profile)?.defaultModel || status?.llm.model || 'default'} /></Field>
          <Field label={`Temperature: ${m.temperature ?? 'default'}`}><input type="range" min={0} max={1.5} step={0.05} value={m.temperature ?? 0.5} onChange={(e) => setM({ temperature: Number(e.target.value) })} /></Field>
          <Field label="Max output tokens"><Num value={m.max_tokens} onChange={(max_tokens) => setM({ max_tokens })} placeholder="4096" /></Field>
        </div>
      )}
      {show('memory') && (
        <div className="fx-stack">
          <Field label="Memory type">
            <div className="axp-agent-manager__picks">
              {(status?.memoryTypes ?? Object.keys(MEMORY_HELP)).map((t) => <button key={t} type="button" className={`axp-agent-manager__pick${(mem.type ?? 'hybrid') === t ? ' is-active' : ''}`} aria-pressed={(mem.type ?? 'hybrid') === t} onClick={() => setMem({ type: t })}>{t}</button>)}
            </div>
            <span className="fx-small fx-muted">{MEMORY_HELP[mem.type ?? 'hybrid']}</span>
          </Field>
          {(mem.type ?? 'hybrid') !== 'none' && (
            <div className="axp-agent-manager__cols">
              <Field label="Record"><select className="fx-input" value={mem.record ?? 'both'} onChange={(e) => setMem({ record: e.target.value })}>{Object.entries(RECORD_HELP).map(([k, d]) => <option key={k} value={k}>{k} — {d}</option>)}</select></Field>
              <Field label="Recall top K"><Num value={mem.topK} min={1} max={30} onChange={(topK) => setMem({ topK })} placeholder="6" /></Field>
              <Field label="Recent exchanges"><Num value={mem.window} min={1} max={50} onChange={(window) => setMem({ window })} placeholder="8" /></Field>
              <Field label="Max items"><Num value={mem.maxItems} min={50} max={50000} onChange={(maxItems) => setMem({ maxItems })} placeholder="2000" /></Field>
              <Field label="Forget unused exchanges after (days)" hint="0 = never"><Num value={mem.decayDays} min={0} onChange={(decayDays) => setMem({ decayDays })} placeholder="0" /></Field>
              <Field label="Shared scope (optional)" hint="Agents with the same scope share one memory"><Text mono value={mem.scope} onChange={(scope) => setMem({ scope: scope.toLowerCase().replace(/[^a-z0-9._-]/g, '-') })} placeholder={v.id || 'own'} /></Field>
              {status?.llm.source === 'assistant' && <Field label="Embeddings from"><select className="fx-input" value={mem.embedProfile ?? ''} onChange={(e) => setMem({ embedProfile: e.target.value })}><option value="">Assistant default</option>{status.llm.profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- workflow */

export function WorkflowForm({ v, set, cache }: { v: Partial<Workflow>; set: (p: Partial<Workflow>) => void; cache: Cache }) {
  const steps = v.steps ?? [];
  const mode = v.mode ?? 'sequential';
  const up = (i: number, p: Partial<Step>) => set({ ...v, steps: steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <div className="fx-stack">
      <div className="axp-agent-manager__cols">
        <Field label="Name"><Text value={v.name} onChange={(name) => set({ ...v, name })} /></Field>
        <Field label="Mode">
          <select className="fx-input" value={mode} onChange={(e) => set({ ...v, mode: e.target.value })}>
            <option value="sequential">sequential — each step feeds the next</option>
            <option value="parallel">parallel — all at once, optional merge</option>
            <option value="router">router — an agent picks the step</option>
            <option value="critic">critic — draft, review, revise</option>
          </select>
        </Field>
      </div>
      <Field label="Description"><Text value={v.description} onChange={(description) => set({ ...v, description })} /></Field>
      {mode === 'router' && <Field label="Router agent"><select className="fx-input" value={v.routerAgentId ?? ''} onChange={(e) => set({ ...v, routerAgentId: e.target.value })}><option value="">Choose…</option>{cache.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
      {mode === 'parallel' && <Field label="Merge answers with (optional)"><select className="fx-input" value={v.synthAgentId ?? ''} onChange={(e) => set({ ...v, synthAgentId: e.target.value })}><option value="">Don't merge — show all</option>{cache.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
      {mode === 'critic' && <Field label="Max review rounds"><Num value={v.maxLoops} min={1} max={6} onChange={(maxLoops) => set({ ...v, maxLoops })} placeholder="3" /></Field>}
      <span className="fx-small fx-muted">Steps{mode === 'critic' ? ' — first writes, second reviews' : ''}. Prompts can use {'{{input}}'}, {'{{previous}}'} and {'{{steps.<id>}}'}.</span>
      {steps.map((s, i) => (
        <div key={i} className="axp-agent-manager__card fx-stack">
          <div className="axp-agent-manager__row">
            <input className="fx-input fx-mono" value={s.id} aria-label="Step id" onChange={(e) => up(i, { id: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} />
            <select className="fx-input fx-grow" value={s.agentId} aria-label="Agent" onChange={(e) => up(i, { agentId: e.target.value })}><option value="">Agent…</option>{cache.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <button type="button" className="fx-iconbtn" aria-label="Remove step" onClick={() => set({ ...v, steps: steps.filter((_, j) => j !== i) })}><Icon name="trash" size={12} /></button>
          </div>
          <textarea className="fx-input" rows={2} value={s.prompt ?? ''} placeholder={i === 0 ? '{{input}}' : '{{previous}}'} aria-label="Prompt" onChange={(e) => up(i, { prompt: e.target.value })} />
          {mode === 'router' && <input className="fx-input" value={s.when ?? ''} placeholder="when to pick this step" aria-label="When" onChange={(e) => up(i, { when: e.target.value })} />}
        </div>
      ))}
      <div><Button icon="plus" onClick={() => set({ ...v, steps: [...steps, { id: `s${steps.length + 1}`, agentId: cache.agents[0]?.id ?? '', prompt: '' }] })}>Add step</Button></div>
    </div>
  );
}

/* ---------------------------------------------------------------- training */

export function SourceEditor({ s, set, onRemove }: { s: Source; set: (s: Source) => void; onRemove: () => void }) {
  return (
    <div className="axp-agent-manager__card fx-stack">
      <div className="axp-agent-manager__row">
        <select className="fx-input fx-grow" value={s.type} aria-label="Source type" onChange={(e) => set({ type: e.target.value })}>{Object.entries(SOURCE_HELP).map(([k, d]) => <option key={k} value={k}>{k} — {d}</option>)}</select>
        <button type="button" className="fx-iconbtn" aria-label="Remove source" onClick={onRemove}><Icon name="trash" size={12} /></button>
      </div>
      {['firecrawl-scrape', 'firecrawl-crawl', 'url'].includes(s.type) && <Text mono value={s.url} onChange={(url) => set({ ...s, url })} placeholder="https://docs.example.com/guide" />}
      {s.type === 'firecrawl-crawl' && <div className="axp-agent-manager__cols"><Field label="Max pages"><Num value={s.limit} min={1} max={500} onChange={(limit) => set({ ...s, limit })} placeholder="20" /></Field><Field label="Only paths (optional)"><Lines value={s.include} onChange={(include) => set({ ...s, include })} rows={1} placeholder="docs/.*" /></Field></div>}
      {s.type === 'firecrawl-search' && <div className="axp-agent-manager__cols"><Text value={s.query} onChange={(query) => set({ ...s, query })} placeholder="search query" /><Num value={s.limit} min={1} max={20} onChange={(limit) => set({ ...s, limit })} placeholder="5" /></div>}
      {s.type === 'repo' && <Field label="File globs" hint="e.g. framework/spec/*.md"><Lines value={s.paths} onChange={(paths) => set({ ...s, paths })} rows={3} /></Field>}
      {s.type === 'text' && <><Text value={s.title} onChange={(title) => set({ ...s, title })} placeholder="title" /><Area value={s.text} onChange={(text) => set({ ...s, text })} rows={5} placeholder="Paste notes, docs, transcripts…" /></>}
      {(s.type === 'mcp-resource' || s.type === 'mcp-tool') && (
        <div className="axp-agent-manager__cols">
          <Text mono value={s.url} onChange={(url) => set({ ...s, url })} placeholder="https://server/mcp" />
          <Text mono value={s.tokenEnv} onChange={(tokenEnv) => set({ ...s, tokenEnv: tokenEnv.toUpperCase() })} placeholder="TOKEN_ENV (optional)" />
          {s.type === 'mcp-resource' ? <Text mono value={s.uri} onChange={(uri) => set({ ...s, uri })} placeholder="resource uri" /> : <Text mono value={s.tool} onChange={(tool) => set({ ...s, tool })} placeholder="tool name" />}
        </div>
      )}
    </div>
  );
}

export function TrainingForm({ v, set, cache, status, lockAgent }: { v: Partial<Training>; set: (p: Partial<Training>) => void; cache: Cache; status?: Status; lockAgent?: boolean }) {
  const src = v.sources ?? [];
  const needsFc = src.some((s) => s.type.startsWith('firecrawl'));
  return (
    <div className="fx-stack">
      <div className="axp-agent-manager__cols">
        <Field label="Name"><Text value={v.name} onChange={(name) => set({ ...v, name })} placeholder="Product docs" /></Field>
        {!lockAgent && <Field label="Agent to train"><select className="fx-input" value={v.agentId ?? ''} onChange={(e) => set({ ...v, agentId: e.target.value })}><option value="">Choose…</option>{cache.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
      </div>
      <span className="fx-small fx-muted">Sources</span>
      {src.map((s, i) => <SourceEditor key={i} s={s} set={(n) => set({ ...v, sources: src.map((x, j) => (j === i ? n : x)) })} onRemove={() => set({ ...v, sources: src.filter((_, j) => j !== i) })} />)}
      <div className="fx-row fx-row--wrap">
        {['firecrawl-crawl', 'firecrawl-search', 'url', 'repo', 'text', 'mcp-resource'].map((t) => <Button key={t} icon="plus" onClick={() => set({ ...v, sources: [...src, { type: t }] })}>{t}</Button>)}
      </div>
      {needsFc && !status?.firecrawl && <div className="axp-agent-manager__note is-warn"><Icon name="alert" size={14} />Firecrawl sources need FIRECRAWL_API_KEY on the server or a key in Settings → Agent manager → Training.</div>}
      <div className="axp-agent-manager__cols">
        <Field label="Schedule"><select className="fx-input" value={v.schedule ?? 'manual'} onChange={(e) => set({ ...v, schedule: e.target.value })}>{['manual', 'hourly', 'daily', 'weekly'].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Chunk size (characters)"><Num value={v.chunkSize} min={300} max={6000} onChange={(chunkSize) => set({ ...v, chunkSize })} placeholder="1200" /></Field>
        <Field label="Overlap"><Num value={v.overlap} min={0} max={1000} onChange={(overlap) => set({ ...v, overlap })} placeholder="120" /></Field>
        <Field label="Tags"><Lines value={v.tags} onChange={(tags) => set({ ...v, tags })} rows={1} /></Field>
      </div>
      <label className="axp-agent-manager__toggle"><input type="checkbox" checked={v.replace !== false} onChange={(e) => set({ ...v, replace: e.target.checked })} /> Each run replaces what the previous run of this job added</label>
    </div>
  );
}

export function OriginChip({ origin }: { origin?: string }) {
  if (!origin || origin === 'user') return null;
  return <Chip tone="accent">{origin.startsWith('addon:') ? `add-on ${origin.slice(6)}` : origin}</Chip>;
}
