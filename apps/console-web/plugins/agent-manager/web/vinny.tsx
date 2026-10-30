/* Vinny's commands (vinny-commands@1): the dialog that manages his triggers → VPS / git / GitHub commands.
 * Vinny runs these with no model: a trigger anywhere in a message he gets runs its command through axHub
 * (each vps.run approved there). Every banner Auto fix asks him first, then Mosses, then Claude. */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, useRuntime, IconButton, Note, Section, SelectField, Switch, TextField } from '@console/axf/react';
import { call, del, post, put } from './api';
import { LoadingSkeleton } from '@console/emptyState';

type Kind = 'vps' | 'git' | 'github';
export interface VinnyCommand {
  id: string; name: string; kind: Kind; enabled: boolean; triggers: string[]; fixes: string[]; timeout: number; note?: string;
  command?: string; repo?: string; tool?: string; arguments?: Record<string, unknown>;
}
interface VinnyRun { id: string; at: number; name: string; state: string; message: string; command: string; link?: string; output?: string; source?: string }
interface VinnySettings { listen: boolean; maxPerMessage: number; autoFixFirst: boolean }
interface Book { commands: VinnyCommand[]; settings: VinnySettings; ready: boolean; why: string; where: string; runs: VinnyRun[] }
interface Match { id: string; name: string; tool?: string; arguments?: Record<string, unknown>; error?: string }

const KIND_LABEL: Record<Kind, string> = { vps: 'VPS command', git: 'git on the VPS', github: 'GitHub (axHub)' };
const BLANK: VinnyCommand = { id: '', name: '', kind: 'vps', enabled: true, triggers: [], fixes: [], timeout: 300, command: '' };
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const OPEN = ['asking', 'waiting', 'running'];

function Editor({ value, onDone }: { value: VinnyCommand; onDone: (saved: boolean) => void }) {
  const [c, setC] = useState(value);
  const [trig, setTrig] = useState(value.triggers.join(', '));
  const [fixes, setFixes] = useState(value.fixes.join(', '));
  const [args, setArgs] = useState(JSON.stringify(value.arguments ?? {}, null, 1));
  const [err, setErr] = useState('');
  const set = (p: Partial<VinnyCommand>) => setC({ ...c, ...p });
  const save = async () => {
    setErr('');
    try {
      await post('vinny/commands', { ...c, triggers: list(trig), fixes: list(fixes), ...(c.kind === 'github' ? { arguments: args } : {}) });
      onDone(true);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="fx-card fx-stack">
      <TextField label="Name" value={c.name} onChange={(name) => set({ name })} autoFocus />
      <SelectField label="Runs" value={c.kind} options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={(k) => set({ kind: k as Kind })} />
      <TextField label="Triggers" rows={2} value={trig} onChange={setTrig} hint="Words or phrases, comma separated. Found anywhere in a message, even inside a paragraph (whole words, case ignored)." />
      {c.kind === 'git' && <TextField label="Folder on the VPS" mono value={c.repo ?? ''} onChange={(repo) => set({ repo })} placeholder="/opt/axf" />}
      {c.kind !== 'github' && (
        <TextField label={c.kind === 'git' ? 'git command' : 'Shell command'} mono rows={3} value={c.command ?? ''} onChange={(command) => set({ command })}
          placeholder={c.kind === 'git' ? 'git pull --ff-only' : 'docker restart axf-console'}
          hint={`Placeholders {repo} {branch} {number} {check} come from the Auto fix that asks.${c.kind === 'git' ? ' One git command; never a force push or a push to main.' : ' Runs as root: axHub asks you to approve it every time.'}`} />
      )}
      {c.kind === 'github' && <>
        <TextField label="axHub GitHub tool" mono value={c.tool ?? ''} onChange={(tool) => set({ tool })} placeholder="github.create_pull_request" />
        <TextField label="Arguments (JSON)" mono rows={4} value={args} onChange={setArgs} />
      </>}
      <TextField label="Auto fix keys (optional)" mono value={fixes} onChange={setFixes} hint="Systems check ids or push banner keys this command fixes, comma separated; * works as a wildcard (host-*, MossesX/AmberX-AXF#*)." />
      <TextField label="Time limit (seconds)" type="number" value={String(c.timeout)} onChange={(t) => set({ timeout: Number(t) || 300 })} />
      <TextField label="Note" value={c.note ?? ''} onChange={(note) => set({ note })} />
      {err && <Note tone="danger">{err}</Note>}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="save" onClick={() => void save()}>Save</Button>
        <Button tone="ghost" onClick={() => onDone(false)}>Cancel</Button>
      </div>
    </div>
  );
}

export function VinnyCommandsDialog() {
  const [book, setBook] = useState<Book | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<VinnyCommand | null>(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [hits, setHits] = useState<Match[] | null>(null);
  const [armed, setArmed] = useState('');
  const load = useCallback(() => call<Book>('vinny').then((b) => { setBook(b); setErr(''); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const busy = !!book?.runs.some((r) => OPEN.includes(r.state));
  useEffect(() => {
    if (!busy) return undefined;
    const t = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(t);
  }, [busy, load]);
  if (err && !book) return <Note tone="danger">{err}</Note>;
  if (!book) return <LoadingSkeleton />;
  const setting = async (patch: Partial<VinnySettings>) => {
    setBook({ ...book, settings: { ...book.settings, ...patch } });  // hot: the switch moves at once
    try { await put('vinny/settings', patch); } finally { void load(); }
  };
  const toggle = async (c: VinnyCommand, enabled: boolean) => { await post('vinny/commands', { ...c, enabled }).catch((e: Error) => setErr(e.message)); void load(); };
  const remove = async (c: VinnyCommand) => {
    if (armed !== c.id) { setArmed(c.id); return; }
    setArmed(''); await del(`vinny/commands/${c.id}`).catch((e: Error) => setErr(e.message)); void load();
  };
  const run = async (c: VinnyCommand) => { setErr(''); await post(`vinny/commands/${c.id}/run`).catch((e: Error) => setErr(e.message)); void load(); };
  const test = async () => { const r = await post<{ matches: Match[] }>('vinny/test', { text: msg }); setHits(r.matches); };
  const send = async () => { setErr(''); await post('vinny/message', { text: msg, source: 'dialog' }).catch((e: Error) => setErr(e.message)); setHits(null); void load(); };
  const shown = book.commands.filter((c) => !q || `${c.name} ${c.triggers.join(' ')} ${c.command ?? ''} ${c.tool ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fx-stack axp-agent-manager">
      {book.ready
        ? <Note tone="success">Vinny is ready. He runs these without Claude: every command goes through axHub, which asks you to approve each VPS command.</Note>
        : <Note tone="warning">{book.why}</Note>}
      {err && <Note tone="danger">{err}</Note>}
      <Section title="How he listens">
        <div className="fx-stack">
          <Switch label="Run commands when a trigger shows up in a message" checked={book.settings.listen} onChange={(listen) => void setting({ listen })} />
          <Switch label="Banner Auto fix asks Vinny first (then Mosses, then Claude)" checked={book.settings.autoFixFirst} onChange={(autoFixFirst) => void setting({ autoFixFirst })} />
          <SelectField label="Most commands one message can start" value={String(book.settings.maxPerMessage)}
            options={[1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => void setting({ maxPerMessage: Number(v) })} />
          <span className="fx-small fx-muted">Kept on axHub: <code>{book.where}</code></span>
        </div>
      </Section>

      <Section title={`Commands (${book.commands.length})`} aside={<Button size="sm" tone="primary" icon="plus" onClick={() => setEdit({ ...BLANK })}>Add</Button>}>
        <div className="fx-stack">
          {edit && !edit.id && <Editor value={edit} onDone={(saved) => { setEdit(null); if (saved) void load(); }} />}
          <TextField label="Filter" value={q} onChange={setQ} placeholder="name, trigger or command" />
          {shown.map((c) => edit?.id === c.id
            ? <Editor key={c.id} value={edit} onDone={(saved) => { setEdit(null); if (saved) void load(); }} />
            : (
              <div key={c.id} className="axp-agent-manager__flatrow">
                <div className="axp-agent-manager__row">
                  <Switch label={c.name} hideLabel checked={c.enabled} onChange={(on) => void toggle(c, on)} />
                  <strong>{c.name}</strong>
                  <Chip tone={c.kind === 'github' ? 'accent' : undefined}>{KIND_LABEL[c.kind]}</Chip>
                  <span className="fx-grow" />
                  <IconButton icon="play" label={`Run ${c.name} now`} onClick={() => void run(c)} disabled={!book.ready || !c.enabled} />
                  <IconButton icon="edit" label={`Edit ${c.name}`} onClick={() => setEdit(c)} />
                  <IconButton icon="trash" label={armed === c.id ? `Tap again to remove ${c.name}` : `Remove ${c.name}`} onClick={() => void remove(c)} />
                </div>
                <div className="axp-agent-manager__strip">{c.triggers.map((t) => <Chip key={t}>{t}</Chip>)}{c.fixes.map((f) => <Chip key={f} tone="success">fix: {f}</Chip>)}</div>
                <code className="fx-small axp-agent-manager__clip">{c.kind === 'github' ? `${c.tool} ${JSON.stringify(c.arguments ?? {})}` : c.kind === 'git' ? `cd ${c.repo} && ${c.command}` : c.command}</code>
              </div>
            ))}
          <Button size="sm" tone="ghost" icon="refresh" onClick={() => void post('vinny/defaults').then(() => load())}>Add back the starter commands</Button>
        </div>
      </Section>

      <Section title="Try a message">
        <div className="fx-stack">
          <TextField label="Message to Vinny" rows={3} value={msg} onChange={(v) => { setMsg(v); setHits(null); }} placeholder="Vinny, the console looks stuck, run the doctor please" />
          <div className="fx-row fx-row--wrap">
            <Button size="sm" icon="search" onClick={() => void test()} disabled={!msg.trim()}>What would run</Button>
            <Button size="sm" tone="primary" icon="zap" onClick={() => void send()} disabled={!msg.trim() || !book.ready}>Send to Vinny</Button>
          </div>
          {hits && (hits.length ? hits.map((h) => (
            <div key={h.id} className="fx-small">{h.error ? `✗ ${h.name}: ${h.error}` : `▸ ${h.name}: ${h.tool} ${String(h.arguments?.command ?? JSON.stringify(h.arguments))}`}</div>
          )) : <span className="fx-small fx-muted">No trigger in that message.</span>)}
        </div>
      </Section>

      <Section title="Recent runs">
        <div className="fx-stack">
          {book.runs.length === 0 && <span className="fx-small fx-muted">Nothing run yet.</span>}
          {[...book.runs].reverse().map((r) => (
            <div key={r.id} className="axp-agent-manager__flatrow">
              <div className="axp-agent-manager__row">
                <Chip tone={r.state === 'done' ? 'success' : r.state === 'failed' ? 'danger' : 'warning'}>{r.state}</Chip>
                <strong>{r.name}</strong>
                <span className="fx-small fx-muted">{new Date(r.at).toLocaleString()} · {r.source}</span>
              </div>
              <span className="fx-small">{r.message}{r.link && r.state === 'waiting' ? <> · <a href={r.link} target="_blank" rel="noreferrer">Approve on axHub</a></> : null}</span>
              {r.output ? <pre className="fx-small fx-mono axp-agent-manager__out">{r.output.slice(-1200)}</pre> : null}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** Settings → Plugins → Agent manager → Vinny's commands: opens the dialog. */
export function VinnyPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <span className="fx-small fx-muted">Triggers and the VPS, git and GitHub commands Vinny runs with no Claude connection. Banner Auto fix asks him first.</span>
      <div><Button icon="terminal" onClick={() => rt.openDialog('agent-manager.vinny')}>Manage Vinny's commands</Button></div>
    </div>
  );
}
