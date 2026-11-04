import { useEffect, useMemo, useState } from 'react';
import { Button, Container, Markdown, Note, Segmented, SelectField, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { controlClient, controlForms, type ControlAnswer, type ControlCommand } from './client.mjs';
import { GUIDES } from './docs';
import { appMenu } from './menu';
import { PassBanner, PassSettings, PassesTab } from './pass';
import './token-control.css';

/** The folder name under plugins/: the routes live at /api/plugins/token-control/ (and /api/control/). */
const FOLDER = 'token-control';
const PREFIX = `/api/plugins/${FOLDER}`;
/** The shared client over the plugin mount, with the console's own auth (pluginFetch). */
const cc = controlClient({ path: PREFIX, fetch: ((url: string, init?: RequestInit) => pluginFetch(FOLDER, url.slice(PREFIX.length), init)) as typeof fetch });

interface TargetInfo { domain: string; label: string; ops: string[]; paths: unknown; fields?: Record<string, string>; select?: Record<string, string>; acts?: Record<string, Record<string, string>>; doc: string }
interface Registry { ops: string[]; targets: Record<string, TargetInfo>; tools: { name: string; description: string; effect: string }[]; routes: { op: string; method: string; path: string; body?: string; note?: string }[]; cli: { usage: string[]; aliases: Record<string, string> } }
interface TokenRow { id: string; token?: string; kind: string; unit?: string; min?: number; max?: number; options?: string[]; value: unknown; base?: unknown; overridden?: boolean; asset?: string }

const TOKEN_SETS = ['tokens.theme', 'tokens.style', 'tokens.layout', 'tokens.typography', 'tokens.density', 'tokens.sizing', 'tokens.nav', 'tokens.jump', 'tokens.slots'];
const show = (v: unknown) => (v === null || v === undefined ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const parse = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };

function useRegistry() {
  const [reg, setReg] = useState<Registry | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void cc.registry().then((r) => (r && r.targets ? setReg(r as Registry) : setErr(String(r?.message ?? r?.error ?? 'the registry did not load')))); }, []);
  return { reg, err };
}

function Answer({ r }: { r: ControlAnswer | null }) {
  if (!r) return null;
  const tone = r.ok ? 'success' : r.code === 'confirmation_required' ? 'warning' : 'danger';
  return (
    <div className="fx-stack">
      <Note tone={tone}>{r.ok ? `${r.op} ${r.target}${r.path ? ` ${r.path}` : ''}: ok` : `${r.code}: ${r.message}`}</Note>
      <pre className="fx-code axf-tc-pre">{JSON.stringify(r, null, 2)}</pre>
    </div>
  );
}

/* ------------------------------------------------------------------ Tokens tab */

function TokenEditRow({ target, row, onDone }: { target: string; row: TokenRow; onDone: (r: ControlAnswer) => void }) {
  const [draft, setDraft] = useState(show(row.value));
  useEffect(() => setDraft(show(row.value)), [row.value]);
  const options = target === 'tokens.slots' ? row.options : row.kind === 'enum' ? row.options : row.kind === 'boolean' ? ['true', 'false'] : null;
  const set = async () => onDone(await cc.set(target, row.id, target === 'tokens.slots' || row.kind === 'string' || row.kind === 'color' ? draft : parse(draft), { reason: 'Token control page' }));
  const reset = async () => onDone(await cc.reset(target, row.id, { reason: 'Token control page' }));
  return (
    <tr className={row.overridden ? 'axf-tc-over' : undefined}>
      <td><span className="fx-mono">{row.id}</span>{row.token && <div className="fx-muted fx-mono axf-tc-small">{row.token}</div>}</td>
      <td data-help="tc-token-value">
        {options
          ? <SelectField label={row.id} value={draft} options={options.map((o) => ({ value: String(o), label: String(o) }))} onChange={setDraft} className="axf-tc-inline" />
          : <TextField label={row.id} value={draft} onChange={setDraft} mono className="axf-tc-inline" hint={row.unit ? `${row.unit}${row.min !== undefined ? ` · ${row.min}–${row.max}` : ''}` : undefined} />}
      </td>
      <td className="fx-muted">{show(row.base)}{row.asset ? <div className="axf-tc-small">{row.asset}</div> : null}</td>
      <td>
        <div className="fx-row fx-row--tight fx-row--end">
          <Button size="sm" icon="check" onClick={() => void set()} disabled={draft === show(row.value)}>Set</Button>
          {(row.overridden || target === 'tokens.slots') && <Button size="sm" tone="ghost" icon="undo" data-help="tc-token-reset" onClick={() => void reset()}>Reset</Button>}
        </div>
      </td>
    </tr>
  );
}

function TokensTab() {
  const [target, setTarget] = useState('tokens.layout');
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [q, setQ] = useState('');
  const [last, setLast] = useState<ControlAnswer | null>(null);
  const load = () => void cc.list(target).then((r) => setRows(r.ok ? ((r.items ?? []) as TokenRow[]) : []));
  useEffect(load, [target]);
  const shown = rows.filter((r) => !q || r.id.toLowerCase().includes(q.toLowerCase()));
  const overrides = rows.filter((r) => r.overridden).length;
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <SelectField label="Token set" value={target} onChange={setTarget} options={TOKEN_SETS.map((t) => ({ value: t, label: t.replace('tokens.', '') }))} className="axf-tc-pick" />
        <TextField label="Find" value={q} onChange={setQ} placeholder="navWidth, accent, radius…" className="axf-tc-pick" />
        {overrides > 0 && target !== 'tokens.slots' && <Button tone="ghost" icon="undo" onClick={() => void cc.reset(target, undefined, { reason: 'Token control page: reset all' }).then((r) => { setLast(r); load(); })}>Reset all {overrides}</Button>}
      </div>
      <p className="fx-muted">A set is an override in the axHub look: every app follows it live. Reset brings the theme's own value back.</p>
      <div className="axf-tc-scroll">
        <table className="fx-table axf-tc-table" data-help="tc-token-set">
          <thead><tr><th>Token</th><th>Value</th><th>Theme</th><th /></tr></thead>
          <tbody>{shown.map((r) => <TokenEditRow key={r.id} target={target} row={r} onDone={(a) => { setLast(a); load(); }} />)}</tbody>
        </table>
      </div>
      <Answer r={last} />
    </div>
  );
}

/* ------------------------------------------------------------------ Try it tab (generated from the registry) */

function TryTab({ reg, preset }: { reg: Registry; preset: Partial<ControlCommand> | null }) {
  const [target, setTarget] = useState(preset?.target ?? 'amberx.items');
  const t = reg.targets[target];
  const [op, setOp] = useState(preset?.op ?? 'list');
  const [path, setPath] = useState(preset?.path ?? '');
  const [value, setValue] = useState(preset?.value !== undefined ? JSON.stringify(preset.value) : '');
  const [action, setAction] = useState(preset?.action ?? '');
  const [input, setInput] = useState(preset?.input ? JSON.stringify(preset.input) : '{}');
  const [select, setSelect] = useState(preset?.select ? JSON.stringify(preset.select) : '{}');
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [answer, setAnswer] = useState<ControlAnswer | null>(null);
  const [form, setForm] = useState<'rest' | 'mcp' | 'cli'>('cli');
  useEffect(() => { if (preset?.target) { setTarget(preset.target); setOp(preset.op ?? 'list'); setPath(preset.path ?? ''); setValue(preset.value !== undefined ? JSON.stringify(preset.value) : ''); setAction(preset.action ?? ''); setInput(preset.input ? JSON.stringify(preset.input) : '{}'); setSelect(preset.select ? JSON.stringify(preset.select) : '{}'); } }, [preset]);
  useEffect(() => { if (t && !t.ops.includes(op)) setOp(t.ops[0]!); }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmd: ControlCommand = useMemo(() => {
    const c: ControlCommand = { op, target };
    if (['get', 'set', 'remove', 'act', 'reset'].includes(op) && path) c.path = path;
    if ((op === 'set' || op === 'add') && value) c.value = parse(value);
    if (op === 'act') { c.action = action; const i = parse(input); if (i && typeof i === 'object') c.input = i as Record<string, unknown>; }
    if (op === 'list') { const s = parse(select); if (s && typeof s === 'object' && Object.keys(s).length) c.select = s as Record<string, unknown>; }
    if (op === 'remove' && confirm) c.confirm = confirm;
    if (reason) c.reason = reason;
    return c;
  }, [op, target, path, value, action, input, select, confirm, reason]);
  const forms = controlForms(cmd);
  const text = form === 'rest' ? forms.rest : form === 'mcp' ? JSON.stringify(forms.mcp, null, 2) : forms.cli;
  const run = async () => { const r = await cc.send(cmd); setAnswer(r); if (!r.ok && r.code === 'confirmation_required' && r.confirm) setConfirm(String(r.confirm)); };
  const wants = op === 'act' && t?.acts?.[action] ? Object.entries(t.acts[action]).map(([k, d]) => `${k}: ${d}`).join(', ') : '';
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <SelectField label="Target" value={target} onChange={setTarget} options={Object.keys(reg.targets).map((id) => ({ value: id, label: id }))} className="axf-tc-pick" />
        <SelectField label="Op" value={op} onChange={setOp} options={(t?.ops ?? reg.ops).map((o) => ({ value: o, label: o }))} className="axf-tc-pick" />
        {['get', 'set', 'remove', 'act', 'reset'].includes(op) && <TextField label={t?.domain === 'tokens' ? 'Token id' : 'Record id'} value={path} onChange={setPath} mono className="axf-tc-pick" />}
        {op === 'act' && <SelectField label="Action" value={action} onChange={setAction} empty="pick a verb" options={Object.keys(t?.acts ?? {}).map((a) => ({ value: a, label: a }))} className="axf-tc-pick" />}
      </div>
      {(op === 'set' || op === 'add') && <TextField label="Value (JSON or text)" value={value} onChange={setValue} mono rows={3} hint={t?.fields ? `fields: ${Object.keys(t.fields).join(', ')}` : 'a token value'} />}
      {op === 'act' && <TextField label="Input (JSON)" value={input} onChange={setInput} mono rows={2} hint={wants || 'this verb takes no input'} />}
      {op === 'list' && <TextField label="Filters (JSON)" value={select} onChange={setSelect} mono rows={2} hint={t?.select ? `filters: ${Object.keys(t.select).join(', ')}` : 'no filters'} />}
      {op === 'remove' && <TextField label="Confirm token" value={confirm} onChange={setConfirm} mono hint="Filled in after the first Run answers confirmation_required." />}
      <TextField label="Reason (audited)" value={reason} onChange={setReason} />
      <div className="fx-row fx-row--wrap">
        <Button tone={op === 'remove' ? 'danger' : 'primary'} icon="play" data-help="tc-run" onClick={() => void run()}>Run</Button>
        <Segmented label="Show as" value={form} onChange={setForm} options={[{ value: 'cli', label: 'CLI' }, { value: 'rest', label: 'REST' }, { value: 'mcp', label: 'MCP' }]} />
        <Button tone="ghost" icon="copy" data-help="tc-copy" onClick={() => void navigator.clipboard?.writeText(text)}>Copy</Button>
      </div>
      <pre className="fx-code axf-tc-pre">{text}</pre>
      <Answer r={answer} />
    </div>
  );
}

/* ------------------------------------------------------------------ Docs tab */

function example(id: string, t: TargetInfo): Partial<ControlCommand> {
  if (t.domain === 'tokens') return { op: 'list', target: id };
  if (id === 'amberx.items') return { op: 'add', target: id, value: { kind: 'todo', text: 'Buy milk' } };
  if (id === 'amberx.lists') return { op: 'list', target: id };
  if (id === 'planner.plans') return { op: 'list', target: id, select: { status: 'parked' } };
  return { op: 'list', target: id, select: { profile: 'urgent' } };
}

function DocsTab({ reg, tryIt }: { reg: Registry; tryIt: (c: Partial<ControlCommand>) => void }) {
  const [guide, setGuide] = useState(GUIDES[0]!.id);
  const g = GUIDES.find((x) => x.id === guide) ?? GUIDES[0]!;
  return (
    <div className="fx-stack fx-stack--lg">
      <Container title="Guides" icon="book">
        <Segmented label="Guide" value={guide} onChange={setGuide} options={GUIDES.map((x) => ({ value: x.id, label: x.title.split(':')[0]! }))} className="axf-tc-wrap" />
        <Markdown text={`## ${g.title}\n\n${g.body}`} />
      </Container>
      <Container title="Targets" icon="list">
        {Object.entries(reg.targets).map(([id, t]) => (
          <section key={id} className="axf-tc-target">
            <div className="fx-row fx-row--wrap"><h3 className="fx-mono axf-tc-h">{id}</h3><span className="fx-chip">{t.domain}</span>{t.ops.map((o) => <span key={o} className="fx-chip fx-chip--accent">{o}</span>)}<Button size="sm" tone="ghost" icon="play" onClick={() => tryIt(example(id, t))}>Try it</Button></div>
            <p className="fx-muted">{t.doc}</p>
            {Array.isArray(t.paths) && <p className="axf-tc-small"><b>Tokens:</b> <span className="fx-mono">{(t.paths as { id: string }[]).map((p) => p.id).join(', ')}</span></p>}
            {t.fields && <p className="axf-tc-small"><b>Fields:</b> <span className="fx-mono">{Object.entries(t.fields).map(([k, d]) => `${k} (${d})`).join(', ')}</span></p>}
            {t.select && <p className="axf-tc-small"><b>Filters:</b> <span className="fx-mono">{Object.entries(t.select).map(([k, d]) => `${k} (${d})`).join(', ')}</span></p>}
            {t.acts && <p className="axf-tc-small"><b>Verbs:</b> <span className="fx-mono">{Object.entries(t.acts).map(([a, w]) => `${a}${Object.keys(w).length ? ` {${Object.keys(w).join(', ')}}` : ''}`).join(' · ')}</span></p>}
          </section>
        ))}
      </Container>
      <Container title="REST routes" icon="cloud">
        <table className="fx-table"><tbody>{reg.routes.map((r) => <tr key={`${r.method} ${r.path}`}><td className="fx-mono">{r.method}</td><td className="fx-mono">{r.path}</td><td>{r.op}</td><td className="fx-muted">{r.body ?? ''}{r.note ? ` · ${r.note}` : ''}</td></tr>)}</tbody></table>
      </Container>
      <Container title="MCP tools" icon="code">
        <table className="fx-table"><tbody>{reg.tools.map((x) => <tr key={x.name}><td className="fx-mono">{x.name}</td><td><span className={`fx-chip${x.effect === 'destructive' ? ' fx-chip--danger' : x.effect === 'read' ? '' : ' fx-chip--warning'}`}>{x.effect}</span></td><td>{x.description}</td></tr>)}</tbody></table>
        <p className="fx-muted">Also on the console MCP: amberx_find, amberx_add, amberx_update, amberx_done, amberx_move, amberx_remove, plan_park.</p>
      </Container>
      <Container title="CLI" icon="terminal">
        <pre className="fx-code axf-tc-pre">{[...reg.cli.usage, '', ...Object.values(reg.cli.aliases)].join('\n')}</pre>
      </Container>
    </div>
  );
}

/* ------------------------------------------------------------------ Audit tab */

function AuditTab() {
  const [rows, setRows] = useState<{ at: string; by: string; op: string; target: string; path?: string; action?: string; reason?: string }[]>([]);
  const load = () => void cc.audit(100).then((r) => setRows(r.ok ? (r.items ?? []) : []));
  useEffect(load, []);
  return (
    <div className="fx-stack">
      <div className="fx-row"><Button icon="refresh" onClick={load}>Refresh</Button></div>
      {rows.length ? (
        <div className="axf-tc-scroll"><table className="fx-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Why</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td className="fx-mono axf-tc-small">{r.at.replace('T', ' ').slice(0, 19)}</td><td>{r.by}</td><td className="fx-mono">{r.op} {r.target}{r.path ? ` ${r.path}` : ''}{r.action ? ` ${r.action}` : ''}</td><td className="fx-muted">{r.reason}</td></tr>)}</tbody></table></div>
      ) : <p className="fx-muted">No changes through Token control yet.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ the page */

type Tab = 'tokens' | 'passes' | 'try' | 'docs' | 'audit';

function TokenControlView() {
  const { reg, err } = useRegistry();
  const [tab, setTab] = useState<Tab>('tokens');
  const [preset, setPreset] = useState<Partial<ControlCommand> | null>(null);
  const tryIt = (c: Partial<ControlCommand>) => { setPreset({ ...c }); setTab('try'); };
  return (
    <div className="fx-stack fx-stack--lg axf-tc">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin · control@1</p><h1>Token control</h1><p className="fx-muted">Change any token, AmberX note or planner item, and see the same command as an API call, an MCP tool and a CLI line.</p></div></header>
      <Segmented label="Token control" value={tab} onChange={setTab} className="axf-tc-wrap" options={[
        { value: 'tokens', label: <span data-help="tc-tab-tokens">Tokens</span>, icon: 'sliders' },
        { value: 'passes', label: <span data-help="tc-tab-passes">Passes</span>, icon: 'key' },
        { value: 'try', label: <span data-help="tc-tab-try">Try it</span>, icon: 'play' },
        { value: 'docs', label: <span data-help="tc-tab-docs">Docs</span>, icon: 'book' },
        { value: 'audit', label: <span data-help="tc-tab-audit">Audit</span>, icon: 'list' },
      ]} />
      {err && <Note tone="danger">{err}</Note>}
      {tab === 'tokens' && <TokensTab />}
      {tab === 'passes' && <PassesTab />}
      {tab === 'try' && reg && <TryTab reg={reg} preset={preset} />}
      {tab === 'docs' && reg && <DocsTab reg={reg} tryIt={tryIt} />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.token-control',
  label: 'Token control',
  version: '0.2.0',
  appMenu,
  views: { 'token-control': { title: 'Token control', icon: 'sliders', render: () => <TokenControlView /> } },
  nav: { label: 'Plugins', items: [{ id: 'token-control', label: 'Token control', icon: 'sliders', view: 'token-control' }] },
  settingsTabs: [{ id: 'token-control', label: 'Token control', icon: 'sliders', order: 90, parent: 'plugins' }],
  // After Codebase changes (4.7) and the Claude handoff reminder (4.9), before approvals (5): renders nothing without a pass.
  banners: [{ id: 'token-pass', label: 'Pass', icon: 'key', settingsTab: 'token-control', order: 4.95, render: () => <PassBanner /> }],
  settingsPanels: [{ id: 'token-control.passes', tab: 'token-control', title: 'Veto passes', icon: 'key', order: 20, render: () => <PassSettings /> },
    { id: 'token-control.lifecycle', tab: 'token-control', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
