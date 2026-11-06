/**
 * Shared chain control panel (chain-control@1, framework/core/chain-control.mjs). The Claude plugin and MD Studio both mount
 * this one component, so they show and change the same registry. It talks to the console's own /api/chain-control routes,
 * which keep working whichever of the two is off. Generic: it never names a plugin.
 *
 *   import { ChainControlPanel } from '@console/chainControl';
 *
 * One store per page: every mount shares the last state; a change anywhere bumps `rev`, and a check on focus and every
 * CHECK_MS reloads when another session, the CLI or MCP moved it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Container, IconButton, Note, Segmented, SelectField, Switch, TextField } from './axf/react';
import { getToken } from './api';
import './chainControl.css';

const CHECK_MS = 15000;
type Mode = 'always' | 'demand' | 'never';
interface Row { path: string; via: string; depth: number; parent: string; chars: number; tokens: number; mode: Mode; i: number; load: number; missing?: boolean }
interface Rule { type: string; label: string; words: string[]; model: string }
interface Config {
  chain: { defaultMode: Mode; brief: boolean; files: { path: string; mode: Mode }[]; order: string[]; maxChars: number };
  session: { mode: string; handoffChars: number; briefChars: number };
  models: { rules: Rule[] };
  output: { bashChars: number; mcpTokens: number; readTokens: number };
  scope: { mode: string; always: string[]; files?: string[] };
  budget: { warnTokens: number; stopTokens: number };
}
interface Preset { id: string; name: string; description: string; builtin: boolean }
interface Cost { priced: boolean; perStep?: number; perBuild?: number; fullBuild?: number; saved?: number; turns?: number; steps?: number; sessions?: number }
interface Event { rev: number; at: string; by: string; what: string; kind: string }
interface Suggestion { step: string; text: string; pinned: string; model: string; label: string; why: string; differs: boolean }
interface State {
  ok: boolean; message?: string; rev: number; preset: string; updatedAt: string; updatedBy: string; live: boolean; store: string; config: Config; sources: Record<string, string>;
  rows: Row[]; plan: { native: boolean; tokens: { brief: number; always: number; index: number; total: number; full: number }; sent: string[]; listed: string[]; dropped: string[]; over: string[] };
  cost: Cost; session: { mode: string; sessions: number; steps: number }; presets: Preset[]; history: Event[]; override: Partial<Config> | null;
  builds: { id: string; title: string; steps: { id: string; text: string; done: boolean }[] }[]; suggestions: Suggestion[];
  step: { id: string; text: string; files: string[]; suggestion: { label: string; model: string; why: string } } | null;
}
interface Level { build: string; step: string; model: string }

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const t = getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  const r = await fetch(`/api/chain-control/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as T & { ok?: boolean; message?: string; detail?: unknown };
  if (r.status === 401) throw new Error('Console token required (Settings → Account & security).');
  if (!r.ok || j.ok === false) throw new Error(j.message || (typeof j.detail === 'string' ? j.detail : `request failed (${r.status})`));
  return j;
}

/* ---------------- one store per page ---------------- */

let shared: State | null = null;
let sharedKey = '';
const listeners = new Set<(s: State) => void>();
const keyOf = (l: Level) => `${l.build}|${l.step}|${l.model}`;
const query = (l: Level) => new URLSearchParams(Object.entries(l).filter(([, v]) => v)).toString();
async function reload(l: Level): Promise<void> {
  const s = await api<State>(`state?${query(l)}`);
  shared = s; sharedKey = keyOf(l);
  for (const f of listeners) f(s);
}

function useChainControl(level: Level) {
  const [state, setState] = useState<State | null>(sharedKey === keyOf(level) ? shared : null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => reload(level).then(() => setError(''), (e: Error) => setError(e.message)), [level]);
  useEffect(() => {
    listeners.add(setState);
    void refresh();
    const check = () => { if (document.visibilityState !== 'visible') return; api<{ rev: number }>(`events?since=${shared?.rev ?? 0}`).then((e) => { if (e.rev !== shared?.rev) void refresh(); }).catch(() => undefined); };
    const t = setInterval(check, CHECK_MS);
    window.addEventListener('focus', check);
    return () => { listeners.delete(setState); clearInterval(t); window.removeEventListener('focus', check); };
  }, [refresh]);
  /** Every change: run it, then reload. A failure stays on screen. */
  const act = useCallback((p: Promise<unknown>) => { p.then(refresh, (e: Error) => setError(e.message)); }, [refresh]);
  return { state, error, refresh, act };
}

const money = (v?: number) => (v == null ? '–' : v < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const count = (n: number) => n.toLocaleString();
const FROM: Record<string, string> = { build: 'This build', step: 'This step' };

/* ---------------- a number that saves when asked ---------------- */

function NumberRow({ label, value, hint, unit, onSave, source }: { label: string; value: number; hint: string; unit?: string; onSave: (n: number) => void; source?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <div className="cl-chain__num">
      <TextField label={`${label}${unit ? ` (${unit})` : ''}`} type="number" value={draft} hint={source ? `${hint} Set by: ${FROM[source] ?? source}.` : hint} onChange={setDraft} />
      {draft !== String(value) && <Button size="sm" tone="primary" icon="save" onClick={() => onSave(Number(draft))}>Save</Button>}
    </div>
  );
}

/* ---------------- the chain ---------------- */

function FileBody({ row, edit, close, saved }: { row: Row; edit: boolean; close: () => void; saved: () => void }) {
  const [file, setFile] = useState<{ content: string; version: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ content: string; version: string }>(`file?path=${encodeURIComponent(row.path)}`).then((f) => { setFile(f); setDraft(f.content); }, (e: Error) => setError(e.message));
  }, [row.path]);
  const save = () => {
    setError('');
    api('file', 'PUT', { path: row.path, content: draft, if_version: file?.version }).then(saved, (e: Error) => setError(e.message));
  };
  if (error && !file) return <Note tone="danger">{error}</Note>;
  if (!file) return <p className="fx-muted">Loading…</p>;
  return (
    <div className="fx-stack" data-testid="chain-file">
      {edit ? <TextField label={`Edit ${row.path}`} mono rows={14} value={draft} onChange={setDraft} /> : <pre className="cl-chain__pre fx-mono">{file.content}</pre>}
      {error && <Note tone="danger">{error}</Note>}
      <div className="cl-chain__acts">
        {edit && <Button size="sm" tone="primary" icon="save" disabled={draft === file.content} onClick={save}>Save file</Button>}
        <Button size="sm" tone="ghost" icon="x" onClick={close}>Close</Button>
      </div>
    </div>
  );
}

function ChainRows({ s, level, act }: { s: State; level: Level; act: (p: Promise<unknown>) => void }) {
  const [open, setOpen] = useState<{ path: string; edit: boolean } | null>(null);
  const on = { build: level.build || undefined, step: level.step || undefined };
  const move = (i: number, by: number) => {
    const paths = s.rows.map((r) => r.path);
    const [p] = paths.splice(i, 1);
    if (p) paths.splice(i + by, 0, p);
    act(api('order', 'POST', { paths, ...on }));
  };
  return (
    <div className="cl-chain__rows" data-testid="chain-rows">
      {s.rows.map((r, i) => (
        <div key={r.path} className="cl-chain__row" data-path={r.path} data-mode={r.mode}>
          <div className="cl-chain__file">
            <b className="fx-mono">{i + 1}. {r.path}</b>
            <span className="fx-muted">{r.missing ? 'Not found' : `${kb(r.chars)} · ${count(r.tokens)} tokens`}{r.via ? ` · ${r.via}` : ''}{r.parent ? ` from ${r.parent}` : ''}</span>
          </div>
          <div className="cl-chain__ctl">
            <Segmented label={`Load ${r.path}`} size="sm" value={r.mode} onChange={(mode) => act(api('file-mode', 'POST', { path: r.path, mode, ...on }))} options={[{ value: 'always' as Mode, label: 'Always' }, { value: 'demand' as Mode, label: 'On demand' }, { value: 'never' as Mode, label: 'Never' }]} />
            <IconButton icon="chevron-up" label={`Move ${r.path} up`} disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="chevron-down" label={`Move ${r.path} down`} disabled={i === s.rows.length - 1} onClick={() => move(i, 1)} />
            <IconButton icon="eye" label={`Preview ${r.path}`} disabled={r.missing} onClick={() => setOpen({ path: r.path, edit: false })} />
            <IconButton icon="edit" label={`Edit ${r.path}`} disabled={r.missing} onClick={() => setOpen({ path: r.path, edit: true })} />
          </div>
          {open?.path === r.path && <FileBody row={r} edit={open.edit} close={() => setOpen(null)} saved={() => { setOpen(null); act(Promise.resolve()); }} />}
        </div>
      ))}
    </div>
  );
}

function CostPreview({ s, level, setLevel }: { s: State; level: Level; setLevel: (l: Level) => void }) {
  const t = s.plan.tokens;
  return (
    <div className="fx-stack" data-testid="chain-cost">
      <div className="cl-chain__stats">
        <div><b>{count(t.total)}</b><span className="fx-muted">tokens sent at the start of a session</span></div>
        <div><b>{count(t.full)}</b><span className="fx-muted">tokens in the full chain</span></div>
        <div><b>{money(s.cost.perStep)}</b><span className="fx-muted">chain cost per step</span></div>
        <div><b>{money(s.cost.saved)}</b><span className="fx-muted">saved on {level.build ? 'this build' : 'one step'}</span></div>
      </div>
      <p className="fx-muted cl-chain__line">{s.plan.native ? 'Claude Code loads its own chain.' : `Rules brief ${count(t.brief)}, loaded files ${count(t.always)}, on-demand list ${count(t.index)} tokens.`} {s.session.sessions} session{s.session.sessions === 1 ? '' : 's'} for {s.session.steps} step{s.session.steps === 1 ? '' : 's'}, about {s.cost.turns ?? 40} turns a step.</p>
      {s.plan.over.length > 0 && <Note tone="warning">Over the size cap, so only named: {s.plan.over.join(', ')}.</Note>}
      <SelectField label="Price it on" value={level.model} options={[{ value: 'opus', label: 'Opus' }, { value: 'fable', label: 'Fable' }]} onChange={(model) => setLevel({ ...level, model })} />
      {!s.cost.priced && <Note tone="info">No price for this model yet, so tokens only.</Note>}
    </div>
  );
}

function SessionControls({ s, set }: { s: State; set: (patch: unknown) => void }) {
  const c = s.config;
  return (
    <div className="fx-stack" data-testid="chain-session">
      <SelectField label="Sessions" value={c.session.mode} options={[{ value: 'per-step', label: 'A fresh session per step' }, { value: 'per-phase', label: 'A fresh session when the model changes' }, { value: 'per-build', label: 'One session for the whole build' }]} hint={s.sources['session.mode'] ? `Set by: ${FROM[s.sources['session.mode']]}.` : undefined} onChange={(mode) => set({ session: { mode } })} />
      <div className="cl-chain__grid">
        <NumberRow label="Handoff note" unit="characters" value={c.session.handoffChars} source={s.sources['session.handoffChars']} hint="The note a fresh session opens with." onSave={(n) => set({ session: { handoffChars: n } })} />
        <NumberRow label="Build brief kept" unit="characters" value={c.session.briefChars} source={s.sources['session.briefChars']} hint="How much of the build's brief each step session gets." onSave={(n) => set({ session: { briefChars: n } })} />
      </div>
      <Switch label="Send the rules brief" checked={c.chain.brief} hint="The short brief from Rules briefs goes in before the files below." onChange={(brief) => set({ chain: { brief } })} />
    </div>
  );
}

function ModelRules({ s, set }: { s: State; set: (patch: unknown) => void }) {
  const rules = s.config.models.rules;
  const put = (next: Rule[]) => set({ models: { rules: next } });
  const change = (i: number, patch: Partial<Rule>) => put(rules.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="fx-stack" data-testid="chain-models">
      <p className="fx-muted cl-chain__line">The first rule whose words appear in a step suggests its model. The step's pin still decides what it runs on.</p>
      {rules.map((r, i) => (
        <div key={`${r.type}-${i}`} className="cl-chain__rule">
          <TextField label="Step type" value={r.label} onChange={(label) => change(i, { label })} />
          <TextField label="Words" value={r.words.join(', ')} onChange={(v) => change(i, { words: v.split(',').map((w) => w.trim()).filter(Boolean) })} />
          <SelectField label="Model" value={r.model} options={[{ value: 'opus', label: 'Opus' }, { value: 'fable', label: 'Fable' }]} onChange={(model) => change(i, { model })} />
          <IconButton icon="trash" label={`Remove ${r.label}`} onClick={() => put(rules.filter((_, n) => n !== i))} />
        </div>
      ))}
      <div><Button size="sm" tone="ghost" icon="plus" onClick={() => put([...rules, { type: `rule-${rules.length + 1}`, label: 'New rule', words: [], model: 'opus' }])}>Add a rule</Button></div>
      {s.suggestions.length > 0 && (
        <div className="fx-stack">
          <b>What they suggest for this build</b>
          {s.suggestions.slice(0, 12).map((x) => <p key={x.step} className="cl-chain__line"><span className="fx-mono">{x.step}</span> pinned {x.pinned}, suggests {x.model}{x.differs ? ' (differs)' : ''}: <span className="fx-muted">{x.why}</span></p>)}
        </div>
      )}
    </div>
  );
}

function Limits({ s, set }: { s: State; set: (patch: unknown) => void }) {
  const c = s.config;
  const [always, setAlways] = useState(c.scope.always.join(', '));
  useEffect(() => { setAlways(c.scope.always.join(', ')); }, [c.scope.always]);
  const paths = (v: string) => v.split(',').map((p) => p.trim()).filter(Boolean);
  return (
    <div className="fx-stack" data-testid="chain-limits">
      <p className="fx-muted cl-chain__line">Long tool output is cut before it reaches the model. 0 leaves Claude Code's own limit.</p>
      <div className="cl-chain__grid">
        <NumberRow label="Command output" unit="characters" value={c.output.bashChars} source={s.sources['output.bashChars']} hint="Longest output of one shell command." onSave={(n) => set({ output: { bashChars: n } })} />
        <NumberRow label="MCP tool output" unit="tokens" value={c.output.mcpTokens} source={s.sources['output.mcpTokens']} hint="Longest answer of one MCP tool." onSave={(n) => set({ output: { mcpTokens: n } })} />
        <NumberRow label="File read" unit="tokens" value={c.output.readTokens} source={s.sources['output.readTokens']} hint="Largest single file read." onSave={(n) => set({ output: { readTokens: n } })} />
      </div>
      <SelectField label="File scoping" value={c.scope.mode} options={[{ value: 'listed', label: 'List the exact files in each step' }, { value: 'off', label: 'Off: sessions explore freely' }]} onChange={(mode) => set({ scope: { mode } })} />
      <div className="cl-chain__num">
        <TextField label="Files every step gets" value={always} mono hint="Comma separated, added to each step's own list." onChange={setAlways} />
        {always !== c.scope.always.join(', ') && <Button size="sm" tone="primary" icon="save" onClick={() => set({ scope: { always: paths(always) } })}>Save</Button>}
      </div>
      {s.step && s.step.files.length > 0 && <p className="cl-chain__line"><b>Step {s.step.id} reads:</b> <span className="fx-mono">{s.step.files.join(', ')}</span></p>}
      <div className="cl-chain__grid">
        <NumberRow label="Warn at" unit="tokens per step" value={c.budget.warnTokens} source={s.sources['budget.warnTokens']} hint="One line in the log. Fresh tokens: cache reads aren't counted. 0 = off." onSave={(n) => set({ budget: { warnTokens: n } })} />
        <NumberRow label="Stop at" unit="tokens per step" value={c.budget.stopTokens} source={s.sources['budget.stopTokens']} hint="Ends the session; the build stops there with a note. 0 = off." onSave={(n) => set({ budget: { stopTokens: n } })} />
      </div>
    </div>
  );
}

function Presets({ s, act }: { s: State; act: (p: Promise<unknown>) => void }) {
  const current = s.presets.find((p) => p.id === s.preset);
  const [name, setName] = useState('');
  return (
    <div className="fx-stack" data-testid="chain-presets">
      <Segmented label="Preset" value={current ? s.preset : 'custom'} onChange={(id) => { if (id !== 'custom') act(api('preset', 'POST', { action: 'apply', id })); }} options={[...s.presets.map((p) => ({ value: p.id, label: p.name, title: p.description })), ...(current ? [] : [{ value: 'custom', label: 'Custom' }])]} />
      {current?.description && <p className="fx-muted cl-chain__line">{current.description}</p>}
      <div className="cl-chain__num">
        <TextField label="Save these settings as a preset" value={name} placeholder="Preset name" onChange={setName} />
        {name.trim() && <Button size="sm" tone="primary" icon="save" onClick={() => { act(api('preset', 'POST', { action: 'save', name: name.trim() })); setName(''); }}>Save</Button>}
      </div>
      <div className="cl-chain__acts">
        {current && !current.builtin && <Button size="sm" tone="ghost" icon="trash" confirm={`Delete ${current.name}?`} onClick={() => act(api('preset', 'POST', { action: 'delete', id: current.id }))}>Delete preset</Button>}
        <Button size="sm" tone="ghost" icon="refresh" confirm="Back to Lean and drop every override?" onClick={() => act(api('reset', 'POST'))}>Reset to defaults</Button>
      </div>
    </div>
  );
}

function History({ s, act }: { s: State; act: (p: Promise<unknown>) => void }) {
  if (!s.history.length) return <p className="fx-muted">No changes yet.</p>;
  return (
    <div className="cl-chain__rows" data-testid="chain-history">
      {s.history.map((e) => (
        <div key={e.rev} className="cl-chain__hist">
          <span><b>{e.what}</b><span className="fx-muted"> · {e.by} · {new Date(e.at).toLocaleString()}</span></span>
          <Button size="sm" tone="ghost" icon="refresh" confirm={`Go back to how it was after: ${e.what}?`} onClick={() => act(api('restore', 'POST', { rev: e.rev }))}>Restore</Button>
        </div>
      ))}
    </div>
  );
}

export function ChainControlPanel() {
  const [level, setLevel] = useState<Level>({ build: '', step: '', model: 'opus' });
  const { state: s, error, refresh, act } = useChainControl(level);
  const on = { build: level.build || undefined, step: level.step || undefined };
  const set = (patch: unknown) => act(api('set', 'POST', { patch, ...on }));
  const build = s?.builds.find((b) => b.id === level.build);
  if (!s) return error ? <Note tone="danger">Chain control unavailable: {error}</Note> : <p className="fx-muted">Loading…</p>;
  const hasOverride = s.override != null && Object.keys(s.override).length > 0;
  return (
    <div className="fx-stack cl-chain" data-testid="chain-control">
      {error && <Note tone="danger">{error}</Note>}
      {!s.live && <Note tone="warning">Not live on axHub: this console keeps them in {s.store}. Sessions elsewhere won't see changes.</Note>}
      <Container title="Applies to" icon="layers">
        <div className="fx-stack">
          <div className="cl-chain__grid">
            <SelectField label="Build" value={level.build} options={[{ value: '', label: 'Every build (global)' }, ...s.builds.map((b) => ({ value: b.id, label: b.title }))]} onChange={(b) => setLevel({ ...level, build: b, step: '' })} />
            <SelectField label="Step" value={level.step} disabled={!build} options={[{ value: '', label: build ? 'Every step of this build' : 'Pick a build first' }, ...(build?.steps ?? []).map((x) => ({ value: x.id, label: `${x.id}${x.done ? ' (done)' : ''}: ${x.text.slice(0, 60)}` }))]} onChange={(step) => setLevel({ ...level, step })} />
          </div>
          {level.build ? <p className="fx-muted cl-chain__line">Changes here apply only to this {level.step ? 'step' : 'build'}; everything else comes from the global settings.</p> : <p className="fx-muted cl-chain__line">Shared with every Claude session: Claude settings and MD Studio show the same values.</p>}
          {hasOverride && <div><Button size="sm" tone="ghost" icon="x" onClick={() => act(api('clear', 'POST', on))}>Clear this override</Button></div>}
        </div>
      </Container>
      <Container title="Token cost" icon="chart"><CostPreview s={s} level={level} setLevel={setLevel} /></Container>
      {!level.build && <Container title="Presets" icon="package"><Presets s={s} act={act} /></Container>}
      <Container title="CLAUDE.md chain" icon="file"><ChainRows s={s} level={level} act={act} /></Container>
      <Container title="Sessions" icon="terminal"><SessionControls s={s} set={set} /></Container>
      <Container title="Model rules" icon="sparkles" collapsible defaultOpen={false}><ModelRules s={s} set={set} /></Container>
      <Container title="Limits" icon="shield"><Limits s={s} set={set} /></Container>
      <Container title="History" icon="clock" collapsible defaultOpen={false}><History s={s} act={act} /></Container>
      <div><Button size="sm" tone="ghost" icon="refresh" onClick={() => void refresh()}>Reload</Button></div>
    </div>
  );
}
