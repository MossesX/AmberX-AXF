/**
 * Rules briefs (rules-briefs@1, framework/core/rules-brief.mjs): what a headless build gets instead of the CLAUDE.md
 * chain. Several saved briefs, conditions for when each runs, optionally generated before send, and a build's
 * orchestrator task brief shown read-only next to what would go with it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Container, Note, SelectField, Switch, TextField } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';

const FOLDER = 'claude-settings';
type When = Record<string, string[] | boolean>;
interface Brief { id: string; name: string; enabled: boolean; mode: 'saved' | 'generate'; order: number; when: When; text: string; maxChars?: number; sources?: string[] }
interface Condition { key: string; kind: 'list' | 'flag'; label: string; hint: string }
interface Doc { ok: boolean; message?: string; lean: boolean; maxChars: number; briefs: Brief[]; conditions: Condition[]; updatedBy?: string; updatedAt?: string }
interface Preview { ok: boolean; message?: string; text: string; tokens: number; task: string; orchestrator: boolean; builds: { id: string; title: string }[]; picked: { id: string; name: string }[]; skipped: { id: string; name: string; why: string }[] }

async function send(path: string, method: string, body?: unknown): Promise<void> {
  const r = await pluginFetch(FOLDER, path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
}

function BriefEditor({ brief, conditions, onSaved, onCancel }: { brief: Brief; conditions: Condition[]; onSaved: () => void; onCancel: () => void }) {
  const [b, setB] = useState(brief);
  const [error, setError] = useState('');
  const set = (patch: Partial<Brief>) => setB({ ...b, ...patch });
  const cond = (key: string, v: string[] | boolean | undefined) => { const when = { ...b.when }; if (v === undefined || (Array.isArray(v) && !v.length)) delete when[key]; else when[key] = v; set({ when }); };
  const list = (key: string) => { const v = b.when[key]; return Array.isArray(v) ? v.join(', ') : ''; };
  const save = () => { setError(''); send(`rules-briefs/${encodeURIComponent(b.id || b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`, 'PUT', b).then(onSaved, (e: Error) => setError(e.message)); };
  return (
    <div className="fx-stack" data-testid="brief-editor">
      <TextField label="Name" value={b.name} onChange={(v) => set({ name: v })} />
      <Switch label="Switched on" checked={b.enabled} onChange={(v) => set({ enabled: v })} />
      <SelectField label="Where the text comes from" value={b.mode} options={[{ value: 'saved', label: 'Saved: send this text' }, { value: 'generate', label: 'Generate on the fly before send' }]} hint="Generate picks the rules closest to the task from the rules files, by plain code, so it costs no tokens." onChange={(v) => set({ mode: v as Brief['mode'] })} />
      {b.mode === 'generate' && <TextField label="Most characters" type="number" value={String(b.maxChars ?? 3000)} onChange={(v) => set({ maxChars: Number(v) })} />}
      <TextField label={b.mode === 'saved' ? 'Brief' : 'Heading (optional)'} rows={b.mode === 'saved' ? 12 : 2} value={b.text} onChange={(v) => set({ text: v })} />
      <p className="axp-cs-group__desc">When it runs. Leave one empty for any; all that are set must match.</p>
      <div className="axp-cs-rb__conds">
        {conditions.map((c) => (c.kind === 'flag'
          ? <SelectField key={c.key} label={c.label} value={b.when[c.key] === undefined ? '' : String(b.when[c.key])} options={[{ value: '', label: 'Any' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} hint={c.hint} onChange={(v) => cond(c.key, v === '' ? undefined : v === 'true')} />
          : <TextField key={c.key} label={c.label} value={list(c.key)} hint={c.hint} onChange={(v) => cond(c.key, v.split(',').map((s) => s.trim()).filter(Boolean))} />))}
      </div>
      {error && <Note tone="danger">{error}</Note>}
      <div className="axp-cs-rb__row">
        <Button tone="primary" icon="save" onClick={save}>Save</Button>
        <Button tone="ghost" icon="x" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function SideBySide({ version }: { version: number }) {
  const [build, setBuild] = useState('');
  const [p, setP] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    pluginFetch(FOLDER, `rules-briefs-preview${build ? `?build=${encodeURIComponent(build)}` : ''}`).then(async (r) => {
      const j = (await r.json()) as Preview;
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
      setP(j); setError('');
    }).catch((e: Error) => setError(e.message));
  }, [build, version]);
  if (error) return <Note tone="danger">{error}</Note>;
  if (!p) return null;
  return (
    <Container title="What a launch sends" icon="eye">
      <div className="fx-stack" data-testid="brief-preview">
        <SelectField label="Build" value={build} options={[{ value: '', label: 'Pick a build' }, ...p.builds.map((b) => ({ value: b.id, label: b.title || b.id }))]} onChange={setBuild} />
        {!p.orchestrator && <Note tone="warning">The Build orchestrator is off, so task briefs can't be shown.</Note>}
        <div className="axp-cs-rb__pair">
          <div className="fx-stack"><b>Task brief (read-only, from the orchestrator)</b><pre className="axp-cs-rb__pre fx-mono">{p.task || 'Pick a build to see its task brief.'}</pre></div>
          <div className="fx-stack"><b>Rules brief, about {p.tokens} tokens: {p.picked.map((x) => x.name).join(', ') || 'none'}</b><pre className="axp-cs-rb__pre fx-mono">{p.text || 'No brief applies: this launch would load the full CLAUDE.md chain.'}</pre></div>
        </div>
        {p.skipped.length > 0 && <p className="axp-cs-row__when">Left out: {p.skipped.map((s) => `${s.name} (${s.why})`).join('; ')}</p>}
      </div>
    </Container>
  );
}

export function RulesBriefsPanel() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Brief | null>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => {
    pluginFetch(FOLDER, 'rules-briefs').then(async (r) => {
      const j = (await r.json()) as Doc;
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
      setDoc(j); setError(''); setVersion((v) => v + 1);
    }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  const act = (p: Promise<void>) => { p.then(load, (e: Error) => setError(e.message)); };
  if (!doc) return error ? <Note tone="danger">Rules briefs unavailable: {error}</Note> : <p className="axp-cs-group__desc">Loading…</p>;
  const blank: Brief = { id: '', name: '', enabled: true, mode: 'saved', order: (doc.briefs.length + 1) * 10, when: {}, text: '' };
  return (
    <div className="fx-stack" data-testid="rules-briefs">
      <p className="axp-cs-group__desc">Headless builds skip CLAUDE.md and the rules files. They get their task brief plus the briefs below whose conditions match.</p>
      {error && <Note tone="danger">{error}</Note>}
      <Switch label="Lean headless launches" checked={doc.lean} hint="Off: every headless build loads the full CLAUDE.md chain again." onChange={(v) => act(send('rules-briefs-settings', 'PUT', { lean: v }))} />
      {editing ? <BriefEditor key={editing.id || 'new'} brief={editing} conditions={doc.conditions} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} /> : (
        <>
          {doc.briefs.map((b) => (
            <div key={b.id} className="axp-cs-row" data-brief={b.id}>
              <div className="axp-cs-row__control">
                <Switch label={b.name} checked={b.enabled} hint={`${b.mode === 'generate' ? 'Generated before send' : `Saved, about ${Math.ceil(b.text.length / 4)} tokens`}. Runs ${Object.keys(b.when).length ? `when ${Object.entries(b.when).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v ? 'yes' : 'no'}`).join('; ')}` : 'on every launch'}.`} onChange={(v) => act(send(`rules-briefs/${b.id}`, 'PUT', { ...b, enabled: v }))} />
              </div>
              <div className="axp-cs-rb__row">
                <Button size="sm" tone="ghost" icon="edit" onClick={() => setEditing(b)}>Edit</Button>
                <Button size="sm" tone="ghost" icon="trash" confirm={`Delete ${b.name}?`} disabled={doc.briefs.length < 2} onClick={() => act(send(`rules-briefs/${b.id}`, 'DELETE'))}>Delete</Button>
              </div>
            </div>
          ))}
          <div><Button size="sm" tone="primary" icon="plus" onClick={() => setEditing(blank)}>New brief</Button></div>
        </>
      )}
      <SideBySide version={version} />
    </div>
  );
}
