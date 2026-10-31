/**
 * Audio Extract (web part). Pulls the audio out of videos on the phone (screen recordings first) and records the screen
 * with the sound apps play; every recording goes straight through the extractor. Runs in AmberX on Android only: the
 * work is the native `AudioExtract` plugin (see bridge.ts). No microphone anywhere, no browser stand-in.
 *
 *  - view `audio-extract` (nav → Media → Audio Extract): tabs Extract · Record · Files
 *  - Settings → Plugins → Audio Extract: format, folder, watch + auto-extract, delete video after, the recorder
 *  - actions `audio-extract.latest | pick | record | stop | pause | resume`, voice phrases for each (core.ts VOICE)
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Container, Meter, Note, Segmented, SelectField, Switch, TextField, useRuntime, type AxfWebLibrary } from '@console/axf/react';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { nativeBridge } from './bridge';
import {
  FOLDER, FORMATS, ID, K, VOICE, batchProgress, checkTrim, createController, formatSize, formatTime, readSettings, recActive, recLabel, trackLabel,
  formatProblem, type AudioFile, type AudioFormat, type AudioTrack, type Controller, type Job, type Video,
} from './core';
import './audio-extract.css';

/* ---------------------------------------------------------------- one controller per page */

let ctl: Controller | null = null;
const controller = (): Controller => ctl ?? (ctl = createController(null, { settings: () => readSettings(() => undefined) }));
const useStore = () => { const c = controller(); return useSyncExternalStore(c.subscribe, c.get); };
const settingsOf = (rt: AxfRuntime) => readSettings((k) => rt.settings.get(k));

/* ---------------------------------------------------------------- pieces */

const STATE_CHIP: Record<Job['state'], string> = { queued: '', running: 'fx-chip--accent', done: 'fx-chip--success', failed: 'fx-chip--danger', cancelled: 'fx-chip--warning' };
const STATE_LABEL: Record<Job['state'], string> = { queued: 'Waiting', running: 'Extracting', done: 'Saved', failed: 'Failed', cancelled: 'Cancelled' };

function Offers() {
  const s = useStore();
  const c = controller();
  if (!s.offers.length) return null;
  return (
    <div className="fx-stack">
      {s.offers.map((v) => (
        <Container key={v.uri} title="New screen recording: extract audio?" icon="monitor">
          <p className="axp-audio-extract-name">{v.name}{v.durationMs ? <span className="fx-muted"> · {formatTime(v.durationMs)}</span> : null}</p>
          <div className="fx-row fx-row--wrap fx-row--end">
            <Button size="sm" tone="quiet" onClick={() => c.dismissOffer(v.uri)}>Not now</Button>
            <Button size="sm" tone="primary" icon="download" onClick={() => c.acceptOffer(v.uri)}>Extract audio</Button>
          </div>
        </Container>
      ))}
    </div>
  );
}

/** The screen-recording folders AmberX may read (granted once through Android's folder picker). */
function Folders({ compact = false }: { compact?: boolean }) {
  const s = useStore();
  const c = controller();
  useEffect(() => { if (s.folders === null) void c.refreshFolders(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = s.folders ?? [];
  if (compact && (s.folders === null || list.length)) return null;
  return (
    <div className="fx-stack">
      {compact
        ? <Note tone="info">To find your screen recordings (Last screen recording, new-recording cards), choose your Screen recordings folder once. Samsung: DCIM → Screen recordings. No storage permission needed.</Note>
        : <p className="fx-small fx-muted">AmberX reads only the folders you choose here (Android’s folder picker; no storage permission). Samsung: DCIM → Screen recordings. Pixel: Movies → Screen recordings.</p>}
      {!compact && list.map((f) => (
        <div key={f.uri} className="axp-audio-extract-rowhead">
          <span className="axp-audio-extract-name">{f.name}</span>
          <Button size="sm" tone="quiet" icon="x" onClick={() => void c.removeFolder(f.uri)}>Remove</Button>
        </div>
      ))}
      <div className="fx-row fx-row--wrap"><Button size="sm" icon="folder" onClick={() => void c.addFolder()}>{list.length ? 'Add another folder' : 'Choose Screen recordings folder'}</Button></div>
    </div>
  );
}

function JobRow({ j }: { j: Job }) {
  const c = controller();
  return (
    <li className="axp-audio-extract-row">
      <div className="axp-audio-extract-rowhead">
        <span className="axp-audio-extract-name">{j.name}</span>
        <span className={`fx-chip ${STATE_CHIP[j.state]}`}>{STATE_LABEL[j.state]}</span>
      </div>
      <p className="fx-small fx-muted">from {j.video.name}{j.trim.startMs || j.trim.endMs !== null ? ` · ${formatTime(j.trim.startMs)}–${j.trim.endMs === null ? 'end' : formatTime(j.trim.endMs)}` : ''}</p>
      {(j.state === 'running' || j.state === 'queued') && <Meter value={j.progress * 100} active={j.state === 'running'} small label={`${Math.round(j.progress * 100)}%`} />}
      {j.state === 'failed' && <p className="fx-small axp-audio-extract-error">{j.error}</p>}
      <div className="fx-row fx-row--wrap fx-row--end">
        {(j.state === 'running' || j.state === 'queued') && <Button size="sm" tone="quiet" icon="x" onClick={() => void c.cancel(j.id)}>Cancel</Button>}
        {(j.state === 'failed' || j.state === 'cancelled') && <Button size="sm" tone="quiet" icon="refresh" onClick={() => c.retry(j.id)}>Retry</Button>}
        {j.result && <Button size="sm" tone="quiet" icon="play" onClick={() => void c.play(j.result!)}>Play</Button>}
        {j.result && <Button size="sm" tone="quiet" icon="external" onClick={() => void c.share(j.result!)}>Share</Button>}
      </div>
    </li>
  );
}

function Jobs() {
  const s = useStore();
  const c = controller();
  if (!s.jobs.length) return null;
  const b = batchProgress(s.jobs);
  return (
    <Container title={b.left ? `Extracting · ${b.done} of ${b.total} done` : `${b.done} of ${b.total} saved${b.failed ? ` · ${b.failed} failed` : ''}`} icon="list"
      actions={b.left ? <Button size="sm" tone="quiet" icon="x" onClick={() => void c.cancelAll()}>Cancel all</Button> : <Button size="sm" tone="quiet" onClick={() => c.clearFinished()}>Clear</Button>}>
      {b.total > 1 && b.left > 0 && <Meter value={b.progress * 100} active label={`${Math.round(b.progress * 100)}%`} />}
      <ul className="axp-audio-extract-list">{[...s.jobs].reverse().map((j) => <JobRow key={j.id} j={j} />)}</ul>
    </Container>
  );
}

/** Pick one video, then choose its track, trim and format before extracting. */
function TrimCard({ onDone }: { onDone: () => void }) {
  const rt = useRuntime();
  const c = controller();
  const [picked, setPicked] = useState<{ video: Video; durationMs: number; tracks: AudioTrack[] } | null>(null);
  const [track, setTrack] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [format, setFormat] = useState<AudioFormat>(settingsOf(rt).format);
  useEffect(() => { void c.pickOne().then((p) => { if (!p) onDone(); else { setPicked(p); setTrack(String(p.tracks[0]?.index ?? '')); } }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!picked) return <p className="fx-muted">Choose a video…</p>;
  const t = picked.tracks.find((x) => String(x.index) === track);
  const trim = checkTrim(start, end, picked.durationMs || null);
  const problem = formatProblem(t, format) ?? (trim.ok ? null : trim.error);
  return (
    <Container title={picked.video.name} icon="edit">
      <div className="fx-stack">
        <p className="fx-small fx-muted">{formatTime(picked.durationMs)} · {picked.tracks.length} audio track{picked.tracks.length === 1 ? '' : 's'}</p>
        {picked.tracks.length > 1 && (
          <SelectField label="Audio track" value={track} onChange={setTrack} options={picked.tracks.map((x) => ({ value: String(x.index), label: trackLabel(x) }))} />
        )}
        <div className="axp-audio-extract-trim">
          <TextField label="Start" value={start} placeholder="0:00" onChange={setStart} />
          <TextField label="End" value={end} placeholder={formatTime(picked.durationMs)} onChange={setEnd} />
        </div>
        <Segmented<AudioFormat> label="Format" value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.value, label: f.value.toUpperCase() }))} />
        {problem && <Note tone="warning">{problem}</Note>}
        <div className="fx-row fx-row--wrap fx-row--end">
          <Button tone="quiet" onClick={onDone}>Cancel</Button>
          <Button tone="primary" icon="download" disabled={!!problem || !trim.ok}
            onClick={() => { if (trim.ok && t) { c.enqueue([picked.video], { track: t.index, trim: trim.trim, format }); onDone(); } }}>Extract</Button>
        </div>
      </div>
    </Container>
  );
}

function ExtractTab() {
  const rt = useRuntime();
  const c = controller();
  const s = useStore();
  const [trimming, setTrimming] = useState(false);
  const cfg = settingsOf(rt);
  return (
    <div className="fx-stack">
      <div className="axp-audio-extract-actions">
        <Button tone="primary" icon="folder" onClick={() => void c.pick(true)}>Pick videos</Button>
        <Button icon="monitor" onClick={() => void c.extractLatest()}>Last screen recording</Button>
        <Button tone="quiet" icon="edit" disabled={trimming} onClick={() => setTrimming(true)}>Trim or pick a track…</Button>
      </div>
      <Segmented<AudioFormat> label="Format" value={cfg.format} onChange={(v) => rt.settings.set(K.format, v)}
        options={FORMATS.map((f) => ({ value: f.value, label: f.value.toUpperCase() }))} />
      <p className="fx-small fx-muted">{FORMATS.find((f) => f.value === cfg.format)?.detail} Saved to Music/{cfg.folder}. Share a video to AmberX from your Gallery to extract it too.</p>
      <Folders compact />
      {trimming && <TrimCard onDone={() => setTrimming(false)} />}
      <Jobs />
      {s.note && <p className="fx-small fx-muted">{s.note}</p>}
    </div>
  );
}

function RecordTab() {
  const rt = useRuntime();
  const c = controller();
  const s = useStore();
  const r = s.rec;
  const cfg = settingsOf(rt).rec;
  const active = recActive(r.phase);
  return (
    <div className="fx-stack">
      <Container title={recLabel(r)} icon="monitor">
        <div className="fx-stack">
          {r.phase === 'recording' && !r.playbackAudio && <Note tone="warning">Android didn’t allow capturing app sound for this recording, so it has no audio.</Note>}
          <div className="axp-audio-extract-actions">
            {!active && r.phase !== 'extracting' && <Button tone="primary" icon="monitor" className="axp-audio-extract-big" onClick={() => void c.recStart()}>Record screen</Button>}
            {active && <Button tone="danger" icon="x" className="axp-audio-extract-big" onClick={() => void c.recStop()}>{r.phase === 'countdown' || r.phase === 'starting' ? 'Cancel' : 'Stop'}</Button>}
            {r.phase === 'recording' && <Button icon="pause" onClick={() => void c.recPause()}>Pause</Button>}
            {r.phase === 'paused' && <Button icon="play" onClick={() => void c.recResume()}>Resume</Button>}
          </div>
          {r.phase === 'extracting' && <Meter value={(s.jobs.find((j) => j.id === r.jobId)?.progress ?? 0) * 100} active small />}
          {r.phase === 'done' && r.audio && (
            <div className="fx-stack">
              <p className="axp-audio-extract-name">{r.audio.name}</p>
              <p className="fx-small fx-muted">{cfg.keep === 'audio' ? 'Audio only: the video was deleted.' : `Video kept too: ${r.video?.name ?? ''}`}</p>
              <div className="fx-row fx-row--wrap fx-row--end">
                <Button size="sm" tone="quiet" icon="play" onClick={() => void c.play(r.audio!)}>Play</Button>
                <Button size="sm" tone="quiet" icon="external" onClick={() => void c.share(r.audio!)}>Share</Button>
                <Button size="sm" tone="quiet" onClick={() => c.recReset()}>Done</Button>
              </div>
            </div>
          )}
          {r.phase === 'error' && <div className="fx-row fx-row--end"><Button size="sm" tone="quiet" onClick={() => c.recReset()}>OK</Button></div>}
        </div>
      </Container>
      <Note tone="info">
        Records the screen and the sound apps play. No microphone, ever. Android asks for screen capture each time.
        Some apps block their sound from being captured; their audio will be silent. AmberX’s own screen shows black (it’s kept private).
      </Note>
      <p className="fx-small fx-muted">
        {cfg.resolution === 'native' ? 'Native resolution' : `${cfg.resolution}p`} · {cfg.fps} fps · {cfg.videoMbps} Mbps · audio {cfg.audioKbps} kbps
        {cfg.countdown ? ` · ${cfg.countdown} s countdown` : ''} · {cfg.keep === 'audio' ? 'keeps the audio only' : 'keeps the video and its audio'}
        {cfg.chip ? ' · floating chip' : ''}. Change these in Settings → Plugins → Audio Extract.
      </p>
    </div>
  );
}

function FileRow({ f }: { f: AudioFile }) {
  const c = controller();
  const [name, setName] = useState<string | null>(null);
  return (
    <li className="axp-audio-extract-row">
      {name === null ? (
        <div className="axp-audio-extract-rowhead">
          <span className="axp-audio-extract-name">{f.name}</span>
          <span className="fx-small fx-muted">{formatSize(f.size)}{f.durationMs ? ` · ${formatTime(f.durationMs)}` : ''}</span>
        </div>
      ) : (
        <TextField label="New name" value={name} onChange={setName} />
      )}
      <div className="fx-row fx-row--wrap fx-row--end">
        {name === null ? (
          <>
            <Button size="sm" tone="quiet" icon="play" onClick={() => void c.play(f)}>Play</Button>
            <Button size="sm" tone="quiet" icon="external" onClick={() => void c.share(f)}>Share</Button>
            <Button size="sm" tone="quiet" icon="edit" onClick={() => setName(f.name)}>Rename</Button>
            <Button size="sm" tone="quiet" icon="trash" confirm={`Delete ${f.name}?`} onClick={() => void c.remove(f)}>Delete</Button>
          </>
        ) : (
          <>
            <Button size="sm" tone="quiet" onClick={() => setName(null)}>Cancel</Button>
            <Button size="sm" tone="primary" icon="check" onClick={() => void c.rename(f, name).then((ok) => { if (ok) setName(null); })}>Save</Button>
          </>
        )}
      </div>
    </li>
  );
}

function FilesTab() {
  const rt = useRuntime();
  const c = controller();
  const s = useStore();
  useEffect(() => { void c.refreshFiles(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Container title={`Music/${settingsOf(rt).folder}`} icon="folder" actions={<Button size="sm" tone="quiet" icon="refresh" onClick={() => void c.refreshFiles()}>Refresh</Button>}>
      {!s.filesLoaded ? <p className="fx-muted">Loading…</p>
        : !s.files.length ? <p className="fx-muted">No audio files yet.</p>
          : <ul className="axp-audio-extract-list">{s.files.map((f) => <FileRow key={f.uri} f={f} />)}</ul>}
    </Container>
  );
}

type Tab = 'extract' | 'record' | 'files';
let lastTab: Tab = 'extract';

function AudioExtractView() {
  const c = controller();
  const s = useStore();
  const [tab, setTabState] = useState<Tab>(recActive(s.rec.phase) || s.rec.phase === 'extracting' ? 'record' : lastTab);
  const setTab = (t: Tab) => { lastTab = t; setTabState(t); };
  return (
    <div className="fx-stack">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Audio Extract</p>
          <h1>{tab === 'record' ? 'Record the screen' : tab === 'files' ? 'Your audio files' : 'Audio out of videos'}</h1>
          <p className="fx-muted">{tab === 'record' ? 'Screen plus the sound apps play, straight into an audio file. No microphone.' : tab === 'files' ? 'Play, share, rename or delete what you’ve extracted.' : 'Pull the audio out of your screen recordings and other videos, with no re-encode.'}</p>
        </div>
      </header>
      {!c.available() ? (
        <Note tone="warning">Audio Extract runs in the AmberX app on Android: install the newest AmberX APK (it carries the Audio Extract plugin). Nothing runs in a browser.</Note>
      ) : (
        <>
          <Offers />
          <Segmented<Tab> value={tab} onChange={setTab} label="Audio Extract"
            options={[{ value: 'extract', label: 'Extract', icon: 'download' }, { value: 'record', label: 'Record', icon: 'monitor' }, { value: 'files', label: 'Files', icon: 'folder' }]} />
          {tab === 'extract' ? <ExtractTab /> : tab === 'record' ? <RecordTab /> : <FilesTab />}
        </>
      )}
    </div>
  );
}

function OverlayPanel() {
  const c = controller();
  const rt = useRuntime();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const b = nativeBridge();
  if (!c.available() || !b) return null;
  return (
    <div className="fx-stack">
      <Switch label="Show the floating chip while recording" checked={settingsOf(rt).rec.chip} onChange={(v) => rt.settings.set(K.chip, v)}
        hint="Elapsed time and Stop, over other apps. Needs “Display over other apps” (AmberX already asks for it for hands-free listening); without it, Stop is in the notification." />
      <div className="fx-row fx-row--wrap">
        <Button size="sm" tone="quiet" onClick={() => void b.overlay().then((r) => setAllowed(r.allowed)).catch(() => setAllowed(false))}>Check “Display over other apps”</Button>
        {allowed !== null && <span className={`fx-chip ${allowed ? 'fx-chip--success' : 'fx-chip--warning'}`}>{allowed ? 'Allowed' : 'Not allowed'}</span>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- library */

type VoiceRegistry = { register(module: string, commands: { id: string; phrases: string[]; action: string; reply?: string; group?: string; owner?: string }[]): () => void };

function registerVoice(): void {
  // AmberX's voice plugin takes phrases from plugins it can't import through the page (generic, names no plugin).
  const v = (globalThis as { amberxVoice?: VoiceRegistry }).amberxVoice;
  v?.register(ID, [
    { id: 'audio-extract.latest', phrases: [...VOICE.extractLast], action: 'audio-extract.latest', owner: 'Audio Extract' },
    { id: 'audio-extract.pick', phrases: [...VOICE.pick], action: 'audio-extract.pick', owner: 'Audio Extract' },
    { id: 'audio-extract.record', phrases: [...VOICE.recStart], action: 'audio-extract.record', owner: 'Audio Extract' },
    { id: 'audio-extract.stop', phrases: [...VOICE.recStop], action: 'audio-extract.stop', owner: 'Audio Extract' },
    { id: 'audio-extract.pause', phrases: [...VOICE.recPause], action: 'audio-extract.pause', owner: 'Audio Extract' },
    { id: 'audio-extract.resume', phrases: [...VOICE.recResume], action: 'audio-extract.resume', owner: 'Audio Extract' },
    { id: 'audio-extract.open', phrases: [...VOICE.open], action: 'nav:audio-extract', owner: 'Audio Extract' },
  ]);
}

const FORMAT_OPTIONS = FORMATS.map((f) => ({ value: f.value, label: f.label }));

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Audio Extract',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-30' },
  provides: ['axf.audio-extract'],
  views: { 'audio-extract': { title: 'Audio Extract', icon: 'download', keywords: ['audio', 'extract', 'screen recording', 'record screen', 'm4a', 'wav', 'video'], render: () => <AudioExtractView /> } },
  nav: { label: 'Media', items: [{ id: 'audio-extract', label: 'Audio Extract', icon: 'download', view: 'audio-extract' }] },
  settingsTabs: [{ id: 'audio-extract', label: 'Audio Extract', icon: 'download', order: 40, parent: 'plugins', description: 'Format, where files go, watching for new screen recordings, and the screen recorder.' }],
  settings: [
    {
      id: 'audio-extract.extract', label: 'Extract', icon: 'download', tab: 'audio-extract', settings: [
        { key: K.format, label: 'Format', kind: 'choice', default: 'm4a', options: FORMAT_OPTIONS, description: 'M4A copies the original AAC audio out with no re-encode. WAV decodes it. No MP3: Android has no MP3 encoder built in.' },
        { key: K.folder, label: 'Output folder (inside Music)', kind: 'text', default: 'AmberX Audio' },
        { key: K.watch, label: 'Watch for new screen recordings', kind: 'toggle', default: false, description: 'While AmberX runs, a new video in Movies or DCIM → Screen recordings shows a “New screen recording: extract audio?” card.' },
        { key: K.autoExtract, label: 'Extract new screen recordings without asking', kind: 'toggle', default: false, description: 'Only while watching.' },
        { key: K.deleteVideo, label: 'Delete the video after extracting', kind: 'toggle', default: false, description: 'Only once its audio is saved. A video from a folder you granted is deleted through that grant; one shared from the Gallery goes through Android’s own “Allow delete?” prompt.' },
      ],
    },
    {
      id: 'audio-extract.recorder', label: 'Screen recorder', icon: 'monitor', tab: 'audio-extract', settings: [
        { key: K.resolution, label: 'Resolution', kind: 'choice', default: 'native', options: [{ value: 'native', label: 'Native' }, { value: '1080', label: '1080p' }, { value: '720', label: '720p' }] },
        { key: K.fps, label: 'Frame rate', kind: 'choice', default: '30', options: [{ value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }] },
        { key: K.videoMbps, label: 'Video bitrate (Mbps)', kind: 'number', default: 8, min: 1, max: 40, step: 1 },
        { key: K.audioKbps, label: 'Audio quality', kind: 'choice', default: '192', options: [{ value: '128', label: '128 kbps' }, { value: '192', label: '192 kbps' }, { value: '256', label: '256 kbps' }] },
        { key: K.keep, label: 'Keep', kind: 'choice', default: 'both', options: [{ value: 'both', label: 'The video and its audio' }, { value: 'audio', label: 'The audio only (video deleted after a good extract)' }] },
        { key: K.countdown, label: 'Countdown (seconds)', kind: 'number', default: 3, min: 0, max: 10, step: 1 },
      ],
    },
  ],
  settingsPanels: [
    { id: 'audio-extract.folders', tab: 'audio-extract', title: 'Screen recordings folders', icon: 'folder', render: () => (controller().available() ? <Folders /> : null) },
    { id: 'audio-extract.chip', tab: 'audio-extract', title: 'Floating chip', icon: 'monitor', render: () => <OverlayPanel /> },
    { id: 'audio-extract.lifecycle', tab: 'audio-extract', title: 'Install & uninstall', icon: 'package', render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  appMenu: [{ id: 'audio-extract', menu: 'axhub', items: [
    { id: 'audio-extract.latest', label: 'Extract audio from last screen recording', icon: 'download', action: 'audio-extract.latest' },
    { id: 'audio-extract.record', label: 'Record screen', icon: 'monitor', action: 'audio-extract.record' },
  ] }],
  register(rt) {
    const bridge = nativeBridge();
    ctl = createController(bridge, {
      settings: () => settingsOf(rt),
      toast: (text, tone) => rt.toast(text, tone, 'Audio Extract'),
      say: (text) => rt.toast(text, 'info', 'Audio Extract'),
    });
    const c = ctl;
    rt.actions.register('audio-extract.latest', () => { rt.navigate('audio-extract'); void c.extractLatest(); }, { label: 'Extract audio from my last screen recording' });
    rt.actions.register('audio-extract.pick', () => { rt.navigate('audio-extract'); void c.pick(true); }, { label: 'Pick videos to extract audio from' });
    rt.actions.register('audio-extract.record', () => { lastTab = 'record'; rt.navigate('audio-extract'); void c.recStart(); }, { label: 'Start screen recording' });
    rt.actions.register('audio-extract.stop', () => void c.recStop(), { label: 'Stop screen recording' });
    rt.actions.register('audio-extract.pause', () => void c.recPause(), { label: 'Pause screen recording' });
    rt.actions.register('audio-extract.resume', () => void c.recResume(), { label: 'Resume screen recording' });
    registerVoice();
    if (!bridge) return;
    rt.settings.onChange(K.watch, () => void c.syncWatch());
    rt.settings.onChange(K.folder, () => void c.refreshFiles());
    // a video shared to AmberX while it runs: bring the page up
    void bridge.addListener('shared', () => rt.navigate('audio-extract')).catch(() => undefined);
    void c.attach().then(() => { if (c.get().jobs.length) rt.navigate('audio-extract'); }).catch((e) => rt.terminal.log('audio-extract', `attach failed: ${e instanceof Error ? e.message : String(e)}`));
  },
};
