/**
 * Recordings on the console (s7, contract C25–C30): what the phone uploaded to the console, with playback, transcript,
 * transcribe, delete (two-step), remote start / stop through axHub and the phone's last recorder status. Every button
 * is a route of this plugin's server (/api/plugins/output-recorder/…), so MCP (output-recorder_*), the CLI
 * (`axf output-recorder …`) and voice reach the same things. Deep link: output-recorder.focus:<recording id>.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { FOLDER } from './core';

export const FOCUS_EVENT = 'output-recorder:focus';

interface Rec { id: string; name?: string; startedAt?: string; durationMs?: number; bytes?: number; session?: string; mic?: boolean; transcribed: boolean; transcriptPreview?: string }
interface Device { known: boolean; on: boolean; session?: string; uploadedParts?: number; queue?: number; at?: number }
interface PageSettings { autoTranscribe: boolean; listLimit: number }

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; json: any }> {
  const r = await pluginFetch(FOLDER, path, init);
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const post = (path: string, body: unknown = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const minutes = (ms?: number) => (ms ? `${Math.max(1, Math.round(ms / 60_000))} min` : '');

function Player({ id }: { id: string }) {
  const [src, setSrc] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let url = '';
    void pluginFetch(FOLDER, `recordings/${encodeURIComponent(id)}/audio`).then(async (r) => {
      if (!r.ok) { setErr(r.status === 404 ? 'Still uploading, or gone.' : `The console answered ${r.status}.`); return; }
      url = URL.createObjectURL(await r.blob()); setSrc(url);
    }, () => setErr('Could not reach the console.'));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (err) return <Note tone="warning">{err}</Note>;
  return src ? <audio className="axp-output-recorder__player" controls src={src} /> : <p className="fx-muted">Loading the audio…</p>;
}

export function ConsoleRecordings() {
  const rt = useRuntime();
  const [rows, setRows] = useState<Rec[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState('');
  const [transcript, setTranscript] = useState('');
  const [device, setDevice] = useState<Device | null>(null);
  const [session, setSession] = useState('');
  const [busy, setBusy] = useState('');
  const toast = (t: string, tone: 'success' | 'danger' | 'info' = 'info') => rt.toast(t, tone, 'Recordings');
  const load = useCallback(async () => {
    const [l, d] = await Promise.all([call('recordings'), call('device/status')]);
    if (l.status === 200) { setRows(l.json.recordings ?? []); setTotal(l.json.total ?? 0); }
    if (d.status === 200) setDevice(d.json as Device);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = (e: Event) => setOpen(decodeURIComponent(String((e as CustomEvent).detail ?? '')));
    window.addEventListener(FOCUS_EVENT, on);
    const w = window as { __outputRecorderFocus?: string };
    if (w.__outputRecorderFocus) { setOpen(w.__outputRecorderFocus); w.__outputRecorderFocus = undefined; }
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, []);
  useEffect(() => {
    setTranscript('');
    if (!open) return;
    void call(`recordings/${encodeURIComponent(open)}`).then((r) => {
      if (r.status !== 200) { toast(`No recording ${open} on the console.`); return; }
      setTranscript(String(r.json.transcript?.text ?? ''));
      document.querySelector(`[data-recording="${CSS.escape(open)}"]`)?.scrollIntoView({ block: 'center' });
    });
  }, [open]);

  const remove = async (r: Rec) => {
    setBusy(r.id);
    const first = await call(`recordings/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
    const done = first.status === 409 ? await call(`recordings/${encodeURIComponent(r.id)}?confirm=${encodeURIComponent(first.json.confirm)}`, { method: 'DELETE' }) : first;
    setBusy('');
    if (done.status !== 200) { toast(done.json.detail || done.json.message || 'Not deleted.', 'danger'); return; }
    toast('Deleted.', 'success'); if (open === r.id) setOpen(''); void load();
  };
  const transcribe = async (r: Rec) => {
    const a = await post(`recordings/${encodeURIComponent(r.id)}/transcribe`);
    toast(a.status === 200 ? (a.json.queued ? `Transcribing next.${a.json.note ? ` ${a.json.note}` : ''}` : 'Already transcribed.') : 'Could not queue it.', a.status === 200 ? 'success' : 'danger');
  };
  const remote = async (verb: 'start' | 'stop') => {
    setBusy(verb);
    const a = await post(`recordings/act/${verb}`, verb === 'start' ? { session } : {});
    setBusy('');
    toast(a.json.ok ? (verb === 'start' ? 'Asked: approve it on axHub, then allow it on the phone.' : 'Asked the phone to stop.') : a.json.message || a.json.detail || 'The phone was not reached.', a.json.ok ? 'success' : 'danger');
    void load();
  };

  return (
    <Container title="Recordings on the console" icon="play" actions={<span className="axp-output-recorder__row" role="toolbar" aria-label="Recordings"><Button size="sm" icon="refresh" onClick={() => void load()}>Refresh</Button></span>}>
      <div className="axp-output-recorder__console" data-help="output-recorder.console">
        <div className="axp-output-recorder__row">
          {device?.known ? <Chip tone={device.on ? 'danger' : undefined}>{device.on ? `Phone recording${device.session ? `: ${device.session}` : ''}` : 'Phone not recording'}</Chip> : <Chip>No phone status yet</Chip>}
          {device?.queue ? <Chip tone="warning">{device.queue} part(s) waiting to upload</Chip> : null}
        </div>
        <div className="axp-output-recorder__row" role="toolbar" aria-label="Remote recorder">
          <TextField label="Session" value={session} onChange={setSession} placeholder="What the recording is for" />
          <Button icon="mic" busy={busy === 'start'} disabled={!session.trim()} onClick={() => void remote('start')}>Start on the phone</Button>
          <Button icon="square" busy={busy === 'stop'} onClick={() => void remote('stop')}>Stop</Button>
        </div>
        {!rows.length && <Note tone="info">No recording has been uploaded to the console yet. The phone uploads here once it talks to the console (older phones still upload to axHub: see above).</Note>}
        {rows.map((r) => (
          <div key={r.id} className={`axp-output-recorder__rec${open === r.id ? ' is-focused' : ''}`} data-recording={r.id}>
            <div className="axp-output-recorder__row">
              <strong className="axp-output-recorder__grow">{r.name || r.id}</strong>
              <span className="fx-muted">{r.startedAt ? new Date(r.startedAt).toLocaleString() : ''} {minutes(r.durationMs)}</span>
              {r.mic && <Chip tone="accent">Mic</Chip>}
              {r.transcribed ? <Chip tone="success">Transcript</Chip> : <Chip>No transcript</Chip>}
            </div>
            <div className="axp-output-recorder__row" role="toolbar" aria-label="Recording actions">
              <Button size="sm" icon="play" onClick={() => setOpen(open === r.id ? '' : r.id)}>{open === r.id ? 'Close' : 'Play'}</Button>
              {!r.transcribed && <Button size="sm" icon="file-text" onClick={() => void transcribe(r)}>Transcribe</Button>}
              <Button size="sm" tone="danger" icon="trash" busy={busy === r.id} confirm={`Delete ${r.name || r.id}? Its audio and transcript go for good.`} onClick={() => void remove(r)}>Delete</Button>
            </div>
            {open === r.id && <Player id={r.id} />}
            {open === r.id && transcript && <p className="axp-output-recorder__transcript">{transcript}</p>}
          </div>
        ))}
        {total > rows.length && <p className="fx-muted">{total - rows.length} older: raise "Recordings listed" in settings.</p>}
      </div>
    </Container>
  );
}

export function ConsoleRecordingSettings() {
  const rt = useRuntime();
  const [s, setS] = useState<PageSettings | null>(null);
  useEffect(() => { void call('settings').then((r) => r.status === 200 && setS(r.json.settings)); }, []);
  const set = async (patch: Partial<PageSettings>) => {
    const r = await call('settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    if (r.status !== 200) { rt.toast(r.json.detail || 'Not saved.', 'danger', 'Recordings'); return; }
    setS(r.json.settings);
  };
  if (!s) return <p className="fx-muted">Reading…</p>;
  return (
    <div className="axp-output-recorder__console">
      <Switch label="Transcribe recordings by themselves" checked={s.autoTranscribe} onChange={(v) => void set({ autoTranscribe: v })} hint="Off: nothing is transcribed until it is on again (the Claude setting recording.transcribe must be on too)." />
      <SelectField label="Recordings listed" value={String(s.listLimit)} onChange={(v) => void set({ listLimit: Number(v) })} options={[25, 50, 100, 200, 500].map((n) => ({ value: String(n), label: String(n) }))} />
    </div>
  );
}
