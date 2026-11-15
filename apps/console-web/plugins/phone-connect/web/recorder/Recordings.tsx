/**
 * The recordings on axHub (moved from the old output-recorder page): by day and session, play, download, delete, the
 * transcript of each part, and "Search what was said" across the newest transcripts. A Claude session's Transcript
 * link opens this list filtered to its own recordings (FIND_KEY).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Container, Note, TextField, useRuntime } from '@console/axf/react';
import { DEFAULTS, FIND_KEY, HubRecordings, byGroup, clock, formatSize, formatTime, hubOf, readSettings, searchTranscripts, type Recording, type Transcript } from './core';
import { createController, type Controller } from './store';

let ctl: Controller | null = null;
const settingsOf = (rt: AxfRuntime) => readSettings((k) => rt.settings.get(k));
const controller = (): Controller => ctl ?? (ctl = createController(null, { settings: () => DEFAULTS, hub: () => hubOf() }));
const useStore = () => { const c = controller(); return useSyncExternalStore(c.subscribe, c.get); };

function TranscriptText({ t }: { t: Transcript }) {
  if (t.silent) return <p className="fx-small fx-muted">Nothing but silence in this part.</p>;
  return (
    <div className="axp-phone-rec-transcript">
      {t.segments.length
        ? t.segments.map(([at, line], i) => <p key={`${at}-${i}`} className="fx-small"><span className="fx-muted">{clock(at)}</span> {line}</p>)
        : <p className="fx-small">{t.text}</p>}
      {t.truncated && <p className="fx-small fx-muted">This part was too long to keep in full.</p>}
    </div>
  );
}

function RecordingRow({ r, transcript }: { r: Recording; transcript?: Transcript }) {
  const c = controller();
  const s = useStore();
  const [reading, setReading] = useState(false);
  const working = s.busy[r.id];
  const time = new Date(r.startedAt);
  return (
    <li className="axp-phone-rec-row">
      <div className="axp-phone-rec-rowhead">
        <span className="axp-phone-rec-name">{Number.isNaN(time.getTime()) ? r.name : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="fx-small fx-muted">{formatTime(r.durationMs)} · {formatSize(r.bytes)}{r.mic ? ' · playback + mic' : ''}{r.device ? ` · ${r.device}` : ''}</span>
      </div>
      {s.playing?.id === r.id && <audio className="axp-phone-rec-audio" src={s.playing.url} controls autoPlay onEnded={() => c.stopPlaying()} />}
      {reading && transcript && <TranscriptText t={transcript} />}
      <div className="fx-row fx-row--wrap fx-row--end">
        {working && <span className="fx-small fx-muted">{working}…</span>}
        {transcript && <Button size="sm" tone="quiet" icon="file" onClick={() => setReading(!reading)}>{reading ? 'Hide transcript' : 'Transcript'}</Button>}
        {s.playing?.id === r.id
          ? <Button size="sm" tone="quiet" icon="x" onClick={() => c.stopPlaying()}>Close</Button>
          : <Button size="sm" tone="quiet" icon="play" disabled={!!working} onClick={() => void c.play(r)}>Play</Button>}
        <Button size="sm" tone="quiet" icon={c.native() ? 'external' : 'download'} disabled={!!working} onClick={() => void c.share(r)}>{c.native() ? 'Share' : 'Download'}</Button>
                <Button size="sm" tone="quiet" icon="trash" disabled={!!working} confirm={`Delete ${r.name} from axHub? This can’t be undone.`} onClick={() => void c.remove(r)}>Delete</Button>
      </div>
    </li>
  );
}

export function HubList() {
  const c = controller();
  const s = useStore();
  const rt = useRuntime();
  useEffect(() => { if (!s.hub.loaded && !s.hub.loading) void c.refreshHub(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [texts, setTexts] = useState<Transcript[]>([]);
  // a session's Transcript button opens this page on its own recordings
  const [q, setQ] = useState(() => { const v = rt.settings.get(FIND_KEY); return typeof v === 'string' ? v : ''; });
  useEffect(() => { if (q && rt.settings.get(FIND_KEY)) rt.settings.set(FIND_KEY, ''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    new HubRecordings({ hub: hubOf(), project: settingsOf(rt).project }).transcripts().then((t) => { if (live) setTexts(t); }).catch(() => { /* the list above says what's wrong with the hub */ });
    return () => { live = false; };
  }, [s.hub.loaded, s.hub.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(texts.map((t) => [t.id, t])), [texts]);
  const hits = useMemo(() => searchTranscripts(texts, q), [texts, q]);
  const days = byGroup(s.hub.items);
  return (
    <Container title={`On axHub · ${settingsOf(rt).project}`} icon="cloud" actions={<Button size="sm" tone="quiet" icon="refresh" busy={s.hub.loading} onClick={() => void c.refreshHub()}>Refresh</Button>}>
      <TextField label="Search what was said" value={q} onChange={setQ} placeholder={texts.length ? `${texts.length} transcript${texts.length === 1 ? '' : 's'}` : 'No transcripts yet'} />
      {q.trim() ? (
        hits.length ? (
          <ul className="axp-phone-rec-list">
            {hits.map(({ transcript: t, snippet }) => {
              const rec = s.hub.items.find((x) => x.id === t.id);
              return <li key={t.id} className="axp-phone-rec-row">
                <div className="axp-phone-rec-rowhead"><span className="axp-phone-rec-name">{t.session || t.name}</span><span className="fx-small fx-muted">{new Date(t.startedAt).toLocaleString()}</span></div>
                <p className="fx-small">{snippet}</p>
                {rec ? <ul className="axp-phone-rec-list"><RecordingRow r={rec} transcript={t} /></ul> : <TranscriptText t={t} />}
              </li>;
            })}
          </ul>
        ) : <p className="fx-muted">Nothing said matches that.</p>
      ) : s.hub.error ? <Note tone="warning">{s.hub.error}</Note>
        : !s.hub.loaded ? <p className="fx-muted">Loading…</p>
          : !days.length ? <p className="fx-muted">No recordings on axHub yet.</p>
            : days.map((d) => (
              <div key={d.key} className="fx-stack">
                <p className="fx-eyebrow">{d.group ? `Session · ${d.label}` : d.label}</p>
                <ul className="axp-phone-rec-list">{d.items.map((r) => <RecordingRow key={r.id} r={r} transcript={byId.get(r.id)} />)}</ul>
              </div>
            ))}
    </Container>
  );
}

