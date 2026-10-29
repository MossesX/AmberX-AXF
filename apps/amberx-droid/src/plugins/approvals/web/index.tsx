/**
 * Veto approvals (Brett, Oct 28 2026): Claude sends a command to the VPS through Vinnie on axHub; the hub holds it for a
 * 3-minute countdown and then runs it itself, unless Brett denies it first. AmberX tells him: a notification when the
 * timer starts (title, the command, a Deny action), a second when time is running out (30 s left) and a third when it
 * starts running, each with its own sound, plus the vibration he picks (Settings → Plugins → Approvals, each with Test).
 *
 * On Android the notifications come from the watch service (`VetoAlerts.java`: channels with the chosen sound and
 * vibration, Deny posted with the phone's hub session under the hub's Origin + CSRF, the same way auto-approval posts).
 * In a browser this page raises them while it is open (Notification API, tones, `navigator.vibrate`) and Deny opens the
 * call on the hub, which only takes a Deny under its own Origin.
 *
 * Removable: everything is in this folder except the shell's `VetoAlerts.java` + its seam in native.ts (shared shell
 * code, like the monitor's WatchService). Uninstall: `node framework/cli/plugin-catalog.mjs app-uninstall amberx approvals`.
 */
import { useEffect, useState } from 'react';
import { Button, Note, Section, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { notifyPlan, secondsLeftNow, type VetoPhase } from '../../../axf/libs/hub/veto';
import { isNative, native } from '../../../native';
import { alertConfig, DEFAULTS, K, notificationText, patternOf, SOUNDS, soundOf, tonesOf, VIBRATIONS, vibrationOf, type Sound } from './core';
import { checkVeto, markDenied, startVeto, subscribeVeto, vetoState, setVetoHooks } from './store';
import { deny, getRuntime, setRuntime, useVeto } from './deny';
import { showTab, TerminalView } from './terminal';

const ID = 'ai.amberx.amberx.approvals';
const SENT_KEY = 'amberx.approvals.sent';

/* ---------------------------------------------------------------- sounds (browser) */

let audio: AudioContext | null = null;
export function playTones(sound: Sound) {
  const seq = tonesOf(sound);
  if (!seq.length) return;
  try {
    audio ??= new AudioContext();
    let at = audio.currentTime;
    for (const [hz, ms] of seq) {
      if (hz > 0) {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.frequency.value = hz;
        g.gain.setValueAtTime(0.18, at);
        g.gain.exponentialRampToValueAtTime(0.001, at + ms / 1000);
        o.connect(g).connect(audio.destination);
        o.start(at);
        o.stop(at + ms / 1000);
      }
      at += ms / 1000;
    }
  } catch { /* no audio */ }
}

const get = (k: string) => getRuntime()?.settings.get(k);

/** One phase's notification: native channel test, or the browser's tones + vibration + a Notification. */
export function testPhase(phase: VetoPhase) {
  if (isNative()) { void native.vetoTest({ phase }).catch(() => undefined); return; }
  const cfg = alertConfig(get)[phase];
  playTones(cfg.sound);
  if (cfg.vibrate && cfg.vibration.length) try { navigator.vibrate?.(cfg.vibration); } catch { /* none */ }
  const { title, text } = notificationText({ title: 'Test call', command: 'echo hello', tool: 'vps.run' }, phase, phase === 'held' ? 180 : phase === 'warning' ? 30 : 0);
  try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body: text, tag: `veto-test-${phase}` }); } catch { /* none */ }
}

/* ---------------------------------------------------------------- browser notifications */

const loadSent = (): string[] => { try { return JSON.parse(localStorage.getItem(SENT_KEY) ?? '[]') as string[]; } catch { return []; } };
const saveSent = (v: string[]) => { try { localStorage.setItem(SENT_KEY, JSON.stringify(v)); } catch { /* fine */ } };

function notifyInPage() {
  const s = vetoState();
  if (s.status !== 'ok') return;
  const plan = notifyPlan(loadSent(), s.tracks.filter((t) => t.state === 'held').map((t) => t.call));
  saveSent(plan.sent);
  if (!plan.send.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const cfg = alertConfig(get);
  for (const { call, phase } of plan.send) {
    const { title, text } = notificationText(call, phase, secondsLeftNow(call));
    playTones(cfg[phase].sound);
    if (cfg[phase].vibrate && cfg[phase].vibration.length) try { navigator.vibrate?.(cfg[phase].vibration); } catch { /* none */ }
    const n = new Notification(title, { body: text, tag: `veto-${call.id}`, requireInteraction: phase !== 'running' });
    n.onclick = () => { window.focus(); getRuntime()?.dispatch(`approvals.terminal:${call.id}`); };
  }
}

/* ---------------------------------------------------------------- settings */

function TestRow() {
  return (
    <div className="fx-row fx-row--wrap">
      <Button icon="bell" onClick={() => testPhase('held')}>Test timer started</Button>
      <Button icon="clock" onClick={() => testPhase('warning')}>Test time running out</Button>
      <Button icon="play" onClick={() => testPhase('running')}>Test running</Button>
    </div>
  );
}

function StatusPanel() {
  const s = useVeto();
  const rt = useRuntime();
  useEffect(() => { startVeto(); }, []);
  const held = s.tracks.filter((t) => t.state === 'held');
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>
        Commands Claude sends to the VPS through Vinnie wait 3 minutes before the hub runs them. AmberX notifies you when the
        timer starts, again with 30 seconds left, and when it runs. There is no Approve: tap Deny to stop one before time is up.
      </p>
      <p className="fx-small" style={{ margin: 0 }}>
        <strong>{s.status === 'ok' ? (held.length ? `${held.length} held now.` : 'Nothing held.') : s.status === 'idle' ? 'Checking…' : s.status === 'signed-out' ? 'Sign in to axHub to see held calls.' : s.status === 'not-admin' ? 'Held calls are for hub admins.' : "Can't reach axHub."}</strong>
        {isNative() ? <span className="fx-muted"> · with the app closed, the watch service (Monitor) sends them</span> : <span className="fx-muted"> · in a browser, only while this tab is open</span>}
      </p>
      <TestRow />
      <div className="fx-row fx-row--wrap">
        <Button icon="terminal" onClick={() => rt.dispatch('approvals.terminal')}>Open the terminal</Button>
        <Button icon="refresh" onClick={() => void checkVeto()}>Check now</Button>
      </div>
    </div>
  );
}

function PermissionNote() {
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  if (isNative() || perm === 'granted' || perm === 'unsupported') return null;
  return (
    <Note tone="warning">
      Notifications are off for this site. <Button size="sm" onClick={() => void Notification.requestPermission().then(setPerm)}>Allow notifications</Button>
    </Note>
  );
}

/* ---------------------------------------------------------------- library */

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Approvals (veto)',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-28' },
  provides: ['amberx.approvals.veto', 'amberx.terminal'],
  views: { terminal: { title: 'Terminal', icon: 'terminal', keywords: ['terminal', 'held', 'veto', 'deny', 'countdown', 'command', 'output'], render: () => <TerminalView /> } },
  nav: { label: 'Terminal', items: [{ id: 'terminal', label: 'Terminal', icon: 'terminal', view: 'terminal' }] },
  settingsTabs: [{ id: 'approvals', label: 'Approvals', icon: 'shield', order: 20, parent: 'plugins' }],
  settings: [
    {
      id: 'amberx.approvals.alerts', label: 'Held call notifications', icon: 'bell', tab: 'approvals', order: 2,
      description: 'Sounds and vibration for the three notifications of a held command. On Android each is its own notification channel.',
      settings: [
        { key: K.sound, label: 'Timer started sound', kind: 'choice', default: DEFAULTS.sound, options: SOUNDS.map(({ value, label }) => ({ value, label })) },
        { key: K.vibration, label: 'Vibration', kind: 'choice', default: DEFAULTS.vibration, options: VIBRATIONS.map(({ value, label }) => ({ value, label })) },
        { key: K.warningSound, label: 'Time running out sound (30 s left)', kind: 'choice', default: DEFAULTS.warningSound, options: SOUNDS.map(({ value, label }) => ({ value, label })) },
        { key: K.runningSound, label: 'Running sound', kind: 'choice', default: DEFAULTS.runningSound, options: SOUNDS.map(({ value, label }) => ({ value, label })) },
        { key: K.openTerminal, label: 'Open a terminal tab when a timer starts', kind: 'toggle', default: true, description: 'The tab shows the command, the countdown and Deny, then the output when it runs.' },
      ],
    },
  ],
  settingsPanels: [
    { id: 'amberx.approvals.status', tab: 'approvals', title: 'Held commands', icon: 'shield', order: 1, render: () => <StatusPanel /> },
    { id: 'amberx.approvals.test', tab: 'approvals', title: 'Test the notifications', icon: 'bell', order: 3, render: () => <><PermissionNote /><Section title="Plays each one with the sound and vibration chosen above"><TestRow /></Section></> },
  ],
  register(rt) {
    setRuntime(rt);
    startVeto();
    // Browser: notifications from this page. Android: the watch service sends them (also with the app closed).
    if (!isNative()) subscribeVeto(notifyInPage);
    setVetoHooks({
      started: (t) => { if (rt.settings.get(K.openTerminal) !== false) rt.dispatch(`approvals.terminal:${t.call.id}`); },
    });
    rt.actions.register('approvals.deny', ([id]) => {
      const t = vetoState().tracks.find((x) => x.call.id === id);
      if (t && t.state === 'held') void deny(t); else rt.toast('That call is no longer held.', 'info', 'Approvals');
    }, { label: 'Deny a held command', params: true, searchable: false });
    // approvals.terminal[:<id>] — the Terminal view, with that held command's tab in front
    rt.actions.register('approvals.terminal', ([id]) => { showTab(id ?? null); rt.navigate('terminal'); }, { label: 'Open the terminal', params: true });
    rt.actions.register('approvals.check', () => void checkVeto(), { label: 'Check held commands' });
    // Notification taps and Denies from the shell.
    void native.addListener('veto', (e) => {
      if (e.action === 'open') rt.dispatch(`approvals.terminal:${e.id}`);
      else if (e.action === 'denied') { markDenied(e.id); rt.toast('Denied from the notification.', 'success', 'Approvals'); }
      else rt.toast(`Deny from the notification failed${e.error ? ` (${e.error})` : ''}: open it on the hub.`, 'danger', 'Approvals');
      void checkVeto();
    }).catch(() => undefined);
    // The shell's channels follow the chosen sounds and vibration (same config = no call).
    let last = '';
    const sync = () => {
      const cfg = alertConfig((k) => rt.settings.get(k));
      const next = JSON.stringify(cfg);
      if (next === last) return;
      last = next;
      if (isNative()) void native.vetoSettings(cfg).catch(() => undefined);
    };
    rt.subscribe(sync);
    sync();
  },
};

export { soundOf, vibrationOf, patternOf, deny, useVeto };
