/**
 * Prompt engine console plugin (ai.amberx.axf.console.prompt-engine) — the control panel of prompt-engine@1.
 *
 *   - page `prompt-engine` (Builds → Prompt engine): Events (rules), Builder, Macros, Pipelines, Waiting, History, Registry
 *   - builder: left = every source and its events (the registry), middle = trigger, conditions, limits and what to ask,
 *     right = actions per answer; every list only offers what is valid for what is already picked (POST /options)
 *   - actions: prompt-engine.open, prompt-engine.waiting, prompt-engine.new (console_action, menus, search, voice)
 *   - everything here is a server route = plugin command: REST /api/plugins/prompt-engine/…, MCP prompt-engine_<command>,
 *     CLI `axf prompt-engine <command>`, voice through AmberX; deep link console_show view:prompt-engine
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Checkbox, Chip, Container, Note, SelectField, Switch, TabGroup, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { LoadingSkeleton } from '@console/emptyState';
import './prompt-engine.css';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.prompt-engine';
const FOLDER = 'prompt-engine';
const VIEW = 'prompt-engine';
const TAB_KEY = 'prompt-engine.tab';
const COUNTER = 'prompt-engine.waiting';
type Tab = 'events' | 'builder' | 'macros' | 'pipelines' | 'waiting' | 'history' | 'registry';
const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: 'events', label: 'Events', icon: 'zap' }, { value: 'builder', label: 'Builder', icon: 'edit' }, { value: 'macros', label: 'Macros', icon: 'list' }, { value: 'pipelines', label: 'Pipelines', icon: 'layers' },
  { value: 'waiting', label: 'Waiting', icon: 'bell' }, { value: 'history', label: 'History', icon: 'clock' }, { value: 'registry', label: 'Registry', icon: 'box' },
];

/* ---------------- types (the engine's records, as the server returns them) ---------------- */
interface Field { name: string; type: string; title: string; required?: boolean; enum?: string[]; dependsOn?: string; choices?: { id: string; title: string }[] | null }
interface Action { action: string; input: Record<string, unknown>; title?: string }
interface Ask { kind: string; title: string; text: string; options: { id: string; label: string }[]; countdownSec: number; outputs: string[] }
interface Cond { field: string; op: string; value?: unknown }
interface Rule { id: string; title: string; description: string; enabled: boolean; trigger: { source: string; event: string; filter: Record<string, unknown> }; when: { all: Cond[] } | null; limits: { cooldownSec: number; dedupeKey: string; dedupeSec: number; maxPerHour: number }; ask: Ask; on: Record<string, Action[] | Record<string, Action[]>>; summary?: string; template?: string }
interface Macro { id: string; title: string; description: string; params: { name: string; type: string; title: string; required?: boolean; default?: unknown }[]; steps: Action[] }
interface Stage { id: string; title: string; actions: Action[]; gate?: Ask }
interface Pipeline { id: string; title: string; description: string; stages: Stage[] }
interface Instance { n?: number; id: string; rule: string; ruleTitle: string; kind: string; title: string; text: string; options: { id: string; label: string }[]; countdownSec: number; askedAt: string; expiresAt: string; status: string; answers: string[]; keysNeeded?: string[] }
interface Options { sources: { id: string; title: string; group: string; events: number; actions: number }[]; events: { id: string; title: string; source: string }[]; fields: Field[]; ops: string[]; values?: string[]; askKinds: string[]; outputs: { id: string; available: boolean }[]; answers: string[]; actions: { id: string; title: string; source: string; group: string; effect: string; missing: string[] }[]; inputs: Field[]; groups: string[] }
interface State { rules: Rule[]; macros: Macro[]; pipelines: Pipeline[]; waiting: Instance[]; counts: { rules: number; enabled: number; macros: number; pipelines: number; waiting: number; shelved: number }; registry: { sources: number; events: number; actions: number; connectors: string[] }; templates: { id: string; title: string; group: string; description: string }[] }
interface Audit { at: string; kind: string; rule?: string; instance?: string; event?: string; reason?: string; by?: string; detail?: Record<string, unknown> }

/* ---------------- api ---------------- */
async function api<T = Record<string, unknown>>(path: string, body?: unknown, method?: string): Promise<T & { ok: boolean; error?: string }> {
  try {
    const r = await pluginFetch(FOLDER, path, body === undefined ? { method: method ?? 'GET' } : { method: method ?? 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.status === 401) return { ...(j as T), ok: false, error: 'Set the console token (Settings → Account & security).' };
    if (!r.ok) { const d = j.detail as { error?: string } | string | undefined; return { ...(j as T), ok: false, error: typeof d === 'string' ? d : d?.error ?? (j.error as string) ?? `The console answered ${r.status}.` }; }
    return { ...(j as T), ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message } as T & { ok: boolean; error?: string }; }
}
let runtime: AxfRuntime | null = null;
let openTab: Tab | null = null;
let editRuleId: string | null = null;

/* ---------------- small pieces ---------------- */
const EFFECT_TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = { read: undefined, write: 'accent', destructive: 'danger', navigate: 'success', ask: 'warning' };
const label = (s: string) => s.replace(/[-_.]/g, ' ');
const branchesOf = (ask: Ask): string[] => (ask.kind === 'none' ? ['fire'] : ask.kind === 'approve' ? ['approve', 'deny', 'later'] : ask.kind === 'veto' ? ['approve', 'deny', 'timeout', 'later'] : ask.kind === 'pick' ? ['deny', 'later'] : ['text', 'deny', 'later']);
const emptyAsk = (): Ask => ({ kind: 'approve', title: '', text: '', options: [], countdownSec: 90, outputs: ['dialog', 'push'] });
const emptyRule = (): Rule => ({ id: '', title: '', description: '', enabled: true, trigger: { source: '', event: '', filter: {} }, when: null, limits: { cooldownSec: 0, dedupeKey: '', dedupeSec: 0, maxPerHour: 0 }, ask: emptyAsk(), on: {} });

/** One action row: the action (grouped by source) and its inputs; inputs with live choices become selects. */
function ActionRow({ a, actions, onChange, onRemove }: { a: Action; actions: Options['actions']; onChange: (a: Action) => void; onRemove: () => void }) {
  const [inputs, setInputs] = useState<Field[]>([]);
  useEffect(() => { if (!a.action) { setInputs([]); return; } void api<Options>('options', { action: a.action, input: a.input }).then((o) => setInputs(o.ok ? o.inputs : [])); }, [a.action, JSON.stringify(a.input.plugin ?? '')]);
  const def = actions.find((x) => x.id === a.action);
  return (
    <div className="axp-pe__action">
      <div className="axp-pe__head">
        <SelectField label="Action" value={a.action} empty="Pick an action…" onChange={(v) => onChange({ action: v, input: {} })} options={actions.map((x) => ({ value: x.id, label: `${x.group} · ${x.title}${x.missing.length ? ' (keys needed)' : ''}` }))} />
        {def && <Chip tone={EFFECT_TONE[def.effect]}>{def.effect}</Chip>}
        {def?.missing.length ? <Chip tone="warning">needs {def.missing.join(', ')}</Chip> : null}
        <Button tone="ghost" size="sm" icon="x" onClick={onRemove}>Remove</Button>
      </div>
      {inputs.length > 0 && (
        <div className="axp-pe__inputs">
          {inputs.map((f) => (f.choices && f.choices.length
            ? <SelectField key={f.name} label={f.title + (f.required ? ' *' : '')} value={String(a.input[f.name] ?? '')} empty="…" onChange={(v) => onChange({ ...a, input: { ...a.input, [f.name]: v } })} options={f.choices.map((c) => ({ value: c.id, label: c.title }))} />
            : <TextField key={f.name} label={f.title + (f.required ? ' *' : '')} value={typeof a.input[f.name] === 'object' ? JSON.stringify(a.input[f.name]) : String(a.input[f.name] ?? '')} onChange={(v) => onChange({ ...a, input: { ...a.input, [f.name]: f.type === 'object' || f.type === 'list' ? parseMaybe(v) : v } })} rows={f.type === 'text' ? 2 : undefined} hint={f.type === 'object' ? 'JSON or {{field}} templates' : undefined} />))}
        </div>
      )}
    </div>
  );
}
const parseMaybe = (v: string): unknown => { try { return JSON.parse(v); } catch { return v; } };

function ActionList({ list, actions, onChange }: { list: Action[]; actions: Options['actions']; onChange: (l: Action[]) => void }) {
  return (
    <div className="axp-pe__branch">
      {list.map((a, i) => <ActionRow key={i} a={a} actions={actions} onChange={(n) => onChange(list.map((x, j) => (j === i ? n : x)))} onRemove={() => onChange(list.filter((_, j) => j !== i))} />)}
      <div><Button tone="neutral" size="sm" icon="plus" onClick={() => onChange([...list, { action: '', input: {} }])}>Add action</Button></div>
    </div>
  );
}

/* ---------------- the builder ---------------- */
function Builder({ initial, onSaved, onCancel }: { initial: Rule; onSaved: () => void; onCancel: () => void }) {
  const rt = useRuntime();
  const [rule, setRule] = useState<Rule>(initial);
  const [opts, setOpts] = useState<Options | null>(null);
  const [evOpts, setEvOpts] = useState<Options | null>(null);
  const [error, setError] = useState('');
  const [test, setTest] = useState<Record<string, unknown> | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [json, setJson] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const isNew = !initial.id;
  useEffect(() => { void api<Options>('options', {}).then((o) => o.ok && setOpts(o)); }, []);
  useEffect(() => { if (!rule.trigger.event) { setEvOpts(null); return; } void api<Options>('options', { source: rule.trigger.source, event: rule.trigger.event, ask: rule.ask.kind }).then((o) => o.ok && setEvOpts(o)); }, [rule.trigger.event, rule.trigger.source, rule.ask.kind]);
  const set = (p: Partial<Rule>) => setRule((r) => ({ ...r, ...p }));
  const conds: Cond[] = rule.when?.all ?? [];
  const setConds = (all: Cond[]) => set({ when: all.length ? { all } : null });
  const filter = Object.entries(rule.trigger.filter);
  const setFilter = (entries: [string, unknown][]) => set({ trigger: { ...rule.trigger, filter: Object.fromEntries(entries.filter(([k]) => k)) } });
  const branches = branchesOf(rule.ask);
  const onBranch = (k: string): Action[] => (Array.isArray(rule.on[k]) ? (rule.on[k] as Action[]) : []);
  const onPick = (o: string): Action[] => ((rule.on.pick as Record<string, Action[]> | undefined)?.[o] ?? []);
  const fields = evOpts?.fields ?? [];
  const fieldOf = (name: string) => fields.find((f) => f.name === name);
  const save = async () => {
    setError('');
    const body = { ...rule, id: rule.id || undefined };
    const r = isNew ? await api('rules', body) : await api(`rules/${encodeURIComponent(rule.id)}/update`, body);
    if (!r.ok) { setError(r.error ?? 'Could not save.'); return; }
    rt.toast(isNew ? 'Rule added.' : 'Rule saved.', 'success', 'Prompt engine');
    onSaved();
  };
  const dryRun = async () => {
    setError('');
    if (isNew) { setError('Save the rule first, then test it.'); return; }
    const r = await api(`rules/${encodeURIComponent(rule.id)}/test`, {});
    if (!r.ok) { setError(r.error ?? 'Test failed.'); return; }
    setTest(r as Record<string, unknown>);
  };
  const groups = useMemo(() => { const g: Record<string, Options['sources']> = {}; for (const s of opts?.sources ?? []) (g[s.group] ??= []).push(s); return g; }, [opts]);
  return (
    <div className="axp-pe__builder">
      <Container title="What fires it" icon="zap">
        <p className="fx-small fx-muted axp-pe__p">Every plugin, app, tool and service that registered its events. Pick one event.</p>
        <div className="axp-pe__tree">
          {Object.entries(groups).map(([group, sources]) => (
            <div key={group}>
              <p className="fx-small axp-pe__group">{group}</p>
              {sources.map((s) => {
                const open = openGroups[s.id] ?? rule.trigger.source === s.id;
                const evs = (opts?.events ?? []).filter((e) => e.source === s.id);
                return (
                  <div key={s.id}>
                    <Button tone="quiet" size="sm" className="axp-pe__leaf" icon={open ? 'chevron-down' : 'chevron-right'} onClick={() => setOpenGroups((g) => ({ ...g, [s.id]: !open }))}>{s.title} <span className="fx-small axp-pe__count">· {s.events}</span></Button>
                    {open && evs.map((e) => <Button key={e.id} tone={rule.trigger.event === e.id ? 'primary' : 'quiet'} size="sm" className="axp-pe__leaf axp-pe__leaf--sub" onClick={() => set({ trigger: { source: s.id, event: e.id, filter: {} }, when: null })}>{e.title}</Button>)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Container>
      <div className="fx-stack">
        <Container title={isNew ? 'New rule' : `Rule: ${rule.title || rule.id}`} icon="edit" actions={<Switch label="JSON" hideLabel text="JSON" checked={showJson} onChange={(on) => { setShowJson(on); if (on) setJson(JSON.stringify(rule, null, 2)); }} />}>
          {showJson ? (
            <div className="fx-stack">
              <TextField label="Rule (prompt-event@1)" value={json} onChange={setJson} rows={18} mono />
              <Button tone="neutral" size="sm" icon="check" onClick={() => { try { setRule({ ...emptyRule(), ...(JSON.parse(json) as Rule) }); setShowJson(false); setError(''); } catch (e) { setError(`Not valid JSON: ${(e as Error).message}`); } }}>Apply JSON</Button>
            </div>
          ) : (
            <div className="fx-stack">
              <TextField label="Title" value={rule.title} onChange={(v) => set({ title: v })} placeholder="e.g. Build failed: retry or archive" required />
              <TextField label="Description" value={rule.description} onChange={(v) => set({ description: v })} rows={2} />
              <p className="axp-pe__p">Fires on <strong>{evOpts ? (opts?.events.find((e) => e.id === rule.trigger.event)?.title ?? rule.trigger.event) : 'pick an event on the left'}</strong>{rule.trigger.event && <> <span className="fx-mono fx-small">{rule.trigger.event}</span></>}.</p>
              {rule.trigger.event && (
                <>
                  <p className="fx-small fx-muted axp-pe__p">Only when these fields have these values (quick filter):</p>
                  {filter.map(([k, v], i) => (
                    <div key={i} className="axp-pe__kv">
                      <SelectField label="Field" value={k} empty="…" onChange={(nk) => setFilter(filter.map((e, j) => (j === i ? [nk, e[1]] : e)))} options={fields.map((f) => ({ value: f.name, label: f.title }))} />
                      {fieldOf(k)?.enum ? <SelectField label="Value" value={String(v ?? '')} empty="…" onChange={(nv) => setFilter(filter.map((e, j) => (j === i ? [e[0], nv] : e)))} options={fieldOf(k)!.enum!.map((x) => ({ value: x, label: x }))} />
                        : <TextField label="Value" value={String(v ?? '')} onChange={(nv) => setFilter(filter.map((e, j) => (j === i ? [e[0], nv] : e)))} />}
                      <Button tone="ghost" size="sm" icon="x" onClick={() => setFilter(filter.filter((_, j) => j !== i))}>Remove</Button>
                    </div>
                  ))}
                  <div><Button tone="neutral" size="sm" icon="plus" onClick={() => setFilter([...filter, ['', '']])}>Add filter</Button></div>
                  <p className="fx-small fx-muted axp-pe__p">Conditions (all must hold; thresholds with greater / less than):</p>
                  {conds.map((c, i) => {
                    const f = fieldOf(c.field);
                    const ops = f ? opsFor(f.type) : evOpts?.ops ?? [];
                    return (
                      <div key={i} className="axp-pe__cond">
                        <SelectField label="Field" value={c.field} empty="…" onChange={(v) => setConds(conds.map((x, j) => (j === i ? { ...x, field: v } : x)))} options={fields.map((x) => ({ value: x.name, label: x.title }))} />
                        <SelectField label="Is" value={c.op} onChange={(v) => setConds(conds.map((x, j) => (j === i ? { ...x, op: v } : x)))} options={ops.map((o) => ({ value: o, label: OP_LABEL[o] ?? o }))} />
                        {['exists', 'missing', 'truthy', 'falsy'].includes(c.op) ? <span /> : f?.enum ? <SelectField label="Value" value={String(c.value ?? '')} empty="…" onChange={(v) => setConds(conds.map((x, j) => (j === i ? { ...x, value: v } : x)))} options={f.enum.map((x) => ({ value: x, label: x }))} />
                          : <TextField label="Value" value={String(c.value ?? '')} onChange={(v) => setConds(conds.map((x, j) => (j === i ? { ...x, value: v } : x)))} type={f?.type === 'number' ? 'number' : 'text'} />}
                        <Button tone="ghost" size="sm" icon="x" onClick={() => setConds(conds.filter((_, j) => j !== i))}>Remove</Button>
                      </div>
                    );
                  })}
                  <div><Button tone="neutral" size="sm" icon="plus" onClick={() => setConds([...conds, { field: fields[0]?.name ?? '', op: 'eq', value: '' }])}>Add condition</Button></div>
                </>
              )}
              <Container title="Limits" icon="clock" collapsible defaultOpen={false}>
                <div className="axp-pe__inputs">
                  <TextField label="Cooldown (s)" value={String(rule.limits.cooldownSec)} type="number" onChange={(v) => set({ limits: { ...rule.limits, cooldownSec: Number(v) || 0 } })} hint="Nothing fires again before this many seconds" />
                  <TextField label="Dedupe key" value={rule.limits.dedupeKey} onChange={(v) => set({ limits: { ...rule.limits, dedupeKey: v } })} placeholder="{{build.id}}" hint="Same key = asked once per window" />
                  <TextField label="Dedupe window (s)" value={String(rule.limits.dedupeSec)} type="number" onChange={(v) => set({ limits: { ...rule.limits, dedupeSec: Number(v) || 0 } })} hint="0 = a day" />
                  <TextField label="Max per hour" value={String(rule.limits.maxPerHour)} type="number" onChange={(v) => set({ limits: { ...rule.limits, maxPerHour: Number(v) || 0 } })} hint="0 = no cap" />
                </div>
              </Container>
              <Container title="What to ask Brett" icon="bell">
                <div className="fx-stack">
                  <SelectField label="Kind" value={rule.ask.kind} onChange={(v) => set({ ask: { ...rule.ask, kind: v, options: v === 'pick' && !rule.ask.options.length ? [{ id: 'option-1', label: 'Option 1' }, { id: 'option-2', label: 'Option 2' }] : rule.ask.options }, on: {} })} options={(opts?.askKinds ?? ['none', 'approve', 'veto', 'pick', 'text']).map((k) => ({ value: k, label: ASK_LABEL[k] ?? k }))} />
                  {rule.ask.kind !== 'none' && (
                    <>
                      <TextField label="Title" value={rule.ask.title} onChange={(v) => set({ ask: { ...rule.ask, title: v } })} placeholder="Build failed: {{build.title}}" hint="{{field}} reads the event" required />
                      <TextField label="Text" value={rule.ask.text} onChange={(v) => set({ ask: { ...rule.ask, text: v } })} rows={2} />
                      {rule.ask.kind === 'pick' && (
                        <div className="fx-stack">
                          {rule.ask.options.map((o, i) => (
                            <div key={i} className="axp-pe__kv">
                              <TextField label="Option id" value={o.id} mono onChange={(v) => set({ ask: { ...rule.ask, options: rule.ask.options.map((x, j) => (j === i ? { ...x, id: v } : x)) } })} />
                              <TextField label="Label" value={o.label} onChange={(v) => set({ ask: { ...rule.ask, options: rule.ask.options.map((x, j) => (j === i ? { ...x, label: v } : x)) } })} />
                              <Button tone="ghost" size="sm" icon="x" onClick={() => set({ ask: { ...rule.ask, options: rule.ask.options.filter((_, j) => j !== i) } })}>Remove</Button>
                            </div>
                          ))}
                          <div><Button tone="neutral" size="sm" icon="plus" onClick={() => set({ ask: { ...rule.ask, options: [...rule.ask.options, { id: `option-${rule.ask.options.length + 1}`, label: `Option ${rule.ask.options.length + 1}` }] } })}>Add option</Button></div>
                        </div>
                      )}
                      {(rule.ask.kind === 'veto' || rule.ask.kind === 'pick') && <TextField label="Countdown (s)" type="number" value={String(rule.ask.countdownSec)} onChange={(v) => set({ ask: { ...rule.ask, countdownSec: Number(v) || 0 } })} hint={rule.ask.kind === 'veto' ? 'Silence lets it run' : '0 = no deadline'} />}
                      <div className="axp-pe__options">
                        {(opts?.outputs ?? []).map((o) => <Checkbox key={o.id} label={`${label(o.id)}${o.available ? '' : ' (keys needed)'}`} checked={rule.ask.outputs.includes(o.id)} onChange={(on) => set({ ask: { ...rule.ask, outputs: on ? [...rule.ask.outputs, o.id] : rule.ask.outputs.filter((x) => x !== o.id) } })} />)}
                      </div>
                    </>
                  )}
                </div>
              </Container>
            </div>
          )}
        </Container>
        {error && <Note tone="danger">{error}</Note>}
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="check" disabled={!rule.title.trim() || !rule.trigger.event} onClick={() => void save()}>{isNew ? 'Add rule' : 'Save'}</Button>
          <Button tone="neutral" icon="play" disabled={isNew} onClick={() => void dryRun()}>Test (dry run)</Button>
          <Button tone="ghost" onClick={onCancel}>Cancel</Button>
        </div>
        {test && <Note tone={test.fire ? 'success' : 'warning'}>{test.fire ? <>Fires. {test.instance ? <>Would ask: <strong>{String((test.instance as Instance).title)}</strong> ({String((test.instance as Instance).kind)}).</> : <>Would run {String((test.run as { planned?: number })?.planned ?? 0)} step(s).</>}</> : <>Does not fire on the sample event: {String(test.reason)}.</>} Details in History.</Note>}
      </div>
      <Container title="What runs on each answer" icon="play">
        {!opts ? <LoadingSkeleton /> : (
          <div className="fx-stack">
            {rule.ask.kind === 'pick' && rule.ask.options.map((o) => (
              <div key={o.id} className="axp-pe__branch">
                <p className="axp-pe__p"><strong>Picked “{o.label}”</strong></p>
                <ActionList list={onPick(o.id)} actions={opts.actions} onChange={(l) => set({ on: { ...rule.on, pick: { ...((rule.on.pick as Record<string, Action[]>) ?? {}), [o.id]: l } } })} />
              </div>
            ))}
            {branches.map((b) => (
              <div key={b} className="axp-pe__branch">
                <p className="axp-pe__p"><strong>{BRANCH_LABEL[b] ?? b}</strong></p>
                <ActionList list={onBranch(b)} actions={opts.actions} onChange={(l) => set({ on: { ...rule.on, [b]: l } })} />
              </div>
            ))}
          </div>
        )}
      </Container>
    </div>
  );
}
const OP_LABEL: Record<string, string> = { eq: 'equal to', ne: 'not', in: 'one of', nin: 'none of', contains: 'contains', startsWith: 'starts with', endsWith: 'ends with', matches: 'matches (regex)', gt: 'greater than', gte: 'at least', lt: 'less than', lte: 'at most', exists: 'present', missing: 'missing', truthy: 'true', falsy: 'false' };
const ASK_LABEL: Record<string, string> = { none: 'Nothing: run right away', approve: 'Approve / deny', veto: 'Veto countdown (runs unless stopped)', pick: 'Pick from options', text: 'Text answer' };
const BRANCH_LABEL: Record<string, string> = { fire: 'On fire', approve: 'Approved', deny: 'Denied', timeout: 'Timed out', later: 'Later (shelved)', text: 'Text given' };
function opsFor(t: string): string[] {
  if (t === 'number' || t === 'duration') return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'exists', 'missing'];
  if (t === 'boolean') return ['truthy', 'falsy'];
  if (t === 'enum') return ['eq', 'ne', 'in', 'nin'];
  if (t === 'list' || t === 'object') return ['contains', 'exists', 'missing'];
  return ['eq', 'ne', 'in', 'nin', 'contains', 'startsWith', 'endsWith', 'matches', 'exists', 'missing'];
}

/* ---------------- macro / pipeline editors ---------------- */
function MacroEditor({ initial, actions, onDone }: { initial: Macro | null; actions: Options['actions']; onDone: () => void }) {
  const rt = useRuntime();
  const [m, setM] = useState<Macro>(initial ?? { id: '', title: '', description: '', params: [], steps: [] });
  const [params, setParams] = useState(initial?.params.map((p) => p.name).join(', ') ?? '');
  const [error, setError] = useState('');
  const save = async () => {
    const body = { ...m, id: m.id || undefined, params: params.split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({ name })) };
    const r = initial ? await api(`macros/${encodeURIComponent(initial.id)}/update`, body) : await api('macros', body);
    if (!r.ok) { setError(r.error ?? 'Could not save.'); return; }
    rt.toast('Macro saved.', 'success', 'Prompt engine'); onDone();
  };
  return (
    <Container title={initial ? `Macro: ${initial.title}` : 'New macro'} icon="list">
      <div className="fx-stack">
        <TextField label="Title" value={m.title} onChange={(v) => setM({ ...m, title: v })} required />
        <TextField label="Parameters" value={params} onChange={setParams} placeholder="build, reason" hint="Comma separated; steps read them as {{params.name}}" />
        <ActionList list={m.steps} actions={actions} onChange={(steps) => setM({ ...m, steps })} />
        {error && <Note tone="danger">{error}</Note>}
        <div className="fx-row fx-row--wrap"><Button tone="primary" icon="check" disabled={!m.title.trim() || !m.steps.length} onClick={() => void save()}>Save macro</Button><Button tone="ghost" onClick={onDone}>Cancel</Button></div>
      </div>
    </Container>
  );
}
function PipelineEditor({ initial, actions, onDone }: { initial: Pipeline | null; actions: Options['actions']; onDone: () => void }) {
  const rt = useRuntime();
  const [p, setP] = useState<Pipeline>(initial ?? { id: '', title: '', description: '', stages: [{ id: 'stage-1', title: 'Stage 1', actions: [] }] });
  const [error, setError] = useState('');
  const setStage = (i: number, s: Partial<Stage>) => setP({ ...p, stages: p.stages.map((x, j) => (j === i ? { ...x, ...s } : x)) });
  const save = async () => {
    const r = initial ? await api(`pipelines/${encodeURIComponent(initial.id)}/update`, { ...p }) : await api('pipelines', { ...p, id: undefined });
    if (!r.ok) { setError(r.error ?? 'Could not save.'); return; }
    rt.toast('Pipeline saved.', 'success', 'Prompt engine'); onDone();
  };
  return (
    <Container title={initial ? `Pipeline: ${initial.title}` : 'New pipeline'} icon="layers">
      <div className="fx-stack">
        <TextField label="Title" value={p.title} onChange={(v) => setP({ ...p, title: v })} required />
        {p.stages.map((s, i) => (
          <Container key={i} title={`Stage ${i + 1}: ${s.title}`} icon="chevron-right" collapsible actions={<Button tone="ghost" size="sm" icon="x" onClick={() => setP({ ...p, stages: p.stages.filter((_, j) => j !== i) })}>Remove</Button>}>
            <div className="fx-stack">
              <TextField label="Stage title" value={s.title} onChange={(v) => setStage(i, { title: v })} />
              <Switch label="Ask Brett before this stage runs (a gate)" checked={Boolean(s.gate)} onChange={(on) => setStage(i, { gate: on ? { ...emptyAsk(), title: `Go on with ${s.title}?` } : undefined })} />
              {s.gate && (
                <div className="axp-pe__inputs">
                  <SelectField label="Gate kind" value={s.gate.kind} onChange={(v) => setStage(i, { gate: { ...s.gate!, kind: v } })} options={['approve', 'veto', 'text'].map((k) => ({ value: k, label: ASK_LABEL[k] ?? k }))} />
                  <TextField label="Gate title" value={s.gate.title} onChange={(v) => setStage(i, { gate: { ...s.gate!, title: v } })} />
                </div>
              )}
              <ActionList list={s.actions} actions={actions} onChange={(l) => setStage(i, { actions: l })} />
            </div>
          </Container>
        ))}
        <div><Button tone="neutral" size="sm" icon="plus" onClick={() => setP({ ...p, stages: [...p.stages, { id: `stage-${p.stages.length + 1}`, title: `Stage ${p.stages.length + 1}`, actions: [] }] })}>Add stage</Button></div>
        {error && <Note tone="danger">{error}</Note>}
        <div className="fx-row fx-row--wrap"><Button tone="primary" icon="check" disabled={!p.title.trim() || !p.stages.length} onClick={() => void save()}>Save pipeline</Button><Button tone="ghost" onClick={onDone}>Cancel</Button></div>
      </div>
    </Container>
  );
}

/* ---------------- waiting ---------------- */
function WaitingRow({ i, onDone }: { i: Instance; onDone: () => void }) {
  const rt = useRuntime();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const answer = async (kind: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await api<{ run?: { ran: unknown[]; failed: { error: string }[] } }>('answer', { instance: i.id, answer: kind, ...extra });
    setBusy(false);
    if (!r.ok) { rt.toast(r.error ?? 'Could not answer.', 'danger', 'Prompt engine'); return; }
    const f = r.run?.failed?.length ? ` ${r.run.failed.length} action(s) failed: ${r.run.failed[0]?.error ?? ''}` : '';
    rt.toast(`${kind === 'later' ? 'Shelved.' : `Answered ${kind}.`}${r.run ? ` Ran ${r.run.ran?.length ?? 0} action(s).` : ''}${f}`, f ? 'warning' : 'success', i.title);
    onDone();
  };
  const left = i.expiresAt ? Math.max(0, Math.round((new Date(i.expiresAt).getTime() - Date.now()) / 1000)) : 0;
  return (
    <li className={`axp-pe__row ${i.kind === 'veto' ? 'is-urgent' : ''}`}>
      <div className="axp-pe__head">
        <span className="axp-pe__title">{i.n ? `${i.n}. ` : ''}{i.title}</span>
        <Chip tone={i.kind === 'veto' ? 'warning' : 'accent'}>{i.kind}</Chip>
        {i.status === 'shelved' && <Chip>shelved</Chip>}
        {i.expiresAt && <Chip tone={left < 30 ? 'danger' : undefined}>{left}s left</Chip>}
        {i.keysNeeded?.length ? <Chip tone="warning">keys needed: {i.keysNeeded.join(', ')}</Chip> : null}
      </div>
      {i.text && <p className="axp-pe__p">{i.text}</p>}
      <p className="fx-small fx-muted axp-pe__p">Rule {i.ruleTitle} · asked {new Date(i.askedAt).toLocaleString()} · <span className="fx-mono">{i.id}</span></p>
      <div className="axp-pe__actions">
        {i.kind === 'pick' && i.options.map((o, n) => <Button key={o.id} tone="primary" size="sm" disabled={busy} onClick={() => void answer('pick', { option: o.id })}>{n + 1}. {o.label}</Button>)}
        {i.answers.includes('approve') && <Button tone="primary" size="sm" icon="check" disabled={busy} onClick={() => void answer('approve')}>Approve</Button>}
        {i.answers.includes('text') && <><TextField label="Answer" value={text} onChange={setText} /><Button tone="primary" size="sm" disabled={busy || !text.trim()} onClick={() => void answer('text', { text })}>Send</Button></>}
        {i.answers.includes('deny') && <Button tone="danger" size="sm" icon="x" disabled={busy} onClick={() => void answer('deny')}>Deny</Button>}
        {i.answers.includes('later') && i.status !== 'shelved' && <Button tone="ghost" size="sm" icon="clock" disabled={busy} onClick={() => void answer('later')}>Later</Button>}
      </div>
    </li>
  );
}

/* ---------------- the page ---------------- */
function PromptEngineView() {
  const rt = useRuntime();
  const [tab, setTab] = useState<Tab>(() => openTab ?? ((rt.settings.get(TAB_KEY) as Tab) || 'events'));
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Rule | null>(null);
  const [macro, setMacro] = useState<Macro | null | 'new'>(null);
  const [pipe, setPipe] = useState<Pipeline | null | 'new'>(null);
  const [opts, setOpts] = useState<Options | null>(null);
  const [hist, setHist] = useState<Audit[] | null>(null);
  const [histKind, setHistKind] = useState('');
  const [reg, setReg] = useState<{ sources: { source: string; title: string; group: string; events: { id: string; title: string; fields: Field[] }[]; actions: { id: string; title: string; effect: string; needs: string[] }[] }[]; connectors: Record<string, { available: boolean }> } | null>(null);
  const [tpl, setTpl] = useState('');
  const load = useCallback(async () => {
    const r = await api<State>('');
    if (!r.ok) { setError(r.error ?? 'The prompt engine is not reachable.'); return; }
    setError(''); setSt(r); rt.setBadge(COUNTER, r.counts.waiting);
  }, [rt]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => { void api<Options>('options', {}).then((o) => o.ok && setOpts(o)); }, []);
  useEffect(() => { if (tab === 'history') void api<{ items: Audit[] }>(`history?limit=200${histKind ? `&kind=${histKind}` : ''}`).then((r) => setHist(r.ok ? r.items : [])); if (tab === 'registry') void api<typeof reg & { ok: boolean }>('manifest').then((r) => r.ok && setReg(r)); }, [tab, histKind]);
  useEffect(() => { if (editRuleId !== null && st) { const r = editRuleId === '' ? emptyRule() : st.rules.find((x) => x.id === editRuleId) ?? null; if (r) { setEditing(r); setTab('builder'); } editRuleId = null; } }, [st]);
  const pick = (t: Tab) => { setTab(t); rt.settings.set(TAB_KEY, t); openTab = null; };
  const act = async (path: string, body: unknown, done: string) => { const r = await api(path, body); if (!r.ok) rt.toast(r.error ?? 'Failed.', 'danger', 'Prompt engine'); else rt.toast(done, 'success', 'Prompt engine'); await load(); return r.ok; };
  if (!st && !error) return <div className="axp-pe"><LoadingSkeleton /></div>;
  const counts = st?.counts;
  return (
    <div className="axp-pe">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin · prompt-engine@1</p><h1>Prompt engine</h1><p className="fx-muted">Rules that watch every event, ask Brett what to do, and run tools, macros and pipelines on the answer.</p></div></header>
      {error && <Note tone="warning">{error}</Note>}
      <div className="axp-pe__tools" role="toolbar" aria-label="Prompt engine tools" data-axf-toolbar="prompt-engine">
        <Button tone="primary" icon="plus" onClick={() => { setEditing(emptyRule()); pick('builder'); }}>New rule</Button>
        <SelectField label="From template" value={tpl} empty="From a template…" onChange={setTpl} options={(st?.templates ?? []).map((t) => ({ value: t.id, label: `${t.group} · ${t.title}` }))} />
        <Button tone="neutral" icon="check" disabled={!tpl} onClick={() => void act(`templates/${encodeURIComponent(tpl)}/use`, {}, 'Rule added from the template.').then(() => setTpl(''))}>Add</Button>
        <span className="axp-pe__grow" />
        <Button tone="ghost" icon="clock" onClick={() => void act('tick', {}, 'Tick ran: expiries and schedules checked.')}>Run tick</Button>
        <Button tone="ghost" icon="refresh" onClick={() => void load()}>Refresh</Button>
      </div>
      <TabGroup id="prompt-engine.tabs" label="Prompt engine sections" value={tab} onChange={pick} tabs={TABS.map((t) => ({ ...t, badge: t.value === 'waiting' ? counts?.waiting : t.value === 'events' ? counts?.rules : undefined }))} />
      {tab === 'events' && (
        <ul className="axp-pe__list">
          {!st?.rules.length && <Note tone="info">No rules yet. Add one from a template above, or build your own.</Note>}
          {st?.rules.map((r) => (
            <li key={r.id} className={`axp-pe__row ${r.enabled ? '' : 'is-off'}`}>
              <div className="axp-pe__head">
                <span className="axp-pe__title">{r.title}</span>
                <Chip tone="accent">{r.trigger.event}</Chip>
                <Chip>{r.ask.kind === 'none' ? 'runs' : `asks: ${r.ask.kind}`}</Chip>
                {r.template && <Chip>template</Chip>}
                {!r.enabled && <Chip tone="warning">off</Chip>}
              </div>
              <p className="fx-small fx-muted axp-pe__sum">{r.summary}</p>
              <div className="axp-pe__actions">
                <Switch label="On" hideLabel text={r.enabled ? 'On' : 'Off'} checked={r.enabled} onChange={(on) => void act(`rules/${encodeURIComponent(r.id)}/${on ? 'enable' : 'disable'}`, {}, on ? `${r.title} is on.` : `${r.title} is off.`)} />
                <Button tone="neutral" size="sm" icon="edit" onClick={() => { setEditing(r); pick('builder'); }}>Edit</Button>
                <Button tone="neutral" size="sm" icon="play" onClick={() => void api<{ fire: boolean; reason: string; instance?: Instance }>(`rules/${encodeURIComponent(r.id)}/test`, {}).then((t) => rt.toast(!t.ok ? t.error ?? 'Test failed.' : t.fire ? `Fires.${t.instance ? ` Would ask: ${t.instance.title}` : ' Would run its actions.'} Details in History.` : `Does not fire on the sample event (${t.reason}).`, t.ok ? 'info' : 'danger', 'Dry run'))}>Test</Button>
                <Button tone="danger" size="sm" icon="trash" confirm={`Delete the rule “${r.title}”?`} onClick={() => void act(`rules/${encodeURIComponent(r.id)}/delete`, { confirm: r.id }, 'Rule deleted.')}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {tab === 'builder' && (editing ? <Builder key={editing.id || 'new'} initial={editing} onSaved={() => { setEditing(null); void load(); pick('events'); }} onCancel={() => { setEditing(null); pick('events'); }} /> : <Note tone="info">Pick a rule under Events and tap Edit, or tap New rule.</Note>)}
      {tab === 'macros' && (
        <div className="fx-stack">
          {macro ? <MacroEditor initial={macro === 'new' ? null : macro} actions={opts?.actions ?? []} onDone={() => { setMacro(null); void load(); }} /> : <div><Button tone="primary" icon="plus" onClick={() => setMacro('new')}>New macro</Button></div>}
          <ul className="axp-pe__list">
            {st?.macros.map((m) => (
              <li key={m.id} className="axp-pe__row">
                <div className="axp-pe__head"><span className="axp-pe__title">{m.title}</span><Chip>{m.steps.length} step(s)</Chip>{m.params.length > 0 && <Chip>params: {m.params.map((p) => p.name).join(', ')}</Chip>}<span className="fx-mono fx-small axp-pe__count">{m.id}</span></div>
                <div className="axp-pe__actions">
                  <Button tone="neutral" size="sm" icon="edit" onClick={() => setMacro(m)}>Edit</Button>
                  <Button tone="danger" size="sm" icon="trash" confirm={`Delete the macro “${m.title}”?`} onClick={() => void act(`macros/${encodeURIComponent(m.id)}/delete`, { confirm: m.id }, 'Macro deleted.')}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === 'pipelines' && (
        <div className="fx-stack">
          {pipe ? <PipelineEditor initial={pipe === 'new' ? null : pipe} actions={opts?.actions ?? []} onDone={() => { setPipe(null); void load(); }} /> : <div><Button tone="primary" icon="plus" onClick={() => setPipe('new')}>New pipeline</Button></div>}
          <ul className="axp-pe__list">
            {st?.pipelines.map((p) => (
              <li key={p.id} className="axp-pe__row">
                <div className="axp-pe__head"><span className="axp-pe__title">{p.title}</span><Chip>{p.stages.length} stage(s)</Chip>{p.stages.some((s) => s.gate) && <Chip tone="warning">{p.stages.filter((s) => s.gate).length} gate(s)</Chip>}<span className="fx-mono fx-small axp-pe__count">{p.id}</span></div>
                <p className="fx-small fx-muted axp-pe__sum">{p.stages.map((s) => `${s.gate ? '⏸ ' : ''}${s.title} (${s.actions.length})`).join(' → ')}</p>
                <div className="axp-pe__actions">
                  <Button tone="neutral" size="sm" icon="edit" onClick={() => setPipe(p)}>Edit</Button>
                  <Button tone="neutral" size="sm" icon="play" onClick={() => void api('fire', { source: 'custom', event: 'custom.event', payload: { name: `run ${p.id}` }, dry: true }).then(() => rt.toast(`To run it from a rule, add the action “Run a pipeline” → ${p.title}.`, 'info', 'Pipelines'))}>How to run</Button>
                  <Button tone="danger" size="sm" icon="trash" confirm={`Delete the pipeline “${p.title}”?`} onClick={() => void act(`pipelines/${encodeURIComponent(p.id)}/delete`, { confirm: p.id }, 'Pipeline deleted.')}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === 'waiting' && (
        <ul className="axp-pe__list">
          {!st?.waiting.length && <Note tone="success">Nothing is waiting for you.</Note>}
          {st?.waiting.map((i) => <WaitingRow key={i.id} i={i} onDone={() => void load()} />)}
        </ul>
      )}
      {tab === 'history' && (
        <div className="fx-stack">
          <SelectField label="Show" value={histKind} empty="Everything" onChange={setHistKind} options={['fired', 'skipped', 'asked', 'answered', 'expired', 'planned', 'ran', 'failed', 'dry-run', 'keys-needed', 'rule', 'macro', 'pipeline'].map((k) => ({ value: k, label: label(k) }))} />
          {hist === null ? <LoadingSkeleton /> : !hist.length ? <Note tone="info">No history yet.</Note> : (
            <table className="axp-pe__hist fx-small">
              <thead><tr><th>When</th><th>What</th><th>Rule</th><th>Detail</th></tr></thead>
              <tbody>{hist.map((h, n) => <tr key={n}><td>{new Date(h.at).toLocaleString()}</td><td><Chip tone={h.kind === 'failed' || h.kind === 'keys-needed' ? 'danger' : h.kind === 'ran' || h.kind === 'answered' ? 'success' : h.kind === 'skipped' ? 'warning' : undefined}>{h.kind}</Chip></td><td className="fx-mono">{h.rule ?? ''}{h.instance ? <><br />{h.instance}</> : null}</td><td className="axp-pe__detail">{[h.reason, h.by ? `by ${h.by}` : '', h.detail ? JSON.stringify(h.detail) : ''].filter(Boolean).join(' · ')}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
      {tab === 'registry' && (
        <div className="fx-stack">
          <Note tone="info">Every plugin, app, tool and service registers its events, actions and connectors with a prompt-manifest@1 (plugin.json <span className="fx-mono">promptManifest</span>, or POST /manifest). The builder only offers what is here. Connectors available: {reg ? Object.values(reg.connectors).filter((c) => c.available).length : '…'}; email, SMS and phone calls show as keys needed until axHub has their connector.</Note>
          {!reg ? <LoadingSkeleton /> : reg.sources.map((s) => (
            <Container key={s.source} title={`${s.title} · ${s.group}`} icon="box" collapsible defaultOpen={false}>
              <p className="fx-small fx-muted axp-pe__p">Events</p>
              <ul className="axp-pe__list">{s.events.map((e) => <li key={e.id} className="axp-pe__row"><div className="axp-pe__head"><span className="axp-pe__title">{e.title}</span><span className="fx-mono fx-small axp-pe__count">{e.id}</span></div><p className="fx-small fx-muted axp-pe__p">{e.fields.map((f) => f.name).join(', ') || 'no fields'}</p></li>)}</ul>
              {s.actions.length > 0 && <><p className="fx-small fx-muted axp-pe__p">Actions</p><ul className="axp-pe__list">{s.actions.map((a) => <li key={a.id} className="axp-pe__row"><div className="axp-pe__head"><span className="axp-pe__title">{a.title}</span><Chip tone={EFFECT_TONE[a.effect]}>{a.effect}</Chip>{a.needs.length > 0 && <Chip tone="warning">{a.needs.join(', ')}</Chip>}<span className="fx-mono fx-small axp-pe__count">{a.id}</span></div></li>)}</ul></>}
            </Container>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel() {
  const rt = useRuntime();
  const [st, setSt] = useState<State | null>(null);
  useEffect(() => { void api<State>('').then((r) => r.ok && setSt(r)); }, []);
  return (
    <div className="fx-stack">
      <p className="axp-pe__p">{st ? `${st.counts.enabled} of ${st.counts.rules} rules on · ${st.counts.macros} macros · ${st.counts.pipelines} pipelines · ${st.counts.waiting} waiting` : '…'}</p>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="zap" onClick={() => rt.navigate(VIEW)}>Open the control panel</Button>
        <Button tone="neutral" icon="bell" onClick={() => rt.dispatch('prompt-engine.waiting')}>Prompts waiting</Button>
      </div>
      <p className="fx-small fx-muted axp-pe__p">
        Every control here is also a command: REST <span className="fx-mono">/api/plugins/prompt-engine/…</span> and <span className="fx-mono">/api/control/prompt-engine/&lt;command&gt;</span>, MCP <span className="fx-mono">prompt-engine_&lt;command&gt;</span>, CLI <span className="fx-mono">axf prompt-engine &lt;command&gt;</span> or <span className="fx-mono">node apps/console-web/plugins/prompt-engine/engine.mjs …</span>, voice through AmberX ("what is waiting for me", "approve it", "pick option 2"). Deep link: <span className="fx-mono">console_show view:prompt-engine</span>.
      </p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Prompt engine',
  version: '0.1.0',
  appMenu,
  builtWith: { model: 'fable', builtAt: '2026-11-13' },
  register(rt) {
    runtime = rt;
    rt.actions.register('prompt-engine.open', () => rt.navigate(VIEW), { label: 'Open the prompt engine' });
    rt.actions.register('prompt-engine.waiting', () => { openTab = 'waiting'; rt.navigate(VIEW); }, { label: 'Prompts waiting for Brett' });
    rt.actions.register('prompt-engine.new', () => { editRuleId = ''; openTab = 'builder'; rt.navigate(VIEW); }, { label: 'New prompt rule' });
    const p = new URLSearchParams(globalThis.location?.search ?? '').get('prompt');
    if (p) { openTab = 'waiting'; setTimeout(() => rt.navigate(VIEW), 0); }
    void api<State>('').then((r) => { if (r.ok && runtime) runtime.setBadge(COUNTER, r.counts.waiting); });
  },
  views: { [VIEW]: { title: 'Prompt engine', icon: 'zap', render: () => <PromptEngineView /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Prompt engine', icon: 'zap', view: VIEW, badge: COUNTER }] },
  settingsTabs: [{ id: 'prompt-engine', label: 'Prompt engine', icon: 'zap', order: 42, parent: 'plugins' }],
  settingsPanels: [
    { id: 'prompt-engine.main', tab: 'prompt-engine', title: 'Prompt engine', icon: 'zap', order: 5, render: () => <SettingsPanel /> },
    { id: 'prompt-engine.lifecycle', tab: 'prompt-engine', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
