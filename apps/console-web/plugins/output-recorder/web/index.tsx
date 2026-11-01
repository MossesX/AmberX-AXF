/**
 * Audio Output Recorder (web part). In AmberX: one switch that records everything the phone plays (never the
 * microphone) into 30-minute chunks sent to axHub, plus a quick-settings tile ("Record audio out") doing the same.
 * Everywhere (AmberX and the Dev Console): the recordings on axHub, to play, share (download on the console), delete,
 * or send to Audio Extract (AmberX).
 *
 *  - view `output-recorder` (nav → Media → Audio out): the switch and queue (AmberX), the recordings on axHub
 *  - Settings → Plugins → Audio Output Recorder: quality, mono/stereo, chunk length, local cap, when full, silence,
 *    hub project
 *  - actions `output-recorder.start | stop | toggle`, voice phrases for each (core.ts VOICE)
 * The work is native (OutputRecorderPlugin.java and friends, see bridge.ts).
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Container, Note, Switch, useRuntime, type AxfWebLibrary } from '@console/axf/react';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { nativeBridge } from './bridge';
import {
  DEFAULTS, FOLDER, ID, K, KBPS, UPLOAD_LABEL, VOICE, byGroup, capHours, chunkBytes, chunkName, formatSize, formatTime, hubHours, hubOf, readSettings,
  type Recording,
} from './core';
import { createController, type Controller } from './store';
import { appMenu } from './menu';
import './output-recorder.css';

let ctl: Controller | null = null;
const settingsOf = (rt: AxfRuntime) => readSettings((k) => rt.settings.get(k));
const controller = (): Controller => ctl ?? (ctl = createController(null, { settings: () => DEFAULTS, hub: () => hubOf() }));
const useStore = () => { const c = controller(); return useSyncExternalStore(c.subscribe, c.get); };

/* ---------------------------------------------------------------- the switch + the phone's queue (AmberX) */

/** Re-renders every second while shown (one timer for every clock). */
const secSubs = new Set<() => void>();
let secTimer: ReturnType<typeof setInterval> | null = null;
function subscribeSecond(fn: () => void) {
  secSubs.add(fn);
  if (!secTimer) secTimer = setInterval(() => secSubs.forEach((f) => f()), 1000);
  return () => { secSubs.delete(fn); if (!secSubs.size && secTimer) { clearInterval(secTimer); secTimer = null; } };
}
const nowSecond = () => Math.floor(Date.now() / 1000);

function Elapsed({ since }: { since: string | null }) {
  const now = useSyncExternalStore(subscribeSecond, nowSecond);
  if (!since) return null;
  const ms = now * 1000 - Date.parse(since);
  return <span className="fx-mono">{formatTime(Number.isFinite(ms) ? ms : 0)}</span>;
}

function Recorder() {
  const rt = useRuntime();
  const c = controller();
  const s = useStore();
  const r = s.rec;
  const cfg = settingsOf(rt);
  const upTone = r.upload === 'idle' || r.upload === 'uploading' ? 'fx-chip--success' : r.upload === 'offline' ? 'fx-chip--warning' : 'fx-chip--danger';
  return (
    <Container title="Record what the phone plays" icon="play">
      <div className="fx-stack">
        <Switch label={r.running ? 'Recording' : r.starting ? 'Waiting for Android…' : 'Off'} checked={r.running || r.starting} disabled={r.starting && !r.running}
          onChange={(v) => void c.toggle(v)}
          hint={r.running ? <>Recording for <Elapsed since={r.startedAt} />. Stop here, from the notification, or with the “Record audio out” tile.</> : 'Android asks you to allow capture each time it starts.'} />
        {r.note && <p className="fx-small fx-muted">{r.note}</p>}
        <div className="axp-output-recorder-status">
          <span className={`fx-chip ${upTone}`}>{UPLOAD_LABEL[r.upload]}</span>
          <span className="fx-small fx-muted">
            {r.waiting ? `${r.waiting} chunk${r.waiting === 1 ? '' : 's'} on the phone (${formatSize(r.waitingBytes)} of ${formatSize(r.capBytes)})` : 'Nothing waiting on the phone'}
          </span>
        </div>
        {r.message && r.upload !== 'idle' && <p className="fx-small fx-muted">{r.message}{r.nextTryAt ? ` Next try ${new Date(r.nextTryAt).toLocaleTimeString()}.` : ''}</p>}
        {!!s.queue.length && (
          <ul className="axp-output-recorder-list">
            {s.queue.map((q) => (
              <li key={q.id} className="axp-output-recorder-row">
                <div className="axp-output-recorder-rowhead">
                  <span className="axp-output-recorder-name">{chunkName(q.id)}</span>
                  <span className="fx-small fx-muted">{formatTime(q.durationMs)} · {formatSize(q.bytes)}{q.parts ? ` · ${q.uploadedParts}/${q.parts} sent` : ''}</span>
                </div>
                <div className="fx-row fx-row--end">
                  <Button size="sm" tone="quiet" icon="trash" confirm={`Throw away ${chunkName(q.id)}? It never reached axHub, so it’s gone for good.`} onClick={() => void c.discard(q.id)}>Discard</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {(r.waiting > 0 || r.upload !== 'idle') && <div className="fx-row fx-row--wrap"><Button size="sm" icon="upload" onClick={() => void c.retry()}>Send now</Button></div>}
        <Note tone="info">
          Only the sound apps play, never the microphone. Calls can’t be captured, and apps that block capture (DRM video, some music apps)
          record as silence. Each {cfg.chunkMin}-minute chunk ({formatSize(chunkBytes(cfg))} at {cfg.kbps} kbps {cfg.channels === 1 ? 'mono' : 'stereo'}) goes
          to axHub and stays on the phone until axHub confirms it; the phone holds up to {cfg.capMb} MB (about {Math.floor(capHours(cfg))} h) while offline.
        </Note>
      </div>
    </Container>
  );
}

/* ---------------------------------------------------------------- the recordings on axHub (AmberX + console) */

function RecordingRow({ r }: { r: Recording }) {
  const c = controller();
  const s = useStore();
  const working = s.busy[r.id];
  const time = new Date(r.startedAt);
  return (
    <li className="axp-output-recorder-row">
      <div className="axp-output-recorder-rowhead">
        <span className="axp-output-recorder-name">{Number.isNaN(time.getTime()) ? r.name : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="fx-small fx-muted">{formatTime(r.durationMs)} · {formatSize(r.bytes)}{r.device ? ` · ${r.device}` : ''}</span>
      </div>
      {s.playing?.id === r.id && <audio className="axp-output-recorder-audio" src={s.playing.url} controls autoPlay onEnded={() => c.stopPlaying()} />}
      <div className="fx-row fx-row--wrap fx-row--end">
        {working && <span className="fx-small fx-muted">{working}…</span>}
        {s.playing?.id === r.id
          ? <Button size="sm" tone="quiet" icon="x" onClick={() => c.stopPlaying()}>Close</Button>
          : <Button size="sm" tone="quiet" icon="play" disabled={!!working} onClick={() => void c.play(r)}>Play</Button>}
        <Button size="sm" tone="quiet" icon={c.native() ? 'external' : 'download'} disabled={!!working} onClick={() => void c.share(r)}>{c.native() ? 'Share' : 'Download'}</Button>
        {c.native() && <Button size="sm" tone="quiet" icon="download" disabled={!!working} onClick={() => void c.toExtract(r)}>Audio Extract</Button>}
        <Button size="sm" tone="quiet" icon="trash" disabled={!!working} confirm={`Delete ${r.name} from axHub? This can’t be undone.`} onClick={() => void c.remove(r)}>Delete</Button>
      </div>
    </li>
  );
}

function HubList() {
  const c = controller();
  const s = useStore();
  const rt = useRuntime();
  useEffect(() => { if (!s.hub.loaded && !s.hub.loading) void c.refreshHub(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const days = byGroup(s.hub.items);
  return (
    <Container title={`On axHub · ${settingsOf(rt).project}`} icon="cloud" actions={<Button size="sm" tone="quiet" icon="refresh" busy={s.hub.loading} onClick={() => void c.refreshHub()}>Refresh</Button>}>
      {s.hub.error ? <Note tone="warning">{s.hub.error}</Note>
        : !s.hub.loaded ? <p className="fx-muted">Loading…</p>
          : !days.length ? <p className="fx-muted">No recordings on axHub yet.</p>
            : days.map((d) => (
              <div key={d.key} className="fx-stack">
                <p className="fx-eyebrow">{d.group ? `Session · ${d.label}` : d.label}</p>
                <ul className="axp-output-recorder-list">{d.items.map((r) => <RecordingRow key={r.id} r={r} />)}</ul>
              </div>
            ))}
    </Container>
  );
}

function OutputRecorderView() {
  const c = controller();
  return (
    <div className="fx-stack">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Audio Output Recorder</p>
          <h1>Audio out</h1>
          <p className="fx-muted">Everything the phone plays, recorded while it’s on and kept on axHub. No microphone.</p>
        </div>
      </header>
      {c.native() ? <Recorder /> : <Note tone="info">Recording runs in the AmberX app on Android (switch or the “Record audio out” quick-settings tile). Here you can play, download and delete what it sent to axHub.</Note>}
      <HubList />
    </div>
  );
}

function HubBudget() {
  const rt = useRuntime();
  const cfg = settingsOf(rt);
  return (
    <p className="fx-small fx-muted">
      axHub’s data server holds about 100 MB per project, so <span className="fx-mono">{cfg.project}</span> fits roughly {Math.floor(hubHours(cfg.kbps))} hours at {cfg.kbps} kbps.
      Delete old recordings to make room; when it’s full, chunks wait on the phone and the page says “axHub is full”.
    </p>
  );
}

/* ---------------------------------------------------------------- library */

type VoiceRegistry = { register(module: string, commands: { id: string; phrases: string[]; action: string; reply?: string; group?: string; owner?: string }[]): () => void };

const SETTING_KEYS = Object.values(K);

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Audio Output Recorder',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-31' },
  provides: ['axf.output-recorder'],
  views: { 'output-recorder': { title: 'Audio out', icon: 'play', keywords: ['audio', 'record', 'recorder', 'phone audio', 'playback', 'axhub', 'recordings'], render: () => <OutputRecorderView /> } },
  appMenu,
  nav: { label: 'Media', items: [{ id: 'output-recorder', label: 'Audio out', icon: 'play', view: 'output-recorder' }] },
  settingsTabs: [{ id: 'output-recorder', label: 'Audio Output Recorder', icon: 'play', order: 41, parent: 'plugins', description: 'Quality, chunk length, what the phone keeps while offline, and where recordings go on axHub.' }],
  settings: [
    {
      id: 'output-recorder.recording', label: 'Recording', icon: 'play', tab: 'output-recorder', settings: [
        { key: K.kbps, label: 'Quality', kind: 'choice', default: String(DEFAULTS.kbps), options: KBPS.map((k) => ({ value: String(k), label: `${k} kbps${k === 32 ? ' (default)' : ''}` })), description: 'AAC. Lower keeps more hours on axHub.' },
        { key: K.channels, label: 'Channels', kind: 'choice', default: '1', options: [{ value: '1', label: 'Mono (half the size)' }, { value: '2', label: 'Stereo' }] },
        { key: K.chunkMin, label: 'Chunk length (minutes)', kind: 'number', default: DEFAULTS.chunkMin, min: 5, max: 60, step: 5 },
        { key: K.skipSilent, label: 'Skip silent chunks', kind: 'toggle', default: true, description: 'A chunk with no sound at all is not kept or sent.' },
      ],
    },
    {
      id: 'output-recorder.storage', label: 'Phone and axHub', icon: 'cloud', tab: 'output-recorder', settings: [
        { key: K.capMb, label: 'Phone queue limit (MB)', kind: 'number', default: DEFAULTS.capMb, min: 50, max: 2000, step: 50, description: 'What the phone may hold while axHub can’t be reached.' },
        { key: K.whenFull, label: 'When the phone queue is full', kind: 'choice', default: 'stop', options: [{ value: 'stop', label: 'Stop recording (nothing lost)' }, { value: 'drop-oldest', label: 'Drop the oldest unsent chunk' }] },
        { key: K.project, label: 'axHub project', kind: 'text', default: DEFAULTS.project, description: 'Its own hub project, so recordings never fill the one notes and plans share.' },
      ],
    },
  ],
  settingsPanels: [
    { id: 'output-recorder.budget', tab: 'output-recorder', title: 'Room on axHub', icon: 'cloud', render: () => <HubBudget /> },
    { id: 'output-recorder.lifecycle', tab: 'output-recorder', title: 'Install & uninstall', icon: 'package', render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    const bridge = nativeBridge();
    ctl = createController(bridge, {
      settings: () => settingsOf(rt),
      hub: () => hubOf(),
      toast: (text, tone) => rt.toast(text, tone, 'Audio out'),
    });
    const c = ctl;
    rt.actions.register('output-recorder.start', () => void c.start(), { label: 'Record what the phone plays' });
    rt.actions.register('output-recorder.stop', () => void c.stop(), { label: 'Stop recording phone audio' });
    rt.actions.register('output-recorder.toggle', () => void c.toggle(!c.get().rec.running), { label: 'Record audio out on / off' });
    const v = (globalThis as { amberxVoice?: VoiceRegistry }).amberxVoice;
    v?.register(ID, [
      { id: 'output-recorder.start', phrases: [...VOICE.start], action: 'output-recorder.start', owner: 'Audio out' },
      { id: 'output-recorder.stop', phrases: [...VOICE.stop], action: 'output-recorder.stop', owner: 'Audio out' },
      { id: 'output-recorder.open', phrases: [...VOICE.open], action: 'nav:output-recorder', owner: 'Audio out' },
    ]);
    if (!bridge) return;
    for (const k of SETTING_KEYS) rt.settings.onChange(k, () => void c.configure({}));
    void c.attach().catch((e) => rt.terminal.log('output-recorder', `attach failed: ${e instanceof Error ? e.message : String(e)}`));
  },
};
