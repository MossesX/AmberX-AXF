/**
 * The veto banner plugin's own parts (Brett, Oct 30 2026: "the veto notices, Deny screen and alarm belong to the veto
 * banner plugin, so they work in any app it is installed in"):
 *
 *  - `VetoScreen`: one held call with its countdown and **Deny**, **Approve** (run it now) and **Shelve** (pause the
 *    countdown until he decides), axHub decision 104. Opened by tapping a banner row, a notice, or a phone
 *    notification (the host's `open` event).
 *  - `VetoWatch`: every second over the held calls: browser notices (timer started, 30 s left, running) unless the
 *    app's native side raises them itself, and the alarm when a call reaches the alarm's start point (browser player,
 *    or nothing here when the native side rings). Shelved and approved calls go quiet.
 *  - `AlarmPanel`: the alarm settings that need more than a generated row (his own sound file, Test, Stop).
 *
 * Actions go through lib-hub's `runVetoAction`: the app's host (the phone's own hub session) first, then a page on the
 * hub's origin, else the call's page on the hub opens. Only ever on a person's tap.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, Note } from '@console/axf/react';
import { WatchLiveFor } from '@console/watchLive';
import {
  formatCountdown, notifyPlan, runVetoAction, secondsLeftNow, vetoHost, VETO_ACTION_LABELS, VETO_WARNING_SECONDS,
  type VetoAction, type VetoActionResult, type VetoCall, type VetoPhase,
} from '@console/axf/libs/hub/veto';
import { ALARM_KEYS, alarmConfig, alarmDue, BrowserAlarm, CUSTOM_SOUND_MAX, nativeAlarmConfig, type AlarmConfig } from './alarm';

const ACTION_ICON: Record<VetoAction, string> = { deny: 'x-circle', 'approve-now': 'play', shelve: 'pause' };
/** Green Approve, red Deny (Brett, Oct 30 2026: "Approve/Deny on every row … green/red"). */
const ACTION_TONE: Record<VetoAction, 'danger' | 'success' | 'neutral'> = { deny: 'danger', 'approve-now': 'success', shelve: 'neutral' };
const DONE_TEXT: Record<VetoAction, string> = {
  deny: 'Denied: it will not run.',
  'approve-now': 'Approved: axHub runs it now.',
  shelve: 'Shelved: the countdown is paused until you approve or deny it.',
};
/** Deny first (the safe one), then Approve, then Shelve. */
const ORDER: VetoAction[] = ['deny', 'approve-now', 'shelve'];

export interface VetoDeps {
  hub: () => string;
  toast: (text: string, kind: 'success' | 'info' | 'warning' | 'danger') => void;
  /** Read the hub again (after an action). */
  refresh: () => void;
}

/** Runs one action and reports it; the alarm for that call stops at once. */
export async function act(d: VetoDeps, c: VetoCall, action: VetoAction): Promise<boolean> {
  return (await actResult(d, c, action)).ok;
}

/** {@link act} with the hub's whole answer (the application menu's row shows it in place: Running / Denied). */
export async function actResult(d: VetoDeps, c: VetoCall, action: VetoAction): Promise<VetoActionResult> {
  watch.silence(c.id);
  const r = await runVetoAction(d.hub(), c, action);
  if (r.ok) d.toast(`${DONE_TEXT[action]} ${c.title}`, action === 'deny' ? 'success' : 'info');
  else if (r.opened) d.toast(`Opened it on axHub to ${VETO_ACTION_LABELS[action].toLowerCase()} it there.`, 'info');
  else d.toast(`Couldn't ${VETO_ACTION_LABELS[action].toLowerCase()} it${r.error ? `: ${r.error}` : ''}.`, 'danger');
  d.refresh();
  return r;
}

/**
 * Deny / Approve / Shelve buttons for one call (only the ones the hub allows now). `row`: a banner row, where Deny and
 * Approve keep their words as big targets and Shelve is an icon, so the title gives way first on a phone.
 */
export function VetoButtons({ c, deps, row, onDone }: { c: VetoCall; deps: VetoDeps; row?: boolean; onDone?: () => void }) {
  const [busy, setBusy] = useState<VetoAction | null>(null);
  const left = secondsLeftNow(c);
  if (!c.shelved && left <= 0) return null;
  const run = (a: VetoAction) => { setBusy(a); void act(deps, c, a).then((ok) => { setBusy(null); if (ok) onDone?.(); }); };
  return (
    <div className="fx-row fx-row--wrap axp-approvals-banner__acts">
      {ORDER.filter((a) => c.actions.includes(a)).map((a) => (row && a === 'shelve'
        ? <button key={a} type="button" className="fx-iconbtn axp-approvals-banner__shelve" aria-label={`Shelve: ${c.title}`} title="Shelve: pause the countdown until you decide" disabled={busy !== null} onClick={() => run(a)}><Icon name={ACTION_ICON[a]} size={18} /></button>
        : <Button key={a} tone={ACTION_TONE[a]} icon={ACTION_ICON[a]} busy={busy === a} disabled={busy !== null} aria-label={`${VETO_ACTION_LABELS[a]}: ${c.title}`} onClick={() => run(a)}>
          {VETO_ACTION_LABELS[a]}
        </Button>
      ))}
    </div>
  );
}

/** The veto screen: what will run, the countdown, Deny / Approve / Shelve. `c` null = no longer held. */
export function VetoScreen({ c, deps, onClose }: { c: VetoCall | null; deps: VetoDeps; onClose: () => void }) {
  const [, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN((n) => n + 1), 1_000); return () => clearInterval(t); }, []);
  if (!c) {
    return (
      <div className="fx-stack">
        <p style={{ margin: 0 }}><Icon name="check" size={14} /> No longer held: it was decided, ran, or the hub let it go.</p>
        <div className="fx-row"><Button onClick={onClose}>Close</Button></div>
      </div>
    );
  }
  const left = secondsLeftNow(c);
  const urgent = !c.shelved && left <= VETO_WARNING_SECONDS;
  return (
    <div className="fx-stack axp-veto-screen">
      <div className="axp-veto-screen__time">
        {c.shelved
          ? <Chip tone="warning">Shelved · waiting for you ({formatCountdown(left)} was left)</Chip>
          : c.approvedNow ? <Chip tone="accent">Approved · running now</Chip>
            : left > 0
              ? <span className={`axp-veto-screen__count${urgent ? ' is-urgent' : ''}`} role="timer" aria-live={urgent ? 'assertive' : 'off'}>{formatCountdown(left)}</span>
              : <Chip tone="accent">Running now</Chip>}
        <span className="fx-small fx-muted">{c.shelved ? 'Paused until you approve or deny it.' : left > 0 && !c.approvedNow ? 'until axHub runs it by itself' : ''}</span>
      </div>
      <strong>{c.title}</strong>
      {(c.command || c.tool) && <code className="axp-veto-screen__cmd">$ {c.command || c.tool}</code>}
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        <strong>Deny</strong> stops it. <strong>Approve</strong> runs it right away. <strong>Shelve</strong> pauses the countdown; it waits until you approve or deny it.
      </p>
      <VetoButtons c={c} deps={deps} onDone={onClose} />
      <WatchLiveFor text={`${c.title} ${c.command} ${c.tool}`} />
      <a className="fx-small" href={c.url} target="_blank" rel="noopener noreferrer">Open it on axHub <Icon name="external" size={12} /></a>
    </div>
  );
}

/* ---------------------------------------------------------------- notices + alarm */

const SENT_KEY = 'approvals-banner.sent';
const loadSent = (): string[] => { try { return JSON.parse(globalThis.localStorage?.getItem(SENT_KEY) ?? '[]') as string[]; } catch { return []; } };
const saveSent = (v: string[]) => { try { globalThis.localStorage?.setItem(SENT_KEY, JSON.stringify(v)); } catch { /* fine */ } };

/** What each notice says. */
export function noticeText(c: Pick<VetoCall, 'title' | 'command' | 'tool'>, phase: VetoPhase, secondsLeft: number): { title: string; text: string } {
  const what = c.command || c.tool;
  if (phase === 'held') return { title: `Runs in ${formatCountdown(secondsLeft)}: ${c.title}`, text: `${what}\nTap for Deny, Approve or Shelve.` };
  if (phase === 'warning') return { title: `${Math.max(0, Math.round(secondsLeft))} s left: ${c.title}`, text: `${what}\nTap for Deny, Approve or Shelve.` };
  return { title: `Running now: ${c.title}`, text: what };
}

class VetoWatcher {
  readonly alarm = new BrowserAlarm();
  private ringingFor: string | null = null;
  /** Calls whose alarm already went (or was silenced): it never starts twice for one call. */
  private alarmed = new Set<string>();
  private get: (k: string) => unknown = () => undefined;
  private open: (id: string) => void = () => undefined;

  setup(get: (k: string) => unknown, open: (id: string) => void) { this.get = get; this.open = open; }
  config(): AlarmConfig { return alarmConfig(this.get); }

  silence(id: string) {
    this.alarmed.add(id);
    if (this.ringingFor === id) { this.alarm.stop(); this.ringingFor = null; }
    vetoHost().stopAlarm?.();
  }

  /** Called every second and with every read. */
  update(held: VetoCall[], now: number = Date.now()) {
    const host = vetoHost();
    const native = !!host.notifiesNatively;
    // The alarm: the native side rings by itself (with the app closed too); the page rings only without one.
    const cfg = this.config();
    if (this.ringingFor && !held.some((c) => c.id === this.ringingFor && !c.shelved && !c.approvedNow)) { this.alarm.stop(); this.ringingFor = null; }
    if (!native && !this.alarm.ringing) {
      const due = held.find((c) => !this.alarmed.has(c.id) && alarmDue(cfg, { secondsLeft: secondsLeftNow(c, now), shelved: c.shelved, approvedNow: c.approvedNow }));
      if (due) { this.alarmed.add(due.id); this.ringingFor = due.id; this.alarm.start(cfg); }
    }
    // Kept after a call leaves the list (a read that misses it must not ring it again); only the oldest go, past 200.
    for (const id of [...this.alarmed].slice(0, Math.max(0, this.alarmed.size - 200))) this.alarmed.delete(id);
    // Notices: browser notifications while the page is open, unless the native side raises them.
    if (native || this.get(ALARM_KEYS.notices) === false) return;
    const plan = notifyPlan(loadSent(), held, now);
    saveSent(plan.sent);
    if (!plan.send.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const { call, phase } of plan.send) {
      const { title, text } = noticeText(call, phase, secondsLeftNow(call, now));
      try {
        const n = new Notification(title, { body: text, tag: `veto-${call.id}`, requireInteraction: phase !== 'running' });
        n.onclick = () => { globalThis.focus?.(); this.open(call.id); };
      } catch { /* none */ }
    }
  }
}
export const watch = new VetoWatcher();

/** Sends the alarm settings to the app's native side whenever they change. */
export function syncNativeAlarm(get: (k: string) => unknown): () => void {
  let last = '';
  return () => {
    const host = vetoHost();
    if (!host.alarm) return;
    const next = JSON.stringify(nativeAlarmConfig(alarmConfig(get)));
    if (next === last) return;
    last = next;
    host.alarm(JSON.parse(next) as Record<string, unknown>);
  };
}

/* ---------------------------------------------------------------- settings panel */

/** His own sound file, Test and Stop, and the notification permission. */
export function AlarmPanel({ get, set }: { get: (k: string) => unknown; set: (k: string, v: string | null) => void }) {
  const [, setN] = useState(0);
  const [err, setErr] = useState('');
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const cfg = alarmConfig(get);
  const host = vetoHost();
  const name = typeof get(ALARM_KEYS.customName) === 'string' ? String(get(ALARM_KEYS.customName)) : '';
  const pickFile = (f: File | undefined) => {
    setErr('');
    if (!f) return;
    if (!f.type.startsWith('audio/')) { setErr('Pick a sound file (mp3, ogg, wav, m4a).'); return; }
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result ?? '');
      if (url.length > CUSTOM_SOUND_MAX) { setErr('That file is too big: keep it under about 1 MB.'); return; }
      set(ALARM_KEYS.customSound, url);
      set(ALARM_KEYS.customName, f.name.slice(0, 120));
      set(ALARM_KEYS.tone, 'custom');
      setN((n) => n + 1);
    };
    r.onerror = () => setErr("Couldn't read that file.");
    r.readAsDataURL(f);
  };
  const test = () => {
    if (host.testAlarm) host.testAlarm(nativeAlarmConfig(cfg));
    else watch.alarm.start(cfg);
  };
  const stop = () => { host.stopAlarm?.(); watch.alarm.stop(); };
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>
        The alarm rings for a held call when its countdown reaches the start point you pick, with the tone, volume and vibration
        set here. Deny, Approve or Shelve stops it.{host.alarm ? ' On the phone it rings on the alarm channel, through silent mode when that is on.' : ' In a browser it rings while this page is open.'}
      </p>
      <div className="fx-row fx-row--wrap">
        <label className="fx-btn fx-btn--neutral" style={{ cursor: 'pointer' }}>
          <Icon name="upload" size={14} /> {name ? 'Change my sound' : 'Use my own sound'}
          <input type="file" accept="audio/*" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
        </label>
        {name && <Chip>{name}</Chip>}
        {name && <Button size="sm" icon="x" onClick={() => { set(ALARM_KEYS.customSound, null); set(ALARM_KEYS.customName, null); if (cfg.tone === 'custom') set(ALARM_KEYS.tone, null); setN((n) => n + 1); }}>Remove</Button>}
      </div>
      {err && <Note tone="warning">{err}</Note>}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="bell" onClick={test}>Test the alarm</Button>
        <Button icon="x-circle" onClick={stop}>Stop</Button>
      </div>
      {!host.notifiesNatively && perm !== 'granted' && perm !== 'unsupported' && (
        <Note tone="warning">Notifications are off for this site. <Button size="sm" onClick={() => void Notification.requestPermission().then(setPerm)}>Allow notifications</Button></Note>
      )}
    </div>
  );
}
