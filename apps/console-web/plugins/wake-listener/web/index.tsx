/**
 * Wake listener console plugin (ai.amberx.axf.console.wake-listener; Nov 13 2026, Fable, build
 * console-app-wake-word-voice-listener).
 *
 * Brett: "set a listener in the console Android app; say a trigger and approve, it lists everything needing approval one
 * at a time and I say approve or deny, or approve all pending; change the veto timer to two hours by voice; every custom
 * command the console could need in wizard format".
 *
 *  - always on while the switch is on: the engine (web/engine.ts: the console app's on-device recognizer through the
 *    native bridge, else the browser's) runs in the page and every utterance goes through core.mjs `hear`;
 *  - wake phrases Brett sets (several), the off switch and the rest of the settings live on the plugin server, so the
 *    settings tab, REST, MCP, the CLI and every open console see one copy; the page re-reads them every few seconds;
 *  - a mic-on light on the banner (status asset `wake-listener`, tap = switch) that says what the listener is doing;
 *  - the page reports its state to the server (GET /state), so the API can read it without the UI;
 *  - actions `wake-listener.on|off|toggle|heard|approvals|wizard|cancel|open` are the API's way in (plugin-commands
 *    dispatches them to the open console: REST, MCP, CLI, voice).
 */
import { useCallback, useEffect, useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Container, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { ENGINE_LABEL, FOLDER, hear, initialState, light, normalizeSettings, pickEngine, sleep, stateLine, switched, wizardOff, wizardOn, type ListenerSettings, type ListenerState } from '../core.mjs';
import { available, chime, createEngine, say, type Engine } from './engine';
import { cancelFloor, floorLabel, handleCommand, hasFloor } from './flow';
import { appMenu } from './menu';
import './wake-listener.css';

const ID = 'ai.amberx.axf.console.wake-listener';
const ASSET_ID = 'wake-listener';
const COUNTER = 'wake-listener.live';
const SETTINGS_POLL_MS = 6_000;
const REPORT_MIN_MS = 2_000;

/* ------------------------------------------------------------------ the one listener in this page */

interface Live { rt: AxfRuntime | null; settings: ListenerSettings & { updatedAt?: string }; state: ListenerState; engine: Engine | null; timer: ReturnType<typeof setTimeout> | null; poll: ReturnType<typeof setInterval> | null; reportAt: number; reportTimer: ReturnType<typeof setTimeout> | null; fns: Set<() => void> }
const L: Live = { rt: null, settings: normalizeSettings({}), state: initialState({}), engine: null, timer: null, poll: null, reportAt: 0, reportTimer: null, fns: new Set() };

const tell = () => { L.fns.forEach((f) => { try { f(); } catch { /* a panel's problem */ } }); paintBanner(); scheduleReport(); };
function setState(next: ListenerState) { L.state = next; tell(); }

async function loadSettings(): Promise<void> {
  try {
    const r = await pluginFetch(FOLDER, 'settings');
    const j = (await r.json()) as { ok?: boolean; settings?: ListenerSettings & { updatedAt?: string } };
    if (r.ok && j.ok && j.settings) applySettings(j.settings);
  } catch { /* offline: keep what we have */ }
}
function applySettings(s: ListenerSettings & { updatedAt?: string }) {
  const before = L.settings;
  L.settings = { ...normalizeSettings(s), updatedAt: s.updatedAt };
  const changed = JSON.stringify(before) !== JSON.stringify(L.settings);
  if (L.state.on !== L.settings.on) setState(switched(L.state, L.settings.on));
  if (changed) void syncEngine();
  else tell();
}
async function saveSettings(patch: Record<string, unknown>): Promise<string> {
  const r = await pluginFetch(FOLDER, 'settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; settings?: ListenerSettings & { updatedAt?: string } };
  if (!r.ok || !j.ok || !j.settings) return j.message || `The console answered ${r.status}.`;
  applySettings(j.settings);
  return '';
}

function scheduleReport() {
  if (L.reportTimer) return;
  const wait = Math.max(0, REPORT_MIN_MS - (Date.now() - L.reportAt));
  L.reportTimer = setTimeout(() => {
    L.reportTimer = null; L.reportAt = Date.now();
    void pluginFetch(FOLDER, 'report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: L.state }) }).catch(() => undefined);
  }, wait);
}

/** Start, restart or stop the engine so it matches the settings and what this page can do. */
async function syncEngine(): Promise<void> {
  const have = available();
  const kind = L.settings.on ? pickEngine(L.settings.engine, have) : 'none';
  if (L.engine && (L.engine.kind !== kind || !L.settings.on)) { await L.engine.stop(); L.engine = null; }
  if (!L.settings.on) { setState({ ...switched(L.state, false), engine: 'none' }); return; }
  if (kind === 'none') { setState({ ...switched(L.state, true), engine: 'none', listening: false, micOpen: false, error: have.native || have.webspeech ? 'the engine setting matches nothing here' : 'no speech recognizer in this browser' }); return; }
  if (!L.engine) {
    L.engine = createEngine(kind, {
      onText: (text, isFinal) => { if (isFinal) onHeard(text); },
      onStatus: (s) => setState({ ...L.state, engine: kind, listening: s.listening, micOpen: s.micOpen, error: s.error }),
    });
    setState({ ...switched(L.state, true), engine: kind, error: '' });
    await L.engine.start(L.settings.phrases);
  } else {
    await L.engine.start(L.settings.phrases);
  }
}

function speak(text: string) {
  if (!text) return;
  setState({ ...L.state, lastReply: text });
  if (!L.settings.speak || !L.rt) return;
  const agentVoice = !!L.rt.actions.get('agent-voice.open');
  L.engine?.pause();
  say(text, { agentVoice, onDone: () => L.engine?.resume() });
}

function armSleep() {
  if (L.timer) clearTimeout(L.timer);
  L.timer = setTimeout(() => { L.timer = null; const s = sleep(L.state); if (s !== L.state) { setState(s); speak(''); } }, L.settings.awakeSec * 1000 + 50);
}

/** One utterance (from the mic, or `wake-listener.heard:<text>` from the API). */
function onHeard(text: string, opts: { direct?: boolean } = {}) {
  const rt = L.rt;
  if (!rt) return;
  // a direct phrase from the API needs no wake word
  const st = opts.direct && L.state.phase !== 'wizard' ? { ...L.state, phase: 'awake' as const, awakeUntil: Date.now() + 5_000 } : L.state;
  const r = hear(st, L.settings, text);
  setState(r.state);
  if (r.event === 'wake') { if (L.settings.chime) chime(); armSleep(); return; }
  if (r.event === 'ignored') return;
  if (L.timer) { clearTimeout(L.timer); L.timer = null; }
  void handleCommand(flowHost(rt), r.command ?? '').then((res) => {
    if (res.say) speak(res.say);
    setState(res.done ? wizardOff({ ...L.state, lastCommand: r.command ?? '' }) : wizardOn(L.state));
  }).catch((e: Error) => { speak(`That failed: ${e.message}`); setState(wizardOff(L.state)); });
}

const flowHost = (rt: AxfRuntime) => ({ rt, say: speak, answerSec: L.settings.answerSec, floor: (busy: boolean) => setState(busy ? wizardOn(L.state) : wizardOff(L.state)) });

/* ------------------------------------------------------------------ the banner light */

const TONE_OF: Record<string, string> = { neutral: 'neutral', success: 'success', warning: 'warning', accent: 'accent', danger: 'danger' };
let painted = '';
function paintBanner() {
  const rt = L.rt;
  if (!rt) return;
  const l = light(L.state);
  const mode = L.settings.indicator;
  const show = mode === 'always' || (mode === 'listening' && l.lit);
  const key = JSON.stringify([l.label, l.tone, show]);
  if (key === painted) return;
  painted = key;
  rt.registry.register({
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'Wake listener', version: '0.1.0', author: 'Wake listener plugin',
    description: 'The mic-on light: lit while the console listens for its wake phrase; tap to switch the listener on or off.', tags: ['voice', 'mic', 'status'],
    data: { counter: COUNTER, onLabel: l.label, offLabel: l.label, onTone: TONE_OF[l.tone] ?? 'neutral', offTone: 'neutral', dot: true, link: 'wake-listener.toggle' },
  } as never, 'app', ID);
  rt.setBadge(COUNTER, l.lit ? 1 : 0);
  if (show) rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'right', order: 23, origin: ID, widget: { label: 'Wake listener', size: 'compact', priority: 4, aliases: ['mic', 'listener'] } });
  else rt.detachFromBanner(`status:${ASSET_ID}`);
}

/* ------------------------------------------------------------------ the settings panel */

function useLive() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); L.fns.add(f); return () => { L.fns.delete(f); }; }, []);
  return L;
}

function when(ms: number) { return ms ? new Date(ms).toLocaleTimeString() : ''; }

export function WakeListenerPanel() {
  const rt = useRuntime();
  const live = useLive();
  const [phrase, setPhrase] = useState('');
  const [test, setTest] = useState('');
  const [err, setErr] = useState('');
  const s = live.settings; const st = live.state;
  const have = available();
  const set = useCallback(async (patch: Record<string, unknown>) => { const e = await saveSettings(patch); setErr(e); if (e) rt.toast(e, 'danger', 'Wake listener'); }, [rt]);
  const l = light(st);
  return (
    <div className="axp-wake-listener" data-help="settings:wake-listener">
      <Container title="Listener" icon="mic">
        <div className="axp-wake-listener__row">
          <Switch label="Listen for a wake phrase" checked={s.on} onChange={(v) => void set({ on: v })} hint="Off closes the microphone everywhere this console is open; the light on the banner goes grey." />
          <Chip tone={l.tone === 'danger' ? 'danger' : l.tone === 'success' ? 'success' : l.tone === 'warning' ? 'warning' : l.tone === 'accent' ? 'accent' : undefined}>{l.label}</Chip>
        </div>
        <p className="fx-muted">{stateLine(st, s)}</p>
        {st.error && <Note tone="warning">{st.error}</Note>}
        {!have.native && !have.webspeech && <Note tone="info">This browser has no speech recognizer. The console Android app brings its own on-device engine (offline) through the native bridge; Chrome and Edge use the browser's.</Note>}
        {hasFloor() && <div className="axp-wake-listener__floor"><strong>{floorLabel()} is waiting for your answer</strong><span className="fx-muted">{st.lastReply || 'Say the answer, or Cancel.'}</span><div><Button size="sm" icon="x" onClick={() => { const m = cancelFloor(); speak(m); setState(wizardOff(L.state)); }}>Cancel</Button></div></div>}
      </Container>
      <Container title="Wake phrases" icon="message-circle">
        <p className="fx-muted">Say one of these, then the command (or wait for the chime and say it). "Hey" or "OK" in front is fine. Several are allowed.</p>
        <div className="axp-wake-listener__phrases">
          {s.phrases.map((p) => (
            <span key={p} className="axp-wake-listener__row" data-phrase={p}>
              <Chip tone="accent">{p}</Chip>
              <Button size="sm" icon="x" onClick={() => void set({ removePhrase: p })} disabled={s.phrases.length <= 1}>Remove</Button>
            </span>
          ))}
        </div>
        <div className="axp-wake-listener__add">
          <TextField label="Add a wake phrase" value={phrase} onChange={setPhrase} placeholder="hey console" />
          <Button size="sm" icon="plus" onClick={() => { if (phrase.trim()) { void set({ addPhrase: phrase }); setPhrase(''); } }} disabled={!phrase.trim()}>Add</Button>
        </div>
      </Container>
      <Container title="Engine and replies" icon="sliders">
        <SelectField label="Recognizer" value={s.engine} onChange={(v) => void set({ engine: v })} options={[
          { value: 'auto', label: `Automatic (${ENGINE_LABEL[pickEngine('auto', have)]})` },
          { value: 'native', label: `On-device, console app${have.native ? '' : ' (not here)'}` },
          { value: 'webspeech', label: `Browser recognizer${have.webspeech ? '' : ' (not here)'}` },
          { value: 'off', label: 'None (the switch stays, nothing listens)' },
        ]} hint="On-device never sends audio anywhere; the browser's recognizer may use its vendor's service." />
        <SelectField label="Awake for a command (seconds)" value={String(s.awakeSec)} onChange={(v) => void set({ awakeSec: Number(v) })} options={[5, 8, 12, 20, 30].map((n) => ({ value: String(n), label: `${n} s` }))} />
        <SelectField label="A wizard waits for an answer (seconds)" value={String(s.answerSec)} onChange={(v) => void set({ answerSec: Number(v) })} options={[10, 20, 30, 60, 120].map((n) => ({ value: String(n), label: `${n} s` }))} />
        <Switch label="Speak replies" checked={s.speak} onChange={(v) => void set({ speak: v })} hint="Through the agent voice when it is installed, else the device voice." />
        <Switch label="Chime on the wake phrase" checked={s.chime} onChange={(v) => void set({ chime: v })} />
        <SelectField label="Mic light on the banner" value={s.indicator} onChange={(v) => void set({ indicator: v })} options={[{ value: 'always', label: 'Always (grey when off)' }, { value: 'listening', label: 'Only while listening' }, { value: 'never', label: 'Never' }]} />
        <Switch label="Pause while this page is hidden" checked={s.pauseHidden} onChange={(v) => void set({ pauseHidden: v })} hint="On the phone: another app in front. Off keeps listening in the background where the engine allows it." />
        {err && <Note tone="danger">{err}</Note>}
      </Container>
      <Container title="Try it without the microphone" icon="terminal">
        <div className="axp-wake-listener__add">
          <TextField label="Say a phrase" value={test} onChange={setTest} placeholder="approve" hint="Runs as if the mic heard it after the wake phrase (the API's wake-listener.heard does the same)." />
          <Button size="sm" icon="play" onClick={() => { if (test.trim()) { onHeard(test, { direct: true }); setTest(''); } }} disabled={!test.trim()}>Say it</Button>
        </div>
        <dl className="axp-wake-listener__log">
          <dt className="fx-muted">Last heard</dt><dd>{st.lastHeard ? `"${st.lastHeard}" ${when(st.lastHeardAt)}` : '–'}</dd>
          <dt className="fx-muted">Wake phrase</dt><dd>{st.lastWake ? `"${st.lastWake}" ${when(st.lastWakeAt)}` : '–'}</dd>
          <dt className="fx-muted">Last command</dt><dd>{st.lastCommand || '–'}</dd>
          <dt className="fx-muted">Last reply</dt><dd>{st.lastReply || '–'}</dd>
        </dl>
      </Container>
    </div>
  );
}

/* ------------------------------------------------------------------ the plugin */

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Wake listener',
  version: '0.1.0',
  builtWith: { model: 'fable', builtAt: '2026-11-13' },
  appMenu,
  settingsTabs: [{ id: FOLDER, label: 'Wake listener', icon: 'mic', order: 94, parent: 'plugins', description: 'Wake phrases, the off switch, the recognizer, spoken replies' }],
  settingsPanels: [
    { id: 'wake-listener.panel', tab: FOLDER, title: 'Wake listener', icon: 'mic', order: 10, render: () => <WakeListenerPanel /> },
    { id: 'wake-listener.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    L.rt = rt;
    rt.actions.register('wake-listener.on', () => { void saveSettings({ on: true }); }, { label: 'Wake listener on', effect: 'write' });
    rt.actions.register('wake-listener.off', () => { void saveSettings({ on: false }); }, { label: 'Wake listener off', effect: 'write' });
    rt.actions.register('wake-listener.toggle', () => { void saveSettings({ on: !L.settings.on }); }, { label: 'Wake listener on / off', effect: 'write' });
    rt.actions.register('wake-listener.heard', (args) => { const text = args.join(':').trim(); if (text) onHeard(text, { direct: true }); }, { label: 'Say a phrase to the console (as if the mic heard it)', params: true, effect: 'write' });
    rt.actions.register('wake-listener.approvals', () => onHeard('review approvals', { direct: true }), { label: 'Review approvals by voice', effect: 'write' });
    rt.actions.register('wake-listener.wizard', (args) => { const id = args.join(':').trim(); if (id) onHeard(`start wizard ${id}`, { direct: true }); }, { label: 'Start a spoken wizard for a command', params: true, effect: 'write' });
    rt.actions.register('wake-listener.cancel', () => { const m = cancelFloor(); if (m) speak(m); setState(wizardOff(L.state)); }, { label: 'Cancel the spoken wizard', effect: 'write' });
    rt.actions.register('wake-listener.open', () => rt.actions.dispatch(`settings.open:${FOLDER}`, { runtime: rt }), { label: 'Wake listener settings', effect: 'navigate' });
    void loadSettings().then(() => syncEngine());
    L.poll = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible' || !L.settings.pauseHidden) void loadSettings(); }, SETTINGS_POLL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (!L.settings.pauseHidden || !L.engine) return; if (document.visibilityState === 'hidden') L.engine.pause(); else L.engine.resume(); });
      window.addEventListener('axf-native-ready', () => { void syncEngine(); });
    }
    paintBanner();
  },
};
