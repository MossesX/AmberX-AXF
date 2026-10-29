/**
 * Background monitoring: keeps an eye on axHub when AmberX isn't on screen.
 *
 * On Android the watch is the native foreground service (`WatchService.java`): approval alerts with the screen off,
 * auto-approval on the hub's own form, the wake phrase for voice control, restart after a reboot. In a browser this tab
 * is the monitor: while it's open it alerts on new approvals through the Notification API. One status either way.
 */
import { useEffect, useState } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Note, Section, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { loginUrl, seenPlan } from '../../../axf/libs/hub';
import { hubWatcher } from '../../../axf/libs/hub/react';
import { HUB } from '../../../hub/useHub';
import { isNative, native, reportWebMonitor, type MonitorStatus } from '../../../native';
import { K as VOICE } from '../../voice/web';
import { phraseList } from '../../voice/web/core';
import { autoApproves, watchConfig } from './core';

const ID = 'ai.amberx.amberx.monitor';
export const K = {
  on: 'amberx.monitor.on',
  interval: 'amberx.monitor.interval',
  listen: 'amberx.monitor.listen',
  autoApprove: 'amberx.monitor.autoApprove',
  autoApproveAll: 'amberx.monitor.autoApproveAll',
  autoApproveTools: 'amberx.monitor.autoApproveTools',
  consoleAlerts: 'amberx.monitor.consoleAlerts',
} as const;

const configOf = (rt: AxfRuntime) => watchConfig({
  hub: HUB,
  interval: rt.settings.get(K.interval),
  listen: rt.settings.get(K.listen),
  wake: phraseList(rt.settings.get(VOICE.wake)),
  lang: rt.settings.get(VOICE.lang),
  autoApprove: rt.settings.get(K.autoApprove),
  autoApproveAll: rt.settings.get(K.autoApproveAll),
  autoApproveTools: rt.settings.get(K.autoApproveTools),
  consoleAlerts: rt.settings.get(K.consoleAlerts),
});

async function start(rt: AxfRuntime) {
  rt.settings.set(K.on, true);
  await native.permissions().catch(() => undefined);
  await native.monitorStart(configOf(rt)).catch((e) => rt.toast(String(e?.message ?? e), 'danger', 'Monitoring'));
}

async function stop(rt: AxfRuntime) {
  rt.settings.set(K.on, false);
  await native.monitorStop().catch(() => undefined);
}

/** Browser only: this tab alerts on new approvals while it's open (Android's service does it natively). */
function watchInPage(rt: AxfRuntime) {
  const w = hubWatcher(HUB);
  let seen: string[] = [];
  let first = true;
  return w.subscribe(() => {
    const s = w.state;
    if (s.phase !== 'checked') return;
    reportWebMonitor({ lastCheck: new Date().toISOString(), status: s.status, waiting: s.count });
    const plan = seenPlan(seen, s.pending.map((p) => p.id));
    seen = plan.next;
    if (first) { first = false; return; } // what was there when the page opened isn't news
    if (rt.settings.get(K.on) !== true || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const p of s.pending.filter((x) => plan.fresh.includes(x.id))) {
      // Auto-approval needs the hub's own form under its Origin: only the Android service can post it. Here it's a note.
      const auto = autoApproves(rt.settings.get(K.autoApprove) === true, rt.settings.get(K.autoApproveAll) === true, rt.settings.get(K.autoApproveTools), p.tool);
      const n = new Notification(`Approval waiting: ${p.tool}`, { body: auto ? `${p.summary}\n(Auto-approval runs on the Android app.)` : p.summary, tag: p.id });
      n.onclick = () => { window.focus(); window.open(p.url, '_blank', 'noopener,noreferrer'); };
    }
  });
}

function MonitorView() {
  const rt = useRuntime();
  const [st, setSt] = useState<MonitorStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void native.monitorStatus().then((s) => alive && setSt(s)).catch(() => undefined);
    const h = native.addListener('monitor', (s) => alive && setSt(s));
    return () => { alive = false; void h.then((x) => x.remove()); };
  }, []);
  const on = rt.settings.get(K.on) === true;
  const cfg = configOf(rt);
  const when = st?.lastCheck ? new Date(st.lastCheck).toLocaleTimeString() : 'not yet';
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Background monitoring</p>
          <h1>{st?.running ? `Watching · ${st.waiting} waiting` : 'Not watching'}</h1>
          <p className="fx-muted">
            {isNative()
              ? 'AmberX keeps watching axHub with the app closed and the screen off, and tells you the moment something needs you.'
              : 'In a browser, this tab watches while it is open. Install the Android app to watch with the screen off.'}
          </p>
        </div>
        <div className="fx-row fx-row--wrap">
          {on ? <Button icon="pause" onClick={() => void stop(rt)}>Stop watching</Button> : <Button tone="primary" icon="eye" onClick={() => void start(rt)}>Start watching</Button>}
          <Button icon="external" onClick={() => void native.hubOpen({ url: loginUrl(HUB) })}>Sign in to axHub</Button>
        </div>
      </header>
      {st?.status === 'signed-out' && <Note tone="warning">Signed out of axHub: sign in so the watch can read your approvals.</Note>}
      {st?.status === 'not-admin' && <Note tone="warning">This account isn't a hub admin, so it has no approvals to watch.</Note>}
      <Section title="Now">
        <table className="fx-table"><tbody>
          <tr><td>Last check</td><td className="fx-muted">{when} · {st?.status ?? 'off'}</td></tr>
          <tr><td>Every</td><td className="fx-muted">{cfg.intervalSec} s</td></tr>
          <tr><td>Listening for</td><td className="fx-muted">{cfg.wakePhrases.length ? cfg.wakePhrases.map((p) => `“${p}”`).join(', ') : 'nothing'}{st?.listening ? ' (on)' : ''}</td></tr>
          <tr><td>Console alerts</td><td className="fx-muted">{!cfg.consoleAlerts ? 'off' : st?.alerts === undefined ? '–' : st.alerts < 0 ? 'not signed in to the console' : `${st.alerts} open`}</td></tr>
          <tr><td>Auto-approval</td><td className="fx-muted">{cfg.autoApprove.all ? 'everything except vps.run' : cfg.autoApprove.on ? cfg.autoApprove.tools || 'nothing listed' : 'off'}</td></tr>
        </tbody></table>
      </Section>
      <Button icon="settings" onClick={() => rt.dispatch('settings.open:monitor')}>Monitoring settings</Button>
    </div>
  );
}

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Background monitoring',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-25' },
  dependsOn: ['ai.amberx.amberx.voice'],
  provides: ['amberx.monitor'],
  views: { monitor: { title: 'Monitor', icon: 'eye', keywords: ['monitor', 'watch', 'background', 'alerts', 'auto approve'], render: () => <MonitorView /> } },
  nav: { label: 'Work', items: [{ id: 'monitor', label: 'Monitor', icon: 'eye', view: 'monitor' }] },
  settingsTabs: [{ id: 'monitor', label: 'Monitoring', icon: 'eye', order: 21, parent: 'plugins' }],
  settings: [
    {
      id: 'amberx.monitor', label: 'Background monitoring', icon: 'eye', tab: 'monitor', settings: [
        { key: K.on, label: 'Watch axHub in the background', kind: 'toggle', default: true, description: 'AmberX is the phone’s one source of axHub notifications (approvals, merge approvals, console alerts); Patches and the AXHub app stay quiet while it is installed.' },
        { key: K.consoleAlerts, label: 'Dev Console alerts', kind: 'toggle', default: true, description: 'Errors and warnings from console.amberxai.com (builds, CI, deploys, systems check). Tap opens the console in your browser.' },
        { key: K.interval, label: 'Check every (seconds)', kind: 'number', default: 30, min: 15, max: 300, step: 5 },
        { key: K.listen, label: 'Listen for the wake phrase while watching', kind: 'toggle', default: true, description: 'Only used when Voice control → Listen hands-free is off. Hands-free listening (on by default) works without watching axHub.' },
      ],
    },
    {
      id: 'amberx.monitor.auto', label: 'Auto-approval', icon: 'shield', tab: 'monitor', order: 2,
      description: 'Off by default. A matching approval is approved by the phone on the hub’s own form, as you.', settings: [
        { key: K.autoApproveAll, label: 'Approve everything except vps.run', kind: 'toggle', default: false },
        { key: K.autoApprove, label: 'Approve these tools', kind: 'toggle', default: false },
        { key: K.autoApproveTools, label: 'Tools', kind: 'text', default: 'vps.logs, github.*', description: 'Comma separated: a tool (vps.logs), a service (github.*) or * for every tool.' },
      ],
    },
  ],
  register(rt) {
    rt.actions.register('monitor.start', () => void start(rt), { label: 'Start watching axHub' });
    rt.actions.register('monitor.stop', () => void stop(rt), { label: 'Stop watching axHub' });
    rt.actions.register('amberx.review-first', () => {
      const first = hubWatcher(HUB).state.pending[0];
      if (first) void native.hubOpen({ url: first.url });
      else rt.toast('Nothing is waiting.', 'info', 'Approvals');
    }, { label: 'Review the first approval' });
    // A tapped alert: its approval page on the hub (native.hubOpen accepts only the hub).
    void native.addListener('open', ({ url }) => void native.hubOpen({ url }).catch(() => undefined)).catch(() => undefined);
    // Settings changed while watching: send the service the new config (it restarts its loop). Same config = no call.
    let last = '';
    const sync = () => {
      if (rt.settings.get(K.on) !== true) { last = ''; return; }
      const next = JSON.stringify(configOf(rt));
      if (next !== last) {
        const firstRun = last === '';
        last = next;
        // On by default now (every push comes from AmberX): ask for notification permission before the first start.
        void (firstRun ? native.permissions().catch(() => undefined) : Promise.resolve()).then(() => native.monitorStart(JSON.parse(next))).catch(() => undefined);
      }
    };
    rt.subscribe(sync);
    sync();
    if (!isNative()) watchInPage(rt);
  },
};
