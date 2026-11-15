/**
 * Recorder: the phone's Audio Output Recorder, run from the console. On / off, the current part, the uploaded parts,
 * the upload queue, the mic opt-in and the transcripts. Start is a straight approval on axHub (Brett approves, then
 * Android asks for capture consent on the phone); stop runs directly.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, Note, Switch, TextField } from '@console/axf/react';
import { api, errText, when, type RecorderStatus } from './api';
import { useSettings } from './PhoneConnectSettings';

export function RecorderPanel() {
  const [st, setSt] = useState<RecorderStatus | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const { settings, save, error: setErr } = useSettings();
  const load = useCallback(() => api.call<RecorderStatus>('recorder/status').then((s) => { setSt(s); setError(''); }, (e) => setError(errText(e))), []);
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5000); return () => clearInterval(t); }, [load]);
  const act = (fn: () => Promise<unknown>, done: string) => { setBusy(true); setNote(''); fn().then(() => { setNote(done); return load(); }, (e) => setNote(errText(e))).finally(() => setBusy(false)); };
  const start = () => act(() => api.post('recorder/start', { session_name: name.trim() }), 'Asked: approve it on axHub, then allow the capture prompt on the phone.');
  const stop = () => act(() => api.post('recorder/stop', {}), 'Stop sent to the phone.');
  return (
    <div className="axp-phone-stack" data-axf-target="phone-connect.recorder">
      {error && <Note tone="danger">{error}</Note>}
      <Container title="Audio Output Recorder" icon="mic">
        <div className="axp-phone-stack">
          <div className="axp-phone-row">
            <Chip tone={st?.running ? 'danger' : undefined}>{st?.running ? 'Recording' : 'Off'}</Chip>
            <span className="axp-phone-muted">{st ? (st.running ? `since ${when(st.since)}${st.session ? ` · ${st.session}` : ''}` : st.presence) : '…'}</span>
          </div>
          {st?.running ? (
            <dl className="axp-phone-facts" data-axf-target="phone-connect.recorder.current">
              <dt>Current part</dt><dd>part{st.part || 1} ({st.partMinutes}-minute parts)</dd>
              <dt>Group</dt><dd>{st.group || st.session}</dd>
              <dt>Upload queue</dt><dd>{st.queue} waiting</dd>
            </dl>
          ) : null}
          <div className="axp-phone-actions">
            {st?.running ? (
              <Button icon="pause" tone="danger" busy={busy} onClick={stop} data-axf-target="phone-connect.recorder.stop">Stop</Button>
            ) : (
              <>
                <div data-axf-target="phone-connect.recorder.name"><TextField label="Session name" value={name} onChange={setName} placeholder="What this recording is" /></div>
                <Button icon="play" tone="primary" busy={busy} disabled={!name.trim()} onClick={start} data-axf-target="phone-connect.recorder.start">Start</Button>
              </>
            )}
            <Button icon="refresh" onClick={() => void load()} data-axf-target="phone-connect.recorder.refresh">Refresh</Button>
          </div>
          {note && <Note>{note}</Note>}
          <div data-axf-target="phone-connect.recorder.mic">
            <Switch label="Record my mic too" checked={settings?.recorderMic ?? false} disabled={!settings}
              hint="Off by default. Only your own click turns it on; a command can only turn it off." onChange={(v) => void save({ recorderMic: v })} />
          </div>
          {setErr && <Note tone="warning">{setErr}</Note>}
        </div>
      </Container>
      <Container title="Uploaded parts" icon="upload">
        <ul className="axp-phone-list" data-axf-target="phone-connect.recorder.parts">
          {(st?.parts ?? []).length ? st!.parts.map((p, i) => (
            <li key={`${p.name ?? i}`} className="axp-phone-item"><span>{p.name ?? `part${i + 1}`}</span><span className="axp-phone-muted">{p.uploaded === false ? 'queued' : when(p.at ?? '')}</span></li>
          )) : <li className="axp-phone-item axp-phone-muted">No parts reported yet.</li>}
        </ul>
      </Container>
      <Container title="Transcripts" icon="file">
        <div className="axp-phone-stack" data-axf-target="phone-connect.recorder.transcripts">
          <span className="axp-phone-muted">{st ? (!st.transcripts.on ? 'Switched off (Settings → Plugins → Claude).' : !st.transcripts.engine ? 'The engine is not installed on the console.' : `${st.transcripts.waiting} part(s) waiting.`) : '…'}</span>
          {st?.transcripts.failed.map((f) => <Note key={f.id} tone="warning">{f.name ?? f.id}: {f.error}</Note>)}
          <Button icon="refresh" onClick={() => act(() => api.post('recorder/transcripts/run', {}), 'Looking for parts now.')} data-axf-target="phone-connect.recorder.transcribe">Transcribe now</Button>
        </div>
      </Container>
    </div>
  );
}
